from . import _wire

__all__ = [
    "Context",
    "Subscription",
    "abi_version",
]


def __getattr__(name: str):
    if name in {
        "Context",
        "Subscription",
        "abi_version",
    }:
        from ._native import (
            Context,
            Subscription,
            abi_version,
        )

        globals().update({
            "Context": Context,
            "Subscription": Subscription,
            "abi_version": abi_version,
        })
        return globals()[name]

    raise AttributeError(name)
