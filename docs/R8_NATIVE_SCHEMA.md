# R8 native document schema and rendering contract

R8 adds internal document **schema3**, portable **envelope9**, and a Pro IndexedDB **version5** writer fence. R6/R7 used schema2/envelope8/store4. No competing schema/envelope9 reservation was found on published main or the concurrent Vector deactivation branch; independent AI6 remains reserved and unsupported.

## Additive records and migration

- Existing layer kinds/IDs/order/source references are unchanged. Existing `gradient` fill layers gain a version2 definition: five mathematical gradient kinds; angle, scale and normalized center;2–128 color/opacity/position stops; optional segment midpoint; RGB or OKLab interpolation; smoothness and reverse.
- Existing `effects` arrays retain legacy records and their exact algorithms. New version2 style records add spread/choke/shared light/gradient fills/inner-glow source, validated pattern recipes and alpha-derived bevel settings. At most one of each of nine effect kinds per layer; order is preserved.
- Eligible artwork layers gain `smartFilters`: up to12 ordered records with stable local IDs, enabled state, a validated typed operation and optional captured-selection mask with enable/density/inversion. Groups, backdrop adjustments and unbounded extended vector planes are ineligible.
- `styleLight` is an optional shared document angle. Each participating shadow/bevel explicitly opts in.

The first committed R8 edit performs an opt-in, metadata-only schema1/2→3 migration. Every legacy layer, source asset, crop/output frame, mask, selection and R6 adjustment remains intact. Undo can restore the pre-migration document. Subsequent R6 adjustment creation preserves schema3. Removing the final R8 record does not downgrade the document or discard metadata.

Legacy envelopes1–5/7/8 remain readable and retain their existing behavior. Envelope6 stays reserved for the separate AI stream. A schema3 document always exports envelope9. The reader rejects unknown/mismatched versions, types, keys, non-finite/range-invalid numbers, malformed stops/masks, unsafe keys, resource overages and corrupt data before embedded image decoding. Serialization sorts object keys but preserves layer/filter/effect/stop array order. Source blobs are never rewritten by parameter editing.

Store5 preserves the existing stores and records without flattening sessions. Existing `versionchange`, blocked-open, revision/recovery collision and unreleased-AI guards remain. R6/R7's explicit open4 fails with VersionError after migration. The actual pre-R8 main reader also rejects envelope9 and schema3; both were executed in compatibility validation. Chapter backup/recovery carries the typed session unchanged.

## Rendering order

Original editable artwork/gradient/strokes → legacy layer tone/color → ordered local Smart Filters → existing layer mask → projection → document-space layer styles from masked alpha → existing clipping stack → layer opacity/blend → existing isolated hierarchy/backdrop R6 adjustments. Style order applies within exterior-behind/interior-on-fill planes; it does not move an exterior shadow above fill. R6 adjustments never receive artwork filters/effects. R7's temporary Quick Mask paint layer cannot receive either.

Filters operate before the layer mask. Their own selection masks mix the input/output of that filter in premultiplied alpha. Gaussian and Motion share R6 kernels with an explicit coverage-blur mode; destructive R6 defaults remain unchanged. Other spatial filters preserve source coverage as documented. Clamp borders are used. Styles reuse zero-exterior mask blur/morphology, W3C blend operations and the existing projected-surface engine. Pattern Overlay uses portable checker/stripe/dot recipes rather than external texture assets. Relief uses smoothed-alpha normal approximations and signed directional lighting, clipped to fill alpha.

Native settings remain editable; image exports flatten the rendered composite. PNG preview/native/recovery comparisons are exact. JPEG/WebP checks compare the same deterministic encoding before/after recovery rather than expecting lossy output to equal PNG. SVG explicitly rejects unsupported gradient layers, adjustments, effects and active Smart Filters instead of silently dropping them.

## Resource and compatibility limits

Smart Filter source frames remain at most4MP and128M aggregate native kernel samples per layer and visible document. New advanced styles require a native document plane up to4MP/16384px per side including padding, with128M visible style-pixel work units. Existing source/document/asset/metadata budgets remain in force. A small preview cannot bypass native limits. Ordinary native gradients retain the existing16.8MP document budget; the measured4096² case contains no spatial filters/styles.

R8 properties use a dedicated existing renderer with one active/latest queued preview, stale-result identity checks and immediate worker disposal on cancellation. No competing history engine, hidden bitmap snapshots, automatic source downscaling, ICC/wide-gamut/16-bit claim or GPU requirement is introduced. Spatial/style tiling beyond these bounds is deferred until halo, projection and peak-memory correctness can be validated.

Enabled Smart Filters must be disabled before selected-pixel lifting or destructive mask baking; whole-layer transforms and ordinary mask/source painting remain supported. R6 destructive color processing reads pre-stack base content and retains the stack, preventing double application. Native/R6/R7/recovery evidence and exact limits are recorded in the R8 implementation and test reports.
