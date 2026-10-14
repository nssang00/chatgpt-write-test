// Native C++11 bootstrap CLI: project/plugin scaffolding, not runtime.
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <sstream>
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
    q(id)+", \"mode\":\"desktop\", \"engine\":\"auto\"},\n \"ui\": {\"entry\":\"app://desktop/index.html\", \"resources\":\"ui\"},\n \"main\": "+
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
  file(p+"/plugin.json",
    "{\n  \"schemaVersion\": 1,\n  \"name\": "+q(id)+
    ",\n  \"version\": \"1.0.0\",\n  \"runtime\": \"native\",\n"
    "  \"entry\": {\n"
    "    \"win-x64\": \"bin/win-x64/"+id+".dll\",\n"
    "    \"linux-x64\": \"bin/linux-x64/lib"+id+".so\"\n"
    "  }\n}\n");
  file(p+"/plugin.cpp","#include \"xytron/plugin.hpp\"\n"
    "#include <string>\n"
    "static std::string hello() { return std::string(\"hello\"); }\n"
    "XYTRON_MODULE(m) {\n  m.function(\"hello\", &hello);\n}\n");
  file(p+"/CMakeLists.txt",
    "cmake_minimum_required(VERSION 3.19)\n"
    "project(xytron_native_plugin LANGUAGES CXX)\n"
    "file(READ \"${CMAKE_CURRENT_SOURCE_DIR}/plugin.json\" _manifest)\n"
    "string(JSON _id ERROR_VARIABLE _id_err GET \"${_manifest}\" name)\n"
    "string(JSON _ver ERROR_VARIABLE _ver_err GET \"${_manifest}\" version)\n"
    "string(JSON _runtime ERROR_VARIABLE _rt_err GET \"${_manifest}\" runtime)\n"
    "if(_id_err OR _ver_err OR _rt_err OR NOT _runtime STREQUAL \"native\")\n"
    "  message(FATAL_ERROR \"Invalid plugin.json\")\n"
    "endif()\n"
    "if(NOT _id MATCHES \"^[a-z][a-z0-9_]*$\" OR\n"
    "   NOT _ver MATCHES \"^[0-9]+[.][0-9]+[.][0-9]+$\")\n"
    "  message(FATAL_ERROR \"Invalid plugin ID/version\")\n"
    "endif()\n"
    "find_package(NativeWeb CONFIG REQUIRED)\n"
    "get_target_property(_inc NativeWeb::Core INTERFACE_INCLUDE_DIRECTORIES)\n"
    "add_library(${_id} SHARED plugin.cpp)\n"
    "target_include_directories(${_id} PRIVATE ${_inc})\n"
    "target_compile_definitions(${_id} PRIVATE\n"
    "  XYTRON_PLUGIN_ID=\\\"${_id}\\\"\n"
    "  XYTRON_PLUGIN_VERSION=\\\"${_ver}\\\")\n"
    "set_target_properties(${_id} PROPERTIES CXX_STANDARD 11 CXX_STANDARD_REQUIRED YES)\n"
    "# Stable C ABI v1; never link Core into plugin DLL/SO.\n");
  std::cout<<"Created C++ plugin scaffold: "<<p<<"\n";
}

