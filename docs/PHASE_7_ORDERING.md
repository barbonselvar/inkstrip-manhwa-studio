# Phase 7 — Touch/desktop image ordering

Use the visible grip for mouse, pen or touch reordering. Only the grip captures
pointers and disables touch scrolling. An 8px movement threshold starts dragging;
ordinary image scrolling and long-press editing keep their existing behavior.
A floating label, insertion line and original-row dimming identify the move.
Release inserts above/below the target midpoint; edge dragging auto-scrolls the
sidebar or document using animation frames. Escape, blur or pointer cancellation
clears the drag without saving it. Keyboard-accessible Move Up/Down remains.

A single IndexedDB transaction verifies the expected order, reads the **latest**
panel records and changes only order values. It also preserves all edit sources,
originals, character references and chapter metadata. Conflicting tab order changes
return an error rather than replaying stale panel media. Twenty order changes are
retained in chapter metadata; Undo reorder works after reload and rejects undo if
image membership or order no longer matches. Failed writes leave the prior order.
Concurrent ordering actions are guarded while saving.

Stitch commits now verify the selected order as well as blob revisions. Stale
previews/downloads remain disabled until Display rebuilds accepted images in the
new order. Browser tests cover mouse dragging, native emulated touch dragging,
reload persistence, undo after reload, arrow controls and exported chapter order.
Tests use isolated synthetic artwork; physical Android/haptic performance remains
unverified. The bounded array of IDs makes operations linear for large chapters;
DOM lists are not virtualized, so extremely large libraries may still be slower.
