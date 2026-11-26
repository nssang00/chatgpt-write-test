#include "common.hpp"
#include "Messages.hpp"

int main(int argc,char** argv) {
    try {
        auto app=intraflow::connect("ControlApp",exampleOptions(argc,argv));
        app.subscribe<SensorData>("sensor.data",[&](const SensorData& data) {
            Command cmd{};
            cmd.code=data.value>25.0?1:0;
            app.publish("system.command",cmd);
        });
        app.subscribe<Status>("system.status",[](const Status& status) {
            std::cout<<"STATUS "<<status.running<<std::endl;
        });
        waitForExit();
        app.close();
        return 0;
    } catch(const std::exception& e){std::cerr<<e.what()<<std::endl;return 1;}
}
