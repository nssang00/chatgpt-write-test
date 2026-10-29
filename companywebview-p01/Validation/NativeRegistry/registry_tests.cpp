#include "../../NativeSource/SecureRegistry/CwvSecureViewRegistry.h"
#include <atomic>
#undef NDEBUG
#include <cassert>
#include <set>
#include <thread>
#include <vector>
#include <iostream>
using namespace companywebview;
int main() {
  SecureViewRegistry registry(256,65536);
  const std::string url="http://127.0.0.1:49152/0123456789abcdef0123456789abcdef0123456789abcdef/index.html";
  assert(registry.Create("https://invalid.example/")==0);
  assert(registry.Create("http://127.0.0.1:65536/0123456789abcdef0123456789abcdef0123456789abcdef/index.html")==0);
  for(int n:{2,4,8}){
    std::vector<std::uint64_t> ids;
    for(int i=0;i<n;i++) ids.push_back(registry.Create(url));
    assert(std::set<std::uint64_t>(ids.begin(),ids.end()).size()==ids.size());
    for(auto id:ids) {
      assert(registry.Admit(id,url,FrameKind::Main,1,"ok")==RegistryResult::Ok);
      assert(registry.Admit(id,url,FrameKind::Subframe,1,"bad")==RegistryResult::FrameNotAuthenticated);
      assert(registry.Admit(id,"https://invalid.example/",FrameKind::Main,1,"bad")==RegistryResult::SourceMismatch);
      RegistryMessage msg;
      assert(registry.Pop(id,msg)==RegistryResult::Ok && msg.handle==id && msg.payload=="ok");
      assert(registry.Close(id));
    }
  }
  auto id=registry.Create(url);
  assert(registry.Admit(id,url,FrameKind::Main,1,"old")==RegistryResult::Ok);
  assert(registry.NavigationStarted(id)==RegistryResult::Ok);
  assert(registry.Admit(id,url,FrameKind::Main,2,"bad")==RegistryResult::NavigationSuspended);
  assert(registry.NavigationCommitted(id,url,FrameKind::Main)==RegistryResult::Ok);
  assert(registry.Admit(id,url,FrameKind::Main,1,"replay")==RegistryResult::StaleGeneration);
  assert(registry.Admit(id,url,FrameKind::Main,2,"new")==RegistryResult::Ok);
  RegistryMessage msg;
  assert(registry.Pop(id,msg)==RegistryResult::Ok && msg.payload=="new");
  assert(registry.Close(id));
  std::atomic<int> bad{0};
  std::vector<std::thread> threads;
  for(int i=0;i<8;i++) {
    const auto v=registry.Create(url);
    threads.emplace_back([&,v]{
      for(int j=0;j<1000;j++){
        if(registry.Admit(v,url,FrameKind::Main,1,"x")!=RegistryResult::Ok){bad++;break;}
        RegistryMessage m;
        if(registry.Pop(v,m)!=RegistryResult::Ok || m.handle!=v)bad++;
      }
      if(!registry.Close(v))bad++;
    });
  }
  for(auto& t:threads)t.join();
  assert(bad==0);
  for(int i=0;i<1000;i++){auto v=registry.Create(url);assert(v!=0 && registry.Close(v));}
  assert(registry.Count()==0);
  std::cout<<"CWV_SECURE_REGISTRY_MSVC_PASS\n";
}