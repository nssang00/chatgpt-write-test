#ifndef NATIVEWEB_DETAIL_ASYNC_HPP_INCLUDED
#define NATIVEWEB_DETAIL_ASYNC_HPP_INCLUDED

#include "nativeweb/any.hpp"

#include <cstddef>
#include <future>
#include <memory>
#include <utility>

namespace nativeweb {
namespace detail {

inline Any toAny(const char* value)
{
    return Any(value);
}

template <std::size_t N>
Any toAny(const char (&value)[N])
{
    return Any(static_cast<const char*>(value));
}

template <typename T>
Any toAny(const T& value)
{
    return Any(value);
}

inline void appendArguments(VariantList&)
{
}

template <typename First, typename... Rest>
void appendArguments(
    VariantList& output,
    const First& first,
    const Rest&... rest)
{
    output.push_back(toAny(first));
    appendArguments(output, rest...);
}

template <typename Result>
class FutureCaster
{
public:
    explicit FutureCaster(std::future<Any>&& future)
        : future_(std::move(future))
    {
    }

    FutureCaster(FutureCaster&& other)
        : future_(std::move(other.future_))
    {
    }

    Result operator()()
    {
        Any value = future_.get();
        return AnyCast<Result>(value);
    }

private:
    FutureCaster(const FutureCaster&);
    FutureCaster& operator=(const FutureCaster&);

    std::future<Any> future_;
};

template <>
class FutureCaster<void>
{
public:
    explicit FutureCaster(std::future<Any>&& future)
        : future_(std::move(future))
    {
    }

    FutureCaster(FutureCaster&& other)
        : future_(std::move(other.future_))
    {
    }

    void operator()()
    {
        (void)future_.get();
    }

private:
    FutureCaster(const FutureCaster&);
    FutureCaster& operator=(const FutureCaster&);

    std::future<Any> future_;
};

template <typename Result>
std::future<Result> castFuture(std::future<Any>&& future)
{
    return std::async(
        std::launch::async,
        FutureCaster<Result>(std::move(future)));
}

} // namespace detail
} // namespace nativeweb

#endif
