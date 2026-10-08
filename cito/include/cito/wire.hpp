#pragma once

#include <cito/dynamic.hpp>

#include <bit>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace cito::wire {

class Error : public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};

struct Header {
    std::uint64_t type_id{};
    std::uint64_t schema_hash{};
    std::uint32_t field_count{};
};

DynamicData decode(const Type& target, const std::vector<std::uint8_t>& bytes);
std::vector<std::uint8_t> encode(const DynamicData& data);

namespace detail {

inline void write_u8(std::vector<std::uint8_t>& out, std::uint8_t v) {
    out.push_back(v);
}

inline void write_u32(std::vector<std::uint8_t>& out, std::uint32_t v) {
    for (int i = 0; i < 4; ++i) {
        out.push_back(static_cast<std::uint8_t>((v >> (i * 8)) & 0xffu));
    }
}

inline void write_u64(std::vector<std::uint8_t>& out, std::uint64_t v) {
    for (int i = 0; i < 8; ++i) {
        out.push_back(static_cast<std::uint8_t>((v >> (i * 8)) & 0xffu));
    }
}

inline std::uint8_t read_u8(const std::vector<std::uint8_t>& in, std::size_t& pos) {
    if (pos + 1 > in.size()) throw Error("Cito wire: truncated u8");
    return in[pos++];
}

inline std::uint32_t read_u32(const std::vector<std::uint8_t>& in, std::size_t& pos) {
    if (pos + 4 > in.size()) throw Error("Cito wire: truncated u32");
    std::uint32_t v = 0;
    for (int i = 0; i < 4; ++i) {
        v |= static_cast<std::uint32_t>(in[pos++]) << (i * 8);
    }
    return v;
}

inline std::uint64_t read_u64(const std::vector<std::uint8_t>& in, std::size_t& pos) {
    if (pos + 8 > in.size()) throw Error("Cito wire: truncated u64");
    std::uint64_t v = 0;
    for (int i = 0; i < 8; ++i) {
        v |= static_cast<std::uint64_t>(in[pos++]) << (i * 8);
    }
    return v;
}

inline const Field* find_by_id(const Type& type, std::uint32_t id) noexcept {
    for (const auto& field : type.fields()) {
        if (field.id == id) return &field;
    }
    return nullptr;
}

inline std::vector<std::uint8_t> slice(
    const std::vector<std::uint8_t>& in,
    std::size_t pos,
    std::size_t len) {
    if (pos + len > in.size()) {
        throw Error("Cito wire: truncated payload");
    }
    return {
        in.begin() + static_cast<std::ptrdiff_t>(pos),
        in.begin() + static_cast<std::ptrdiff_t>(pos + len)};
}

inline std::vector<std::uint8_t> encode_value(
    const TypeSpec& spec,
    const DynamicValue& value) {
    DynamicData::validate(spec, value);
    std::vector<std::uint8_t> out;

    switch (spec.kind) {
        case TypeKind::Bool:
            write_u8(out, std::get<bool>(value) ? 1u : 0u);
            break;
        case TypeKind::Int32:
        case TypeKind::Enum:
            write_u32(out, static_cast<std::uint32_t>(std::get<std::int32_t>(value)));
            break;
        case TypeKind::UInt32:
            write_u32(out, std::get<std::uint32_t>(value));
            break;
        case TypeKind::Int64:
            write_u64(out, static_cast<std::uint64_t>(std::get<std::int64_t>(value)));
            break;
        case TypeKind::UInt64:
            write_u64(out, std::get<std::uint64_t>(value));
            break;
        case TypeKind::Float32:
            write_u32(out, std::bit_cast<std::uint32_t>(std::get<float>(value)));
            break;
        case TypeKind::Float64:
            write_u64(out, std::bit_cast<std::uint64_t>(std::get<double>(value)));
            break;
        case TypeKind::String: {
            const auto& text = std::get<std::string>(value);
            out.insert(out.end(), text.begin(), text.end());
            break;
        }
        case TypeKind::Struct: {
            const auto& nested = std::get<DynamicStruct>(value);
            out = encode(*nested);
            break;
        }
        case TypeKind::Array:
        case TypeKind::Sequence: {
            const auto& list = std::get<DynamicListPtr>(value);
            if (list->values.size() > std::numeric_limits<std::uint32_t>::max()) {
                throw Error("Cito wire: container too large");
            }

            write_u32(out, static_cast<std::uint32_t>(list->values.size()));
            for (const auto& item : list->values) {
                auto payload = encode_value(*spec.element, item);
                if (payload.size() > std::numeric_limits<std::uint32_t>::max()) {
                    throw Error("Cito wire: element too large");
                }
                write_u32(out, static_cast<std::uint32_t>(payload.size()));
                out.insert(out.end(), payload.begin(), payload.end());
            }
            break;
        }
    }

    return out;
}

inline DynamicValue decode_value(
    const TypeSpec& spec,
    const std::vector<std::uint8_t>& in,
    std::size_t pos,
    std::uint32_t len) {
    auto expect = [len](std::uint32_t n) {
        if (len != n) {
            throw Error("Cito wire: invalid fixed-width field length");
        }
    };
    auto p = pos;

    switch (spec.kind) {
        case TypeKind::Bool:
            expect(1);
            return read_u8(in, p) != 0;
        case TypeKind::Int32:
        case TypeKind::Enum:
            expect(4);
            return static_cast<std::int32_t>(read_u32(in, p));
        case TypeKind::UInt32:
            expect(4);
            return read_u32(in, p);
        case TypeKind::Int64:
            expect(8);
            return static_cast<std::int64_t>(read_u64(in, p));
        case TypeKind::UInt64:
            expect(8);
            return read_u64(in, p);
        case TypeKind::Float32:
            expect(4);
            return std::bit_cast<float>(read_u32(in, p));
        case TypeKind::Float64:
            expect(8);
            return std::bit_cast<double>(read_u64(in, p));
        case TypeKind::String:
            return std::string(
                reinterpret_cast<const char*>(in.data() + pos),
                len);
        case TypeKind::Struct: {
            if (!spec.referenced_type) {
                throw Error("Cito wire: nested struct schema unavailable");
            }
            return std::make_shared<DynamicData>(
                decode(*spec.referenced_type, slice(in, pos, len)));
        }
        case TypeKind::Array:
        case TypeKind::Sequence: {
            if (!spec.element) {
                throw Error("Cito wire: container element schema unavailable");
            }

            const auto end = pos + len;
            if (end > in.size()) {
                throw Error("Cito wire: truncated container");
            }

            auto list = std::make_shared<DynamicList>();
            const auto count = read_u32(in, p);

            if (spec.kind == TypeKind::Array && count != spec.extent) {
                throw Error("Cito wire: array extent mismatch");
            }
            if (spec.kind == TypeKind::Sequence &&
                spec.bound != 0 &&
                count > spec.bound) {
                throw Error("Cito wire: sequence bound exceeded");
            }

            list->values.reserve(count);
            for (std::uint32_t i = 0; i < count; ++i) {
                const auto item_len = read_u32(in, p);
                if (p + item_len > end) {
                    throw Error("Cito wire: truncated container element");
                }
                list->values.push_back(
                    decode_value(*spec.element, in, p, item_len));
                p += item_len;
            }

            if (p != end) {
                throw Error("Cito wire: trailing container bytes");
            }

            DynamicValue result = list;
            DynamicData::validate(spec, result);
            return result;
        }
    }

    throw Error("Cito wire: unsupported type kind");
}

} // namespace detail

