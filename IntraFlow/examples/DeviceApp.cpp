#include "common.hpp"
#include "Messages.hpp"

int main(int argc,char** argv) {
    try {
        auto app=intraflow::connect("DeviceApp",exampleOptions(argc,argv));
        app.subscribe<Command>("system.command",[&](const Command& cmd) {
            Status status{};
            status.source=2;
            status.running=cmd.code==1;
            app.publish("system.status",status);
        });
        waitForExit();
        app.close();
        return 0;
    } catch(const std::exception& e){std::cerr<<e.what()<<std::endl;return 1;}
}
