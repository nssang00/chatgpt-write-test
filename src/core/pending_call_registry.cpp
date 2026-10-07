#include "core/pending_call_registry.hpp"

#include <exception>

namespace nativeweb {
namespace detail {

PendingCallRegistry::PendingCallRegistry()
    : nextId_(1)
{
}

PendingCall PendingCallRegistry::create()
{
    const RequestId id = nextId_.fetch_add(1);
    const StatePtr state(new State());
    std::future<Any> future = state->promise.get_future();

    {
        std::lock_guard<std::mutex> lock(mutex_);
        pending_.insert(std::make_pair(id, state));
    }

    return PendingCall(id, future);
}

PendingCallRegistry::StatePtr PendingCallRegistry::take(RequestId id)
{
    std::lock_guard<std::mutex> lock(mutex_);

    std::map<RequestId, StatePtr>::iterator found = pending_.find(id);
    if (found == pending_.end())
        return StatePtr();

    StatePtr state = found->second;
    pending_.erase(found);
    return state;
}

bool PendingCallRegistry::resolve(RequestId id, const Any& value)
{
    const StatePtr state = take(id);
    if (!state)
        return false;

    state->promise.set_value(value);
    return true;
}

bool PendingCallRegistry::reject(RequestId id, const Error& error)
{
    const StatePtr state = take(id);
    if (!state)
        return false;

    state->promise.set_exception(std::make_exception_ptr(error));
    return true;
}

void PendingCallRegistry::rejectAll(const Error& error)
{
    std::vector<StatePtr> states;

    {
        std::lock_guard<std::mutex> lock(mutex_);

        states.reserve(pending_.size());

        for (std::map<RequestId, StatePtr>::iterator it = pending_.begin();
             it != pending_.end();
             ++it)
        {
            states.push_back(it->second);
        }

        pending_.clear();
    }

    for (std::size_t i = 0; i < states.size(); ++i)
    {
        states[i]->promise.set_exception(std::make_exception_ptr(error));
    }
}

std::size_t PendingCallRegistry::size() const
{
    std::lock_guard<std::mutex> lock(mutex_);
    return pending_.size();
}

} // namespace detail
} // namespace nativeweb
