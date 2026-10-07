add_executable(nativeweb_any_regression
    any_regression.cpp
)

target_link_libraries(nativeweb_any_regression
    PRIVATE
        NativeWeb::Core
)

set_target_properties(nativeweb_any_regression PROPERTIES
    CXX_STANDARD 11
    CXX_STANDARD_REQUIRED YES
    CXX_EXTENSIONS NO
)

add_test(
    NAME core.any
    COMMAND nativeweb_any_regression
)
