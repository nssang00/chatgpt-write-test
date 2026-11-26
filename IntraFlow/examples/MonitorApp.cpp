#include "common.hpp"

int main(int argc,char** argv) {
    try {
        auto app=intraflow::connect("MonitorApp",exampleOptions(argc,argv));
        app.subscribeAll([](const intraflow::Message& msg) {
            auto text=msg.payload.dump();
            if(text.size()>512) text=text.substr(0,512)+"...";
            std::cout<<msg.sender<<" "<<msg.topic<<" "<<text<<std::endl;
        });
        waitForExit();
        app.close();
        return 0;
    } catch(const std::exception& e){std::cerr<<e.what()<<std::endl;return 1;}
}
