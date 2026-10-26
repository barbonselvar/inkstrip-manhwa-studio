# R8 local browser-test server initialization

Run source-module browser probes against a development server initialized with:

```sh
npm run dev -- --config scripts/vite-browser-qa.config.mjs --host 127.0.0.1 --port 8083
node scripts/dialogue-ocr-browser-check.mjs http://127.0.0.1:8083
```

The test-only config extends the normal Vite config and eagerly includes
`tesseract.js` and `idb-keyval` in dependency optimization. Production build,
production OCR, workers, models and test assertions are unchanged. Existing
optimizer includes are preserved. Use the ordinary production build and preview
for tests that do not import source modules.

The initial page crawl does not discover OCR's nested worker dependencies.
Importing only `ocr.ts` initializes a facade; its runtime is loaded when a worker
is created. Vite previously discovered those packages during the first inference,
reloaded the page, and destroyed the test's pending execution context. The same
unchanged test failed identically on pre-R8 main `02eb697`; it is an environment
initialization issue, not an R8 pixel/OCR defect.

An import-only warmup was investigated but can return before Vite's scheduled
reload. Startup pre-bundling removes that race. A fresh-cache run of the original
test passed all five languages, cached inference, corruption rejection and
cancellation with no optimizer reload. There are no added delays, looser
assertions, model mocks or skipped checks. The original failure and main
comparison are retained in the R8 evidence. Test output's character coverage is
a synthetic-fixture diagnostic, not proof of accuracy on arbitrary comics.
