# echo ECOSYSTEM research — INDEX + the turbo/echo boundary

> Researcher: ECOSYSTEM (CP123 Wave-R). Domain: **rate-limiting / caching**.
> Written 2026-06-16. All files in this dir use prefix `ecosystem-`.
> Every claim is cited inline: `(source: URL, date)` or `(source: <internal path>:LN)`.

## What echo IS (the one-paragraph that CLAUDE.md is missing)

echo is the Energy fleet's **rate-limiting and caching domain-expert harness**. It OWNS the
class of problems that arise the moment per-request work needs to remember something across
requests, across instances, or across the edge: **rate limiting** (token bucket / sliding
window / GCRA), **caching** (in-memory vs distributed, TTL, stale-while-revalidate), **cache
invalidation**, **idempotency keys**, and the **distributed-state correctness** problems that
serverless/edge platforms create. echo's signature law: *state that must outlive a request
lives in an external store (Upstash/Redis/KV/Durable Objects/Supabase) — never a process the
platform is free to share, recycle, or fan out.*

## The turbo ↔ echo boundary (LOAD-BEARING — quoted verbatim from turbo's brain)

turbo is the fleet's **backend/API-framework** expert (Hono · Zod · OpenAPI · serverless
correctness). turbo and echo share one seam, and turbo's own brain names it:

- **turbo `EXPERTISE-MAP.md:23` (verbatim):**
  > "ship to Vercel-Node, promote latency-critical routes to Workers. **Rate-limit/cache =
  > echo's seam, external store only.**"
  (source: ~/turbo/brain/EXPERTISE-MAP.md:23)

- **turbo `ecosystem-12-tradeoff-matrix.md:69-70` (verbatim):**
  > "ship to Vercel-Node, promote latency-critical routes to Workers. **Rate-limit/cache =
  > echo's seam (external store, never `new Map()`).**"
  (source: ~/turbo/brain/research/raw/ecosystem-12-tradeoff-matrix.md:69-70)

**The split in one sentence: turbo DOCUMENTS the anti-pattern, echo SOLVES it.**
- turbo's job: detect & forbid module-scope mutable state in `app/api/**` (the audit grep),
  explain *why* it bleeds, and point at "externalize."
- echo's job: own the *externalization* — pick the store, the algorithm, the key schema, the
  TTL, the invalidation strategy, the idempotency semantics, and the failure mode (fail-open
  vs fail-closed). echo is where "use Upstash" becomes a correct, tested rate limiter.

### The canonical bug echo inherits from turbo (turbo S-01, verbatim setup)

turbo `BATTLE-TESTED-SCENARIOS.md` S-01 🔴 "The cross-user data bleed (module state under
Fluid Compute)":
> "A turbo Vercel route caches a per-request value at module scope to 'avoid recomputation'
> … Vercel Fluid Compute is default-on; one warm instance serves dozens of concurrent
> requests … 'category reports started getting items from other categories.' User A sees User
> B's data … RESOLUTION. Treat everything outside the handler as a constant … For genuine
> cross-request cache/session, externalize to Upstash/Supabase or pass the ID from the client
> (the energy `new Map()` law). *This is not a Fluid Compute bug; it is a pre-existing code
> smell that isolation was hiding.*"
(source: ~/turbo/brain/BATTLE-TESTED-SCENARIOS.md:23-29)

turbo OPINIONS O (verbatim, the second reason the law is now right):
> "the energy `new Map()` law was right for one reason (empty on cold start) and is now right
> for a second (Vercel Fluid Compute, default-on 2026, shares & races module state across
> concurrent requests on one warm instance — peaks past 250) … State that must outlive a
> request lives in Upstash/Supabase/KV/Durable-Objects — never a process the platform is free
> to share, recycle, or fan out."
(source: ~/turbo/brain/OPINIONS.md:23)

### The energy law echo enforces (verbatim, the rule both repos cite)

energy `.claude/rules/typescript.md:13`:
> "**NEVER use `new Map()` for cross-request state in Vercel API routes (`app/api/`). Each
> request may hit a cold Lambda with empty state. Use external stores (Supabase, Upstash) or
> pass IDs from client.**"
(source: ~/energy/.claude/rules/typescript.md:13)

**echo extends this law with the SECOND failure axis turbo flagged:** the original 2018-era
reason was *cold-start empties the Map*. The 2026 reason — and the more dangerous one — is
**Fluid Compute concurrency**: a warm instance now serves many concurrent requests in one
process, so a module-scope `Map`/`Set`/object isn't just empty, it's **shared and raced**,
producing cross-user data bleed (a security bug, not just a cache miss). echo owns both the
*detection refinement* (the bug is invisible in `vercel dev` — local emulators don't reuse
containers) and the *fix* (the distributed store + the correct key + the correct TTL).

## File index (this directory)

- `ecosystem-00-INDEX-and-boundary.md` — this file (boundary + scope)
- `ecosystem-01-versions-changelogs.md` — current versions + 6-month changelog deltas
- `ecosystem-02-upstash-ratelimit.md` — @upstash/ratelimit deep-dive (the canonical lib)
- `ecosystem-03-algorithms.md` — token bucket / sliding window / GCRA, with taste
- `ecosystem-04-redis-upstash.md` — Redis / Upstash / serverless-Redis store layer
- `ecosystem-05-edge-caching.md` — Cloudflare / Vercel edge cache, SWR, invalidation
- `ecosystem-06-idempotency.md` — idempotency caches (the other half of echo)
- `ecosystem-07-starter-repos.md` — best starter/template/example repos
- `ecosystem-08-github-issues.md` — top GitHub issues revealing real breakage
- `ecosystem-09-tradeoff-matrix.md` — competing tools honest trade-off matrix
- `ecosystem-10-agent-operating.md` — what an AGENT (not human) needs: CLIs, APIs, MCPs
- `ecosystem-99-REPORT.md` — final plain-text report (findings + gaps + source count)
