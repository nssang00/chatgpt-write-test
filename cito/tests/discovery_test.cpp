#include <cito/discovery.hpp>

#include <cassert>

int main() {
    cito::InterestAdvertisement add;
    add.op = cito::InterestOp::Add;
    add.data_port = 48001;
    add.lease_ms = 500;
    add.destination = 7;
    add.key = {1, 2, 3};

    const auto bytes = cito::encode_interest(add);
    const auto decoded = cito::decode_interest(bytes);

    assert(decoded.op == add.op);
    assert(decoded.data_port == add.data_port);
    assert(decoded.lease_ms == add.lease_ms);
    assert(decoded.destination == add.destination);
    assert(decoded.key == add.key);

    cito::InterestIndex index;
    cito::InterestLeaseTable leases(index);

    assert(leases.observe(add, 1000));
    assert(index.lookup(add.key).contains(7));

    assert(!leases.observe(add, 1200));
    assert(leases.expire(1499) == 0);
    assert(leases.expire(1700) == 1);
    assert(index.lookup(add.key).empty());

    leases.observe(add, 2000);
    auto remove = add;
    remove.op = cito::InterestOp::Remove;
    remove.lease_ms = 0;
    assert(leases.observe(remove, 2100));
    assert(index.lookup(add.key).empty());

    auto truncated = bytes;
    truncated.pop_back();
    bool failed = false;
    try {
        (void)cito::decode_interest(truncated);
    } catch (const std::runtime_error&) {
        failed = true;
    }
    assert(failed);

    return 0;
}
