// CompanyWebView v8: WebView2 Native Adapter, source-only preview pending Windows product compile.
// Uses ONLY browser-native event metadata for sender origin, never untrusted JSON metadata.
#define WIN32_LEAN_AND_MEAN
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include "CwvWebView2Native.h"
#include "../SecureRegistry/CwvSecureViewRegistry.h"
#include <objbase.h>
#include <wrl.h>
#include <WebView2.h>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <deque>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <utility>
using Microsoft::WRL::ComPtr;
using Microsoft::WRL::Callback;
using companywebview::SecureViewRegistry;
using companywebview::RegistryMessage;
using companywebview::RegistryResult;
using companywebview::FrameKind;
namespace {
std::string Utf8(const std::wstring& wide) {
    if (wide.empty()) return {};
    const int n=WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,wide.data(),static_cast<int>(wide.size()),nullptr,0,nullptr,nullptr);
    if (n<=0) return {};
    std::string value(static_cast<size_t>(n),'\0');
    if(!WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,wide.data(),static_cast<int>(wide.size()),&value[0],n,nullptr,nullptr))return {};
    return value;
}
std::wstring StringAndFree(LPWSTR raw) {
    std::wstring v=raw?raw:L"";
    if(raw)CoTaskMemFree(raw);
    return v;
}
struct View {
    const uint64_t id;
    HWND parent;
    RECT bounds;
    const std::wstring url;
    ComPtr<ICoreWebView2Controller> controller;
    ComPtr<ICoreWebView2> browser;
    EventRegistrationToken navStart{}, navComplete{}, msg{}, newWindow{};
    bool attached=false;
    std::atomic<bool> closing{false};
    std::atomic<int> state{0};
    std::atomic<int> error{0};
    explicit View(uint64_t n,HWND p,RECT r,std::wstring u):id(n),parent(p),bounds(r),url(std::move(u)){}
};
class Engine {
    SecureViewRegistry registry_;
    std::mutex mutex_;
    std::deque<std::function<void()>> tasks_;
    std::map<uint64_t,std::shared_ptr<View>> views_;
    std::map<uint64_t,std::shared_ptr<View>> allViews_; // read-only lookup under mutex_
    HANDLE wake_{};
    std::thread thread_;
    std::atomic<bool> stopping_{false};
    std::atomic<bool> workerOk_{false};
    void Worker() {
        HRESULT hr=CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED);
        if(FAILED(hr))return;
        workerOk_=true;
        while(!stopping_) {
            std::deque<std::function<void()>> current;
            {
                std::lock_guard<std::mutex> lock(mutex_);
                current.swap(tasks_);
            }
            for(auto& work:current)work();
            MSG msg{};
            while(PeekMessageW(&msg,nullptr,0,0,PM_REMOVE)) {
                if(msg.message==WM_QUIT){stopping_=true;break;}
                TranslateMessage(&msg);DispatchMessageW(&msg);
            }
            if(stopping_)break;
            MsgWaitForMultipleObjectsEx(1,&wake_,100,QS_ALLINPUT,MWMO_INPUTAVAILABLE);
        }
        // CEF-equivalent principle: release COM controller on its owning STA.
        for(auto& kv:views_) CloseOnWorker(kv.second);
        views_.clear();
        CoUninitialize();
    }
    void Fail(const std::shared_ptr<View>& view,HRESULT hr) {
        view->error=static_cast<int>(hr);
        view->state=-1;
    }
    void CloseOnWorker(const std::shared_ptr<View>& view) {
        view->closing=true;
        if(view->browser && view->attached){
            view->browser->remove_NavigationStarting(view->navStart);
            view->browser->remove_NavigationCompleted(view->navComplete);
            view->browser->remove_WebMessageReceived(view->msg);
            view->browser->remove_NewWindowRequested(view->newWindow);
        }
        view->attached=false;
        view->browser.Reset();
        if(view->controller){view->controller->Close();view->controller.Reset();}
        view->state=-2; // controller has actually been released on STA
    }
    void Attach(const std::shared_ptr<View>& view) {
        if(view->closing)return;
        std::weak_ptr<View> weak(view);
        const HRESULT n=view->browser->add_NavigationStarting(Callback<ICoreWebView2NavigationStartingEventHandler>(
            [this,weak](ICoreWebView2*,ICoreWebView2NavigationStartingEventArgs* args)->HRESULT{
                auto v=weak.lock();if(!v||v->closing)return S_OK;
                LPWSTR raw=nullptr;
                if(FAILED(args->get_Uri(&raw))) {args->put_Cancel(TRUE);return S_OK;}
                const auto url=StringAndFree(raw);
                if(url!=v->url){args->put_Cancel(TRUE);return S_OK;}
                registry_.NavigationStarted(v->id);
                return S_OK;
            }).Get(),&view->navStart);
        if(FAILED(n)){Fail(view,n);return;}
        const HRESULT done=view->browser->add_NavigationCompleted(Callback<ICoreWebView2NavigationCompletedEventHandler>(
            [this,weak](ICoreWebView2* browser,ICoreWebView2NavigationCompletedEventArgs* args)->HRESULT{
                auto v=weak.lock();if(!v||v->closing)return S_OK;
                BOOL success=FALSE;
                if(FAILED(args->get_IsSuccess(&success))||!success) return S_OK;
                LPWSTR raw=nullptr;
                if(FAILED(browser->get_Source(&raw)))return S_OK;
                const auto src=StringAndFree(raw);
                registry_.NavigationCommitted(v->id,Utf8(src),FrameKind::Main);
                return S_OK;
            }).Get(),&view->navComplete);
        if(FAILED(done)){view->browser->remove_NavigationStarting(view->navStart);Fail(view,done);return;}
        const HRESULT message=view->browser->add_WebMessageReceived(Callback<ICoreWebView2WebMessageReceivedEventHandler>(
            [this,weak](ICoreWebView2*,ICoreWebView2WebMessageReceivedEventArgs* args)->HRESULT{
                auto v=weak.lock();if(!v||v->closing)return S_OK;
                LPWSTR srcRaw=nullptr;
                if(FAILED(args->get_Source(&srcRaw)))return S_OK;
                const auto source=Utf8(StringAndFree(srcRaw));
                LPWSTR valueRaw=nullptr;
                if(FAILED(args->TryGetWebMessageAsString(&valueRaw)))return S_OK;
                const auto data=Utf8(StringAndFree(valueRaw));
                // We subscribe only to TOP-LEVEL WebMessageReceived, not any Frame2
                // WebMessageReceived event. No child-frame host bridge is installed.
                registry_.Admit(v->id,source,FrameKind::Main,registry_.Generation(v->id),data);
                return S_OK;
            }).Get(),&view->msg);
        if(FAILED(message)){
            view->browser->remove_NavigationStarting(view->navStart);
            view->browser->remove_NavigationCompleted(view->navComplete);Fail(view,message);return;
        }
        const HRESULT popup=view->browser->add_NewWindowRequested(Callback<ICoreWebView2NewWindowRequestedEventHandler>(
            [](ICoreWebView2*,ICoreWebView2NewWindowRequestedEventArgs* args)->HRESULT{
                args->put_Handled(TRUE);return S_OK;
            }).Get(),&view->newWindow);
        if(FAILED(popup)){
            view->browser->remove_NavigationStarting(view->navStart);
            view->browser->remove_NavigationCompleted(view->navComplete);
            view->browser->remove_WebMessageReceived(view->msg);Fail(view,popup);return;
        }
        view->attached=true;
        ComPtr<ICoreWebView2Settings> settings;
        if(SUCCEEDED(view->browser->get_Settings(&settings))){
            settings->put_AreHostObjectsAllowed(FALSE);
            settings->put_IsWebMessageEnabled(TRUE);
        }
        view->state=2;
        HRESULT hr=view->browser->Navigate(view->url.c_str());
        if(FAILED(hr))Fail(view,hr);
    }
    void CreateOnWorker(const std::shared_ptr<View>& view){
        views_[view->id]=view;
        std::weak_ptr<View> weak(view);
        HRESULT hr=CreateCoreWebView2EnvironmentWithOptions(nullptr,nullptr,nullptr,
            Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
                [this,weak](HRESULT result,ICoreWebView2Environment* environment)->HRESULT{
                    auto v=weak.lock();if(!v||v->closing)return S_OK;
                    if(FAILED(result)||!environment){Fail(v,result);return S_OK;}
                    HRESULT init=environment->CreateCoreWebView2Controller(v->parent,
                        Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                            [this,weak](HRESULT ok,ICoreWebView2Controller* controller)->HRESULT{
                                auto w=weak.lock();if(!w||w->closing)return S_OK;
                                if(FAILED(ok)||!controller){Fail(w,ok);return S_OK;}
                                w->controller=controller;
                                w->controller->put_Bounds(w->bounds);
                                HRESULT got=w->controller->get_CoreWebView2(&w->browser);
                                if(FAILED(got)||!w->browser){Fail(w,got);return S_OK;}
                                Attach(w);return S_OK;
                            }).Get());
                    if(FAILED(init))Fail(v,init);
                    return S_OK;
                }).Get());
        if(FAILED(hr))Fail(view,hr);
    }
