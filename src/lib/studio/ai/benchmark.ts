/** Pixel metrics are integrity measurements, never anatomy/identity or aesthetic quality scores. */
export function integrityMetrics(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
  coverage: Uint8Array,
) {
  if (before.length !== after.length || before.length !== coverage.length * 4)
    throw Error("Benchmark dimensions do not match.");
  let protectedPixels = 0,
    protectedMaxError = 0,
    alphaChanges = 0,
    changedPixels = 0,
    totalError = 0;
  for (let i = 0; i < coverage.length; i++) {
    let error = 0;
    for (let c = 0; c < 4; c++)
      error = Math.max(error, Math.abs(before[i * 4 + c]! - after[i * 4 + c]!));
    if (error) changedPixels++;
    if (before[i * 4 + 3] !== after[i * 4 + 3]) alphaChanges++;
    if (!coverage[i]) {
      protectedPixels++;
      protectedMaxError = Math.max(protectedMaxError, error);
    }
    for (let c = 0; c < 3; c++) totalError += Math.abs(before[i * 4 + c]! - after[i * 4 + c]!);
  }
  return {
    protectedPixels,
    protectedMaxError,
    alphaChanges,
    changedPixels,
    meanChannelChange: totalError / (coverage.length * 3 || 1),
  };
}
