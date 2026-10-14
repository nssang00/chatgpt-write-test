#include <windows.h>
#include <iostream>
#include <string>
using NativeOpen=int (__cdecl*)(void*,int,int,int,int,const wchar_t*);
using NativeRead=int (__cdecl*)(wchar_t*,int);
using NativeSet=int (__cdecl*)(int,int,int,int);
using NativeText=int (__cdecl*)(const wchar_t*);
int wmain(int argc,wchar_t** argv) {
    if(argc!=2) return 10;
    HMODULE m=LoadLibraryW(argv[1]);
    if(!m) return 11;
    const char* names[] = {"WV2Unified_Open","WV2Unified_Navigate","WV2Unified_ExecuteScript",
        "WV2Unified_PostMessage","WV2Unified_NavigateHtml","WV2Unified_Reload","WV2Unified_Stop",
        "WV2Unified_GoBack","WV2Unified_GoForward","WV2Unified_ReadMessage",
        "WV2Unified_GetState","WV2Unified_GetLastError","WV2Unified_GetCommandError",
        "WV2Unified_GetCompletedCommandCount","WV2Unified_GetDroppedMessageCount",
        "WV2Unified_SetBounds","WV2Unified_SetVisible","WV2Unified_NotifyParentMoved",
        "WV2Unified_RequestClose","WV2Unified_Close","WV2Unified_GetShutdownPhase"};
    for(const auto* n:names) if(!GetProcAddress(m,n)) {std::cerr<<"Missing export: "<<n;return 12;}
    auto open=reinterpret_cast<NativeOpen>(GetProcAddress(m,"WV2Unified_Open"));
    auto read=reinterpret_cast<NativeRead>(GetProcAddress(m,"WV2Unified_ReadMessage"));
    auto bounds=reinterpret_cast<NativeSet>(GetProcAddress(m,"WV2Unified_SetBounds"));
    auto nav=reinterpret_cast<NativeText>(GetProcAddress(m,"WV2Unified_Navigate"));
    wchar_t storage[32]{};
    if(open(nullptr,0,0,100,100,L"javascript:alert(1)")!=-16) return 13;
    if(open(nullptr,0,0,100,100,L"https://example.org")!=-10) return 14;
    if(open(nullptr,0,0,100,100,L"")!=-10) return 15;
    if(nav(L"https://example.org")!=-20) return 16;
    if(read(storage,32)!=0) return 17;
    if(read(nullptr,32)!=-10) return 18;
    if(bounds(0,0,10,10)!=-12) return 19;
    FreeLibrary(m);
    std::cout<<"Unified WebView2 native ABI and unsafe URL rejection PASS\n";
    return 0;
}
