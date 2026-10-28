#!/usr/bin/env python3
"""Reproducible vector worker scaling matrix on ephemeral GitHub Actions PostgreSQL.

Requirements: Linux, running isolated PostgreSQL with PGHOST/PGPORT/PGUSER,
PostGIS 3, osm2pgsql, Java 25, Planetiler pinned jar, Python psutil,
mapbox_vector_tile. Never touches production databases.
"""
from __future__ import annotations

import argparse
import collections
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import threading
import time

import mapbox_vector_tile
import psutil

BBOX = (127.015, 37.485, 127.075, 37.535)
ZOOMS = (12, 15)
WORKERS = (4, 8, 16, 32)
TIMEOUT = 600


def run_checked(cmd, *, cwd=None, env=None):
    subprocess.run(list(map(str, cmd)), check=True, cwd=cwd, env=env)


def mbtiles_stats(path: Path):
    counts = collections.Counter()
    zooms = collections.Counter()
    with sqlite3.connect(path) as db:
        assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok', path
        assert dict(db.execute('SELECT name,value FROM metadata')).get('format') == 'pbf', path
        tiles = db.execute('SELECT zoom_level,tile_data FROM tiles').fetchall()
        assert tiles, f'Empty output: {path}'
        for z, data in tiles:
            zooms[z] += 1
            tile = mapbox_vector_tile.decode(gzip.decompress(data) if data[:2] == b'\x1f\x8b' else data)
            for layer, features in tile.items():
                counts[layer] += len(features['features'])
    return {'tiles':len(tiles),'features':sum(counts.values()),
            'zooms':dict(sorted(zooms.items())), 'layers':dict(sorted(counts.items())),
            'bytes':path.stat().st_size}


def mem_pss(proc):
    try:
        info=proc.memory_full_info()
        return getattr(info,'pss',info.rss), info.rss
    except (psutil.Error, OSError):
        return 0,0


def tracked_processes(root_pid, postgres_master):
    found={}
    for root in [root_pid, postgres_master]:
        if root is None:
            continue
        try:
            proc=psutil.Process(root)
            for child in [proc]+proc.children(recursive=True):
                found[child.pid]=child
        except (psutil.Error,OSError):
            pass
    return list(found.values())


def monitor_run(name,cmd,work,*,postgres_master=None,cwd=None,env=None,timeout=TIMEOUT):
    """Monitor subprocess + postgres backend tree; record wall, CPU and PSS.

    Sampling may miss very short-lived processes. CPU seconds from /usr/bin/time
    are therefore also reported as a separate command-only ground truth.
    """
    log=work/(name+'.log')
    timing=work/(name+'.time')
    fmt='COMMAND_WALL_SEC=%e\\nCOMMAND_USER_CPU_SEC=%U\\nCOMMAND_SYS_CPU_SEC=%S\\nCOMMAND_MAX_RSS_KB=%M'
    command=['/usr/bin/time','-f',fmt,'-o',str(timing),*map(str,cmd)]
    snap_cpu={}
    sum_cpu=0.0
    peak_pss=peak_rss=peak_processes=0
    samps=0
    start=time.perf_counter()
    with log.open('w') as output:
        p=subprocess.Popen(command,stdout=output,stderr=subprocess.STDOUT,
                           cwd=cwd,env=env,start_new_session=True)
        try:
            while p.poll() is None:
                pss=rss=0
                processes=tracked_processes(p.pid,postgres_master)
                for q in processes:
                    try:
                        times=q.cpu_times()
                        now=times.user+times.system
                        old=snap_cpu.get(q.pid,now)
                        sum_cpu += max(0.0,now-old)
                        snap_cpu[q.pid]=now
                        a,b=mem_pss(q)
                        pss+=a;rss+=b
                    except (psutil.Error,OSError):
                        continue
                peak_pss=max(peak_pss,pss)
                peak_rss=max(peak_rss,rss)
                peak_processes=max(peak_processes,len(processes))
                samps+=1
                if time.perf_counter()-start>timeout:
                    p.kill()
                    raise TimeoutError(f'{name} exceeded {timeout}s; see {log}')
                time.sleep(0.15)
            rc=p.wait()
        finally:
            if p.poll() is None:
                p.kill();p.wait()
    wall=time.perf_counter()-start
    if rc:
        tail='\n'.join(log.read_text(errors='replace').splitlines()[-65:])
        raise RuntimeError(f'{name}: exit {rc}\n{tail}')
    raw=timing.read_text()
    def tm(key):
        m=re.search(re.escape(key)+r'=([0-9.]+)',raw)
        return float(m.group(1)) if m else None
    return {'wall_sec':round(wall,3),
            'command_wall_sec':tm('COMMAND_WALL_SEC'),
            'command_cpu_sec':round((tm('COMMAND_USER_CPU_SEC') or 0)+(tm('COMMAND_SYS_CPU_SEC') or 0),3),
            'sampled_process_tree_cpu_sec':round(sum_cpu,3),
            'peak_process_tree_pss_mb':round(peak_pss/1048576,1),
            'peak_process_tree_rss_sum_mb':round(peak_rss/1048576,1),
            'command_max_rss_mb':round((tm('COMMAND_MAX_RSS_KB') or 0)/1024,1),
            'peak_processes':peak_processes,'samples':samps,
            'log':str(log.name)}


