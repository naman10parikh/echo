---
title: "echo FIELD — Rate-limit algorithm TASTE + where credible sources DISAGREE (feeds GAPS-AND-DISPUTES)"
type: field-research
domain: rate-limiting
created: "2026-06-16"
researcher: FIELD-INTELLIGENCE (CP123 Wave-R)
currency: "June 2026 — Arcjet Mar 2026; GCRA source 2023 (mechanism timeless, date flagged)"
sources:
  - { url: "https://blog.arcjet.com/rate-limiting-algorithms-token-bucket-vs-sliding-window-vs-fixed-window/", date: "2026-03-24", author: "Cassie Gatton (Arcjet)", note: "token bucket = strongest default; per-algorithm failure modes; consistency thesis" }
  - { url: "https://www.slashid.dev/blog/id-based-rate-limiting/", date: "2023-10-16", author: "Paulo Costa & Vincenzo Iozzo (SlashID)", note: "GCRA case: no drip worker; date OLD but mechanism timeless" }
  - { url: "https://dev.to/ttatsato/which-rate-limit-algorithm-for-my-product-n51", date: "2025-2026", author: "ttatsato (DEV)", note: "product-fit framing of algorithm choice" }
  - { url: "https://upstash.com/docs/redis/sdks/ratelimit-ts/costs", date: "2026", author: "Upstash", note: "command-cost per algorithm — the COST dimension of the choice (cross-ref field-03)" }
  - { url: "https://medium.com/@tihomir.manushev/...token-bucket-vs-sliding-window...", date: "2025-2026", author: "Tihomir Manushev", note: "behavioral framing: burst vs smoothness" }
---

# Rate-Limit Algorithm Taste — what great practitioners pick, and where the experts genuinely disagree

> **The thesis (carry this).** The rate-limit *algorithm* is a smaller decision than people think; the *state
> coordination* is the bigger one. Arcjet, verbatim: **"Algorithm choice matters, but state coordination
> dominates complexity at scale… Distributed rate limiting is fundamentally a consistency problem."** echo
> should lead with the consistency model, then pick the algorithm to fit the product's burst tolerance and
> cost budget.

---

## 1. The four algorithms — behavior, failure mode, and cost (echo's reference table)

Synthesized from Arcjet (2026-03-24, behavior + failure modes) and Upstash (command cost, field-03):

| Algorithm | Burst behavior | Boundary/failure mode (verbatim Arcjet) | Memory | Upstash cmds/req | echo verdict |
|-----------|----------------|------------------------------------------|--------|------------------|--------------|
| **Fixed window** | tolerates 2× burst at edges | "A client can send 100 requests at 12:00:59 and another 100 at 12:01:00"; "**a login endpoint protected by fixed window can be brute-forced at window boundaries**"; "rarely appropriate for public endpoints" | very low | **2** | Cheapest. OK for coarse internal quotas where 2× boundary burst is harmless. **Never on auth/login.** |
| **Sliding window log** | strict, exact history | "during traffic spikes, log-based implementations can create **memory pressure and increased CPU overhead for pruning**" | **high** (grows with volume) | n/a (custom) | Most precise/fair; pay in memory. Reserve for security-sensitive, low-volume. |
| **Sliding window counter** | low-medium | blends current+previous window; boundary amplification "dramatically minimized"; still "an approximation" | moderate | **4** | The pragmatic middle. Arcjet's "most practical compromise for distributed scale." 2× the cost of fixed. |
| **Token bucket** | "controlled bursts"; idle → tokens accumulate to capacity | fails when "strict fairness" or "output rate must be perfectly smoothed" | low | **4** | Arcjet's **"strongest default for modern APIs."** Matches bursty real traffic (batch jobs, app launches, retries). |
| **GCRA** (SlashID) | dual-rate (burst + sustained) | (SlashID lists no downsides — flagged below) | very low (1 TAT/key) | n/a (custom Lua) | The operationally cleanest distributed choice — **no drip worker.** Underused; my pick for multi-region. |

---

## 2. The TASTE — opinions great practitioners hold that average ones don't (quoted)

These are the differentiated, quotable opinions — the stuff that separates someone who's run rate limiters in
prod from someone who read one blog post:

1. **Arcjet (verbatim): "Token bucket is the strongest default for modern APIs"** *because* "it enforces a
   steady average rate while allowing short bursts, **which matches real-world API usage patterns**." The
   subtle taste: **real traffic is bursty** (batch jobs, mobile app launches, retry waves) — a smoothness-
   enforcing algorithm (leaky bucket / strict sliding window) *false-limits legitimate bursts*. Average
   engineers pick sliding window because it sounds "more accurate"; experienced ones pick token bucket
   because false-limiting real users is worse than allowing a controlled burst.

2. **Arcjet (verbatim): "Distributed rate limiting is fundamentally a consistency problem… Algorithm choice
   matters, but state coordination dominates complexity at scale."** The taste: **stop arguing about the
   algorithm; decide your consistency model first.** Strong consistency = accurate limits, higher latency,
   lower availability. Eventual consistency = resilient, but "systems may **double-allow traffic if
   coordination fails**" during a regional partition. This is *the* expert insight and most algorithm posts
   completely miss it.

3. **SlashID (verbatim) on GCRA: the killer operational advantage is "elimination of background workers."**
   "GCRA tracks only a single timestamp per key — the Theoretical Arrival Time (TAT) — rather than
   maintaining token counts or log queues… **No background drip/refill worker required, no lagging worker
   hazard in multi-region deployments, atomicity achievable with single Redis operation.**" The taste: token
   bucket's "refill" is often implemented as a background drip worker (or a per-request time-based
   recomputation); a *lagging* drip worker silently grants too few/many tokens. GCRA folds the refill into a
   pure wall-clock computation — one atomic op, no worker to lag. **Average engineers don't know GCRA exists;
   it's the connoisseur's distributed limiter.** (Source date 2023 — flagged — but the math is timeless.)

