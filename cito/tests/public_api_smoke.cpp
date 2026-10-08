#include <cito/cito.hpp>

#include <cassert>
#include <string>

struct Position {
    double x;
    double y;
};

int main() {
    cito::Context ctx("smoke");

    int calls = 0;
    auto subscription = ctx.on<Position>("drone_17", [&](const Position& p) {
        ++calls;
        assert(p.x == 1.0);
        assert(p.y == 2.0);
    });

    assert(ctx.scope() == "smoke");
    assert(ctx.publish("drone_17", Position{1.0, 2.0}) == 1);
    assert(ctx.publish("drone_18", Position{1.0, 2.0}) == 0);

    ctx.run();
    assert(calls == 1);

    return 0;
}
