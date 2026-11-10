# Contributing to LionOrganizer

Thank you for helping! This project welcomes bug reports, ideas, code and — especially — translations.

LionOrganizer was created and conceived by Daniel Michelon De Carli and is maintained by the LionOrganizer Team. By contributing, you agree that your contributions are licensed under the [GNU General Public License v3.0 or later](LICENSE), the same license as the project.

## Ground rules

- **Safety is a feature.** Any change that deletes, moves or renames files must go through the operations service (`src/platform/operations`) so it is validated in the main process and protected by the typed confirmation code. Never call `fs.unlink`, `fs.rename` or `shell.trashItem` from anywhere else.
- **Respect the layers.** `base` must not import from `platform` or `workbench`; the renderer (`workbench`) never uses Node.js directly — it talks to the main process through `window.host` (see `src/code/electron-sandbox/preload.js`).
- **No hard-coded UI text.** Every user-visible string goes through `t()` / `tn()` and lives in `src/nls/en.json`.
- **English code.** Identifiers, comments and commit messages are written in English. `npm run test:english` checks the code and CI checks it and every pushed commit message; to have Git refuse a message that is not in English before the commit is made, run once `git config core.hooksPath .githooks`. Text in other languages belongs in `src/nls/*.json` (or the installer's own translations); a line that really needs another language — a test of the translated UI, a legacy alias — ends with a `lang-ok` comment.

## Getting set up

```powershell
npm install
npm start
```

Before opening a pull request, check the language and run the end-to-end test against a throwaway folder:

```powershell
git config core.hooksPath .githooks   # once: commit messages must be in English
npm run test:english
```

```powershell
$env:E2E_FOLDER="C:\temp\lion-test"; $env:E2E_OUT="C:\temp\lion-out"; npm run test:e2e
```

## Translations

The interface is translated with flat JSON catalogs in `src/nls/`:

```
src/nls/
  locales.json   list of languages shown in the language picker
  en.json        source language (English) — every key must exist here
  pt-BR.json, pt-PT.json, es.json, fr.json, de.json, it.json, zh-CN.json, ja.json, ko.json
```

Each file maps a key to a message:

```json
{
  "common.showIn": "Show in {explorer}",
  "common.files.one": "{count} file",
  "common.files.other": "{count} files"
}
```

- **Placeholders** such as `{explorer}` or `{count}` must be kept exactly as they are. You may move them inside the sentence.
- **Plurals** use suffixes chosen by [`Intl.PluralRules`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl/PluralRules): `.one`, `.other` (and `.few`, `.many`, `.two`, `.zero` for languages that need them). Chinese, Japanese and Korean only need `.other`.
- **Size units** (`units.KB`, `units.MB`, …) can be localized — French uses `Ko`, `Mo`, `Go`.
- **Folder names** under `organize.folders.*` become real folders on disk: they must not contain `< > : " / \ | ? *`.
- Use the operating system's own vocabulary for your language (for example the localized name of the *Recycle Bin* and *File Explorer*).

### Improving an existing language

Edit `src/nls/<locale>.json`, run the app, pick your language in the status bar and check the screens. Missing keys automatically fall back to English.

### Adding a new language

1. Copy `src/nls/en.json` to `src/nls/<locale>.json` (use a BCP 47 code such as `nl`, `pl` or `zh-TW`) and translate the values.
2. Add `{ "id": "<locale>", "label": "<native name>" }` to `src/nls/locales.json`.
3. If the language needs special matching (like `pt-BR` vs `pt-PT`), update `negotiateLocale()` in both `src/base/common/nls.js` and `src/platform/nls/common/nls.js`.
4. Translate `README.md` into `docs/README.<locale>.md` (optional, but very welcome).

You can check that a catalog is complete with:

```powershell
node -e "const en=require('./src/nls/en.json'),x=require('./src/nls/<locale>.json');console.log(Object.keys(en).filter(k=>!(k in x)))"
```

## Code style

- Every source file starts with the project header (copyright LionOrganizer Team, GPL-3.0-or-later). Copy it from any existing file.
- 2-space indentation, single quotes, semicolons.
- Small, focused modules; comments explain *why*, not *what*.
- UI colors come from CSS variables in `workbench.css`, defined for both light and dark themes.
