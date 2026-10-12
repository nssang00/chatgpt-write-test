# Compiled embedded host runtime

The process-level `EmbeddedHostRuntime` registry lives in `cito_core`, a
compiled shared library.

A header-only function-local singleton can be duplicated when a C++ executable
and the C ABI shared library are separate DSOs. That would make two Contexts in
one process disagree about local demand.

Both the C++ `cito` target and the C ABI `cito_c` target link the same
`cito_core`, so they acquire the same `EmbeddedHostRuntime` instance.

IDL-generated C++ types with `StaticCodec<T>::direct == true` participate in
this shared runtime:

- subscriptions add exact `ScopeId + ResourceId + TypeId` interest;
- a publisher checks demand excluding its own app before encoding;
- same-Context callbacks remain object-native and are never delivered twice;
- cross-Context delivery encodes once and decodes in the destination Context;
- handwritten non-direct types retain the original same-Context object path.

Remote transport attachment remains separate: public Context does not claim a
remote send succeeded until the reusable UDP/QUIC adapters are attached to its
event loop.
