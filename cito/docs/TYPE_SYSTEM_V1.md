# Cito Type System v1 — Direction

## Goal

Keep the normal application path strongly typed and trivial while allowing simulation, gateways, inspectors, and expert tooling to construct and manipulate the same message types dynamically.

## One canonical type system

The following are frontends to the same type identity and schema model:

- OMG IDL subset (primary schema source)
- generated C++ types (normal application path)
- `TypeBuilder` (optional advanced API)
- `DynamicData` (optional simulation/tooling API)

They must converge on the same `TypeId`, stable `FieldId`s, schema shape, and eventual wire representation.

## Public layering

Normal applications should only need:

```cpp
#include <cito/cito.hpp>

cito::Context ctx;
ctx.on<Position>(handler);
ctx.publish(Position{...});
```

Advanced users opt in explicitly:

```cpp
#include <cito/dynamic.hpp>

auto type = cito::TypeBuilder("acme.navigation.Position")
    .member<double>(1, "x")
    .member<double>(2, "y")
    .member<std::string>(3, "frame").bound(16)
    .build();

cito::DynamicData data(type);
data["x"] = 1.0;
data.set("y", 2.0);
```

The advanced API must not add runtime or conceptual cost to users that do not include or use it.

## Current prototype rules

- Type logical identity is based on canonical type name.
- Schema identity changes when fields or relevant field properties change.
- Field IDs are explicit, non-zero, and unique within a struct.
- Field names are metadata/tooling names, not intended to be transmitted on every data message.
- Unknown/evolution semantics and final wire hashes are not yet frozen.
- `bound()` currently demonstrates bounded string metadata only; arrays, sequences, nested structs, and their unambiguous fluent syntax are intentionally deferred until the canonical model is reviewed.

## Deferred until measured/needed

- DDS-style keys/instances
- arbitrary annotations
- complex assignability rules
- arrays/sequences/nested builders
- final hash algorithm and hash width
- dynamic-to-generated wire interoperability
- compact/delimited/tagged encoding selection
