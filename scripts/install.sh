#!/usr/bin/env bash
#---------------------------------------------------------------------------------------------
#  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
#  Created and conceived by Daniel Michelon De Carli.
#  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
#---------------------------------------------------------------------------------------------
#
# LionOrganizer installer for macOS and Linux (lightweight bootstrapper).
#
# It always installs the LATEST release published on GitHub (or the one given with --version):
#   1. reads manifest.txt from the release and verifies it against SHA256SUMS;
#   2. downloads the app source bundle (a few MB) and verifies its SHA-256
#      (and its build provenance with `gh attestation verify`, when the GitHub CLI is available);
#   3. downloads the matching Electron runtime from Electron's official GitHub releases and
#      verifies it against Electron's SHASUMS256.txt;
#   4. assembles the app and integrates it with the system, the way VS Code does:
#        macOS → /Applications/LionOrganizer.app (or ~/Applications)
#        Linux → /opt/lionorganizer + /usr/bin/lionorganizer + menu entry + icons
#                (or ~/.local with --user), installing runtime libraries with the
#                distribution's package manager (apt, dnf/yum, zypper, pacman).
# Run it again at any time to update. Nothing is installed if any check fails.
#
# Usage: bash install.sh [--user | --system] [--version X.Y.Z] [--require-attestation]
#                        [--no-deps] [--force] [--yes] [--uninstall [--purge]] [--help]

set -euo pipefail
umask 022

REPO="${LIONORGANIZER_REPO:-danielcarli/lionorganizer}"
RELEASES_URL="${LIONORGANIZER_RELEASES_URL:-https://github.com/${REPO}/releases}"
ELECTRON_MIRROR="${LIONORGANIZER_ELECTRON_MIRROR:-https://github.com/electron/electron/releases/download}"
APP_NAME="LionOrganizer"
APP_ID="lionorganizer"
BUNDLE_ID="br.dmdc.lionorganizer"
MARKER="lionorganizer-install.txt"

SCOPE=""            # user | system (default: see resolve_scope)
WANT_VERSION=""
REQUIRE_ATTESTATION=0
INSTALL_DEPS=1
FORCE=0
ASSUME_YES=0
ACTION="install"
PURGE=0

# ------------------------------------------------------------------------------- output helpers
if [ -t 1 ]; then B=$'\033[1m'; D=$'\033[2m'; R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; N=$'\033[0m'; else B=; D=; R=; G=; Y=; N=; fi
say()  { printf '%s\n' "${B}==>${N} $*"; }
ok()   { printf '%s\n' "  ${G}✓${N} $*"; }
warn() { printf '%s\n' "  ${Y}!${N} $*" >&2; }
die()  { printf '%s\n' "${R}✗ $*${N}" >&2; exit 1; }

usage() {
  cat <<'EOF'
LionOrganizer installer for macOS and Linux — installs (or updates to) the latest release from GitHub,
verifying every download (SHA-256, Electron checksums and, with the GitHub CLI, build provenance).

Usage: bash install.sh [options]

Options:
  --user                 install only for the current user, no administrator rights
                         (default on Linux when not run as root)
  --system               install for all users (uses sudo; default as root, on macOS when
                         /Applications is writable, and on Linux systems that restrict
                         unprivileged user namespaces, e.g. Ubuntu 24.04+)
  --version X.Y.Z        install a specific release instead of the latest one
  --require-attestation  refuse to install unless the GitHub CLI verifies the build provenance
  --no-deps              Linux: do not install runtime libraries with the package manager
  --force                reinstall even if the same version is already installed
  --yes                  do not ask for confirmation
  --uninstall [--purge]  remove LionOrganizer (--purge also removes settings and the catalog)
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --user) SCOPE="user" ;;
    --system) SCOPE="system" ;;
    --version) shift; WANT_VERSION="${1:-}"; WANT_VERSION="${WANT_VERSION#v}" ;;
    --version=*) WANT_VERSION="${1#*=}"; WANT_VERSION="${WANT_VERSION#v}" ;;
    --require-attestation) REQUIRE_ATTESTATION=1 ;;
    --no-deps) INSTALL_DEPS=0 ;;
    --force) FORCE=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    --uninstall) ACTION="uninstall" ;;
    --purge) PURGE=1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1 (see --help)" ;;
  esac
  shift
