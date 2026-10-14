#include "core/binding_registry.hpp"
#include "nativeweb/error.hpp"
#include "plugin/plugin_module.hpp"
#include <iostream>
#include <string>

int main(int argc, char** argv) {
    if (argc != 2) return 2;
    nativeweb::detail::BindingRegistry registry;
    {
        nativeweb::detail::PluginModule plugin(argv[1], registry);
        if (plugin.id() != "camera" || plugin.version() != "1.0.0" ||
            plugin.registrationCount() != 1u) {
            std::cerr << "Generated plugin descriptor differs from plugin.json\n";
            return 1;
        }
        const std::string text = AnyCast<std::string>(
            registry.find("camera.hello").invoke(VariantList()));
        if (text != "hello") return 1;
        nativeweb::detail::CallableSignature signature;
        if (!registry.signature("camera.hello", &signature) ||
            signature.result.kind != nativeweb::detail::CallableTypeKind::String ||
            signature.arguments.size() != 0) return 1;
        try {
            VariantList wrong;
            wrong.push_back(Any(42));
            registry.find("camera.hello").invoke(wrong);
            return 1;
        } catch (const nativeweb::Error& error) {
            if (error.code() != "invalid_arguments") return 1;
        }
    }
    if (registry.has("camera.hello")) return 1;
    std::cout << "Generated plugin.json identity/ABI DLL/SO: PASS\n";
    return 0;
}
