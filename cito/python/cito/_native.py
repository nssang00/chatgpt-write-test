from __future__ import annotations
import ctypes
import os
from pathlib import Path
from typing import Callable
_U8P = ctypes.POINTER(ctypes.c_uint8)
_CHARP = ctypes.POINTER(ctypes.c_char)
_CALLBACK = ctypes.CFUNCTYPE(None, ctypes.c_void_p, ctypes.c_uint64, _CHARP, ctypes.c_size_t, _U8P, ctypes.c_size_t)
def _load():
    explicit = os.environ.get('CITO_LIBRARY')
    if explicit:
        return ctypes.CDLL(explicit)
    here = Path(__file__).resolve().parent
    for name in ('libcito.so', 'libcito.dylib', 'cito.dll'):
        candidate = here / name
        if candidate.exists():
            return ctypes.CDLL(str(candidate))
    raise RuntimeError('Cito native library not found; set CITO_LIBRARY')
_lib = _load()
_lib.cito_abi_version.restype = ctypes.c_uint32
_lib.cito_context_create.argtypes = [_CHARP, ctypes.c_size_t, ctypes.POINTER(ctypes.c_void_p)]
_lib.cito_context_create.restype = ctypes.c_int
_lib.cito_context_destroy.argtypes = [ctypes.c_void_p]
_lib.cito_context_subscribe.argtypes = [ctypes.c_void_p, ctypes.c_uint64, _CHARP, ctypes.c_size_t, _CALLBACK, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)]
_lib.cito_context_subscribe.restype = ctypes.c_int
_lib.cito_subscription_destroy.argtypes = [ctypes.c_void_p]
_lib.cito_context_publish.argtypes = [ctypes.c_void_p, ctypes.c_uint64, _CHARP, ctypes.c_size_t, _U8P, ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
_lib.cito_context_publish.restype = ctypes.c_int
_lib.cito_context_run.argtypes = [ctypes.c_void_p]
_lib.cito_context_run.restype = ctypes.c_int
_lib.cito_status_string.argtypes = [ctypes.c_int]
_lib.cito_status_string.restype = ctypes.c_char_p
def _check(status: int) -> None:
    if status == 0: return
    raw = _lib.cito_status_string(status)
    raise RuntimeError('Cito error: ' + (raw.decode() if raw else str(status)))
def abi_version() -> int:
    return int(_lib.cito_abi_version())
def _text(value: str):
    raw = value.encode('utf-8')
    buf = ctypes.create_string_buffer(raw, max(1, len(raw)))
    return raw, buf
class Subscription:
    def __init__(self, handle, callback):
        self._handle = handle; self._callback = callback
    def close(self):
        if self._handle:
            _lib.cito_subscription_destroy(self._handle)
            self._handle = ctypes.c_void_p()
    def __enter__(self): return self
    def __exit__(self, *_): self.close()
    def __del__(self): self.close()
class Context:
    def __init__(self, scope: str = ''):
        raw, buf = _text(scope); handle = ctypes.c_void_p()
        _check(_lib.cito_context_create(ctypes.cast(buf, _CHARP), len(raw), ctypes.byref(handle)))
        self._handle = handle
    def close(self):
        if self._handle:
            _lib.cito_context_destroy(self._handle); self._handle = ctypes.c_void_p()
    def on(self, type_id: int, handler: Callable[[bytes], None], resource: str = '') -> Subscription:
        raw, buf = _text(resource)
        def bridge(_user, _type, _resource, _resource_size, payload, payload_size):
            handler(ctypes.string_at(payload, payload_size))
        callback = _CALLBACK(bridge); sub = ctypes.c_void_p()
        _check(_lib.cito_context_subscribe(self._handle, int(type_id), ctypes.cast(buf, _CHARP), len(raw), callback, None, ctypes.byref(sub)))
        return Subscription(sub, callback)
    def publish(self, type_id: int, payload, resource: str = '') -> int:
        data = bytes(payload); raw, buf = _text(resource)
        payload_buf = ((ctypes.c_uint8 * len(data)).from_buffer_copy(data) if data else (ctypes.c_uint8 * 1)())
        delivered = ctypes.c_size_t()
        _check(_lib.cito_context_publish(self._handle, int(type_id), ctypes.cast(buf, _CHARP), len(raw), ctypes.cast(payload_buf, _U8P), len(data), ctypes.byref(delivered)))
        return int(delivered.value)
    def run(self): _check(_lib.cito_context_run(self._handle))
    def __enter__(self): return self
    def __exit__(self, *_): self.close()
    def __del__(self): self.close()
