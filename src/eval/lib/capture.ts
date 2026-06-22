/**
 * echo eval — stdout/stderr capture helper (E1 support).
 *
 * echo's command emitters (`runLimiter`, `runCache`, `runIdempotency`, `runStampede`, `runStore`, …) write the
 * emitted CODE to stdout and the rationale to stderr, returning an exit code. The L1 golden assertions need that
 * emitted code AS A STRING to assert properties on it (does the limiter key on identity? is the cache TTL
 * jittered?). This helper runs an emitter, captures both streams, and returns `{ code, rc, stdout, stderr }` —
 * the same stdout-capture pattern the dispatch test already uses, factored into one place (Karpathy: one rule,
 * one place). Synchronous: echo's emitters are synchronous (no I/O), so we restore the streams in a `finally`.
 */

export interface Captured {
  /** exit code the emitter returned. */
  readonly rc: number;
  /** everything written to stdout (the emitted code). */
  readonly stdout: string;
  /** everything written to stderr (the rationale). */
  readonly stderr: string;
  /** convenience alias for stdout (the emitted code is on stdout). */
  readonly code: string;
}

/** Run a synchronous emitter that writes to stdout/stderr and returns an exit code; capture both streams. */
export function capture(fn: () => number): Captured {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((c: string | Uint8Array): boolean => {
    outChunks.push(typeof c === "string" ? c : Buffer.from(c).toString("utf8"));
    return true;
  }) as unknown as typeof process.stdout.write;
  process.stderr.write = ((c: string | Uint8Array): boolean => {
    errChunks.push(typeof c === "string" ? c : Buffer.from(c).toString("utf8"));
    return true;
  }) as unknown as typeof process.stderr.write;

  let rc: number;
  try {
    rc = fn();
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
  const stdout = outChunks.join("");
  const stderr = errChunks.join("");
  return { rc, stdout, stderr, code: stdout };
}
