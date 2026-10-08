#include <cito/data_packet.hpp>

#include <cassert>

int main() {
    cito::DataPacket packet{{1, 2, 3}, {1, 2, 3, 4}};
    const auto bytes = cito::encode_data_packet(packet);
    const auto decoded = cito::decode_data_packet(bytes);

    assert(decoded.key == packet.key);
    assert(decoded.payload == packet.payload);

    auto truncated = bytes;
    truncated.pop_back();

    bool failed = false;
    try {
        (void)cito::decode_data_packet(truncated);
    } catch (const std::runtime_error&) {
        failed = true;
    }
    assert(failed);

    return 0;
}
