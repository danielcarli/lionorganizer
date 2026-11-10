# Installing LionOrganizer

LionOrganizer installs with a small script, a few dozen KB. The script downloads the **latest release**
from GitHub, checks every file, and installs the app where your operating system expects it,
following the same layout as Visual Studio Code. Run it again at any time to update.

| System | Installs to | Also creates |
|---|---|---|
| **Windows 10/11** (x64, arm64) | `%LOCALAPPDATA%\Programs\LionOrganizer` (just for you, no admin)<br>or `%ProgramFiles%\LionOrganizer` with `-Scope Machine` | Start menu and desktop shortcuts, an entry in **Settings › Apps** (uninstall from there) |
| **macOS 11+** (Apple Silicon, Intel) | `/Applications/LionOrganizer.app`<br>or `~/Applications` if `/Applications` is not writable | Launchpad / Spotlight entry |
| **Linux** (x64, arm64) | `~/.local/share/lionorganizer` (just for you)<br>or `/opt/lionorganizer` with `--system` | `lionorganizer` command, menu entry (`.desktop`), icons |

## Install or update

### Windows

Open **PowerShell** (no need to run as administrator) and run:

```powershell
irm https://github.com/danielcarli/lionorganizer/releases/latest/download/install.ps1 | iex
```

Or download **`install.cmd`** from the [latest release](https://github.com/danielcarli/lionorganizer/releases/latest)
and double-click it.

To pass options, such as installing for all users from an elevated PowerShell:

```powershell
& ([scriptblock]::Create((irm https://github.com/danielcarli/lionorganizer/releases/latest/download/install.ps1))) -Scope Machine
```

### macOS and Linux

```bash
curl -fsSL https://github.com/danielcarli/lionorganizer/releases/latest/download/install.sh | bash
```

To pass options: `… | bash -s -- --system`

### Prefer to read the script first?

That is good practice for any `curl | bash` or `irm | iex` install. Download the script, read it, check it,
then run it:

```bash
curl -fsSLO https://github.com/danielcarli/lionorganizer/releases/latest/download/install.sh
curl -fsSLO https://github.com/danielcarli/lionorganizer/releases/latest/download/SHA256SUMS
sha256sum --ignore-missing -c SHA256SUMS      # macOS: shasum -a 256 --ignore-missing -c SHA256SUMS
gh attestation verify install.sh --repo danielcarli/lionorganizer   # optional, needs the GitHub CLI
less install.sh
bash install.sh
```

## Options

| `install.sh` (macOS, Linux) | `install.ps1` (Windows) | What it does |
|---|---|---|
| `--user` | `-Scope User` | Install just for the current user, with no administrator rights. Default on Windows, and on Linux when not run as root. |
| `--system` | `-Scope Machine` | Install for every user (uses `sudo` / an elevated PowerShell). Default as root, and on macOS when `/Applications` is writable. |
| `--version 1.2.3` | `-Version 1.2.3` | Install a specific release instead of the latest one. |
| `--require-attestation` | `-RequireAttestation` | Refuse to install unless the GitHub CLI verifies the build provenance (see below). |
| `--force` | `-Force` | Reinstall even when the same version is already installed. |
| `--yes` | `-Yes` | Don't ask for confirmation. |
| `--no-deps` | — | Linux: never call the package manager. |
| — | `-NoDesktopShortcut` | Don't create the desktop shortcut. |
| `--uninstall [--purge]` | `-Uninstall [-Purge]` | Remove the app. `--purge` also removes your settings and the catalog. |

## Linux distributions

The app is self-contained, but Electron needs a few desktop libraries (GTK 3, NSS, libgbm, ALSA…). After
unpacking, the installer checks the binary with `ldd`. It calls the package manager, asking for `sudo`,
**only if something is missing**:

| Family | Distributions | Package manager |
|---|---|---|
| Debian | Debian, Ubuntu, Linux Mint, Pop!_OS, elementary OS, Zorin OS, Kali, Raspberry Pi OS | `apt` (handles the `t64` package names of Ubuntu 24.04+ / Debian 13) |
| Red Hat | Fedora, RHEL, CentOS Stream, Rocky Linux, AlmaLinux, Oracle Linux, Amazon Linux | `dnf` / `yum` |
| SUSE | openSUSE Leap and Tumbleweed, SLES | `zypper` |
| Arch | Arch Linux, Manjaro, EndeavourOS, Garuda, Artix | `pacman` |

On other distributions the installer still installs the app and tells you which libraries are missing.

**Ubuntu 24.04+ and the sandbox.** Recent Ubuntu releases restrict unprivileged user namespaces, which
Chromium's sandbox needs. On those systems the installer defaults to a system install (`/opt`), which
includes the root-owned `chrome-sandbox` helper, the same way the official `.deb` packages of Electron apps
work. The app never runs with the sandbox turned off.

## How it stays safe

- **HTTPS only (TLS 1.2+)**, including redirects. Plain HTTP is refused.
- **One exact release.** The script reads `manifest.txt` from the latest release, then downloads every other
  file from that same version (`/releases/download/vX.Y.Z/`), so a release published mid-install can't mix files.
- **Checksums.** `manifest.txt`, the app bundle and the installer itself are checked against the release's
  `SHA256SUMS`. The Electron runtime is downloaded from [Electron's own GitHub releases](https://github.com/electron/electron/releases)
  and checked against Electron's published `SHASUMS256.txt`. Any mismatch stops the install before anything is changed.
- **Build provenance.** The release workflow signs every asset with a
  [GitHub artifact attestation](https://docs.github.com/actions/security-for-github-actions/using-artifact-attestations)
  (Sigstore). Releases are built by GitHub Actions from the tagged commit, not on a personal computer. When the
  [GitHub CLI](https://cli.github.com) is installed and logged in, the installer verifies the attestation
  automatically. With `--require-attestation` it refuses to continue without one.
- **Strict input checks.** Version numbers and file names from the manifest are validated before use.
- **Least privilege.** Per-user install by default. Administrator rights are used only for a system install
  or to add missing Linux libraries.
- **Safe updates.** The new version is assembled in a temporary folder and swapped in at the end. If anything
  fails, the installed version is left untouched. Your settings and catalog are never touched by an update.
- **Pinned tools.** On Windows, the optional icon tool (`rcedit`) is pinned to a known SHA-256 and skipped if
  it doesn't match. GitHub Actions in the workflows are pinned to commit hashes.

### Why the installer downloads instead of bundling

GitHub limits files **in a repository** to 100 MB. Release assets can be up to 2 GB, but there is no need for
large ones. Each release holds only the app source bundle (under 1 MB) and the installer scripts. The Electron
runtime (about 100 MB) comes straight from Electron's releases. So the repository stays small, every install
gets a verified runtime, and an update downloads less than a full packaged installer would.

### Code signing

The executables are not signed with a paid certificate. The app files the installer downloads don't carry the
"downloaded from the internet" mark, so Windows SmartScreen and macOS Gatekeeper don't block the installed app.
`install.cmd` downloaded with a browser does carry it: Windows may show "Windows protected your PC" (choose
**More info › Run anyway**), which is why the PowerShell one-liner is the recommended route. On macOS the app is
re-signed ad hoc after installation, as Apple Silicon requires.

## Uninstall

- **Windows:** Settings › Apps › LionOrganizer › Uninstall, or `install.ps1 -Uninstall` (the installer keeps a
  copy of itself in the install folder).
- **macOS / Linux:** `curl -fsSL https://github.com/danielcarli/lionorganizer/releases/latest/download/install.sh | bash -s -- --uninstall`

Settings and the catalog are kept unless you add `--purge` / `-Purge`.

## For maintainers: publishing a release

1. Update `version` in `package.json` (and `package-lock.json`) and add a section to `CHANGELOG.md`.
2. Commit, then tag and push: `git tag v1.2.3 && git push origin main v1.2.3`.
3. The **Release** workflow runs the tests, builds the assets with `node tools/make-release.js` (reproducible
   archives), attests them and publishes the GitHub release. The installers pick it up straight away.

Native packages (`.exe`, `.dmg`, `.deb`, `.rpm`, AppImage) can still be built locally with `npm run dist:*`.
