# Changelog

All notable changes to LionOrganizer are documented here. The project follows [Semantic Versioning](https://semver.org).

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
