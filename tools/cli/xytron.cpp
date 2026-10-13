// Native C++11 bootstrap CLI: project/plugin scaffolding, not runtime.
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <sys/stat.h>
#ifdef _WIN32
#include <direct.h>
#else
#include <sys/types.h>
#endif
static bool exists(const std::string& p) {
  struct stat x; return stat(p.c_str(),&x)==0;
}
static void dir(const std::string& p,bool mustBeNew) {
  if(exists(p)) {
    if(mustBeNew) throw std::runtime_error("Already exists: "+p);
    struct stat x;
    if(stat(p.c_str(),&x)!=0) throw std::runtime_error("Cannot stat "+p);
#ifdef _WIN32
    if(!(x.st_mode & _S_IFDIR)) throw std::runtime_error("Not directory: "+p);
#else
    if(!S_ISDIR(x.st_mode)) throw std::runtime_error("Not directory: "+p);
#endif
    return;
  }
#ifdef _WIN32
  if(_mkdir(p.c_str())!=0)
#else
  if(mkdir(p.c_str(),0755)!=0)
#endif
    throw std::runtime_error("Cannot create directory: "+p);
}
static void file(const std::string& p,const std::string& body) {
  if(exists(p)) throw std::runtime_error("Refusing overwrite: "+p);
  std::ofstream o(p.c_str(),std::ios::binary);
  if(!o) throw std::runtime_error("Cannot create: "+p);
  o<<body; o.close();
  if(!o) throw std::runtime_error("Write failed: "+p);
}
static bool valid(const std::string& id,bool module) {
  if(id.empty()||id.size()>64||id[0]<'a'||id[0]>'z') return false;
  for(std::size_t i=1;i<id.size();++i) {
    const char c=id[i];
    if(!((c>='a'&&c<='z')||(c>='0'&&c<='9')||
         c=='_'||(!module&&c=='-'))) return false;
  }
  return id!="xytron"&&id!="native"&&id!="invoke"&&
         id!="then"&&id!="constructor";
}
static std::string q(const std::string& s){return "\""+s+"\"";}
static void desktop(const std::string& id,const std::string& lang) {
  if(!valid(id,false)) throw std::runtime_error("Invalid project id");
  if(lang!="cpp"&&lang!="python"&&lang!="csharp")
    throw std::runtime_error("Backend must be cpp, python or csharp");
  const std::string entry=lang=="cpp"?"backend/main.cpp":
    lang=="python"?"backend/main.py":"backend/Program.cs";
  dir(id,true); dir(id+"/ui",true); dir(id+"/backend",true);
  file(id+"/xytron.json","{\n \"schemaVersion\": 1,\n \"app\": {\"id\": "+
    q(id)+", \"mode\":\"desktop\", \"engine\":\"auto\"},\n \"main\": "+
    "{\"id\":\"app\", \"language\": "+q(lang)+", \"entry\": "+
    q(entry)+"},\n \"modules\": []\n}\n");
  file(id+"/ui/index.html","<!doctype html><html><body><h1>Xytron</h1>"
    "<p>Scaffold only: native desktop bridge not connected.</p>"
    "</body></html>\n");
  if(lang=="cpp")
    file(id+"/"+entry,"// Placeholder until bridge host is integrated.\n"
      "#include <iostream>\nint main(){std::cout<<\"backend placeholder\\n\";}\n");
  else if(lang=="python")
    file(id+"/"+entry,"# Placeholder until JS bridge host is integrated.\n"
      "async def initialize():\n    return 'backend placeholder'\n");
  else {
    file(id+"/"+entry,"// Placeholder until JS bridge host is integrated.\n"
      "using System;\nConsole.WriteLine(\"backend placeholder\");\n");
    file(id+"/backend/MainBackend.csproj",
      "<Project Sdk=\"Microsoft.NET.Sdk\"><PropertyGroup>"
      "<OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework>"
      "</PropertyGroup></Project>\n");
  }
  std::cout<<"Created scaffold: "<<id<<" (Main "<<lang<<")\n";
}
static void plugin(const std::string& id) {
  if(!valid(id,true)) throw std::runtime_error("Invalid module id");
  dir("plugins",false);
  const std::string p="plugins/"+id;
  dir(p,true);
  file(p+"/module.json","{\"schemaVersion\":1,\"id\":"+q(id)+
    ",\"role\":\"feature\",\"language\":\"cpp\",\"delivery\":\"plugin\"}\n");
  file(p+"/plugin.cpp","#include \"nativeweb/plugin.hpp\"\n"
    "#include <string>\nclass GeneratedPlugin : public nativeweb::Plugin {\n"
    "public: void registerApi(nativeweb::PluginApi& api) override {\n"
    "  api.bind(\"hello\", [](){return std::string(\"hello\");});\n"
    "}};\nNATIVEWEB_PLUGIN(GeneratedPlugin, "+q(id)+")\n");
  file(p+"/CMakeLists.txt",
    "cmake_minimum_required(VERSION 3.16)\nproject("+id+" LANGUAGES CXX)\n"
    "find_package(NativeWeb CONFIG REQUIRED)\n"
    "get_target_property(_inc NativeWeb::Core INTERFACE_INCLUDE_DIRECTORIES)\n"
    "add_library("+id+" SHARED plugin.cpp)\n"
    "target_include_directories("+id+" PRIVATE ${_inc})\n"
    "set_target_properties("+id+" PROPERTIES CXX_STANDARD 11 CXX_STANDARD_REQUIRED YES)\n"
    "# Stable C ABI, no Core linking into plugin.\n");
  std::cout<<"Created C++ plugin scaffold: "<<p<<"\n";
}
static void help() {
  std::cout<<"xytron bootstrap CLI (partial)\n"
    "  new desktop NAME --backend cpp|python|csharp\n"
    "  plugin new NAME --language cpp\n"
    "  --help / --version\n"
    "  restore/run/build/test/publish/doctor/module add/plugin build: NOT IMPLEMENTED\n";
}
int main(int argc,char** argv) {
  try {
    if(argc==1||(argc==2&&std::string(argv[1])=="--help")) {
      help(); return 0;
    }
    if(argc==2&&std::string(argv[1])=="--version") {
      std::cout<<"xytron bootstrap 0.1.0\n"; return 0;
    }
    if(argc==6&&std::string(argv[1])=="new"&&
       std::string(argv[2])=="desktop"&&std::string(argv[4])=="--backend") {
      desktop(argv[3],argv[5]);return 0;
    }
    if(argc==6&&std::string(argv[1])=="plugin"&&
       std::string(argv[2])=="new"&&std::string(argv[4])=="--language") {
      if(std::string(argv[5])!="cpp")
        throw std::runtime_error("Only C++ plugin templates are implemented");
      plugin(argv[3]);return 0;
    }
    help();std::cerr<<"Invalid or unimplemented xytron command\n";return 2;
  } catch(const std::exception& e) {
    std::cerr<<"xytron: "<<e.what()<<std::endl;return 1;
  }
}
