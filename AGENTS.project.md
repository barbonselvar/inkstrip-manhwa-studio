# Inkstrip Phase F approval policy

The current user instruction supersedes earlier automatic phase release authority.
Implement **F1 only** on `codex/phase-f-ai-studio`. Commit/push tested development
work and prepare a reviewable PR. **Do not merge, deploy to production, change
production settings or start F2–F5 without explicit user approval.** Never push
directly to main, rewrite shared history, provision paid compute or enable paid APIs.

Preserve the existing Raster/Vector engines, original artwork, Chapter data,
AI inference and 3D features. No fake inference or production-ready claims for
unqualified models. Mocked orchestration is not evidence of model execution.
Verify exact code/weights/dependency licenses; report missing GPU resources and
human quality review honestly. Follow the current F1 report and acceptance gates
in `docs/PHASE_F1_AI_STUDIO.md`. Native v1–v5 remain readable; additive AI records
use v6 so older readers reject unsupported provenance rather than dropping it.

Current sequence: Phases C, D and E are released; PR #5 cleanup is released at
`71a29e2f01869a82a4b6a81818fb56441cb93c3f`. Existing baseline: 677 automated
tests and 19 Chromium suites. Phase F scaffold `b918ea2` was documents only and
was integrated with main by normal merge `4caa9d8` without rewriting history.

Current branch: `codex/phase-f-ai-studio`. F1 adds the shared-document AI Studio,
real existing Swin2SR restoration, staged approval and AI result layers/native v6,
plus metadata-only GPU discovery. It does not enable GPU jobs or qualified
inpainting/face/hands/background generation. Model licenses/evidence, benchmark
limitations and the actual validation status live in `docs/PHASE_F1_AI_STUDIO.md`
and `docs/AI_MODEL_QUALIFICATION.md`. Native v1–v5 remain readable. Preserve the
existing optional paid adapter without invoking/configuring it for F1 or QA.

CodeFormer's upstream license restricts commercial use without permission; it is
excluded from the default registry. No model code/weights from imported files or
remote discovery may execute. No tokens/endpoints enter native files. No paid
compute, provider, production changes or next release without explicit approval.
