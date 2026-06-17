# echo ECOSYSTEM-01 — current versions + 6-month changelog deltas

> All versions verified 2026-06-16/17 via `gh api` + npm registry (authoritative) — NOT WebFetch
> guesses. Where WebFetch mis-dated a year, the `gh api published_at` value wins and is noted.

## The canonical-tool version table (June 2026)

| Tool | Latest | Released | Stars | License | Cadence signal |
|---|---|---|---|---|---|
| **@upstash/ratelimit** (JS/TS) | **2.0.8** | **2026-01-12** | 2,038 | MIT | slow/stable — on 2.0.x since Jul 2024 (source: `gh api repos/upstash/ratelimit-js/releases`) |
| **@upstash/redis** (JS SDK) | 1.35.x line (1.x) | active 2026 | — | MIT | HTTP/REST Redis client; the store under ratelimit (source: npmjs.com/package/@upstash/redis, 2026-06) |
| **Cloudflare Workers `ratelimit` binding** | **GA** | **2025-09-19** | n/a (platform) | n/a | GA, "recommended for all production workloads" (source: developers.cloudflare.com/changelog/2025-09-19-ratelimit-workers-ga/) |
| **express-rate-limit** | 7.x → **8.x** line | active (pushed 2026-06) | ~3.1k | MIT | 8.0 dropped Node <16, store API changes (source: github.com/express-rate-limit) |
| **rate-limit-redis** (store for above) | 4.x | pushed **2026-06-14** | 218 | MIT | actively maintained (source: `gh search repos`, 2026-06-16) |
| **rate-limiter-flexible** (animir) | 5.x line | active 2026 | ~3.3k | ISC | the "swiss-army" multi-backend limiter (source: npm, 2026-06) |
| **Vercel `@vercel/firewall`** / Vercel KV | platform | active 2026 | n/a | n/a | Vercel KV is now **powered by Upstash** / marketplace (source: vercel.com/docs, 2026-06) |

### @upstash/ratelimit-js full changelog (authoritative `published_at` dates)

(source: `gh api repos/upstash/ratelimit-js/releases`, retrieved 2026-06-16)

- **v2.0.8 — 2026-01-12** — "Fix React Server Components CVE vulnerabilities" · **"add global
  dynamic limit"** (the headline feature: change limits without redeploy via `dynamicLimits`)
  · "Remove large-group runners" · "bump next". **The CVE fix + dynamic limits are the only
  reason to be on ≥2.0.8.**
- **v2.0.7 — 2025-11-03** — "allow negative rate values" · test refactor.
- **v2.0.6 — 2025-07-24** — "Address Dependabot Alerts" · **"use eval instead of scriptload
  and evalsha"** (cold-start round-trip reduction on serverless — important for echo).
- v2.0.5 — 2024-12-05; v2.0.4 — 2024-10-23; v2.0.3 — 2024-09-11 ("Hardcode script hash values
  and deprecate `cacheScripts`" — reduces round trips on cold starts); v2.0.2 — 2024-08-27
  ("expose duration to outside"); v2.0.0 — 2024-07-16.

**6-month delta (Dec-2025 → Jun-2026): exactly ONE release (v2.0.8) in the window.** Takeaway
for echo: this library is **mature and barely-changing** — its surface is stable, the risk is
not churn but *staleness vs platform reality* (e.g. Fluid Compute concurrency wasn't on the
maintainers' radar when the API was designed). The npm registry shows **daily CI prereleases
through 2026-06-17** (`0.0.0-ci.*-20260617…`), so the repo is alive even though tagged releases
are rare. (source: registry.npmjs.org/@upstash/ratelimit dist-tags + time, 2026-06-17)

> ⚠️ CURRENCY FLAG: WebFetch on the GitHub releases page mis-rendered several years as "2024/
> 2025" for the newest tags. The `gh api` `published_at` timestamps above are authoritative and
> were used to correct them. Do not trust the scraped-page years.

### Dynamic Rate-Limits (the one genuinely new 2026 feature)

Upstash shipped **Dynamic Rate-Limits**: configure a limiter with `dynamicLimits: true` and
change the allowed rate at runtime (stored in Redis) **without redeploying** the app. This
matters for echo because the classic pattern — limit baked into code — forces a deploy to
react to abuse or a customer tier change. (source: upstash.com/blog/dynamic-rate-limits, 2026;
corroborated by v2.0.8 note "add global dynamic limit")

## Cloudflare platform deltas (last ~9 months)

- **2025-09-19 — Workers Rate Limiting binding GA.** The `[[unsafe.bindings]] ratelimit`
  binding (simple sliding-window, per-colo, namespace + `simple: {limit, period}`) is now
  stable. period is **10 or 60 seconds only**; it is **per-Cloudflare-location (PoP), NOT
  global** — a critical gotcha echo must document. (source:
  developers.cloudflare.com/changelog/2025-09-19-ratelimit-workers-ga/)
- **Durable Objects** remain the tool for **global/exact** rate limiting (single logical
  instance aggregates counts across PoPs). DO is GA; SQLite-backed DO storage is GA in 2026
  (cheaper, faster than the legacy KV-backed DO). No dedicated "DO rate-limit binding" exists —
  you implement the limiter inside a DO class. (source:
  developers.cloudflare.com/durable-objects/release-notes/ + best-practices/rules-of-durable-objects/, 2026-06)

## Honest staleness flags

- `@upstash/ratelimit` analytics dashboard and the multi-region (`MultiRegionRatelimit`) path
  are stable but lightly documented; verify multi-region cost/latency before relying on it.
- express-rate-limit v8 has a **store-API breaking change** vs v7 (the `increment` return shape);
  any echo migration advice must pin which major. (source: github.com/express-rate-limit/express-rate-limit releases, 2026-06)
