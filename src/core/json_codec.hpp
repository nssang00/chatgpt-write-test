#ifndef NATIVEWEB_JSON_CODEC_HPP_INCLUDED
#define NATIVEWEB_JSON_CODEC_HPP_INCLUDED

#include "nativeweb/any.hpp"

#include <string>

namespace nativeweb {
namespace detail {

std::string anyToJson(const Any& value);
Any jsonToAny(const std::string& json);

} // namespace detail
} // namespace nativeweb

#endif