done

VERSION_RE='^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$'
FILE_RE='^[A-Za-z0-9._-]+$'
if [ -n "$WANT_VERSION" ] && ! [[ "$WANT_VERSION" =~ $VERSION_RE ]]; then die "Invalid version: $WANT_VERSION"; fi

# ------------------------------------------------------------------------------- platform
OS="$(uname -s)"
case "$OS" in
  Darwin) PLATFORM="darwin" ;;
  Linux) PLATFORM="linux" ;;
  *) die "Unsupported system: $OS. On Windows, use install.ps1." ;;
esac
case "$(uname -m)" in
  x86_64|amd64) ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *) die "Unsupported processor: $(uname -m)" ;;
esac
# A shell running under Rosetta reports x86_64 on Apple Silicon: install the native build.
if [ "$PLATFORM" = darwin ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then ARCH="arm64"; fi

SUDO=""
if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then SUDO="sudo"; fi
can_elevate() { [ "$(id -u)" -eq 0 ] || [ -n "$SUDO" ]; }
as_root() { if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi; }

# ------------------------------------------------------------------------------- install locations
resolve_scope() {
  if [ -z "$SCOPE" ] && [ "$ACTION" = uninstall ]; then
    # Remove whichever install exists, the user's own first.
    if [ "$PLATFORM" = darwin ]; then
      if [ -d "${HOME}/Applications/${APP_NAME}.app" ]; then SCOPE=user; else SCOPE=system; fi
    else
      if [ -e "${XDG_DATA_HOME:-$HOME/.local/share}/${APP_ID}/${MARKER}" ]; then SCOPE=user; else SCOPE=system; fi
    fi
  fi
  if [ -z "$SCOPE" ]; then
    if [ "$PLATFORM" = darwin ]; then
      if [ -w /Applications ]; then SCOPE=system; else SCOPE=user; fi
    elif [ "$(id -u)" -eq 0 ]; then
      SCOPE=system
    elif userns_restricted && can_elevate; then
      # e.g. Ubuntu 24.04+: Chromium's sandbox needs the root-owned helper of a system install.
      SCOPE=system
    else
      SCOPE=user   # least privilege: no administrator rights needed
    fi
  fi
  if [ "$PLATFORM" = darwin ]; then
    if [ "$SCOPE" = system ]; then APP_DIR="/Applications/${APP_NAME}.app"; else APP_DIR="${HOME}/Applications/${APP_NAME}.app"; fi
    DATA_DIR="${HOME}/Library/Application Support/${APP_NAME}"
  else
    if [ "$SCOPE" = system ]; then
      PREFIX="/opt/${APP_ID}"; BIN_LINK="/usr/bin/${APP_ID}"
      SHARE="/usr/share"
    else
      PREFIX="${XDG_DATA_HOME:-$HOME/.local/share}/${APP_ID}"; BIN_LINK="${HOME}/.local/bin/${APP_ID}"
      SHARE="${XDG_DATA_HOME:-$HOME/.local/share}"
    fi
    DESKTOP_FILE="${SHARE}/applications/${APP_ID}.desktop"
    ICON_DIR="${SHARE}/icons/hicolor"
    DATA_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/${APP_NAME}"
  fi
  if [ "$SCOPE" = system ] && [ "$PLATFORM" = linux ] && ! can_elevate; then
    die "A system-wide install needs root or sudo. Run as administrator or use --user."
  fi
}

# runs a command with root rights only when installing for all users
priv() { if [ "$SCOPE" = system ] && [ "$PLATFORM" = linux ]; then as_root "$@"; else "$@"; fi; }

# ------------------------------------------------------------------------------- downloads & checks
TMP=""
cleanup() { if [ -n "$TMP" ]; then rm -rf "$TMP"; fi; }
trap cleanup EXIT INT TERM

need() { command -v "$1" >/dev/null 2>&1 || die "Required tool not found: $1"; }

fetch() { # fetch URL OUTPUT — HTTPS only (TLS 1.2+), fails on HTTP errors
  local url="$1" out="$2"
  case "$url" in
    https://*) ;;
    http://127.0.0.1:*|http://localhost:*) [ "${LIONORGANIZER_ALLOW_INSECURE_FOR_TESTS:-0}" = 1 ] || die "Refusing insecure URL: $url" ;;
    *) die "Refusing insecure URL: $url" ;;
  esac
  local proto='=https'; [ "${LIONORGANIZER_ALLOW_INSECURE_FOR_TESTS:-0}" = 1 ] && proto='=https,http'
  if command -v curl >/dev/null 2>&1; then
    curl --proto "$proto" --proto-redir "$proto" --tlsv1.2 -fsSL --retry 3 --connect-timeout 20 -o "$out" "$url" || die "Download failed: $url"
  elif command -v wget >/dev/null 2>&1; then
    wget --https-only -q -O "$out" "$url" 2>/dev/null || wget -q -O "$out" "$url" || die "Download failed: $url"
  else
    die "curl or wget is required."
  fi
}

sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi; }

verify_sum() { # verify_sum FILE SUMS_FILE [NAME]
  local file="$1" sums="$2" name="${3:-$(basename "$1")}" expected actual
  expected="$(awk -v n="$name" '{f=$2; sub(/^\*/, "", f); if (f == n) {print tolower($1); exit}}' "$sums")"
  [[ "$expected" =~ ^[0-9a-f]{64}$ ]] || die "No checksum published for $name — refusing to install."
  actual="$(sha256 "$file")"
  [ "$actual" = "$expected" ] || die "Checksum mismatch for $name (expected $expected, got $actual). The download may be corrupted or tampered with. Nothing was installed."
  ok "SHA-256 verified: $name"
}

ATTEST_NOTE=0
verify_attestation() { # verify_attestation FILE
  # Local test releases have no GitHub attestation; the checksums are still verified.
  if [ "${LIONORGANIZER_ALLOW_INSECURE_FOR_TESTS:-0}" = 1 ] && [ "$REQUIRE_ATTESTATION" = 0 ]; then
    [ "$ATTEST_NOTE" = 0 ] && warn "Test mode: skipping the provenance check." && ATTEST_NOTE=1
    return 0
  fi
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    # gh is installed and logged in: a failed verification is a real warning sign, so stop.
    if gh attestation verify "$1" --repo "$REPO" >/dev/null 2>&1; then ok "Build provenance verified by GitHub: $(basename "$1")"; return 0; fi
    die "Build provenance could not be verified for $(basename "$1"). Nothing was installed."
  fi
  [ "$REQUIRE_ATTESTATION" = 1 ] && die "--require-attestation needs the GitHub CLI (gh) installed and logged in: https://cli.github.com"
  if [ "$ATTEST_NOTE" = 0 ]; then warn "GitHub CLI not available or not logged in: skipping the provenance check (checksums are still verified)."; ATTEST_NOTE=1; fi
  return 0
}

read_manifest() { # read_manifest FILE → sets M_VERSION M_ELECTRON M_TAR
  M_VERSION=""; M_ELECTRON=""; M_TAR=""
  local key value
  while IFS='=' read -r key value || [ -n "$key" ]; do
    value="${value%$'\r'}"
    case "$key" in
      version) M_VERSION="$value" ;;
      electron) M_ELECTRON="$value" ;;
      source_tar) M_TAR="$value" ;;
    esac
  done < "$1"
  [[ "$M_VERSION" =~ $VERSION_RE ]] || die "Invalid release manifest (version)."
  [[ "$M_ELECTRON" =~ $VERSION_RE ]] || die "Invalid release manifest (electron)."
  [[ "$M_TAR" =~ $FILE_RE ]] || die "Invalid release manifest (source)."
}

installed_version() {
  local f
  if [ "$PLATFORM" = darwin ]; then f="${APP_DIR}/Contents/Resources/${MARKER}"; else f="${PREFIX}/${MARKER}"; fi
  [ -f "$f" ] && sed -n 's/^version=//p' "$f" | head -1 || true
}

