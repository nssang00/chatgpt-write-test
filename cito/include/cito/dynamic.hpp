#pragma once

#include <cito/type.hpp>

#include <cstdint>
#include <optional>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <utility>
#include <variant>
#include <vector>

namespace cito {

using DynamicValue = std::variant<
    bool,
    std::int32_t,
    std::uint32_t,
    std::int64_t,
    std::uint64_t,
    float,
    double,
    std::string>;

class DynamicData {
public:
    explicit DynamicData(Type type) : type_(std::move(type)), values_(type_.fields().size()) {}

    const Type& type() const noexcept { return type_; }

    template <class T>
    void set(const std::string& field_name, T&& value) {
        const auto index = find_index(field_name);
        const auto& field = type_.fields()[index];
        DynamicValue normalized = normalize(std::forward<T>(value));
        if (!matches(field.kind, normalized)) {
            throw std::invalid_argument("DynamicData value type does not match Cito field type");
        }
        if (field.kind == TypeKind::String && field.bound != 0 &&
            std::get<std::string>(normalized).size() > field.bound) {
            throw std::length_error("DynamicData string exceeds Cito bound");
        }
        values_[index] = std::move(normalized);
    }

    template <class T>
    const T& get(const std::string& field_name) const {
        const auto index = find_index(field_name);
        if (!values_[index]) {
            throw std::logic_error("DynamicData field is not set");
        }
        return std::get<T>(*values_[index]);
    }

    bool has(const std::string& field_name) const {
        return values_[find_index(field_name)].has_value();
    }

    const std::optional<DynamicValue>& value_at(std::size_t index) const {
        return values_.at(index);
    }

    class FieldProxy {
    public:
        FieldProxy(DynamicData& owner, std::string name) : owner_(owner), name_(std::move(name)) {}

        template <class T>
        FieldProxy& operator=(T&& value) {
            owner_.set(name_, std::forward<T>(value));
            return *this;
        }

    private:
        DynamicData& owner_;
        std::string name_;
    };

    FieldProxy operator[](std::string field_name) {
        (void)find_index(field_name);
        return FieldProxy(*this, std::move(field_name));
    }

private:
    std::size_t find_index(const std::string& name) const {
        const auto& fields = type_.fields();
        for (std::size_t i = 0; i < fields.size(); ++i) {
            if (fields[i].name == name) {
                return i;
            }
        }
        throw std::out_of_range("Unknown Cito DynamicData field: " + name);
    }

    static bool matches(TypeKind kind, const DynamicValue& value) noexcept {
        switch (kind) {
            case TypeKind::Bool: return std::holds_alternative<bool>(value);
            case TypeKind::Int32: return std::holds_alternative<std::int32_t>(value);
            case TypeKind::UInt32: return std::holds_alternative<std::uint32_t>(value);
            case TypeKind::Int64: return std::holds_alternative<std::int64_t>(value);
            case TypeKind::UInt64: return std::holds_alternative<std::uint64_t>(value);
            case TypeKind::Float32: return std::holds_alternative<float>(value);
            case TypeKind::Float64: return std::holds_alternative<double>(value);
            case TypeKind::String: return std::holds_alternative<std::string>(value);
        }
        return false;
    }

    static DynamicValue normalize(const char* value) { return std::string(value); }
    static DynamicValue normalize(char* value) { return std::string(value); }

    template <class T>
    static DynamicValue normalize(T&& value) {
        using V = std::remove_cv_t<std::remove_reference_t<T>>;
        if constexpr (std::is_same_v<V, std::string>) {
            return std::forward<T>(value);
        } else {
            return DynamicValue{std::forward<T>(value)};
        }
    }

    Type type_;
    std::vector<std::optional<DynamicValue>> values_;
};

} // namespace cito
