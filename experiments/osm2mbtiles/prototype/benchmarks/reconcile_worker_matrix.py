#!/usr/bin/env python3
"""Reconstruct Planetiler's tile archive phase from retained benchmark logs.

Only a trusted runner log stage line is used. Never substitute end-to-end time.
Produces a self-contained result JSON with original unmodified observations.
"""
from __future__ import annotations

import json
from pathlib import Path
import re
import statistics
import sys


def archive_stage(log:Path):
    if not log.is_file():
        return None,'missing retained raw log'
    data=re.sub(r'\x1b\[[0-9;]*m','',log.read_text(errors='replace'))
    # v0.10.2 prints `INF [archive] -   archive   1s cpu:4s avg:3.7`.
    pat=r'(?m)^.*?INF \[archive\] -\s*archive\s+(\d+(?:\.\d+)?)s\s+cpu:'
    found=re.findall(pat,data)
    if not found:
        return None,'Planetiler self-reported archive phase not present'
    return float(found[-1]), 'Planetiler v0.10.2 self-reported archive phase (rounded seconds)'


def main():
    src=Path(sys.argv[1]).resolve();dest=Path(sys.argv[2]).resolve()
    a=json.loads(src.read_text())
    missing=[]
    for sample in a['samples']:
        if sample['engine'] != 'planetiler':continue
        tag=f"r{sample['repeat']}-planetiler-{sample['workers']}"
        sec,method=archive_stage(src.parent/f'{tag}-planetiler.log')
        sample['tiles']={'seconds':sec,'method':method}
        if sec is None:missing.append(tag)
    a['protocol']['planetiler_tile_phase']='Planetiler archive stage (encode tiles + write MBTiles), from retained self-reported log; rounded duration; NOT PBF decode or sorting'
    a['reconciliation']={'logs_analyzed':8,'missing':missing,'original_benchmark_samples':len(a['samples'])}
    dest.write_text(json.dumps(a,ensure_ascii=False,indent=2)+'\n')
    from subprocess import run
    sm=dest.with_name('summary.md')
    run([sys.executable,str(Path(__file__).with_name('summarize_worker_matrix.py')),str(dest),str(sm)],check=True)
    print(sm.read_text())
    print('RECONCILED_WORKER_MATRIX',json.dumps({
        'sample_count':len(a['samples']),
        'phase_count':8-len(missing),'missing':missing,
        'planetiler_archives':{str(n):[s['tiles']['seconds'] for s in a['samples']
                              if s['engine']=='planetiler' and s['workers']==n]
                              for n in a['protocol']['workers']}},ensure_ascii=False))
    assert not missing,f'Planetiler archive logs missing stage: {missing}'
    print('RECONCILED_MATRIX_SUCCESS')

if __name__=='__main__':main()