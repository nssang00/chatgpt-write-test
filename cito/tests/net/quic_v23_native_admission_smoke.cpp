#include <cito/detail/request_msquic_listener.hpp>
#include <cito/detail/request_msquic_server_admission.hpp>
#include <msquic.h>

#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <thread>
#include <string_view>

using namespace std::chrono_literals;

int main(int argc, char** argv) {
    if (argc != 4 && argc != 5) return 2;
    const bool deny = argc == 5 && std::string_view(argv[4]) == "deny";
    if (argc == 5 && !deny) return 2;
    const unsigned long number = std::strtoul(argv[1], nullptr, 10);
    if (number == 0 || number > 65535) return 2;

    const QUIC_API_TABLE* api = nullptr;
    if (QUIC_FAILED(MsQuicOpen2(&api)) || !api) { std::cerr << "admission_open_api_failed\n"; return 10; }
    HQUIC registration = nullptr;
    const QUIC_REGISTRATION_CONFIG reg_config{"cito-v23-admission-smoke",
                                               QUIC_EXECUTION_PROFILE_LOW_LATENCY};
    if (QUIC_FAILED(api->RegistrationOpen(&reg_config, &registration))) { std::cerr << "admission_registration_failed\n"; return 11; }

    constexpr std::uint8_t alpn_bytes[] = {'c','i','t','o','/','1'};
    QUIC_BUFFER alpn{sizeof(alpn_bytes), const_cast<std::uint8_t*>(alpn_bytes)};
    HQUIC configuration = nullptr;
    QUIC_SETTINGS settings{};
    settings.PeerBidiStreamCount = 4;
    settings.IsSet.PeerBidiStreamCount = TRUE;
    settings.DatagramReceiveEnabled = TRUE;
    settings.IsSet.DatagramReceiveEnabled = TRUE;
    settings.IdleTimeoutMs = 5000;
    settings.IsSet.IdleTimeoutMs = TRUE;
    if (QUIC_FAILED(api->ConfigurationOpen(registration, &alpn, 1, &settings,
                                             sizeof(settings), nullptr, &configuration))) {
        std::cerr << "admission_config_open_failed\n";
        return 12;
    }

    QUIC_CERTIFICATE_FILE file{};
    file.CertificateFile = argv[2];
    file.PrivateKeyFile = argv[3];
    QUIC_CREDENTIAL_CONFIG credentials{};
    credentials.Type = QUIC_CREDENTIAL_TYPE_CERTIFICATE_FILE;
    credentials.CertificateFile = &file;
    if (QUIC_FAILED(api->ConfigurationLoadCredential(configuration, &credentials))) {
        std::cerr << "admission_tls_load_failed\n";
        return 13;
    }

    std::atomic<unsigned> seen{0};
    std::atomic<unsigned> authorized{0};
    std::atomic<unsigned> closed{0};
    bool ok = false;
    {
        // Test-only authorization: proves the callback and owner-loop boundary.
        // It is deliberately NOT a substitute for a peer certificate policy.
        cito::detail::RequestMsQuicServerAdmission admission(
            api, configuration, 4,
            [&](HQUIC) {
                seen.fetch_add(1, std::memory_order_relaxed);
                return !deny;
            },
            [&](HQUIC) {
                authorized.fetch_add(1, std::memory_order_relaxed);
                return true;
            },
            [](HQUIC, HQUIC) { return false; },
            [&](HQUIC) { closed.fetch_add(1, std::memory_order_relaxed); });

        cito::detail::RequestMsQuicListener listener(
            api, registration, [&](HQUIC h) { return admission.accept(h); });

        QUIC_ADDR address{};
        QuicAddrSetFamily(&address, QUIC_ADDRESS_FAMILY_UNSPEC);
        QuicAddrSetPort(&address, static_cast<std::uint16_t>(number));
        if (!listener.start(alpn_bytes, &address)) { std::cerr << "admission_listener_start_failed\n"; return 14; }
        std::cout << "admission_listener_ready" << std::endl;

        const auto deadline = std::chrono::steady_clock::now() + 8s;
        while (std::chrono::steady_clock::now() < deadline &&
               !(deny ? (seen.load(std::memory_order_relaxed) == 1 && admission.empty())
                      : authorized.load(std::memory_order_relaxed) == 1)) {
            admission.poll();
            std::this_thread::sleep_for(2ms);
        }
        if (!deny) std::this_thread::sleep_for(500ms);
        listener.close();
        admission.shutdown_all();
        const auto close_deadline = std::chrono::steady_clock::now() + 5s;
        while (!admission.empty() &&
               std::chrono::steady_clock::now() < close_deadline) {
            admission.poll();
            std::this_thread::sleep_for(2ms);
        }
        ok = admission.empty() && seen.load() == 1 &&
             authorized.load() == (deny ? 0U : 1U) &&
             closed.load() == (deny ? 0U : 1U);
        std::cout << "cito_v23_native_admission seen=" << seen.load()
                  << " denied=" << deny
                  << " authorized=" << authorized.load()
                  << " closed=" << closed.load()
                  << " drained=" << admission.empty() << std::endl;
        // Do not return while accepted callbacks are still alive.
        if (!admission.empty()) std::terminate();
    }
    api->ConfigurationClose(configuration);
    api->RegistrationClose(registration);
    MsQuicClose(api);
    return ok ? 0 : 15;
}