inline Header inspect_header(const std::vector<std::uint8_t>& bytes) {
    if (bytes.size() < 24 ||
        bytes[0] != 'C' ||
        bytes[1] != 'T' ||
        bytes[2] != 'O' ||
        bytes[3] != '1') {
        throw Error("Cito wire: invalid header");
    }

    std::size_t pos = 4;
    Header h;
    h.type_id = detail::read_u64(bytes, pos);
    h.schema_hash = detail::read_u64(bytes, pos);
    h.field_count = detail::read_u32(bytes, pos);
    return h;
}

inline std::vector<std::uint8_t> encode(const DynamicData& data) {
    std::vector<std::uint8_t> out;
    out.reserve(32);

    out.push_back('C');
    out.push_back('T');
    out.push_back('O');
    out.push_back('1');
    detail::write_u64(out, data.type().type_id());
    detail::write_u64(out, data.type().schema_hash());

    std::uint32_t count = 0;
    for (std::size_t i = 0; i < data.type().fields().size(); ++i) {
        if (data.value_at(i)) ++count;
    }
    detail::write_u32(out, count);

    for (std::size_t i = 0; i < data.type().fields().size(); ++i) {
        const auto& maybe = data.value_at(i);
        if (!maybe) continue;

        const auto& field = data.type().fields()[i];
        auto payload = detail::encode_value(field.type, *maybe);

        if (payload.size() > std::numeric_limits<std::uint32_t>::max()) {
            throw Error("Cito wire: field too large");
        }

        detail::write_u32(out, field.id);
        detail::write_u8(out, static_cast<std::uint8_t>(field.type.kind));
        detail::write_u32(out, static_cast<std::uint32_t>(payload.size()));
        out.insert(out.end(), payload.begin(), payload.end());
    }

    return out;
}

inline DynamicData decode(
    const Type& target,
    const std::vector<std::uint8_t>& bytes) {
    const auto header = inspect_header(bytes);
    if (header.type_id != target.type_id()) {
        throw Error("Cito wire: TypeId mismatch");
    }

    DynamicData data(target);
    std::size_t pos = 24;

    for (std::uint32_t i = 0; i < header.field_count; ++i) {
        const auto field_id = detail::read_u32(bytes, pos);
        const auto encoded_kind_raw = detail::read_u8(bytes, pos);

        if (encoded_kind_raw > static_cast<std::uint8_t>(TypeKind::Sequence)) {
            throw Error("Cito wire: unknown field kind");
        }

        const auto encoded_kind = static_cast<TypeKind>(encoded_kind_raw);
        const auto len = detail::read_u32(bytes, pos);

        if (pos + len > bytes.size()) {
            throw Error("Cito wire: truncated field payload");
        }

        if (const auto* field = detail::find_by_id(target, field_id)) {
            if (field->type.kind != encoded_kind) {
                throw Error("Cito wire: incompatible field kind");
            }

            data.set_value(
                field->name,
                detail::decode_value(field->type, bytes, pos, len));
        }

        pos += len;
    }

    if (pos != bytes.size()) {
        throw Error("Cito wire: trailing bytes");
    }

    for (const auto& field : target.fields()) {
        if (!field.optional && !data.has(field.name)) {
            throw Error("Cito wire: required field missing");
        }
    }

    return data;
}

} // namespace cito::wire
