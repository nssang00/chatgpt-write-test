#include "Messages.hpp"
#include <sqlite3.h>
#include <atomic>
#include <chrono>
#include <thread>
#include <iostream>
#include <stdexcept>
using namespace intraflow;
static void require(bool b,const char* m){if(!b)throw std::runtime_error(m);}
struct Db {
    sqlite3* p=nullptr;
    explicit Db(const char* path){if(sqlite3_open(path,&p)!=SQLITE_OK){sqlite3_close(p);throw std::runtime_error("open");}sqlite3_busy_timeout(p,5000);}
    ~Db(){sqlite3_close(p);}
    void exec(const char* sql){require(sqlite3_exec(p,sql,nullptr,nullptr,nullptr)==SQLITE_OK,"SQL");}
    int count(){sqlite3_stmt* s=nullptr;require(sqlite3_prepare_v2(p,"SELECT count(*) FROM messages",-1,&s,nullptr)==SQLITE_OK,"prepare");
        int rc=sqlite3_step(s),n=sqlite3_column_int(s,0);sqlite3_finalize(s);require(rc==SQLITE_ROW,"count");return n;}
};
int main(int argc,char** argv){
    if(argc!=2)return 2;
    try{
        Options o;o.database=argv[1];o.serialize_writers=true;
        std::atomic<int> received{0},bad{0};
        auto sub=connect("sub",o);auto pub=connect("pub",o);
        sub.subscribeAll([&](const Message& m){
            const int n=++received;
            if(m.sequence!=n)++bad;
        });
        Batch b;require(pub.publishBatch(b).empty(),"empty batch");
        Command c{};c.code=1;
        Status s{};s.source=1;s.running=true;
        b.add("cmd",c);b.add("status",s);
        require(pub.publishBatch(b)==std::vector<std::int64_t>({1,2}),"mixed batch");
        require(b.size()==2,"batch consumed");
        Db raw(argv[1]);require(raw.count()==2,"commit visibility");
        raw.exec("CREATE TRIGGER reject_batch BEFORE INSERT ON messages WHEN NEW.topic='reject' BEGIN SELECT RAISE(ABORT,'test rollback'); END");
        b.clear();b.add("cmd",c);b.add("reject",c);
        bool failed=false;try{pub.publishBatch(b);}catch(const std::runtime_error&){failed=true;}
        require(failed&&raw.count()==2,"partial batch committed");
        raw.exec("DROP TRIGGER reject_batch");
        b.clear();b.add("cmd",c);require(pub.publishBatch(b)==std::vector<std::int64_t>({3}),"recovery sequence");
        require(pub.publish("cmd",c)==4,"legacy publish");
        b.clear();
        for(int i=0;i<32;++i)b.add("cmd",c);
        bool bounded=false;try{b.add("cmd",c);}catch(const std::length_error&){bounded=true;}
        require(bounded&&b.size()==32,"batch bound");
        auto ids=pub.publishBatch(b);require(ids.size()==32&&ids.front()==5&&ids.back()==36,"large batch");
        const auto until=std::chrono::steady_clock::now()+std::chrono::seconds(10);
        while(received<36&&std::chrono::steady_clock::now()<until)std::this_thread::sleep_for(std::chrono::milliseconds(2));
        sub.close();pub.close();require(received==36&&bad==0&&raw.count()==36,"delivery or rollback");
        std::cout<<"PASS: mixed batch, empty, rollback, sequence, legacy publish, 32-message bound"<<std::endl;return 0;
    }catch(const std::exception& e){std::cerr<<e.what()<<std::endl;return 1;}
}
