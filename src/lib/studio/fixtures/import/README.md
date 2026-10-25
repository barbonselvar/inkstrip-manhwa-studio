These tiny synthetic fixtures were created for Inkstrip R1.1 with Pillow from a
solid-color image and one changed pixel. No user or third-party artwork is used.
They may be reused under CC0-1.0. `tall.png` is a 1 × 50000 source-coordinate/side-limit
fixture; `animated.gif` and `animated.webp` have two 8 × 8 frames. `progressive.jpg`
tests progressive scan compatibility. `page.png` is 512 × 512 and
`batch-plane.png` is a solid 4000 × 4000 plane used to prove aggregate budgets
(preflight rejection without native decoding; chunked Chapter import). `iccp.png` is a 64 × 48 PNG carrying Pillow's
generated sRGB `iCCP` colour profile, as screenshots and editor exports commonly do. The other fixtures are 32 × 24 (except ICO,
which contains 16/24/32px square PNG representations).

Conversion fixtures (CC0-1.0, made with Pillow, pillow-heif and pillow-jxl-plugin from
`original.png`): `original.heic` (lossy HEIC), `original.jxl` (lossless JPEG XL),
`lzw.tiff`, `alpha.tiff` (Deflate RGBA with two edited alpha pixels), `rotated.tiff`
(Orientation 6), `multipage.tiff` (two pages) and `gray16.tiff` (16-bit grayscale).
They prove the Chapter conversion decoders (utif2, libheif-js, @jsquash/jxl) and the
lossless PNG encoder (fast-png).

TIFF and HEIF/HEIC header validation does not install a browser codec. Actual
decoding depends on the browser. AVIF, PNG/JPEG/WebP/GIF/BMP/ICO and safe SVG are
also checked in Chromium through the real Chapter workflow. Tests distinguish
header parsing, injected failure-boundary decoders and genuine browser decoding.
