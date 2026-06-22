/**
 * echo map-detector — the P-01/P-02 source-of-truth detector (the turbo seam echo OWNS).
 *
 * This is the load-bearing judgment of echo's signature command (`echo audit`, B3) and its PreToolUse hook
 * (`echo-state-guard`, B5). Both import `scanSource` / `scanText` from here so the rule lives in ONE place
 * (keys-as-contracts, O-13 applied to our own code). Do NOT duplicate this logic in the hook.
 *
 * The rule (brain O-01/O-02, P-01/P-02):
 *   - A module-scope `new Map()/Set()/{}/new LRU()` used as the SOURCE OF TRUTH for cross-request state
 *     (a rate counter / a cache value / an idempotency record) on serverless is a BUG (P-01) — empty on cold
 *     start AND raced+shared under Vercel Fluid Compute (cross-user bleed + fail-open limiter).
 *   - The ONE legitimate module-scope Map is `ephemeralCache: new Map()` passed to `@upstash/ratelimit` (P-02):
 *     a lossy deny-list cache OVER Redis — if empty/stale the request falls through to Redis, so the answer is
 *     still safe. NEVER flag this one.
 *
 * The distinction echo teaches: "if this Map is empty/stale, is the answer still safe?" ephemeralCache → safe
 * (falls through to the store); the counter itself → unsafe (grants access). Regex-level, not a full TS parse:
 * we look for the construction and decide BUG-vs-OK from its immediate textual context, which is what makes the
 * detector robust to a malformed TS file (Testing §9 chaos: no crash, graceful exit).
 */

/** One detector finding. */
export interface MapFinding {
  /** Repo-relative (or given) file path. */
  readonly file: string;
  /** 1-based line number of the construction. */
  readonly line: number;
  /** "bug" = source-of-truth Map (P-01); "ok" = ephemeralCache Map (P-02). */
  readonly kind: "bug" | "ok";
  /** The matched source line, trimmed. */
  readonly code: string;
  /** Human reason, naming the brain anchor. */
  readonly reason: string;
}

/** Result of scanning one file's text. */
export interface ScanResult {
  readonly bugs: readonly MapFinding[];
  readonly okMaps: readonly MapFinding[];
}

// Constructs that hold cross-request state if used as a source of truth.
//   new Map() / new Set() / new WeakMap() / new LRU*() / new LRUCache() / `= {}` object-literal store
//   (the optional `<...>` allows a generic type arg, e.g. `new Map<string, number>()`).
const STATE_CTOR_RE = /\bnew\s+(Map|Set|WeakMap|WeakSet|LRU\w*|LRUCache)\s*(?:<[^>]*>)?\s*\(/;
// A bare module-scope object-literal assigned to a const/let that reads like a store/cache/counter.
const OBJECT_STORE_RE = /\b(?:const|let|var)\s+(\w*(?:cache|counts?|counter|limits?|store|buckets?|sessions?|seen|requests?)\w*)\s*(?::[^=]+)?=\s*\{\s*\}/i;
// The ONE legit module-scope Map: passed as `ephemeralCache:` (to @upstash/ratelimit). P-02.
const EPHEMERAL_RE = /ephemeralCache\s*:/;

/**
 * A declaration is request-local (not the P-01 surface) when it sits inside a function body rather than at module
 * scope. Module-scope cross-request state is the risk (empty on cold start + shared/raced under Fluid Compute); an
 * in-handler `const m = new Map()` is per-request, safe (O-01 escape hatch; flagship skill's BUG/OK table).
 *
 * The discriminator is INDENTATION, not the keyword: a `const/let/var` (or a bare construction) at column 0 is
 * module scope; the SAME keyword indented inside a brace block is request-local. (The earlier
 * `indented && !module-scope-keyword` check was self-contradictory — an indented `const` matches the keyword regex
 * because `^\s*` eats the indentation, so a real in-handler `const m = new Map()` was wrongly flagged as P-01.)
 */
function isLocalDeclaration(rawLine: string): boolean {
  return /^[ \t]+/.test(rawLine); // indented → inside a function body → request-local (not module-scope state)
}

/**
 * Scan a file's text for source-of-truth Maps. Pure + synchronous + crash-proof: any malformed input simply
 * yields no/partial findings, never throws.
 */
export function scanText(file: string, text: string): ScanResult {
  const bugs: MapFinding[] = [];
  const okMaps: MapFinding[] = [];
  let lines: string[];
  try {
    lines = String(text).split("\n");
  } catch {
    return { bugs, okMaps };
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue; // skip comments

    const hasEphemeral = EPHEMERAL_RE.test(raw);
    const hasStateCtor = STATE_CTOR_RE.test(raw);
    const hasObjectStore = OBJECT_STORE_RE.test(raw);

    // P-02: the legit ephemeralCache Map — explicitly ALLOW, record as ok (never a bug), and move on.
    if (hasEphemeral && hasStateCtor) {
      okMaps.push({
        file,
        line: i + 1,
        kind: "ok",
        code: trimmed,
        reason: "ephemeralCache: new Map() — the ONE legit module-scope Map (lossy deny-list over Redis, P-02)",
      });
      continue;
    }

    if (!hasStateCtor && !hasObjectStore) continue;

    // A construction that is NOT ephemeralCache. Decide bug-vs-ok by context.
    // OK signals: it's a DB connection pool (manages its own concurrency, O-01 escape hatch), or it's clearly
    // passed AS ephemeralCache on a nearby line, or it's an in-function local that is not module-scope state.
    const isPool = /\b(pool|createpool|connectionpool|drizzle|prisma|new\s+Pool)\b/i.test(raw);
    const isLocalScope = isLocalDeclaration(raw);
    const nextLine = lines[i + 1] ?? "";
    const prevLine = lines[i - 1] ?? "";
    const ephemeralNearby = EPHEMERAL_RE.test(nextLine) || EPHEMERAL_RE.test(prevLine);

    if (isPool) {
      okMaps.push({
        file,
        line: i + 1,
        kind: "ok",
        code: trimmed,
        reason: "connection pool at module scope — safe (manages its own concurrency, O-01 escape hatch)",
      });
      continue;
    }
    if (ephemeralNearby) {
      okMaps.push({
        file,
        line: i + 1,
        kind: "ok",
        code: trimmed,
        reason: "Map passed as ephemeralCache to @upstash/ratelimit (P-02)",
      });
      continue;
    }
    if (isLocalScope) {
      // A Map declared inside a function body is request-local, not cross-request state — not the P-01 bug.
      continue;
    }

    // Module-scope construction, not ephemeralCache, not a pool → source-of-truth Map on serverless (P-01).
    bugs.push({
      file,
      line: i + 1,
      kind: "bug",
      code: trimmed,
      reason: "source-of-truth Map on serverless (P-01)",
    });
  }

  return { bugs, okMaps };
}
