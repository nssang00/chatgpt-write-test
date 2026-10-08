#pragma once

#include <cito/wire.hpp>

#include <array>
#include <memory>
#include <string>
#include <type_traits>
#include <vector>

namespace cito {

template <class T>
struct StaticType;

template <class T>
struct StaticEnum;

template <class T>
Type type_of() {
    return StaticType<T>::type();
}

template <class T>
DynamicData to_dynamic(const T& value) {
    return StaticType<T>::to_dynamic(value);
}

template <class T>
T from_dynamic(const DynamicData& data) {
    return StaticType<T>::from_dynamic(data);
}

namespace detail {

template <class T>
struct is_std_array : std::false_type {};

template <class T, std::size_t N>
struct is_std_array<std::array<T, N>> : std::true_type {};

template <class T>
struct is_std_vector : std::false_type {};

template <class T, class Allocator>
struct is_std_vector<std::vector<T, Allocator>> : std::true_type {};

template <class T>
inline constexpr bool scalar_dynamic_v =
    std::is_same_v<T, bool> ||
    std::is_same_v<T, std::int32_t> ||
    std::is_same_v<T, std::uint32_t> ||
    std::is_same_v<T, std::int64_t> ||
    std::is_same_v<T, std::uint64_t> ||
    std::is_same_v<T, float> ||
    std::is_same_v<T, double> ||
    std::is_same_v<T, std::string>;

} // namespace detail

template <class T>
DynamicValue to_dynamic_value(const T& value) {
    using V = std::remove_cv_t<std::remove_reference_t<T>>;

    if constexpr (detail::scalar_dynamic_v<V>) {
        return DynamicValue{value};
    } else if constexpr (std::is_enum_v<V>) {
        return DynamicValue{static_cast<std::int32_t>(value)};
    } else if constexpr (
        detail::is_std_array<V>::value ||
        detail::is_std_vector<V>::value) {
        auto list = std::make_shared<DynamicList>();
        list->values.reserve(value.size());

        using Item = typename V::value_type;
        for (const auto& item : value) {
            list->values.push_back(
                to_dynamic_value(static_cast<Item>(item)));
        }

        return DynamicValue{std::move(list)};
    } else {
        return DynamicValue{
            std::make_shared<DynamicData>(to_dynamic(value))};
    }
}

template <class T>
T from_dynamic_value(const DynamicValue& value) {
    using V = std::remove_cv_t<std::remove_reference_t<T>>;

    if constexpr (detail::scalar_dynamic_v<V>) {
        return std::get<V>(value);
    } else if constexpr (std::is_enum_v<V>) {
        return static_cast<V>(std::get<std::int32_t>(value));
    } else if constexpr (detail::is_std_array<V>::value) {
        const auto& list = std::get<DynamicListPtr>(value);
        if (!list) {
            throw std::invalid_argument("Cito dynamic array is null");
        }

        V out{};
        if (list->values.size() != out.size()) {
            throw std::length_error("Cito dynamic array size mismatch");
        }

        using Item = typename V::value_type;
        for (std::size_t i = 0; i < out.size(); ++i) {
            out[i] = from_dynamic_value<Item>(list->values[i]);
        }
        return out;
    } else if constexpr (detail::is_std_vector<V>::value) {
        const auto& list = std::get<DynamicListPtr>(value);
        if (!list) {
            throw std::invalid_argument("Cito dynamic sequence is null");
        }

        V out;
        out.reserve(list->values.size());
        using Item = typename V::value_type;
        for (const auto& item : list->values) {
            out.push_back(from_dynamic_value<Item>(item));
        }
        return out;
    } else {
        const auto& nested = std::get<DynamicStruct>(value);
        if (!nested) {
            throw std::invalid_argument("Cito dynamic struct is null");
        }
        return from_dynamic<V>(*nested);
    }
}

template <class T>
std::vector<std::uint8_t> encode(const T& value) {
    return wire::encode(to_dynamic(value));
}

template <class T>
T decode(const std::vector<std::uint8_t>& bytes) {
    return from_dynamic<T>(wire::decode(type_of<T>(), bytes));
}

} // namespace cito
