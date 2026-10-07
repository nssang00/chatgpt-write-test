#include "core/json_codec.hpp"

#include "nativeweb/types.hpp"

#include <iostream>
#include <stdexcept>
#include <string>

namespace {

int failures = 0;

void fail(
    const char* expression,
    const char* file,
    int line)
{
    std::cerr
        << file << ":" << line
        << ": CHECK failed: "
        << expression
        << std::endl;

    ++failures;
}

#define CHECK(expr) \
    do { if (!(expr)) fail(#expr, __FILE__, __LINE__); } while (0)

void testStructuredRoundTrip()
{
    VariantList values;
    values.push_back(Any(1));
    values.push_back(Any("two"));
    values.push_back(Any(true));

    VariantDict nested;
    nested["count"] = 2;

    VariantDict root;
    root["name"] = "camera";
    root["values"] = values;
    root["nested"] = nested;

    const std::string json =
        nativeweb::detail::anyToJson(
            Any(root));

    const Any decodedValue =
        nativeweb::detail::jsonToAny(json);

    const VariantDict& decoded =
        AnyCast<const VariantDict&>(
            decodedValue);

    CHECK(
        AnyCast<std::string>(
            decoded.find("name")->second) ==
        "camera");

    const VariantList& decodedValues =
        AnyCast<const VariantList&>(
            decoded.find("values")->second);

    CHECK(decodedValues.size() == 3u);
    CHECK(AnyCast<int>(decodedValues[0]) == 1);
    CHECK(
        AnyCast<std::string>(
            decodedValues[1]) ==
        "two");
    CHECK(AnyCast<bool>(decodedValues[2]));
}

void testUnicodeAndEscapes()
{
    const Any decoded =
        nativeweb::detail::jsonToAny(
            "\"hello\\n\\uD55C\\uAE00\"");

    CHECK(
        AnyCast<std::string>(decoded) ==
        std::string("hello\n") +
        "\xED\x95\x9C\xEA\xB8\x80");

    const std::string encoded =
        nativeweb::detail::anyToJson(
            Any(std::string("a\nb")));

    CHECK(encoded == "\"a\\nb\"");
}

void testBinaryRoundTrip()
{
    nativeweb::Binary bytes;
    bytes.push_back(0);
    bytes.push_back(127);
    bytes.push_back(255);

    const Any decoded =
        nativeweb::detail::jsonToAny(
            nativeweb::detail::anyToJson(
                Any(bytes)));

    const nativeweb::Binary& result =
        AnyCast<const nativeweb::Binary&>(
            decoded);

    CHECK(result.size() == 3u);
    CHECK(result[0] == 0);
    CHECK(result[1] == 127);
    CHECK(result[2] == 255);
}

void testObjectHandleRoundTrip()
{
    const nativeweb::NativeObjectHandle input(
        42,
        "Camera");

    const Any decoded =
        nativeweb::detail::jsonToAny(
            nativeweb::detail::anyToJson(
                Any(input)));

    const nativeweb::NativeObjectHandle& result =
        AnyCast<const nativeweb::NativeObjectHandle&>(
            decoded);

    CHECK(result.id == 42u);
    CHECK(result.type == "Camera");
}

void testNumbers()
{
    CHECK(
        AnyCast<int>(
            nativeweb::detail::jsonToAny("42")) ==
        42);

    CHECK(
        AnyCast<double>(
            nativeweb::detail::jsonToAny("3.5")) ==
        3.5);
}

void testInvalidJson()
{
    bool threw = false;

    try
    {
        (void)nativeweb::detail::jsonToAny(
            "{\"a\":]");
    }
    catch (const std::runtime_error&)
    {
        threw = true;
    }

    CHECK(threw);
}

} // namespace

int main()
{
    testStructuredRoundTrip();
    testUnicodeAndEscapes();
    testBinaryRoundTrip();
    testObjectHandleRoundTrip();
    testNumbers();
    testInvalidJson();

    if (failures != 0)
    {
        std::cerr
            << "JSON codec regression failed: "
            << failures
            << " check(s)"
            << std::endl;

        return 1;
    }

    std::cout
        << "JSON codec regression: PASS"
        << std::endl;

    return 0;
}
