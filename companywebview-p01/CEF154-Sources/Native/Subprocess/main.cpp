#include <windows.h>
#include "include/cef_app.h"
#include "../Bridge/CwvRendererApp.h"

int APIENTRY wWinMain(HINSTANCE instance, HINSTANCE, wchar_t*, int) {
    CefMainArgs main_args(instance);
    return CefExecuteProcess(main_args, new CwvRendererApp(), nullptr);
}
