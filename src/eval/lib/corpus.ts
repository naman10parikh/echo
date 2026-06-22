/**
 * echo eval — L2 calibration corpus (E1; Hamel "binary not Likert", F1≥0.8 / κ≥0.6 on 50–100 rows).
 *
 * HARNESS-OVERRIDES §9 requires the L2 behavioral golden tasks to be calibrated as BINARY classifiers on 50–100
 * rows mined from the BATTLE-TESTED-SCENARIOS WRONG-MOVE / RESOLUTION pairs. A "vibe" pass is not evidence; a
 * classifier with a measured F1 is. This file is that labeled corpus: each row is a real code snippet shaped like
 * either the WRONG MOVE (`label:"bad"`) or the RESOLUTION (`label:"good"`) for one of echo's binary judgments.
 * The eval runner runs echo's OWN detector/assertion as the classifier over these rows and computes precision /
 * recall / F1 / Cohen's κ — proving the assertion is a calibrated decision, not a coin flip.
 *
 * Two corpora, the two most-checkable judgments:
 *   - `MAP_DETECTOR_CORPUS` — S-01/P-01: a source-of-truth `new Map()` counter on serverless (bad) vs the
 *     legit `ephemeralCache`/connection-pool/request-local Map (good). Classifier = `scanText` (the SHIPPED
 *     detector behind `echo audit` + the state-guard hook).
 *   - `SPOOFABLE_KEY_CORPUS` — S-02/P-04: a limiter keyed on a client-settable header (bad) vs authenticated
 *     identity / infra-written IP (good). Classifier = `keysOnSpoofableHeader` below.
 *
 * Each corpus has ≥25 rows (≥50 total) with a deliberate good/bad mix and the hard near-misses (the pool, the
 * ephemeralCache, the in-handler local) that separate a real classifier from a naive `grep "new Map"`.
 */

/** One labeled corpus row. */
export interface CorpusRow {
  /** a short id for the row, traceable to its source scenario. */
  readonly id: string;
  /** the code snippet (one or a few lines). */
  readonly code: string;
  /** ground truth: "bad" = the WRONG MOVE (a real bug), "good" = the RESOLUTION (correct). */
  readonly label: "bad" | "good";
  /** which scenario the row was mined from (S-01..S-19). */
  readonly from: string;
}

// ── S-01 / P-01 / P-02: the source-of-truth-Map detector corpus (echo's flagship judgment). ──────────────────────
// `bad` = a module-scope Map/Set/{}/LRU used as the source of truth (P-01). `good` = ephemeralCache (P-02), a
// connection pool (O-01 escape hatch), an in-handler request-local Map, or correct externalized state.
export const MAP_DETECTOR_CORPUS: readonly CorpusRow[] = [
  // --- bad: source-of-truth Maps on serverless (the WRONG MOVE in S-01) ---
  { id: "md-b01", from: "S-01", label: "bad", code: `const counts = new Map<string, number>();` },
  { id: "md-b02", from: "S-01", label: "bad", code: `const rateLimits = new Map();` },
  { id: "md-b03", from: "S-01", label: "bad", code: `let cache = new Map<string, User>();` },
  { id: "md-b04", from: "S-01", label: "bad", code: `const seen = new Set<string>();` },
  { id: "md-b05", from: "S-01", label: "bad", code: `const buckets = new Map<string, number[]>();` },
  { id: "md-b06", from: "S-01", label: "bad", code: `var counter = {};` },
  { id: "md-b07", from: "S-01", label: "bad", code: `const sessionStore = {};` },
  { id: "md-b08", from: "S-04", label: "bad", code: `const inFlight = new Map<string, Promise<unknown>>();` },
  { id: "md-b09", from: "S-13", label: "bad", code: `const idempotencyKeys = new Map<string, string>();` },
  { id: "md-b10", from: "S-01", label: "bad", code: `const requestCounts = new LRUCache({ max: 5000 });` },
  { id: "md-b11", from: "S-01", label: "bad", code: `const limits = new LRU(1000);` },
  { id: "md-b12", from: "S-01", label: "bad", code: `let cacheStore: Record<string, number> = {};` },
  { id: "md-b13", from: "S-01", label: "bad", code: `export const counts = new Map<string, number>();` },
  { id: "md-b14", from: "S-01", label: "bad", code: `const userCache = new WeakMap();` },
  { id: "md-b15", from: "S-04", label: "bad", code: `const dedupeMap = new Map();` },

  // --- good: the legit module-scope Map (P-02), pools (O-01 escape hatch), externalized state, request-local ---
  { id: "md-g01", from: "S-01", label: "good", code: `  ephemeralCache: new Map(),` },
  { id: "md-g02", from: "S-01", label: "good", code: `const ratelimit = new Ratelimit({ redis, limiter, ephemeralCache: new Map() });` },
  { id: "md-g03", from: "S-01", label: "good", code: `const pool = new Pool({ connectionString: process.env.DATABASE_URL });` },
  { id: "md-g04", from: "S-01", label: "good", code: `const connectionPool = createPool({ max: 10 });` },
  { id: "md-g05", from: "S-01", label: "good", code: `const redis = Redis.fromEnv();` },
  { id: "md-g06", from: "S-01", label: "good", code: `const db = drizzle(pool);` },
  { id: "md-g07", from: "S-01", label: "good", code: `export async function POST(req) {\n  const local = new Map();\n  local.set("x", 1);\n}` },
  { id: "md-g08", from: "S-01", label: "good", code: `function handler() {\n  const seen = new Set<string>();\n  return seen;\n}` },
  { id: "md-g09", from: "S-01", label: "good", code: `const prisma = new PrismaClient();` },
  { id: "md-g10", from: "S-04", label: "good", code: `await redis.set(\`lock:\${key}\`, token, { nx: true, ex: 5 });` },
  { id: "md-g11", from: "S-01", label: "good", code: `const limiter = Ratelimit.slidingWindow(5, "60 s");` },
  { id: "md-g12", from: "S-01", label: "good", code: `  // a local map inside the request handler\n  const tmp = new Map();` },
  { id: "md-g13", from: "S-01", label: "good", code: `const router = new Router();` },
  { id: "md-g14", from: "S-01", label: "good", code: `const app = new Hono();` },
  { id: "md-g15", from: "S-01", label: "good", code: `  ephemeralCache: new Map(), // lossy deny-list over Redis (P-02)` },
  // extra hard near-misses + clear positives (push the calibration corpus ≥50 rows total)
  { id: "md-b16", from: "S-01", label: "bad", code: `const apiCallCounts = new Map<string, number>();` },
  { id: "md-b17", from: "S-08", label: "bad", code: `const cachedTokens: Record<string, string> = {};` },
  { id: "md-b18", from: "S-01", label: "bad", code: `let store = new Map();` },
  { id: "md-g16", from: "S-01", label: "good", code: `const kv = await getCloudflareKV();` },
  { id: "md-g17", from: "S-01", label: "good", code: `const store = new DurableObjectStub(id);` },
] as const;

