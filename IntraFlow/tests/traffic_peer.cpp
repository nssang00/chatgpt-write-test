#include "Messages.hpp"
#include <array>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <thread>
#include <vector>
#include <algorithm>

using namespace intraflow;
using Clock=std::chrono::steady_clock;
using Micro=std::chrono::microseconds;
using Milli=std::chrono::milliseconds;
constexpr int peers=30, groups=6, kinds=4;
const char* names[kinds]={"sensor","status","command","log"};
static std::string topic(int group,int kind) {
    return "group."+std::to_string(group)+"."+names[kind];
}
static std::int64_t utc() {
    return std::chrono::duration_cast<Micro>(std::chrono::system_clock::now().time_since_epoch()).count();
}
static std::int64_t us(Clock::duration d) {
    return std::chrono::duration_cast<Micro>(d).count();
}
static void signal(const std::string& path) {
    const auto tmp=path+".tmp";
    {std::ofstream f(tmp.c_str());f<<"ready";if(!f)throw std::runtime_error("signal write");}
    if(std::rename(tmp.c_str(),path.c_str()))throw std::runtime_error("signal rename");
}
static void waitFile(const std::string& path,int seconds) {
    const auto end=Clock::now()+std::chrono::seconds(seconds);
    while(!std::ifstream(path.c_str()).good()){
        if(Clock::now()>=end)throw std::runtime_error("barrier timeout: "+path);
        std::this_thread::sleep_for(Milli(2));
    }
}
static TrafficSensor sensor(const TrafficHeader& h) {
    TrafficSensor m{};m.header=h;
    for(std::size_t i=0;i<m.values.size();++i)m.values[i]=h.source*1000+h.index+i*.25;
    return m;
}
static TrafficStatus status(const TrafficHeader& h) {
    TrafficStatus m{};m.header=h;m.running=h.index%2==0;
    m.name="App"+std::to_string(h.source);
    m.counters={h.source,h.index,h.source+h.index};
    return m;
}
static TrafficCommand command(const TrafficHeader& h) {
    TrafficCommand m{};m.header=h;m.code=h.index%7;
    m.target.x=h.source;m.target.y=h.index;m.target.z=3.25;
    for(std::size_t i=0;i<m.channels.size();++i)m.channels[i]=h.source+static_cast<int>(i);
    return m;
}
static TrafficLog logmsg(const TrafficHeader& h) {
    TrafficLog m{};m.header=h;
    m.text.assign(4096,static_cast<char>('A'+h.source%26));
    m.tags={{"traffic","group."+std::to_string(h.source%groups),"index."+std::to_string(h.index),"end"}};
    return m;
}
static bool matches(const TrafficSensor& m){return m.values==sensor(m.header).values;}
static bool matches(const TrafficStatus& m){const auto e=status(m.header);return m.running==e.running&&m.name==e.name&&m.counters==e.counters;}
static bool matches(const TrafficCommand& m){const auto e=command(m.header);return m.code==e.code&&m.target.x==e.target.x&&m.target.y==e.target.y&&m.target.z==e.target.z&&m.channels==e.channels;}
static bool matches(const TrafficLog& m){const auto e=logmsg(m.header);return m.text==e.text&&m.tags==e.tags;}
struct Receiver {
    std::array<int,kinds> counts;
    std::array<std::vector<std::int64_t>,kinds> latency;
    std::array<int,kinds> received{};
    std::vector<std::vector<unsigned char>> seen;
    std::vector<int> next;
    std::atomic<int> total{0};
    int duplicates=0,invalid=0,out_of_order=0;
    std::thread::id thread;
    explicit Receiver(const std::array<int,kinds>& c):counts(c),seen(peers*kinds),next(peers*kinds,0) {
        for(int p=0;p<peers;++p)for(int k=0;k<kinds;++k)seen[p*kinds+k].resize(counts[k]);
    }
    template<class T> void record(int g,int k,const T& m) {
        const auto now=utc();
        if(thread==std::thread::id())thread=std::this_thread::get_id();
        const auto& h=m.header;
        if(thread!=std::this_thread::get_id()||h.source<0||h.source>=peers||
           h.source%groups!=g||h.index<0||h.index>=counts[k]||
           h.sent_us<=0||h.sent_us>now||!matches(m)){++invalid;return;}
        const int slot=h.source*kinds+k;
        if(seen[slot][h.index]){++duplicates;return;}
        if(h.index!=next[slot])++out_of_order;
        next[slot]=h.index+1;
        seen[slot][h.index]=1;
        ++received[k];latency[k].push_back(now-h.sent_us);++total;
    }
    void subscribe(Session& app,int g) {
        app.subscribe<TrafficSensor>(topic(g,0),[this,g](const TrafficSensor& m){record(g,0,m);});
        app.subscribe<TrafficStatus>(topic(g,1),[this,g](const TrafficStatus& m){record(g,1,m);});
        app.subscribe<TrafficCommand>(topic(g,2),[this,g](const TrafficCommand& m){record(g,2,m);});
        app.subscribe<TrafficLog>(topic(g,3),[this,g](const TrafficLog& m){record(g,3,m);});
    }
};
int main(int argc,char** argv){
    try {
#ifdef INTRAFLOW_DIAGNOSTICS
        if(argc!=13)return 2;
#else
        if(argc!=11)return 2;
#endif
        const int id=std::atoi(argv[1]),duration=std::atoi(argv[2]);
        const std::string profile=argv[3],db=argv[4],ready=argv[5],go=argv[6],sent=argv[7],drain=argv[8],result=argv[9],release=argv[10];
        if(id<0||id>=peers||duration<200||duration>60000||(profile!="normal"&&profile!="fast"))return 2;
        const std::array<int,kinds> period=profile=="fast"?std::array<int,kinds>{{10,20,50,100}}:std::array<int,kinds>{{20,40,100,200}};
        std::array<int,kinds> count{},published{};
        int expected=0;
        for(int k=0;k<kinds;++k){count[k]=duration/period[k];expected+=10*count[k];}
        Receiver receiver(count);
        std::array<std::vector<std::int64_t>,kinds> pubTime,lateness,gaps;
        std::array<Clock::time_point,kinds> previous{};
        Options options;options.database=db;options.poll_ms=5;options.busy_ms=30000;
#ifdef INTRAFLOW_DIAGNOSTICS
        options.diagnostic_checkpoint=std::atoi(argv[11]);
        options.diagnostic_hooks=std::string(argv[12])=="hooks";
#endif
        auto app=connect("TrafficApp"+std::to_string(id),options);
        const int group=id%groups;
        receiver.subscribe(app,group);
        receiver.subscribe(app,(group+groups-1)%groups);
        signal(ready);waitFile(go,90);
        const auto start=Clock::now()+Milli(id%10);
        while(true) {
            int selected=-1;Clock::time_point due;
            for(int k=0;k<kinds;++k)if(published[k]<count[k]){
                const auto candidate=start+Milli(period[k]*published[k]);
                if(selected<0||candidate<due){selected=k;due=candidate;}
            }
            if(selected<0)break;
            const int k=selected;
            std::this_thread::sleep_until(due);
            const auto begin=Clock::now();
            lateness[k].push_back(std::max<std::int64_t>(0,us(begin-due)));
            if(published[k])gaps[k].push_back(us(begin-previous[k]));
            previous[k]=begin;
            TrafficHeader h{};h.source=id;h.index=published[k];h.sent_us=utc();
            const auto t=topic(group,k);
            switch(k){
                case 0:app.publish(t,sensor(h));break;
                case 1:app.publish(t,status(h));break;
                case 2:app.publish(t,command(h));break;
                case 3:app.publish(t,logmsg(h));break;
            }
            pubTime[k].push_back(us(Clock::now()-begin));++published[k];
        }
        const auto publishElapsed=us(Clock::now()-start);
        signal(sent);waitFile(drain,180);
        const auto end=Clock::now()+std::chrono::seconds(45);
        while(receiver.total<expected&&Clock::now()<end)std::this_thread::sleep_for(Milli(2));
        std::this_thread::sleep_for(Milli(50));
        app.close();
        Json report={{"id",id},{"group",group},{"published",published},{"received",receiver.received},
            {"duplicates",receiver.duplicates},{"invalid",receiver.invalid},{"out_of_order",receiver.out_of_order},
            {"publish_elapsed_us",publishElapsed},{"latency_us",receiver.latency},{"publish_us",pubTime},
            {"lateness_us",lateness},{"gaps_us",gaps}};
#ifdef INTRAFLOW_DIAGNOSTICS
        report["diagnostics"]=app.diagnostics();
#endif
        const auto tmp=result+".tmp";
        {std::ofstream f(tmp.c_str());f<<report.dump();if(!f)throw std::runtime_error("report write");}
        if(std::rename(tmp.c_str(),result.c_str()))throw std::runtime_error("report rename");
        waitFile(release,90);
        return receiver.total==expected&&!receiver.duplicates&&!receiver.invalid&&!receiver.out_of_order?0:1;
    }catch(const std::exception& e){std::cerr<<e.what()<<std::endl;return 1;}
}
