# Phase 5 — Local illustrated-face detection and manual masks

Retouch → Detect possible anime faces runs the trained `lbpcascade_animeface`
20-stage BOOST/LBP model locally in a disposable worker. This is a genuine learned
classifier, not face-shaped heuristics. Parameters are converted losslessly from
nagadomi's MIT-licensed XML at commit
`4433ab1ae1166ea75acfe99eb0f18709dac329a0` into a bundled small JSON model.
The original license and source SHA-256 are in `src/lib/studio/faces/LICENSE.txt`.
No network model download, credentials, GPU, WebGPU or external image upload is
needed. MIT also covers this project's integral-image and LBP evaluator source.

The worker uses grayscale histogram equalization, a multiscale pyramid capped to
1024px and repeated-window grouping. Candidate faces are suggestions. No identities
are inferred, scored or merged. Select a numbered candidate to produce an ellipse
mask; numeric bounds (% of original image) adjust it. Existing ellipse, rectangle,
lasso, brush/subtract tools offer manual correction at original-image coordinates.
A manual ellipse can snap to an overlapping detected face after detection; if no
candidate overlaps, the manual region is retained with an honest message.

Limitations: frontal anime faces are the model's main domain, not a validated
universal manhwa benchmark. Profiles, extreme angles, occlusion, realistic faces,
tiny characters in tall chapters and unusual illustration styles can be missed.
False positives need manual rejection. Detection boxes are not segmentation.
The maximum preview side is 1024px and maximum source area 16MP. Manual masks do
not depend on detector availability. Pointer events support mouse, touch and pen;
Pan mode prevents mask drawing while moving through a zoomed image. Cancel closes
the worker immediately. Original resolution/pixels are not changed by detection.

Tests cover integral images, equalization, rejection, repeated-window grouping and
separate candidates. Browser QA supplies an uncommitted public upstream example
explicitly as a command argument; that artwork is not shipped in the patch. Manual
QA: detect, choose one face, adjust its bounds, refine, then use lasso and subtract
to correct it. On a profile that fails detection, keep manual selection.
