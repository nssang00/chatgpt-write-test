#pragma once
#include <chrono>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <thread>
#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#else
#include <sys/file.h>
#include <fcntl.h>
#include <unistd.h>
#include <cerrno>
#include <cstdlib>
#include <memory>
#endif

namespace intraflow { namespace detail {
// Trusted local files only. No network FS or DB replacement while open.
class ProcessWriterLock {
#ifdef _WIN32
    HANDLE handle_=nullptr;
#else
    int fd_=-1;
#endif
    static void fail(const char* message,unsigned long code) {
        throw std::runtime_error(std::string(message)+": "+std::to_string(code));
    }
public:
    explicit ProcessWriterLock(const std::string& db) {
#ifdef _WIN32
        // SQLite's UTF-8 filename; use filesystem identity, not path case
        // or relative-path spelling, for the kernel mutex name.
        const int n=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,db.c_str(),-1,nullptr,0);
        if(!n)fail("writer lock path",GetLastError());
        std::wstring path(static_cast<std::size_t>(n),L'\0');
        if(!MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,db.c_str(),-1,&path[0],n))
            fail("writer lock path",GetLastError());
        HANDLE file=CreateFileW(path.c_str(),FILE_READ_ATTRIBUTES,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,
                                nullptr,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,nullptr);
        if(file==INVALID_HANDLE_VALUE)fail("writer lock file identity",GetLastError());
        BY_HANDLE_FILE_INFORMATION info{};
        const BOOL ok=GetFileInformationByHandle(file,&info);
        const DWORD error=ok?0:GetLastError();CloseHandle(file);
        if(!ok)fail("writer lock file identity",error);
        const auto name=std::wstring(L"Global\\IntraFlow.Writer.v1.")+std::to_wstring(info.dwVolumeSerialNumber)+L"."+
            std::to_wstring(info.nFileIndexHigh)+L"."+std::to_wstring(info.nFileIndexLow);
        handle_=CreateMutexW(nullptr,FALSE,name.c_str());
        if(!handle_)fail("CreateMutexW",GetLastError());
#else
        std::unique_ptr<char,decltype(&std::free)> canonical(realpath(db.c_str(),nullptr),&std::free);
        if(!canonical)fail("writer lock realpath",errno);
        const std::string sidecar=std::string(canonical.get())+".writer.lock";
        fd_=open(sidecar.c_str(),O_RDWR|O_CREAT|O_CLOEXEC|O_NOFOLLOW,0600);
        if(fd_<0)fail("writer lock open",errno);
#endif
    }
    ~ProcessWriterLock(){
#ifdef _WIN32
        CloseHandle(handle_);
#else
        close(fd_);
#endif
    }
    ProcessWriterLock(const ProcessWriterLock&)=delete;
    ProcessWriterLock& operator=(const ProcessWriterLock&)=delete;
    void lock(unsigned timeout_ms){
#ifdef _WIN32
        const DWORD rc=WaitForSingleObject(handle_,static_cast<DWORD>(timeout_ms));
        // Ownership is acquired on WAIT_ABANDONED too. SQLite performs
        // its own transaction recovery before subsequent operations.
        if(rc==WAIT_OBJECT_0||rc==WAIT_ABANDONED)return;
        if(rc==WAIT_TIMEOUT)throw std::runtime_error("process writer lock timeout");
        fail("WaitForSingleObject",GetLastError());
#else
        const auto deadline=std::chrono::steady_clock::now()+std::chrono::milliseconds(timeout_ms);
        for(;;){
            if(flock(fd_,LOCK_EX|LOCK_NB)==0)return;
            const int err=errno;
            if(err!=EWOULDBLOCK&&err!=EAGAIN&&err!=EINTR)fail("flock",err);
            if(std::chrono::steady_clock::now()>=deadline)
                throw std::runtime_error("process writer lock timeout");
            std::this_thread::sleep_for(std::chrono::milliseconds(1));
        }
#endif
    }
    void unlock() noexcept {
#ifdef _WIN32
        if(!ReleaseMutex(handle_))std::terminate();
#else
        while(flock(fd_,LOCK_UN)!=0){if(errno!=EINTR)std::terminate();}
#endif
    }
};
class ProcessWriterGuard {
    ProcessWriterLock* lock_;
public:
    ProcessWriterGuard(ProcessWriterLock* l,unsigned timeout_ms):lock_(l){if(lock_)lock_->lock(timeout_ms);}
    ~ProcessWriterGuard(){if(lock_)lock_->unlock();}
    ProcessWriterGuard(const ProcessWriterGuard&)=delete;
    ProcessWriterGuard& operator=(const ProcessWriterGuard&)=delete;
};
}}
