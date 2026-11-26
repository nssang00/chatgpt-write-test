#pragma once
#include <intraflow.hpp>
#include <iostream>
#include <string>
inline intraflow::Options exampleOptions(int argc,char** argv) {
    intraflow::Options options;
    if(argc>1) options.database=argv[1];
    return options;
}
inline void waitForExit() {
    std::cout<<"READY"<<std::endl;
    std::string line;
    std::getline(std::cin,line);
}
