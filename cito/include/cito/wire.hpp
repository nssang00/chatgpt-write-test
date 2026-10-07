#pragma once

#include <cito/dynamic.hpp>

#include <bit>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace cito::wire {

class Error : public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};

namespace detail {
inline void write_u8(std::vector<std::uint8_t>& out, std::uint8_t v) {
    out.push_back(v);
}

inline void write_u32(std::vector<std::uint8_t>& out, std::uint32_t v) {
    for (int i = 0; i < 4; ++i) out.push_back(static_cast<std::uint8_t>((v >> (i * 8)) & 0xffu));
}

inline void write_u64(std::vector<std::uint8_t>& out, std::uint64_t v) {
    for (int i = 0; i < 8; ++i) out.push_back(static_cast<std::uint8_t>((v >> (i * 8)) & 0xffu));
}

inline std::uint8_t read_u8(const std::vector<std::uint8_t>& in, std::size_t& pos) {
    if (pos + 1 > in.size()) throw Error("Cito wire: truncated u8");
    return in[pos++];
}

inline std::uint32_t read_u32(const std::vector<std::uint8_t>& in, std::size_t& pos) {
    if (pos + 4 > in.size()) throw Error("Cito wire: truncated u32");
    std::uint32_t v = 0;
    for (int i = 0; i < 4; ++i) v |= static_cast<std::uint32_t>(in[pos++]) << (i * 8);
    return v;
}

inline std::uint64_t read_u64(const std::vector<std::uint8_t>& in, std::size_t& pos) {
    if (pos + 8 > in.size()) throw Error("Cito wire: truncated u64");
    std::uint64_t v = 0;
    for (int i = 0; i < 8; ++i) v |= static_cast<std::uint64_t>(in[pos++]) << (i * 8);
    return v;
}

inline const Field* find_by_id(const Type& type, std::uint32_t id) noexcept {
    for (const auto& field : type.fields()) {
        if (field.id == id) return &field;
    }
    return nullptr;
}

inline void append_value(std::vector<std::uint8_t>& out, const DynamicValue& value) {
    std::visit([&](const auto& v) {
        using V = std::decay_t<decltype(v)>;
        if constexpr (std::is_same_v<V, bool>) {
            write_u8(out, v ? 1u : 0u);
        } else if constexpr (std::is_same_v<V, std::int32_t>) {
            write_u32(out, static_cast<std::uint32_t>(v));
        } else if constexpr (std::is_same_v<V, std::uint32_t>) {
            write_u32(out, v);
        } else if constexpr (std::is_same_v<V, std::int64_t>) {
            write_u64(out, static_cast<std::uint64_t>(v));
        } else if constexpr (std::is_same_v<V, std::uint64_t>) {
            write_u64(out, v);
        } else if constexpr (std::is_same_v<V, float>) {
            write_u32(out, std::bit_cast<std::uint32_t>(v));
        } else if constexpr (std::is_same_v<V, double>) {
            write_u64(out, std::bit_cast<std::uint64_t>(v));
        } else if constexpr (std::is_same_v<V, std::string>) {
            out.insert(out.end(), v.begin(), v.end());
        }
    }, value);
}

inline std::size_t encoded_size(const DynamicValue& value) {
    return std::visit([](const auto& v) -> std::size_t {
        using V = std::decay_t<decltype(v)>;
        if constexpr (std::is_same_v<V, bool>) return 1;
        else if constexpr (std::is_same_v<V, std::int32_t> || std::is_same_v<V, std::uint32_t> || std::is_same_v<V, float>) return 4;
        else if constexpr (std::is_same_v<V, std::int64_t> || std::is_same_v<V, std::uint64_t> || std::is_same_v<V, double>) return 8;
        else return v.size();
    }, value);
}

inline DynamicValue decode_value(TypeKind kind, const std::vector<std::uint8_t>& in, std::size_t pos, std::uint32_t len) {
    auto expect = [len](std::uint32_t n) {
        if (len != n) throw Error("Cito wire: invalid fixed-width field length");
    };
    auto p = pos;
    switch (kind) {
        case TypeKind::Bool:
            expect(1);
            return read_u8(in, p) != 0;
        case TypeKind::Int32:
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
            return std::string(reinterpret_cast<const char*>(in.data() + pos), len);
    }
    throw Error("Cito wire: unsupported type kind");
}

inline void set_dynamic(DynamicData& data, const Field& field, DynamicValue value) {
    std::visit([&](auto&& v) { data.set(field.name, std::forward<decltype(v)>(v)); }, std::move(value));
}
} // namespace detail

struct Header {
    std::uint64_t type_id{};
    std::uint64_t schema_hash{};
    std::uint32_t field_count{};
};

inline std::vector<std::uint8_t> encode(const DynamicData& data) {
    std::vector<std::uint8_t> out;
    out.reserve(32);
    out.push_back('C'); out.push_back('T'); out.push_back('O'); out.push_back('1');
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
        const auto len = detail::encoded_size(*maybe);
        if (len > 0xffffffffu) throw Error("Cito wire: field too large");
        detail::write_u32(out, field.id);
        detail::write_u8(out, static_cast<std::uint8_t>(field.kind));
        detail::write_u32(out, static_cast<std::uint32_t>(len));
        detail::append_value(out, *maybe);
    }
    return out;
}

inline Header inspect_header(const std::vector<std::uint8_t>& bytes) {
    if (bytes.size() < 24 || bytes[0] != 'C' || bytes[1] != 'T' || bytes[2] != 'O' || bytes[3] != '1') {
        throw Error("Cito wire: invalid header");
    }
    std::size_t pos = 4;
    Header h;
    h.type_id = detail::read_u64(bytes, pos);
    h.schema_hash = detail::read_u64(bytes, pos);
    h.field_count = detail::read_u32(bytes, pos);
    return h;
}

inline DynamicData decode(const Type& target, const std::vector<std::uint8_t>& bytes) {
    const auto header = inspect_header(bytes);
    if (header.type_id != target.type_id()) {
        throw Error("Cito wire: TypeId mismatch");
    }

    DynamicData data(target);
    std::size_t pos = 24;
    for (std::uint32_t i = 0; i < header.field_count; ++i) {
        const auto field_id = detail::read_u32(bytes, pos);
        const auto encoded_kind = static_cast<TypeKind>(detail::read_u8(bytes, pos));
        const auto len = detail::read_u32(bytes, pos);
        if (pos + len > bytes.size()) throw Error("Cito wire: truncated field payload");

        if (const auto* field = detail::find_by_id(target, field_id)) {
            if (field->kind != encoded_kind) {
                throw Error("Cito wire: incompatible field kind");
            }
            auto value = detail::decode_value(encoded_kind, bytes, pos, len);
            detail::set_dynamic(data, *field, std::move(value));
        }
        pos += len;
    }

    if (pos != bytes.size()) throw Error("Cito wire: trailing bytes");

    for (const auto& field : target.fields()) {
        if (!field.optional && !data.has(field.name)) {
            throw Error("Cito wire: required field missing");
        }
    }
    return data;
}

} // namespace cito::wire
