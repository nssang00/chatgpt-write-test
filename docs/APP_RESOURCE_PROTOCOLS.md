# Xytron app://, file:// and extensible resource protocols

Status: **first engine-neutral Core foundation implemented; browser custom
scheme registration remains planned** (2026-10-14). The primary product
is a standalone desktop app; embedded controls use the same policy.

## Product URL model (owner direction)

- \`app://desktop/index.html\` is the **target default packaged UI URL**.
  Per-feature isolated hosts, e.g. \`app://camera/ui/panel.html\`.
- \`http://\`, \`https://\` remain navigation/network protocols;
  they do NOT implicitly grant native Module access.
- \`file://\` is supported for explicitly chosen files and legacy
  development hosts; no generic unrestricted filesystem resource handler.
- Additional \`foo://\` schemes will be manifest-declared BEFORE browser
  environment initialization; runtime Modules only supply resource
  handlers for those predeclared schemes, not arbitrary late schemes.
- **Native Module registration != native invoke capability.** Permission
  must be checked per original frame/origin/app, method and object handle.

## Phase U0: implemented C++11 Core-only resource catalog

\`nativeweb::AppResourceBundle\` in \`include/nativeweb/app_resources.hpp\`
stores explicit byte resources and MIME types under canonical
\`app://host/path\` URLs, e.g.:

\`\`\`cpp
nativeweb::AppResourceBundle resources;
resources.add("app://desktop/index.html", "text/html", html);
resources.add("app://desktop/assets/main.js", "application/javascript", js);
\`\`\`

The first slice **rejects** HTTP/file/other schemes, noncanonical host
case, queries, fragments, percent-encoding, dot segments, backslashes,
empty path segments, userinfo/ports/control bytes and duplicate keys.
It never directly reads arbitrary local files. Asset bodies are bounded
at 16 MiB each. Core CTest \`core.app_resources\` covers positive and
negative cases. This is **not yet a renderable app:// WebView URL**;
WebView::create currently accepts regular source URLs and both browser
engines still have an exact-file trust gate.

## Phase U1/U2: native browser bindings (release blockers)

1. **CEF:** register the standard secure \`app\` scheme in
   \`CefApp::OnRegisterCustomSchemes\` for browser and renderer processes;
   install a \`CefSchemeHandlerFactory\` before navigating. It must
   serve catalog bytes/MIME/status without access to undeclared paths.
2. **WebView2:** register custom \`app\` scheme via Environment options
   BEFORE \`CreateCoreWebView2EnvironmentWithOptions\`, then use
   request handlers to serve the same catalog (virtual HTTPS host mapping
   can be a separate compatibility fallback but does NOT make an app://
   URL work by itself).
3. **Security:** upgrade \`trustedEntryDocument()\` to use engine-supplied
   document identity and approved app:// origins plus exact entry path,
   without accidentally making file:// or arbitrary external sites
   trusted. Bind module permissions to actual native dispatch.
4. **Packaged app:** CLI \`xytron new\` and \`run/build/publish\` should
   expose app:// by default only after the real engine U1/U2 E2E is green.
   Preserve explicit file:// legacy host behavior until then.

## Test gates (U0–U3)

| ID | Test | Required proof |
| --- | --- | --- |
| A1-URL-01 | Known app:// page and relative JS/CSS/images | 3-engine rendered E2E |
| A1-URL-02 | Unknown asset, host isolation, duplicate keys | Core + 3-engine denied requests |
| A1-URL-03 | '../', percent encoded traversal, backslash, symlink path | Core + 3-engine deny |
| A1-URL-04 | Outside https/file frame tries resource/native access | 3-engine security negative E2E |
| A1-URL-05 | Exact file:// entry still works for legacy host | 3-engine regression E2E |
| A1-URL-06 | Invalid/reserved/delayed custom scheme declaration | Core + engine startup tests |
| A1-URL-07 | Only granted app:// methods/objects callable | 3-engine authorization E2E, NW-014 |
| A1-URL-08 | Reload, navigation, callback/Plugin unload revocation | lifecycle E2E + ASan |

U0 is NOT U1/U2 proof. Any future filesystem-backed adapter must use
real canonical file paths, symlink-resistant confinement and archive
path validation, not only URL-string filtering.

## Uploaded webview_util.zip

The uploaded utilities contain Callback/ThreadPool/V8ValueConverter/
VariantConverter concepts, **not any custom URL protocol scheme handler**
or a full resource-server implementation. They inform future CEF
callback/Value adapter work separately, not this URL loader's security.

## External implementation references

- CEF requires registration in \`OnRegisterCustomSchemes\` in *all*
  processes, plus browser-side scheme handler factory.
- WebView2 virtual host name mapping supports HTTPS host mapping, not
  app:// as the public origin; genuine app:// requires custom scheme
  environment registration and an actual resource response provider.

## U1 CEF integration — source submitted, CI pending

The CEF app used by NativeWeb registers `app` as a standard, secure
custom scheme **in all CEF subprocesses**. Each CEF WebView with an
explicit `WebViewOptions::appResources` bundle gets its own request
context and scheme handler factory; no global resource map shared
across windows. The handler responds only with explicitly registered
in-memory resources, returns 404 for unknown keys, and never
opens filesystem paths. Before create(), the entry must be
present in the bundle. `trustedEntryDocument` now recognizes
canonical `app://` exact main document URLs *in addition to* the
preexisting exact file:/// legacy source; no remote HTTPS auto-grant.

The WebView2 adapter does **not** yet serve app://; its normal file://
workflow is unchanged. No CLI default change until both adapters
have a real end-to-end check. See NW-033.

## U2 WebView2 custom app scheme — source submitted, CI pending

WebView2 environment now receives `ICoreWebView2EnvironmentOptions4`
with `app` as an authority-bearing secure custom scheme before
environment creation. A `WebResourceRequested` filter and handler
returns explicit in-memory MIME/body resources (or 404), never
reading disk; remote cross-origin CORS grants are not emitted.
The existing WebMessageReceived native bridge still checks
host-supplied document identity. A new Windows WebView2 real
`browser.app_resource_lifecycle` E2E mirrors Linux/Windows CEF.

Because `CoreWebView2EnvironmentOptions4` and custom scheme
registration are runtime-dependent, the pinned SDK/CI must pass
without degrading back to file://. Full same-file iframe/method
authorization NW-014 remains a separate release blocker.
