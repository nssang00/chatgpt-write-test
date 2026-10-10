#!/usr/bin/env python3
import json, pathlib, re, sys
root = pathlib.Path(__file__).resolve().parents[1]
pkg = root / 'Package' / 'com.company.webview'
blockers=[]; warnings=[]; checks=[]
def check(name, ok, detail, blocker=False, warning=False):
    checks.append({'name':name,'ok':bool(ok),'detail':detail})
    if not ok:
        if blocker: blockers.append({'code':name,'detail':detail})
        elif warning: warnings.append({'code':name,'detail':detail})
pj = json.loads((pkg/'package.json').read_text(encoding='utf-8'))
ver = pj.get('version','')
check('PACKAGE_METADATA_VALID', bool(pj.get('name')) and bool(ver), f"name={pj.get('name')} version={ver}", blocker=True)
check('PACKAGE_VERSION_RELEASE_CANDIDATE', not ver.startswith('0.0.'), f'version={ver}; 0.0.x is preview/prototype versioning', blocker=True)
runtime = pkg/'Runtime'
cef_backend = runtime/'Backends'/'CEF'/'CefBackend.cs'
cef_text = cef_backend.read_text(encoding='utf-8') if cef_backend.exists() else ''
implemented = bool(cef_text) and not re.search(r'internal sealed class CefBackend\\s*\\{\\s*\\}', cef_text, re.S)
check('RUNTIME_CEF_BACKEND_IMPLEMENTED', implemented, 'Validated CEF backend must live in Runtime, not only Prototypes.', blocker=True)
public_files=list(runtime.rglob('*.cs'))
public_text='\\n'.join(p.read_text(encoding='utf-8',errors='ignore') for p in public_files)
has_webview=bool(re.search(r'public\\s+(?:sealed\\s+)?class\\s+WebView\\b', public_text))
check('PUBLIC_WEBVIEW_API_IMPLEMENTED', has_webview, 'Documentation advertises WebView quick API but Runtime has no public WebView class.', blocker=True)
proto = pkg/'Prototypes'/'CefTexture'
working_proto = (proto/'Native'/'Host'/'CefRuntime.cpp').exists() and (proto/'Managed'/'CefTextureProbeNative.cs').exists()
check('VALIDATED_IMPLEMENTATION_PROMOTED_FROM_PROTOTYPES', not working_proto, 'Working validated implementation is still under Prototypes/CefTexture.', blocker=True)
for unwanted in ['Tests','Validation','Tools']:
    check(f'RELEASE_EXCLUDES_{unwanted.upper()}', not (pkg/unwanted).exists(), f'Final release package must exclude {unwanted}/.', warning=True)
licenses=[p.name for p in pkg.iterdir() if p.is_file() and p.name.lower().startswith(('license','notice','third'))]
check('LICENSE_NOTICE_PRESENT', bool(licenses), 'No LICENSE/NOTICE/THIRD_PARTY file found in package root.', blocker=True)
report={'schemaVersion':1,'harnessVersion':'58.3.0','releaseReady':len(blockers)==0,'status':('READY_FOR_RC_PACKAGING' if not blockers else ('BLOCKED_RUNTIME_PROMOTION' if any(b['code'] in ('RUNTIME_CEF_BACKEND_IMPLEMENTED','PUBLIC_WEBVIEW_API_IMPLEMENTED','VALIDATED_IMPLEMENTATION_PROMOTED_FROM_PROTOTYPES') for b in blockers) else 'BLOCKED_RELEASE_METADATA')),'blockers':blockers,'warnings':warnings,'checks':checks,'policy':{'finalReleaseExcludes':['Tests','Validation','Tools','Prototypes'],'prototypeCodeAllowedInFinalRelease':False,'validatedImplementationMustBeInRuntime':True,'validationSourceMayContainTestsAndValidation':True,'shippingArtifactMustBeSelfContained':True}}
out=root/'release-readiness-report.json'
out.write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding='utf-8')
print(json.dumps(report,indent=2,ensure_ascii=False))
sys.exit(0)
