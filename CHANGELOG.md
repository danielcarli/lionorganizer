# Changelog

All notable changes to LionOrganizer are documented here. The project follows [Semantic Versioning](https://semver.org).

## [1.2.1] — 2026-11-10

### Faster updates, and an installer that never freezes
- **From the click to the installer:** the update dialog shows a new version already found (and its "Update now" button) at once, checking again in the background instead of making you wait for the network; after the click it says right away that LionOrganizer is closing, and the app closes as soon as the installer has started (it no longer waits a fixed time). If the installer cannot start, the app stays open and says why.
- **No second confirmation:** in update mode the wizard no longer stops on "Ready to Install" — the update was already confirmed in the app (or by choosing the "Update LionOrganizer" shortcut).
- **The installer window stays responsive:** downloading and checking the app no longer blocks the wizard. It shows each step and the download as it goes ("28 MB of 105 MB downloaded"), and gives up with a clear message if nothing happens for 3 minutes.
- **Much smaller updates:** when the new version uses the same Electron runtime as the installed one (most updates), the runtime is reused instead of downloading about 110 MB again; an update then downloads only the app itself, a few hundred KB. The icon tool (rcedit) is kept between updates too, checked again by SHA-256 every time.
- **The update installer keeps itself current:** the copy of the wizard kept for updates could never replace itself, so every update kept running the very first installer downloaded — with none of these improvements. Now, when a new version is found, the app fetches that release's wizard in the background (about 2 MB, kept only if its SHA-256 matches the release's SHA256SUMS, the same check the installers make), and it takes the copy's place right before the update starts; the wizard does the same during an update started from the "Update LionOrganizer" shortcut. The update dialog's privacy note says so.
- Updating from 1.2.0 or earlier still runs the installer those versions kept; the improvements above apply from the next update on (or right away, by running a freshly downloaded `LionOrganizer-Setup.exe`).

## [1.2.0] — 2026-11-10

### Fluid with very large folders
Measured with `tools/perf.js` on a folder of 1,000,000 files (before → after):

| | 1.1.6 | 1.2.0 |
|---|---:|---:|
| Longest freeze of the main process (window, menus, every request) | 4.5 s | 0.08 s |
| Sort the file list by name | 16.9 s, window frozen | 0.85 s, window free (longest block 0.08 s) |
| Back to the whole folder after zooming into one | 1.2 s | 0.08 s |
| Reopen the saved analysis | 3.0 s, window frozen for 2.4 s | 3.3 s with progress, longest block 0.12 s |
| Longest block of the window during the first analysis | over 1 s | 0.16 s |

- **Background worker:** reading folders, the catalog (SQLite) and the content hashes moved to a worker thread. The main process only relays messages, so the window, menus and buttons always answer — also while a million files are saved to the catalog. It holds the only connection to the catalog, so writes never wait on each other.
- **Compact transfer:** the files travel between the worker, the main process and the window as columns (one table of folders, numbers in typed arrays) instead of a million objects, and are turned into objects in the window a slice at a time, with progress on the loading screen ("Opening the last saved analysis… 45% · 450,000 of 1,000,000 files").
- **Sorting in a Web Worker:** large lists are sorted off the UI thread (ignoring case and accents, numbers in natural order); meanwhile the list stays usable and shows "Sorting…". Each column is sorted once per analysis.
- **Cached per folder:** totals, suggestions and lists are kept for each folder in focus, so going back to a folder already seen is instant. The folder tree and the totals are built from the folders (thousands) instead of the files (millions), and deleting files only subtracts them.
- **Cleanup suggestions in the background:** each rule runs once per file, and for large analyses the suggestions (and the duplicate heuristic, now grouped by size first) are prepared in slices after the first screen; the Overview and the Cleanup tab say "Preparing the cleanup suggestions…" for that moment.
- **Lighter checks before deleting:** the main process finds a file among the few of its folder instead of building a million-entry list; deleting one file in a 1,000,000-file analysis no longer freezes it.
- **Smaller things:** a single collator for sorting text (creating one per comparison made it 50× slower), the largest files picked in one pass, search over lowercase names kept per file and per folder, the count of suggestions on the side bar computed when the app is idle.
- **Performance test:** `npm run test:perf` (and CI, with 100,000 files) measures every step and fails if the window is blocked for too long or a step goes over its budget, so the app does not become heavy again without anyone noticing.
- **English everywhere in the code:** `npm run test:english` (also in CI) checks that code and comments are in English, and CI checks every pushed commit message; `.githooks/commit-msg` refuses a message in another language before the commit is made (`git config core.hooksPath .githooks`).
- Measured and left as it is: bundling the interface into one file would save about 40 ms at startup (7%) — not worth a build step.

