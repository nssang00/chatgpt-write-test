#ifndef NATIVEWEB_NATIVE_OBJECT_RUNTIME_HPP_INCLUDED
#define NATIVEWEB_NATIVE_OBJECT_RUNTIME_HPP_INCLUDED

#include "core/object_registry.hpp"
#include "nativeweb/detail/bind.hpp"
#include "nativeweb/types.hpp"

#include <map>
#include <memory>
#include <mutex>
#include <string>

namespace nativeweb {
namespace detail {

class NativeObjectRuntime
{
public:
    NativeObjectRuntime();

    NativeObjectHandle add(
        const std::shared_ptr<void>& object,
        const std::string& typeName);

    void bindMethod(
        const NativeObjectHandle& handle,
        const std::string& method,
        const DynamicFunction& function);

    Any call(
        const NativeObjectHandle& handle,
        const std::string& method,
        const VariantList& args);

    bool release(const NativeObjectHandle& handle);
    void clear();

    std::size_t size() const;

private:
    struct Entry
    {
        std::string typeName;
        std::map<std::string, DynamicFunction> methods;
    };

    mutable std::mutex mutex_;
    ObjectRegistry objects_;
    std::map<ObjectId, Entry> entries_;
};

} // namespace detail
} // namespace nativeweb

#endif
