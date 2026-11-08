/** A completed workload is required; surviving a run with errors is not a pass. */
export function stabilityOutcome({ minutes, elapsedMs, cycles, crashed, errorCount, samples }) {
  const completed = Number.isFinite(minutes) && minutes > 0 &&
    Number.isFinite(elapsedMs) && elapsedMs >= minutes * 60_000 &&
    cycles > 0 && samples.length >= 2 && samples.at(-1).label === "end";
  return { completed, passed: completed && !crashed && errorCount === 0 };
}
