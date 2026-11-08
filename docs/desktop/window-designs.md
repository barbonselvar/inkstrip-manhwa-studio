# Window designs

Five window designs, selectable live in **Settings → Window appearance** (also
**View → Window Appearance…** and the command palette). The choice is saved in
`%APPDATA%\Inkstrip Manhwa Studio\settings\settings.json` and restored on start;
**Restore default** returns to Creative Studio Pro.

| | Design | Title bar | Look |
|---|---|---|---|
| 1 | **Creative Studio Pro** (default) | 42 px | Inkstrip's mint identity, `Library › Project › Chapter` breadcrumb, save-status chip with quick Save, subtle teal window border |
| 2 | **Modern Windows 11** | 38 px | Native Mica material (Windows 11 22H2+, solid fallback elsewhere), system accent border, Segoe UI, title text |
| 3 | **Neon Gaming** (Opera GX–inspired, no Opera assets) | 40 px | Dark violet surface, configurable accent glow line and colored window border, uppercase menus |
| 4 | **Developer Compact** (VS Code–inspired) | 32 px | Compact menus and a centered command center that opens the real command palette (Ctrl+Shift+P) |
| 5 | **Minimal Borderless** | 30 px | Slim bar, one menu button for the full menu, centered title, save text only while work is unsaved, dimmed when inactive |

Screenshots (real app, this PC): [`screenshots/`](screenshots/) —
`design-1-modern-windows-11.jpg`, `design-2-neon-gaming.jpg`,
`design-3-developer-compact.jpg`, `design-4-creative-studio-pro.jpg`,
`design-5-minimal-borderless.jpg`, `window-appearance-selector.jpg`,
`command-palette.jpg`, `snap-layouts-native-maximize.jpg`.

## Architecture (`apps/desktop/src/main/window-shell.ts`)

```
BrowserWindow  — native frame kept (resize edges, rounded corners, shadow, Snap, DPI)
├─ titleBarStyle: hidden + titleBarOverlay → Windows draws the real caption buttons
├─ own webContents → app://inkstrip/__shell/titlebar.html   (title bar, drag region)
└─ WebContentsView → app://inkstrip/                         (studio, unchanged)
```

- **One shell, five looks.** A design is data: title-bar height, overlay colors, Mica on/off,
  border accent and a CSS theme (`body[data-design]`). Switching calls
  `setTitleBarOverlay`, `setBackgroundMaterial`, `setAccentColor`, re-lays out the studio
  view and updates the title-bar page — no restart, no window recreation.
- **The studio is not modified by the title bar.** It lives in its own view below it, so
  the editors' full-height layouts, canvases, pointer/stylus input, shortcuts and
  drag-and-drop behave exactly as before. In full screen the bar is hidden and the studio
  gets the whole screen.
- **Native controls only.** Minimize / maximize / restore / close are Windows' own buttons
  (Snap layouts flyout on hover, verified). Dragging, double-click maximize/restore and the
  system menu come from the drag region; resizing from the native frame.
- **Menus are the real application menu.** Title-bar buttons open the native submenus
  (also Alt+F/E/V/H and F10 from the studio); Minimal opens the whole menu from one
  button. All existing File/Edit/View/Help commands are unchanged.
- **Focus.** Keyboard input always returns to the studio after a title-bar action or when
  the window is activated.
- **Security.** The title-bar page has its own preload (`inkstripShell`) that can only open
  menus, forward six window commands and receive state; it has no file, settings or update
  access, and the main process rejects studio channels from it (and vice versa).
- **Performance.** No continuous animation, no per-frame work; transitions are ≤ 140 ms and
  disabled under `prefers-reduced-motion`. The title-bar page is ~10 KB of script.
- **Theme.** `nativeTheme.themeSource = "dark"` so native menus, dialogs and Mica are dark
  like the studio (Mica was light, and unreadable, under the system light theme).

## Verification

Automated (`apps/desktop/test/window-designs-e2e.mjs`, packaged app): for **each design ×
display scale 100 %, 125 %, 150 %, 200 %** — applied live; title bar height and studio view
geometry exact; every visible title-bar control is `no-drag`; restore, maximize,
minimize→restore and full screen in/out keep the layout; command center and Ctrl+Shift+P
open the palette; design and accent persist across a restart; Restore default.
**140 checks, all passing** (see desktop-test-results.md).

Manual on this PC (Windows 11, real mouse/keyboard via desktop control): native File/View
menus from the title bar, dark native menus, Snap layouts flyout from the maximize button,
double-click restore/maximize, dragging the window by the title bar, Alt+F, F11, the live
selector and command palette, Save from the title bar (Save As dialog for a new project),
design persistence across restart, Minimal's full-menu button.

Not tested: real physical monitors at 125/150/200 % (scales were forced with Chromium's
`--force-device-scale-factor`; this laptop runs one display), dragging between two physical
monitors, Windows 10 (Mica falls back to a solid color there by design), touch and pen in the
title bar.
