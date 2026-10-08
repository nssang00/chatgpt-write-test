#pragma once
#include <cito/wire.hpp>
#include <type_traits>
#include <vector>

namespace cito {

template<class T> struct StaticType;
template<class T> struct StaticEnum;

template<class T>
Type type_of() { return StaticType<T>::type(); }

template<class T>
DynamicData to_dynamic(const T& value) {
    static_assert(StaticType<T>::dynamic_supported,
                  "Cito: DynamicData conversion is not available for this generated type yet");
    return StaticType<T>::to_dynamic(value);
}

template<class T>
T from_dynamic(const DynamicData& data) {
    static_assert(StaticType<T>::dynamic_supported,
                  "Cito: DynamicData conversion is not available for this generated type yet");
    return StaticType<T>::from_dynamic(data);
}

template<class T>
std::vector<std::uint8_t> encode(const T& value) {
    return wire::encode(to_dynamic(value));
}

template<class T>
T decode(const std::vector<std::uint8_t>& bytes) {
    return from_dynamic<T>(wire::decode(type_of<T>(), bytes));
}

} // namespace cito
