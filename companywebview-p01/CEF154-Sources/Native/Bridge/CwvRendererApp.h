#pragma once
// Renderer-side only. No Unity or D3D11 dependencies.
#include "include/cef_app.h"
#include "include/cef_v8.h"
#include "include/wrapper/cef_message_router.h"
#include "CwvRouterConfig.h"

class CwvRendererApp final : public CefApp, public CefRenderProcessHandler {
public:
    CefRefPtr<CefRenderProcessHandler> GetRenderProcessHandler() override { return this; }
    void OnWebKitInitialized() override {
        router_ = CefMessageRouterRendererSide::Create(CwvRouterConfig());
    }
    void OnContextCreated(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                          CefRefPtr<CefV8Context> context) override {
        router_->OnContextCreated(browser, frame, context);
        if (!frame || !frame->IsMain()) return; // Never expose to iframes.
        // Transport is installed in the renderer, but every call is authorized
        // independently by the browser process against its actual main-frame URL.
        static const char kBootstrap[] = R"CWV((function(){
  'use strict';
  if (Object.prototype.hasOwnProperty.call(window, 'AppName') ||
      Object.prototype.hasOwnProperty.call(window, 'companyWebView')) return;
  const functions = new Map();
  const listeners = new Map();
  const identifier = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
  const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype']);
  const reserved = new Set(['then', 'constructor', 'prototype', '__proto__',
      'bind', 'unbind', 'ready', 'postMessage', 'onMessage', 'invoke', '__receive']);
  function checkPath(path) {
    if (typeof path !== 'string' || !path.length || path.length > 128 ||
        path.startsWith('__cwv.') || !path.split('.').every(p => identifier.test(p) && !reserved.has(p)))
      throw new Error('ERR_INVALID_METHOD');
    return path;
  }
  function bytesToBase64(bytes) {
    let text = '';
    for (let i = 0; i < bytes.length; i += 8192)
      text += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return btoa(text);
  }
  function encode(v, seen, depth) {
    if (depth > 32) throw new Error('ERR_INVALID_PAYLOAD');
    if (v instanceof ArrayBuffer) return {$cwvBinary: bytesToBase64(new Uint8Array(v))};
    if (ArrayBuffer.isView(v)) return {$cwvBinary: bytesToBase64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength))};
    if (v === null || typeof v !== 'object') {
      if (typeof v === 'bigint' || typeof v === 'function' || typeof v === 'symbol' ||
          (typeof v === 'number' && !Number.isFinite(v))) throw new Error('ERR_INVALID_PAYLOAD');
      return v === undefined ? null : v;
    }
    if (seen.has(v)) throw new Error('ERR_CYCLIC_PAYLOAD');
    seen.add(v);
    try {
      if (Array.isArray(v)) return v.map(x => encode(x, seen, depth + 1));
      const result = Object.create(null);
      for (const key of Object.keys(v)) {
        if (unsafeKeys.has(key)) throw new Error('ERR_INVALID_PAYLOAD');
        result[key] = encode(v[key], seen, depth + 1);
      }
      return result;
    } finally { seen.delete(v); }
  }
  function decode(v, depth) {
    if (depth > 32) throw new Error('ERR_INVALID_PAYLOAD');
    if (v && typeof v === 'object') {
      if (!Array.isArray(v) && Object.keys(v).length === 1 &&
          typeof v.$cwvBinary === 'string') {
        const raw = atob(v.$cwvBinary), bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        return bytes.buffer;
      }
      if (Array.isArray(v)) return v.map(x => decode(x, depth + 1));
      for (const key of Object.keys(v)) {
        // Reject prototype setters from untrusted host replies and event payloads.
        if (unsafeKeys.has(key)) throw new Error('ERR_INVALID_PAYLOAD');
        v[key] = decode(v[key], depth + 1);
      }
    }
    return v;
  }
  function rpc(method, payload) {
    try { if (method !== '__cwv.postMessage' && method !== '__cwv.executeResult') checkPath(method); }
    catch (e) { return Promise.reject(e); }
    let request;
    try {
      request = JSON.stringify({v:1, method, payloadJson:JSON.stringify(encode(payload, new Set(), 0))});
      if (new TextEncoder().encode(request).length > 65536) throw new Error('ERR_PAYLOAD_TOO_LARGE');
    } catch (e) { return Promise.reject(e); }
    if (typeof window.__cwvQuery !== 'function')
      return Promise.reject(new Error('ERR_TRANSPORT_UNAVAILABLE'));
    return new Promise((resolve, reject) => window.__cwvQuery({
      request,
      onSuccess(value) { try { resolve(decode(JSON.parse(value), 0)); } catch (e) { reject(e); } },
      onFailure(code, reason) { const e = new Error(reason || 'ERR_RPC'); e.code = reason; e.nativeCode = code; reject(e); }
    }));
  }
  const proxyFor = path => new Proxy(function(){}, {
    get(_target, key) {
      if (typeof key !== 'string' || reserved.has(key)) return undefined;
      if (!identifier.test(key)) return undefined;
      return proxyFor(path ? path + '.' + key : key);
    },
    apply(_target, _thisArg, args) { return rpc(checkPath(path), args); }
  });
  const api = {
    ready: Promise.resolve(),
    // P0 compatibility: not needed by new integrations.
    invoke(method, payload) { return rpc(checkPath(method), payload); },
    bind(namespace, value) {
      if (typeof value === 'function') {
        const name = checkPath(namespace);
        if (functions.has(name)) throw new Error('ERR_DUPLICATE_BINDING');
        functions.set(name, value);
        return;
      }
      checkPath(namespace);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ERR_INVALID_BINDING');
      const entries = Object.keys(value).map(key => [checkPath(namespace + '.' + key), value[key]]);
      if (entries.some(([name, fn]) => typeof fn !== 'function' || functions.has(name)))
        throw new Error('ERR_INVALID_OR_DUPLICATE_BINDING');
      for (const [name, fn] of entries) functions.set(name, fn.bind(value));
    },
    unbind(name) {
      checkPath(name);
      let removed = false;
      for (const key of Array.from(functions.keys())) {
        if (key === name || key.startsWith(name + '.')) { functions.delete(key); removed = true; }
      }
      return removed;
    },
    postMessage(name, data) {
      if (typeof name !== 'string' || !name || name.length > 128) throw new Error('ERR_INVALID_MESSAGE');
      // Fire-and-forget; errors can still be reported to the console.
      rpc('__cwv.postMessage', {name, data}).catch(e => console.warn('[CompanyWebView postMessage]', e));
    },
    onMessage(name, listener) {
      if (typeof name !== 'string' || !name || name.length > 128 || typeof listener !== 'function')
        throw new Error('ERR_INVALID_MESSAGE_LISTENER');
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
      return () => { const set = listeners.get(name); if (set) set.delete(listener); };
    },
    // Called only by native browser-side dispatch on an authorized main frame.
    __receive(command) {
      if (!command || typeof command !== 'object') return;
      if (command.kind === 'message') {
        const payload = decode(command.payload, 0);
        for (const callback of Array.from(listeners.get(command.name) || [])) {
          try { callback(payload); } catch(e) { console.error('[CompanyWebView listener]', e); }
        }
      } else if (command.kind === 'execute') {
        const method = command.method, fn = functions.get(method);
        Promise.resolve().then(() => {
          if (!fn) throw new Error('ERR_METHOD_NOT_FOUND');
          return fn(...decode(command.args, 0));
        }).then(value => {
          rpc('__cwv.executeResult', {requestId:command.requestId, navigationId:command.navigationId,
            ok:true, resultJson:JSON.stringify(encode(value, new Set(), 0))});
        }, error => {
          rpc('__cwv.executeResult', {requestId:command.requestId, navigationId:command.navigationId,
            ok:false, error:String(error && error.message || error).slice(0,1024)});
        }).catch(e => console.warn('[CompanyWebView executeResult]', e));
      } else if (command.kind === 'script') {
        (0, eval)(command.script);
      }
    }
  };
  const globalApi = new Proxy(Object.freeze(api), {
    get(target, key) {
      if (typeof key === 'string' && Object.prototype.hasOwnProperty.call(target, key)) return target[key];
      if (typeof key === 'string' && identifier.test(key) && !reserved.has(key)) return proxyFor(key);
      return undefined;
    }
  });
  Object.defineProperty(window, 'AppName', {value:globalApi, writable:false, configurable:false});
  Object.defineProperty(window, 'companyWebView', {value:globalApi, writable:false, configurable:false});
})();)CWV";
        if (context->Enter()) {
            CefRefPtr<CefV8Value> result;
            CefRefPtr<CefV8Exception> error;
            context->Eval(kBootstrap, "cwv://renderer-bootstrap", 0, result, error);
            context->Exit();
        }
    }
    void OnContextReleased(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                           CefRefPtr<CefV8Context> context) override {
        router_->OnContextReleased(browser, frame, context);
    }
    bool OnProcessMessageReceived(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                                  CefProcessId source, CefRefPtr<CefProcessMessage> message) override {
        return router_->OnProcessMessageReceived(browser, frame, source, message);
    }
private:
    CefRefPtr<CefMessageRouterRendererSide> router_;
    IMPLEMENT_REFCOUNTING(CwvRendererApp);
};