## [1.1.6] — 2026-11-10

### Space map: only when you turn it on
- The space map no longer computes anything when the app starts, not even if it was the tab left open: its tab shows what it does, warns that it takes a lot of processing (with the number of files of the analysis) and offers "Turn on the space map". It stays on until LionOrganizer is closed.
- Once turned on, its index is built in the background in small slices — the window never freezes — with a progress bar (grouping files by folder, then sorting folders by size) and "Cancel"; you can switch tabs meanwhile, and the map shows up when it is ready.
- Drawing is lighter: every folder's files and subfolders are sorted once, and each view only takes the blocks big enough to be seen.

## [1.1.5] — 2026-11-10

### Back to the AI's answer
- New "Import AI answer" button (Cleanup and Files views): paste what the AI answered to the LionOrganizer report and the files of the analysis it cites are listed with the risk it gave them (low, medium, high), ready to review. Only the low-risk ones start checked; paths that are not in the analysis, and names that match more than one file, are reported instead of guessed. Moving them to the Recycle Bin always asks for the typed code.
- The report now asks the AI to write the paths between backticks and the risk with fixed words in the user's language, so its answer can be read back reliably.

### More to clean
- **Render and CAD caches:** Twinmotion/Unreal derived data, Lumion and Enscape cache folders, V-Ray light/irradiance maps, Corona caches, Revit journals and collaboration cache, Adobe Media Cache and peak files. The programs rebuild them when needed.
- **Empty files (0 bytes)**, leaving out the marker files some tools need (`.gitkeep`, `__init__.py`…).
- **Empty folders:** folders with no files, not even in their subfolders (the topmost of each empty branch is listed). Moving them to the Recycle Bin asks for the typed code, and each folder is checked again right before: a folder that is no longer empty is kept.

### Inaccessible items explained
- The "N inaccessible" item in the status bar opens a list of what could not be read, grouped by reason (no permission, in use, removed during the analysis, path too long) with what to do, and a "Copy list" button.
- Windows: "Analyze again as administrator" reopens LionOrganizer with administrator rights (Windows asks for permission) and analyzes the same folder. macOS: a shortcut to Privacy & Security → Full Disk Access.

### Large folders
- **The last analysis reopens instantly** from the catalog, with its date, when the app starts or the folder is opened again. Nothing is analyzed automatically: the folder is read again only when you choose "Analyze now" (or F5). Analyzing again the folder on screen runs in the background: the analysis stays visible and in use, keeps the folder in focus, the filters and the selection, cancelling keeps it, and a notice says what changed.
- **Space analyzed vs space used on the disk:** the Overview shows how much the analysis read next to the disk's used and free space, with a bar, and explains the difference — items that could not be read ("See which"), folders below the depth limit, ignored folders, the system's own files (virtual memory, hibernation, restore points, snapshots) or other folders of the disk — and how far the analysis went (folders read, levels, time).
- **Ignore folders** (optional, off by default): a list of folders that are not read — `node_modules`, `.git`, `__pycache__`, `$RECYCLE.BIN`, `System Volume Information`… — editable, with `*`/`?` wildcards and paths relative to the analyzed folder. The Overview and the side bar say how many folders were left out, with "Analyze without ignoring".
- **Space map** (`Ctrl+7`): a full-screen treemap where every file is a block, nested in its folders and colored by type. Click a block to zoom into its folder; "Up", Backspace or a right-click goes back; double-click a file to show it in Explorer. Drawn on a canvas, so it stays fast with many files.

### Startup
- **One instance only:** opening LionOrganizer again brings the window that is already open to the front, instead of starting a second copy.
- **Loading screen:** the window appears at once and says what the app is doing — starting, opening the last saved analysis of a folder, preparing its files — with "Start without the saved analysis" if that takes a while.

