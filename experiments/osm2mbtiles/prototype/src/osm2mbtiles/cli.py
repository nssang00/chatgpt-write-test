"""CLI orchestration: automatic local DB lifecycle, import, raster render, cleanup."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path
from .pbf import read_bbox, PBFError
from .runtime import Runtime, LocalDatabase, PipelineError, file_digest, run
from .tiles import validate_bbox, tile_count, metatiles
from .validate import inspect, compare, ValidationError

MAX_TILES = 2_000_000

def arguments(argv=None):
    p = argparse.ArgumentParser(prog='osm2mbtiles',description='Docker-free OSM Carto → raster MBTiles exporter')
    sub = p.add_subparsers(dest='action')
    doctor = sub.add_parser('doctor',help='check packaged native runtime')
    doctor.add_argument('--runtime',type=Path)
    verify = sub.add_parser('verify',help='check PNG MBTiles integrity and tile coordinates')
    verify.add_argument('file',type=Path)
    cmp = sub.add_parser('compare',help='compare two raster MBTiles tile-for-tile')
    cmp.add_argument('reference',type=Path)
    cmp.add_argument('candidate',type=Path)
    cmp.add_argument('--pixels',action='store_true',help='compare decoded PNG pixels (Pillow required)')
    export = sub.add_parser('convert',help='convert an OSM PBF file to raster MBTiles')
    export.add_argument('pbf',type=Path)
    export.add_argument('-z','--zoom',default='0-15',help='zoom range, e.g. 0-15')
    export.add_argument('-o','--output',type=Path,required=True)
    export.add_argument('--bbox',help='west,south,east,north (otherwise from PBF header)')
    export.add_argument('--runtime',type=Path,help='prepared native runtime folder')
    export.add_argument('--workdir',type=Path,help='persist intermediate database for subsequent runs')
    export.add_argument('--force',action='store_true',help='replace existing output')
    export.add_argument('--dry-run',action='store_true',help='show planned tile counts without runtime')
    export.add_argument('--max-tiles',type=int,default=MAX_TILES,help='safety limit on selected tiles')
    export.add_argument('--buffer',type=int,default=128,help='Mapnik rendering buffer (pixels)')
    export.add_argument('--metatile',type=int,default=8,help='metatile edge length (tiles)')
    # Backwards-compatible one-command CLI without 'convert' keyword.
    if argv is None:
        argv = sys.argv[1:]
    if argv and argv[0] not in ('convert','doctor','verify','compare','-h','--help'):
        argv = ['convert',*argv]
    return p.parse_args(argv),p

def parse_zoom(text):
    try:
        a,b = text.split('-',1) if '-' in text else (text,text)
        lo,hi=int(a),int(b)
    except (TypeError, ValueError) as exc:
        raise ValueError('--zoom must look like 0-15') from exc
    if not 0 <= lo <= hi <= 22:
        raise ValueError('zoom range must be between 0 and 22')
    return lo,hi

def get_runtime(arg):
    home = os.environ.get('OSM2MBTILES_RUNTIME')
    default = Path(sys.executable).resolve().parent/'runtime' if getattr(sys,'frozen',False) else Path(__file__).resolve().parents[2]/'runtime'
    return Runtime(Path(arg or home or default).expanduser().resolve())

def _job_key(pbf_digest,style,bbox,lo,hi,buffer,meta):
    # Full hashing only occurs after preflight, not in dry-run.
    fields = [pbf_digest,file_digest(style/'openstreetmap-carto-flex.lua'),
              file_digest(style/'project.xml'),str(bbox),str(lo),str(hi),str(buffer),str(meta)]
    return hashlib.sha256('|'.join(fields).encode()).hexdigest()

def _import_key(pbf_digest,style):
    files = [style/'openstreetmap-carto-flex.lua',style/'indexes.sql',
             style/'functions.sql',style/'common-values.sql']
    return hashlib.sha256('|'.join([pbf_digest] + [file_digest(p) for p in files]).encode()).hexdigest()

def _worker_path():
    # PyInstaller onefile also extracts package python sources under _MEIPASS.
    if getattr(sys,'frozen',False):
        return Path(sys._MEIPASS)/'osm2mbtiles'/'worker.py'
    return Path(__file__).with_name('worker.py')

def convert(args):
    pbf = args.pbf.expanduser().resolve()
    if not pbf.is_file():
        raise PipelineError(f'Input PBF not found: {pbf}')
    lo,hi = parse_zoom(args.zoom)
    if args.buffer < 0 or args.buffer > 1024 or not 1 <= args.metatile <= 32:
        raise PipelineError('--buffer must be 0..1024, --metatile 1..32')
    bbox = validate_bbox(tuple(float(x) for x in args.bbox.split(','))) if args.bbox else read_bbox(pbf)
    count = tile_count(bbox,lo,hi)
    if count > args.max_tiles:
        raise PipelineError(f'Too many tiles ({count:,} > {args.max_tiles:,}); set --max-tiles explicitly to allow')
    metas = sum(1 for _ in metatiles(bbox,lo,hi,args.metatile))
    print(f'bbox={bbox}, zoom={lo}-{hi}, tiles={count:,}, metatiles={metas:,}',flush=True)
    if args.dry_run:
        return
    out = args.output.expanduser().resolve()
    if out.exists() and not args.force:
        raise PipelineError(f'Output already exists: {out}; use --force to replace')
    runtime = get_runtime(args.runtime)
    runtime.validate()
    if args.workdir:
        work = args.workdir.expanduser().resolve()
        if work.is_dir() and any(work.iterdir()) and not (work/'.osm2mbtiles-workspace').is_file():
            raise PipelineError('--workdir is nonempty and not owned by osm2mbtiles')
        work.mkdir(parents=True,exist_ok=True)
        run_pipeline(pbf,out,bbox,lo,hi,args,work,runtime)
    else:
        with tempfile.TemporaryDirectory(prefix='osm2mbtiles-') as tmp:
            run_pipeline(pbf,out,bbox,lo,hi,args,Path(tmp),runtime)

def run_pipeline(pbf,out,bbox,lo,hi,args,work,runtime):
    # Persisted work directory never receives bare contents from other projects.
    work.mkdir(parents=True,exist_ok=True)
    (work/'.osm2mbtiles-workspace').touch(exist_ok=True)
    style = work / 'style'
    source_style = runtime.style
    style_inputs = ('project.xml','openstreetmap-carto-flex.lua','indexes.sql',
                    'functions.sql','common-values.sql')
    style_source_key = hashlib.sha256('|'.join(file_digest(source_style/f) for f in style_inputs).encode()).hexdigest()
    style_key_path = work/'.source-style-key'
    if style.is_dir() and (not style_key_path.is_file() or style_key_path.read_text() != style_source_key):
        shutil.rmtree(style)
    if not style.is_dir():
        shutil.copytree(source_style, style)
        style_key_path.write_text(style_source_key)
    worker = _worker_path()
    if not worker.is_file():
        raise PipelineError('Bundled renderer worker missing')
    # Personal temp key changes if a source/style changes. In that case, preserve logs
    # but discard previous private database before the new import.
    pbf_digest = file_digest(pbf)
    key = _import_key(pbf_digest,style)
    state_file = work/'import-state.json'
    previous = json.loads(state_file.read_text()) if state_file.is_file() else {}
    if previous.get('import_key') != key and (work/'pgdata').exists():
        # Never delete an unrelated directory merely because the user points --workdir there.
        if not (work/'pgdata'/'PG_VERSION').exists() or not (work/'.osm2mbtiles-workspace').exists():
            raise PipelineError('Unsafe workspace: refusing to remove unowned PostgreSQL cluster')
        shutil.rmtree(work/'pgdata')
    job_key = _job_key(pbf_digest,style,bbox,lo,hi,args.buffer,args.metatile)
    out.parent.mkdir(parents=True,exist_ok=True)
    partial = out.with_name(out.name+'.partial')
    if args.force and partial.exists():
        partial.unlink()
    job = dict(bbox=bbox,minzoom=lo,maxzoom=hi,mapfile=str(style/'project.xml'),
               partial=str(partial),name=out.stem,job_key=job_key,buffer=args.buffer,
               metatile=args.metatile,runtime=str(runtime.root),fonts=str(style/'fonts'))
    with LocalDatabase(runtime,work) as db:
        if previous.get('import_key') != key:
            print('Importing PBF into private PostGIS database...',flush=True)
            db.import_extract(pbf,style)
            db.prepare_external_data(style)
            state_file.write_text(json.dumps({'import_key':key},indent=2),encoding='utf-8')
        else:
            print('Reusing prior PBF import.',flush=True)
        # Atomic job file includes no credentials. Credentials only live in process env.
        job_path = work/'render-job.json'
        job_path.write_text(json.dumps(job,indent=2),encoding='utf-8')
        print('Rendering metatiles into MBTiles...',flush=True)
        run([runtime.python,worker,job_path],env=db.env,cwd=style)
    # Only a worker that exits successfully can replace the final output.
    os.replace(partial,out)
    print(f'DONE: {out} ({out.stat().st_size:,} bytes)',flush=True)

def main(argv=None):
    args,parser=arguments(argv)
    try:
        if args.action == 'doctor':
            runtime=get_runtime(args.runtime)
            runtime.validate()
            print(f'Runtime layout OK: {runtime.root}')
        elif args.action == 'convert':
            convert(args)
        elif args.action == 'verify':
            print(json.dumps(inspect(args.file),indent=2))
        elif args.action == 'compare':
            result=compare(args.reference,args.candidate,pixels=args.pixels)
            print(json.dumps(result,indent=2))
            return 0 if result['equal'] else 3
        else:
            parser.print_help()
            return 0
        return 0
    except (PipelineError,PBFError,ValueError, OSError) as exc:
        print(f'ERROR: {exc}',file=sys.stderr)
        return 2

if __name__ == '__main__':
    sys.exit(main())
