# Cito Embedded Host Aggregation

Multiple C ABI / Python Contexts in one process now share one internal `EmbeddedHostRuntime`.

Each Context receives a unique AppId and registers its local delivery callback with the shared `HostRuntimeCore`.

```text
Python/C Context A -- AppId 1 --+
Python/C Context B -- AppId 2 --+--> EmbeddedHostRuntime
Python/C Context C -- AppId 3 --+      HostRuntimeCore
                                      |
                                      +-- one HostInterests summary
                                      +-- exact local DemandKey index
                                      +-- remote discovery/routes
```

Scope remains part of the DemandKey, so Contexts with different scopes do not match.

The registry holds only a weak reference. When the last Context in the process closes, the embedded runtime is destroyed; it is not an immortal default Context.

## Reentrant destruction

Application callbacks are allowed to close a Context or unregister an app. `HostRuntimeCore` snapshots app ids for delivery and defers app-map erasure until the outermost delivery returns. Interests are withdrawn immediately, while the executing callback object remains alive until dispatch completion.

This behavior is covered by ASan/UBSan regression.

## Next host boundary

This is process-level aggregation, not yet cross-process host aggregation. The next local-coordinator adapter will move the same AppId/InterestKey contract across Unix-domain sockets on Linux and the corresponding Windows local IPC mechanism while keeping data delivery direct/SHM rather than relaying normal payloads through the coordinator.
