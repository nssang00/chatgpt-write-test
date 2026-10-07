add_library(nativeweb_public_api_compile OBJECT
    public_api_compile.cpp
)

target_link_libraries(nativeweb_public_api_compile
    PRIVATE
        NativeWeb::Core
)

set_target_properties(nativeweb_public_api_compile PROPERTIES
    CXX_STANDARD 11
    CXX_STANDARD_REQUIRED YES
    CXX_EXTENSIONS NO
)
