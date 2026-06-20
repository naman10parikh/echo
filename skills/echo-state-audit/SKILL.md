---
name: echo-state-audit
description: The flagship — audit any place you are about to store cross-request state on serverless. Use BEFORE writing a rate-limit counter, a cache value, a session, or an idempotency record in app/api/** (or any serverless handler). Distinguishes a source-of-truth Map (P-01, a BUG) from the one legit ephemeralCache Map (P-02, OK). This is the turbo seam echo OWNS — turbo forbids the pattern, echo provides the correct externalization.
---

# echo-state-audit — the `new Map()`-on-serverless judgment (the turbo seam)

> **Brain anchors:** O-01, O-02 (OPINIONS) · P-01, P-02, P-03 (KNOWN-PITFALLS) · S-01 (BATTLE-TESTED-SCENARIOS).
> This is the FLAGSHIP skill — the single judgment that defines echo. It is the rule behind `echo audit`
> (the CLI) and `echo-state-guard` (the PreToolUse hook). One rule, one place: both call `scanText` from
> `src/lib/map-detector.ts`.

## Trigger

Fire this skill the moment any of these is true:

- About to store a **rate-limit counter**, a **cache value**, a **session**, a **deny/ban list**, or an
  **idempotency record** in a serverless handler (`app/api/**`, `pages/api/**`, a Vercel/Cloudflare/Lambda function).
- You see (or are about to write) `new Map()` / `new Set()` / `new LRU()` / `= {}` / `const cached = ...` at
  **module scope** in a serverless file.
- A reviewer or another agent proposes "fix the `new Map()`" — check FIRST whether it's the legit
  `ephemeralCache` (P-02) before deleting it.
- A bug report reads "user A sees user B's data" or "the limit holds locally but not in prod / after scaling."

## The one-line test (O-01)

> **"Is this a process the platform is free to share, recycle, or fan out?"**

If yes, it **cannot** hold authoritative cross-request state. On Vercel **Fluid Compute (default-on, 2026)** one warm
instance serves dozens (peaks past 250) of concurrent requests that **share** the Map → cross-user data bleed + a
**fail-open** limiter. It is also empty on cold start. **And it is invisible in `vercel dev`** (emulators don't reuse
containers) — so "it worked locally" proves nothing.

## The judgment: BUG (P-01) vs OK (P-02)

The distinction echo OWNS teaching — ask: **"if this Map is empty or stale, is the answer still safe?"**

| Construct | Verdict | Why |
| --- | --- | --- |
| `const counts = new Map()` used as the rate-counter source of truth | 🔴 **BUG (P-01)** | empty → grants access (fails OPEN); shared → cross-user bleed |
| `const cache = new Map()` holding the authoritative cached value | 🔴 **BUG (P-01)** | empty → always-miss; shared → serves another tenant's value |
| `ephemeralCache: new Map()` passed to `@upstash/ratelimit` | ✅ **OK (P-02)** | a lossy deny-list **over** Redis; empty → falls through to Redis → still safe. **Never "fix" it.** |
| `const pool = new Pool(...)` (DB connection pool) at module scope | ✅ **OK** | manages its own concurrency (O-01 escape hatch) |
| `const m = new Map()` **inside a function body** (request-local) | ✅ **OK** | per-request, not cross-request state |

The law: **a module-scope Map is FINE iff a miss is safe (a lossy cache over an authoritative external store),
a BUG iff a miss is unsafe (the store itself).** (O-02)

## Steps

1. **Locate** every cross-request store in scope:
   `echo audit <path>` — or `grep -rEn 'new (Map|Set)\(|=\s*\{\}|new LRU' app/api/ packages/*/src`.
2. **Classify each** with the one-line test + the table above. `echo audit` exits **1** on any P-01 BUG and
   prints `file:line  source-of-truth Map on serverless (P-01)`; it exits **0** when the only Maps are
   `ephemeralCache`/pools/locals (P-02).
3. **For each BUG, externalize** to the canonical home: **Upstash Redis** (the default) · Supabase · Vercel KV ·
   Cloudflare Durable Objects. For a limiter, hand off to `echo-limiter-design`; for a cache, to `echo-invalidation`;
   for an idempotency record, emit the Stripe pattern (`echo idempotency`).
4. **Watch for P-03:** a misspelled `ephermeralCache` silently no-ops (TS won't catch an unknown optional key) —
   verify the option name against the installed `@upstash/ratelimit` types.
5. **Re-run `echo audit` → expect exit 0** before you ship.

## Output format

A verdict list, one line per finding:

```
BUG  app/api/login/route.ts:7   source-of-truth Map on serverless (P-01)
       const counts = new Map<string, number>();
OK   app/api/login/route.ts:12  ephemeralCache: new Map() — the ONE legit module-scope Map (P-02)
```

Plus, per BUG, the externalization recommendation (which store + which sibling skill owns the fix). Exit non-zero iff
≥1 BUG. **Never report the ephemeralCache Map as a bug.**