confirm() {
  [ "$ASSUME_YES" = 1 ] && return 0
  local answer=""
  if [ -r /dev/tty ]; then
    printf '%s' "$1 [Y/n] " > /dev/tty
    read -r answer < /dev/tty || true
  else
    return 0
  fi
  case "$answer" in ""|y|Y|yes|s|S|sim) return 0 ;; *) die "Cancelled." ;; esac
}

# ------------------------------------------------------------------------------- Linux libraries
os_release() { [ -r /etc/os-release ] && . /etc/os-release && printf '%s %s' "${ID:-}" "${ID_LIKE:-}"; }

apt_pick() { # first candidate that the archive can install
  local p
  for p in "$@"; do
    if apt-cache policy "$p" 2>/dev/null | grep -q 'Candidate: [0-9]'; then printf '%s ' "$p"; return; fi
  done
}

install_linux_deps() {
  [ "$INSTALL_DEPS" = 1 ] || { warn "Skipping runtime libraries (--no-deps)."; return; }
  if ! can_elevate; then warn "No sudo: cannot install runtime libraries. If the app does not start, ask an administrator."; return; fi
  local ids; ids=" $(os_release) "
  say "Installing missing runtime libraries with the system package manager"
  if ! install_linux_deps_for "$ids"; then
    warn "Could not install the runtime libraries automatically. If the app does not start, install GTK 3, NSS, libgbm and ALSA with your package manager."
    return 0
  fi
  ok "Runtime libraries ready"
}

install_linux_deps_for() {
  case "$1" in
    *" debian "*|*" ubuntu "*|*" linuxmint "*|*" pop "*|*" elementary "*|*" zorin "*|*" kali "*|*" raspbian "*)
      as_root apt-get update -qq || return 1
      # shellcheck disable=SC2046
      as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends $(
        apt_pick libgtk-3-0t64 libgtk-3-0; apt_pick libnss3; apt_pick libgbm1; apt_pick libasound2t64 libasound2
        apt_pick libxss1; apt_pick libxtst6; apt_pick libatspi2.0-0t64 libatspi2.0-0; apt_pick libnotify4
        apt_pick libuuid1; apt_pick xdg-utils; apt_pick unzip) >/dev/null ;;
    *" fedora "*|*" rhel "*|*" centos "*|*" rocky "*|*" almalinux "*|*" ol "*|*" amzn "*)
      local pm=dnf; command -v dnf >/dev/null 2>&1 || pm=yum
      as_root "$pm" install -y -q gtk3 nss mesa-libgbm alsa-lib libXScrnSaver libXtst at-spi2-core libnotify libuuid xdg-utils unzip >/dev/null ;;
    *" opensuse"*|*" suse "*|*" sles "*)
      as_root zypper --non-interactive --quiet install --no-recommends libgtk-3-0 mozilla-nss libgbm1 alsa libXss1 libXtst6 at-spi2-core libnotify4 libuuid1 xdg-utils unzip >/dev/null ;;
    *" arch "*|*" manjaro "*|*" endeavouros "*|*" garuda "*|*" artix "*)
      as_root pacman -S --needed --noconfirm --quiet gtk3 nss mesa alsa-lib libxss libxtst at-spi2-core libnotify util-linux-libs xdg-utils unzip >/dev/null ;;
    *)
      warn "Unknown distribution ($1)."
      return 1 ;;
  esac
}

unzip_to() { # unzip_to ZIP DIR (keeps symlinks and permissions)
  if [ "$PLATFORM" = darwin ]; then ditto -x -k "$1" "$2"; return; fi
  if command -v unzip >/dev/null 2>&1; then unzip -q "$1" -d "$2"
  elif command -v bsdtar >/dev/null 2>&1; then bsdtar -xf "$1" -C "$2"
  else die "unzip is required (install it with your package manager)."; fi
}

missing_libs() { ldd "$1" 2>/dev/null | awk '/not found/ {print $1}' | tr '\n' ' '; }

userns_restricted() {
  [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)" = 1 ] && return 0
  [ "$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null || echo 1)" = 0 ] && return 0
  return 1
}

