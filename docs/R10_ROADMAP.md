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

## C1 continuation checkpoint

C1 paintable filter masks are implemented and verified. Continue with C2 bitmap patterns, C3 inspector, C4 shaped-text prototype, then D/E/F. No merge or deploy authorization.

## C2 continuation checkpoint

C2 bitmap Pattern Overlay is implemented and verified. Continue C3 inspector, C4 shaped-text prototype/proposal, D/E/F. An isolated RTL diagnostic currently fails a curved-versus-straight advance assertion and has not changed production text behavior.

## C3 continuation checkpoint

C3 implemented and verified. C4 prototype and concrete shaping-service proposal are documented in R10_RTL_PATH_PROPOSAL.md; production support remains deferred, with strict diagnostic failures retained. Continue D/E/F.

## Milestone D continuation

D1/D3 verified within existing budgets. D2 local filter tiling implemented/verified; nonlocal filters and the document compositor retain full-plane paths. No4MP/16.8MP/16384px cap was raised. C4 production shaping remains deferred by the documented prototype/proposal fallback. Continue E narrow-row/touch cleanup and F full regressions, measurements and exact-HEAD CI.
