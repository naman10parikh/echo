---
title: "echo FIELD — Rate-Limit Bypass: the threat model attackers actually use (2026)"
type: field-research
domain: rate-limiting
created: "2026-06-16"
researcher: FIELD-INTELLIGENCE (CP123 Wave-R)
currency: "June 2026 — all primary sources <14 months; most <3 months"
sources:
  - { url: "https://github.com/litestar-org/litestar/security/advisories/GHSA-hm36-ffrh-c77c", date: "2025-10-05", author: "Litestar maintainers", note: "REAL CVE, CVSS 5.3 — XFF spoofing bypass, fixed 2.18.0" }
  - { url: "https://github.com/go-vikunja/vikunja/security/advisories/GHSA-m547-hp4w-j6jx", date: "2025-2026", author: "Vikunja", note: "Rate-limit bypass via spoofed headers, unauth users" }
  - { url: "https://github.com/sysadminsmedia/homebox/security/advisories/GHSA-j86g-v96v-jpp3", date: "2025-2026", author: "Homebox", note: "Auth rate-limit bypass via IP spoofing" }
  - { url: "https://github.com/coollabsio/coolify/security/advisories/GHSA-688j-rm43-5r8x", date: "2025-2026", author: "Coolify", note: "Login rate-limit bypass via X-Forwarded-Host" }
  - { url: "https://medium.com/codetodeploy/we-had-rate-limiting-attacker-bypassed-it-with-http-2-8-000-aws-bill-in-6-hours-b31d38ec9574", date: "2026-04-02", author: "Devrim Software / 'System Design and Production'", note: "$8,347 HTTP/2 multiplexing bypass war story" }
  - { url: "https://github.com/Rishabhworkspace/Traceon/issues/12", date: "2026-06-01", author: "issue author", note: "In-memory rate limiter bypassed in serverless (Map-bug-as-security)" }
  - { url: "https://github.com/obone410/AI-Support-Dashboard/issues/1", date: "2026-05-18", author: "issue author", note: "per-process limiter + XFF bucket rotation, serverless" }
  - { url: "https://github.com/LibreTranslate/LibreTranslate/issues/986", date: "2026-06-13", author: "issue author", note: "XFF spoofing bypasses rate limit AND flood-ban" }
  - { url: "https://github.com/nisshchayarathi/gitverse-nextjs/issues/1972", date: "2026-06-06", author: "issue author", note: "race condition in LRU cache rate limiter" }
  - { url: "https://medium.com/@shahwarshah/bypassing-rate-limits-all-known-techniques-fffda37a7fa7", date: "2025-2026", author: "Syed Shahwar (security researcher)", note: "taxonomy of bypass techniques" }
---

# Rate-Limit Bypass — what attackers actually do, and why naive limiters fail open

> **The thesis (carry this).** Most rate limiters are *bypassable by design* because they trust something the
> attacker controls (a header, an IP, a per-process counter). A rate limiter that fails open is worse than no
> rate limiter, because it gives a false sense of safety AND the operator stops watching. The 2026 GitHub
> security-advisory volume on this is enormous — this is the single most-filed security bug class in the
> rate-limit vertical right now.

---

## 1. The dominant bypass: trusting client-controlled `X-Forwarded-For` (a whole CVE genre)

This is not theoretical. In a single `gh search issues` sweep (June 2026) I found **15+ distinct repos** with
open issues or formal security advisories for the *exact same bug*: the limiter keys on `X-Forwarded-For`
(or `X-Forwarded-Host`, `X-Real-IP`, `True-Client-IP`), which the **client sets**, so the attacker rotates
it and gets a fresh bucket per request.

### The canonical CVE — Litestar GHSA-hm36-ffrh-c77c (CVSS 5.3, fixed 2.18.0, 2025-10-05)

**Verbatim from the advisory:**
> "Rate limits can be completely bypassed by manipulating the X-Forwarded-For header. This renders IP-based
> rate limiting ineffective" because the `RateLimitMiddleware` trusts proxy headers unconditionally without
> validation of trusted proxy configuration.

**The attack (verbatim):** "An attacker rotates through different spoofed IP addresses in the X-Forwarded-For
header, creating separate rate-limit buckets for each value… three requests with different header values
(192.168.1.100, 101, 102) that each return 200 OK, bypassing the 2-request-per-minute limit."

**Root cause:** `cache_key_from_request()` "uses X-Forwarded-For values directly without verifying proxy
legitimacy or implementing trusted proxy whitelisting."

**The fix (verbatim remediation):**
> - "Default to socket IP only: Don't trust proxy headers unless explicitly configured"
> - Implement trusted proxy configuration settings
> - Deploy behind reverse proxies that strip client-controllable headers

### The pattern repeats across the ecosystem (June 2026 GitHub)

