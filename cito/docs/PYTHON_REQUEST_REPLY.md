# Python Request/Reply

Generated request types carry their generated reply type:

```python
GetStatus.REPLY_TYPE is Status
```

Register a handler:

```python
ctx.handle(
    GetStatus,
    lambda req: Status(
        battery=84,
        armed=True,
    ),
    resource="drone_17",
)
```

Send a request:

```python
status = await ctx.request(
    GetStatus(
        drone_id="drone_17"),
    resource="drone_17",
)
```

The normal success path returns the typed reply directly. Request failures raise
typed Python exceptions such as `cito.Unavailable`, `cito.Cancelled`, and
`cito.DeadlineExceeded`.

The handler lookup happens before request encoding. If no matching handler is
known for the exact scope/resource/request type, `request()` raises
`Unavailable` without serializing the request.

The current Python handler baseline is synchronous. Python request callers are
async so the API shape already matches the future event-loop/network path.
Async handler execution will be added only when it can be posted and completed
through the same Cito loop rather than creating a parallel Python runtime.
