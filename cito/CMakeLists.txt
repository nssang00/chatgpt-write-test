cmake_minimum_required(VERSION 3.20)
project(cito LANGUAGES CXX)

add_library(cito INTERFACE)
target_include_directories(cito INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}/include)
target_compile_features(cito INTERFACE cxx_std_20)

include(CTest)
if(BUILD_TESTING)
  add_executable(cito_context_tests tests/context_test.cpp)
  target_link_libraries(cito_context_tests PRIVATE cito)
  add_test(NAME cito_context_tests COMMAND cito_context_tests)

  add_executable(cito_type_tests tests/type_test.cpp)
  target_link_libraries(cito_type_tests PRIVATE cito)
  add_test(NAME cito_type_tests COMMAND cito_type_tests)
endif()
