# echo ECOSYSTEM research — FINAL REPORT

> Researcher: ECOSYSTEM (CP123 Wave-R). Domain: rate-limiting / caching. Date: 2026-06-16.
> 11 files, ~900 lines, all in `~/echo/brain/research/raw/`. Every claim cited.

## Files written (paths + ~line counts)
1. `ecosystem-00-INDEX-and-boundary.md` (~90) — the turbo↔echo boundary (verbatim quotes) + what echo IS
2. `ecosystem-01-versions-changelogs.md` (~70) — current versions + 6-mo deltas (gh-API-authoritative dates)
3. `ecosystem-02-upstash-ratelimit.md` (~119) — @upstash/ratelimit deep-dive, all load-bearing flows
4. `ecosystem-03-algorithms.md` (~85) — fixed/sliding/token-bucket/GCRA with formulas + taste
5. `ecosystem-04-redis-upstash.md` (~69) — store layer: Upstash/Vercel-KV/CF-KV/Valkey + pricing
6. `ecosystem-05-edge-caching.md` (~115, edited) — SWR, revalidateTag traps, CF binding (verbatim), invalidation taxonomy
7. `ecosystem-06-idempotency.md` (~77) — the Stripe idempotency pattern, the other half echo owns
8. `ecosystem-07-starter-repos.md` (~60) — best starter/example repos ranked
9. `ecosystem-08-github-issues.md` (~83) — top issues revealing real breakage
10. `ecosystem-09-tradeoff-matrix.md` (~64) — honest competing-tools matrix + the security bugs
11. `ecosystem-10-agent-operating.md` (~68) — CLIs/APIs/MCPs an AGENT needs

## Top 10 findings (one line each)
1. **The boundary is exact and turbo's brain names it:** "Rate-limit/cache = echo's seam (external store, never `new Map()`)" — turbo DOCUMENTS the anti-pattern, echo SOLVES it. (turbo EXPERTISE-MAP:23, tradeoff-matrix:69-70)
2. **echo's signature law extends the energy `new Map()` rule with a SECOND axis:** not just "empty on cold start" but "**shared & raced under Vercel Fluid Compute → cross-user data bleed**" (a security bug, invisible in `vercel dev`). (turbo S-01, OPINIONS:23)
3. **@upstash/ratelimit v2.0.8 (2026-01-12, 2,038★, MIT) is mature & barely-changing** — ONE release in the last 6 months (CVE fix + dynamic limits); risk is staleness-vs-platform, not churn.
4. **The ONE legitimate module-scope Map** is the `ephemeralCache` — but only as a *lossy cache over Redis*, never the source of truth. echo owns teaching this distinction.
5. **Upstash sliding-window is the sane default; the exact weighted formula is `rate = prev*((period-elapsed)/period) + curr`**, an approximation assuming uniform prior-window flow.
6. **Cloudflare Workers `ratelimit` binding is per-PoP, eventually-consistent, "NOT an accurate accounting system"** (CF's own words) — use a Durable Object for exact global counting.
7. **`timeout` makes @upstash/ratelimit fail-OPEN (default 5s)** — correct for product APIs, a FOOTGUN for security-critical limits which must fail-CLOSED. The fail-open/closed decision is echo's core judgment call.
8. **Wrong key extraction = silent total bypass:** express-rate-limit #234 (proxy appends `:port` to XFF → every request its own bucket). Cloudflare independently says "don't key on IP." echo's key must be stable authenticated identity.
9. **Stripe idempotency = request-fingerprint check + 24h TTL + atomic SET NX + fail-CLOSED** — same distributed-state class as rate limiting but inverts the fail knob (correctness > availability).
10. **Vercel `revalidateTag` is LAZY (marks stale, refetches on next visit via SWR), not an immediate purge** — the #1 "why is my cache still stale" confusion; plus the server-DataCache vs client-RouterCache two-cache disagreement.

## Bonus findings (worth keeping)
- Cloudflare KV is a read-cache, NOT a counter store ($5/M writes = 10× reads; eventually consistent).
- @upstash/ratelimit is HTTP-Redis-ONLY (issue #115 open) — for TCP-Redis on long-running Node use `rate-limiter-flexible` (3,558★, the multi-backend swiss-army, also has concurrency limiting).
- On edge, **always `context.waitUntil(pending)`** when analytics/multi-region is on, or writes silently drop.
- `getRemaining(id)` reads quota WITHOUT consuming (issue #17, 18 comments of confusion) — don't GET the Redis key directly.
- Upstash ships BOTH an MCP server (`upstash/mcp-server`) AND Context7 (57.5k★ docs MCP) — the agent-native operate + stay-current surface.
- Valkey (BSD Redis fork, in AWS ElastiCache since Oct-2024) is the license-clean self-host Redis; treat "Redis" as "Redis/Valkey/Redict."
- Dynamic Limits (v2.0.8) = change limits at runtime without redeploy — the 2026 headline feature.

## 3 things I could NOT confirm (for GAPS-AND-DISPUTES)
1. **Independent (non-Upstash) latency benchmark.** The "Upstash Redis fastest, Cloudflare KV slowest" ranking is from Upstash's OWN blog (vendor-biased). The architectural reasoning is sound, but a neutral third-party benchmark would be needed to trust the magnitudes. (flagged in ecosystem-04)
2. **Reaction-sorted top-issues for `rate-limiter-flexible` and `express-rate-limit` at full depth.** I captured the headline issues (#234 bypass, #176 redis-v4, #290 Valkey, #168 standardization) but prioritized the upstash issue dump as echo's flagship; a deeper `gh api .../issues?sort=reactions` pass on both would round out ecosystem-08. (flagged in ecosystem-08)
3. **Current Vercel KV provisioning path (post-Marketplace transition).** Vercel KV "is Upstash under the hood," but Vercel has been moving KV to the Marketplace / native-Upstash over 2025-26; I could not pin the EXACT current provisioning UX/SKU as of June 2026 — verify before advising. (flagged in ecosystem-04)

## Sources count
~38 distinct sources cited across the 11 files: official docs (Upstash ratelimit algorithms/
features/methods, Cloudflare rate-limit-binding + DO + KV + cache + changelog, Next.js
revalidateTag/revalidating, Stripe idempotency blog), GitHub (upstash/ratelimit-js issues
#9/#14/#17/#58/#59/#71/#80/#115 + releases API, animir/rate-limiter-flexible issues
#103/#176/#287/#290, express-rate-limit issues #32/#168/#234/#533/#624, vercel/next.js
discussions #56822/#84805/#91785, Losant/redis-gcra, redis/node-redis, redis/ioredis,
upstash/mcp-server, upstash/cli, upstash/context7), canonical explainers (brandur.org/rate-
limiting, Wikipedia GCRA), comparison/pricing (buildmvpfast.com api-costs/cache, johal.in),
practitioner guides (zuplo, codelit.io, httptoolkit idempotency RFC, medium idempotency posts),
AWS Valkey announcement, npm registry, and the internal corpus (energy
.claude/rules/typescript.md:13 + turbo brain EXPERTISE-MAP/OPINIONS/BATTLE-TESTED-SCENARIOS/
tradeoff-matrix). gh-API release timestamps were treated as authoritative over WebFetch
page-scrape years.
