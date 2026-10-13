#pragma once
#include <string>
#include <cwctype>

namespace wv2echo {
constexpr wchar_t kRequest[]=L"echo-v1|";
constexpr wchar_t kResponse[]=L"echo-return-v1|";
constexpr wchar_t kAck[]=L"echo-ack-v1|";
constexpr wchar_t kFixture[]=L"\uC548\uB155\uD558\uC138\uC694 WebView2 \uD55C\uAE00 \U0001F600";
struct Frame {
    std::wstring mode;
    std::wstring id;
    std::wstring payload;
};
inline bool Parse(const std::wstring& value, const wchar_t* prefix, Frame& f) {
    const std::wstring p(prefix);
    if (value.compare(0,p.size(),p)!=0) return false;
    auto a=value.find(L'|',p.size());
    if(a==std::wstring::npos) return false;
    auto b=value.find(L'|',a+1);
    if(b==std::wstring::npos) return false;
    Frame tmp{value.substr(p.size(),a-p.size()),value.substr(a+1,b-a-1),value.substr(b+1)};
    if(tmp.mode!=L"auto" && tmp.mode!=L"manual") return false;
    if(tmp.id.empty() || tmp.id.size()>8) return false;
    for(wchar_t ch:tmp.id) if(ch<L'0' || ch>L'9') return false;
    if(tmp.payload.empty() || tmp.payload.size()>4096) return false;
    f=std::move(tmp);
    return true;
}
inline std::wstring Key(const Frame& f) { return f.mode+L"|"+f.id; }
inline std::wstring Make(const wchar_t* prefix,const Frame& f) {
    return std::wstring(prefix)+f.mode+L"|"+f.id+L"|"+f.payload;
}
inline bool IsFixture(const Frame& f) {
    return f.mode==L"auto" && f.id==L"0" && f.payload==kFixture;
}
}
