#include "Messages.hpp"
#include "process_writer_lock.hpp"
#include <sqlite3.h>
#include <fstream>
#include <iostream>
#include <thread>
#include <chrono>
#include <atomic>
#include <future>
using namespace intraflow;
static void require(bool b,const char* m){if(!b)throw std::runtime_error(m);}
struct RawDb {
    sqlite3* db=nullptr;
    explicit RawDb(const char* path){if(sqlite3_open(path,&db)!=SQLITE_OK){sqlite3_close(db);throw std::runtime_error("open");}}
    ~RawDb(){sqlite3_close(db);}
    void exec(const char* sql){require(sqlite3_exec(db,sql,nullptr,nullptr,nullptr)==SQLITE_OK,"raw SQL");}
};
static void signal(const char* path){std::ofstream f(path);f<<"ready";f.close();require(bool(f),"signal");}
static void waitFile(const char* path){
    const auto end=std::chrono::steady_clock::now()+std::chrono::seconds(20);
    while(!std::ifstream(path).good()){require(std::chrono::steady_clock::now()<end,"barrier");std::this_thread::sleep_for(std::chrono::milliseconds(5));}
}
int main(int argc,char** argv){
    try{
        if(argc<3)return 2;
        const std::string mode=argv[1];
        Options o;o.database=argv[2];o.serialize_writers=true;o.busy_ms=500;
        if(mode=="hold"&&argc==4){
            RawDb db(argv[2]);detail::ProcessWriterLock lock(sqlite3_db_filename(db.db,"main"));
            detail::ProcessWriterGuard guard(&lock,5000);
            db.exec("BEGIN IMMEDIATE");
            db.exec("INSERT INTO messages(topic,sender,timestamp,payload) VALUES('cmd','uncommitted',1,'{}')");
            signal(argv[3]);
            std::this_thread::sleep_for(std::chrono::seconds(60));
            return 3;
        }
        if(mode=="init"){
            auto app=connect("init",o);Command c{};c.code=1;
            require(app.publish("cmd",c)==1,"initial sequence");app.close();return 0;
        }
        if(mode=="wait"&&argc==6){
            std::atomic<int> delivered{0};
            auto app=connect("waiter",o);
            app.subscribe<Command>("cmd",[&](const Command& c){if(c.code==2)++delivered;});
            signal(argv[3]);waitFile(argv[4]);
            bool timed=false;Command c{};c.code=2;
            try{app.publish("cmd",c);}catch(const std::runtime_error& ex){timed=std::string(ex.what())=="process writer lock timeout";}
            require(timed,"expected OS writer lock timeout");signal(argv[5]);
            const auto end=std::chrono::steady_clock::now()+std::chrono::seconds(20);
            while(delivered<51){require(std::chrono::steady_clock::now()<end,"recovery delivery");std::this_thread::sleep_for(std::chrono::milliseconds(2));}
            app.close();require(delivered==51&&app.skippedSequences()==0,"recovery delivery count");return 0;
        }
        if(mode=="recover"){
            auto app=connect("recovered",o);Command c{};c.code=2;
            require(app.publish("cmd",c)==2,"rollback/sequence recovery");
            auto other=connect("other",o);
            auto task=std::async(std::launch::async,[&]{Command x{};x.code=3;for(int i=0;i<50;++i)other.publish("cmd",x);});
            for(int i=0;i<50;++i)app.publish("cmd",c);
            task.get();other.close();app.close();
            bool rejected=false;try{Options bad=o;bad.serialize_writers=false;auto x=connect("bad",bad);}
            catch(const std::runtime_error& e){rejected=std::string(e.what())=="writer policy mismatch for shared database";}
            require(rejected,"mixed writer policy accepted");return 0;
        }
        return 2;
    }catch(const std::exception& e){std::cerr<<e.what()<<std::endl;return 1;}
}
