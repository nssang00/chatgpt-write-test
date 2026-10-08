cmake_minimum_required(VERSION 3.20)
project(cito LANGUAGES CXX)

find_package(Threads REQUIRED)
find_package(Python3 REQUIRED COMPONENTS Interpreter)

add_library(cito INTERFACE)
target_include_directories(cito INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}/include)
target_compile_features(cito INTERFACE cxx_std_20)
target_link_libraries(cito INTERFACE Threads::Threads)

include(CTest)
if(BUILD_TESTING)
  function(cito_add_test target source labels)
    add_executable(${target} ${source})
    target_link_libraries(${target} PRIVATE cito)
    target_compile_options(${target} PRIVATE -Wall -Wextra -Wpedantic)
    add_test(NAME ${target} COMMAND ${target})
    set_tests_properties(${target} PROPERTIES LABELS "${labels}")
  endfunction()

  cito_add_test(cito_context_tests tests/context_test.cpp "unit;regression")
  cito_add_test(cito_type_tests tests/type_test.cpp "unit;regression")
  cito_add_test(cito_wire_tests tests/wire_test.cpp "unit;regression")
  cito_add_test(cito_interest_tests tests/interest_test.cpp "unit;regression")
  cito_add_test(cito_runtime_tests tests/runtime_test.cpp "unit;regression")
  cito_add_test(cito_demand_router_tests tests/demand_router_test.cpp "unit;regression")
  cito_add_test(cito_type_model_tests tests/type_model_test.cpp "unit;regression")
  cito_add_test(cito_dynamic_complex_tests tests/dynamic_complex_test.cpp "unit;regression")
  cito_add_test(cito_discovery_tests tests/discovery_test.cpp "unit;regression")
  cito_add_test(cito_data_packet_tests tests/data_packet_test.cpp "unit;regression")\n  cito_add_test(cito_latency_guard_tests tests/latency_guard_test.cpp "unit;latency;regression")

  cito_add_test(cito_public_api_smoke tests/public_api_smoke.cpp "smoke;regression")
  cito_add_test(cito_interest_scale_tests tests/interest_scale_test.cpp "smoke;regression")
  cito_add_test(cito_runtime_smoke tests/runtime_smoke.cpp "smoke;regression")
  cito_add_test(cito_demand_router_smoke tests/demand_router_smoke.cpp "smoke;regression")
  cito_add_test(cito_type_model_smoke tests/type_model_smoke.cpp "smoke;regression")
  cito_add_test(cito_discovery_smoke tests/discovery_smoke.cpp "smoke;regression")

  add_test(NAME cito_idlc_unit
    COMMAND ${Python3_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/tests/test_idlc.py)
  set_tests_properties(cito_idlc_unit PROPERTIES LABELS "unit;regression")

  set(GENERATED_DIR ${CMAKE_CURRENT_BINARY_DIR}/generated)
  foreach(schema position telemetry)
    add_custom_command(
      OUTPUT ${GENERATED_DIR}/${schema}.hpp
      COMMAND ${CMAKE_COMMAND} -E make_directory ${GENERATED_DIR}
      COMMAND ${Python3_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/tools/cito_idlc.py
              ${CMAKE_CURRENT_SOURCE_DIR}/tests/idl/${schema}.idl
              -o ${GENERATED_DIR}/${schema}.hpp
      DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/tools/cito_idlc.py
              ${CMAKE_CURRENT_SOURCE_DIR}/tests/idl/${schema}.idl
      VERBATIM)
  endforeach()

  add_executable(cito_idl_static_smoke
    tests/idl_static_smoke.cpp
    ${GENERATED_DIR}/position.hpp)
  target_link_libraries(cito_idl_static_smoke PRIVATE cito)
  target_include_directories(cito_idl_static_smoke PRIVATE ${GENERATED_DIR})
  target_compile_options(cito_idl_static_smoke PRIVATE -Wall -Wextra -Wpedantic)
  add_test(NAME cito_idl_static_smoke COMMAND cito_idl_static_smoke)
  set_tests_properties(cito_idl_static_smoke PROPERTIES LABELS "smoke;regression")

  add_executable(cito_idl_complex_smoke
    tests/idl_complex_smoke.cpp
    ${GENERATED_DIR}/telemetry.hpp)
  target_link_libraries(cito_idl_complex_smoke PRIVATE cito)
  target_include_directories(cito_idl_complex_smoke PRIVATE ${GENERATED_DIR})
  target_compile_options(cito_idl_complex_smoke PRIVATE -Wall -Wextra -Wpedantic)
  add_test(NAME cito_idl_complex_smoke COMMAND cito_idl_complex_smoke)
  set_tests_properties(cito_idl_complex_smoke PROPERTIES LABELS "smoke;regression")

  if(UNIX AND NOT APPLE)
    add_executable(cito_udp_node tests/net/udp_node.cpp)
    target_link_libraries(cito_udp_node PRIVATE cito)
    target_compile_options(cito_udp_node PRIVATE -Wall -Wextra -Wpedantic)
  endif()
endif()
