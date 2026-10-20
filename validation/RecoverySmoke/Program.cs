using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

if (args.Length != 2) throw new ArgumentException("Usage: RecoverySmoke <ntfs-image> <dll>");
var source = Path.GetFullPath(args[0]);
var native = Path.GetFullPath(args[1]);
if (!File.Exists(source) || !File.Exists(native)) throw new FileNotFoundException("Missing image or DLL.");

NativeLibrary.SetDllImportResolver(typeof(NtfsApi).Assembly,
    (name, assembly, path) => name == "RecoveryNative.dll" ? NativeLibrary.Load(native) : IntPtr.Zero);

var hashBefore = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(source)));
var files = new Dictionary<ulong, (string Name, ulong Length, uint Flags)>();
NtfsApi.ScanCallback scan = (kind, index, total, name, bytes, flags, user) => {
    if (kind == 1) files[index] = (Marshal.PtrToStringUni(name) ?? "", bytes, flags);
    return 1;
};
var error = new StringBuilder(1024);
int code = NtfsApi.FR_Scan(source, 0, scan, IntPtr.Zero, error, (uint)error.Capacity);
GC.KeepAlive(scan);
if (code != 0) throw new Exception("FR_Scan failed: " + error);
if (files.Count != 4 ||
    !files.TryGetValue(1, out var resident) ||
    resident.Name != "deleted.txt" ||
    (resident.Flags & 1) == 0 ||
    !files.TryGetValue(2, out var fragmented) ||
    fragmented.Name != "photo.jpg" ||
    fragmented.Length != 5000 ||
    !files.TryGetValue(5, out var compressed) ||
    (compressed.Flags & 1) != 0 ||
    !files.TryGetValue(9, out var mftExtent) ||
    mftExtent.Name != "fragmented-mft.txt") {
    throw new Exception("FR_Scan returned unexpected deleted-file candidates: " +
        string.Join(", ", files.Select(x => $"{x.Key}:{x.Value.Name}/{x.Value.Length}/{x.Value.Flags}")));
}

var folder = Path.Combine(Path.GetTempPath(), "RecoveryLabSmoke-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(folder);
try {
    NtfsApi.ProgressCallback progress = (done, total, user) => 1;
    var out1 = Path.Combine(folder, "deleted.txt");
    error.Clear();
    code = NtfsApi.FR_Recover(source, 1, out1, progress, IntPtr.Zero, error, (uint)error.Capacity);
    if (code != 0 || File.ReadAllText(out1) != "hello recovered\n")
        throw new Exception("FR_Recover resident file failed: " + error);

    var out2 = Path.Combine(folder, "photo.jpg");
    error.Clear();
    code = NtfsApi.FR_Recover(source, 2, out2, progress, IntPtr.Zero, error, (uint)error.Capacity);
    var content = File.ReadAllBytes(out2);
    if (code != 0 || content.Length != 5000 ||
        content.Take(4096).Any(b => b != (byte)'X') ||
        content.Skip(4096).Any(b => b != (byte)'Y'))
        throw new Exception("FR_Recover nonresident file failed: " + error);

    var out3 = Path.Combine(folder, "active.txt");
    error.Clear();
    code = NtfsApi.FR_Recover(source, 3, out3, progress, IntPtr.Zero, error, (uint)error.Capacity);
    if (code == 0 || File.Exists(out3))
        throw new Exception("Allocated file was incorrectly recovered.");

    error.Clear();
    code = NtfsApi.FR_Recover(source, 1, out1, progress, IntPtr.Zero, error, (uint)error.Capacity);
    if (code == 0 || File.ReadAllText(out1) != "hello recovered\n")
        throw new Exception("Existing output overwrite was not prevented.");
} finally {
    Directory.Delete(folder, recursive: true);
}
var hashAfter = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(source)));
if (hashBefore != hashAfter) throw new Exception("Source image changed!");
Console.WriteLine("PASS: Windows native FR_Scan and FR_Recover, deleted/allocated checks, no overwrite, source SHA256 unchanged");

internal static class NtfsApi {
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    internal delegate int ScanCallback(uint kind, ulong index, ulong total, IntPtr name, ulong bytes, uint flags, IntPtr user);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    internal delegate int ProgressCallback(ulong done, ulong total, IntPtr user);
    [DllImport("RecoveryNative.dll", CallingConvention=CallingConvention.Cdecl,
        CharSet=CharSet.Unicode, ExactSpelling=true, EntryPoint="FR_Scan")]
    internal static extern int FR_Scan(string source, ulong limit, ScanCallback callback, IntPtr user,
        [Out] StringBuilder error, uint capacity);
    [DllImport("RecoveryNative.dll", CallingConvention=CallingConvention.Cdecl,
        CharSet=CharSet.Unicode, ExactSpelling=true, EntryPoint="FR_Recover")]
    internal static extern int FR_Recover(string source, ulong index, string destination,
        ProgressCallback callback, IntPtr user, [Out] StringBuilder error, uint capacity);
}