### Also
- The catalog keeps what a scan found besides the files (errors, empty and ignored folders, folders below the depth limit), so a reopened analysis looks the same.
- Every new text is translated into the 10 languages; the end-to-end test covers each feature in the light and dark themes.

## [1.0.3] — 2026-11-10

### New version indicator
- The version is shown in the bottom-right corner of the status bar. LionOrganizer checks once a day for a new version (it reads one small file from the GitHub releases and sends no data); when there is one, the indicator is highlighted.
- Clicking it opens a dialog that shows the installed and the new version and asks whether to update. On Windows, the app closes and its installer downloads, checks and installs the new version; elsewhere, the download page opens. Automatic checking can be turned off in that dialog.

### Export for AI analysis
- New "Export for AI" button (Cleanup and Files views): a report, in the user's language, with instructions for an AI (Claude, ChatGPT…) to point out which files are probably the safest to delete, and why. It lists the largest files, the cleanup suggestions and the duplicates confirmed by SHA-256, with paths relative to the analyzed folder and never the contents of files. Copy it or save it as a `.md` file; the app sends it nowhere.

### Files deleted outside the app
- Files that no longer exist (deleted or moved in Explorer, or whose folder is gone) are detected when they appear on screen, when you come back to the window, when you click "Show in folder" and before moving files to the Recycle Bin.
- They are shown in gray and marked "Not found", with a notice and a "Remove from list" button. Removing from the list only changes the interface, nothing on disk, so it needs no confirmation code.
- Files that no longer exist are left out of Recycle Bin operations, so no confirmation code is asked for them, and they are no longer reported as "in use or no permission".

### Fixed
- Changing the language in the status bar now reloads the interface in the new language (the reload was blocked by the window's navigation protection).

### Documentation
- READMEs in 10 languages: "What sets LionOrganizer apart", and the privacy notes explain the only connection (the optional check for new versions).

## [1.0.2] — 2026-11-10

### Install
- Graphical installers in every release:
  - **Windows:** `LionOrganizer-Setup.exe`, a setup wizard of about 2 MB (Inno Setup, 10 languages) built like the LEBR installer: it downloads the latest version from GitHub during setup, checks every file and shows each step. Per-user install with Start menu and desktop shortcuts, an entry in Settings › Apps and an "Update LionOrganizer" shortcut.
  - **macOS:** `LionOrganizer-mac-universal.dmg` (Apple Silicon and Intel), signed ad hoc.
  - **Linux:** `lionorganizer_amd64.deb`, `lionorganizer.x86_64.rpm` and `LionOrganizer-x86_64.AppImage`.
  - File names without the version number, so `releases/latest/download/<file>` always points to the newest version.
- Command-line installers that download the latest release from GitHub and install it the way VS Code is installed on each system:
  - **Windows:** `install.ps1` (or double-click `install.cmd`) — per-user install in `%LOCALAPPDATA%\Programs` by default, or for all users in `%ProgramFiles%`; Start menu and desktop shortcuts; entry in Settings › Apps.
  - **macOS:** `install.sh` — `/Applications/LionOrganizer.app` (or `~/Applications`), ad-hoc signed for Apple Silicon.
  - **Linux:** `install.sh` — `~/.local/share` per user or `/opt` for all users, `lionorganizer` command, menu entry and icons; installs missing libraries with apt, dnf/yum, zypper or pacman.
- Every download is checked: HTTPS only, SHA-256 for the release files, Electron's own checksums for the runtime, and optional verification of the signed build provenance with the GitHub CLI.
- Updates replace the app atomically and keep your settings and catalog. Run the installer again to update; `--uninstall` / `-Uninstall` removes it.

### Project
- GitHub Actions: CI (installer linting, translations, end-to-end tests in light and dark themes, installer end-to-end tests on Linux and on a Windows runner — script and setup wizard: install, launch, update, tampered download refused, uninstall) and automatic releases when a `v*` tag is pushed: the Windows wizard, the `.dmg`, the Linux packages and the app bundle, all listed in `SHA256SUMS` with build-provenance attestations.
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
