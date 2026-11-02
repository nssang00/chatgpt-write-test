#requires -Version 5.1
function Get-CefExtractorCandidates {
    [CmdletBinding()] param()
    $results=New-Object 'System.Collections.Generic.List[object]'
    $seen=@{}
    function Add-VerifiedExtractor([string]$label,[string]$kind,[string]$rawPath) {
      try {
        if([string]::IsNullOrWhiteSpace($rawPath)){return}
        $clean=$rawPath.Trim().Trim('"')
        if(-not [IO.Path]::IsPathRooted($clean)){return}
        $full=[IO.Path]::GetFullPath($clean)
        if(-not [IO.File]::Exists($full)){return}
        if($seen.ContainsKey($full)){return}
        $seen[$full]=$true
        $results.Add([pscustomobject]@{Label=$label;Kind=$kind;Executable=$full})
      } catch {Write-Warning ('Ignoring invalid CEF extractor path: '+$_.Exception.Message)}
    }
    try {
      $sys=[Environment]::GetFolderPath('System')
      if([string]::IsNullOrWhiteSpace($sys)){$sys=Join-Path $env:SystemRoot 'System32'}
      Add-VerifiedExtractor 'Windows System32 bsdtar' 'tar' (Join-Path $sys 'tar.exe')
    } catch {Write-Warning ('Windows tar discovery failed: '+$_.Exception.Message)}
    foreach($name in @('py.exe','python.exe','python3.exe')) {
      try {
        $cmd=Get-Command -Name $name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if($null -ne $cmd) {
          $kind=if($name -eq 'py.exe'){'py'}else{'python'}
          Add-VerifiedExtractor ('Python 3 via '+$name) $kind ([string]$cmd.Path)
        }
      } catch {Write-Warning ('Python candidate '+$name+' was skipped: '+$_.Exception.Message)}
    }
    try {Add-VerifiedExtractor '7-Zip explicit override' '7z' ([string]$env:CWV_7ZIP_EXE)}
    catch {Write-Warning ('Explicit 7-Zip override ignored: '+$_.Exception.Message)}
    foreach($name in @('7z.exe','7za.exe','7zz.exe')) {
      try {
        $cmd=Get-Command -Name $name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if($null -ne $cmd){Add-VerifiedExtractor ('7-Zip '+$name) '7z' ([string]$cmd.Path)}
      } catch {Write-Warning ('7-Zip PATH candidate '+$name+' was skipped: '+$_.Exception.Message)}
    }
    foreach($installRoot in @([string]$env:ProgramFiles,[string]([Environment]::GetEnvironmentVariable('ProgramFiles(x86)')))) {
      if([string]::IsNullOrWhiteSpace($installRoot)){continue}
      try {
        if(-not [IO.Directory]::Exists($installRoot)){continue}
        Add-VerifiedExtractor '7-Zip standard installation' '7z' (Join-Path $installRoot '7-Zip\7z.exe')
        foreach($directory in @(Get-ChildItem -LiteralPath $installRoot -Directory -Filter '*7*Zip*' -ErrorAction Stop | Select-Object -First 20)) {
          Add-VerifiedExtractor '7-Zip versioned installation' '7z' (Join-Path $directory.FullName '7z.exe')
          Add-VerifiedExtractor '7-Zip versioned standalone' '7z' (Join-Path $directory.FullName '7zz.exe')
        }
      } catch {Write-Warning ('7-Zip install folder scan skipped: '+$_.Exception.Message)}
    }
    return $results.ToArray()
}
