#ifndef NATIVEWEB_TYPES_HPP_INCLUDED
#define NATIVEWEB_TYPES_HPP_INCLUDED

#include <vector>

namespace nativeweb {

// Opaque host-window boundary used by the core API. Host adapters are
// responsible for translating MFC/WinForms/WPF/Qt/GTK/Win32 native handles.
typedef void* NativeWindowHandle;

// Canonical public byte container. Browser backends decide internally whether
// to use ordinary IPC, engine-native binary transport, or shared memory.
typedef std::vector<unsigned char> Binary;

} // namespace nativeweb

#endif
