# Changelog

All notable changes to LionOrganizer are documented here. The project follows [Semantic Versioning](https://semver.org).

## [1.0.1] — 2026-11-09

### Install
- New lightweight installers that download the latest release from GitHub and install it the way VS Code is installed on each system:
  - **Windows:** `install.ps1` (or double-click `install.cmd`) — per-user install in `%LOCALAPPDATA%\Programs` by default, or for all users in `%ProgramFiles%`; Start menu and desktop shortcuts; entry in Settings › Apps.
  - **macOS:** `install.sh` — `/Applications/LionOrganizer.app` (or `~/Applications`), ad-hoc signed for Apple Silicon.
  - **Linux:** `install.sh` — `~/.local/share` per user or `/opt` for all users, `lionorganizer` command, menu entry and icons; installs missing libraries with apt, dnf/yum, zypper or pacman.
- Every download is checked: HTTPS only, SHA-256 for the release files, Electron's own checksums for the runtime, and optional verification of the signed build provenance with the GitHub CLI.
- Updates replace the app atomically and keep your settings and catalog. Run the installer again to update; `--uninstall` / `-Uninstall` removes it.

### Project
- GitHub Actions: CI (installer linting, translations, end-to-end tests in light and dark themes, an installer end-to-end test) and automatic releases with build-provenance attestations when a `v*` tag is pushed.
- `npm run release:assets` builds reproducible release assets (the app bundle is under 1 MB).
- Linux: `desktopName` set so the window is matched with its menu entry.

## [1.0.0] — 2026-11-09

First public release. Created and conceived by Daniel Michelon De Carli · LionOrganizer Team.

### Analyze
- Folder scan with a configurable depth (3 subfolder levels by default, up to 50 or unlimited).
- Folder tree with sizes, breadcrumbs and a sortable, filterable file table with CSV export.
- Charts: space by file type (rose), biggest subfolders (treemap), 100-dot matrix, largest extensions and file age.

### Clean up safely
- Cleanup suggestions grouped by reason: SketchUp, Revit and AutoCAD backups, temporary files, logs, unfinished downloads, installers, large old files.
- Typed confirmation code before any change to files — every deletion (one file or many), organize, rename, undo and clearing the catalog. The code is generated and verified by the main process.
- Deleted files go to the Recycle Bin.

### Duplicates, organize and catalog
- True duplicate detection by content (SHA-256), with hashes cached in the catalog.
- Organize loose files into subfolders by type, and batch rename with `{name}`, `{date}`, `{n}` and `{folder}` patterns; both undoable.
- Local SQLite catalog: search across every analyzed folder, scan history and comparison, recent operations with undo.

### Interface
- 10 languages: English, Português (Brasil), Português (Portugal), Español, Français, Deutsch, Italiano, 简体中文, 日本語, 한국어 — detected from the system and switchable in the status bar.
- Light, dark and automatic themes; VS Code-inspired layout; "About" dialog with credits.

### Project
- Source code, comments and documentation in English; README in 10 languages.
- Licensed under the GNU General Public License v3.0 or later.

[1.0.0]: CHANGELOG.md#100--2026-11-09
