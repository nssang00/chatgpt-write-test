#include "Messages.hpp"
#include <atomic>
#include <chrono>
#include <fstream>
#include <iostream>
#include <mutex>
#include <set>
#include <thread>
#include <cstdlib>
using namespace intraflow;
static void waitFile(const std::string& file) {
    for(int i=0;i<3000;++i) {
        if(std::ifstream(file.c_str()).good()) return;
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    throw std::runtime_error("barrier timeout");
}
int main(int argc,char** argv) {
    try {
        if(argc!=6) return 2;
        std::string role=argv[1], db=argv[2], ready=argv[3], go=argv[4];
        int n=std::atoi(argv[5]);
        Options options;options.database=db;
        std::atomic<int> count{0};
        std::mutex seen_mu;
        std::set<int> seen;
        int expected=0;
        auto app=connect(role,options);
        if(role=="sensor") {
            app.subscribe<Command>("system.command",[&](const Command& m){if(m.code==7) ++count;});
            expected=1;
        } else if(role=="control") {
            app.subscribe<SensorData>("sensor.data",[&](const SensorData& m){if(m.source==1) {Command c{};c.code=7;app.publish("system.command",c);++count;}});
            app.subscribe<Status>("system.status",[&](const Status& m){if(m.running) ++count;});
            expected=2;
        } else if(role=="device") {
            app.subscribe<Command>("system.command",[&](const Command& m){if(m.code==7) {Status s{};s.source=2;s.running=true;app.publish("system.status",s);++count;}});
            expected=1;
        } else if(role=="display") {
            app.subscribe<SensorData>("sensor.data",[&](const SensorData& m){if(m.value==12.5) ++count;});
            app.subscribe<Status>("system.status",[&](const Status& m){if(m.running) ++count;});
            expected=2;
        } else if(role=="monitor") {
            app.subscribeAll([&](const Message&){++count;});
            expected=3;
        } else {
            app.subscribe<PeerMessage>("peer.data",[&](const PeerMessage& m){
                if(m.values.size()==2 && m.values[0]==1.5 && m.source>=0 && m.source<n) {
                    std::lock_guard<std::mutex> lock(seen_mu);
                    if(seen.insert(m.source).second) ++count;
                }
            });
            expected=n;
        }
        { std::ofstream f(ready.c_str()); f<<"ready"; }
        waitFile(go);
        if(role=="sensor") {SensorData m{};m.source=1;m.value=12.5;app.publish("sensor.data",m);}
        if(role.find("peer")==0) {PeerMessage m{};m.source=std::atoi(role.c_str()+4);m.values={1.5,2.5};app.publish("peer.data",m);}
        for(int i=0;i<3000 && count.load()<expected;++i) std::this_thread::sleep_for(std::chrono::milliseconds(10));
        app.close();
        std::cout<<role<<" received "<<count<<" expected "<<expected<<std::endl;
        return count==expected?0:1;
    } catch(const std::exception& e) {std::cerr<<e.what()<<std::endl;return 1;}
}
