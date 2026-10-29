#!/usr/bin/env python3
"""GitHub-hosted root runner orchestration for netns/veth/bridge/netem."""
import argparse
import csv
import json
import os
from pathlib import Path
import subprocess
import sys
import time

BRIDGE = 'db-br0'
PREFIX = 'db-n'

def sh(*args, check=True):
    p = subprocess.run(args, check=False, stdout=subprocess.DEVNULL,
                       stderr=subprocess.PIPE, text=True)
    if check and p.returncode:
        raise RuntimeError(f'command {args!r} returned {p.returncode}: {p.stderr.strip()}')
    return p

def addr(i):
    return f'10.77.{i // 250}.{i % 250 + 1}'

def ns(i):
    return f'{PREFIX}{i:03d}'

def memory_available():
    try:
        p = Path('/sys/fs/cgroup')
        limit = (p / 'memory.max').read_text().strip()
        if limit != 'max':
            return int(limit) - int((p / 'memory.current').read_text())
    except (OSError, ValueError):
        pass
    try:
        for line in Path('/proc/meminfo').read_text().splitlines():
            if line.startswith('MemAvailable:'):
                return int(line.split()[1])*1024
    except (OSError, ValueError):
        pass
    return None

def prepare(n):
    sh('ip', 'link', 'add', BRIDGE, 'type', 'bridge')
    sh('ip', 'link', 'set', BRIDGE, 'type', 'bridge', 'mcast_snooping', '0')
    sh('ip', 'link', 'set', BRIDGE, 'up')
    for i in range(n):
        left, right = f'db{i:03d}h', f'db{i:03d}n'
        sh('ip', 'netns', 'add', ns(i))
        sh('ip', 'link', 'add', left, 'type', 'veth', 'peer', 'name', right)
        sh('ip', 'link', 'set', right, 'netns', ns(i))
        sh('ip', 'link', 'set', left, 'master', BRIDGE)
        sh('ip', 'link', 'set', left, 'up')
        sh('ip', 'netns', 'exec', ns(i), 'ip', 'link', 'set', right, 'name', 'eth0')
        sh('ip', 'netns', 'exec', ns(i), 'ip', 'addr', 'add', f'{addr(i)}/16', 'dev', 'eth0')
        sh('ip', 'netns', 'exec', ns(i), 'ip', 'link', 'set', 'lo', 'up')
        sh('ip', 'netns', 'exec', ns(i), 'ip', 'link', 'set', 'eth0', 'up')
        if (i + 1) % 50 == 0:
            print(f'created {i + 1} network namespaces', flush=True)

def netem(n, loss):
    for i in range(n):
        left = f'db{i:03d}h'
        sh('tc', 'qdisc', 'del', 'dev', left, 'root', check=False)
        sh('ip', 'netns', 'exec', ns(i), 'tc', 'qdisc', 'del', 'dev', 'eth0', 'root', check=False)
        if loss:
            opts = ['netem', 'loss', f'{loss}%', 'delay', '2ms']
            sh('tc', 'qdisc', 'add', 'dev', left, 'root', *opts)
            sh('ip', 'netns', 'exec', ns(i), 'tc', 'qdisc', 'add', 'dev', 'eth0', 'root', *opts)

def counters(n):
    result = {'rx_bytes': 0, 'tx_bytes': 0, 'rx_packets': 0, 'tx_packets': 0}
    for i in range(n):
        item = json.loads(subprocess.check_output(
            ['ip', '-j', '-s', 'link', 'show', f'db{i:03d}h'], text=True))[0]['stats64']
        for kind in ('rx', 'tx'):
            for unit in ('bytes', 'packets'):
                result[f'{kind}_{unit}'] += item[kind][unit]
    return result

def cleanup(n):
    for i in range(n):
        sh('ip', 'netns', 'delete', ns(i), check=False)
    sh('ip', 'link', 'delete', BRIDGE, check=False)

