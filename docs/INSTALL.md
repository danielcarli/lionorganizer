# Installing LionOrganizer

Every release on GitHub has **graphical installers** for each system, plus small **command-line installers**
for people who prefer the terminal. Both always install the **latest version**, check every file and put the app
where your operating system expects it, following the same layout as Visual Studio Code.

## Graphical installers (recommended)

Download the file for your system from the **[latest release](https://github.com/danielcarli/lionorganizer/releases/latest)**:

| System | File | How to install |
|---|---|---|
| **Windows 10/11** (x64, ARM) | [`LionOrganizer-Setup.exe`](https://github.com/danielcarli/lionorganizer/releases/latest/download/LionOrganizer-Setup.exe) | Double-click and follow the wizard. |
| **macOS 11+** (Apple Silicon, Intel) | [`LionOrganizer-mac-universal.dmg`](https://github.com/danielcarli/lionorganizer/releases/latest/download/LionOrganizer-mac-universal.dmg) | Open it and drag **LionOrganizer** to **Applications**. |
| **Ubuntu, Debian, Linux Mint, Pop!_OS…** | [`lionorganizer_amd64.deb`](https://github.com/danielcarli/lionorganizer/releases/latest/download/lionorganizer_amd64.deb) | Double-click to open it in the software center, or `sudo apt install ./lionorganizer_amd64.deb`. |
| **Fedora, RHEL, openSUSE…** | [`lionorganizer.x86_64.rpm`](https://github.com/danielcarli/lionorganizer/releases/latest/download/lionorganizer.x86_64.rpm) | Double-click, or `sudo dnf install ./lionorganizer.x86_64.rpm` (`zypper install` on openSUSE). |
| **Any Linux** | [`LionOrganizer-x86_64.AppImage`](https://github.com/danielcarli/lionorganizer/releases/latest/download/LionOrganizer-x86_64.AppImage) | Make it executable (`chmod +x`) and run it. Nothing to install. |

These links always point to the newest version.

### The Windows setup wizard

`LionOrganizer-Setup.exe` is a standard Windows setup wizard (Inno Setup), translated into the app's 10 languages,
and it is only about **2 MB**. It works like the LEBR installer: it doesn't carry the app. During setup it downloads
the latest version from GitHub and checks it, showing each step:

1. finds the latest release and checks its file list (SHA-256);
2. downloads LionOrganizer (under 1 MB) and checks its SHA-256;
3. downloads the official Electron runtime (about 110 MB) from Electron's GitHub releases and checks it against
   the checksums Electron publishes;
4. assembles the app and installs it in `%LOCALAPPDATA%\Programs\LionOrganizer`: just for you, no administrator rights.

If any check fails, nothing is installed and an existing installation stays as it was. The wizard creates Start
menu and desktop shortcuts, an entry in **Settings › Apps** and an **Update LionOrganizer** shortcut, which runs
the wizard again in update mode to fetch the newest version. It takes about a minute.

### Before the first launch: no paid certificate yet

The installers are not signed with a paid code-signing certificate yet, so the first launch needs one extra click.
Every file is still listed in the release's `SHA256SUMS` and has a signed build-provenance attestation (see below).

- **Windows:** "Windows protected your PC" → **More info** → **Run anyway**.
- **macOS:** the app is signed ad hoc, not with an Apple Developer ID. The first time, macOS says it can't verify
  the developer. Open **System Settings › Privacy & Security**, scroll down and click **Open Anyway** next to
  LionOrganizer. You only need to do this once.
- **Linux:** packages don't need this.

## Command-line installers

`install.ps1` (Windows) and `install.sh` (macOS and Linux) do the same downloads and checks as the Windows wizard,
from a terminal. Run them again at any time to update.

| System | Installs to | Also creates |
|---|---|---|
| **Windows 10/11** (x64, arm64) | `%LOCALAPPDATA%\Programs\LionOrganizer` (just for you, no admin)<br>or `%ProgramFiles%\LionOrganizer` with `-Scope Machine` | Start menu and desktop shortcuts, an entry in **Settings › Apps** (uninstall from there) |
| **macOS 11+** (Apple Silicon, Intel) | `/Applications/LionOrganizer.app`<br>or `~/Applications` if `/Applications` is not writable | Launchpad / Spotlight entry |
| **Linux** (x64, arm64) | `~/.local/share/lionorganizer` (just for you)<br>or `/opt/lionorganizer` with `--system` | `lionorganizer` command, menu entry (`.desktop`), icons |

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

### Options

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

### Linux distributions

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

This applies to the Windows wizard (which runs `install.ps1` behind the scenes) and to the command-line installers.
The `.dmg`, `.deb`, `.rpm` and AppImage are complete packages built by GitHub Actions; check them against
`SHA256SUMS` and their attestation as shown in [Prefer to read the script first?](#prefer-to-read-the-script-first).

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
  it doesn't match. The release workflow pins Inno Setup by SHA-256 and every GitHub Action by commit hash.

### Why the Windows installer downloads instead of bundling

GitHub limits files **in a repository** to 100 MB, but nothing large is ever committed: installers are built by
GitHub Actions and attached to releases, where files can be up to 2 GB. The Windows wizard and the scripts stay
tiny anyway: they fetch the app bundle (under 1 MB) from the release and the Electron runtime (about 110 MB) straight
from Electron's releases, so every install gets a verified runtime and always the latest version. The macOS and
Linux packages (100–250 MB) contain everything, because that is how those systems expect apps to be installed.

### Code signing

See [Before the first launch](#before-the-first-launch-no-paid-certificate-yet). Files that the Windows wizard and
the scripts download themselves don't carry the "downloaded from the internet" mark, so only the installer
you download with the browser triggers SmartScreen or Gatekeeper. When the project gets a code-signing certificate,
the Windows wizard is signed by uncommenting `SignTool=` in `installer/lionorganizer.iss`, and the macOS app by
setting a Developer ID in `package.json` (`build.mac.identity`) and turning `hardenedRuntime` back on for notarization.

## Uninstall

- **Windows:** Settings › Apps › LionOrganizer › Uninstall (works for both the wizard and `install.ps1`).
- **macOS:** drag LionOrganizer from Applications to the Trash, or run
  `curl -fsSL https://github.com/danielcarli/lionorganizer/releases/latest/download/install.sh | bash -s -- --uninstall`
  if you installed it with the script.
- **Linux:** remove the package (`sudo apt remove lionorganizer`, `sudo dnf remove lionorganizer`) or, for a script
  install, run the same `install.sh … --uninstall` command. An AppImage is just a file to delete.

Settings and the catalog are kept (`--purge` / `-Purge` also removes them with the scripts).

## For maintainers: publishing a release

1. Update `version` in `package.json` (and `package-lock.json`) and add a section to `CHANGELOG.md`.
2. Commit, then tag and push: `git tag v1.2.3 && git push origin main v1.2.3`.
3. The **Release** workflow:
   - runs the tests;
   - builds the Windows wizard with Inno Setup and tests it end to end on a Windows runner (install, launch, update,
     a tampered download refused, uninstall);
   - builds the `.dmg` on macOS and the `.deb`, `.rpm` and AppImage on Linux (the `.deb` is installed and launched);
   - builds the app bundle with `node tools/make-release.js` (reproducible archives);
   - lists every file in `SHA256SUMS`, attests them and publishes the GitHub release.

To build the Windows wizard locally: install [Inno Setup](https://jrsoftware.org/isinfo.php) 6.5 or newer and run
`iscc /DAppVersion=1.2.3 installer\lionorganizer.iss` (output in `dist-installer\`). Native packages can be built
locally with `npm run dist:*`.
