# Cito Python v1

The Python binding sits on the C ABI rather than the C++ ABI and initially exposes the common type_id + resource + bytes boundary.

Example:

    ctx = cito.Context('acme')
    sub = ctx.on(100, handler, 'drone_17')
    ctx.publish(100, b'hello', 'drone_17')

IDL-generated typed Python helpers are a later layer over the same runtime and wire contract.