// ── S-02 / P-04: the spoofable-header-key detector corpus. ───────────────────────────────────────────────────────
// `bad` = the limiter key is derived from a client-settable header (silent total bypass). `good` = keyed on
// authenticated identity or the infra-written value.
export const SPOOFABLE_KEY_CORPUS: readonly CorpusRow[] = [
  // --- bad: keyed on a client-settable header (the WRONG MOVE in S-02) ---
  { id: "sk-b01", from: "S-02", label: "bad", code: `const key = req.headers["x-forwarded-for"];` },
  { id: "sk-b02", from: "S-02", label: "bad", code: `const id = request.headers.get("x-forwarded-for") ?? "anon";` },
  { id: "sk-b03", from: "S-02", label: "bad", code: `ratelimit.limit(req.headers["x-real-ip"]);` },
  { id: "sk-b04", from: "S-02", label: "bad", code: `const bucket = headers["true-client-ip"];` },
  { id: "sk-b05", from: "S-02", label: "bad", code: `const ip = req.headers["x-forwarded-host"];` },
  { id: "sk-b06", from: "S-02", label: "bad", code: `limiterKey(request.headers.get("X-Forwarded-For"));` },
  { id: "sk-b07", from: "S-02", label: "bad", code: `const k = ctx.req.header("x-real-ip") || "0.0.0.0";` },
  { id: "sk-b08", from: "S-02", label: "bad", code: `await rl.limit(req.headers["X-Real-IP"] as string);` },
  { id: "sk-b09", from: "S-02", label: "bad", code: `const identifier = headers.get("true-client-ip");` },
  { id: "sk-b10", from: "S-02", label: "bad", code: `key = \`rl:\${req.headers["x-forwarded-for"]}\`;` },

  // --- good: keyed on authenticated identity / the infra-written value (the RESOLUTION) ---
  { id: "sk-g01", from: "S-02", label: "good", code: `const key = session.userId;` },
  { id: "sk-g02", from: "S-02", label: "good", code: `const id = getAuthenticatedId(req) ?? ip64(req);` },
  { id: "sk-g03", from: "S-02", label: "good", code: `ratelimit.limit(\`user:\${auth.userId}\`);` },
  { id: "sk-g04", from: "S-02", label: "good", code: `const identity = apiKey ?? socketIp;` },
  { id: "sk-g05", from: "S-02", label: "good", code: `const key = req.auth.apiKeyId;` },
  { id: "sk-g06", from: "S-02", label: "good", code: `const ip = request.ip; // the value Vercel's edge wrote (trusted)` },
  { id: "sk-g07", from: "S-02", label: "good", code: `await rl.limit(clerkUserId);` },
  { id: "sk-g08", from: "S-02", label: "good", code: `const identifier = \`tenant:\${tenantId}:user:\${userId}\`;` },
  { id: "sk-g09", from: "S-02", label: "good", code: `const k = normalizeIpv6(socket.remoteAddress, 64);` },
  { id: "sk-g10", from: "S-02", label: "good", code: `const key = ip64FromTrustedProxy(req);` },
] as const;
