# Cito Typed Python IDL

The Cito IDL compiler can generate both C++ and Python from the same OMG IDL subset.

```bash
python tools/cito_idlc.py schema.idl --lang cpp -o schema.hpp
python tools/cito_idlc.py schema.idl --lang python -o schema.py
```

Generated Python uses `dataclass` for structs and `IntEnum` for enums. Every generated struct exposes:

```python
value.encode()          # canonical Cito CTO1 wire
Position.decode(bytes)  # typed decode
Position.TYPE_ID
Position.SCHEMA_HASH
```

Python and C++ do not maintain separate schema rules. Both use the same field ids, type kinds, bounds, optional flags, TypeId algorithm, SchemaHash algorithm, and tagged wire layout.

The regression suite validates both directions:

```text
C++ generated Position -> bytes -> Python generated Position
Python generated Position -> bytes -> C++ generated Position
```

and requires the encoded bytes to match exactly for the same value.

TypeId/SchemaHash numeric inputs are canonical little-endian bytes. This removes native-endian/platform layout from identity computation before the Python/Windows compatibility surface is frozen.

The Python runtime codec is currently a correctness/interoperability path. Production performance work may later add generated field-specialized Python fast paths without changing the wire or public generated class API.
