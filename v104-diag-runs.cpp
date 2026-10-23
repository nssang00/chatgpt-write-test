#include "ntfs_recovery/recovery.hpp"
#include "ntfs_recovery/read_only_source.hpp"
#include <algorithm>
#include <cstdint>
#include <filesystem>
#include <iomanip>
#include <iostream>
#include <vector>
int wmain(int argc, wchar_t** argv) {
    if (argc != 2) return 2;
    try {
        const std::filesystem::path device(argv[1]);
        ntfs::ReadOnlySource source(device);
        std::uint8_t boot[512]{};
        source.read_at(0, boot, sizeof boot);
        const std::uint64_t cbytes = (static_cast<unsigned>(boot[11]) |
            (static_cast<unsigned>(boot[12]) << 8)) * static_cast<std::uint64_t>(boot[13]);
        ntfs::Recovery recovery(device);
        std::cout << "cluster_bytes=" << cbytes << "\n";
        for (const auto& candidate : recovery.scan(4096)) {
            std::cout << "record=" << candidate.record_id << " size=" << candidate.content.size
                      << " status=" << ntfs::status_name(candidate.status)
                      << " resident=" << candidate.content.resident
                      << " runs=" << candidate.content.runs.size() << "\n";
            for (const auto& run : candidate.content.runs) {
                std::cout << "  vcn=" << run.first_vcn << " clusters=" << run.count;
                if (!run.lcn) { std::cout << " lcn=SPARSE\n"; continue; }
                std::cout << " lcn=" << *run.lcn;
                std::vector<std::uint8_t> bytes(512);
                source.read_at((*run.lcn)*cbytes, bytes.data(), bytes.size());
                const auto nonzero = std::count_if(bytes.begin(),bytes.end(),[](auto b){return b!=0;});
                std::cout << " raw_first512_nonzero=" << nonzero << " prefix_hex=";
                for (std::size_t i=0; i<16; ++i)
                    std::cout << std::hex << std::setw(2) << std::setfill('0') << static_cast<unsigned>(bytes[i]);
                std::cout << std::dec << "\n";
            }
        }
        return 0;
    } catch(const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
