---
title: "echo FIELD-INTELLIGENCE — Internal Read-Only References (quoted, not edited)"
type: field-research
domain: rate-limiting / caching
created: "2026-06-16"
researcher: FIELD-INTELLIGENCE (CP123 Wave-R)
scope: "READ-ONLY internal corpus quoted to anchor echo's hard-won-lessons brain. External field research in field-01..field-NN."
sources_internal:
  - ~/energy/.claude/rules/typescript.md
  - ~/turbo/brain/KNOWN-PITFALLS.md
  - ~/turbo/brain/BATTLE-TESTED-SCENARIOS.md
  - ~/turbo/brain/OPINIONS.md
  - ~/turbo/brain/GAPS-AND-DISPUTES.md
  - ~/energy/audit/HARNESS-CHECKLIST-2026.md
---

# echo FIELD-INTELLIGENCE — Internal References (the laws echo inherits)

> echo is the fleet's **rate-limiting / caching domain expert**. Three internal documents already encode
> hard-won lessons in this exact vertical. This file quotes them verbatim so echo's brain treats them as
> first-class priors, and so the external field research (field-01+) can be cross-referenced against
> what the fleet already knows. **Do not edit the source files — they are owned elsewhere.**

---

## REF-1 — The energy law: `NEVER new Map() for cross-request state` (the Map bug class)

**Source:** `~/energy/.claude/rules/typescript.md` line 13 (glob-loaded on every `*.ts`/`*.tsx` edit).

Verbatim:

> "NEVER use `new Map()` for cross-request state in Vercel API routes (`app/api/`). Each request may hit a
> cold Lambda with empty state. Use external stores (Supabase, Upstash) or pass IDs from client."

**Why this is echo's founding law.** A rate limiter is *by definition* cross-request state (a counter shared
across requests for a key). A cache is *by definition* cross-request state (a value computed once, reused
across requests). The single most common naive implementation of both — `const counts = new Map()` /
`const cache = new Map()` at module scope — is exactly what this law bans. echo's entire reason to exist is
that this law has a **correct** alternative (Upstash/Vercel KV/Durable Objects) and a body of war stories
about getting it wrong. **This is REF-1: every echo answer about "where do I store the counter / the cached
value" starts here.**

---

## REF-2 — turbo's boundary note: the Map bug got WORSE in 2026 (cold-empty → warm-racy)

**Source:** `~/turbo/brain/KNOWN-PITFALLS.md` P-02 (🔴) + `BATTLE-TESTED-SCENARIOS.md` S-01 (🔴).

turbo (the backend-architecture employee) already escalated the energy law. The key 2026 update, verbatim
from turbo KNOWN-PITFALLS **P-02**:

> "**P-02 🔴 — `new Map()` / module-scope state on Vercel is now RACY, not just empty.**
> Bites: any cross-request cache/session/counter at module scope in `app/api/**`; the lazy-init
> `if (!cachedClient) cachedClient = createClient()`.
> Condition: Vercel **Fluid Compute default-on (2026)** — one warm instance serves dozens (peaks past 250)
> of concurrent requests. (Also still empty on cold start.)
> Detect: grep `app/api/**` for `let X = null; … if (!X) X =` in/above a handler; module-level arrays/objects
> that `.push`/accumulate; `new Map()`/`new Set()`/`{}` used as a cache at module scope. **Cannot be detected
> from `vercel dev`** — emulators don't reuse containers.
> Avoid: externalize to Upstash/Supabase or pass the ID from the client (the energy law). A DB *connection
> pool* is safe at module scope (it manages its own concurrency); a raw lazily-assigned client ref is not."

turbo **BATTLE-TESTED-SCENARIOS S-01** narrative (the cross-user data bleed), verbatim resolution + the
killer quote turbo attributes to the Fluid Compute discourse:

> "Treat everything outside the handler as a constant. Move mutable state into function scope. For genuine
> cross-request cache/session, externalize to Upstash/Supabase or pass the ID from the client (the energy
> `new Map()` law). Run the field-01 audit grep before shipping. *"This is not a Fluid Compute bug; it is a
> pre-existing code smell that isolation was hiding."*"

**echo's escalation of REF-2:** the bug class is now **two failure modes, not one**:
1. **Cold-empty** (2024 framing): a fresh Lambda has an empty Map → cache always misses, rate limiter always
   reads 0 → limiter is a no-op.
