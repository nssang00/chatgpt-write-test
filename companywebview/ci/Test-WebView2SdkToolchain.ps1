#requires -Version 7
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$version='1.0.4258.31'
$root=Join-Path $env:RUNNER_TEMP 'cwv-webview2-headers-smoke'
New-Item -ItemType Directory -Force -Path $root | Out-Null
$zip=Join-Path $root 'sdk.zip'
Invoke-WebRequest -Uri "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/$version" -MaximumRedirection 5 -OutFile $zip
$sdk=Join-Path $root 'sdk'
Expand-Archive -LiteralPath $zip -DestinationPath $sdk
$include=Join-Path $sdk 'build/native/include'
if(-not (Test-Path (Join-Path $include 'WebView2.h'))) {throw 'WebView2 native SDK header missing'}
@'
cmake_minimum_required(VERSION 3.20)
project(CwvWebView2HeaderProof LANGUAGES CXX)
add_executable(cwv_webview2_header_proof main.cpp)
target_compile_features(cwv_webview2_header_proof PRIVATE cxx_std_17)
target_include_directories(cwv_webview2_header_proof PRIVATE "${CWV_WV2_INCLUDE}")
if(MSVC)
  target_compile_options(cwv_webview2_header_proof PRIVATE /W4 /WX)
endif()
'@ | Set-Content -LiteralPath (Join-Path $root 'CMakeLists.txt') -Encoding ascii
@'
#include <Windows.h>
#include <WebView2.h>
#include <type_traits>
static_assert(std::is_base_of<IUnknown, ICoreWebView2>::value, "CoreWebView2 COM missing");
static_assert(std::is_base_of<IUnknown, ICoreWebView2WebMessageReceivedEventArgs>::value, "WebMessage metadata COM missing");
static_assert(std::is_base_of<ICoreWebView2Frame, ICoreWebView2Frame2>::value, "Frame metadata COM missing");
int main() {
 auto source=&ICoreWebView2WebMessageReceivedEventArgs::get_Source;
 auto frame=&ICoreWebView2Frame2::add_WebMessageReceived;
 return source != nullptr && frame != nullptr ? 0 : 1;
}
'@ | Set-Content -LiteralPath (Join-Path $root 'main.cpp') -Encoding ascii
$build=Join-Path $root 'build'
& cmake -S $root -B $build -G 'Visual Studio 17 2022' -A x64 "-DCWV_WV2_INCLUDE=$include"
if($LASTEXITCODE -ne 0){throw 'WebView2 SDK configure failed'}
& cmake --build $build --config Release
if($LASTEXITCODE -ne 0){throw 'WebView2 SDK C++17 build failed'}
& (Join-Path $build 'Release/cwv_webview2_header_proof.exe')
if($LASTEXITCODE -ne 0){throw 'WebView2 SDK header binary execution failed'}
[ordered]@{
 status='WEBVIEW2_SDK_NATIVE_HEADERS_COMPILE_PASS'
 sdkNugetVersion=$version
 archiveSha256=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
 productNativeAdapterCompiled=$false
 productCefDllCompiled=$false
 gpuEvidence=$false
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'evidence.json') -Encoding utf8
Write-Host 'CWV_WEBVIEW2_SDK_HEADER_COMPILE_PASS (product adapter NOT compiled)'
