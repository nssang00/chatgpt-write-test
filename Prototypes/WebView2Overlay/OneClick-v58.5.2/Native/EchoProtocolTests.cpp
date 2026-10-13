#include "EchoProtocol.h"
#include <iostream>
int main() {
    using namespace wv2echo;
    Frame f{}, parsed{};
    f.mode=L"auto"; f.id=L"0"; f.payload=kFixture;
    if(!Parse(Make(kRequest,f),kRequest,parsed) || !IsFixture(parsed))return 1;
    if(!Parse(Make(kResponse,parsed),kResponse,parsed) || !IsFixture(parsed))return 2;
    if(!Parse(Make(kAck,parsed),kAck,parsed) || !IsFixture(parsed))return 3;
    Frame m{L"manual",L"17",L"\uD55C\uAE00\n|\U0001F600"};
    if(!Parse(Make(kRequest,m),kRequest,parsed) || parsed.payload!=m.payload) return 4;
    if(Parse(L"echo-v1|manual|notnum|abc",kRequest,parsed))return 5;
    if(Parse(L"echo-v1|manual|17|",kRequest,parsed))return 6;
    if(Parse(L"echo-v1|manual|17",kRequest,parsed))return 7;
    if(Parse(L"echo-v1|auto|0|wrong",kRequest,parsed) && IsFixture(parsed))return 8;
    if(Parse(L"other-prefix|manual|1|abc",kRequest,parsed))return 9;
    if(Parse(L"echo-v1|manual|1|"+std::wstring(5000,L'X'),kRequest,parsed))return 10;
    std::cout << "Native UTF-16 EchoProtocol PASS\n";
    return 0;
}
