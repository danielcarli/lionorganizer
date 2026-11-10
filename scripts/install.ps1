#Requires -Version 5.1
<#---------------------------------------------------------------------------------------------
 *  LionOrganizer - Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------#>
<#
.SYNOPSIS
  LionOrganizer installer for Windows (lightweight bootstrapper).

.DESCRIPTION
  Always installs the LATEST release published on GitHub (or the one given with -Version):
    1. reads manifest.txt from the release and verifies it against SHA256SUMS;
    2. downloads the app source bundle (a few MB) and verifies its SHA-256
       (and its build provenance with "gh attestation verify", when the GitHub CLI is available);
    3. downloads the matching Electron runtime from Electron's official GitHub releases and
       verifies it against Electron's SHASUMS256.txt;
    4. installs it like VS Code does: per user in %LOCALAPPDATA%\Programs\LionOrganizer
       (default, no administrator rights) or for all users in %ProgramFiles%\LionOrganizer,
       with Start menu and desktop shortcuts and an entry in Settings > Apps.
  Run it again at any time to update. Nothing is installed if any check fails.

.EXAMPLE
  .\install.ps1                      # latest version, current user
.EXAMPLE
  .\install.ps1 -Scope Machine       # all users (run from an elevated PowerShell)
.EXAMPLE
  .\install.ps1 -Uninstall -Purge    # remove the app, its settings and its catalog
.EXAMPLE
  .\install.ps1 -AssembleTo C:\temp\lion   # only download, verify and assemble the app into a folder
  Used by the graphical installer (LionOrganizer-Setup.exe, Inno Setup), which then installs the files.
  Progress is written as "@@STEP|n|total|text" and "@@BYTES|done|total" lines; at the end "@@VERSION|x.y.z"
  and "@@DONE", or "@@ERROR|message"; then "@@EXIT|code". With -ProgressFile the same lines are also
  appended to that file, so the installer can follow them without waiting on this process.
  -ReuseFrom <folder>: an installed copy whose Electron runtime is the same version is reused instead of
  downloading it again (an update then only downloads the app itself, a few hundred KB).
  -RunningSetup <exe> -NewSetupTo <exe>: when the release's LionOrganizer-Setup.exe differs from the one
  running, it is downloaded and verified to -NewSetupTo (the wizard then keeps it for the next update).
#>
[CmdletBinding()]
param(
  [ValidateSet('User', 'Machine')] [string] $Scope = 'User',
  [string] $Version = '',
  [switch] $RequireAttestation,
  [switch] $NoDesktopShortcut,
  [switch] $Force,
  [switch] $Yes,
  [switch] $Uninstall,
  [switch] $Purge,
  [string] $AssembleTo = '',
  [string] $ProgressFile = '',
  [string] $ReuseFrom = '',
  [string] $RunningSetup = '',
  [string] $NewSetupTo = ''
)

Set-StrictMode -Version 3.0
# Started from PowerShell 7 (e.g. a setup launched from a pwsh terminal), Windows PowerShell 5.1 inherits
# PowerShell 7's module folders and then cannot load its own modules. Use the standard 5.1 folders.
if ($PSVersionTable.PSEdition -eq 'Desktop') {
  $env:PSModulePath = @(
    (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'WindowsPowerShell\Modules'),
    (Join-Path $env:ProgramFiles 'WindowsPowerShell\Modules'),
    (Join-Path $PSHOME 'Modules')
  ) -join ';'
}
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is much faster without the progress bar
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 }
catch { Write-Verbose 'TLS 1.2 is already the default on this system.' }

$Repo = if ($env:LIONORGANIZER_REPO) { $env:LIONORGANIZER_REPO } else { 'danielcarli/lionorganizer' }
$ReleasesUrl = if ($env:LIONORGANIZER_RELEASES_URL) { $env:LIONORGANIZER_RELEASES_URL } else { "https://github.com/$Repo/releases" }
$ElectronMirror = if ($env:LIONORGANIZER_ELECTRON_MIRROR) { $env:LIONORGANIZER_ELECTRON_MIRROR } else { 'https://github.com/electron/electron/releases/download' }
$AppName = 'LionOrganizer'
$Publisher = 'LionOrganizer Team'
$Marker = 'lionorganizer-install.txt'
# rcedit (by the Electron team) sets the icon and version info of LionOrganizer.exe. Pinned by SHA-256.
$RceditUrl = 'https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe'
$RceditSha256 = '3e7801db1a5edbec91b49a24a094aad776cb4515488ea5a4ca2289c400eade2a'
$VersionPattern = '^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$'
$FilePattern = '^[A-Za-z0-9._-]+$'

