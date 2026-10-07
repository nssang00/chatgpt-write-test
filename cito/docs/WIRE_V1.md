# Cito Wire v1 — Prototype Direction

This document describes the current prototype used to validate schema evolution. It is not a frozen wire specification.

## User-visible rule

Schema evolution should work by default without transmitting field names on every message.

## Prototype tagged representation

Envelope:

```text
magic/version
TypeId
SchemaHash
field-count
```

Each present field:

```text
FieldId
TypeKind
payload-length
payload
```

Field names remain schema/tooling metadata and are not included in the data record.

## Evolution behavior currently tested

- same schema: round-trip
- newer sender -> older receiver: unknown FieldId is skipped
- older sender -> newer receiver: newly added optional field may be absent
- same FieldId with incompatible kind: rejected
- different TypeId: rejected
- truncated/corrupt payload: rejected
- field rename with stable FieldId/kind remains readable at the wire level

## Important non-final details

- TypeId and SchemaHash algorithms are prototype-only and are not yet cross-platform wire contracts.
- Only scalar/string DynamicData is encoded today.
- Required/optional semantics are intentionally minimal.
- Arrays, sequences, nested structs, enums, unknown-field preservation, generated/static type codecs, and zero-copy views are not implemented yet.
- Compact or delimited fast paths are deferred until this tagged representation is benchmarked and the type model is stable.

The intended long-term rule remains: simple/evolvable by default, with faster representations added only when they provide measured value and without changing the application API.
