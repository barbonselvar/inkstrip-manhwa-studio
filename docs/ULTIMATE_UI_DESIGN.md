# Inkstrip — Ink & Light design system

Base: GitHub main `259aa479d3dd261e3061c589e9676d9ff8f8e098` (Phases 1–8).
This is a presentation upgrade of the existing application, not a replacement.

## Audit and direction

The base has reliable worker processing, IndexedDB media revisions, local AI,
optional cloud editing and responsive editor gestures. Its visual weaknesses were
an undifferentiated library, no actual cover previews, long chapter tool stacks,
scattered control styling, plain loading/errors and no shared motion preference.

Ink & Light keeps the sea-glass accent and Inkstrip name. Graphite surfaces,
readable neutral text, restrained translucent highlights and an editorial Fraunces
italic pair with the existing Outfit interface font. All fonts are bundled, not
requested from third-party font servers. Design tokens/motion durations live in
studio-design.css and the existing theme. Legacy geometry styles remain intact;
the isolated appearance sheet has scoped overrides for major surfaces.

The welcome sculpture is decorative CSS print geometry, explicitly aria-hidden.
It does not fabricate projects or pretend to be an interactive editor. Library
and chapter covers load actual existing thumbnail blobs only when visible, release
URLs on cleanup and never re-encode source artwork. Pointer-driven card depth uses
one scheduled frame per movement; no continuous JS render loop. Coarse pointers
and reduced-motion preferences disable interactive tilt. Ambient light uses CSS
transform/opacity on desktop only, pauses offscreen, in hidden tabs and while a
dialog is open; it is static on phones and can be disabled entirely.

## Scope and preservation contract

Stages: tokens/shared controls → library/navigation/chapter covers → workspace and
AI/character/batch presentation → mobile/reduced-motion QA → clean patch validation.
No engine, worker, AI provider, database schema, edit recipe, image plan, Vite,
Nitro, Vercel or dependency version is changed. Optional cloud AI retains explicit
upload consent and its existing configuration/quality limitations. No migration or
artwork deletion. Browser-only appearance preferences use a separate localStorage
key; malformed/unavailable storage falls back safely. Settings never touch artwork.

The only editor behavior adjustment is a close/discard autosave barrier: pending
metadata writes finish before an explicit discard clears them, and closing prevents
new autosave timers. Existing pixel/recovery regression checks exposed this race
under the redesigned UI. The image-processing pipeline remains unchanged.

## Interaction and accessibility

- Native controls, Radix dialog focus/escape behavior and accessible names retained.
- New project/library search shortcut `/` ignores inputs and open dialogs.
- Existing E, Ctrl/Command S/Z/Shift-Z, Space pan and Escape reorder continue working.
- Chapter settings and export actions move into keyboard-operable details sections.
- Full-screen precision planes/masks/crops never get decorative animation/transforms.
- Global controls use consistent focus, press and disabled states; icon hints use
  native titles. Destructive actions stay separate from accept/save controls.
- Mobile modal sheets retain bounded scrolling, focus handling and safe-area space.
- Image rows use 44px targets, with grip/selection stacked to fit 320px-wide phones.
- All actual work progress remains real; the indeterminate light only runs while
  processing UI exists. No artificial loading delay or fake percentage was added.
- Quiet mode and OS reduced motion remove animations; solid surfaces disable blur.
- Appearance settings persist locally; offline feedback reflects navigator state.

Manual QA: create/open a story, preview real chapter covers, focus search with `/`,
open appearance settings by keyboard, change Quiet/atmosphere/solid surfaces and
reload, import/reorder panels by touch, expand settings/export, edit/crop/paint with
zoom, compare AI results, save/recover, batch edit and export. Verify no artwork
moves when switching precision tools. Use real art only in your own browser; bundled
QA uses isolated synthetic libraries and an optional upstream detector example.

## Boundaries

No WebGL/Three.js or animation dependency is needed for these effects. Motion is
browser-native CSS with small event-driven React helpers. There is no claimed FPS
guarantee on Android; browser frame samples are diagnostics, not hardware benchmarks.
Physical Android and optional paid cloud model output quality are not verified in
this environment. Existing model capabilities/limits and cloud API requirements are
unchanged; see PHASE_4_RETOUCH.md through PHASE_8_WORKFLOW.md.
