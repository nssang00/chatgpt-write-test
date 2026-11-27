#include "Messages.hpp"
#include <sqlite3.h>
#include <chrono>
#include <fstream>
#include <thread>
#include <iostream>
#include <stdexcept>
using namespace intraflow;
static void require(bool b,const char* m){if(!b)throw std::runtime_error(m);}
int main(int argc,char** argv){
    try{
        if(argc<4)return 2;
        std::string mode=argv[1],sync=argv[3];
        Options o;o.database=argv[2];o.serialize_writers=true;
        o.diagnostic_checkpoint=0;o.diagnostic_separate_maintenance=true;
        o.diagnostic_maintenance_ms=100;o.diagnostic_sync_off=sync=="off";
        auto app=connect("recovery",o);Command c{};c.code=42;
        if(mode=="hold"&&argc==5){
            for(int i=1;i<=100;++i)require(app.publish("cmd",c)==i,"initial sequence");
            // Force an uncommitted row to exist while the process is killed.
            sqlite3* db=nullptr;require(sqlite3_open(argv[2],&db)==SQLITE_OK,"raw open");
            sqlite3_busy_timeout(db,5000);
            require(sqlite3_exec(db,o.diagnostic_sync_off?"PRAGMA synchronous=OFF":"PRAGMA synchronous=NORMAL",nullptr,nullptr,nullptr)==SQLITE_OK,"sync");
            require(sqlite3_exec(db,"BEGIN IMMEDIATE; INSERT INTO messages(topic,sender,timestamp,payload) VALUES('cmd','uncommitted',0,'{}')",nullptr,nullptr,nullptr)==SQLITE_OK,"begin");
            {std::ofstream f(argv[4]);f<<"ready";require(bool(f),"ready");}
            std::this_thread::sleep_for(std::chrono::seconds(60));
            sqlite3_close(db);return 3;
        }
        if(mode=="recover"){
            require(app.publish("cmd",c)==101,"rollback/sequence");
            std::this_thread::sleep_for(std::chrono::milliseconds(250));
            app.close();return 0;
        }
        return 2;
    }catch(const std::exception& e){std::cerr<<e.what()<<std::endl;return 1;}
}
