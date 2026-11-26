#pragma once
#include <intraflow.hpp>
#include <cstddef>

namespace intraflow { namespace detail {
// Shape validation is applied on both encode and decode.
// Bounded string counts UTF-8 bytes, not Unicode code points.
inline void validateShape(const Json& value, const Json& schema) {
    if (schema.is_object()) {
        if (!value.is_object()) throw std::invalid_argument("expected struct object");
        for (const auto& field : schema.at("fields")) {
            const auto name = field.at(0).get<std::string>();
            validateShape(value.at(name), field.at(1));
        }
    } else if (schema.is_array()) {
        const auto kind = schema.at(0).get<std::string>();
        if (kind == "string") {
            if (!value.is_string() || value.get_ref<const std::string&>().size() > schema.at(1).get<std::size_t>())
                throw std::invalid_argument("bounded string overflow or invalid type");
        } else if (kind == "array" || kind == "sequence") {
            if (!value.is_array()) throw std::invalid_argument("expected JSON array");
            if (kind == "array" && value.size() != schema.at(2).get<std::size_t>())
                throw std::invalid_argument("fixed array size mismatch");
            if (kind == "sequence" && schema.size() == 3 && value.size() > schema.at(2).get<std::size_t>())
                throw std::invalid_argument("bounded sequence overflow");
            for (const auto& entry : value) validateShape(entry, schema.at(1));
        }
    }
}
}}
