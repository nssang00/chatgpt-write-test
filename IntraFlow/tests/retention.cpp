#include "Messages.hpp"
#include <atomic>
#include <chrono>
#include <iostream>
#include <stdexcept>
#include <thread>
using namespace intraflow;
using Clock=std::chrono::steady_clock;
static void require(bool b,const char* m){if(!b)throw std::runtime_error(m);}
template<class F> void until(F f){
    const auto end=Clock::now()+std::chrono::seconds(15);
    while(!f()){require(Clock::now()<end,"wait timeout");std::this_thread::sleep_for(std::chrono::milliseconds(2));}
}
int main(int argc,char** argv){
    if(argc!=3&&argc!=4)return 2;
    try{
        Options o;o.filter_topics=argc==4;o.database=argv[1];o.retention_sec=0;o.max_messages=16;
        auto pub=connect("pub",o);
        std::atomic<bool> entered{false},release{false};
        std::atomic<int> received{0},last{0},late{0};
        auto sub=connect("sub",o);
        struct Unblock{std::atomic<bool>& flag;~Unblock(){flag=true;}} unblock{release};
        sub.subscribe<Command>("cmd",[&](const Command& c){
            if(c.code==1){entered=true;const auto end=Clock::now()+std::chrono::seconds(20);
                while(!release&&Clock::now()<end)std::this_thread::sleep_for(std::chrono::milliseconds(1));}
            last=c.code;++received;
        });
        Command c{};c.code=1;require(pub.publish("cmd",c)==1,"first sequence");
        until([&]{return entered.load();});
        for(int i=2;i<=512;++i){c.code=i;require(pub.publish("cmd",c)==i,"sequence after pruning");}
        release=true;until([&]{return last==512;});
        require(received==17&&sub.skippedSequences()==495,"pruned gap count");
        auto fresh=connect("fresh",o);
        fresh.subscribe<Command>("cmd",[&](const Command& v){if(v.code==513)++late;else late+=100;});
        c.code=513;require(pub.publish("cmd",c)==513,"continued sequence");
        until([&]{return late!=0;});require(late==1&&fresh.skippedSequences()==0,"late subscribe replay");
        bool mismatch=false;try{Options bad=o;bad.max_messages=17;auto invalid=connect("bad",bad);}
        catch(const std::runtime_error&){mismatch=true;}require(mismatch,"policy conflict accepted");
        fresh.close();sub.close();pub.close();
        Options age;age.database=argv[2];age.retention_sec=1;age.max_messages=0;age.cleanup_interval_ms=50;
        auto timepub=connect("age",age);
        for(int i=1;i<=8;++i){c.code=i;timepub.publish("cmd",c);}
        std::this_thread::sleep_for(std::chrono::milliseconds(1200));
        c.code=9;require(timepub.publish("cmd",c)==9,"age sequence");
        timepub.close();
        std::cout<<"PASS: bounded count, expiration on publish, global gap, late subscribe, shared policy"<<std::endl;
        return 0;
    }catch(const std::exception& e){std::cerr<<e.what()<<std::endl;return 1;}
}
