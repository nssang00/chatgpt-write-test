#include "intraflow.hpp"
#include <sqlite3.h>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <iostream>
#include <mutex>
#include <stdexcept>
#include <thread>
#include <vector>
#include <algorithm>

namespace intraflow {
namespace {
void check(int rc, sqlite3* db) {
    if (rc != SQLITE_OK && rc != SQLITE_DONE && rc != SQLITE_ROW)
        throw std::runtime_error(sqlite3_errmsg(db));
}
struct Db {
    sqlite3* p = nullptr;
    Db(const std::string& path, unsigned busy) {
        int rc = sqlite3_open_v2(path.c_str(), &p, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nullptr);
        if (rc != SQLITE_OK) { std::string error = p ? sqlite3_errmsg(p) : "open failed"; sqlite3_close(p); throw std::runtime_error(error); }
        sqlite3_busy_timeout(p, static_cast<int>(busy));
    }
    ~Db() { sqlite3_close(p); }
    Db(const Db&) = delete;
    void exec(const char* sql) { check(sqlite3_exec(p,sql,nullptr,nullptr,nullptr),p); }
};
struct Stmt {
    sqlite3* db; sqlite3_stmt* s = nullptr;
    Stmt(Db& d, const char* sql):db(d.p) { check(sqlite3_prepare_v2(db,sql,-1,&s,nullptr),db); }
    ~Stmt() { sqlite3_finalize(s); }
    void bind(int i, const std::string& v) { check(sqlite3_bind_text(s,i,v.c_str(),static_cast<int>(v.size()),SQLITE_TRANSIENT),db); }
    void bind(int i, std::int64_t v) { check(sqlite3_bind_int64(s,i,v),db); }
    bool row() { int rc=sqlite3_step(s); check(rc,db); return rc==SQLITE_ROW; }
    std::int64_t num(int i) { return sqlite3_column_int64(s,i); }
    std::string str(int i) { const auto* p=sqlite3_column_text(s,i); return p ? std::string(reinterpret_cast<const char*>(p),sqlite3_column_bytes(s,i)) : std::string(); }
};
std::int64_t high(Db& db) {
    Stmt s(db,"SELECT COALESCE(MAX(seq),0) FROM messages");
    s.row(); return s.num(0);
}
void topic(Db& db,const std::string& t,const std::string& name,const std::string& hash,const std::string& schema) {
    if(t.empty()) throw std::invalid_argument("empty topic");
    { Stmt s(db,"INSERT OR IGNORE INTO topics(name,type,hash,schema) VALUES(?,?,?,?)"); s.bind(1,t);s.bind(2,name);s.bind(3,hash);s.bind(4,schema);s.row(); }
    Stmt s(db,"SELECT type,hash FROM topics WHERE name=?"); s.bind(1,t);
    if(!s.row() || s.str(0)!=name || s.str(1)!=hash) throw std::runtime_error("topic type mismatch: "+t);
}
}
struct Session::Impl {
    struct Listener {
        SubscriptionId id; std::string topic; std::int64_t after;
        std::function<void(const Message&)> callback;
    };
    std::string name;
    Options options;
    Db writer, reader;
    std::mutex write_mu, listeners_mu, wait_mu;
    std::condition_variable cv;
    std::vector<std::shared_ptr<Listener>> listeners;
    std::atomic<bool> running{true};
    std::thread loop;
    std::int64_t cursor;
    SubscriptionId next = 1;
    Impl(const std::string& n,const Options& o):name(n),options(o),writer(o.database,o.busy_ms),reader(o.database,o.busy_ms),cursor(0) {
        if(n.empty() || !o.poll_ms || o.database.empty()) throw std::invalid_argument("invalid options");
        writer.exec("PRAGMA journal_mode=WAL");
        writer.exec("CREATE TABLE IF NOT EXISTS topics(name TEXT PRIMARY KEY,type TEXT NOT NULL,hash TEXT NOT NULL,schema TEXT NOT NULL)");
        writer.exec("CREATE TABLE IF NOT EXISTS messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,topic TEXT NOT NULL,sender TEXT NOT NULL,timestamp INTEGER NOT NULL,payload TEXT NOT NULL)");
        writer.exec("CREATE INDEX IF NOT EXISTS messages_topic_seq ON messages(topic,seq)");
        cursor=high(reader);
        loop=std::thread([this]{run();});
    }
    ~Impl() { stop(); }
    void stop() {
        running=false; cv.notify_all();
        if(loop.joinable()) loop.join();
    }
    void run() {
        while(running) {
            bool full=false;
            try {
                std::vector<Message> batch;
                { Stmt s(reader,"SELECT m.seq,m.timestamp,m.topic,m.sender,t.type,t.hash,m.payload FROM messages m JOIN topics t ON t.name=m.topic WHERE m.seq>? ORDER BY m.seq LIMIT 256");
                  s.bind(1,cursor);
                  while(s.row()) {
                      Message m; m.sequence=s.num(0);m.timestamp=s.num(1);m.topic=s.str(2);m.sender=s.str(3);m.type=s.str(4);m.hash=s.str(5);
                      try { m.payload=Json::parse(s.str(6)); } catch(const std::exception& e) { std::cerr<<"invalid payload: "<<e.what()<<std::endl; m.payload=Json(); }
                      batch.push_back(std::move(m));
                  }
                }
                full=batch.size()==256;
                for(const auto& m:batch) {
                    if(!running) break;
                    std::vector<std::shared_ptr<Listener>> targets;
                    { std::lock_guard<std::mutex> lock(listeners_mu);
                      for(const auto& l:listeners) if(m.sequence>l->after && (l->topic.empty() || l->topic==m.topic)) targets.push_back(l);
                    }
                    for(const auto& l:targets) {
                        if(!running) break;
                        try { l->callback(m); }
                        catch(const std::exception& e) { std::cerr<<"listener: "<<e.what()<<std::endl; }
                        catch(...) { std::cerr<<"listener: unknown exception"<<std::endl; }
                    }
                    cursor=m.sequence;
                }
            } catch(const std::exception& e) { std::cerr<<"receive: "<<e.what()<<std::endl; }
            if(!full) {
                std::unique_lock<std::mutex> lock(wait_mu);
                cv.wait_for(lock,std::chrono::milliseconds(options.poll_ms),[this]{return !running;});
            }
        }
    }
    SubscriptionId add(const std::string& t,const std::string& name,const std::string& hash,const std::string& schema,std::function<void(const Message&)> cb) {
        if(!cb) throw std::invalid_argument("empty callback");
        std::lock_guard<std::mutex> lock(listeners_mu);
        std::lock_guard<std::mutex> write(write_mu);
        if(!t.empty()) topic(writer,t,name,hash,schema);
        auto l=std::make_shared<Listener>(); l->id=next++;l->topic=t;l->after=high(writer);l->callback=std::move(cb);
        listeners.push_back(l); return l->id;
    }
};
Session::Session(const std::string& name,const Options& options):impl_(new Impl(name,options)) {}
Session::~Session()=default;
Session::Session(Session&&) noexcept=default;
Session& Session::operator=(Session&&) noexcept=default;
Session::Impl& Session::checked() {
    if(!impl_ || !impl_->running) throw std::runtime_error("closed session");
    return *impl_;
}
std::int64_t Session::publishRaw(const std::string& t,const std::string& name,const std::string& hash,const std::string& schema,const Json& value) {
    auto& p=checked();
    auto json=value.dump();
    if(json.size()>1024*1024) throw std::runtime_error("message exceeds 1 MiB");
    std::lock_guard<std::mutex> lock(p.write_mu);
    p.writer.exec("BEGIN IMMEDIATE");
    try {
        topic(p.writer,t,name,hash,schema);
        Stmt s(p.writer,"INSERT INTO messages(topic,sender,timestamp,payload) VALUES(?,?,?,?)");
        s.bind(1,t);s.bind(2,p.name);
        s.bind(3,static_cast<std::int64_t>(std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::system_clock::now().time_since_epoch()).count()));
        s.bind(4,json);s.row();
        auto seq=sqlite3_last_insert_rowid(p.writer.p);
        p.writer.exec("COMMIT"); return seq;
    } catch(...) { sqlite3_exec(p.writer.p,"ROLLBACK",nullptr,nullptr,nullptr); throw; }
}
SubscriptionId Session::subscribeRaw(const std::string& t,const std::string& name,const std::string& hash,const std::string& schema,std::function<void(const Message&)> cb) {
    if(t.empty()) throw std::invalid_argument("empty topic");
    return checked().add(t,name,hash,schema,std::move(cb));
}
SubscriptionId Session::subscribeAll(std::function<void(const Message&)> cb) { return checked().add("","","","",std::move(cb)); }
void Session::unsubscribe(SubscriptionId id) {
    auto& p=checked();std::lock_guard<std::mutex> lock(p.listeners_mu);
    p.listeners.erase(std::remove_if(p.listeners.begin(),p.listeners.end(),[id](const std::shared_ptr<Impl::Listener>& l){return l->id==id;}),p.listeners.end());
}
void Session::close() {
    if(!impl_) return;
    if(impl_->loop.get_id()==std::this_thread::get_id()) throw std::logic_error("close from listener not allowed");
    impl_->stop();
}
}
