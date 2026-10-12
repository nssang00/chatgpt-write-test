from __future__ import annotations

import ctypes
import os
from pathlib import Path
from typing import Any, Callable

_U8P = ctypes.POINTER(ctypes.c_uint8)
_CHARP = ctypes.POINTER(ctypes.c_char)

_CALLBACK = ctypes.CFUNCTYPE(
    None,
    ctypes.c_void_p,
    ctypes.c_uint64,
    _CHARP,
    ctypes.c_size_t,
    _U8P,
    ctypes.c_size_t,
)


def _load() -> ctypes.CDLL:
    explicit = os.environ.get(
        "CITO_LIBRARY")

    if explicit:
        return ctypes.CDLL(explicit)

    here = Path(__file__).resolve().parent

    for name in (
        "libcito.so",
        "libcito.dylib",
        "cito.dll",
    ):
        candidate = here / name
        if candidate.exists():
            return ctypes.CDLL(
                str(candidate))

    raise RuntimeError(
        "Cito native library not found; "
        "set CITO_LIBRARY")


_lib = _load()

_lib.cito_abi_version.restype = (
    ctypes.c_uint32)

_lib.cito_context_create.argtypes = [
    _CHARP,
    ctypes.c_size_t,
    ctypes.POINTER(ctypes.c_void_p),
]
_lib.cito_context_create.restype = (
    ctypes.c_int)

_lib.cito_context_destroy.argtypes = [
    ctypes.c_void_p,
]

_lib.cito_context_subscribe.argtypes = [
    ctypes.c_void_p,
    ctypes.c_uint64,
    _CHARP,
    ctypes.c_size_t,
    _CALLBACK,
    ctypes.c_void_p,
    ctypes.POINTER(ctypes.c_void_p),
]
_lib.cito_context_subscribe.restype = (
    ctypes.c_int)

_lib.cito_subscription_destroy.argtypes = [
    ctypes.c_void_p,
]

_lib.cito_context_has_demand.argtypes = [
    ctypes.c_void_p,
    ctypes.c_uint64,
    _CHARP,
    ctypes.c_size_t,
    ctypes.POINTER(ctypes.c_int),
]
_lib.cito_context_has_demand.restype = (
    ctypes.c_int)

_lib.cito_context_publish.argtypes = [
    ctypes.c_void_p,
    ctypes.c_uint64,
    _CHARP,
    ctypes.c_size_t,
    _U8P,
    ctypes.c_size_t,
    ctypes.POINTER(ctypes.c_size_t),
]
_lib.cito_context_publish.restype = (
    ctypes.c_int)

_lib.cito_context_run.argtypes = [
    ctypes.c_void_p,
]
_lib.cito_context_run.restype = (
    ctypes.c_int)

_lib.cito_status_string.argtypes = [
    ctypes.c_int,
]
_lib.cito_status_string.restype = (
    ctypes.c_char_p)


def _check(status: int) -> None:
    if status == 0:
        return

    raw = _lib.cito_status_string(
        status)

    raise RuntimeError(
        "Cito error: " +
        (
            raw.decode()
            if raw
            else str(status)
        ))


def abi_version() -> int:
    return int(
        _lib.cito_abi_version())


def _text(
    value: str,
) -> tuple[bytes, ctypes.Array]:
    raw = value.encode("utf-8")
    buffer = ctypes.create_string_buffer(
        raw,
        max(1, len(raw)))
    return raw, buffer


class Subscription:
    def __init__(
        self,
        handle: ctypes.c_void_p,
        callback: _CALLBACK,
    ):
        self._handle = handle
        self._callback = callback

    def close(self) -> None:
        if self._handle:
            _lib.cito_subscription_destroy(
                self._handle)
            self._handle = (
                ctypes.c_void_p())

    def __enter__(self):
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def __del__(self) -> None:
        self.close()


