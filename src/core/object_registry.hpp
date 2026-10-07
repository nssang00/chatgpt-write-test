#ifndef NATIVEWEB_OBJECT_REGISTRY_HPP_INCLUDED
#define NATIVEWEB_OBJECT_REGISTRY_HPP_INCLUDED

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <map>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <typeindex>
#include <typeinfo>

namespace nativeweb {
namespace detail {

typedef std::uint64_t ObjectId;

class ObjectRegistry
{
public:
    ObjectRegistry();

    template <typename T>
    ObjectId add(const std::shared_ptr<T>& object)
    {
        if (!object)
            throw std::invalid_argument(
                "NativeWeb object registry cannot store a null object");

        const ObjectId id = nextId_.fetch_add(1);
        const Entry entry(
            std::static_pointer_cast<void>(object),
            std::type_index(typeid(T)));

        {
            std::lock_guard<std::mutex> lock(mutex_);
            objects_.insert(std::make_pair(id, entry));
        }

        return id;
    }

    template <typename T>
    std::shared_ptr<T> get(ObjectId id) const
    {
        std::lock_guard<std::mutex> lock(mutex_);

        std::map<ObjectId, Entry>::const_iterator found =
            objects_.find(id);

        if (found == objects_.end())
            return std::shared_ptr<T>();

        if (found->second.type != std::type_index(typeid(T)))
            return std::shared_ptr<T>();

        return std::static_pointer_cast<T>(found->second.object);
    }

    bool contains(ObjectId id) const;
    bool release(ObjectId id);
    void clear();

    std::size_t size() const;

private:
    struct Entry
    {
        Entry(
            const std::shared_ptr<void>& value,
            const std::type_index& valueType)
            : object(value),
              type(valueType)
        {
        }

        std::shared_ptr<void> object;
        std::type_index type;
    };

    mutable std::mutex mutex_;
    std::map<ObjectId, Entry> objects_;
    std::atomic<ObjectId> nextId_;
};

} // namespace detail
} // namespace nativeweb

#endif
