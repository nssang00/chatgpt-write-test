import base64,bz2,hashlib,io,pathlib,re,tarfile,json
repo=pathlib.Path.cwd()
source=repo/'companywebview-p01/CEF154-Sources/cef-native.tar.bz2.base64'
manifest=repo/'companywebview-p01/NativeSource/CEF/cef-native-source.sha256'
out=repo/'companywebview-p01/CEF154-Sources/Native'
if hashlib.sha256(source.read_bytes()).hexdigest()!='e9d05dfa717ba23466c2bc1aa71fd08a5683237a53d16baef2716826a4240478':raise SystemExit('CEF source archive digest mismatch')
if hashlib.sha256(manifest.read_bytes().replace(b'\r\n',b'\n')).hexdigest()!='cf42cb10180098f70c340f7165f803f31f7f7dbafaa2be97634a0a266f6207b0':raise SystemExit('CEF source manifest digest mismatch')
rows=[line.split('  ',1) for line in manifest.read_text().splitlines()]
if len(rows)!=14:raise SystemExit('Expected 14 native source files')
expected={}
for sha,name in rows:
 p=pathlib.PurePosixPath(name)
 if not re.fullmatch('[0-9a-f]{64}',sha) or not re.fullmatch('[A-Za-z0-9_./-]+',name) or '..' in p.parts or p.is_absolute() or name in expected:raise SystemExit('Unsafe source path or digest')
 expected[name]=sha
raw=bz2.decompress(base64.b64decode(source.read_bytes(),validate=True))
with tarfile.open(fileobj=io.BytesIO(raw),mode='r:') as tar:
 members=tar.getmembers()
 if len(members)!=14 or set(x.name for x in members)!=set(expected):raise SystemExit('Source list mismatch')
 for m in members:
  if not m.isfile():raise SystemExit('Unsafe archive file kind')
  data=tar.extractfile(m).read()
  if hashlib.sha256(data).hexdigest()!=expected[m.name]:raise SystemExit('Native source SHA256 mismatch: '+m.name)
  destination=out.joinpath(*pathlib.PurePosixPath(m.name).parts)
  destination.parent.mkdir(parents=True,exist_ok=True)
  destination.write_bytes(data)
if {p.relative_to(out).as_posix() for p in out.rglob('*') if p.is_file()}!=set(expected):raise SystemExit('Extra native files present')
pathlib.Path('cwv-cef154-source-proof.json').write_text(json.dumps({'status':'SOURCE_INTEGRITY_PASS','source_count':len(expected),'nativeCompiled':False,'unityExecuted':False},indent=2))
print('CWV_CEF154_SOURCE_INTEGRITY_PASS: 14 C++/CMake source files')