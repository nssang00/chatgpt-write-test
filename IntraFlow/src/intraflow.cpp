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
#include <unordered_map>
#include <utility>

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
    void exec(const char* sql) {
        const int rc=sqlite3_exec(p,sql,nullptr,nullptr,nullptr);
        if(rc!=SQLITE_OK) throw std::runtime_error(std::string(sql)+": "+sqlite3_errmsg(p));
    }
};
struct Stmt {
    sqlite3* db; sqlite3_stmt* s = nullptr;
    Stmt(Db& d, const char* sql):db(d.p) { check(sqlite3_prepare_v2(db,sql,-1,&s,nullptr),db); }
    ~Stmt() { sqlite3_finalize(s); }
    Stmt(const Stmt&) = delete;
    void reset() noexcept { sqlite3_reset(s); sqlite3_clear_bindings(s); }
    void bind(int i, const std::string& v) { check(sqlite3_bind_text(s,i,v.c_str(),static_cast<int>(v.size()),SQLITE_TRANSIENT),db); }
    void bind(int i, std::int64_t v) { check(sqlite3_bind_int64(s,i,v),db); }
    bool row() {
        int rc=sqlite3_step(s);
        if(rc!=SQLITE_ROW && rc!=SQLITE_DONE)
            throw std::runtime_error(std::string(sqlite3_sql(s))+": "+sqlite3_errmsg(db));
        return rc==SQLITE_ROW;
    }
    std::int64_t num(int i) { return sqlite3_column_int64(s,i); }
    std::string str(int i) { const auto* p=sqlite3_column_text(s,i); return p ? std::string(reinterpret_cast<const char*>(p),sqlite3_column_bytes(s,i)) : std::string(); }
};
struct ResetStmt {
    Stmt& stmt;
    ~ResetStmt() { stmt.reset(); }
};
#ifdef INTRAFLOW_DIAGNOSTICS
using DiagClock=std::chrono::steady_clock;
static std::int64_t elapsedUs(DiagClock::time_point t) {
    return std::chrono::duration_cast<std::chrono::microseconds>(DiagClock::now()-t).count();
}
struct Timing {
    std::int64_t count=0,total=0,max=0;
    void add(std::int64_t us) noexcept {++count;total+=us;max=std::max(max,us);}
    Json json() const {return {{"count",count},{"total_us",total},{"max_us",max}};}
};
struct Diagnostics {
    int timeout=0,threshold=0,requested=0;
    bool short_retry=false;
    std::uint32_t rng=1;
    DiagClock::time_point retry_start;
    std::int64_t busy_calls=0,busy_episodes=0,checkpoint_busy=0,checkpoint_errors=0,wal_commits=0;
    Timing busy_sleep,checkpoint,insert,poll_wait,read_batch,json_parse,callback;
    // Separate receiver-owned counters: never read by publishRaw.
    Timing maintenance;
    std::int64_t maintenance_busy=0,maintenance_errors=0,maintenance_partial=0,maintenance_valid=0;
    int max_log_frames=0,max_backfilled_frames=0,max_pending_frames=0,last_log_frames=-1,last_backfilled_frames=-1;
    Json config,slowest_insert;
    static int busy(void* p,int prior) noexcept {
        auto& d=*static_cast<Diagnostics*>(p);
        ++d.busy_calls;
        if(prior==0){++d.busy_episodes;d.requested=0;d.retry_start=DiagClock::now();}
        int ms=0;
        if(d.short_retry){
            // Deadline includes actual OS scheduling delay. Jitter prevents
            // all competing processes retrying at the same instant.
            const auto remaining=static_cast<std::int64_t>(d.timeout)*1000-elapsedUs(d.retry_start);
            if(remaining<1000)return 0;
            d.rng^=d.rng<<13;d.rng^=d.rng>>17;d.rng^=d.rng<<5;
            ms=static_cast<int>(std::min<std::int64_t>(remaining/1000,1+d.rng%5));
        } else {
            const int delays[]={1,2,5,10,15,20,25,25,25,50,50,100};
            ms=std::min(d.timeout-d.requested,delays[std::min(prior,11)]);
            if(ms<=0)return 0;
            d.requested+=ms;
        }
        const auto begin=DiagClock::now();
        sqlite3_sleep(ms);
        d.busy_sleep.add(elapsedUs(begin));
        return !d.short_retry || elapsedUs(d.retry_start)<static_cast<std::int64_t>(d.timeout)*1000;
    }
    // Diagnostic-only replacement for native autocheckpoint.
    static int wal(void* p,sqlite3* db,const char* name,int frames) noexcept {
        auto& d=*static_cast<Diagnostics*>(p);
        ++d.wal_commits;
        if(d.threshold>0&&frames>=d.threshold) {
            const auto begin=DiagClock::now();
            int log=0,done=0;
            const int rc=sqlite3_wal_checkpoint_v2(db,name,SQLITE_CHECKPOINT_PASSIVE,&log,&done);
            d.checkpoint.add(elapsedUs(begin));
            if(rc==SQLITE_BUSY)++d.checkpoint_busy;
            else if(rc!=SQLITE_OK)++d.checkpoint_errors;
        }
        return SQLITE_OK;
    }
    void maintain(Db& db) noexcept {
        int log=-1,done=-1;
        const auto begin=DiagClock::now();
        const int rc=sqlite3_wal_checkpoint_v2(db.p,"main",SQLITE_CHECKPOINT_PASSIVE,&log,&done);
        maintenance.add(elapsedUs(begin));
        if(rc==SQLITE_BUSY)++maintenance_busy;
        else if(rc!=SQLITE_OK)++maintenance_errors;
        if(log>=0&&done>=0){
            ++maintenance_valid;
            last_log_frames=log;last_backfilled_frames=done;
            max_log_frames=std::max(max_log_frames,log);
            max_backfilled_frames=std::max(max_backfilled_frames,done);
            max_pending_frames=std::max(max_pending_frames,std::max(0,log-done));
            if(done<log)++maintenance_partial;
        }
    }
    static Json pragmas(Db& db) {
        Json r;
        for(const char* key:{"journal_mode","synchronous","busy_timeout","wal_autocheckpoint",
                "page_size","cache_size","temp_store","mmap_size","locking_mode",
                "journal_size_limit","query_only","auto_vacuum","read_uncommitted"}){
            const auto sql=std::string("PRAGMA ")+key;
            Stmt s(db,sql.c_str());
            if(s.row())r[key]=s.str(0);else r[key]=nullptr;
        }
        return r;
    }
    Json json() const {
        return {{"config",config},{"busy_calls",busy_calls},{"busy_episodes",busy_episodes},
            {"busy_sleep",busy_sleep.json()},{"checkpoint",checkpoint.json()},
            {"checkpoint_busy",checkpoint_busy},{"checkpoint_errors",checkpoint_errors},
            {"wal_commits",wal_commits},{"insert_step",insert.json()},
            {"poll_wait",poll_wait.json()},{"read_batch",read_batch.json()},
            {"json_parse",json_parse.json()},{"callback",callback.json()},
            {"slowest_insert",slowest_insert},{"maintenance",{
                {"timing",maintenance.json()},{"busy",maintenance_busy},{"errors",maintenance_errors},
                {"partial",maintenance_partial},{"valid",maintenance_valid},
                {"max_log_frames",max_log_frames},{"max_backfilled_frames",max_backfilled_frames},
                {"max_pending_frames",max_pending_frames},{"last_log_frames",last_log_frames},
                {"last_backfilled_frames",last_backfilled_frames}}}};
    }
};
#endif
std::int64_t high(Db& db) {
    Stmt s(db,"SELECT COALESCE(MAX(seq),0) FROM messages");
    s.row(); return s.num(0);
}
using TypeKey=std::pair<std::string,std::string>;
using TopicCache=std::unordered_map<std::string,TypeKey>;
void topic(Db& db,TopicCache& cache,const std::string& t,const std::string& name,const std::string& hash,const std::string& schema) {
    if(t.empty()) throw std::invalid_argument("empty topic");
    const TypeKey wanted(name,hash);
    const auto cached=cache.find(t);
    if(cached!=cache.end()) {
        if(cached->second!=wanted) throw std::runtime_error("topic type mismatch: "+t);
        return;
    }
    // Existing topics need no writer lock. If absent, concurrent creators
    // race via the unique key, then everyone verifies the committed type.
    auto lookup=[&]() {
        Stmt s(db,"SELECT type,hash FROM topics WHERE name=?");s.bind(1,t);
        if(!s.row())return false;
        if(s.str(0)!=name||s.str(1)!=hash)throw std::runtime_error("topic type mismatch: "+t);
        return true;
    };
    if(!lookup()) {
        { Stmt s(db,"INSERT OR IGNORE INTO topics(name,type,hash,schema) VALUES(?,?,?,?)"); s.bind(1,t);s.bind(2,name);s.bind(3,hash);s.bind(4,schema);s.row(); }
        if(!lookup())throw std::runtime_error("topic registration failed: "+t);
    }
    cache.emplace(t,wanted);
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
#ifdef INTRAFLOW_DIAGNOSTICS
    Diagnostics diag;
    std::unique_ptr<Db> maintenance_db;
#endif
    TopicCache topics;
    std::unique_ptr<Stmt> insert, poll;
    std::mutex write_mu, listeners_mu, wait_mu;
    std::condition_variable cv;
    std::vector<std::shared_ptr<Listener>> listeners;
    std::atomic<bool> running{true};
    std::thread loop;
    std::int64_t cursor;
    SubscriptionId next = 1;
    Impl(const std::string& n,const Options& o):name(n),options(o),writer(o.database,o.busy_ms),reader(o.database,o.busy_ms),cursor(0) {
        if(n.empty() || !o.poll_ms || o.database.empty()) throw std::invalid_argument("invalid options");
        { Stmt mode(writer,"PRAGMA journal_mode=WAL");
          if(!mode.row()||mode.str(0)!="wal")throw std::runtime_error("WAL mode unavailable"); }
        writer.exec(o.full_sync?"PRAGMA synchronous=FULL":"PRAGMA synchronous=NORMAL");
        reader.exec("PRAGMA query_only=ON");
        writer.exec("CREATE TABLE IF NOT EXISTS topics(name TEXT PRIMARY KEY,type TEXT NOT NULL,hash TEXT NOT NULL,schema TEXT NOT NULL)");
        writer.exec("CREATE TABLE IF NOT EXISTS messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,topic TEXT NOT NULL,sender TEXT NOT NULL,timestamp INTEGER NOT NULL,payload TEXT NOT NULL)");
        writer.exec("CREATE INDEX IF NOT EXISTS messages_topic_seq ON messages(topic,seq)");
        insert.reset(new Stmt(writer,"INSERT INTO messages(topic,sender,timestamp,payload) VALUES(?,?,?,?)"));
        poll.reset(new Stmt(reader,"SELECT m.seq,m.timestamp,m.topic,m.sender,t.type,t.hash,m.payload FROM messages m JOIN topics t ON t.name=m.topic WHERE m.seq>? ORDER BY m.seq LIMIT 256"));
        cursor=high(reader);
#ifdef INTRAFLOW_DIAGNOSTICS
        if(o.diagnostic_checkpoint>=0)
            check(sqlite3_wal_autocheckpoint(writer.p,o.diagnostic_checkpoint),writer.p);
        diag.config={{"sqlite_version",sqlite3_libversion()},{"writer",Diagnostics::pragmas(writer)},
                     {"reader",Diagnostics::pragmas(reader)},{"custom_hooks",o.diagnostic_hooks},
                     {"short_retry",o.diagnostic_short_retry}};
        diag.threshold=std::stoi(diag.config["writer"]["wal_autocheckpoint"].get<std::string>());
        diag.timeout=static_cast<int>(o.busy_ms);
        diag.short_retry=o.diagnostic_short_retry;
        diag.rng=o.diagnostic_retry_seed?o.diagnostic_retry_seed:1;
        if(o.diagnostic_hooks||o.diagnostic_short_retry)
            check(sqlite3_busy_handler(writer.p,Diagnostics::busy,&diag),writer.p);
        if(o.diagnostic_hooks)
            sqlite3_wal_hook(writer.p,Diagnostics::wal,&diag);
        if(o.diagnostic_maintenance_ms){
            if(o.diagnostic_checkpoint!=0||o.diagnostic_hooks||o.diagnostic_short_retry)
                throw std::invalid_argument("maintenance requires native busy and disabled autocheckpoint");
            // One designated peer, separate writable connection, same
            // receive thread. PASSIVE never waits for a reader/writer lock.
            maintenance_db.reset(new Db(o.database,0));
            maintenance_db->exec(o.full_sync?"PRAGMA synchronous=FULL":"PRAGMA synchronous=NORMAL");
            check(sqlite3_wal_autocheckpoint(maintenance_db->p,0),maintenance_db->p);
            high(*maintenance_db); // initialize WAL pager before checkpoint
        }
#endif
        loop=std::thread([this]{run();});
    }
    ~Impl() { stop(); }
    void stop() {
        { std::lock_guard<std::mutex> lock(wait_mu); running=false; }
        cv.notify_all();
        if(loop.joinable()) loop.join();
    }
    void run() {
#ifdef INTRAFLOW_DIAGNOSTICS
        auto next_maintenance=DiagClock::now()+std::chrono::milliseconds(options.diagnostic_maintenance_ms);
#endif
        while(running) {
            bool full=false;
            try {
                struct Raw { Message message; std::string json; };
                std::vector<Raw> batch;
                std::size_t raw_bytes=0;
#ifdef INTRAFLOW_DIAGNOSTICS
                const auto readBegin=DiagClock::now();
#endif
                { auto& s=*poll;
                  ResetStmt reset{s};
                  s.bind(1,cursor);
                  while(s.row()) {
                      Message m; m.sequence=s.num(0);m.timestamp=s.num(1);m.topic=s.str(2);m.sender=s.str(3);m.type=s.str(4);m.hash=s.str(5);
                      auto raw=s.str(6); raw_bytes+=raw.size();
                      batch.push_back(Raw{std::move(m),std::move(raw)});
                      if(raw_bytes >= 4u*1024u*1024u) {full=true;break;}
                  }
                }
#ifdef INTRAFLOW_DIAGNOSTICS
                diag.read_batch.add(elapsedUs(readBegin));
#endif
                full=full || batch.size()==256;
                for(auto& entry:batch) {
                    if(!running) break;
                    auto& m=entry.message;
                    std::vector<std::shared_ptr<Listener>> targets;
                    { std::lock_guard<std::mutex> lock(listeners_mu);
                      for(const auto& l:listeners) if(m.sequence>l->after && (l->topic.empty() || l->topic==m.topic)) targets.push_back(l);
                    }
                    if(!targets.empty()) {
#ifdef INTRAFLOW_DIAGNOSTICS
                        const auto parseBegin=DiagClock::now();
#endif
                        try { m.payload=Json::parse(entry.json); }
                        catch(const std::exception& e) { std::cerr<<"invalid payload: "<<e.what()<<std::endl; cursor=m.sequence;continue; }
#ifdef INTRAFLOW_DIAGNOSTICS
                        diag.json_parse.add(elapsedUs(parseBegin));
#endif
                    }
                    for(const auto& l:targets) {
                        if(!running) break;
#ifdef INTRAFLOW_DIAGNOSTICS
                        const auto callbackBegin=DiagClock::now();
#endif
                        try { l->callback(m); }
                        catch(const std::exception& e) { std::cerr<<"listener: "<<e.what()<<std::endl; }
                        catch(...) { std::cerr<<"listener: unknown exception"<<std::endl; }
#ifdef INTRAFLOW_DIAGNOSTICS
                        diag.callback.add(elapsedUs(callbackBegin));
#endif
                    }
                    cursor=m.sequence;
                }
            } catch(const std::exception& e) { std::cerr<<"receive: "<<e.what()<<std::endl; }
#ifdef INTRAFLOW_DIAGNOSTICS
            // The SELECT has been reset and callbacks have returned.
            // Do not hold the writer/listener mutex during disk work.
            if(running&&maintenance_db&&DiagClock::now()>=next_maintenance){
                diag.maintain(*maintenance_db);
                next_maintenance=DiagClock::now()+std::chrono::milliseconds(options.diagnostic_maintenance_ms);
            }
#endif
            if(!full) {
                std::unique_lock<std::mutex> lock(wait_mu);
#ifdef INTRAFLOW_DIAGNOSTICS
                const auto waitBegin=DiagClock::now();
#endif
                cv.wait_for(lock,std::chrono::milliseconds(options.poll_ms),[this]{return !running;});
#ifdef INTRAFLOW_DIAGNOSTICS
                if(running)diag.poll_wait.add(elapsedUs(waitBegin));
#endif
            }
        }
    }
    SubscriptionId add(const std::string& t,const std::string& name,const std::string& hash,const std::string& schema,std::function<void(const Message&)> cb) {
        if(!cb) throw std::invalid_argument("empty callback");
        std::lock_guard<std::mutex> lock(listeners_mu);
        std::lock_guard<std::mutex> write(write_mu);
        if(!t.empty()) topic(writer,topics,t,name,hash,schema);
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
    topic(p.writer,p.topics,t,name,hash,schema);
    // A single autocommit INSERT completes at SQLITE_DONE. Keep the writer
    // lock window small; topic registration is independently committed.
    auto& s=*p.insert;
    ResetStmt reset{s};
    s.bind(1,t);s.bind(2,p.name);
    s.bind(3,static_cast<std::int64_t>(std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::system_clock::now().time_since_epoch()).count()));
    s.bind(4,json);
#ifdef INTRAFLOW_DIAGNOSTICS
    auto& d=p.diag;
    const auto begin=DiagClock::now();
    const auto busyBefore=d.busy_sleep.total, checkpointBefore=d.checkpoint.total;
    const auto callsBefore=d.busy_calls;
    s.row();
    const auto stepUs=elapsedUs(begin);
    if(d.insert.count==0||stepUs>d.insert.max)
        d.slowest_insert={{"topic",t},{"step_us",stepUs},{"busy_sleep_us",d.busy_sleep.total-busyBefore},
                          {"busy_calls",d.busy_calls-callsBefore},{"checkpoint_us",d.checkpoint.total-checkpointBefore}};
    d.insert.add(stepUs);
#else
    s.row();
#endif
    return sqlite3_last_insert_rowid(p.writer.p);
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
#ifdef INTRAFLOW_DIAGNOSTICS
Json Session::diagnostics() const {
    if(!impl_||impl_->running)throw std::logic_error("diagnostics requires closed session");
    return impl_->diag.json();
}
#endif
void Session::close() {
    if(!impl_) return;
    if(impl_->loop.get_id()==std::this_thread::get_id()) throw std::logic_error("close from listener not allowed");
    impl_->stop();
}
}