# ------------------------------------------------------------------------------- uninstall
uninstall() {
  resolve_scope
  say "Removing ${APP_NAME} (${SCOPE})"
  if [ "$PLATFORM" = darwin ]; then
    if [ -d "$APP_DIR" ]; then
      if [ -w "$(dirname "$APP_DIR")" ]; then rm -rf "$APP_DIR"; else as_root rm -rf "$APP_DIR"; fi
      ok "Removed $APP_DIR"
    else warn "Not installed in $APP_DIR"; fi
  else
    [ -e "$PREFIX" ] || [ -L "$BIN_LINK" ] || warn "Not installed in $PREFIX"
    priv rm -rf "$PREFIX" "$BIN_LINK" "$DESKTOP_FILE"
    priv find "$ICON_DIR" -name "${APP_ID}.png" -path '*/apps/*' -delete 2>/dev/null || true
    command -v update-desktop-database >/dev/null 2>&1 && priv update-desktop-database -q "$(dirname "$DESKTOP_FILE")" 2>/dev/null || true
    ok "Removed $PREFIX"
  fi
  if [ "$PURGE" = 1 ]; then rm -rf "$DATA_DIR"; ok "Removed settings and catalog ($DATA_DIR)"; else printf '  %s\n' "${D}Settings and catalog kept in $DATA_DIR (use --purge to remove them).${N}"; fi
}

# ------------------------------------------------------------------------------- install
do_install() {
  need tar; need awk
  resolve_scope
  TMP="$(mktemp -d "${TMPDIR:-/tmp}/lionorganizer.XXXXXX")"

  say "Looking for the ${WANT_VERSION:+requested}${WANT_VERSION:-latest} ${APP_NAME} release"
  local base
  if [ -n "$WANT_VERSION" ]; then base="${RELEASES_URL}/download/v${WANT_VERSION}"; else base="${RELEASES_URL}/latest/download"; fi
  fetch "${base}/manifest.txt" "$TMP/manifest.txt"
  read_manifest "$TMP/manifest.txt"
  base="${RELEASES_URL}/download/v${M_VERSION}"  # pin every other file to that exact release
  fetch "${base}/SHA256SUMS" "$TMP/SHA256SUMS"
  verify_sum "$TMP/manifest.txt" "$TMP/SHA256SUMS" manifest.txt
  ok "Release ${M_VERSION} (Electron ${M_ELECTRON})"

  if [ "$PLATFORM" = linux ] && [ "$FORCE" = 0 ]; then
    # Installed from the .deb/.rpm package: update it with the package, not with a second copy.
    if { command -v dpkg-query >/dev/null 2>&1 && dpkg-query -W -f='${Status}' "$APP_ID" 2>/dev/null | grep -q 'ok installed'; } ||
       { command -v rpm >/dev/null 2>&1 && rpm -q "$APP_ID" >/dev/null 2>&1; }; then
      die "${APP_NAME} is installed from a .deb/.rpm package. Update it by installing the newer package from ${RELEASES_URL}/latest (or use --force to install a separate copy)."
    fi
  fi

  local current; current="$(installed_version)"
  if [ "$current" = "$M_VERSION" ] && [ "$FORCE" = 0 ]; then ok "${APP_NAME} ${M_VERSION} is already installed and up to date."; return; fi

  local where; if [ "$PLATFORM" = darwin ]; then where="$APP_DIR"; else where="$PREFIX"; fi
  printf '\n  %-12s %s\n  %-12s %s\n  %-12s %s\n\n' "Version:" "${M_VERSION}${current:+ (installed: $current)}" "Location:" "$where" "System:" "${PLATFORM}-${ARCH}, ${SCOPE} install"
  confirm "Install ${APP_NAME} ${M_VERSION}?"

  say "Downloading ${APP_NAME} ${M_VERSION}"
  fetch "${base}/${M_TAR}" "$TMP/${M_TAR}"
  verify_sum "$TMP/${M_TAR}" "$TMP/SHA256SUMS" "$M_TAR"
  verify_attestation "$TMP/${M_TAR}"

  local ezip="electron-v${M_ELECTRON}-${PLATFORM}-${ARCH}.zip"
  say "Downloading the Electron ${M_ELECTRON} runtime (${PLATFORM}-${ARCH})"
  fetch "${ELECTRON_MIRROR}/v${M_ELECTRON}/SHASUMS256.txt" "$TMP/ELECTRON-SHASUMS256.txt"
  fetch "${ELECTRON_MIRROR}/v${M_ELECTRON}/${ezip}" "$TMP/${ezip}"
  verify_sum "$TMP/${ezip}" "$TMP/ELECTRON-SHASUMS256.txt" "$ezip"

  say "Assembling the application"
  mkdir -p "$TMP/src" "$TMP/runtime"
  tar -xzf "$TMP/${M_TAR}" -C "$TMP/src" --strip-components=1
  [ -f "$TMP/src/package.json" ] && [ -d "$TMP/src/src" ] || die "Unexpected source bundle layout."
  if [ "$PLATFORM" = linux ] && ! command -v unzip >/dev/null 2>&1 && ! command -v bsdtar >/dev/null 2>&1; then install_linux_deps; fi
  unzip_to "$TMP/${ezip}" "$TMP/runtime"
  if [ "$PLATFORM" = linux ]; then
    # Only call the package manager (and sudo) when the runtime really lacks a system library.
    if [ -n "$(missing_libs "$TMP/runtime/electron")" ]; then install_linux_deps; else ok "System libraries already present"; fi
  fi
  printf 'version=%s\nelectron=%s\nscope=%s\ninstalled=%s\n' "$M_VERSION" "$M_ELECTRON" "$SCOPE" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$TMP/${MARKER}"

  if [ "$PLATFORM" = darwin ]; then install_macos; else install_linux; fi
  printf '\n%s\n' "${G}${B}${APP_NAME} ${M_VERSION} installed.${N} Run this installer again at any time to update."
}

