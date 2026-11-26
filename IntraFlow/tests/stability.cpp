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
#include <future>
#include <memory>

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
// Both captureless lambdas and ordinary functions use this observable state.
static std::atomic<int> plainSum{0}, functionSum{0};
static void plainFunction(const Command& c){functionSum+=c.code;}
struct Handler {
    std::atomic<int> memberSum{0}, bindSum{0};
    void member(const Command& c){memberSum+=c.code;}
    void bound(const Command& c){bindSum+=c.code;}
    void attach(Session& app){
        app.subscribe<Command>("lambda.input",[this](const Command& c){member(c);});
        app.subscribe<Command>("lambda.input",std::bind(&Handler::bound,this,std::placeholders::_1));
    }
};
static void lambdaTests(const Options& o){
    plainSum=0;functionSum=0;
    const auto mainThread=std::this_thread::get_id();
    std::atomic<int> refSum{0}, valueSum{0}, mutableSum{0}, stdFunctionSum{0},
        removed{0}, self{0}, responses{0}, late{0}, errors{0}, done{0}, all{0};
    std::atomic<int> refFactor{3};
    int factor=3, state=0;
    Handler handler;
    std::thread::id callbackThread;
    SubscriptionId selfId=0;
    auto app=connect("lambda",o);
    auto publisher=connect("lambda-publisher",o);
    app.subscribe<Command>("lambda.input",[](const Command& c){plainSum+=c.code;});
    app.subscribe<Command>("lambda.input",plainFunction);
    app.subscribe<Command>("lambda.input",[&](const Command& c){
        refSum+=c.code*refFactor.load();
        if(callbackThread==std::thread::id())callbackThread=std::this_thread::get_id();
        if(callbackThread!=std::this_thread::get_id()||callbackThread==mainThread)++errors;
    });
    app.subscribe<Command>("lambda.input",[factor,&valueSum](const Command& c){valueSum+=factor*c.code;});
    app.subscribe<Command>("lambda.input",[state,&mutableSum](const Command&) mutable {mutableSum=++state;});
    std::function<void(const Command&)> fn=[&](const Command& c){stdFunctionSum+=c.code;};
    app.subscribe<Command>("lambda.input",fn);
    handler.attach(app);
    auto removedId=app.subscribe<Command>("lambda.input",[&](const Command&){++removed;});
    app.unsubscribe(removedId);
    app.subscribe<Command>("lambda.response",[&](const Command& c){
        if(c.code<101||c.code>105||std::this_thread::get_id()!=callbackThread)++errors;
        ++responses;
    });
    selfId=app.subscribe<Command>("lambda.input",[&](const Command&){
        ++self;
        app.unsubscribe(selfId);
        app.subscribe<Command>("lambda.late",[&](const Command&){++late;});
        Command reply{};reply.code=7;
        app.publish("lambda.late",reply);
    });
    app.subscribe<Command>("lambda.input",[&](const Command& c){
        Command reply{};reply.code=100+c.code;
        app.publish("lambda.response",reply);
    });
    app.subscribe<Command>("lambda.input",[](const Command& c){
        if(c.code==1)throw std::runtime_error("expected lambda exception");
    });
    app.subscribe<Command>("lambda.input",[&](const Command&){++done;});
    app.subscribeAll([&](const Message& m){
        if(m.type!="Command"||!m.payload.contains("code")||std::this_thread::get_id()!=callbackThread)++errors;
        ++all;
    });
    // Verify invalid callback fails at registration, not on receive.
    bool emptyRejected=false;
    try{app.subscribe<Command>("lambda.input",std::function<void(const Command&)>());}
    catch(const std::invalid_argument&){emptyRejected=true;}
    require(emptyRejected,"empty callback accepted");
    // Set reference-captured value before any publication. Use atomic
    // to synchronize the value with the receiver in the test below.
    refFactor=5;
    for(int i=1;i<=5;++i){
        Command c{};c.code=i;
        publisher.publish("lambda.input",c);
        c.code=-1; // a later mutation must not modify published data
    }
    until([&]{return all==11;}); // 5 inputs + 5 responses + 1 late
    app.close();
    publisher.close();
    require(plainSum==15&&functionSum==15&&refSum==75&&valueSum==45&&mutableSum==5&&
            stdFunctionSum==15&&handler.memberSum==15&&handler.bindSum==15&&
            removed==0&&self==1&&responses==5&&late==1&&done==5&&all==11&&errors==0,
            "lambda listener contract failed");
    std::cout<<"PASS: all lambda/function/member listeners and callback reentrancy"<<std::endl;
}