Same bug, different projects — a representative slice (all open issues / advisories):
- **Vikunja** GHSA-m547-hp4w-j6jx — "Rate-Limit Bypass for Unauthenticated Users via Spoofed Headers."
- **Homebox** GHSA-j86g-v96v-jpp3 — "Auth Rate Limit Bypass via IP Spoofing."
- **Coolify** GHSA-688j-rm43-5r8x — "Rate-limit bypass on login via **X-Forwarded-Host** header" (note: a
  *different* header — attackers probe all of them).
- **LibreTranslate** #986 (2026-06-13) — "X-Forwarded-For Header Spoofing Allows Rate Limit **and Flood Ban**
  Bypass" (the ban list keyed on the same spoofable IP → the ban is bypassable too).
- **Editron** #431 (2026-05-30) — "IP Spoofing Rate Limit Bypass (**Billing DoS**)" — names the real impact.
- **GinkGO** #5475 (2026-06-08, P1), **Debugra** #691, **noxem** #25 (HIGH), **Stellar-MarketPay** #271,
  **CardSort** #12 ("via **IPv6** header spoofing" — see §3), **KFinans** SEC-004.

**echo's taste (the non-negotiable rule):** *Never derive the rate-limit key from a client-settable header
unless you are behind a proxy you control AND you read a fixed position in the chain.* The correct client IP
on Vercel is `request.headers.get('x-forwarded-for')` **only because Vercel's edge overwrites/prepends it**;
the rule is "trust the *leftmost-untrusted* / the value your own infra wrote, never the raw client value."
Better: rate-limit on an **authenticated identity** (user id / API key) for anything behind auth, and reserve
IP-based limits for truly unauthenticated endpoints — and even then, expect IP rotation (§3).

---

## 2. The serverless bypass: in-process limiter = the Map-bug class as a SECURITY hole

This is where echo's REF-1/REF-2 (the `new Map()` law) becomes a *security* finding, not just a correctness
one. Multiple June-2026 issues describe an in-memory limiter that **fails open on serverless** because each
Lambda/instance has its own counter:

- **Rishabhworkspace/Traceon #12** (2026-06-01): "**In-Memory Rate Limiter Bypassed in Serverless
  Environments**." The limiter's counter lives in process memory; serverless spins up many instances, so the
  limit is per-instance, not global → an attacker (or just normal fan-out) blows past it.
- **obone410/AI-Support-Dashboard #1** (2026-05-18): "**In-memory rate limiter is per-process and bypassable
  on serverless** — X-Forwarded-For spoofing rotates rate limit buckets freely." (Both bugs at once: §1 + §2.)
- **JhaSourav07/commitpulse #1868** (2026-05-30): "Rate Limiter Bypass via **Non-Middleware API Routes**" —
  the limiter is middleware, but some routes skip the middleware → uncovered surface.
- **nisshchayarathi/gitverse-nextjs #1972** (2026-06-06): "**race condition in LRU cache rate limiter
  bypass**" — even an in-process LRU limiter races under concurrency (read-modify-write on the counter is
  not atomic).
- **leonagoel/hybrid-recommender #1629** (2026-06-13): "O(N) rate limiter garbage collection **under global
  lock on every request**" — the in-memory limiter's cleanup became a self-inflicted bottleneck (the limiter
  DoS'd its own service).

**echo's taste:** the *counter must be atomic and shared.* On serverless that means **`INCR` in Redis/Upstash
with an atomic `EXPIRE`**, or a sliding-window/GCRA implemented with a Lua script so the read-modify-write is
one round trip. An LRU `Map` limiter is (a) per-process → bypassable, (b) racy → undercounts, (c) its own GC
is a bottleneck. The "non-middleware route" bug is a reminder: *coverage is part of correctness* — a limiter
that protects 9/10 routes protects 0.

---

## 3. IP rotation defeats IP-based limits entirely (the economics)

Even a *correctly* IP-keyed limiter (socket IP, not spoofed header) loses to attackers who control many real
IPs. From the bypass-techniques survey (Syed Shahwar) and the search synthesis:
- **Residential proxy services** "sell access to millions of real residential IPs… rotating proxies make
  every request look like a different person, costing **around $500/month for unlimited requests** and
  rendering IP-based rate limiters useless."
- **IPv6 rotation** is worse than IPv4: a single allocation is often a **/64** (18 quintillion addresses) or
  a **/48**. If you rate-limit per-/128 IPv6 address, an attacker rotates within their own /64 for free
  forever. **CardSort #12** is exactly this ("Rate limiter bypass via IPv6 header spoofing").

**echo's taste:** for IPv6, **rate-limit on the /64 (or /56) prefix, never the full /128.** For abuse you
can't stop with IP limits (residential proxies), the answer is *not* a tighter IP limit — it's moving the
cost: proof-of-work / CAPTCHA on suspicious patterns, per-account limits behind auth, anomaly detection, and
**spend caps on the backend** (§4). IP limits are a speed bump, not a wall.

---