class Context:
    def __init__(
        self,
        scope: str = "",
    ):
        raw, buffer = _text(scope)
        handle = ctypes.c_void_p()

        _check(
            _lib.cito_context_create(
                ctypes.cast(
                    buffer,
                    _CHARP),
                len(raw),
                ctypes.byref(handle)))

        self._handle = handle

    def close(self) -> None:
        if self._handle:
            _lib.cito_context_destroy(
                self._handle)
            self._handle = (
                ctypes.c_void_p())

    def on_raw(
        self,
        type_id: int,
        handler: Callable[[bytes], None],
        resource: str = "",
    ) -> Subscription:
        raw, buffer = _text(resource)

        def bridge(
            _user: int,
            _type: int,
            _resource: _CHARP,
            _resource_size: int,
            payload: _U8P,
            payload_size: int,
        ) -> None:
            handler(
                ctypes.string_at(
                    payload,
                    payload_size))

        callback = _CALLBACK(bridge)
        subscription = ctypes.c_void_p()

        _check(
            _lib.cito_context_subscribe(
                self._handle,
                int(type_id),
                ctypes.cast(
                    buffer,
                    _CHARP),
                len(raw),
                callback,
                None,
                ctypes.byref(
                    subscription)))

        return Subscription(
            subscription,
            callback)

    def on(
        self,
        message_type: Any,
        handler: Callable[[Any], None],
        resource: str = "",
    ) -> Subscription:
        if isinstance(
            message_type,
            int):
            return self.on_raw(
                message_type,
                handler,
                resource)

        type_id = getattr(
            message_type,
            "TYPE_ID",
            None)
        decode = getattr(
            message_type,
            "decode",
            None)

        if (
            type_id is None or
            not callable(decode)
        ):
            raise TypeError(
                "Cito on() expects a generated "
                "message type or integer TypeId")

        return self.on_raw(
            int(type_id),
            lambda payload: handler(
                decode(payload)),
            resource)

    def has_demand(
        self,
        message_type_or_id: Any,
        resource: str = "",
    ) -> bool:
        type_id = (
            message_type_or_id
            if isinstance(
                message_type_or_id,
                int)
            else getattr(
                message_type_or_id,
                "TYPE_ID",
                None))

        if type_id is None:
            raise TypeError(
                "Cito has_demand() expects "
                "a generated message type or integer TypeId")

        raw, buffer = _text(resource)
        result = ctypes.c_int()

        _check(
            _lib.cito_context_has_demand(
                self._handle,
                int(type_id),
                ctypes.cast(
                    buffer,
                    _CHARP),
                len(raw),
                ctypes.byref(result)))

        return bool(
            result.value)

    def publish_raw(
        self,
        type_id: int,
        payload: bytes | bytearray | memoryview,
        resource: str = "",
    ) -> int:
        data = bytes(payload)
        raw, buffer = _text(resource)

        payload_buffer = (
            (ctypes.c_uint8 * len(data))
            .from_buffer_copy(data)
            if data
            else
            (ctypes.c_uint8 * 1)())

        delivered = ctypes.c_size_t()

        _check(
            _lib.cito_context_publish(
                self._handle,
                int(type_id),
                ctypes.cast(
                    buffer,
                    _CHARP),
                len(raw),
                ctypes.cast(
                    payload_buffer,
                    _U8P),
                len(data),
                ctypes.byref(
                    delivered)))

        return int(
            delivered.value)

    def publish(
        self,
        message_or_type_id: Any,
        payload_or_resource: Any = None,
        resource: str = "",
    ) -> int:
        if isinstance(
            message_or_type_id,
            int):
            if payload_or_resource is None:
                raise TypeError(
                    "raw Cito publish() requires payload")

            return self.publish_raw(
                message_or_type_id,
                payload_or_resource,
                resource)

        message = message_or_type_id
        type_id = getattr(
            message,
            "TYPE_ID",
            None)
        encode = getattr(
            message,
            "encode",
            None)

        if (
            type_id is None or
            not callable(encode)
        ):
            raise TypeError(
                "Cito publish() expects a generated "
                "message or integer TypeId")

        if payload_or_resource is not None:
            if (
                not isinstance(
                    payload_or_resource,
                    str) or
                resource
            ):
                raise TypeError(
                    "typed Cito publish() accepts "
                    "an optional resource string")
            resource = payload_or_resource

        if not self.has_demand(
                int(type_id),
                resource):
            return 0

        return self.publish_raw(
            int(type_id),
            encode(),
            resource)

    def run(self) -> None:
        _check(
            _lib.cito_context_run(
                self._handle))

    def __enter__(self):
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def __del__(self) -> None:
        self.close()
