cmake_minimum_required(VERSION 3.16)
project(IntraFlow LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 11)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
find_package(SQLite3 REQUIRED)
find_package(nlohmann_json CONFIG REQUIRED)
find_package(Threads REQUIRED)
find_package(Python3 REQUIRED COMPONENTS Interpreter)
add_library(intraflow STATIC src/intraflow.cpp)
target_include_directories(intraflow PUBLIC include)
target_link_libraries(intraflow PUBLIC nlohmann_json::nlohmann_json PRIVATE SQLite::SQLite3 Threads::Threads)
set(GENERATED "${CMAKE_CURRENT_BINARY_DIR}/Messages.hpp")
add_custom_command(OUTPUT "${GENERATED}"
  COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/tools/idlgen.py" "${CMAKE_CURRENT_SOURCE_DIR}/examples/Messages.idl" "${GENERATED}"
  DEPENDS tools/idlgen.py examples/Messages.idl VERBATIM)
add_custom_target(intraflow_idl DEPENDS "${GENERATED}")
add_executable(intraflow_demo examples/app.cpp)
add_dependencies(intraflow_demo intraflow_idl)
target_include_directories(intraflow_demo PRIVATE "${CMAKE_CURRENT_BINARY_DIR}")
target_link_libraries(intraflow_demo PRIVATE intraflow)
enable_testing()
add_test(NAME five_applications COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/tests/multiprocess.py" "$<TARGET_FILE:intraflow_demo>" roles)
add_test(NAME fanout_32 COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/tests/multiprocess.py" "$<TARGET_FILE:intraflow_demo>" 32)
set_tests_properties(five_applications fanout_32 PROPERTIES TIMEOUT 90)

add_executable(intraflow_bench tests/bench_peer.cpp)
add_dependencies(intraflow_bench intraflow_idl)
target_include_directories(intraflow_bench PRIVATE "${CMAKE_CURRENT_BINARY_DIR}")
target_link_libraries(intraflow_bench PRIVATE intraflow)
foreach(scale IN ITEMS 32 64 128 256)
  math(EXPR rounds "256 / ${scale}")
  add_test(NAME benchmark_${scale}
    COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/tests/benchmark.py"
    "$<TARGET_FILE:intraflow_bench>" "${scale}" "${rounds}"
    "${CMAKE_CURRENT_BINARY_DIR}/benchmarks/${scale}.json")
  set_tests_properties(benchmark_${scale} PROPERTIES TIMEOUT 300 LABELS benchmark RUN_SERIAL TRUE)
endforeach()

add_executable(intraflow_large tests/large_payload.cpp)
add_dependencies(intraflow_large intraflow_idl)
target_include_directories(intraflow_large PRIVATE "${CMAKE_CURRENT_BINARY_DIR}")
target_link_libraries(intraflow_large PRIVATE intraflow)
add_test(NAME large_payload_sqlite
  COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/tests/large_payload.py"
    "$<TARGET_FILE:intraflow_large>" "${CMAKE_CURRENT_BINARY_DIR}/examples/intraflow-large.db")
set_tests_properties(large_payload_sqlite PROPERTIES TIMEOUT 90)

# Developer-facing standalone examples, separate from the automated stress peer.
foreach(example IN ITEMS SensorApp ControlApp DeviceApp DisplayApp MonitorApp)
  add_executable(${example} examples/${example}.cpp)
  add_dependencies(${example} intraflow_idl)
  target_include_directories(${example} PRIVATE "${CMAKE_CURRENT_BINARY_DIR}")
  target_link_libraries(${example} PRIVATE intraflow)
endforeach()
add_test(NAME standalone_examples
  COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/tests/standalone_examples.py"
  "$<TARGET_FILE:SensorApp>" "$<TARGET_FILE:ControlApp>" "$<TARGET_FILE:DeviceApp>"
  "$<TARGET_FILE:DisplayApp>" "$<TARGET_FILE:MonitorApp>")
add_executable(intraflow_stability tests/stability.cpp)
add_dependencies(intraflow_stability intraflow_idl)
target_include_directories(intraflow_stability PRIVATE "${CMAKE_CURRENT_BINARY_DIR}")
target_link_libraries(intraflow_stability PRIVATE intraflow SQLite::SQLite3)
add_test(NAME callback_concurrency_recovery
  COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/tests/stability.py"
  "$<TARGET_FILE:intraflow_stability>")
set_tests_properties(standalone_examples callback_concurrency_recovery PROPERTIES TIMEOUT 120)

add_executable(intraflow_traffic tests/traffic_peer.cpp)
add_dependencies(intraflow_traffic intraflow_idl)
target_include_directories(intraflow_traffic PRIVATE "${CMAKE_CURRENT_BINARY_DIR}")
target_link_libraries(intraflow_traffic PRIVATE intraflow)
foreach(profile IN ITEMS normal fast)
  add_test(NAME multitopic_30_${profile}
    COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/tests/traffic.py"
    "$<TARGET_FILE:intraflow_traffic>" "${profile}"
    "${CMAKE_CURRENT_BINARY_DIR}/traffic/${profile}.json")
  set_tests_properties(multitopic_30_${profile} PROPERTIES TIMEOUT 360 LABELS multitopic RUN_SERIAL TRUE)
endforeach()

add_test(NAME lambda_listener_api
  COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/tests/stability.py"
  "$<TARGET_FILE:intraflow_stability>" lambda)
set_tests_properties(lambda_listener_api PROPERTIES TIMEOUT 90)
