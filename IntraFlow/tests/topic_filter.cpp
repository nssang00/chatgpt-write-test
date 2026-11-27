#include "Messages.hpp"
#include <atomic>
#include <chrono>
#include <thread>
#include <iostream>
#include <stdexcept>
using namespace intraflow;
static void require(bool b,const char* m){if(!b)throw std::runtime_error(m);}
template<class F>void until(F f){
    const auto end=std::chrono::steady_clock::now()+std::chrono::seconds(15);
    while(!f()){require(std::chrono::steady_clock::now()<end,"timeout");std::this_thread::sleep_for(std::chrono::milliseconds(2));}
}
int main(int argc,char** argv){
    if(argc!=2)return 2;
    try{
        Options o;o.database=argv[1];o.filter_topics=true;
        std::atomic<int> a{0},b{0},all{0},bad{0},late{0};
        auto pub=connect("pub",o);auto sub=connect("sub",o);
        Command c{};c.code=-1;pub.publish("b",c); // before registration
        SubscriptionId self=0;
        self=sub.subscribe<Command>("a",[&](const Command& x){
            if(x.code!=1)++bad;
            ++a;sub.unsubscribe(self);
            sub.subscribe<Command>("b",[&](const Command& y){if(y.code!=2)++bad;++b;});
            Command reply{};reply.code=2;sub.publish("b",reply);
        });
        for(int i=0;i<300;++i)pub.publish("ignored",c);
        c.code=1;pub.publish("a",c);until([&]{return b==1;});
        auto monitor=sub.subscribeAll([&](const Message& m){if(m.topic!="ignored")++bad;++all;});
        for(int i=0;i<300;++i)pub.publish("ignored",c);
        until([&]{return all==300;});sub.unsubscribe(monitor);
        // Re-register from another thread while writer advances unrelated rows.
        std::atomic<bool> go{false};
        std::thread t([&]{while(!go)std::this_thread::yield();
            try{for(int i=0;i<300;++i)pub.publish("ignored",c);}catch(...){++bad;}});
        go=true;
        sub.subscribe<Command>("late",[&](const Command& v){if(v.code!=1)++bad;++late;});
        t.join();
        for(int i=0;i<50;++i)pub.publish("late",c);
        until([&]{return late==50;});
        sub.close();pub.close();
        require(a==1&&b==1&&all==300&&late==50&&bad==0&&sub.skippedSequences()==0,"filter delivery contract");
        std::cout<<"PASS: topic filtering, nested subscription, monitor fallback, concurrent subscribe, no false gap"<<std::endl;
        return 0;
    }catch(const std::exception& e){std::cerr<<e.what()<<std::endl;return 1;}
}
