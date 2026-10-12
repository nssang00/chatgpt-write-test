# Cito IDL Request/Reply relation

Cito keeps Request/Reply **type-first**. A request is still an ordinary typed
message; the schema only records which typed reply belongs to it.

The minimal Cito-IDL extension is:

```idl
module acme {
  struct GetStatus {
    @id(1) string<32> drone_id;
  };

  struct Status {
    @id(1) unsigned long battery;
    @id(2) boolean armed;
  };

  request GetStatus returns Status;
};
```

This is a Cito extension to the supported OMG-IDL subset. It deliberately does
not require a service, client, stub, endpoint, or method object.

Generated C++ exposes the relation through:

```cpp
cito::ReplyTypeT<acme::GetStatus>  // acme::Status
```

Generated Python exposes:

```python
GetStatus.REPLY_TYPE is Status
```

The intended public API can therefore remain intent-first:

```cpp
auto status =
    co_await ctx.request(
        "drone_17",
        GetStatus{});

ctx.handle<GetStatus>(
    "drone_17",
    handler);
```

and:

```python
status = await ctx.request(
    GetStatus(drone_id="drone_17"),
    resource="drone_17",
)

ctx.handle(
    GetStatus,
    handler,
    resource="drone_17",
)
```

The relation metadata does not alter the CTO1 encoding of either struct. It is
compile-time/generated API metadata and can also be derived by future
`.proto` migration tooling from protobuf service method request/response
pairs.
