#include "telemetry.hpp"
#include <cassert>

int main() {
    acme::Telemetry value{};
    value.pose.x = 1.0;
    value.mode = acme::Mode::Active;
    value.coefficients[0] = 3.0f;
    value.tags.push_back("alpha");

    const auto type = cito::type_of<acme::Telemetry>();
    assert(type.name() == "acme.Telemetry");
    assert(type.find("pose")->type.kind == cito::TypeKind::Struct);
    assert(type.find("mode")->type.kind == cito::TypeKind::Enum);
    assert(type.find("coefficients")->type.kind == cito::TypeKind::Array);
    assert(type.find("tags")->type.kind == cito::TypeKind::Sequence);
    return 0;
}