// The CLI invokes CMake for a user-authored, locally trusted plugin tree.
// Validate the *entire* SDK prefix before shelling out so no command syntax
// can be injected through a raw CLI argument.
static bool safeSdkPrefix(const std::string& path) {
  if(path.empty() || path.size()>700) return false;
  for(std::size_t i=0;i<path.size();++i) {
    const char c=path[i];
    if(!((c>='a'&&c<='z')||(c>='A'&&c<='Z')||
         (c>='0'&&c<='9')||c=='_'||c=='-'||
         c=='/'||c=='\\'||c=='.'||c==':'||c==' '))
      return false;
  }
  return true;
}
static void doctorSdk(const std::string& sdk) {
  if(!safeSdkPrefix(sdk))
    throw std::runtime_error("Unsafe/invalid SDK prefix path");
  const std::string header=sdk+"/include/nativeweb/plugin.hpp";
  const std::string config=sdk+"/lib/cmake/NativeWeb/NativeWebConfig.cmake";
  const std::string alternative=sdk+"/lib64/cmake/NativeWeb/NativeWebConfig.cmake";
  if(!exists(header))
    throw std::runtime_error("NativeWeb plugin.hpp is missing: "+header);
  if(!exists(config) && !exists(alternative))
    throw std::runtime_error("NativeWeb CMake package is missing under: "+sdk);
  std::cout<<"xytron doctor: NativeWeb headers and CMake SDK package FOUND\n";
  if(std::system("cmake --version")!=0)
    throw std::runtime_error("CMake is not available on PATH");
  std::cout<<"xytron doctor: installed Core SDK + CMake PASS\n";
  std::cout<<"Note: browser engines, Python/.NET hosts and app packaging are NOT checked\n";
}

static void pluginBuild(const std::string& id,const std::string& sdk) {
  if(!valid(id,true)) throw std::runtime_error("Invalid plugin id");
  if(!safeSdkPrefix(sdk))
    throw std::runtime_error("Unsafe/invalid SDK prefix path");
  const std::string source="plugins/"+id;
  const std::string cmake=source+"/CMakeLists.txt";
  if(!exists(cmake))
    throw std::runtime_error("Missing plugin CMakeLists.txt: "+cmake);
  const std::string output=source+"/build";
  const std::string configure="cmake -S \""+source+
    "\" -B \""+output+"\" \"-DCMAKE_PREFIX_PATH="+sdk+"\"";
  if(std::system(configure.c_str())!=0)
    throw std::runtime_error("CMake plugin configuration failed");
  const std::string compile="cmake --build \""+output+"\" --config Release";
  if(std::system(compile.c_str())!=0)
    throw std::runtime_error("CMake plugin build failed");
  std::cout<<"Xytron plugin build: PASS ("<<id<<")\n";
}

