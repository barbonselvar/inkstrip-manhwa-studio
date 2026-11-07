; Inkstrip Manhwa Studio — NSIS additions for the assisted installer (electron-builder).
; - A welcome page with installation information.
; - An optional "Create a desktop shortcut" choice (fresh installs; updates keep the
;   user's existing choice through electron-builder's KeepShortcuts mechanism).
; User projects, settings, recovery data and backups live outside the installation
; folder and are never removed by install, update or uninstall.

!include nsDialogs.nsh
!include LogicLib.nsh

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Welcome to Inkstrip Manhwa Studio ${VERSION}"
  !define MUI_WELCOMEPAGE_TEXT "Setup will install Inkstrip Manhwa Studio, an offline manhwa chapter, raster, composition and lettering studio for Windows.$\r$\n$\r$\nEverything the editor needs is included; no internet connection is required to install or use it.$\r$\n$\r$\nYour projects (.inkstrip files), settings, autosaves and backups are stored outside the installation folder and are kept when Inkstrip is updated, reinstalled or uninstalled.$\r$\n$\r$\nClick Next to continue."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!ifndef BUILD_UNINSTALLER
  Var InkstripDesktopShortcut
  Var InkstripDesktopCheckbox
!endif

; Expanded where pages are declared (after MUI2 and plugins are available).
!macro customPageAfterChangeDir
  Function InkstripShortcutPage
    ; Automatic updates run silently (/S), so this page never interrupts them.
    !insertmacro MUI_HEADER_TEXT "Shortcuts" "Choose where Inkstrip Manhwa Studio appears."
    nsDialogs::Create 1018
    Pop $0
    ${if} $0 == error
      Abort
    ${endif}
    ${NSD_CreateLabel} 0 0 100% 24u "A Start menu shortcut is always created. You can also add one to the desktop."
    Pop $0
    ${NSD_CreateCheckbox} 0 32u 100% 12u "Create a &desktop shortcut"
    Pop $InkstripDesktopCheckbox
    ${if} $InkstripDesktopShortcut == "0"
      ${NSD_Uncheck} $InkstripDesktopCheckbox
    ${else}
      ${NSD_Check} $InkstripDesktopCheckbox
    ${endif}
    nsDialogs::Show
  FunctionEnd

  Function InkstripShortcutPageLeave
    ${NSD_GetState} $InkstripDesktopCheckbox $0
    ${if} $0 == ${BST_CHECKED}
      StrCpy $InkstripDesktopShortcut "1"
    ${else}
      StrCpy $InkstripDesktopShortcut "0"
    ${endif}
  FunctionEnd
  Page custom InkstripShortcutPage InkstripShortcutPageLeave
!macroend

!macro customInstall
  ; Interactive fresh install with the box unchecked: remove the desktop shortcut.
  ${if} $InkstripDesktopShortcut == "0"
    WinShell::UninstShortcut "$newDesktopLink"
    Delete "$newDesktopLink"
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${endif}
!macroend
