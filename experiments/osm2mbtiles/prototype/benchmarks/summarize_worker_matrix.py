#!/usr/bin/env python3
"""Render Markdown summary from measured runner output (no guessed numbers)."""
import json
import statistics
import sys
from pathlib import Path

a=json.loads(Path(sys.argv[1]).read_text())
samples=a['samples']
lines=['# Seoul worker benchmark (measured, 2 repetitions per setting)', '',
       f"Input SHA256: `{a['protocol']['input_sha256']}`",'',
       f"OS: {a['host']['os']}; affinity CPUs: {a['host']['affinity_cpus']}; logical CPUs: {a['host']['logical_cpus']}",
       '', '|Engine|Workers|Repeated total (s)|Median total (s)|Repeated tile stage (s)|Peak PSS (MB)|CPU seconds (sampled)|Features|Tiles|',
       '|---|---:|---|---:|---|---|---|---:|---:|']
for engine in ('postgis','planetiler'):
    for n in a['protocol']['workers']:
        x=[s for s in samples if s['engine']==engine and s['workers']==n]
        if not x:continue
        total=[s['total_wall_sec'] for s in x]
        tile=[s['tiles']['wall_sec'] for s in x] if engine=='postgis' else [s['tiles']['seconds'] for s in x]
        pss=[max(s['import']['peak_process_tree_pss_mb'],s['tiles']['peak_process_tree_pss_mb']) for s in x] if engine=='postgis' else [s['end_to_end']['peak_process_tree_pss_mb'] for s in x]
        cpu=[s['import']['sampled_process_tree_cpu_sec']+s['tiles']['sampled_process_tree_cpu_sec'] for s in x] if engine=='postgis' else [s['end_to_end']['sampled_process_tree_cpu_sec'] for s in x]
        def fmt(v):return ', '.join(f'{t:.2f}' for t in v) if all(t is not None for t in v) else 'N/A'
        lines.append(f"|{engine}|{n}|{fmt(total)}|{statistics.median(total):.2f}|{fmt(tile)}|{fmt(pss)}|{fmt(cpu)}|{x[0]['output']['features']:,}|{x[0]['output']['tiles']}|")
lines.extend(['','PostGIS total includes *fresh vector-only import and tile phase* for each sample. Planetiler total is a full input-to-MBTiles run.',
              'Planetiler tile-only stage is N/A if the CLI log lacks unambiguous timestamped stage start/end markers.',
              'Peak PSS is sampled over the command subprocess tree and, for PostGIS, the PostgreSQL postmaster tree. RSS sums overcount shared pages.',
              'Both tools use the same PBF and bbox/zoom, but **different schema/filtering**: feature counts are not equal-output throughput.',
              'With a 4-vCPU GitHub-hosted runner, 8/16/32 requested workers oversubscribe the CPU; more workers does not mean more cores.'])
Path(sys.argv[2]).write_text('\n'.join(lines)+'\n')
print('WORKER_MATRIX_SUMMARY_WRITTEN',sys.argv[2])