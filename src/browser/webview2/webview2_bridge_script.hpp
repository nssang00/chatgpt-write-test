#ifndef NATIVEWEB_WEBVIEW2_BRIDGE_SCRIPT_HPP_INCLUDED
#define NATIVEWEB_WEBVIEW2_BRIDGE_SCRIPT_HPP_INCLUDED

namespace nativeweb {
namespace detail {

static const wchar_t kWebView2BridgeScript[] = LR"NATIVEWEBJS(
(function(global) {
  if (!global.chrome || !global.chrome.webview) return;

  const pending = new Map();
  const subscriptions = new Map();
  let nextRequestId = 1;
  let nextSubscriptionId = 1;

  const errorText = (error) => {
    if (!error) return "JavaScript error";
    if (typeof error === "string") return error;
    if (error.message) return String(error.message);
    return String(error);
  };

  const encode = (value) => {
    if (value instanceof ArrayBuffer) {
      return { __nativeweb_binary: Array.from(new Uint8Array(value)) };
    }

    if (ArrayBuffer.isView(value)) {
      return {
        __nativeweb_binary: Array.from(
          new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        )
      };
    }

    if (!value || typeof value !== "object") return value;

    if (value.__nativeweb_object === true || value.__nativewebObjectId) {
      return {
        __nativeweb_object: true,
        id: String(value.id || value.__nativewebObjectId),
        type: String(value.type || value.__nativewebType || "")
      };
    }

    if (Array.isArray(value)) return value.map(encode);

    const output = {};
    for (const key of Object.keys(value)) output[key] = encode(value[key]);
    return output;
  };

  const invokeRaw = (method, ...args) => {
    if (typeof method !== "string") {
      return Promise.reject(
        new TypeError("xytron.invoke(method, ...args) requires a method string")
      );
    }

    const id = String(nextRequestId++);
    const promise = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });

    global.chrome.webview.postMessage(
      encode({ type: "request", id, method, args })
    );

    return promise;
  };

  const createNativeObject = (value) => {
    const target = {
      __nativeweb_object: true,
      id: String(value.id),
      type: String(value.type || "")
    };

    return new Proxy(target, {
      get(object, property) {
        if (property === "then") return undefined;
        if (property === "__nativewebObjectId") return object.id;
        if (property === "__nativewebType") return object.type;

        if (property === "dispose") {
          return () =>
            invokeRaw("__native_object.release", object.id, object.type);
        }

        if (property in object) return object[property];
        if (typeof property !== "string") return undefined;

        return (...args) =>
          invokeRaw(
            "__native_object.call",
            object.id,
            object.type,
            property,
            ...args
          );
      }
    });
  };

  const decode = (value) => {
    if (!value || typeof value !== "object") return value;

    if (
      Object.prototype.hasOwnProperty.call(value, "__nativeweb_binary")
    ) {
      return Uint8Array.from(value.__nativeweb_binary).buffer;
    }

    if (value.__nativeweb_object === true) {
      return createNativeObject(value);
    }

    if (Array.isArray(value)) return value.map(decode);

    for (const key of Object.keys(value)) value[key] = decode(value[key]);
    return value;
  };

  const resolveDottedFunction = (method) => {
    const parts = String(method).split(".");
    let receiver = global;

    for (let index = 0; index < parts.length - 1; ++index) {
      receiver = receiver && receiver[parts[index]];
    }

    const name = parts[parts.length - 1];
    const fn = receiver && receiver[name];
    if (typeof fn !== "function") return null;
    return { receiver, fn };
  };

  const postError = (id, code, message) => {
    global.chrome.webview.postMessage(
      encode({
        type: "error",
        id: String(id),
        code,
        message: String(message)
      })
    );
  };

  const handleNativeRequest = (message) => {
    const resolved = resolveDottedFunction(message.method);

    if (!resolved) {
      postError(
        message.id,
        "js_method_not_found",
        "JavaScript method not found: " + String(message.method)
      );
      return;
    }

    let result;

    try {
      result = resolved.fn.apply(resolved.receiver, message.args || []);
    } catch (error) {
      postError(message.id, "js_exception", errorText(error));
      return;
    }

    Promise.resolve(result).then(
      (value) => {
        global.chrome.webview.postMessage(
          encode({ type: "response", id: String(message.id), value })
        );
      },
      (error) => {
        postError(message.id, "js_promise_rejected", errorText(error));
      }
    );
  };

  global.chrome.webview.addEventListener("message", (event) => {
    const message = decode(event.data);
    if (!message || typeof message !== "object") return;

    if (message.type === "response" || message.type === "error") {
      const id = String(message.id);
      const item = pending.get(id);
      if (!item) return;

      pending.delete(id);

      if (message.type === "response") {
        item.resolve(message.value);
      } else {
        item.reject(
          new Error(String(message.code) + ": " + String(message.message))
        );
      }
      return;
    }

    if (message.type === "event") {
      for (const subscription of subscriptions.values()) {
        if (subscription.eventName === message.event) {
          try {
            subscription.callback(message.payload);
          } catch (_) {
          }
        }
      }
      return;
    }

    if (message.type === "request") {
      handleNativeRequest(message);
    }
  });

  const onRaw = (eventName, callback) => {
    if (typeof eventName !== "string" || typeof callback !== "function") {
      throw new TypeError(
        "xytron.on(eventName, callback) requires a string and function"
      );
    }

    const id = String(nextSubscriptionId++);
    subscriptions.set(id, { eventName, callback });
    return id;
  };

  const offRaw = (id) => subscriptions.delete(String(id));

  const native = { invokeRaw, onRaw, offRaw };
  native.invoke = invokeRaw;
  native.on = onRaw;
  native.off = offRaw;

  Object.defineProperty(global, "native", {
    value: native,
    writable: false,
    configurable: false,
    enumerable: true
  });

  const namespace = (path) =>
    new Proxy(function() {}, {
      get(_target, property) {
        if (property === "then") return undefined;
        if (path === "" && property === "invoke") return invokeRaw;
        if (path === "" && property === "on") return onRaw;
        if (path === "" && property === "off") return offRaw;
        if (typeof property !== "string") return undefined;

        const next = path ? path + "." + property : property;
        return namespace(next);
      },

      apply(_target, _this, args) {
        if (!path) throw new TypeError("xytron root is not callable");
        return invokeRaw(path, ...args);
      }
    });

  Object.defineProperty(global, "xytron", {
    value: namespace(""),
    writable: false,
    configurable: false,
    enumerable: true
  });
})(globalThis);
)NATIVEWEBJS";

} // namespace detail
} // namespace nativeweb

#endif
