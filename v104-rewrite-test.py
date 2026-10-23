"""Apply v10.4 strict nonresident checks to the v10.3 Windows VHD test.
Restricted to the extracted disposable test script, not production sources.
"""
from pathlib import Path
p = Path("rw-v103/scripts/windows-live-ntfs-vhd-test.ps1")
s = p.read_text(encoding="utf-8")
old_type = "maximum=256 type=expandable"
assert s.count(old_type) == 1, "unexpected VHD declaration"
s = s.replace(old_type, "maximum=256 type=fixed")
old = """        if (-not $evidence.nonresident_recovery_verified) {
            $evidence.nonresident_recovery_note = 'Bytes differ after deletion (possible discard/TRIM). NOT a full recovery pass.'
        }"""
new = """        if (-not $evidence.nonresident_recovery_verified) {
            $recoveredBytes = [IO.File]::ReadAllBytes($largeRecoveredPath)
            $firstMismatch = -1
            $zeroByteCount = 0
            for ($i = 0; $i -lt $recoveredBytes.Length; ++$i) {
                if ($recoveredBytes[$i] -eq 0) { ++$zeroByteCount }
                if ($firstMismatch -lt 0 -and ($i -ge $largePayload.Length -or
                    $recoveredBytes[$i] -ne $largePayload[$i])) { $firstMismatch = $i }
            }
            $evidence.nonresident_recovered_zero_bytes = $zeroByteCount
            $evidence.nonresident_first_mismatch_offset = $firstMismatch
            $headCount = [Math]::Min(32, $recoveredBytes.Length)
            $evidence.nonresident_recovered_prefix_hex = [Convert]::ToHexString(
                [byte[]]$recoveredBytes[0..($headCount - 1)])
            $evidence.nonresident_recovery_note = 'SHA-256 mismatch with byte-level diagnostics; test failed.'
            throw 'Nonresident restored SHA-256 mismatch; failing CI.'
        }"""
assert s.count(old) == 1, "unexpected prior nonresident condition"
s = s.replace(old, new)
p.write_text(s, encoding="utf-8")
a = Path("rw-v103/scripts/assert-windows-live-evidence.ps1")
s = a.read_text(encoding="utf-8")
assert s.count("'resident_recovered_sha256_matches_original',") == 1
s = s.replace("'resident_recovered_sha256_matches_original',",
              "'resident_recovered_sha256_matches_original', 'nonresident_recovery_verified',")
assert s.count("Write-Host '[PASS] Windows mounted NTFS volume") == 1
s = s.replace("Write-Host '[PASS] Windows mounted NTFS volume",
              "if ($e.large_original_sha256 -cne $e.large_recovered_sha256) { throw 'Nonresident SHA mismatch' }\nWrite-Host '[PASS] Windows mounted NTFS volume")
a.write_text(s, encoding="utf-8")
print("v10.4 fixed VHD test strict SHA256 assertion and diagnostic patch applied")

# Isolate TRIM/Discard effect on this ephemeral, GitHub-hosted Windows machine.
# Query existing host setting and restore it after the VHD test.
s = p.read_text(encoding='utf-8')
query="""try {
    Invoke-DiskPartScript $diskpartCreate"""
replacement="""$trimOriginal = $null
try {
    $trimText = (& "$env:SystemRoot\System32\fsutil.exe" behavior query DisableDeleteNotify 2>&1) -join [Environment]::NewLine
    if ($LASTEXITCODE -ne 0 -or $trimText -notmatch '(?im)NTFS\s+DisableDeleteNotify\s*=\s*([01])') {
        throw "Cannot inspect NTFS DeleteNotify value: $trimText"
    }
    $trimOriginal = [int]$Matches[1]
    $evidence.ntfs_delete_notify_original = $trimOriginal
    & "$env:SystemRoot\System32\fsutil.exe" behavior set DisableDeleteNotify NTFS 1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Unable to disable NTFS DeleteNotify on disposable runner' }
    $evidence.ntfs_delete_notify_disabled_for_test = $true
    Invoke-DiskPartScript $diskpartCreate"""
assert s.count(query) == 1, "missing VHD try block"
s=s.replace(query,replacement)
query2="""} finally {
    Save-Evidence
    # Detach ONLY our uniquely named VHD."""
replacement2="""} finally {
    Save-Evidence
    if ($null -ne $trimOriginal) {
        & "$env:SystemRoot\System32\fsutil.exe" behavior set DisableDeleteNotify NTFS $trimOriginal | Out-Null
        $evidence.ntfs_delete_notify_restored = ($LASTEXITCODE -eq 0)
        Save-Evidence
        if (-not $evidence.ntfs_delete_notify_restored) { Write-Error 'Unable to restore original NTFS DeleteNotify setting.' }
    }
    # Detach ONLY our uniquely named VHD."""
assert s.count(query2) == 1, "missing final cleanup"
s=s.replace(query2,replacement2)
p.write_text(s,encoding="utf-8")
print("Temporary NTFS DeleteNotify disabled for disposable runner; restore in finally")
