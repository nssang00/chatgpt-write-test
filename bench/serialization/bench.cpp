#include <algorithm>
#include <chrono>
#include <cstdint>
#include <iomanip>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>
#include <flatbuffers/flatbuffers.h>
#include <fastcdr/Cdr.h>
#include <fastcdr/FastBuffer.h>
#include <msgpack.hpp>
#include "message.pb.h"
#include "message_generated.h"

static volatile std::uint64_t sink = 0;
// GCC benchmark barrier: force writes/reads of each serialized buffer in every measured iteration.
static inline void escape(const void* p) { asm volatile("" : : "g"(p) : "memory"); }
constexpr std::uint32_t ID = 123456;
constexpr std::uint64_t TS = 1700000000123456789ULL;
void require(bool ok, const char *label) {if(!ok)throw std::runtime_error(label);}
template<typename F> double measure(F&& f, std::size_t times) {
  for(std::size_t i=0;i<500;++i)f();
  std::vector<double> samples;
  for(int run=0;run<7;++run){
    auto a=std::chrono::steady_clock::now();
    for(std::size_t i=0;i<times;++i)f();
    auto b=std::chrono::steady_clock::now();
    samples.push_back(std::chrono::duration<double,std::nano>(b-a).count()/times);
  }
  std::sort(samples.begin(),samples.end());
  return samples[3];
}
void output(std::size_t n,const char *fmt,std::size_t bytes,double enc,double dec,std::size_t count){
 std::cout<<n<<","<<fmt<<","<<bytes<<","<<std::fixed<<std::setprecision(2)<<enc<<","<<dec<<","<<count<<"\n";
}
void run(std::size_t n) {
 std::vector<std::uint8_t> src(n);
 for(std::size_t i=0;i<n;++i) src[i]=static_cast<std::uint8_t>((i*131u+17u)&255u);
 const auto last=src.back();
 const std::size_t count=std::max<std::size_t>(60,std::min<std::size_t>(100000,(32u*1024u*1024u)/std::max<std::size_t>(n,64)));

 benchpb::Message pb;
 pb.set_id(ID);pb.set_timestamp(TS);
 pb.set_payload(reinterpret_cast<const char*>(src.data()),src.size());
 std::vector<char> pbwire(pb.ByteSizeLong());
 auto pe=[&](){
   require(pb.SerializeToArray(pbwire.data(),static_cast<int>(pbwire.size())),"protobuf encode");
   escape(pbwire.data());
   sink+=static_cast<unsigned char>(pbwire.back());
 };
 pe();
 benchpb::Message decoded;
 auto pd=[&](){
   escape(pbwire.data());
   require(decoded.ParseFromArray(pbwire.data(),static_cast<int>(pbwire.size())),"protobuf decode");
   sink+=decoded.id()+static_cast<unsigned char>(decoded.payload().back());
 };
 pd();
 require(decoded.id()==ID&&decoded.timestamp()==TS&&decoded.payload().size()==n&&static_cast<unsigned char>(decoded.payload().back())==last,"protobuf value");
 double pet=measure(pe,count),pdt=measure(pd,count);
 output(n,"Protobuf",pbwire.size(),pet,pdt,count);

 flatbuffers::FlatBufferBuilder fb(n+128);
 auto fe=[&](){
   fb.Clear();
   auto data=fb.CreateVector(src);
   fb.Finish(benchfb::CreateMessage(fb,ID,TS,data));
   escape(fb.GetBufferPointer());
   sink+=fb.GetSize();
 };
 fe();
 auto fd=[&](){
   escape(fb.GetBufferPointer());
   auto msg=benchfb::GetMessage(fb.GetBufferPointer());
   sink+=msg->id()+msg->payload()->Get(n-1);
 };
 require(benchfb::GetMessage(fb.GetBufferPointer())->timestamp()==TS&&benchfb::GetMessage(fb.GetBufferPointer())->payload()->size()==n&&benchfb::GetMessage(fb.GetBufferPointer())->payload()->Get(n-1)==last,"flatbuffers value");
 double fet=measure(fe,count),fdt=measure(fd,count);
 output(n,"FlatBuffers",fb.GetSize(),fet,fdt,count);

 msgpack::sbuffer mp;
 auto me=[&](){
   mp.clear();
   msgpack::packer<msgpack::sbuffer> p(&mp);
   p.pack_array(3);p.pack_uint32(ID);p.pack_uint64(TS);
   p.pack_bin(static_cast<std::uint32_t>(n));
   p.pack_bin_body(reinterpret_cast<const char*>(src.data()),static_cast<std::uint32_t>(n));
   escape(mp.data());
   sink+=mp.size();
 };
 me();
 auto md=[&](){
   escape(mp.data());
   auto handle=msgpack::unpack(mp.data(),mp.size());
   auto const &o=handle.get();
   require(o.type==msgpack::type::ARRAY&&o.via.array.size==3,"msgpack array");
   auto v=o.via.array.ptr;
   require(v[2].type==msgpack::type::BIN&&v[2].via.bin.size==n,"msgpack data");
   sink+=v[0].as<std::uint32_t>()+static_cast<unsigned char>(v[2].via.bin.ptr[n-1]);
 };
 md();
 double met=measure(me,count),mdt=measure(md,count);
 output(n,"MessagePack",mp.size(),met,mdt,count);

 std::vector<char> bytes(n+256);
 eprosima::fastcdr::FastBuffer buf(bytes.data(),bytes.size());
 std::size_t cdsz=0;
 auto ce=[&](){
   eprosima::fastcdr::Cdr s(buf,eprosima::fastcdr::Cdr::DEFAULT_ENDIAN);
   s.serialize_encapsulation();
   s<<ID<<TS<<src;
   cdsz=s.getSerializedDataLength();
   escape(bytes.data());
   sink+=cdsz;
 };
 ce();
 std::uint32_t di=0;
 std::uint64_t dt=0;
 std::vector<std::uint8_t> dbytes;
 auto cd=[&](){
   eprosima::fastcdr::Cdr d(buf,eprosima::fastcdr::Cdr::DEFAULT_ENDIAN);
   escape(bytes.data());
   d.read_encapsulation();
   d>>di>>dt>>dbytes;
   sink+=di+dbytes.back();
 };
 cd();
 require(di==ID&&dt==TS&&dbytes.size()==n&&dbytes.back()==last,"cdr value");
 double cet=measure(ce,count),cdt=measure(cd,count);
 output(n,"DDS-CDR",cdsz,cet,cdt,count);
}
int main(){
 try {
  std::cout<<"payload_bytes,format,encoded_bytes,encode_ns,decode_ns,iterations\n";
  for(std::size_t n:{16u,64u,256u,1024u,4096u,16384u,65536u,262144u,1048576u})run(n);
  std::cerr<<"checksum="<<sink<<"\n";
 } catch(const std::exception& e){std::cerr<<e.what()<<"\n";return 1;}
}
