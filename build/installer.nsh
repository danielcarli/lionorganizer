; LionOrganizer — Copyright (C) 2026 LionOrganizer Team. Created and conceived by Daniel Michelon De Carli.
; Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
; Installer welcome page with the LionOrganizer tagline.
; electron-builder calls this macro in the assisted installer (oneClick: false).
; The standard installer pages are translated by NSIS itself (see "installerLanguages" in package.json).
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "LionOrganizer$\r$\ndisk space analysis & cleanup"
  !define MUI_WELCOMEPAGE_TITLE_3LINES
  !define MUI_WELCOMEPAGE_TEXT "See what is taking up space in your folders and free up what you no longer need.$\r$\n$\r$\nThis wizard will install LionOrganizer on your computer.$\r$\n$\r$\nClick Next to continue."
  !insertmacro MUI_PAGE_WELCOME
!macroend
