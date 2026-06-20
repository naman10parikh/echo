---
name: echo-limiter-design
description: Design a rate limiter an attacker cannot bypass. Use when the task is "add rate limiting", "throttle this endpoint", "stop brute force on login", or "we're getting hammered". Picks store + algorithm + key + fail-mode and pairs the rate limit with a concurrency cap. Refuses spoofable-header keys and non-atomic decisions — the two ways every bypassed limiter is built.
---

# echo-limiter-design — a limiter that actually HOLDS

> **Brain anchors:** O-03, O-04, O-05, O-06, O-07, O-08, O-09 (OPINIONS) · P-04, P-05, P-06, P-07, P-11 (PITFALLS) ·
> S-01, S-02, S-03 (BATTLE-TESTED-SCENARIOS). Behind `echo limiter <endpoint-kind>`.

## Trigger

- "add rate limiting" / "throttle this endpoint" / "limit this API".
- "stop brute force on login/signup/password-reset" / "we're getting hammered" / a surprise compute bill.
- Reviewing a diff that adds a limiter (check it against the 7 stances below).

## The meta-stance — lead with the model, not the algorithm (O-07)

Arcjet, verbatim: *"Distributed rate limiting is fundamentally a consistency problem. Algorithm choice matters, but
state coordination dominates complexity at scale."* Average engineers argue token-bucket vs sliding-window; echo
decides **consistency model + fail-mode + key + atomicity** first. The algorithm is a per-endpoint tuning knob, last.

## The 7 stances echo applies to every limiter

1. **Key on authenticated identity, NEVER a client-settable header (O-03 / P-04).** `X-Forwarded-For` / `-Host` /
   `X-Real-IP` / `True-Client-IP` are set by the client → an attacker rotates them for a fresh bucket per request →
   **silent total bypass** (the #1 rate-limit CVE genre of 2026). Behind auth → key on `userId`/`apiKey`. At an
   unauthenticated edge → key on the **socket IP / the value your own infra wrote** (Vercel's edge overwrites XFF;
   trust leftmost-untrusted). **A limiter that fails open is worse than none** — false safety + the operator stops watching.
2. **Decide fail-OPEN vs fail-CLOSED, explicitly (O-04 / P-11).** `@upstash/ratelimit`'s `timeout` (default 5s) makes
   the limiter pass *regardless of the limit* when Redis is slow — correct for a **product API** (don't 429 a paying
   user on a blip), a **brute-force door** on **login/payment**. Availability-critical → fail-open; abuse/
   correctness-critical → **fail-closed** (low timeout, treat a thrown error as DENY). Never pick without naming which.
3. **The decision must be ATOMIC (O-06 / P-05).** Two round trips (`incr`, then a separate read/compare) is a TOCTOU
   bypass — concurrent requests all decide "under limit" before the increments settle. Use one Lua op / an atomic
   token decrement (`@upstash/ratelimit` does this). Non-negotiable for any shared counter.
4. **Pair the rate limit with a CONCURRENCY cap (O-05 / P-06).** HTTP/2 (and /3) multiplexing lands a burst "in the
   same millisecond" that beats any rate-only counter ($8,347 in 6 hours with a *correct, Redis-backed, IP-keyed*
   limiter). Rate (req/time) ≠ concurrency (in-flight) — you need both. `@upstash/ratelimit` does NOT do concurrency
   (issue #71) → add `rate-limiter-flexible`'s `RateLimiterConcurrency`, `p-limit`, or a semaphore.
5. **A backend SPEND CAP is the floor (O-08).** Auto-scaling *amplifies* an attack (3→47 EC2 in the $8,347 story).
   Set a **low** cost alarm + hard ceilings (max instances, max DB connections) — turns an $8k incident into a $200 one.
6. **IPv6 → key the /64 (or /56) prefix, never /128 (O-09 / P-07).** A single allocation is often a /64 (18
   quintillion addresses) — per-/128 lets an attacker rotate within their own block forever.
7. **Algorithm, per-endpoint (last):** **sliding-window** for HTTP throttle (smooth, no boundary burst) ·
   **token-bucket** for bursty-but-bounded · **fixed-window** only where a 2× boundary burst is acceptable (it's
   half the Redis commands → cheaper, O-19).

## Steps

1. Name the endpoint class: **product API** (→ fail-open default) or **security/abuse door** (login/payment →
   **fail-CLOSED**).
2. Pick the key: behind auth → identity; at the edge → infra-written IP, IPv6 → /64.
3. Pick the algorithm: sliding-window (throttle) / token-bucket (bursty) / fixed-window (cost-sensitive, burst-OK).
4. Emit the limiter with `echo limiter <kind>` (default store = Upstash Redis, atomic by construction) — then **add a
   concurrency cap** and a **spend cap**.
5. Prefer the runtime-correct example over hand-rolling (O-22): `echo example --runtime <edge|node|cf>`.
6. **Verify it holds:** under N>limit concurrent requests, **admitted == limit** (not `>`). Rotating the chosen
   header/identity must NOT create new buckets.

## Output format

Emitted limiter code (stdout, redirectable) + a rationale block naming, for THIS endpoint: **store · algorithm ·
key · fail-mode · concurrency cap · spend cap**, each tied to its stance (O-0x). A login limiter, for example:
sliding-window · identity-key · **fail-CLOSED** · atomic · concurrency-capped · spend-capped.