4. **The cost-as-correctness taste (echo's synthesis of Arcjet + Upstash):** the algorithm choice is *also* a
   bill decision — fixed window (2 cmds) vs sliding/token (4 cmds) is a 2× cost difference per request
   (field-03). An expert picks the *cheapest algorithm whose failure mode is acceptable for the endpoint*,
   not the "best" one everywhere. Login → sliding/GCRA (no boundary brute-force) regardless of cost; a coarse
   internal quota → fixed window (half the bill). **Right-sizing the algorithm per-endpoint is taste.**

5. **The "limit on identity, not IP" taste (echo's synthesis of field-02 + dev.to product framing):** for
   authenticated APIs, rate-limit on the **API key / user id**, not the IP — IPs are shared (NAT, corporate),
   spoofable (XFF), and rotatable (residential proxies, IPv6). Average implementations key on IP because it's
   the tutorial default; experienced ones key on the authenticated principal and reserve IP limits for the
   genuinely-unauthenticated edge.

---

## 3. Where credible sources DISAGREE (verbatim both sides — for GAPS-AND-DISPUTES)

### DISPUTE A — Token bucket vs Sliding window as the default
- **Token-bucket camp (Arcjet, 2026-03-24, verbatim):** token bucket is "the strongest default for modern
  APIs"; "battle-tested implementations across the industry (Stripe, GitHub, AWS API Gateway)"; sliding window
  "lacks the explicit burst semantics." Burst-tolerance is a *feature* because real traffic is bursty.
- **Sliding-window camp (Upstash docs + common security framing, verbatim):** sliding window "resolves the
  near-boundary problem of the Fixed Window algorithm by considering both old and new windows, **reducing the
  possibility of stampedes**," and enforces a stricter rolling limit (better for fairness/abuse). Arcjet
  itself concedes sliding-window-log for "strict fairness… particularly in security-sensitive environments."
- **echo's resolution:** *not a universal winner — it's per-endpoint.* Bursty legitimate traffic (APIs, batch)
  → token bucket. Abuse-sensitive / fairness-critical (login, password reset, costly endpoints) → sliding
  window or GCRA. The dispute exists because both camps are generalizing from different endpoint types.

### DISPUTE B — Is the algorithm even the important decision?
- **Algorithm-centric view (most blog posts, GeeksforGeeks/HLD handbook):** frame the whole problem as
  "pick the right algorithm," with comparison tables as the deliverable.
- **Coordination-centric view (Arcjet, verbatim):** "**Algorithm choice matters, but state coordination
  dominates complexity at scale.**" The hard part is the distributed counter (hot keys, clock skew, region
  isolation, atomicity), not the algorithm.
- **echo's resolution:** the coordination view is correct *at scale*; the algorithm view is fine *for a single
  instance*. echo leads with coordination (atomic shared counter, field-02 §4) and treats the algorithm as a
  secondary, per-endpoint tuning knob.

### DISPUTE C — Strong vs eventual consistency for distributed limits
- **Strong-consistency camp:** accurate limits, no overage; the limiter is a correctness boundary (e.g.
  billing/quota enforcement must not over-allow).
- **Eventual-consistency / availability camp (Arcjet, verbatim):** "Eventual consistency improves resilience
  but allows temporary overages"; during regional partitions, strong coordination *failing closed* can take
  the whole API down. Sometimes a temporary overage is cheaper than an outage.
- **echo's resolution:** depends on what the limit *protects*. Protecting a **paid quota / abuse budget** →
  lean strong (a small overage is a refund; an outage is worse). Protecting **infra from load** → lean
  eventual + a backend spend cap (field-02 §4) as the real ceiling. Decide by the *cost of being wrong in
  each direction.*

### DISPUTE D (cross-domain) — Cache the herd, or fix the origin? (see field-05 §2)
- **Cache camp (most stampede articles):** add single-flight + SWR.
- **Fix-the-origin camp (Depot, 2025-11, verbatim outcome):** "Rather than read replicas or caching… query
  optimization" — because the origin was slow due to *missing indexes*, not intrinsic cost.
- **echo's resolution:** cache *intrinsically expensive, redundantly recomputed* work; *fix* work that's slow
  because it's inefficient. A cache over a fixable query hides a bug and adds invalidation risk.

---

## 4. echo's algorithm decision (the one-screen answer)

1. **Decide the consistency model first** (strong vs eventual), by the cost of being wrong in each direction. (§2.2, §3C)
2. **Default to token bucket** for general bursty APIs (matches real traffic; Stripe/GitHub/AWS precedent). (§2.1)
3. **Use sliding window or GCRA for abuse-sensitive endpoints** (login, reset, expensive ops) — no boundary
   brute-force. (§1, §3A)
4. **Prefer GCRA for multi-region** — single TAT/key, atomic, no drip worker to lag. (§2.3)
5. **Right-size by cost:** fixed window (2 cmds) where a 2× boundary burst is harmless; pay for 4-cmd
   algorithms only where the failure mode demands it. (§2.4, field-03)
6. **Key on authenticated identity, not IP,** behind auth. (§2.5, field-02)
7. **The counter must be atomic + shared** — that's the real engineering, not the algorithm. (§3B, field-02 §4)
