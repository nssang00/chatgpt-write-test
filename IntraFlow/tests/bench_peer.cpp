#include "Messages.hpp"
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <thread>
#include <vector>

using namespace intraflow;
using Steady = std::chrono::steady_clock;
static std::int64_t utc_us() {
    return std::chrono::duration_cast<std::chrono::microseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
}
static void waitFile(const std::string& path) {
    const auto end = Steady::now() + std::chrono::seconds(120);
    while (!std::ifstream(path.c_str()).good()) {
        if (Steady::now() >= end) throw std::runtime_error("barrier timeout");
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
}
int main(int argc, char** argv) {
    try {
        if (argc != 9) return 2;
        const int id = std::atoi(argv[1]), peers = std::atoi(argv[2]), rounds = std::atoi(argv[3]);
        if (id < 0 || id >= peers || peers > 1024 || rounds < 1 || rounds > 1000) return 2;
        const std::string ready=argv[5], go=argv[6], result=argv[7], release=argv[8];
        const int expected=peers*rounds;
        const std::string body(64, 'x');
        std::vector<unsigned char> seen(static_cast<size_t>(expected),0);
        std::vector<std::int64_t> latencies, publishTimes;
        latencies.reserve(expected);
        publishTimes.reserve(rounds);
        std::atomic<int> count{0};
        int duplicates=0, invalid=0;
        Options options; options.database=argv[4]; options.busy_ms=30000;
        auto app=connect("bench"+std::to_string(id),options);
        app.subscribe<BenchMessage>("bench.data",[&](const BenchMessage& m){
            const auto received=utc_us();
            if(m.source<0 || m.source>=peers || m.index<0 || m.index>=rounds || m.data!=body || m.sent_us>received) {++invalid; return;}
            const auto slot=static_cast<size_t>(m.source*rounds+m.index);
            if(seen[slot]) {++duplicates;return;}
            seen[slot]=1;
            latencies.push_back(received-m.sent_us);
            ++count;
        });
        { std::ofstream f(ready.c_str()); if(!f) throw std::runtime_error("ready file failed"); f<<"ready"; }
        waitFile(go);
        for(int i=0;i<rounds;++i) {
            BenchMessage m{}; m.source=id;m.index=i;m.data=body;
            const auto start=Steady::now();
            m.sent_us=utc_us();
            app.publish("bench.data",m);
            publishTimes.push_back(std::chrono::duration_cast<std::chrono::microseconds>(Steady::now()-start).count());
        }
        const auto end=Steady::now()+std::chrono::seconds(90);
        while(count.load()<expected && Steady::now()<end)
            std::this_thread::sleep_for(std::chrono::milliseconds(2));
        app.close(); // joins the dispatch thread; reading its vectors is now safe
        Json report={{"id",id},{"count",count.load()},{"duplicates",duplicates},{"invalid",invalid},
                     {"latency_us",latencies},{"publish_us",publishTimes}};
        const auto temporary=result+".tmp";
        {std::ofstream f(temporary.c_str());f<<report.dump();if(!f) throw std::runtime_error("result write failed");}
        if(std::rename(temporary.c_str(),result.c_str())!=0) throw std::runtime_error("result rename failed");
        waitFile(release);
        return count.load()==expected && duplicates==0 && invalid==0 ? 0 : 1;
    } catch(const std::exception& e) {std::cerr<<e.what()<<std::endl;return 1;}
}
