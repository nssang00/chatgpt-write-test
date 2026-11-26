#include "common.hpp"
#include "Messages.hpp"
#include <sstream>

int main(int argc,char** argv) {
    try {
        auto app=intraflow::connect("SensorApp",exampleOptions(argc,argv));
        app.subscribe<Command>("system.command",[](const Command& cmd) {
            std::cout<<"COMMAND "<<cmd.code<<std::endl;
        });
        std::cout<<"READY"<<std::endl;
        std::string line;
        while(std::getline(std::cin,line) && line!="q") {
            std::istringstream input(line);
            SensorData data{};
            data.source=1;
            if(input>>data.value) app.publish("sensor.data",data);
            else std::cerr<<"Enter a numeric reading or q"<<std::endl;
        }
        app.close();
        return 0;
    } catch(const std::exception& e){std::cerr<<e.what()<<std::endl;return 1;}
}