install_macos() {
  local app="$TMP/runtime/Electron.app" res
  [ -d "$app" ] || die "Unexpected Electron archive layout."
  res="$app/Contents/Resources"
  rm -f "$res/default_app.asar"
  mkdir -p "$res/app"
  (cd "$TMP/src" && tar -cf - .) | (cd "$res/app" && tar -xf -)
  cp "$TMP/${MARKER}" "$res/${MARKER}"
  # App icon from the bundled PNGs (iconutil is part of macOS)
  local set="$TMP/icon.iconset" icons="$TMP/src/build/icons"
  if [ -d "$icons" ] && command -v iconutil >/dev/null 2>&1; then
    mkdir -p "$set"
    for s in 16 32 128 256 512; do
      cp "$icons/${s}x${s}.png" "$set/icon_${s}x${s}.png"
      cp "$icons/$((s * 2))x$((s * 2)).png" "$set/icon_${s}x${s}@2x.png"
    done
    iconutil -c icns "$set" -o "$res/electron.icns" && ok "App icon applied"
  fi
  local plist="$app/Contents/Info.plist"
  plutil -replace CFBundleName -string "$APP_NAME" "$plist"
  plutil -replace CFBundleDisplayName -string "$APP_NAME" "$plist"
  plutil -replace CFBundleIdentifier -string "$BUNDLE_ID" "$plist"
  plutil -replace CFBundleShortVersionString -string "$M_VERSION" "$plist"
  plutil -replace CFBundleVersion -string "$M_VERSION" "$plist"
  # Keep the helper apps' IDs consistent with the main bundle, as Electron does (<id>.helper).
  local helper
  for helper in "$app/Contents/Frameworks/"*Helper*.app; do
    if [ -f "$helper/Contents/Info.plist" ]; then plutil -replace CFBundleIdentifier -string "${BUNDLE_ID}.helper" "$helper/Contents/Info.plist"; fi
  done
  # The bundle changed, so it must be signed again (ad-hoc) for macOS to run it — required on Apple Silicon.
  codesign --force --deep --sign - "$app" >/dev/null 2>&1 || die "codesign failed."
  ok "Signed (ad-hoc)"

  local dest_parent; dest_parent="$(dirname "$APP_DIR")"
  local run=""; if [ ! -w "$dest_parent" ] && [ -d "$dest_parent" ]; then run="as_root"; fi
  mkdir -p "$dest_parent" 2>/dev/null || as_root mkdir -p "$dest_parent"
  # Atomic replace: the old version stays until the new one is fully copied
  local next="${dest_parent}/.${APP_NAME}.app.new" prev="${dest_parent}/.${APP_NAME}.app.old"
  $run rm -rf "$next" "$prev"
  $run ditto "$app" "$next"
  if [ -d "$APP_DIR" ]; then $run mv "$APP_DIR" "$prev"; fi
  $run mv "$next" "$APP_DIR"
  $run rm -rf "$prev"
  ok "Installed in $APP_DIR"
}