def parse_planetiler_tile_phase(log:Path):
    """Only report if stage boundary is unambiguously present in actual logs."""
    s=log.read_text(errors='replace')
    # Planetiler's summary uses format ' 0:00:02 ...' (timestamps elapsed).
    patterns=[r'(?im)^\s*(\d+:\d+:\d+(?:\.\d+)?)\s+\w+\s+-\s+.*(?:starting|start|writing|write).*?(?:output|mbtiles).*?tiles',
              r'(?im)^\s*(\d+:\d+:\d+(?:\.\d+)?)\s+\w+\s+-\s+.*(?:finished|done|complete).*?(?:output|mbtiles).*?tiles']
    matched=[]
    for pattern in patterns:
        hits=re.findall(pattern,s)
        if not hits:return {'seconds':None,'method':'unavailable: no confirmed tile-stage start/end log markers'}
        matched.append(hits)
    def seconds(hms):
        a=hms.split(':');return 3600*float(a[0])+60*float(a[1])+float(a[2])
    result=seconds(matched[1][-1])-seconds(matched[0][0])
    if not 0<=result<10000:
        return {'seconds':None,'method':'unavailable: inconsistent stage timestamps'}
    return {'seconds':round(result,3),'method':'Planetiler elapsed log stage markers'}


def record(report_path,report):
    report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--project',type=Path,required=True)
    ap.add_argument('--work',type=Path,required=True)
    ap.add_argument('--planetiler',type=Path,required=True)
    ap.add_argument('--input',type=Path,required=True)
    ap.add_argument('--repeats',type=int,default=2)
    a=ap.parse_args()
    assert a.repeats>=2
    project=a.project.resolve(); work=a.work.resolve();work.mkdir(parents=True,exist_ok=True)
    pbf=a.input.resolve();jar=a.planetiler.resolve()
    assert pbf.is_file() and jar.is_file()
    sha=hashlib.sha256(pbf.read_bytes()).hexdigest()
    report={'protocol':{'bbox':BBOX,'minzoom':ZOOMS[0],'maxzoom':ZOOMS[1],
            'input_sha256':sha,'input_bytes':pbf.stat().st_size,
            'repeats':a.repeats,'workers':WORKERS,
            'postgis_query_mode':'projected',
            'postgis_import':'fast: osm2pgsql --number-processes=4, parallel indexes, cluster=no; independent fresh import EACH sample',
            'planetiler_version':'v0.10.2','planetiler_heap':'3GiB',
            'warning':'Planetiler custom YAML vs PostGIS SQL are not exact equivalent schemas',
            'memory':'peak sampled process-tree PSS includes PostgreSQL server for PostGIS; RSS sum double counts shared pages',
            'cpu':'sampled process-tree CPU seconds; 150ms samples may underestimate CPU in short-lived children',
            'planetiler_tile_phase':'only if unambiguous log markers; otherwise null'},
            'host':{'os':sys.platform,'logical_cpus':psutil.cpu_count(),
                    'affinity_cpus':len(psutil.Process().cpu_affinity()),
                    'ram_available_bytes_at_start':psutil.virtual_memory().available},
            'samples':[]}
    out=work/'results.json'
    record(out,report)
    env=os.environ.copy()
    env['PYTHONPATH']=str(project/'src')
    env['OSM2MBTILES_VECTOR_QUERY_MODE']='projected'
    schema=project/'benchmarks/seoul-planetiler.yml'
    assert schema.is_file()
    master=psutil.Process(int((work/'pgdata/postmaster.pid').read_text().splitlines()[0])).pid
    no_cluster=(work/'vector-no-cluster.lua')
    style=(project/'vector/vector-flex.lua').read_text()
    assert style.count('\n})\n')>=4,'Unrecognized vector Lua syntax'
    no_cluster.write_text(style.replace('\n})\n','\n}, { cluster = "no" })\n',4))
    runs=[]
    for repeat in range(1,a.repeats+1):
        workers=list(WORKERS) if repeat%2 else list(reversed(WORKERS))
        engines=['postgis','planetiler'] if repeat%2 else ['planetiler','postgis']
        for n in workers:
            for engine in engines:
                runs.append((repeat,engine,n))
    print('MATRIX_START',json.dumps({'runs':runs,'input_sha256':sha}),flush=True)
    try:
        for repeat,engine,n in runs:
            tag=f'r{repeat}-{engine}-{n}'
            print(f'::group::BENCH {tag}',flush=True)
            print('BEGIN_BENCH',tag,flush=True)
            path=work/f'{tag}.mbtiles'
            if engine=='postgis':
                run_checked(['dropdb','--if-exists','--force','gis'],env=env)
                run_checked(['createdb','gis'],env=env)
                run_checked(['psql','-v','ON_ERROR_STOP=1','-c','CREATE EXTENSION postgis; CREATE EXTENSION hstore;'],env=env)
                import_metrics=monitor_run(tag+'-import',[
                    'bash','-eo','pipefail','-c',
                    'osm2pgsql --slim --drop --cache=256 --number-processes=4 -O flex -S "$1" -d gis "$2" && psql -v ON_ERROR_STOP=1 -f "$3"',
                    '_',no_cluster,pbf,project/'vector/post-import.sql'],work,
                    postgres_master=master,env=env,timeout=240)
                job=work/(tag+'.job.json')
                job.write_text(json.dumps({'pbf':str(pbf),'output':str(path),'bbox':BBOX,
                                           'minzoom':ZOOMS[0],'maxzoom':ZOOMS[1],
                                           'processes':n}))
                tiles_metrics=monitor_run(tag+'-tiles',[
                    '/usr/bin/python3',project/'src/osm2mbtiles/vector_worker.py',job],work,
                    postgres_master=master,env=env)
                run_checked(['/usr/bin/python3','-m','osm2mbtiles','verify-vector',path],env=env)
                total=round(import_metrics['wall_sec']+tiles_metrics['wall_sec'],3)
                obj={'repeat':repeat,'engine':engine,'workers':n,'import':import_metrics,
                     'tiles':tiles_metrics,'total_wall_sec':total,
                     'output':mbtiles_stats(path)}
            else:
                tmp=work/(tag+'-temp');tmp.mkdir(exist_ok=True)
                # Source filename is resolved relative to the profile/work CWD.
                local_source=tmp/'seoul.osm.pbf';local_source.symlink_to(pbf)
                m=monitor_run(tag+'-planetiler',[
                    'java','-Xmx3g','-jar',jar,'generate-custom',
                    '--schema='+str(schema),'--output='+str(path),
                    '--bounds='+','.join(map(str,BBOX)),
                    '--minzoom='+str(ZOOMS[0]),'--maxzoom='+str(ZOOMS[1]),
                    '--threads='+str(n), '--tmpdir='+str(tmp/'intermediate'),
                    '--force'],work,postgres_master=None,cwd=tmp,env=env)
                obj={'repeat':repeat,'engine':engine,'workers':n,'import':None,
                     'tiles':parse_planetiler_tile_phase(work/(tag+'-planetiler.log')),
                     'total_wall_sec':m['wall_sec'],'end_to_end':m,
                     'output':mbtiles_stats(path)}
            report['samples'].append(obj)
            record(out,report)
            print('BENCH_SAMPLE',json.dumps(obj,ensure_ascii=False),flush=True)
            print('::endgroup::',flush=True)
            # MBTiles output no longer required after decoding; do not leak disk
            # across attempts. Planetiler internals are isolated by tmpdir.
            path.unlink()
            if engine=='planetiler':shutil.rmtree(tmp,ignore_errors=True)
    except BaseException:
        record(out,report)
        raise
    # Feature counts / nonempty tile count are independent of worker setting.
    for engine in ('postgis','planetiler'):
        group=[s for s in report['samples'] if s['engine']==engine]
        assert len(group)==len(WORKERS)*a.repeats,(engine,len(group))
        baseline=(group[0]['output']['tiles'],group[0]['output']['features'],group[0]['output']['layers'])
        for s in group:
            actual=(s['output']['tiles'],s['output']['features'],s['output']['layers'])
            assert actual==baseline,f'{engine} output changed between workers: {s["workers"]}'
    print('WORKER_MATRIX_SUCCESS',json.dumps({'count':len(report['samples']),'sha256':sha}),flush=True)


if __name__=='__main__':
    main()