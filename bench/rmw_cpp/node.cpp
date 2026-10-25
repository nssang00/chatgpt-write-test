// Identical rclcpp workload for CycloneDDS, FastDDS and rmw_zenoh_cpp.
// One publisher / N-1 subscriber PROCESSES, reliable KEEP_LAST(128) QoS.
// The ONLY middleware selection is RMW_IMPLEMENTATION in the process environment.
#include <rclcpp/rclcpp.hpp>
#include <std_msgs/msg/u_int8_multi_array.hpp>
#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace fs = std::filesystem;
using Clock = std::chrono::steady_clock;

static std::int64_t now_ns() {
  return std::chrono::duration_cast<std::chrono::nanoseconds>(
      Clock::now().time_since_epoch()).count();
}
static void atomic_write(const fs::path& p, const std::string& value) {
  auto temp = p;
  temp += ".tmp";
  { std::ofstream out(temp); if (!out) throw std::runtime_error("cannot write "+temp.string()); out << value << "\n"; }
  fs::rename(temp, p);
}
static double percentile(std::vector<double>& sorted, double q) {
  if (sorted.empty()) return 0.0;
  std::size_t k = std::min(sorted.size()-1, static_cast<std::size_t>((sorted.size()-1)*q));
  return sorted[k];
}
struct Opt {
  std::string role, directory, topic;
  int id=0, subscribers=1, bytes=1024, rate=4000;
  double seconds=2.5;
};
static Opt parse(int argc, char** argv) {
  Opt o;
  for (int i=1; i+1<argc; i+=2) {
    std::string k=argv[i],v=argv[i+1];
    if (k=="--role") o.role=v;
    else if (k=="--directory") o.directory=v;
    else if (k=="--topic") o.topic=v;
    else if (k=="--id") o.id=std::stoi(v);
    else if (k=="--subscribers") o.subscribers=std::stoi(v);
    else if (k=="--bytes") o.bytes=std::stoi(v);
    else if (k=="--rate") o.rate=std::stoi(v);
    else if (k=="--seconds") o.seconds=std::stod(v);
    else throw std::runtime_error("unknown argument "+k);
  }
  if (o.directory.empty() || o.topic.empty() || (o.role!="pub" && o.role!="sub") ||
      o.bytes<16 || o.rate<1 || o.subscribers<1) throw std::runtime_error("invalid arguments");
  return o;
}
int main(int argc, char** argv) {
  try {
    Opt o=parse(argc,argv);
    rclcpp::init(argc,argv);
    auto node = std::make_shared<rclcpp::Node>("rmw_bench_"+o.role+"_"+std::to_string(o.id));
    rclcpp::executors::SingleThreadedExecutor ex;
    ex.add_node(node);
    auto qos = rclcpp::QoS(rclcpp::KeepLast(128)).reliable().durability_volatile();
    fs::path dir(o.directory);
    if (o.role=="pub") {
      auto pub=node->create_publisher<std_msgs::msg::UInt8MultiArray>(o.topic,qos);
      const auto ready=now_ns();
      atomic_write(dir/"publisher_ready",std::to_string(ready));
      const auto deadline=Clock::now()+std::chrono::seconds(15);
      std::size_t matched=0;
      while (rclcpp::ok() && Clock::now()<deadline) {
        matched=node->count_subscribers(o.topic);
        if (matched>=static_cast<std::size_t>(o.subscribers)) break;
        ex.spin_some();
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
      }
      if (matched<static_cast<std::size_t>(o.subscribers)) {
        atomic_write(dir/"publisher_failure","publisher discovery timeout; matched="+std::to_string(matched));
        rclcpp::shutdown();
        return 3;
      }
      const auto graph_ns=now_ns();
      atomic_write(dir/"graph_ready",std::to_string(graph_ns));
      const auto go_deadline=Clock::now()+std::chrono::seconds(15);
      while (rclcpp::ok() && Clock::now()<go_deadline && !fs::exists(dir/"GO"))
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
      if (!fs::exists(dir/"GO")) throw std::runtime_error("GO timeout");
      auto msg=std_msgs::msg::UInt8MultiArray();
      msg.data.resize(static_cast<std::size_t>(o.bytes),static_cast<std::uint8_t>('x'));
      auto next=Clock::now();
      const auto started=now_ns();
      const auto finish=Clock::now()+std::chrono::duration<double>(o.seconds);
      const auto interval=std::chrono::nanoseconds(static_cast<std::int64_t>(1e9/o.rate));
      std::uint64_t sent=0;
      while (rclcpp::ok() && Clock::now()<finish) {
        auto current=Clock::now();
        if (current<next) std::this_thread::sleep_until(next);
        auto timestamp=static_cast<std::uint64_t>(now_ns());
        std::memcpy(msg.data.data(),&sent,8);
        std::memcpy(msg.data.data()+8,&timestamp,8);
        pub->publish(msg);
        ++sent;
        next+=interval;
        if (Clock::now()>next+std::chrono::milliseconds(50)) next=Clock::now();
      }
      const auto ended=now_ns();
      atomic_write(dir/"publisher.json",
          "{\"sent\":"+std::to_string(sent)+
          ",\"send_seconds\":"+std::to_string((ended-started)/1e9)+
          ",\"startup_to_graph_ms\":"+std::to_string((graph_ns-ready)/1e6)+
          ",\"matched\":"+std::to_string(matched)+
          ",\"payload_bytes\":"+std::to_string(o.bytes)+"}");
      atomic_write(dir/"DONE",std::to_string(ended));
      std::this_thread::sleep_for(std::chrono::milliseconds(800));
    } else {
      std::uint64_t received=0;
      std::uint64_t prev_seq=0;
      std::uint64_t gaps=0, duplicates=0;
      bool has_prev=false;
      std::int64_t first_ns=0;
      std::vector<double> lat_us;
      auto sub=node->create_subscription<std_msgs::msg::UInt8MultiArray>(
          o.topic,qos,[&](std_msgs::msg::UInt8MultiArray::ConstSharedPtr msg) {
            if (msg->data.size()!=static_cast<std::size_t>(o.bytes)) return;
            std::uint64_t seq=0,timestamp=0;
            std::memcpy(&seq,msg->data.data(),8);
            std::memcpy(&timestamp,msg->data.data()+8,8);
            const auto arrival=now_ns();
            if (received==0) first_ns=arrival;
            if (has_prev) {
              if (seq>prev_seq+1) gaps+=seq-prev_seq-1;
              else if (seq<=prev_seq) ++duplicates;
            }
            prev_seq=seq; has_prev=true;
            ++received;
            if (timestamp<=static_cast<std::uint64_t>(arrival)) {
              auto us=(arrival-static_cast<std::int64_t>(timestamp))/1000.0;
              if (us<=20e6) lat_us.push_back(us);
            }
          });
      atomic_write(dir/("ready_"+std::to_string(o.id)),std::to_string(now_ns()));
      auto watchdog=Clock::now()+std::chrono::seconds(45);
      std::int64_t done_ns=0;
      while (rclcpp::ok() && Clock::now()<watchdog) {
        ex.spin_some();
        if (done_ns==0 && fs::exists(dir/"DONE")) {
          std::ifstream in(dir/"DONE");
          in>>done_ns;
        }
        if (done_ns>0 && now_ns()>done_ns+static_cast<std::int64_t>(8e8)) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
      }
      std::sort(lat_us.begin(),lat_us.end());
      atomic_write(dir/("subscriber_"+std::to_string(o.id)+".json"),
          "{\"received\":"+std::to_string(received)+
          ",\"first_ns\":"+std::to_string(first_ns)+
          ",\"gaps\":"+std::to_string(gaps)+
          ",\"duplicates\":"+std::to_string(duplicates)+
          ",\"p50_us\":"+std::to_string(percentile(lat_us,0.50))+
          ",\"p95_us\":"+std::to_string(percentile(lat_us,0.95))+
          ",\"p99_us\":"+std::to_string(percentile(lat_us,0.99))+"}");
    }
    rclcpp::shutdown();
    return 0;
  } catch (const std::exception& e) {
    std::cerr<<"BENCH FAILED: "<<e.what()<<std::endl;
    return 2;
  }
}
