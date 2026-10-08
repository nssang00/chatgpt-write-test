cmake_minimum_required(VERSION 3.20)
project(cito LANGUAGES CXX)

add_library(cito INTERFACE)
target_include_directories(cito INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}/include)
target_compile_features(cito INTERFACE cxx_std_20)

include(CTest)
if(BUILD_TESTING)
  function(cito_add_test target source labels)
    add_executable(${target} ${source})
    target_link_libraries(${target} PRIVATE cito)
    add_test(NAME ${target} COMMAND ${target})
    set_tests_properties(${target} PROPERTIES LABELS "${labels}")
  endfunction()

  cito_add_test(cito_context_tests tests/context_test.cpp "unit;regression")
  cito_add_test(cito_type_tests tests/type_test.cpp "unit;regression")
  cito_add_test(cito_wire_tests tests/wire_test.cpp "unit;regression")
  cito_add_test(cito_interest_tests tests/interest_test.cpp "unit;regression")

  cito_add_test(cito_public_api_smoke tests/public_api_smoke.cpp "smoke;regression")
  cito_add_test(cito_interest_scale_tests tests/interest_scale_test.cpp "smoke;regression")
endif()