# --------------------------------------------------------------------------------------- output
# Lines for the graphical installer: on the output and, with -ProgressFile, appended to that file (one
# write per line, so a reader never sees half of one).
$Utf8 = New-Object System.Text.UTF8Encoding($false)
function Send-Line([string] $Text) {
  if (-not $AssembleTo) { return }
  Write-Output $Text
  if ($ProgressFile) {
    for ($i = 0; $i -lt 5; $i++) {
      try { [IO.File]::AppendAllText($ProgressFile, "$Text`r`n", $Utf8); break } catch { Start-Sleep -Milliseconds 20 }
    }
  }
}
function Write-Step([string] $Text) { Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Ok([string] $Text) { if ($AssembleTo) { Send-Line "  [ok] $Text" } else { Write-Host "  [ok] $Text" -ForegroundColor Green } }
function Write-Note([string] $Text) { if ($AssembleTo) { Send-Line "  [!] $Text" } else { Write-Host "  [!] $Text" -ForegroundColor Yellow } }
function Stop-Install([string] $Text) { throw "LionOrganizer installer: $Text" }
# Progress for the graphical installer (only in -AssembleTo mode); Write-Step for the console.
$StepTotal = 4
function Write-Stage([int] $N, [string] $Text) {
  Send-Line "@@STEP|$N|$StepTotal|$Text"
  Write-Step $Text
}

# --------------------------------------------------------------------------------------- downloads & checks
function Assert-SecureUrl([string] $Url) {
  if ($Url.StartsWith('https://')) { return }
  if ($env:LIONORGANIZER_ALLOW_INSECURE_FOR_TESTS -eq '1' -and $Url -match '^http://(127\.0\.0\.1|localhost):') { return }
  Stop-Install "Refusing insecure URL: $Url"
}

# Streams the download to the file; for the graphical installer, reports the bytes about 3 times a second.
function Save-Url([string] $Url, [string] $OutFile) {
  $req = [Net.HttpWebRequest]::Create($Url)
  $req.UserAgent = 'LionOrganizer-Installer'
  $req.AllowAutoRedirect = $true
  $req.MaximumAutomaticRedirections = 10
  $req.Timeout = 30000
  $req.ReadWriteTimeout = 60000
  $res = $req.GetResponse()
  try {
    $final = $res.ResponseUri.AbsoluteUri
    if (-not $final.StartsWith('https://')) { Assert-SecureUrl $final }
    $total = $res.ContentLength
    $in = $res.GetResponseStream()
    $out = [IO.File]::Create($OutFile)
    try {
      $buf = New-Object byte[] 262144
      $done = [long] 0
      $last = [Environment]::TickCount
      while (($n = $in.Read($buf, 0, $buf.Length)) -gt 0) {
        $out.Write($buf, 0, $n)
        $done += $n
        if ($total -gt 1048576 -and ([Environment]::TickCount - $last) -ge 300) { Send-Line "@@BYTES|$done|$total"; $last = [Environment]::TickCount }
      }
      if ($total -gt 1048576) { Send-Line "@@BYTES|$done|$total" }
    } finally { $out.Dispose(); $in.Dispose() }
  } finally { $res.Close() }
}

function Get-Download([string] $Url, [string] $OutFile) {
  Assert-SecureUrl $Url
  $attempt = 0
  while ($true) {
    try {
      if ($AssembleTo) { Save-Url $Url $OutFile }
      else { Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -MaximumRedirection 10 -Headers @{ 'User-Agent' = 'LionOrganizer-Installer' } }
      return
    } catch {
      $attempt++
      if ($attempt -ge 3) { Stop-Install "Download failed: $Url ($($_.Exception.Message))" }
      Start-Sleep -Seconds (2 * $attempt)
    }
  }
}

# Hashing and unzipping use .NET directly, so they work without any PowerShell module.
function Get-Sha256([string] $Path) {
  $stream = [IO.File]::OpenRead($Path)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { -join ($sha.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') }) }
  finally { $sha.Dispose(); $stream.Dispose() }
}

function Expand-Zip([string] $Path, [string] $Destination) {
  # ZipFile refuses entries that would land outside the destination folder.
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::ExtractToDirectory($Path, $Destination)
}

function Get-PublishedSum([string] $SumsFile, [string] $Name) {
  foreach ($line in Get-Content -LiteralPath $SumsFile) {
    $parts = $line.Trim() -split '\s+', 2
    if ($parts.Count -eq 2 -and $parts[1].TrimStart('*') -eq $Name -and $parts[0] -match '^[0-9a-fA-F]{64}$') { return $parts[0].ToLowerInvariant() }
  }
  return ''
}

function Assert-Checksum([string] $Path, [string] $SumsFile, [string] $Name) {
  $expected = Get-PublishedSum $SumsFile $Name
  if (-not $expected) { Stop-Install "No checksum published for $Name - refusing to install." }
  $actual = Get-Sha256 $Path
  if ($actual -ne $expected) {
    Stop-Install "Checksum mismatch for $Name (expected $expected, got $actual). The download may be corrupted or tampered with. Nothing was installed."
  }
  Write-Ok "SHA-256 verified: $Name"
}

$script:AttestationNoted = $false
function Assert-Attestation([string] $Path) {
  # Local test releases have no GitHub attestation; the checksums are still verified.
  if ($env:LIONORGANIZER_ALLOW_INSECURE_FOR_TESTS -eq '1' -and -not $RequireAttestation) { return }
  $gh = Get-Command gh -ErrorAction SilentlyContinue
  $loggedIn = $false
  if ($gh) { & $gh.Source auth status *> $null; $loggedIn = ($LASTEXITCODE -eq 0) }
  if ($loggedIn) {
    # gh is installed and logged in: a failed verification is a real warning sign, so stop.
    & $gh.Source attestation verify $Path --repo $Repo *> $null
    if ($LASTEXITCODE -eq 0) { Write-Ok "Build provenance verified by GitHub: $(Split-Path $Path -Leaf)"; return }
    Stop-Install "Build provenance could not be verified for $(Split-Path $Path -Leaf). Nothing was installed."
  }
  if ($RequireAttestation) { Stop-Install '-RequireAttestation needs the GitHub CLI (gh) installed and logged in: https://cli.github.com' }
  if (-not $script:AttestationNoted) { Write-Note 'GitHub CLI not available or not logged in: skipping the provenance check (checksums are still verified).'; $script:AttestationNoted = $true }
}

function Read-Manifest([string] $Path) {
  $m = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    $i = $line.IndexOf('=')
    if ($i -gt 0) { $m[$line.Substring(0, $i).Trim()] = $line.Substring($i + 1).Trim() }
  }
  foreach ($k in 'version', 'electron') { if (-not $m.ContainsKey($k) -or $m[$k] -notmatch $VersionPattern) { Stop-Install "Invalid release manifest ($k)." } }
  if (-not $m.ContainsKey('source_zip') -or $m['source_zip'] -notmatch $FilePattern) { Stop-Install 'Invalid release manifest (source).' }
  return $m
}

function Get-Arch {
  $a = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
  if ($a -eq 'ARM64') { return 'arm64' }
  if ($a -eq 'AMD64' -or [Environment]::Is64BitOperatingSystem) { return 'x64' }
  Stop-Install 'LionOrganizer needs a 64-bit version of Windows.'
}

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  return ([Security.Principal.WindowsPrincipal]::new($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# --------------------------------------------------------------------------------------- locations
function Get-Locations {
  if ($Scope -eq 'Machine') {
    return @{
      Dir      = Join-Path $env:ProgramFiles $AppName
      StartMenu = [Environment]::GetFolderPath('CommonPrograms')
      Desktop  = [Environment]::GetFolderPath('CommonDesktopDirectory')
      RegKey   = "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$AppName"
    }
  }
  return @{
    Dir      = Join-Path $env:LOCALAPPDATA "Programs\$AppName"
    StartMenu = [Environment]::GetFolderPath('Programs')
    Desktop  = [Environment]::GetFolderPath('Desktop')
    RegKey   = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$AppName"
  }
}

# An installed copy whose Electron runtime can be reused: same Electron version and architecture.
function Find-ReusableRuntime([string] $Dir, [string] $Electron, [string] $Arch) {
  if (-not $Dir -or -not (Test-Path -LiteralPath (Join-Path $Dir $Marker))) { return '' }
  $info = @{}
  foreach ($line in Get-Content -LiteralPath (Join-Path $Dir $Marker)) { if ($line -match '^(\w+)=(.*)$') { $info[$Matches[1]] = $Matches[2].Trim() } }
  if ($info['electron'] -ne $Electron) { return '' }
  if ($info.ContainsKey('arch') -and $info['arch'] -ne $Arch) { return '' }
  foreach ($need in "$AppName.exe", 'resources', 'locales', 'icudtl.dat') { if (-not (Test-Path -LiteralPath (Join-Path $Dir $need))) { return '' } }
  return $Dir
}

# Copies the Electron runtime of an installed copy into the stage: everything except the app itself
# (resources\app), the installer's own files and the uninstaller.
# The wizard keeps a copy of itself for updates, and that copy cannot replace itself while it runs. When
# the release's wizard differs from the running one, it is downloaded and verified to -NewSetupTo; the
# wizard puts it in place at the end, so the next update already runs the new wizard. Optional: if it
# fails, the current wizard simply stays.
function Save-NewSetup([string] $Base, [string] $SumsFile, [string] $Tmp) {
  if (-not $NewSetupTo -or -not $RunningSetup) { return }
  $name = "$AppName-Setup.exe"
  try {
    Remove-Item -LiteralPath $NewSetupTo -Force -ErrorAction SilentlyContinue
    $expected = Get-PublishedSum $SumsFile $name
    if (-not $expected) { return }
    if ((Test-Path -LiteralPath $RunningSetup) -and (Get-Sha256 $RunningSetup) -eq $expected) { return }
    $file = Join-Path $Tmp $name
    Get-Download "$Base/$name" $file
    Assert-Checksum $file $SumsFile $name
    Move-Item -LiteralPath $file -Destination $NewSetupTo -Force
    Write-Ok 'Setup kept for updates refreshed'
  } catch { Write-Note "Keeping the current setup for updates ($($_.Exception.Message))." }
}

function Copy-Runtime([string] $From, [string] $Stage) {
  New-Item -ItemType Directory -Path $Stage -Force | Out-Null
  foreach ($item in Get-ChildItem -LiteralPath $From -Force) {
    if ($item.Name -match '^unins' -or $item.Name -in @('install.ps1', $Marker)) { continue }
    if ($item.Name -eq 'resources') {
      $res = Join-Path $Stage 'resources'
      New-Item -ItemType Directory -Path $res -Force | Out-Null
      foreach ($r in Get-ChildItem -LiteralPath $item.FullName -Force) {
        if ($r.Name -in @('app', 'default_app.asar')) { continue }
        Copy-Item -LiteralPath $r.FullName -Destination $res -Recurse -Force
      }
      continue
    }
    Copy-Item -LiteralPath $item.FullName -Destination $Stage -Recurse -Force
  }
}

function Get-InstalledVersion([string] $Dir) {
  $f = Join-Path $Dir $Marker
  if (Test-Path -LiteralPath $f) {
    foreach ($line in Get-Content -LiteralPath $f) { if ($line -like 'version=*') { return $line.Substring(8) } }
  }
  return ''
}

function Stop-RunningApp([string] $Dir) {
  # every process started from the app folder: LionOrganizer.exe and Electron's helpers (crash handler etc.)
  $prefix = $Dir.TrimEnd('\') + '\'
  $running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) })
  if ($running.Count -eq 0) { return }
  if (-not $Yes) {
    $answer = Read-Host "$AppName is running. Close it to continue? [Y/n]"
    if ($answer -and $answer -notmatch '^(y|yes|s|sim)$') { Stop-Install 'Cancelled.' }
  }
  $running | Stop-Process -Force
  Start-Sleep -Seconds 1
}

function New-Shortcut([string] $Path, [string] $Target, [string] $WorkDir) {
  $shell = New-Object -ComObject WScript.Shell
  $lnk = $shell.CreateShortcut($Path)
  $lnk.TargetPath = $Target
  $lnk.WorkingDirectory = $WorkDir
  $lnk.IconLocation = "$Target,0"
  $lnk.Description = 'Disk space analysis & cleanup'
  $lnk.Save()
}

# --------------------------------------------------------------------------------------- uninstall
function Invoke-Uninstall {
  $loc = Get-Locations
  if ($Scope -eq 'Machine' -and -not (Test-Admin)) { Stop-Install 'Removing an all-users install needs an elevated PowerShell (Run as administrator).' }
  Write-Step "Removing $AppName ($Scope)"
  Stop-RunningApp $loc.Dir
  foreach ($p in (Join-Path $loc.StartMenu "$AppName.lnk"), (Join-Path $loc.Desktop "$AppName.lnk")) { Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath $loc.RegKey -Recurse -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $loc.Dir) { Remove-Item -LiteralPath $loc.Dir -Recurse -Force; Write-Ok "Removed $($loc.Dir)" } else { Write-Note "Not installed in $($loc.Dir)" }
  $data = Join-Path $env:APPDATA $AppName
  if ($Purge) { Remove-Item -LiteralPath $data -Recurse -Force -ErrorAction SilentlyContinue; Write-Ok "Removed settings and catalog ($data)" }
  else { Write-Host "  Settings and catalog kept in $data (use -Purge to remove them)." -ForegroundColor DarkGray }
}

# --------------------------------------------------------------------------------------- install
function Invoke-Install {
  $loc = Get-Locations
  if ($Scope -eq 'Machine' -and -not (Test-Admin)) { Stop-Install 'An all-users install needs an elevated PowerShell (Run as administrator). Or install just for you with -Scope User.' }
  if ($Version -and $Version.TrimStart('v') -notmatch $VersionPattern) { Stop-Install "Invalid version: $Version" }
  $arch = Get-Arch
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("lionorganizer-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    $label = if ($Version) { 'requested' } else { 'latest' }
    Write-Stage 1 "Looking for the $label $AppName release"
    $base = if ($Version) { "$ReleasesUrl/download/v$($Version.TrimStart('v'))" } else { "$ReleasesUrl/latest/download" }
    Get-Download "$base/manifest.txt" (Join-Path $tmp 'manifest.txt')
    $m = Read-Manifest (Join-Path $tmp 'manifest.txt')
    $base = "$ReleasesUrl/download/v$($m.version)"   # pin every other file to that exact release
    $sums = Join-Path $tmp 'SHA256SUMS'
    Get-Download "$base/SHA256SUMS" $sums
    Assert-Checksum (Join-Path $tmp 'manifest.txt') $sums 'manifest.txt'
    Write-Ok "Release $($m.version) (Electron $($m.electron))"
    Send-Line "@@VERSION|$($m.version)"

    $current = if ($AssembleTo) { '' } else { Get-InstalledVersion $loc.Dir }
    if ($current -and $current -eq $m.version -and -not $Force) { Write-Ok "$AppName $($m.version) is already installed and up to date."; return }
    if (-not $AssembleTo) {
      Write-Host ''
      Write-Host ("  Version:   {0}{1}" -f $m.version, $(if ($current) { " (installed: $current)" } else { '' }))
      Write-Host "  Location:  $($loc.Dir)"
      Write-Host "  System:    Windows $arch, $Scope install"
      Write-Host ''
      if (-not $Yes) {
        $answer = Read-Host "Install $AppName $($m.version)? [Y/n]"
        if ($answer -and $answer -notmatch '^(y|yes|s|sim)$') { Stop-Install 'Cancelled.' }
      }
    }

    Write-Stage 2 "Downloading $AppName $($m.version)"
    $srcZip = Join-Path $tmp $m.source_zip
    Get-Download "$base/$($m.source_zip)" $srcZip
    Assert-Checksum $srcZip $sums $m.source_zip
    Assert-Attestation $srcZip
    $setup = Join-Path $tmp 'install.ps1'
    Get-Download "$base/install.ps1" $setup                  # kept next to the app for updates/uninstall
    Assert-Checksum $setup $sums 'install.ps1'

    $stage = Join-Path $tmp 'stage'
    # An update keeps the same Electron most of the time: reuse the installed runtime instead of
    # downloading about 110 MB again. It was verified against Electron's checksums when it was installed.
    $reuseDir = if ($ReuseFrom) { $ReuseFrom } elseif (-not $AssembleTo) { $loc.Dir } else { '' }
    $reuse = if ($Force) { '' } else { Find-ReusableRuntime $reuseDir $m.electron $arch }
    if ($reuse) {
      Send-Line '@@REUSE'
      Write-Stage 3 "Reusing the installed Electron $($m.electron) runtime"
      Copy-Runtime $reuse $stage
      Write-Ok "Electron $($m.electron) already installed: nothing to download"
      Write-Stage 4 'Assembling the application'
    } else {
      $ezip = "electron-v$($m.electron)-win32-$arch.zip"
      Write-Stage 3 "Downloading the Electron $($m.electron) runtime (win32-$arch)"
      $esums = Join-Path $tmp 'ELECTRON-SHASUMS256.txt'
      Get-Download "$ElectronMirror/v$($m.electron)/SHASUMS256.txt" $esums
      Get-Download "$ElectronMirror/v$($m.electron)/$ezip" (Join-Path $tmp $ezip)
      Assert-Checksum (Join-Path $tmp $ezip) $esums $ezip
      Write-Stage 4 'Assembling the application'
      Expand-Zip (Join-Path $tmp $ezip) $stage
    }
    Expand-Zip $srcZip (Join-Path $tmp 'src')
    $srcRoot = @(Get-ChildItem -LiteralPath (Join-Path $tmp 'src') -Directory)[0].FullName
    if (-not (Test-Path (Join-Path $srcRoot 'package.json')) -or -not (Test-Path (Join-Path $srcRoot 'src'))) { Stop-Install 'Unexpected source bundle layout.' }
    Remove-Item -LiteralPath (Join-Path $stage 'resources\default_app.asar') -Force -ErrorAction SilentlyContinue
    Move-Item -LiteralPath $srcRoot -Destination (Join-Path $stage 'resources\app')
    $exe = Join-Path $stage "$AppName.exe"
    if (Test-Path -LiteralPath (Join-Path $stage 'electron.exe')) { Move-Item -LiteralPath (Join-Path $stage 'electron.exe') -Destination $exe -Force }
    Copy-Item -LiteralPath $setup -Destination (Join-Path $stage 'install.ps1')
    Set-Content -LiteralPath (Join-Path $stage $Marker) -Encoding ASCII -Value @("version=$($m.version)", "electron=$($m.electron)", "arch=$arch", "scope=$Scope", "installed=$((Get-Date).ToUniversalTime().ToString('s'))Z")

    # Icon and version info of the executable (optional: skipped if rcedit cannot be verified)
    try {
      # kept between updates next to the installer copy (checked again by SHA-256 every time)
      $rceditCache = if ($AssembleTo -and $env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'LionOrganizer-Installer\rcedit-x64.exe' } else { '' }
      $rcedit = Join-Path $tmp 'rcedit-x64.exe'
      if ($rceditCache -and (Test-Path -LiteralPath $rceditCache) -and (Get-Sha256 $rceditCache) -eq $RceditSha256) { Copy-Item -LiteralPath $rceditCache -Destination $rcedit }
      else { Get-Download $RceditUrl $rcedit }
      if ((Get-Sha256 $rcedit) -ne $RceditSha256) { throw 'rcedit checksum mismatch' }
      if ($rceditCache -and -not (Test-Path -LiteralPath $rceditCache)) {
        try { New-Item -ItemType Directory -Path (Split-Path $rceditCache -Parent) -Force | Out-Null; Copy-Item -LiteralPath $rcedit -Destination $rceditCache } catch { Write-Verbose 'rcedit not cached' }
      }
      $ico = Join-Path $stage 'resources\app\build\icon.ico'
      & $rcedit $exe --set-icon $ico --set-file-version $m.version --set-product-version $m.version `
        --set-version-string ProductName $AppName --set-version-string FileDescription $AppName `
        --set-version-string CompanyName $Publisher --set-version-string LegalCopyright "Copyright (C) 2026 $Publisher" `
        --set-version-string OriginalFilename "$AppName.exe" --set-version-string InternalName $AppName
      if ($LASTEXITCODE -ne 0) { throw "rcedit exit code $LASTEXITCODE" }
      Write-Ok 'App icon and version info applied'
    } catch { Write-Note "Keeping the default executable icon ($($_.Exception.Message))." }

    if ($AssembleTo) {
      # Graphical installer: hand the assembled app over; Inno Setup installs it, adds the shortcuts and
      # the entry in Settings > Apps.
      Remove-Item -LiteralPath (Join-Path $stage 'install.ps1') -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath $AssembleTo -Recurse -Force -ErrorAction SilentlyContinue
      $parent = Split-Path $AssembleTo -Parent
      if ($parent -and -not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
      Move-Item -LiteralPath $stage -Destination $AssembleTo
      Write-Ok "Assembled in $AssembleTo"
      Save-NewSetup $base $sums $tmp
      Send-Line '@@DONE'
      return
    }

    Write-Step "Installing to $($loc.Dir)"
    Stop-RunningApp $loc.Dir
    $parent = Split-Path $loc.Dir -Parent
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
    $old = "$($loc.Dir).old"
    Remove-Item -LiteralPath $old -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $loc.Dir) { Move-Item -LiteralPath $loc.Dir -Destination $old }
    try { Move-Item -LiteralPath $stage -Destination $loc.Dir }
    catch { if (Test-Path -LiteralPath $old) { Move-Item -LiteralPath $old -Destination $loc.Dir }; throw }
    Remove-Item -LiteralPath $old -Recurse -Force -ErrorAction SilentlyContinue
    $exe = Join-Path $loc.Dir "$AppName.exe"

    New-Shortcut (Join-Path $loc.StartMenu "$AppName.lnk") $exe $loc.Dir
    if (-not $NoDesktopShortcut) { New-Shortcut (Join-Path $loc.Desktop "$AppName.lnk") $exe $loc.Dir }
    Write-Ok 'Start menu and desktop shortcuts'

    # Entry in Settings > Apps (Add or remove programs), like any Windows installer
    $sizeKb = [int]((Get-ChildItem -LiteralPath $loc.Dir -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1KB)
    $uninstall = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $loc.Dir 'install.ps1')`" -Uninstall -Scope $Scope"
    New-Item -Path $loc.RegKey -Force | Out-Null
    $props = @{
      DisplayName = $AppName; DisplayVersion = $m.version; Publisher = $Publisher
      DisplayIcon = "$exe,0"; InstallLocation = $loc.Dir; UninstallString = $uninstall
      QuietUninstallString = "$uninstall -Yes"; URLInfoAbout = "https://github.com/$Repo"; Comments = 'Disk space analysis & cleanup'
    }
    foreach ($k in $props.Keys) { New-ItemProperty -Path $loc.RegKey -Name $k -Value $props[$k] -PropertyType String -Force | Out-Null }
    foreach ($k in 'NoModify', 'NoRepair') { New-ItemProperty -Path $loc.RegKey -Name $k -Value 1 -PropertyType DWord -Force | Out-Null }
    New-ItemProperty -Path $loc.RegKey -Name EstimatedSize -Value $sizeKb -PropertyType DWord -Force | Out-Null
    Write-Ok 'Registered in Settings > Apps'

    Write-Host ''
    Write-Host "$AppName $($m.version) installed. Run this installer again at any time to update." -ForegroundColor Green
  } finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# Dot-sourcing (". .\install.ps1") only loads the functions - used by the test suite.
if ($MyInvocation.InvocationName -ne '.') {
  if ($AssembleTo) {
    $code = 0
    try { Invoke-Install }
    catch {
      Send-Line ('@@ERROR|' + ($_.Exception.Message -replace '^LionOrganizer installer: ', '' -replace '[\r\n]+', ' '))
      $code = 1
    }
    Send-Line "@@EXIT|$code"
    exit $code
  } elseif ($Uninstall) { Invoke-Uninstall } else { Invoke-Install }
}
