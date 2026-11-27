#include "intraflow.hpp"
#include <sqlite3.h>
#include "process_writer_lock.hpp"
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
struct WriterActivity {
    // Pack the stage and its monotonic start into one atomic snapshot.
    std::atomic<std::uint64_t> state{0};
    static std::uint64_t now() noexcept {
        return static_cast<std::uint64_t>(std::chrono::duration_cast<std::chrono::microseconds>(
            DiagClock::now().time_since_epoch()).count());
    }
    void set(unsigned stage) noexcept {state.store(stage?(now()<<3)|stage:0);}
    Json json() const {
        const auto v=state.load();
        const auto t=now();
        const char* names[]={"idle","os_wait","topic_bind","sqlite_step_commit_checkpoint","reset_unlock"};
        const unsigned stage=static_cast<unsigned>(v&7);
        return {{"stage",names[stage]},{"elapsed_ms",stage&&t>=(v>>3)?(t-(v>>3))/1000.0:0.0}};
    }
};
// A second atomic clock identifies the active nested operation without
// acquiring a SQLite lock from the diagnostic watchdog.
struct ActivityDetail {
    std::atomic<std::uint64_t> state{0};
    std::uint64_t enter(unsigned kind) noexcept {
        return state.exchange((WriterActivity::now()<<4)|kind);
    }
    void restore(std::uint64_t previous) noexcept {state.store(previous);}
    Json json(const char* const* names) const {
        const auto v=state.load(),t=WriterActivity::now();
        return {{"operation",names[v&15]},{"elapsed_ms",v&&t>=(v>>4)?(t-(v>>4))/1000.0:0.0}};
    }
};
struct ActivityScope {
    ActivityDetail& detail;
    std::uint64_t previous;
    ActivityScope(ActivityDetail& d,unsigned kind):detail(d),previous(d.enter(kind)){}
    ~ActivityScope(){detail.restore(previous);}
};
#ifdef _WIN32
// Diagnostic test processes only: use SQLite's supported Win32 VFS
// system-call override API. Forward to the original function unchanged.
// LastError must survive the measurement and clock calls.
struct WinIoTrace {
    ActivityDetail active;
    Timing calls[10];
    static const char* const* names(){
        static const char* const n[]={"none","FlushFileBuffers","WriteFile","ReadFile",
            "LockFileEx","UnlockFileEx","LockFile","UnlockFile","SetEndOfFile","Sleep"};
        return n;
    }
    Json json() const {
        Json j=Json::object();
        for(unsigned i=1;i<10;++i)j[names()[i]]=calls[i].json();
        return j;
    }
};
thread_local WinIoTrace* currentWinTrace=nullptr;
struct WinTraceScope {
    WinIoTrace* previous;
    explicit WinTraceScope(WinIoTrace* t):previous(currentWinTrace){currentWinTrace=t;}
    ~WinTraceScope(){currentWinTrace=previous;}
};
template<class F,class... Args>
BOOL tracedWinCall(unsigned kind,F fn,Args... args) noexcept {
    auto* t=currentWinTrace;
    if(!t)return fn(args...);
    const DWORD before=GetLastError();
    const auto start=DiagClock::now();
    const auto old=t->active.enter(kind);
    SetLastError(before);
    const BOOL result=fn(args...);
    const DWORD after=GetLastError();
    t->active.restore(old);
    t->calls[kind].add(elapsedUs(start));
    SetLastError(after);
    return result;
}
#define INTRAFLOW_WIN_TRACE(Name,Kind,Signature,...) \
    static decltype(&::Name) real##Name=nullptr; \
    static BOOL WINAPI trace##Name Signature noexcept {return tracedWinCall(Kind,real##Name,__VA_ARGS__);}