2. **Warm-racy** (2026 framing, Fluid Compute default-on): one warm instance serves 250+ concurrent requests
   that **share** the Map → cross-user data bleed (caching) AND a rate-limit counter that's wrong in *both*
   directions (shared across users who shouldn't share, lost across instances who should).

A naive in-process limiter is therefore not merely "weak" — it is a **correctness + security bug** under
Fluid Compute. echo must say this plainly.

---

## REF-3 — turbo S-12: the cache MIDDLEWARE cross-user leak is the same bug, one layer up

**Source:** `~/turbo/brain/BATTLE-TESTED-SCENARIOS.md` S-12 (Hono middleware CVE surface).

Verbatim (the cache-relevant part):

> "It's exposed to: … **cache middleware cross-user leakage** … The cache cross-user leak is exactly the
> `new Map()`-class bug (shared mutable state across requests) — echo (rate-limit/cache) must treat cache-key
> isolation as first-class. The meta-pattern: Hono's *runtime* is solid; the *middleware surface* is where
> the CVEs live."
> VERIFY: "cache keys are per-user/isolated."

**echo inherits this explicitly** — turbo's note literally names echo and assigns it "cache-key isolation as
first-class." So echo's cache layer must enforce: **the cache key includes the tenant/user/auth boundary**.
A cache keyed on URL alone, on a multi-tenant route, leaks user A's response to user B. This is the most
common cache bug that is *also* a security incident (see field research: Steam 2015, Cloudflare).

---

## REF-4 — turbo OPINIONS O-01: where cross-request state is allowed to live

**Source:** `~/turbo/brain/OPINIONS.md` O-01 (the energy-law rationale).

Verbatim:

> "the energy `new Map()` law was right for one reason (empty on cold start) and is now right for a second
> (Vercel Fluid Compute, default-on 2026, shares & races module state across concurrent requests on one warm
> instance — peaks past 250). … State that must outlive a request lives in Upstash/Supabase/KV/Durable-Objects
> — never a process the platform is free to share, recycle, or fan out."

**echo's canonical store list (inherited):** Upstash Redis · Supabase · Vercel KV · Cloudflare Durable Objects
/ Workers KV. "Never a process the platform is free to share, recycle, or fan out" is the one-line test echo
applies to any proposed counter/cache location.

---

## REF-5 — The checklist GAP echo is being built to close

**Source:** `~/energy/audit/HARNESS-CHECKLIST-2026.md` — "Rate limiting / caching / edge KV" section
(lines 345-348) + the rollup row (line 399).

Verbatim:

> "### Rate limiting / caching / edge KV
> Protect APIs from abuse; cache hot paths; **serverless-safe** (no in-process state on Vercel lambdas).
> **Default:** **Upstash Redis** (serverless, per-request) / **Vercel KV** / **Cloudflare Workers KV**.
> **GAP** — already mandated by `.claude/rules/typescript.md`: *"never `new Map()` for cross-request state in
> Vercel routes — use Upstash."*"

Rollup row (line 399):

> "| Product · C2 infra | Rate-limit/cache/KV | ❌ **GAP** — Upstash required by `typescript.md`, unwired |"

Also relevant, the **durable-job-queue** default (line 335) because retry storms (a thundering-herd cause)
live there:

> "**Default:** **Inngest** or **Trigger.dev** (serverless / AI-first). Alts: **BullMQ** (Redis self-host),
> **Temporal** (durable orchestration), **Upstash QStash** (HTTP queue). Webhooks → **Svix / Hookdeck**."

**echo's mandate (from the checklist):** the rate-limit/cache/KV component is an **❌ GAP** in the fleet —
"required by `typescript.md`, unwired." echo exists to wire it: pick the store, encode the patterns (token
bucket / sliding window / stampede protection / cache-key isolation), and own the war stories so the fleet
stops re-discovering them. The default stack is Upstash Redis (per-request) + `@upstash/ratelimit`.

---

## What the fleet does NOT yet have (echo's net-new contribution)

The internal corpus has the **Map-bug law** and the **cache-middleware leak**. It does **not** yet have:
- Cache-stampede / thundering-herd mitigation taste (single-flight, probabilistic early expiry, jitter, locks).
- Rate-limit **algorithm** taste (token bucket vs sliding window vs GCRA, and where each fails).
- Rate-limit **bypass** threat model (IP rotation, key rotation, X-Forwarded-For spoofing, residential proxies).
- **Upstash cost** war stories (per-command pricing blowups, the `@upstash/ratelimit` multi-command tax).
- Cache **invalidation** war stories (the "two hard things" applied — stale reads, dual-write races, TTL choice).
- Provider **migration** stories (Upstash↔Redis Cloud↔Vercel KV↔Cloudflare; what broke).

field-01..field-NN fill exactly these gaps with cited, June-2026-current external evidence.