// A rare slow task is controlled by the test, not by timing assumptions.
// The shared state belongs to the detached worker as well as the caller.
// It deliberately owns no Session pointer or references to stack objects.
struct SlowTask {
    std::atomic<bool> started{false}, release{false};
    std::atomic<int> errors{0};
    std::promise<void> done;
    void run(const Command& copy) {
        started=true;
        const auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(15);
        while(!release && std::chrono::steady_clock::now()<deadline)
            std::this_thread::sleep_for(std::chrono::milliseconds(2));
        if(!release || copy.code!=42)++errors;
    }
};
struct ReleaseTask {
    std::shared_ptr<SlowTask> state;
    ~ReleaseTask(){state->release=true;}
};
static void slowListenerCase(const Options& o,bool detached) {
    const std::string prefix=detached?"offload.":"direct.";
    const int count=100;
    auto state=std::make_shared<SlowTask>();
    auto done=state->done.get_future();
    std::atomic<int> fast{0}, independent{0}, errors{0};
    auto receiver=connect(prefix+"receiver",o);
    auto other=connect(prefix+"other",o);
    auto publisher=connect(prefix+"publisher",o);
    // Ensure the slow task can leave even if a test assertion throws.
    ReleaseTask release{state};
    if(detached) {
        receiver.subscribe<Command>(prefix+"slow",[state](const Command& cmd){
            std::thread([state,cmd]{
                try {
                    state->run(cmd);
                } catch(...) { ++state->errors; }
                // Completion becomes observable only once the thread exits.
                state->done.set_value_at_thread_exit();
            }).detach();
        });
    } else {
        receiver.subscribe<Command>(prefix+"slow",[state](const Command& cmd){
            try {state->run(cmd);}catch(...){++state->errors;}
            state->done.set_value();
        });
    }
    receiver.subscribe<Command>(prefix+"fast",[&](const Command& cmd){
        if(cmd.code!=fast.load())++errors;
        ++fast;
    });
    other.subscribe<Command>(prefix+"fast",[&](const Command& cmd){
        if(cmd.code!=independent.load())++errors;
        ++independent;
    });
    Command cmd{};cmd.code=42;publisher.publish(prefix+"slow",cmd);
    cmd.code=-1;
    until([&]{return state->started.load();});
    // About one second of fast traffic while the rare slow task is held.
    for(int i=0;i<count;++i){
        Command msg{};msg.code=i;publisher.publish(prefix+"fast",msg);
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    until([&]{return independent==count;});
    if(detached)until([&]{return fast==count;});
    else require(fast==0,"direct slow callback did not block its event loop");
    require(done.wait_for(std::chrono::milliseconds(0))==std::future_status::timeout,
            "slow task finished prematurely");
    std::cout<<(detached?"offload":"direct")<<": fast while slow pending="
             <<fast.load()<<"/"<<count<<", independent="<<independent.load()<<"/"<<count<<std::endl;
    state->release=true;
    require(done.wait_for(std::chrono::seconds(5))==std::future_status::ready,"slow task completion timeout");
    done.get();
    until([&]{return fast==count;});
    receiver.close();other.close();publisher.close();
    require(errors==0 && state->errors==0 && fast==count && independent==count,
            "slow listener delivery or lifetime failure");
}

int main(int argc,char** argv) {
    try {
        if(argc!=4) return 2;
        Options o;o.database=argv[2];o.busy_ms=200;
        const std::string mode=argv[1];
        if(mode=="lambda"){lambdaTests(o);return 0;}
        if(mode=="offload"){slowListenerCase(o,false);slowListenerCase(o,true);return 0;}
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
