#include "Messages.hpp"
#include <sqlite3.h>
#include <atomic>
#include <chrono>
#include <fstream>
#include <iostream>
#include <mutex>
#include <thread>
#include <vector>
#include <stdexcept>

using namespace intraflow;
static void require(bool good,const char* msg){if(!good) throw std::runtime_error(msg);}
template<class F> static void until(F ready){
    auto end=std::chrono::steady_clock::now()+std::chrono::seconds(20);
    while(!ready()) {
        require(std::chrono::steady_clock::now()<end,"wait timeout");
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
}
struct LockDb {
    sqlite3* db=nullptr;
    explicit LockDb(const char* path) {
        if(sqlite3_open(path,&db)!=SQLITE_OK){sqlite3_close(db);throw std::runtime_error("sqlite open");}
    }
    ~LockDb(){sqlite3_close(db);}
    void exec(const char* sql){require(sqlite3_exec(db,sql,nullptr,nullptr,nullptr)==SQLITE_OK,"sqlite exec");}
};
int main(int argc,char** argv) {
    try {
        if(argc!=4) return 2;
        Options o;o.database=argv[2];o.busy_ms=200;
        const std::string mode=argv[1];
        if(mode=="crash"){
            auto app=connect("crash",o);
            Command c{};c.code=111;
            app.publish("committed",c);
            LockDb db(argv[2]);
            db.exec("BEGIN IMMEDIATE");
            db.exec("INSERT INTO messages(topic,sender,timestamp,payload) VALUES('committed','crash',0,'{\"code\":222}')");
            {std::ofstream ready(argv[3]);ready<<"ready";}
            for(;;) std::this_thread::sleep_for(std::chrono::seconds(1));
        }
        if(mode=="reopen"){
            auto app=connect("reopened",o);
            Command c{};c.code=333;
            app.publish("committed",c);
            return 0;
        }
        constexpr int workers=4, rounds=100, total=workers*rounds;
        std::atomic<int> received{0}, errors{0}, once{0}, mutableCount{0}, late{0}, throwCount{0}, finalCount{0};
        std::vector<int> last(workers,-1);
        std::thread::id callbackThread;
        SubscriptionId onceId=0;
        auto app=connect("stability",o);
        // A late subscriber must not receive this earlier row.
        Command old{};old.code=-1;app.publish("late",old);
        app.subscribe<Command>("late",[&](const Command&){++late;});
        app.subscribe<BenchMessage>("concurrent",[&](const BenchMessage& m){
            if(callbackThread==std::thread::id()) callbackThread=std::this_thread::get_id();
            if(callbackThread!=std::this_thread::get_id() || m.source<0 || m.source>=workers ||
               m.index!=last[m.source]+1 || m.data!="test") ++errors;
            else last[m.source]=m.index;
            ++received;
        });
        int state=0;
        app.subscribe<BenchMessage>("concurrent",[&mutableCount, state](const BenchMessage&) mutable {
            mutableCount=++state;
        });
        onceId=app.subscribe<BenchMessage>("concurrent",[&](const BenchMessage&){
            ++once;app.unsubscribe(onceId);
        });
        app.subscribe<BenchMessage>("concurrent",[&](const BenchMessage&){
            if(++throwCount==1) throw std::runtime_error("intentional callback exception");
        });
        app.subscribe<BenchMessage>("concurrent",[&](const BenchMessage&){++finalCount;});
        bool mismatch=false;
        try {app.publish("concurrent",old);} catch(const std::exception&){mismatch=true;}
        require(mismatch,"type mismatch accepted");
        // Another session must validate the persisted topic, not just its cache.
        {
            Options durable=o;durable.full_sync=true;
            auto other=connect("other",durable);
            bool bad=false;
            try{other.subscribe<Command>("concurrent",[](const Command&){});}catch(const std::exception&){bad=true;}
            require(bad,"cross-session mismatch accepted");
            Command c{};c.code=17;
            other.publish("durable",c);
            other.close();
        }
        std::vector<std::thread> pool;
        for(int i=0;i<workers;++i) pool.emplace_back([&,i]{
            try {
                for(int j=0;j<rounds;++j){
                    BenchMessage m{};m.source=i;m.index=j;m.data="test";
                    app.publish("concurrent",m);
                }
            } catch(...) {++errors;}
        });
        for(auto& t:pool)t.join();
        require(errors==0,"publisher failed");
        until([&]{return finalCount==total;});
        require(received==total && mutableCount==total && once==1 && errors==0 &&
                throwCount==total,"callback contract failed");
        require(late==0,"old message replayed");
        // Another connection owns the writer lock. A failed publish must not leave
        // our connection in a transaction, and retry must succeed after release.
        {
            LockDb lock(argv[2]);lock.exec("BEGIN IMMEDIATE");
            bool failed=false;
            try{app.publish("late",old);}catch(const std::exception&){failed=true;}
            require(failed,"write unexpectedly succeeded");
            lock.exec("ROLLBACK");
        }
        app.publish("late",old);
        until([&]{return late==1;});
        app.close();
        return 0;
    }catch(const std::exception& e){std::cerr<<e.what()<<std::endl;return 1;}
}
