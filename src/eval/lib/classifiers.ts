/**
 * echo eval — binary classifiers used by the L2 calibration (E1).
 *
 * Each classifier returns `"bad" | "good"` for a code snippet, mirroring a real echo judgment. They are run over
 * the labeled `corpus.ts` rows so the runner can compute precision / recall / F1 / κ (Hamel binary calibration).
 * The map-detector classifier delegates to the SHIPPED `scanText` (one rule, one place — the same detector behind
 * `echo audit` and the state-guard hook); the spoofable-key classifier is a focused regex matching the keying
 * surface (P-04). Pure + crash-proof.
 */
import { scanText } from "../../lib/map-detector.js";

/**
 * Classify a snippet as a source-of-truth Map bug ("bad", P-01) or safe ("good", P-02/pool/local) using the
 * production detector. "bad" iff `scanText` finds ≥1 bug and the snippet is NOT also recorded as an okMap on the
 * same line (ephemeralCache short-circuits to ok). This is exactly `echo audit`'s decision, applied to a snippet.
 */
export function classifyMap(code: string): "bad" | "good" {
  const res = scanText("corpus-row.ts", code);
  return res.bugs.length > 0 ? "bad" : "good";
}

// Client-settable headers an attacker can rotate for a fresh limiter bucket (P-04/S-02). Keying on any of these
// near a limiter/key construction is the bug.
const SPOOFABLE_HEADER_RE = /["'`]?\b(x-forwarded-for|x-forwarded-host|x-real-ip|true-client-ip)\b["'`]?/i;
// Signals the key is derived from a header read (`req.headers[...]`, `headers.get(...)`, `req.header(...)`).
const HEADER_READ_RE = /\bheaders?\b\s*(?:\.\s*get\s*\(|\[|\()/i;

/**
 * Classify a limiter-key snippet as spoofable ("bad", P-04) or safe ("good"). "bad" iff a client-settable header
 * name appears AND it is being read from the request headers (not, e.g., a comment that mentions the header while
 * keying on identity). Keying on `session.userId` / `auth.apiKeyId` / an infra-written `request.ip` → "good".
 */
export function classifySpoofableKey(code: string): "bad" | "good" {
  const hasSpoofable = SPOOFABLE_HEADER_RE.test(code);
  const readsHeader = HEADER_READ_RE.test(code) || /\bheaders\s*\[/.test(code);
  return hasSpoofable && readsHeader ? "bad" : "good";
}