def execute(n, backend, loss, timeout, outdir):
    wd = outdir / f'{backend}-n{n}-loss{loss}'
    wd.mkdir(parents=True, exist_ok=True)
    procs = []
    try:
        for i in range(n):
            with (wd / f'log-{i}.txt').open('w') as fh:
                p = subprocess.Popen(
                    ['ip', 'netns', 'exec', ns(i), sys.executable,
                     str(Path(__file__).resolve().parent / 'node.py'),
                     '--backend', backend, '--id', str(i), '--count', str(n),
                     '--workdir', str(wd)],
                    stdout=fh, stderr=subprocess.STDOUT)
            procs.append(p)
        ready_deadline = time.monotonic() + max(25, n * .2)
        while time.monotonic() < ready_deadline:
            if len(list(wd.glob('ready-*'))) == n:
                break
            if any(p.poll() is not None for p in procs):
                break
            time.sleep(.06)
        ready = len(list(wd.glob('ready-*')))
        if ready != n:
            raise RuntimeError(f'only {ready}/{n} processes ready; see log-*.txt')
        before = counters(n)
        begin = time.monotonic()
        (wd / 'go').touch()
        while time.monotonic() - begin < timeout:
            if len(list(wd.glob('done-*'))) == n:
                break
            if any(p.poll() is not None for p in procs):
                break
            time.sleep(.08)
        (wd / 'stop').touch()
        for p in procs:
            try:
                p.wait(timeout=6)
            except subprocess.TimeoutExpired:
                p.kill()
                p.wait()
        after = counters(n)
        nodes = [json.loads(f.read_text()) for f in wd.glob('node-*.json')]
        success = len(nodes) == n and all(x['known'] == n for x in nodes)
        complete = sorted(x['complete_s'] for x in nodes if x['complete_s'] is not None)
        report = {
            'backend': backend, 'nodes': n, 'loss_percent_per_direction': loss,
            'seconds_limit': timeout, 'success': success,
            'fully_converged_nodes': len(complete), 'node_reports': len(nodes),
            'all_converged_s': round(max(complete), 3) if success and complete else None,
            'median_converged_s': round(complete[len(complete)//2], 3) if complete else None,
            'min_known': min((x['known'] for x in nodes), default=0),
            'max_known': max((x['known'] for x in nodes), default=0),
            'aggregate_cpu_s': round(sum(x['cpu_s'] for x in nodes), 3),
            'aggregate_maxrss_mb': round(sum(x['maxrss_kb'] for x in nodes)/1024, 1)
        }
        report.update({f'net_bridge_{k}': after[k]-before[k] for k in before})
        (wd / 'summary.json').write_text(json.dumps(report, indent=2) + '\n')
        return report
    finally:
        (wd / 'stop').touch()
        for p in procs:
            if p.poll() is None:
                p.kill()
                p.wait()

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--sizes', default='10,30,100,200,300')
    p.add_argument('--losses', default='0,10')
    p.add_argument('--backends', default='gossip,zenoh,cyclone')
    p.add_argument('--timeout', type=float, default=22)
    p.add_argument('--output', default='discovery-results')
    a = p.parse_args()
    outdir = Path(a.output).resolve()
    outdir.mkdir(parents=True, exist_ok=True)
    if os.geteuid():
        raise SystemExit('root required for netns/veth/netem')
    results = []
    for n in [int(s) for s in a.sizes.split(',')]:
        avail = memory_available()
        if avail is not None and avail < n*15*1024*1024 + 500*1024*1024:
            row = {'nodes': n, 'status': 'SKIP',
                   'reason': 'estimated cgroup memory safety limit', 'available_bytes': avail}
            results.append(row)
            print(json.dumps(row), flush=True)
            continue
        try:
            prepare(n)
        except Exception as exc:
            row = {'nodes': n, 'status': 'ERROR', 'reason': str(exc)}
            results.append(row)
            print(json.dumps(row), flush=True)
            cleanup(n)
            continue
        try:
            for loss in [float(x) for x in a.losses.split(',')]:
                netem(n, loss)
                for backend in a.backends.split(','):
                    print(f'RUN {backend} N={n} loss={loss}%', flush=True)
                    try:
                        row = execute(n, backend, loss, a.timeout, outdir)
                        row['status'] = 'PASS' if row['success'] else 'FAIL'
                    except Exception as exc:
                        row = {'backend': backend, 'nodes': n,
                               'loss_percent_per_direction': loss, 'status': 'ERROR',
                               'reason': str(exc)}
                    results.append(row)
                    print(json.dumps(row), flush=True)
        finally:
            cleanup(n)
    (outdir / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
    with (outdir / 'results.csv').open('w', newline='') as f:
        fields = ['backend','nodes','loss_percent_per_direction','status','success',
                  'fully_converged_nodes','all_converged_s','median_converged_s',
                  'net_bridge_rx_bytes','net_bridge_tx_bytes','aggregate_cpu_s',
                  'aggregate_maxrss_mb','reason']
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(results)
    print('RESULTS_JSON=' + str(outdir/'results.json'), flush=True)

if __name__ == '__main__':
    main()