INTRAFLOW_WIN_TRACE(FlushFileBuffers,1,(HANDLE h),h)
INTRAFLOW_WIN_TRACE(WriteFile,2,(HANDLE h,LPCVOID p,DWORD n,LPDWORD done,LPOVERLAPPED o),h,p,n,done,o)
INTRAFLOW_WIN_TRACE(ReadFile,3,(HANDLE h,LPVOID p,DWORD n,LPDWORD done,LPOVERLAPPED o),h,p,n,done,o)
INTRAFLOW_WIN_TRACE(LockFileEx,4,(HANDLE h,DWORD f,DWORD r,DWORD a,DWORD b,LPOVERLAPPED o),h,f,r,a,b,o)
INTRAFLOW_WIN_TRACE(UnlockFileEx,5,(HANDLE h,DWORD r,DWORD a,DWORD b,LPOVERLAPPED o),h,r,a,b,o)
INTRAFLOW_WIN_TRACE(LockFile,6,(HANDLE h,DWORD a,DWORD b,DWORD c,DWORD d),h,a,b,c,d)
INTRAFLOW_WIN_TRACE(UnlockFile,7,(HANDLE h,DWORD a,DWORD b,DWORD c,DWORD d),h,a,b,c,d)
INTRAFLOW_WIN_TRACE(SetEndOfFile,8,(HANDLE h),h)
#undef INTRAFLOW_WIN_TRACE
static decltype(&::Sleep) realSleep=nullptr;
static void WINAPI traceSleep(DWORD ms) noexcept {
    auto* t=currentWinTrace;
    if(!t){realSleep(ms);return;}
    const DWORD before=GetLastError();
    const auto start=DiagClock::now();
    const auto old=t->active.enter(9);
    SetLastError(before);realSleep(ms);
    const DWORD after=GetLastError();
    t->active.restore(old);t->calls[9].add(elapsedUs(start));SetLastError(after);
}
static void installWinTrace(){
    // Called only at startup of a diagnostic traffic peer, before its
    // receiver starts. Never change a live production process's VFS.
    static std::once_flag once;
    std::call_once(once,[]{
        auto* v=sqlite3_vfs_find(nullptr);
        if(!v||v->iVersion<3||!v->xGetSystemCall||!v->xSetSystemCall||
                std::string(v->zName).find("win32")!=0)
            throw std::runtime_error("Windows VFS syscall tracing unavailable");
#define INTRAFLOW_INSTALL(Name,Required) \
        real##Name=reinterpret_cast<decltype(real##Name)>(v->xGetSystemCall(v,#Name)); \
        if(real##Name){ \
            if(v->xSetSystemCall(v,#Name,reinterpret_cast<sqlite3_syscall_ptr>(&trace##Name))!=SQLITE_OK) \
                throw std::runtime_error("cannot trace " #Name); \
        }else if(Required)throw std::runtime_error("missing syscall " #Name);
        INTRAFLOW_INSTALL(FlushFileBuffers,true)
        INTRAFLOW_INSTALL(WriteFile,true)
        INTRAFLOW_INSTALL(ReadFile,true)
        INTRAFLOW_INSTALL(LockFileEx,true)
        INTRAFLOW_INSTALL(UnlockFileEx,true)
        INTRAFLOW_INSTALL(LockFile,false)
        INTRAFLOW_INSTALL(UnlockFile,false)
        INTRAFLOW_INSTALL(SetEndOfFile,false)
        INTRAFLOW_INSTALL(Sleep,false)
#undef INTRAFLOW_INSTALL
    });
}
#endif
struct Diagnostics {
    int timeout=0,threshold=0,requested=0;
    bool short_retry=false;
    std::uint32_t rng=1;
    DiagClock::time_point retry_start;
    std::int64_t busy_calls=0,busy_episodes=0,checkpoint_busy=0,checkpoint_errors=0,wal_commits=0;
    Timing busy_sleep,checkpoint,insert,poll_wait,read_batch,json_parse,callback,writer_wait,writer_hold;
    WriterActivity activity;
    ActivityDetail phase;
    std::atomic<std::uint64_t> current_busy_calls{0},current_busy_us{0};
#ifdef _WIN32
    WinIoTrace win_io;
    bool trace_win_io=false;
#endif
    Json live() const {
        auto j=activity.json();
        static const char* const phases[]={"none","busy_sleep","passive_checkpoint"};
        j["phase"]=phase.json(phases);
        j["busy_calls"]=current_busy_calls.load();
        j["busy_sleep_ms"]=current_busy_us.load()/1000.0;
#ifdef _WIN32
        if(trace_win_io)j["win_io"]=win_io.active.json(WinIoTrace::names());
#endif
        return j;
    }
    std::uint64_t raw_rows=0,raw_bytes=0,filtered_polls=0;
    struct PublishTrace {
        Diagnostics& d;
        bool acquired=false;
        DiagClock::time_point held;
        explicit PublishTrace(Diagnostics& diag):d(diag){d.activity.set(1);}
        void acquire(){held=DiagClock::now();acquired=true;d.activity.set(2);}
        ~PublishTrace(){if(acquired)d.writer_hold.add(elapsedUs(held));d.activity.set(0);}
    };
    // Separate receiver-owned counters: never read by publishRaw.
    Timing maintenance;
    std::int64_t maintenance_busy=0,maintenance_errors=0,maintenance_partial=0,maintenance_valid=0;
    int max_log_frames=0,max_backfilled_frames=0,max_pending_frames=0,last_log_frames=-1,last_backfilled_frames=-1;
    Json config,slowest_insert;
    static int busy(void* p,int prior) noexcept {
        auto& d=*static_cast<Diagnostics*>(p);
        ++d.busy_calls;++d.current_busy_calls;
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
        {
            ActivityScope scope(d.phase,1);
            sqlite3_sleep(ms);
        }
        const auto slept=elapsedUs(begin);
        d.busy_sleep.add(slept);d.current_busy_us.fetch_add(static_cast<std::uint64_t>(slept));
        return !d.short_retry || elapsedUs(d.retry_start)<static_cast<std::int64_t>(d.timeout)*1000;
    }
    // Diagnostic-only replacement for native autocheckpoint.
    static int wal(void* p,sqlite3* db,const char* name,int frames) noexcept {
        auto& d=*static_cast<Diagnostics*>(p);
        ++d.wal_commits;
        if(d.threshold>0&&frames>=d.threshold) {
            const auto begin=DiagClock::now();
            int log=0,done=0;
            ActivityScope scope(d.phase,2);
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
        Json result={{"config",config},{"busy_calls",busy_calls},{"busy_episodes",busy_episodes},
            {"busy_sleep",busy_sleep.json()},{"checkpoint",checkpoint.json()},
            {"checkpoint_busy",checkpoint_busy},{"checkpoint_errors",checkpoint_errors},
            {"wal_commits",wal_commits},{"insert_step",insert.json()},
            {"poll_wait",poll_wait.json()},{"read_batch",read_batch.json()},
            {"json_parse",json_parse.json()},{"callback",callback.json()},
            {"slowest_insert",slowest_insert},{"writer_wait",writer_wait.json()},{"writer_hold",writer_hold.json()},
            {"raw_rows",raw_rows},{"raw_bytes",raw_bytes},{"filtered_polls",filtered_polls},{"maintenance",{
                {"timing",maintenance.json()},{"busy",maintenance_busy},{"errors",maintenance_errors},
                {"partial",maintenance_partial},{"valid",maintenance_valid},
                {"max_log_frames",max_log_frames},{"max_backfilled_frames",max_backfilled_frames},
                {"max_pending_frames",max_pending_frames},{"last_log_frames",last_log_frames},
                {"last_backfilled_frames",last_backfilled_frames}}}};
#ifdef _WIN32
        if(trace_win_io)result["win_io"]=win_io.json();
#endif
        return result;
    }
};
#endif
std::int64_t high(Db& db) {
    Stmt s(db,"SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name='messages'),0)");
    s.row(); return s.num(0);
}
// Shared DB policy; do not allow conflicting per-session retention settings.
void retention(Db& db,const Options& o) {
    db.exec("CREATE TABLE IF NOT EXISTS intraflow_retention(id INTEGER PRIMARY KEY CHECK(id=1),retention_sec INTEGER NOT NULL,max_messages INTEGER NOT NULL,cleanup_interval_ms INTEGER NOT NULL,last_cleanup_us INTEGER NOT NULL)");
    {
        Stmt s(db,"SELECT retention_sec,max_messages,cleanup_interval_ms FROM intraflow_retention WHERE id=1");
        if(!s.row()){
            s.reset();
            Stmt add(db,"INSERT OR IGNORE INTO intraflow_retention VALUES(1,?,?,?,0)");
            add.bind(1,static_cast<std::int64_t>(o.retention_sec));
            add.bind(2,static_cast<std::int64_t>(o.max_messages));
            add.bind(3,static_cast<std::int64_t>(o.cleanup_interval_ms));
            add.row();
        }
    }
    {
        Stmt s(db,"SELECT retention_sec,max_messages,cleanup_interval_ms FROM intraflow_retention WHERE id=1");
        if(!s.row()||s.num(0)!=o.retention_sec||s.num(1)!=o.max_messages||s.num(2)!=o.cleanup_interval_ms)
            throw std::runtime_error("retention policy mismatch for shared database");
    }
    if(!o.retention_sec&&!o.max_messages)return;
    // One global cleanup cadence, part of the committing INSERT. At most
    // 256 oldest rows per invocation; every 128 inserts or elapsed interval.
    // Delete a prefix even if timestamps are out of sequence, so a receiver
    // can detect missing global sequences. Never delete the newest row.
    const std::string countCut=o.max_messages?"NEW.seq-"+std::to_string(o.max_messages):"0";
    const std::string ageCut=o.retention_sec?
        "(SELECT COALESCE(MIN(CASE WHEN timestamp>NEW.timestamp-"+std::to_string(static_cast<std::uint64_t>(o.retention_sec)*1000000)+
        " THEN seq END)-1,MAX(seq),0) FROM (SELECT seq,timestamp FROM messages ORDER BY seq LIMIT 256))":"0";
    const auto sql=std::string("CREATE TRIGGER IF NOT EXISTS intraflow_prune AFTER INSERT ON messages WHEN NEW.seq%128=0 OR NEW.timestamp >= (SELECT last_cleanup_us+")+
        std::to_string(static_cast<std::uint64_t>(o.cleanup_interval_ms)*1000)+" FROM intraflow_retention WHERE id=1) BEGIN "
        "DELETE FROM messages WHERE seq IN (SELECT seq FROM messages WHERE seq<NEW.seq AND seq<=MAX("+countCut+","+ageCut+") ORDER BY seq LIMIT 256); "
        "UPDATE intraflow_retention SET last_cleanup_us=NEW.timestamp WHERE id=1; END";
    db.exec(sql.c_str());
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
    std::unique_ptr<detail::ProcessWriterLock> process_writer;
#ifdef INTRAFLOW_DIAGNOSTICS
    Diagnostics diag;
    std::unique_ptr<Db> maintenance_db;
#endif
    TopicCache topics;
    std::unique_ptr<Stmt> insert, poll, filtered_poll;
    std::vector<std::string> poll_topics;
    std::mutex write_mu, listeners_mu, wait_mu;
    std::condition_variable cv;
    std::vector<std::shared_ptr<Listener>> listeners;
    std::atomic<bool> running{true};
    std::atomic<std::uint64_t> skipped{0};
    std::thread loop;
    std::int64_t cursor;
    SubscriptionId next = 1;
    Impl(const std::string& n,const Options& o):name(n),options(o),writer(o.database,o.busy_ms),reader(o.database,o.busy_ms),cursor(0) {
        if(n.empty() || !o.poll_ms || o.database.empty() ||
           ((o.retention_sec||o.max_messages)&&!o.cleanup_interval_ms))
            throw std::invalid_argument("invalid options");
        if(o.serialize_writers){
            if(o.busy_ms==0xffffffffu)throw std::invalid_argument("invalid writer timeout");
            process_writer.reset(new detail::ProcessWriterLock(sqlite3_db_filename(writer.p,"main")));
        }
        detail::ProcessWriterGuard process(process_writer.get(),o.busy_ms);
        { Stmt mode(writer,"PRAGMA journal_mode=WAL");
          if(!mode.row()||mode.str(0)!="wal")throw std::runtime_error("WAL mode unavailable"); }
        writer.exec(o.full_sync?"PRAGMA synchronous=FULL":"PRAGMA synchronous=NORMAL");
        reader.exec("PRAGMA query_only=ON");
        writer.exec("CREATE TABLE IF NOT EXISTS topics(name TEXT PRIMARY KEY,type TEXT NOT NULL,hash TEXT NOT NULL,schema TEXT NOT NULL)");
        writer.exec("CREATE TABLE IF NOT EXISTS messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,topic TEXT NOT NULL,sender TEXT NOT NULL,timestamp INTEGER NOT NULL,payload TEXT NOT NULL)");
        writer.exec("CREATE INDEX IF NOT EXISTS messages_topic_seq ON messages(topic,seq)");
        retention(writer,o);
        writer.exec("CREATE TABLE IF NOT EXISTS intraflow_writer_policy(id INTEGER PRIMARY KEY CHECK(id=1),serialized INTEGER NOT NULL)");
        {
            Stmt policy(writer,"SELECT serialized FROM intraflow_writer_policy WHERE id=1");
            if(!policy.row()){
                policy.reset();
                Stmt add(writer,"INSERT OR IGNORE INTO intraflow_writer_policy VALUES(1,?)");
                add.bind(1,static_cast<std::int64_t>(o.serialize_writers));add.row();
            }
        }
        {
            Stmt policy(writer,"SELECT serialized FROM intraflow_writer_policy WHERE id=1");
            if(!policy.row()||policy.num(0)!=static_cast<int>(o.serialize_writers))
                throw std::runtime_error("writer policy mismatch for shared database");
        }
        insert.reset(new Stmt(writer,"INSERT INTO messages(topic,sender,timestamp,payload) VALUES(?,?,?,?)"));
        poll.reset(new Stmt(reader,"SELECT m.seq,m.timestamp,m.topic,m.sender,t.type,t.hash,m.payload FROM messages m JOIN topics t ON t.name=m.topic WHERE m.seq>? ORDER BY m.seq LIMIT 256"));
        cursor=high(reader);
#ifdef INTRAFLOW_DIAGNOSTICS
        if(o.diagnostic_checkpoint>=0)
            check(sqlite3_wal_autocheckpoint(writer.p,o.diagnostic_checkpoint),writer.p);
        if(o.diagnostic_win_io){
#ifdef _WIN32
            installWinTrace();diag.trace_win_io=true;
#else
            throw std::invalid_argument("Windows syscall tracing requires Windows");
#endif
        }
        diag.config={{"sqlite_version",sqlite3_libversion()},{"sqlite_sourceid",sqlite3_sourceid()},
                     {"checkpoint_trace",o.diagnostic_hooks||o.diagnostic_checkpoint_trace},
                     {"win_io_trace",o.diagnostic_win_io},{"writer",Diagnostics::pragmas(writer)},
                     {"reader",Diagnostics::pragmas(reader)},{"custom_hooks",o.diagnostic_hooks},
                     {"short_retry",o.diagnostic_short_retry},{"serialize_writers",o.serialize_writers},{"filter_topics",o.filter_topics}};
        diag.threshold=std::stoi(diag.config["writer"]["wal_autocheckpoint"].get<std::string>());
        diag.timeout=static_cast<int>(o.busy_ms);
        diag.short_retry=o.diagnostic_short_retry;
        diag.rng=o.diagnostic_retry_seed?o.diagnostic_retry_seed:1;
        if(o.diagnostic_hooks||o.diagnostic_short_retry)
            check(sqlite3_busy_handler(writer.p,Diagnostics::busy,&diag),writer.p);
        if(o.diagnostic_hooks||o.diagnostic_checkpoint_trace)
            sqlite3_wal_hook(writer.p,Diagnostics::wal,&diag);
        if(o.diagnostic_maintenance_ms){
            if(o.diagnostic_checkpoint!=0||o.diagnostic_hooks||o.diagnostic_short_retry||o.diagnostic_checkpoint_trace||o.diagnostic_win_io||o.serialize_writers)
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
                auto read=[&](Stmt& s,const std::vector<std::string>& topics){
                    ResetStmt reset{s};
                    s.bind(1,cursor);
                    for(std::size_t i=0;i<topics.size();++i)s.bind(static_cast<int>(i+2),topics[i]);
                    while(s.row()){
                        Message m;m.sequence=s.num(0);m.timestamp=s.num(1);m.topic=s.str(2);m.sender=s.str(3);m.type=s.str(4);m.hash=s.str(5);
                        auto raw=s.str(6);raw_bytes+=raw.size();
                        batch.push_back(Raw{std::move(m),std::move(raw)});
                        if(raw_bytes>=4u*1024u*1024u){full=true;break;}
                    }
                };
                std::int64_t snapshot_high=cursor;
                if(options.filter_topics){
                    // Serialize the short snapshot with subscription registration,
                    // not with callbacks or writers. A new subscription reads its
                    // boundary after this snapshot, so no matching row is skipped.
                    std::lock_guard<std::mutex> lock(listeners_mu);
                    std::vector<std::string> wanted;
                    bool all=false;
                    for(const auto& l:listeners){
                        if(l->topic.empty()){all=true;break;}
                        wanted.push_back(l->topic);
                    }
                    std::sort(wanted.begin(),wanted.end());
                    wanted.erase(std::unique(wanted.begin(),wanted.end()),wanted.end());
                    if(wanted.size()>64)all=true; // bounded SQL variable count
                    reader.exec("BEGIN");
                    try{
                        snapshot_high=high(reader);
                        std::int64_t oldest=0;
                        {Stmt lo(reader,"SELECT COALESCE(MIN(seq),0) FROM messages");lo.row();oldest=lo.num(0);}
                        if(all)read(*poll,{});
                        else if(!wanted.empty()){
                            if(!filtered_poll||poll_topics!=wanted){
                                std::string sql="SELECT m.seq,m.timestamp,m.topic,m.sender,t.type,t.hash,m.payload FROM messages m JOIN topics t ON t.name=m.topic WHERE m.seq>? AND m.topic IN (";
                                for(std::size_t i=0;i<wanted.size();++i)sql+=i?",?":"?";
                                sql+=") ORDER BY m.seq LIMIT 256";
                                filtered_poll.reset(new Stmt(reader,sql.c_str()));
                                poll_topics=wanted;
                            }
                            read(*filtered_poll,wanted);
                        }
                        reader.exec("COMMIT");
                        // Retention deletes only a prefix. Filtered-out sequences
                        // are NOT losses; detect the pruned prefix in this snapshot.
                        const auto boundary=oldest?oldest-1:snapshot_high;
                        if(boundary>cursor){skipped.fetch_add(static_cast<std::uint64_t>(boundary-cursor));cursor=boundary;}
                    }catch(...){try{reader.exec("ROLLBACK");}catch(...){}throw;}
#ifdef INTRAFLOW_DIAGNOSTICS
                    if(!all)++diag.filtered_polls;
#endif
                }else read(*poll,{});
#ifdef INTRAFLOW_DIAGNOSTICS
                diag.raw_rows+=batch.size();diag.raw_bytes+=raw_bytes;
#endif
#ifdef INTRAFLOW_DIAGNOSTICS
                diag.read_batch.add(elapsedUs(readBegin));
#endif
                full=full || batch.size()==256;
                for(auto& entry:batch) {
                    if(!running) break;
                    auto& m=entry.message;
                    if(!options.filter_topics&&m.sequence>cursor+1)skipped.fetch_add(static_cast<std::uint64_t>(m.sequence-cursor-1));
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
                if(options.filter_topics&&!full&&running)cursor=std::max(cursor,snapshot_high);
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
        std::lock_guard<std::mutex> write(write_mu);
        detail::ProcessWriterGuard process(process_writer.get(),options.busy_ms);
        if(!t.empty()) topic(writer,topics,t,name,hash,schema);
        // Do not block the receive loop while waiting for the writer lock.
        std::lock_guard<std::mutex> lock(listeners_mu);
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
#ifdef INTRAFLOW_DIAGNOSTICS
    const auto lockBegin=DiagClock::now();
    Diagnostics::PublishTrace trace(p.diag);
#endif
    detail::ProcessWriterGuard process(p.process_writer.get(),p.options.busy_ms);
#ifdef INTRAFLOW_DIAGNOSTICS
    p.diag.writer_wait.add(elapsedUs(lockBegin));trace.acquire();
#endif
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
    d.current_busy_calls=0;d.current_busy_us=0;
    d.activity.set(3);
#ifdef _WIN32
    {
        WinTraceScope io(d.trace_win_io?&d.win_io:nullptr);
        s.row();
    }
#else
    s.row();
#endif
    d.activity.set(4);
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
Json Session::writerActivity() const {
    return impl_?impl_->diag.live():Json{{"stage","idle"},{"elapsed_ms",0}};
}
Json Session::diagnostics() const {
    if(!impl_||impl_->running)throw std::logic_error("diagnostics requires closed session");
    return impl_->diag.json();
}
#endif
std::uint64_t Session::skippedSequences() const noexcept {
    return impl_?impl_->skipped.load():0;
}
void Session::close() {
    if(!impl_) return;
    if(impl_->loop.get_id()==std::this_thread::get_id()) throw std::logic_error("close from listener not allowed");
    impl_->stop();
}
}
