# Phase 6 — Character library and optional AI Face Fix

The Character Library is fully local and project-isolated. In Retouch, select a
face, name the character, add notes, then Save selected face reference. Add up to
six references/angles, upload an already-cropped PNG/JPEG/WebP, pick a primary,
update details or explicitly remove references/profile. References are independent
bounded PNG crops (up to 512px / 750KB), so later panel deletion/replacement cannot
break the library. Across a project, 32 profiles and 16MB of crops are allowed.
Existing projects gain an optional characters field without a database version
change or reset. Project updates read and write within one IndexedDB transaction.
A session-only selected character ID is remembered per project, not credentials.

For AI Face Fix: choose a saved character/reference, manually select or detect the
target face, choose AI Face Fix, confirm the target identity and explicit upload
consent, enter the server owner access code, then Preview. The real optional
server-side gpt-image-1 edit request includes the target context, transparent edit
mask and a **second reference image**, plus appearance notes. This is image
regeneration conditioned on a reference, not a pasted crop or pixel filter.
Generated changes are blended only inside the mask, and remain a candidate until
Accept then Save. Compare, reject/retry, edit selection, result undo/redo and
original recovery remain available.

Chapter → AI Face Fix · review selected targets starts a controlled sequential
review queue. Each target requires its own face/identity confirmation and upload
consent. Select the saved character for each target (the project selection is
remembered). Save accepts that image only; skip/stop preserves pending targets.
A failed request leaves the current target available for retry. There is no silent
identity matching or unattended overwrite. This intentionally trades speed for
explicit per-face decisions, especially with multiple characters.

Cloud settings, pricing/privacy links, proprietary model status and hosting timeout
requirements are in PHASE_4_RETOUCH.md. No new environment values were created here.
Without configured credentials the library, detector and masks work, while
reference-conditioned generation returns an honest unavailable error. No local
face-generation or face-recognition embedding model is claimed. Target pose,
expression/style/lighting preservation is a model instruction, not a guarantee.
Hair, dialogue and other details inside the mask can change: use tight selections
and inspect at full resolution. Manual association is required for every character.

Validation includes saved PNG reference persistence, model request with two images,
no-cloud configuration failure, missing consent/access gating, and original
retention. Paid image inference/identity quality, actual Vercel function duration,
and physical Android were not testable without deployment/resources; this phase's
AI generation is an optional integration, not an offline complete Face Fix model.