## 4. The bill is the real attack surface: $8,347 in 6 hours via HTTP/2 multiplexing

**Source:** medium.com/codetodeploy — "We Had Rate Limiting. Attacker Bypassed It with HTTP/2. $8,000 AWS
Bill in 6 Hours" (2026-04-02). This is the best single rate-limit war story I found and a perfect echo case
study because **the limiter was Redis-backed and correctly IP-keyed — and still got bypassed.**

**The setup (verbatim):** 100 requests/minute/IP, 15-minute block, "Redis-backed tracking," counting with
`await redis.incr(\`rate_limit:${clientIP}\`)` + expiry on the first request of each minute.

**Why HTTP/2 beat it (verbatim):** HTTP/2 multiplexes many concurrent requests over one TCP connection via
"streams." "The rate limiter only tracked requests per IP, not concurrent streams per connection… **'all 100
arrive in the same millisecond'** — the Redis counter sees increments 1-100, but all requests process before
the limit check completes." This is a **read-modify-write race at the check**: the limiter increments
correctly but the *decision* ("are we over?") is made before the increments settle, so 100 concurrent streams
all see "under limit."

**The 47-line attack (verbatim):**
```python
import httpx
import asyncio
async def flood_api(url):
    async with httpx.AsyncClient(http2=True) as client:
        while True:
            tasks = [client.get(url) for _ in range(100)]
            await asyncio.gather(*tasks)
            await asyncio.sleep(0.9)
```
"100 concurrent HTTP/2 streams every ~0.9 seconds, staying under the per-minute threshold while generating
massive concurrent load."

**The damage:** 4.2M requests in 6h; one IP / one TCP connection "exactly 100 requests/minute reported";
auto-scaled 3 → **47 EC2 instances**; DB connections maxed at 2,000; RDS CPU 100% for 4h. Cost breakdown:
EC2 $4,200 + RDS $1,800 + Lambda $1,400 + transfer $900 + CloudWatch $47 = **$8,347** vs $140/day normal.

**The fix (verbatim):** dual-layer — per-IP (100/min) **plus per-connection concurrent-stream cap (max 10
simultaneous)**, AWS API Gateway with HTTP/2 awareness, **cost alerts at $500** (they were set at $8,347 —
i.e. only fired once the damage was done).

**The strongest opinions (verbatim — these are echo's voice):**
> "Rate limiting isn't a checkbox. It's a spectrum of how creative attackers will get."
> Claiming "we have rate limiting" without testing against actual HTTP/2 attacks is "buying the cheapest lock
> at Home Depot and calling it security."
> "The attacker doesn't need sophistication" — "this was likely a bored researcher or competitor, not a
> nation-state, yet cost $8,000 with minimal effort."

**echo's taste from this story (three rules):**
1. **Per-IP rate is necessary but not sufficient — also cap *concurrency*** (in-flight requests per
   connection/identity), because a single connection can multiplex a burst that beats a per-minute counter.
2. **Make the limit decision atomic.** The race ("all 100 in the same millisecond pass the check") means the
   increment-then-check must be a single atomic op (Lua `INCR`+compare, or a token-bucket that decrements
   atomically). Two round trips (incr, then read) is a TOCTOU bypass.
3. **The backend spend cap is the last line of defense.** Auto-scaling *amplified* the attack ("scaled TO the
   attack rather than rejecting it"). A cost alarm at a *low* threshold + a hard ceiling (max instances, max
   DB connections) turns an $8k incident into a $200 one. The rate limiter protects the app; the spend cap
   protects the *business*.

---

## 5. The synthesized bypass threat model (echo's checklist)

When echo reviews a rate limiter, it checks for *all* of these failure-opens:
1. **Header trust** — does the key come from a client-settable header (`X-Forwarded-For`/`-Host`/`X-Real-IP`/
   `True-Client-IP`)? → use socket IP / your-infra-written value / authenticated identity. (§1)
2. **Per-process state** — is the counter a `Map`/LRU in process memory on serverless? → atomic shared store
   (Redis `INCR`). (§2, REF-1/REF-2)
3. **Non-atomic decision** — is it `incr` then a *separate* `read`/compare? → one atomic op (Lua / token
   bucket). (§4)
4. **Coverage gaps** — do some routes skip the limiter middleware? → enforce at the edge or audit every route.
   (§2 commitpulse)
5. **IPv6 granularity** — keyed per-/128? → key per-/64 (or /56). (§3)
6. **Concurrency uncapped** — only a *rate* (per minute), no *concurrency* cap (in-flight)? → add a concurrency
   limit; HTTP/2 multiplexing beats rate-only. (§4)
7. **No backend ceiling** — does auto-scaling amplify rather than shed? → spend alarms at LOW thresholds +
   hard caps on instances/connections. (§4)
8. **Ban list shares the spoofable key** — is the flood-ban keyed on the same spoofable IP? → it's bypassable
   too. (§1 LibreTranslate)
