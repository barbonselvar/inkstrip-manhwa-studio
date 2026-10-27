# R10 contextual-script path text: prototype and adoption proposal

Status: **prototype only; production support deferred**. The existing R9
`checkPathText` refusal remains intact. Ordinary shaped text and Dialogue Studio
are unchanged. Removing the refusal would draw disconnected graphemes and is unsafe.

## What was measured

`scripts/r10-rtl-path-prototype.mjs` draws complete Arabic and mixed-direction
runs with the browser's SVG textPath implementation, using Arial/system Arabic
fallback. The screenshot shows connected glyphs and Arabic diacritics. Two
window SVG-image PNG exports are pixel- and byte-identical (tolerance0).

The prototype retains strict adoption assertions and exits1, deliberately
reporting its unresolved findings rather than presenting a production feature:

- Arabic `السلام عليكم`: shaped canvas advance178.001953125px versus
  isolated-letter sum258.001953125px. These are different operations; per-letter
  placement cannot be substituted for shaping.
- Pure Arabic SVG path and ordinary-run advances agree at browser precision.
- Mixed `الفصل 12 — Inkstrip Studio`: curved-path advance430.34375px versus
  ordinary-run430.203125px. The0.140625px difference is recorded, not rounded away.
  The browser's mixed-direction path metrics do not satisfy the proposed parity gate.
- `createImageBitmap(SVG Blob)` rejects this SVG with InvalidStateError in the
  tested Chromium. The same SVG works through a window Image element. Moving
  rendering to the main thread is not a safe substitute for the current worker.
- Fonts are system-dependent and unembedded. Cross-platform, worker and export
  font identity is unverified. No native persistence or path editing is claimed.

The initial metric failure, subsequent decoder failure, final diagnostic JSON
and SVG are preserved under docs/r10-evidence. The failed diagnostic is separate
from the unchanged production browser/unit regression suite. Its assertions have
not been weakened, skipped or turned into passing release checks.

## Concrete compatible implementation

1. Introduce a bounded shaping service shared by preview, worker and export.
   Use a pinned HarfBuzz WASM build and pinned font bytes, with Unicode bidi
   paragraph/run resolution before shaping (UAX9). Retain logical text, language,
   direction, cluster mapping, glyph IDs, advances, offsets and ligatures.
2. Resolve fallback fonts by complete shaping runs, not individual letters.
   Include combining marks and zero-width joiners in cluster mappings. Define
   explicit policy for unsupported fonts and variable-font axes. Confirm font
   embedding licenses before adding distributable fonts.
3. Map shaped glyph outlines to the existing R9 arc-length geometry. Use glyph
   origins/advances and tangent transforms without reshaping disconnected letters.
   Define cluster handling at high curvature, RTL start/end offsets, baseline,
   reverse path and mixed bidi runs. Keep existing Latin path rendering unchanged
   until a new explicitly versioned path-text mode is selected.
4. Add an optional strict versioned text-path record for shaping/font references.
   Store logical source text and immutable licensed font assets, not flattened
   PNGs. Old readers must reject that version. No production schema change has
   been made by this prototype. A reviewed migration is needed before adopting it.
5. Reuse existing history and immutable asset ownership. Cache shaped outlines by
   font SHA256, logical text, direction, language, features and variation axes.
   Invalidate when any key changes. Bound text length, glyph count, font bytes,
   outline segments and cache memory before parsing untrusted fonts.
6. Export SVG as deterministic glyph outlines while retaining editable logical
   text in native documents. Raster exports and previews use the same outlines.
   Do not rely on separately resolved SVG/browser fonts for pixel parity.

## Required adoption gates

Arabic joining/ligatures, diacritics, mixed Arabic/Latin/numbers, bidi controls,
RTL ordering, offsets, high curvature, reversed paths, font fallback, native
round-trip, Undo/Redo, SVG/raster export and worker/window parity need test fixtures.
Include malicious fonts/oversized shaping inputs, cancellation and five-width
UI tests. Existing Latin/CJK/emoji R9 fixtures and Dialogue tests must remain green.

This is a significant text-engine extension. Review the proposal and font/dependency
choices before production implementation. Other independent R10 milestones continue.
