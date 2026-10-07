#pragma once

#include <cstdint>
#include <stdexcept>
#include <string>
#include <string_view>
#include <type_traits>
#include <unordered_set>
#include <utility>
#include <vector>

namespace cito {

enum class TypeKind : std::uint8_t {
    Bool,
    Int32,
    UInt32,
    Int64,
    UInt64,
    Float32,
    Float64,
    String,
};

struct Field {
    std::uint32_t id{};
    std::string name;
    TypeKind kind{};
    bool optional{false};
    std::size_t bound{0};
};

class Type {
public:
    const std::string& name() const noexcept { return name_; }
    std::uint64_t type_id() const noexcept { return type_id_; }
    std::uint64_t schema_hash() const noexcept { return schema_hash_; }
    const std::vector<Field>& fields() const noexcept { return fields_; }

    const Field* find(std::string_view name) const noexcept {
        for (const auto& field : fields_) {
            if (field.name == name) {
                return &field;
            }
        }
        return nullptr;
    }

private:
    friend class TypeBuilder;
    std::string name_;
    std::uint64_t type_id_{};
    std::uint64_t schema_hash_{};
    std::vector<Field> fields_;
};

namespace detail {
inline std::uint64_t fnv1a(std::uint64_t hash, const void* data, std::size_t size) noexcept {
    const auto* bytes = static_cast<const unsigned char*>(data);
    for (std::size_t i = 0; i < size; ++i) {
        hash ^= bytes[i];
        hash *= 1099511628211ull;
    }
    return hash;
}

inline std::uint64_t hash_string(std::uint64_t hash, const std::string& value) noexcept {
    return fnv1a(hash, value.data(), value.size());
}

template <class T>
struct kind_of;

template <> struct kind_of<bool> { static constexpr TypeKind value = TypeKind::Bool; };
template <> struct kind_of<std::int32_t> { static constexpr TypeKind value = TypeKind::Int32; };
template <> struct kind_of<std::uint32_t> { static constexpr TypeKind value = TypeKind::UInt32; };
template <> struct kind_of<std::int64_t> { static constexpr TypeKind value = TypeKind::Int64; };
template <> struct kind_of<std::uint64_t> { static constexpr TypeKind value = TypeKind::UInt64; };
template <> struct kind_of<float> { static constexpr TypeKind value = TypeKind::Float32; };
template <> struct kind_of<double> { static constexpr TypeKind value = TypeKind::Float64; };
template <> struct kind_of<std::string> { static constexpr TypeKind value = TypeKind::String; };

template <class T>
constexpr TypeKind kind_of_v = kind_of<std::remove_cv_t<std::remove_reference_t<T>>>::value;
} // namespace detail

class TypeBuilder {
public:
    explicit TypeBuilder(std::string name) : name_(std::move(name)) {
        if (name_.empty()) {
            throw std::invalid_argument("Cito type name must not be empty");
        }
    }

    template <class T>
    TypeBuilder& member(std::uint32_t id, std::string name) {
        if (id == 0) {
            throw std::invalid_argument("Cito field id 0 is reserved");
        }
        if (name.empty()) {
            throw std::invalid_argument("Cito field name must not be empty");
        }
        fields_.push_back(Field{id, std::move(name), detail::kind_of_v<T>, false, 0});
        return *this;
    }

    TypeBuilder& optional() {
        last().optional = true;
        return *this;
    }

    TypeBuilder& bound(std::size_t max_length) {
        if (max_length == 0) {
            throw std::invalid_argument("Cito bound must be greater than zero");
        }
        auto& field = last();
        if (field.kind != TypeKind::String) {
            throw std::logic_error("Cito bound() prototype currently applies only to string fields");
        }
        field.bound = max_length;
        return *this;
    }

    Type build() const {
        std::unordered_set<std::uint32_t> ids;
        std::unordered_set<std::string> names;
        for (const auto& field : fields_) {
            if (!ids.insert(field.id).second) {
                throw std::invalid_argument("Duplicate Cito field id");
            }
            if (!names.insert(field.name).second) {
                throw std::invalid_argument("Duplicate Cito field name");
            }
        }

        Type type;
        type.name_ = name_;
        type.fields_ = fields_;

        constexpr std::uint64_t basis = 14695981039346656037ull;
        type.type_id_ = detail::hash_string(basis, type.name_);

        auto schema = type.type_id_;
        for (const auto& field : type.fields_) {
            schema = detail::fnv1a(schema, &field.id, sizeof(field.id));
            const auto kind = static_cast<std::uint8_t>(field.kind);
            schema = detail::fnv1a(schema, &kind, sizeof(kind));
            schema = detail::hash_string(schema, field.name);
            schema = detail::fnv1a(schema, &field.optional, sizeof(field.optional));
            schema = detail::fnv1a(schema, &field.bound, sizeof(field.bound));
        }
        type.schema_hash_ = schema;
        return type;
    }

private:
    Field& last() {
        if (fields_.empty()) {
            throw std::logic_error("Cito field modifier requires a preceding member()");
        }
        return fields_.back();
    }

    std::string name_;
    std::vector<Field> fields_;
};

} // namespace cito
