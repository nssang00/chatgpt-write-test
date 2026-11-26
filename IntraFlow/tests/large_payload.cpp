#include "Messages.hpp"
#include <atomic>
#include <chrono>
#include <fstream>
#include <iostream>
#include <thread>
#include <stdexcept>

using namespace intraflow;
static DeviceData makeData() {
    DeviceData v{};
    v.id=42; v.name="MotorController";
    for(std::size_t i=0;i<v.temperatures.size();++i) v.temperatures[i]=20.0+i*.25;
    for(std::size_t i=0;i<v.channels.size();++i) v.channels[i]=static_cast<int>(i);
    for(std::size_t i=0;i<16;++i) for(std::size_t j=0;j<16;++j) v.matrix[i][j]=static_cast<float>(i*16+j);
    v.samples.assign(1024,1.25);
    for(std::size_t i=0;i<v.positions.size();++i) {v.positions[i].x=i;v.positions[i].y=2;v.positions[i].z=3;}
    v.trajectory.assign(8,v.positions[31]);
    v.labels.fill("Motor");
    v.descriptions={"first","line\nwith \"quotes\"",u8"\uD55C\uAE00"};
    v.document.assign(512*1024,'D');v.document[0]='\n';v.document.back()='"';
    v.largeText.assign(256*1024,'L');
    v.boundedSamples.assign(1024,7);
    return v;
}
template<class F> static void reject(F f) {
    bool failed=false;
    try {f();} catch(const std::exception&) {failed=true;}
    if(!failed) throw std::runtime_error("invalid payload was accepted");
}
int main(int argc,char** argv) {
    try {
        if(argc!=4) return 2;
        const std::string role=argv[1];
        Options options;options.database=argv[2];
        std::atomic<int> count{0};
        std::atomic<bool> match{false};
        const auto data=makeData();
        const Json expected=data;
        auto app=connect(role,options);
        if(role=="receiver") {
            app.subscribe<DeviceData>("device.data",[&](const DeviceData& v){match=(Json(v)==expected);++count;});
            {std::ofstream ready(argv[3]);ready<<"ready";}
            const auto end=std::chrono::steady_clock::now()+std::chrono::seconds(30);
            while(!count && std::chrono::steady_clock::now()<end) std::this_thread::sleep_for(std::chrono::milliseconds(10));
            app.close();
            if(count!=1 || !match) throw std::runtime_error("large message mismatch");
        } else if(role=="publisher") {
            auto invalid=data;invalid.largeText.push_back('x');
            reject([&]{app.publish("device.data",invalid);});
            invalid=data;invalid.boundedSamples.push_back(1);
            reject([&]{app.publish("device.data",invalid);});
            invalid=data;invalid.document.assign(1024*1024,'X');
            reject([&]{app.publish("device.data",invalid);});
            auto malformed=expected;malformed["matrix"][0].push_back(0);
            reject([&]{malformed.get<DeviceData>();});
            malformed=expected;malformed["labels"].erase(0);
            reject([&]{malformed.get<DeviceData>();});
            malformed=expected;malformed["largeText"]=std::string(262145,'X');
            reject([&]{malformed.get<DeviceData>();});
            app.publish("device.data",data);
            app.close();
        } else return 2;
        return 0;
    } catch(const std::exception& e){std::cerr<<e.what()<<std::endl;return 1;}
}
