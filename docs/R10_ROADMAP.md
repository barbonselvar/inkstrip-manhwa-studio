# R10 roadmap

Continue the existing branch and Draft PR #23. Do not merge or deploy.

1. Finish Milestone A's full regression matrix and source/main geometry comparison.
2. Implement/test separate confirmed-save recovery checkpoints, accurate save
   status and safe asset reachability analysis. Commit Milestone B after validation.
3. Extend R8 Smart Filter masks and Pattern Overlay; improve the existing inspector.
   Prototype shaped Arabic/RTL path text before any text-engine replacement.
4. Share capability preflight, validate bounded tiled processing and exercise
   1080x1920/5000/10000/20000 pages with explicit supported/refused outcomes.
5. Complete mobile controls, navigation, row readability and error recovery.
6. Run full R8/R9/PR21/native/history/export/security regressions, actual benchmarks,
   GitHub checks on final HEAD and update these reports with remaining limitations.

Milestone status must distinguish implemented/verified, partial, deferred and
blocked. Preserving original data takes precedence over unproven cleanup or
shaping shortcuts. Existing Claude implementation commits remain unchanged.

## Continuation checkpoint

A is verified and published as `ad9809966fe79746a91cd4e17b2ad8c1aeb3be3c`
(both GitHub workflows green). B1/B2 and B3 conservative analysis are implemented
and validated. Asset deletion is deferred under the handoff's explicit
analysis-first fallback. Next: paintable filter masks and bitmap patterns, using
the existing R8 architecture. No release authorization is implied.