static void moduleAdd(const std::string& id, const std::string& lang) {
  if(!valid(id,true)) throw std::runtime_error("Invalid feature Module id");
  if(lang!="cpp"&&lang!="python"&&lang!="csharp")
    throw std::runtime_error("Module must be cpp, python or csharp");
  std::ifstream in("xytron.json", std::ios::binary);
  if(!in) throw std::runtime_error("Run module add inside a xytron project");
  std::ostringstream ss;ss<<in.rdbuf();
  const std::string doc=ss.str();
  if(doc.size()>1024*1024) throw std::runtime_error("Manifest too large");
  const std::string key="\"modules\": [";
  const std::size_t begin=doc.find(key);
  if(begin==std::string::npos ||
     doc.find(key,begin+1)!=std::string::npos ||
     doc.find("\"schemaVersion\": 1")==std::string::npos ||
     doc.find("\"main\": {")==std::string::npos)
    throw std::runtime_error("Unsupported xytron.json format");
  const std::size_t open=begin+key.size()-1;
  const std::size_t close=doc.find(']',open+1);
  if(close==std::string::npos || doc.find("\n}",close)==std::string::npos)
    throw std::runtime_error("Malformed Modules manifest array");
  const std::string items=doc.substr(open+1,close-open-1);
  // Accept exactly the canonical inline records emitted by this CLI.
  // Hand-authored manifests must use a future schema-aware JSON editor.
  std::size_t cursor=0;
  while(cursor<items.size()) {
    if(items[cursor]==' ' || items[cursor]=='\n' || items[cursor]==',')
      {++cursor;continue;}
    const std::string prefix="{\"id\":\"";
    if(items.compare(cursor,prefix.size(),prefix)!=0)
      throw std::runtime_error("Unsupported Module record structure");
    const std::size_t startId=cursor+prefix.size();
    const std::size_t endId=items.find('"',startId);
    if(endId==std::string::npos) throw std::runtime_error("Invalid Module record");
    const std::string existing=items.substr(startId,endId-startId);
    if(!valid(existing,true)) throw std::runtime_error("Invalid existing Module id");
    if(existing==id) throw std::runtime_error("Module id already exists: "+id);
    const std::size_t end=items.find('}',endId);
    if(end==std::string::npos) throw std::runtime_error("Invalid Module object");
    const std::string item=items.substr(cursor,end+1-cursor);
    if(item.find("\"delivery\":\"embedded\",\"path\":\"modules/"+existing+"\"")==std::string::npos ||
       item.find("\"language\":\"")==std::string::npos)
      throw std::runtime_error("Unrecognized Module item");
    cursor=end+1;
  }
  const std::string path="modules/"+id;
  if(exists(path)) throw std::runtime_error("Module already exists: "+id);
  dir("modules",false);
  dir(path,true);
  file(path+"/module.json", "{\"schemaVersion\":1,\"id\":"+q(id)+
    ",\"role\":\"feature\",\"language\":"+q(lang)+
    ",\"delivery\":\"embedded\"}\n");
  if(lang=="cpp")
    file(path+"/module.cpp","// Module scaffold only; JS dispatch TODO.\n"
      "#include <string>\nstd::string hello(){return \"hello\";}\n");
  else if(lang=="python")
    file(path+"/module.py","# Module scaffold only; JS dispatch TODO.\n"
      "async def hello():\n    return 'hello'\n");
  else {
    file(path+"/Module.cs","// Module scaffold only; JS dispatch TODO.\n"
      "public static class Module { public static string Hello() => \"hello\"; }\n");
    file(path+"/Module.csproj","<Project Sdk=\"Microsoft.NET.Sdk\">"
      "<PropertyGroup><TargetFramework>net8.0</TargetFramework>"
      "</PropertyGroup></Project>\n");
  }
  const std::string item="{\"id\":"+q(id)+",\"language\":"+q(lang)+
    ",\"delivery\":\"embedded\",\"path\":"+q(path)+"}";
  const std::string updated=doc.substr(0,close)+
    (items.empty()?"":",")+item+doc.substr(close);
  // Validate and create generated source before writing project metadata.
  // Transactional writes / generalized JSON migration remain follow-up.
  std::ofstream out("xytron.json",std::ios::binary|std::ios::trunc);
  if(!out) throw std::runtime_error("Cannot update xytron.json");
  out<<updated;out.close();
  if(!out) throw std::runtime_error("Failed to save xytron.json");
  std::cout<<"Added "<<lang<<" feature Module "<<id
           <<" (scaffold only, not loaded by runtime)\n";
}

static void help() {
  std::cout<<"xytron bootstrap CLI (partial)\n"
    "  new desktop NAME --backend cpp|python|csharp\n"
    "  plugin new NAME --language cpp\n"
    "  plugin build NAME --sdk INSTALLED_SDK_PREFIX\n"
    "  module add NAME --language cpp|python|csharp\n"
    "  doctor --sdk INSTALLED_SDK_PREFIX\n"
    "  --help / --version\n"
    "  restore/run/build/test/publish: NOT IMPLEMENTED\n";
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
    if(argc==6&&std::string(argv[1])=="module"&&
       std::string(argv[2])=="add"&&std::string(argv[4])=="--language") {
      moduleAdd(argv[3],argv[5]);return 0;
    }
    if(argc==4&&std::string(argv[1])=="doctor"&&
       std::string(argv[2])=="--sdk") {
      doctorSdk(argv[3]);return 0;
    }
    if(argc==6&&std::string(argv[1])=="plugin"&&
       std::string(argv[2])=="build"&&std::string(argv[4])=="--sdk") {
      pluginBuild(argv[3],argv[5]);return 0;
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