install_linux() {
  local stage="$TMP/runtime"
  rm -f "$stage/resources/default_app.asar"
  mkdir -p "$stage/resources/app"
  (cd "$TMP/src" && tar -cf - .) | (cd "$stage/resources/app" && tar -xf -)
  mv "$stage/electron" "$stage/${APP_ID}"
  cp "$TMP/${MARKER}" "$stage/${MARKER}"

  # Desktop entry, like the one VS Code installs
  cat > "$TMP/${APP_ID}.desktop" <<EOF
[Desktop Entry]
Name=${APP_NAME}
GenericName=Disk Space Analyzer
Comment=Disk space analysis & cleanup
Exec=${BIN_LINK} %U
Icon=${APP_ID}
Type=Application
Terminal=false
Categories=Utility;System;FileTools;
Keywords=disk;space;usage;duplicates;cleanup;organize;
StartupWMClass=${APP_NAME}
EOF

  # Atomic replace: the old version stays until the new one is fully in place
  priv mkdir -p "$(dirname "$PREFIX")" "$(dirname "$BIN_LINK")" "$(dirname "$DESKTOP_FILE")"
  priv rm -rf "${PREFIX}.new"
  priv cp -a "$stage" "${PREFIX}.new"
  if [ "$SCOPE" = system ]; then
    as_root chown -R root:root "${PREFIX}.new"
    # Chromium's setuid sandbox helper (same as the official .deb/.rpm packages of Electron apps)
    as_root chmod 4755 "${PREFIX}.new/chrome-sandbox"
  elif userns_restricted; then
    warn "This system restricts unprivileged user namespaces (e.g. Ubuntu 24.04+): the app sandbox needs a system-wide install (--system)."
  fi
  if [ -e "$PREFIX" ]; then priv rm -rf "${PREFIX}.old"; priv mv "$PREFIX" "${PREFIX}.old"; fi
  priv mv "${PREFIX}.new" "$PREFIX"
  priv rm -rf "${PREFIX}.old"
  priv ln -sfn "${PREFIX}/${APP_ID}" "$BIN_LINK"
  priv install -m 644 "$TMP/${APP_ID}.desktop" "$DESKTOP_FILE"
  local s
  for s in 16 24 32 48 64 128 256 512; do
    [ -f "$TMP/src/build/icons/${s}x${s}.png" ] || continue
    priv install -D -m 644 "$TMP/src/build/icons/${s}x${s}.png" "${ICON_DIR}/${s}x${s}/apps/${APP_ID}.png"
  done
  command -v update-desktop-database >/dev/null 2>&1 && priv update-desktop-database -q "$(dirname "$DESKTOP_FILE")" 2>/dev/null || true
  command -v gtk-update-icon-cache >/dev/null 2>&1 && priv gtk-update-icon-cache -q -t "$ICON_DIR" 2>/dev/null || true
  ok "Installed in $PREFIX (command: ${APP_ID})"

  local missing; missing="$(missing_libs "${PREFIX}/${APP_ID}")"
  [ -z "$missing" ] || warn "Missing system libraries: ${missing}— install them with your package manager."
  if [ "$SCOPE" = user ]; then
    case ":$PATH:" in *":$(dirname "$BIN_LINK"):"*) ;; *) warn "Add $(dirname "$BIN_LINK") to your PATH to start it from a terminal." ;; esac
  fi
}

if [ "$ACTION" = uninstall ]; then uninstall; else do_install; fi
