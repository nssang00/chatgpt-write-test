#!/usr/bin/env python3
"""Real Seoul PBF PostGIS-worker vs Planetiler-thread scaling benchmark.

All eight settings are run twice, on one GitHub Actions runner, with identical
PBF, region, zoom, source schema and output checks. Each PostGIS run starts from
an empty GIS database; both engines start fresh outputs on every repeat.
Resource sample sums proportional set size (PSS), not inflated shared RSS.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import re
import shutil
import signal
import sqlite3
import subprocess
import sys
import time
from collections import defaultdict

import psutil

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import collections
import gzip
import mapbox_vector_tile


def mbtiles_stats(path):
    counts = collections.Counter()
    zooms = collections.Counter()
    with sqlite3.connect(path) as db:
        assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        metadata = dict(db.execute("SELECT name, value FROM metadata"))
        assert metadata.get("format") == "pbf", metadata
        for z, blob in db.execute("SELECT zoom_level, tile_data FROM tiles"):
            zooms[z] += 1
            raw = gzip.decompress(blob) if blob[:2] == b"\x1f\x8b" else blob
            for layer, record in mapbox_vector_tile.decode(raw).items():
                counts[layer] += len(record["features"])
    assert sum(zooms.values()) > 0
    return {'bytes': path.stat().st_size, 'tiles': sum(zooms.values()),
            'zooms': dict(sorted(zooms.items())), 'features': sum(counts.values()),
            'layer_counts': dict(sorted(counts.items())), 'sha256': sha256(path)}

BBOX = [127.015, 37.485, 127.075, 37.535]
ZOOM = [12, 15]
THREADS = [4, 8, 16, 32]


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def cgroup_limit(path):
    try:
        return pathlib.Path(path).read_text().strip()
    except OSError:
        return None


def pg_pid(pgdata):
    f = pathlib.Path(pgdata) / 'postmaster.pid'
    if f.exists():
        try:
            return int(f.read_text().splitlines()[0])
        except (IndexError, ValueError):
            pass
    return None


def cpu_usage(p):
    t = p.cpu_times()
    return t.user + t.system


def resource_sample(process, pgdata):
    # Include Python main, its tile workers, and the separate PostgreSQL server.
    roots = [process.pid]
    pid = pg_pid(pgdata) if pgdata is not None else None
    if pid:
        roots.append(pid)
    pids = {}
    for root in roots:
        try:
            proc = psutil.Process(root)
            for member in [proc, *proc.children(recursive=True)]:
                pids[member.pid] = member
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    rss, pss, cpu = 0, 0, {}
    for pid, p in pids.items():
        try:
            info = p.memory_full_info()
            rss += info.rss
            pss += getattr(info, 'pss', info.rss)
            cpu[(pid, p.create_time())] = cpu_usage(p)
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            pass
    return rss, pss, cpu, len(pids)


def measured(cmd, *, cwd, logpath, timeout, pgdata=None, env=None):
    start = time.monotonic()
    max_rss = max_pss = max_procs = 0
    tracked_cpu = {}
    # PostgreSQL survives across variants; subtract CPU accrued before each run.
    # Otherwise later variants inherit accumulated PostgreSQL CPU from earlier ones.
    preexisting_cpu = {}
    if pgdata is not None:
        pgroot = pg_pid(pgdata)
        if pgroot is not None:
            try:
                root = psutil.Process(pgroot)
                for child in [root, *root.children(recursive=True)]:
                    try:
                        preexisting_cpu[(child.pid, child.create_time())] = cpu_usage(child)
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        pass
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
    proc = None
    code = None
    timed_out = False
    with open(logpath, 'w', encoding='utf-8') as log:
        log.write('COMMAND: ' + ' '.join(map(str, cmd)) + '\n')
        log.flush()
        proc = subprocess.Popen([str(s) for s in cmd], cwd=str(cwd), env=env,
                                stdout=log, stderr=subprocess.STDOUT,
                                start_new_session=True)
        try:
            while True:
                rss, pss, cpu, n = resource_sample(proc, pgdata)
                max_rss = max(max_rss, rss)
                max_pss = max(max_pss, pss)
                max_procs = max(max_procs, n)
                for key, seconds in cpu.items():
                    tracked_cpu[key] = max(seconds, tracked_cpu.get(key, 0))
                code = proc.poll()
                if code is not None:
                    break
                if time.monotonic() - start > timeout:
                    timed_out = True
                    os.killpg(proc.pid, signal.SIGKILL)
                    code = proc.wait()
                    break
                time.sleep(.12)
        finally:
            if proc.poll() is None:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait()
    wall = round(time.monotonic() - start, 3)
    cpu_total = round(sum(max(0.0, seconds - preexisting_cpu.get(key, 0.0))
                          for key, seconds in tracked_cpu.items()), 3)
    return {'wall_seconds': wall, 'cpu_seconds_sampled': cpu_total,
            'avg_cpu_cores_sampled': round(cpu_total/max(wall, .001), 3),
            'peak_pss_mib_sampled': round(max_pss/1048576, 2),
            'peak_sum_rss_mib_sampled': round(max_rss/1048576, 2),
            'max_processes_sampled': max_procs,
            'returncode': code, 'timed_out': timed_out, 'log': str(logpath)}


def required(cmd, *, cwd, logpath, timeout=90, pgdata=None, env=None):
    x = measured(cmd, cwd=cwd, logpath=logpath, timeout=timeout,
                 pgdata=pgdata, env=env)
    if x['returncode'] != 0:
        print('BENCH_COMMAND_FAILED', x, flush=True)
        print(pathlib.Path(logpath).read_text(errors='replace')[-4000:], flush=True)
        raise RuntimeError(f'{cmd[0]} failed, see {logpath}')
    return x


def pg_setup(work, project):
    pgdata = work/'pgdata'
    sock = work/'socket'
    sock.mkdir(exist_ok=True)
    env = dict(os.environ,
               PGHOST=str(sock), PGPORT='55467', PGUSER='scaleosm', PGDATABASE='gis',
               PYTHONPATH=str(project/'src'), OSM2MBTILES_VECTOR_QUERY_MODE='projected',
               PATH='/usr/lib/postgresql/16/bin:'+os.environ.get('PATH', ''))
    subprocess.run(['initdb', '-D', str(pgdata), '-U', env['PGUSER'],
                    '--auth-local=trust', '--auth-host=trust'],
                   env=env, check=True, stdout=subprocess.DEVNULL)
    subprocess.run(['pg_ctl', '-D', str(pgdata), '-l', str(work/'postgres.log'), '-w',
                    '-o', f"-c listen_addresses='' -c unix_socket_directories={sock} -c port=55467 -c shared_buffers=64MB -c work_mem=4MB -c maintenance_work_mem=64MB -c max_parallel_maintenance_workers=0 -c jit=off",
                    'start'], env=env, check=True, stdout=subprocess.DEVNULL)
    return env, pgdata


def clean_pg(env, work, pgdata, pbf, project, repeat, workers):
    key = f'postgis-r{repeat}-w{workers}'
    # Include DB reset + extensions in import time to accurately model fresh imports.
    import_log = work/f'{key}-import.log'
    command = ['bash', '-euc', '''
      dropdb --if-exists gis
      createdb gis
      psql -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION postgis; CREATE EXTENSION hstore;'
      osm2pgsql --slim --drop --cache=256 --number-processes=4 -O flex \
         -S "$PROJECT/vector/vector-flex.lua" -d gis "$INPUT"
      psql -v ON_ERROR_STOP=1 -f "$PROJECT/vector/post-import.sql"
      ''']
    measured_env = dict(env, PROJECT=str(project), INPUT=str(pbf))
    imported = required(command, cwd=work, logpath=import_log,
                        timeout=210, pgdata=pgdata, env=measured_env)
    file = work/f'{key}.mbtiles'
    job = work/f'{key}.json'
    job.write_text(json.dumps({'pbf':str(pbf), 'output':str(file),
                               'bbox':BBOX, 'minzoom':ZOOM[0],
                               'maxzoom':ZOOM[1], 'processes':workers}))
    tiles = measured(['/usr/bin/python3',str(project/'src/osm2mbtiles/vector_worker.py'),str(job)],
                     cwd=work, logpath=work/f'{key}-tiles.log', timeout=240,
                     pgdata=pgdata, env=measured_env)
    result = {'engine':'postgis','workers':workers,'repeat':repeat,'import':imported,'tiles':tiles,
              'full_wall_seconds':round(imported['wall_seconds']+tiles['wall_seconds'],3),
              'full_cpu_seconds_sampled':round(imported['cpu_seconds_sampled']+tiles['cpu_seconds_sampled'],3),
              'full_peak_pss_mib_sampled':max(imported['peak_pss_mib_sampled'],tiles['peak_pss_mib_sampled']),
              'success':tiles['returncode']==0}
    if result['success']:
        result['output']=mbtiles_stats(file)
        file.unlink()
    return result


def planetiler(work, project, pbf, repeat, threads):
    key = f'planetiler-r{repeat}-w{threads}'
    out = work/f'{key}.mbtiles'
    cmd = ['java','-Xmx3g','-jar',str(work/'planetiler.jar'),'generate-custom',
           f'--schema={project}/benchmarks/seoul-planetiler.yml',
           f'--output={out}',
           f'--bounds={",".join(map(str,BBOX))}',
           f'--minzoom={ZOOM[0]}',f'--maxzoom={ZOOM[1]}',
           f'--threads={threads}', '--force']
    timed = measured(cmd,cwd=work,logpath=work/f'{key}.log',timeout=300)
    result={'engine':'planetiler','workers':threads,'repeat':repeat,
            'full_wall_seconds':timed['wall_seconds'],
            'full_cpu_seconds_sampled':timed['cpu_seconds_sampled'],
            'full_peak_pss_mib_sampled':timed['peak_pss_mib_sampled'],
            'full':timed,'success':timed['returncode']==0}
    if result['success']:
        result['output']=mbtiles_stats(out)
        out.unlink()
    return result


def aggregate(results):
    import statistics
    groups=defaultdict(list)
    for r in results:
        groups[(r['engine'],r['workers'])].append(r)
    summary={}
    for (engine,workers),rows in sorted(groups.items()):
        good=[r for r in rows if r['success']]
        o={'runs':len(rows),'successes':len(good),
           'feature_counts':[r['output']['features'] for r in good],
           'tile_counts':[r['output']['tiles'] for r in good],
           'full_wall_seconds':[r['full_wall_seconds'] for r in good],
           'cpu_seconds_sampled':[r['full_cpu_seconds_sampled'] for r in good],
           'peak_pss_mib_sampled':[r['full_peak_pss_mib_sampled'] for r in good]}
        if engine=='postgis':
            o['tile_generation_seconds']=[r['tiles']['wall_seconds'] for r in good]
            o['import_seconds']=[r['import']['wall_seconds'] for r in good]
            o['tile_cpu_seconds_sampled']=[r['tiles']['cpu_seconds_sampled'] for r in good]
            o['tile_peak_pss_mib_sampled']=[r['tiles']['peak_pss_mib_sampled'] for r in good]
        else:
            o['tile_generation_seconds']=None
            o['note']='Planetiler performs input read, feature processing, tile encoding and MBTiles writing in a single invocation.'
        for k in ('full_wall_seconds','tile_generation_seconds','import_seconds'):
            if o.get(k):
                o[k+'_median']=round(statistics.median(o[k]),3)
        summary[f'{engine}_{workers}']=o
    return summary


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--project',type=pathlib.Path,required=True)
    p.add_argument('--work',type=pathlib.Path,required=True)
    p.add_argument('--evidence',type=pathlib.Path,required=True)
    p.add_argument('--repeats',type=int,default=2)
    args=p.parse_args()
    work=args.work.resolve(); project=args.project.resolve(); evidence=args.evidence.resolve()
    evidence.mkdir(parents=True,exist_ok=True)
    pbf=work/'seoul.osm.pbf'
    assert pbf.is_file() and pbf.stat().st_size>10_000_000
    assert (work/'planetiler.jar').is_file()
    hardware={'logical_cpus':psutil.cpu_count(),'affinity_cpus':len(os.sched_getaffinity(0)),
              'cgroup_cpu_max':cgroup_limit('/sys/fs/cgroup/cpu.max'),
              'cgroup_memory_max':cgroup_limit('/sys/fs/cgroup/memory.max'),
              'mem_total_gib':round(psutil.virtual_memory().total/1073741824,2)}
    print('BENCHMARK_RUNNER_HARDWARE',json.dumps(hardware),flush=True)
    meta={'input_sha256':sha256(pbf),'input_bytes':pbf.stat().st_size,
          'bbox':BBOX,'zoom':ZOOM,'repeats':args.repeats,
          'planetiler_version':'v0.10.2','planetiler_jvm_heap':'3GiB',
          'postgis_import_processes':4,'postgis_query_mode':'projected',
          'runner':hardware,
          'notes':['CPU and PSS are sample-based estimates: PID trees plus PostgreSQL server for PostGIS; Java process tree for Planetiler.',
                   'PSS is proportional RSS accounting for shared pages. PostgreSQL data memory and Python worker memory are both counted.',
                   'PostGIS tile time excludes fresh database import. PostGIS full time is fresh database reset+import+tile build. PostgreSQL server startup excluded.',
                   'Planetiler is an integrated pipeline: there is no separately timed tile-encoding stage in this benchmark.',
                   'Planetiler YAML approximate schema is NOT equal to PostGIS SQL schema; compare feature counts; not apples-to-apples throughput.',
                   'Both engines use same PBF / bbox / zoom, but their output content differs.',
                   'A single hosted runner tests all settings in alternating order; cache effects may remain.']}
    results=[]
    (evidence/'input.sha256').write_text(meta['input_sha256']+'  '+str(pbf)+'\n')
    (evidence/'environment.json').write_text(json.dumps(meta,indent=2)+'\n')
    env,pgdata=pg_setup(work,project)
    try:
        for repeat in range(1,args.repeats+1):
            order=THREADS if repeat%2 else list(reversed(THREADS))
            for workers in order:
                print('BENCH_START',json.dumps({'engine':'postgis','workers':workers,'repeat':repeat}),flush=True)
                try:
                    result=clean_pg(env,work,pgdata,pbf,project,repeat,workers)
                except Exception as exc:
                    result={'engine':'postgis','workers':workers,'repeat':repeat,'success':False,'error':repr(exc)}
                results.append(result)
                print('BENCH_RESULT',json.dumps(result),flush=True)
                (evidence/'runs.json').write_text(json.dumps(results,indent=2)+'\n')
    finally:
        subprocess.run(['pg_ctl','-D',str(pgdata),'-m','fast','-w','stop'],
                       env=env,stdout=subprocess.DEVNULL,check=False)
    for repeat in range(1,args.repeats+1):
        order=THREADS if repeat%2 else list(reversed(THREADS))
        for workers in order:
            print('BENCH_START',json.dumps({'engine':'planetiler','workers':workers,'repeat':repeat}),flush=True)
            try:
                result=planetiler(work,project,pbf,repeat,workers)
            except Exception as exc:
                result={'engine':'planetiler','workers':workers,'repeat':repeat,'success':False,'error':repr(exc)}
            results.append(result)
            print('BENCH_RESULT',json.dumps(result),flush=True)
            (evidence/'runs.json').write_text(json.dumps(results,indent=2)+'\n')
    report={'metadata':meta,'summary':aggregate(results),'runs':results}
    (evidence/'results.json').write_text(json.dumps(report,indent=2)+'\n')
    lines=['## Seoul PostGIS vs Planetiler 4/8/16/32 scaling (2 repetitions)',
           '',f"Input SHA256: `{meta['input_sha256']}`; BBOX `{BBOX}`, zoom {ZOOM[0]}–{ZOOM[1]}",
           '',f"Runner logical CPUs: {hardware['logical_cpus']}; affinity: {hardware['affinity_cpus']}; cgroup CPU: {hardware['cgroup_cpu_max']}; cgroup memory: {hardware['cgroup_memory_max']}",
           '', '| Engine | Workers | Full time median (s) | Tile phase median (s) | CPU seconds samples | Peak PSS MiB | MVT features | Success |',
           '|---|---:|---:|---:|---|---|---:|---|']
    for key,r in report['summary'].items():
        def val(k):
            a=r.get(k)
            if a is None:return 'N/A'
            return str(a)
        features=', '.join(map(str,r['feature_counts']))
        lines.append(f"| {key.split('_')[0]} | {key.split('_')[1]} | {val('full_wall_seconds_median')} | {val('tile_generation_seconds_median')} | {val('cpu_seconds_sampled')} | {val('peak_pss_mib_sampled')} | {features} | {r['successes']}/{r['runs']} |")
    lines+=['','Planetiler tile-phase time is **N/A** because Planetiler end-to-end includes data ingestion and tile writing in the same invocation.',
            'Schemas differ; feature counts are required context for timing interpretation.',
            'CPU and PSS are sampled estimates, not hardware-profiler exact measurements.']
    (evidence/'summary.md').write_text('\n'.join(lines)+'\n')
    print('BENCHMARK_SUMMARY',json.dumps(report['summary']),flush=True)
    if any(r['successes']!=args.repeats for r in report['summary'].values()):
        raise RuntimeError('One or more variants failed; see results.json and logs')
    for eng in ['postgis','planetiler']:
        counts=[set(report['summary'][f'{eng}_{t}']['feature_counts']) for t in THREADS]
        if len(set.union(*counts))!=1:
            raise RuntimeError(f'Feature count not stable within {eng}: {counts}')
    print('WORKER_SCALING_BENCHMARK_SUCCESS',flush=True)


if __name__=='__main__':
    main()