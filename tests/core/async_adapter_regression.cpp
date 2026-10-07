#include "nativeweb/detail/async.hpp"

#include <future>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {

int failures = 0;
void fail(const char* e,const char* f,int l){std::cerr<<f<<":"<<l<<": CHECK failed: "<<e<<std::endl;++failures;}
#define CHECK(e) do{if(!(e))fail(#e,__FILE__,__LINE__);}while(0)

void testArgumentPacking()
{
    VariantList args;
    nativeweb::detail::appendArguments(
        args,
        42,
        std::string("camera"),
        true,
        "literal");

    CHECK(args.size() == 4u);
    CHECK(AnyCast<int>(args[0]) == 42);
    CHECK(AnyCast<std::string>(args[1]) == "camera");
    CHECK(AnyCast<bool>(args[2]));
    CHECK(AnyCast<std::string>(args[3]) == "literal");
}

void testTypedFuture()
{
    std::promise<Any> promise;
    std::future<int> typed =
        nativeweb::detail::castFuture<int>(
            promise.get_future());

    promise.set_value(Any(73));
    CHECK(typed.get() == 73);
}

void testVoidFuture()
{
    std::promise<Any> promise;
    std::future<void> typed =
        nativeweb::detail::castFuture<void>(
            promise.get_future());

    promise.set_value(Any());
    typed.get();
    CHECK(true);
}

void testErrorPropagation()
{
    std::promise<Any> promise;
    std::future<int> typed =
        nativeweb::detail::castFuture<int>(
            promise.get_future());

    promise.set_exception(
        std::make_exception_ptr(
            std::runtime_error("boom")));

    bool threw=false;
    try { (void)typed.get(); }
    catch(const std::runtime_error& e)
    {
        threw=true;
        CHECK(std::string(e.what())=="boom");
    }
    CHECK(threw);
}

}

int main()
{
    testArgumentPacking();
    testTypedFuture();
    testVoidFuture();
    testErrorPropagation();

    if(failures){std::cerr<<"Async adapter regression failed: "<<failures<<std::endl;return 1;}
    std::cout<<"Async adapter regression: PASS"<<std::endl;
    return 0;
}