public:
    Engine():registry_(256,65536),wake_(CreateEventW(nullptr,FALSE,FALSE,nullptr)){
        if(wake_) {
            thread_=std::thread([this]{Worker();});
            for(int i=0;i<500 && !workerOk_ && !stopping_;++i)
                std::this_thread::sleep_for(std::chrono::milliseconds(2));
        }
    }
    // Explicit Player-quit shutdown. NEVER join a COM thread from DllMain/loader lock.
    void Stop(){
        stopping_=true;if(wake_)SetEvent(wake_);
        if(thread_.joinable())thread_.join();
        if(wake_){CloseHandle(wake_);wake_=nullptr;}
    }
    ~Engine()=delete; // process-lifetime singleton is intentionally leaked

    bool Post(std::function<void()> task){
        if(!wake_||stopping_)return false;
        {std::lock_guard<std::mutex> lock(mutex_);tasks_.push_back(std::move(task));}
        SetEvent(wake_);return true;
    }
    int Open(HWND parent,RECT bounds,const std::wstring& url,uint64_t* out) {
        if(!out||!IsWindow(parent)||bounds.right<=bounds.left||bounds.bottom<=bounds.top||!workerOk_)return -1;
        const uint64_t id=registry_.Create(Utf8(url));
        if(!id)return -2;
        auto view=std::make_shared<View>(id,parent,bounds,url);
        {std::lock_guard<std::mutex> lock(mutex_);allViews_[id]=view;}
        if(!Post([this,view]{CreateOnWorker(view);})){registry_.Close(id);return -3;}
        *out=id;return 0;
    }
    std::shared_ptr<View> Lookup(uint64_t id){
        std::lock_guard<std::mutex> lock(mutex_);
        auto it=allViews_.find(id);return it==allViews_.end()?nullptr:it->second;
    }
    int State(uint64_t id){auto v=Lookup(id);return v?v->state.load():-2;}
    int LastError(uint64_t id){auto v=Lookup(id);return v?v->error.load():-1;}
    int Bounds(uint64_t id,RECT b){auto v=Lookup(id);if(!v||v->closing||v->state!=2)return -1;
        return Post([v,b]{if(!v->closing&&v->controller){v->bounds=b;v->controller->put_Bounds(b);}})?0:-2;}
    int Script(uint64_t id,std::wstring value){auto v=Lookup(id);if(!v||v->state!=2)return -1;
        return Post([v,value=std::move(value)]{if(!v->closing&&v->browser)v->browser->ExecuteScript(value.c_str(),nullptr);})?0:-2;}
    int PostString(uint64_t id,std::wstring value){auto v=Lookup(id);if(!v||v->state!=2)return -1;
        return Post([v,value=std::move(value)]{if(!v->closing&&v->browser)v->browser->PostWebMessageAsString(value.c_str());})?0:-2;}
    int Read(uint64_t id,char* output,int cap){
        if(!output||cap<65537)return -1;
        RegistryMessage msg;
        const auto rc=registry_.Pop(id,msg);
        if(rc==RegistryResult::QueueEmpty||rc==RegistryResult::NavigationSuspended)return 0;
        if(rc!=RegistryResult::Ok)return -2;
        if(msg.payload.size()>=static_cast<size_t>(cap))return -3;
        memcpy(output,msg.payload.data(),msg.payload.size());
        output[msg.payload.size()]='\0';return static_cast<int>(msg.payload.size());
    }
    int Close(uint64_t id){auto view=Lookup(id);if(!view)return -1;
        registry_.Close(id);
        view->closing=true;
        // State flips to -2 only after the STA has actually closed its controller.
        if(!Post([this,view]{
            CloseOnWorker(view);
            views_.erase(view->id);
            std::lock_guard<std::mutex> lock(mutex_);
            allViews_.erase(view->id);
        }))return -2;
        return 0;
    }
};
Engine& Instance(){static Engine* engine=new Engine();return *engine;}
} // namespace
CWV_EXPORT int CWV_WV2V8_Open(void* parent,int x,int y,int w,int h,const wchar_t* url,uint64_t* out){
    if(!url||!out||w<=0||h<=0)return -1;
    return Instance().Open(reinterpret_cast<HWND>(parent),RECT{x,y,x+w,y+h},url,out);
}
CWV_EXPORT int CWV_WV2V8_State(uint64_t handle){return Instance().State(handle);}
CWV_EXPORT int CWV_WV2V8_SetBounds(uint64_t handle,int x,int y,int w,int h){
    if(w<=0||h<=0)return -1;
    return Instance().Bounds(handle,RECT{x,y,x+w,y+h});
}
CWV_EXPORT int CWV_WV2V8_ExecuteScript(uint64_t handle,const wchar_t* script){
    if(!script)return -1;
    return Instance().Script(handle,script);
}
CWV_EXPORT int CWV_WV2V8_PostString(uint64_t handle,const wchar_t* msg){
    if(!msg)return -1;
    return Instance().PostString(handle,msg);
}
CWV_EXPORT int CWV_WV2V8_ReadMessage(uint64_t handle,char* output,int capacity){
    return Instance().Read(handle,output,capacity);
}
CWV_EXPORT int CWV_WV2V8_Close(uint64_t handle){return Instance().Close(handle);}
CWV_EXPORT int CWV_WV2V8_LastError(uint64_t handle){return Instance().LastError(handle);}
CWV_EXPORT int CWV_WV2V8_Shutdown(){Instance().Stop();return 0;}
