---
title: "echo GAPS-AND-DISPUTES — Where Sources Disagree, What's Unconfirmed, What echo Must Settle by Experiment"
type: synthesis
created: "2026-06-16"
updated: "2026-06-16"
tags: [gaps, disputes, unresolved, experiments, both-sides, unconfirmed, rate-limiting, caching]
synthesist: SYNTHESIS / taste-node (CP123 Wave-R)
sources: ["brain/research/raw/ecosystem-99-REPORT.md", "brain/research/raw/field-08-synthesis-2026-shifts-and-gaps.md", "brain/research/raw/field-02,03,04,06,07.md", "brain/research/raw/ecosystem-01,04,08.md"]
summary: "The honest edges of echo's knowledge: (A) live DISPUTES where credible sources disagree (both sides verbatim, with echo's working resolution + the condition that would change it), (B) what could NOT be confirmed this round (the verify-flags), (C) the EXPERIMENTS echo must run to settle questions no source answers. This is the intellectual-honesty layer — an expert knows the boundary of what they know."
related: ["[[echo OPINIONS]]", "[[echo EXPERTISE-MAP]]", "[[echo BATTLE-TESTED-SCENARIOS]]"]
---

# echo GAPS-AND-DISPUTES

> **Why this matters.** A brain that only contains settled facts is a brain that will assert confidently where it
> should experiment. This file marks the boundary: the disputes echo holds an opinion on *but could be wrong*, the
> claims echo carries *unverified*, and the questions echo must answer *with its own benchmark/test* because no
> credible source does. When echo hits one of these, the move is **measure, don't assert** (and write the result
> back to ORG_MEMORY so the gap closes for the fleet).

---

## A. Live DISPUTES (credible sources genuinely disagree — both sides, then echo's working call)

### D-A — Token bucket vs Sliding window as the default algorithm
- **Token-bucket camp (Arcjet, 2026-03-24, verbatim):** token bucket is "the **strongest default for modern
  APIs**"; "battle-tested across the industry (Stripe, GitHub, AWS API Gateway)"; sliding window "lacks the explicit
  burst semantics." Burst-tolerance is a *feature* because real traffic is bursty (batch jobs, app launches, retry
  waves) — a smoothness-enforcing algorithm *false-limits legitimate bursts*.
- **Sliding-window camp (Upstash docs + security framing, verbatim):** sliding window "resolves the near-boundary
  problem of the Fixed Window algorithm by considering both old and new windows, **reducing the possibility of
  stampedes**," and enforces a stricter rolling limit (better for fairness/abuse). Arcjet *itself* concedes
  sliding-window-log for "strict fairness… particularly in security-sensitive environments."
- **echo's working resolution:** *not a universal winner — per-endpoint.* Bursty legitimate traffic (general APIs,
  batch) → token bucket. Abuse-sensitive / fairness-critical (login, password reset, costly endpoints) → sliding
  window or GCRA. The dispute exists because both camps generalize from different endpoint types.
- **What would change it:** a benchmark on *our* traffic shapes (see X-2) showing one algorithm false-limits real
  users or under-protects an abuse endpoint at echo's actual volumes.
- (source: field-06 §3A)

### D-B — Is the algorithm even the important decision?
- **Algorithm-centric view (most blog posts, GeeksforGeeks/HLD handbooks):** frame the whole problem as "pick the
  right algorithm," with comparison tables as the deliverable.
- **Coordination-centric view (Arcjet, verbatim):** "**Algorithm choice matters, but state coordination dominates
  complexity at scale.**" The hard part is the distributed counter — hot keys, clock skew, region isolation,
  atomicity — not the algorithm.
- **echo's working resolution:** the coordination view is correct *at scale*; the algorithm view is fine *for a
  single instance*. echo leads with coordination (atomic shared counter, fail-mode, consistency model) and treats
  the algorithm as a secondary per-endpoint knob. Encoded in [[echo OPINIONS]] O-07.
- **What would change it:** if a single-instance / low-scale deployment is the norm for a given product, the
  algorithm becomes the primary decision again.
- (source: field-06 §3B)

### D-C — Strong vs eventual consistency for distributed rate limits
- **Strong-consistency camp:** accurate limits, no overage; the limiter is a *correctness boundary* (billing/quota
  enforcement must not over-allow).
- **Eventual-consistency / availability camp (Arcjet, verbatim):** "Eventual consistency improves resilience but
  allows temporary overages"; during regional partitions, strong coordination *failing closed* can take the whole
  API down — "systems may **double-allow traffic if coordination fails.**" Sometimes a temporary overage is cheaper
  than an outage.
- **echo's working resolution:** decide by **what the limit protects and the cost of being wrong in each
  direction.** Protecting a paid quota / abuse budget → lean strong (a small overage is a refund; an outage is
  worse). Protecting infra from load → lean eventual + a backend spend cap (O-08) as the real ceiling. This is the
  `MultiRegionRatelimit` "small-margin overshoot" tradeoff made concrete (SCENARIO S-19).
- **What would change it:** a product where a small quota overage has hard regulatory/financial cost (then strong,
  always) — or one where availability SLAs dwarf overage cost (then eventual, always).
- (source: field-06 §3C, ecosystem-02 §4)

### D-D (cross-domain) — Cache the herd, or FIX the origin?
- **Cache camp (most stampede articles):** add single-flight + SWR to absorb the herd.
- **Fix-the-origin camp (Depot, 2025-11, verbatim outcome):** "Rather than read replicas or caching… **query
  optimization**" — because the origin was slow due to *missing indexes*, not intrinsic cost. A composite index
  folding `json_extract` into the index scan avoided the 100%-CPU state without a cache.
- **echo's working resolution:** cache *intrinsically-expensive, redundantly-recomputed* work; *fix* work that's
  slow because it's inefficient. `EXPLAIN` first; a cache over a fixable query hides a bug AND adds invalidation
  risk. Encoded in O-18 (SCENARIO S-11).
- **What would change it:** nothing fundamental — but the decision is *per-incident*; echo must resist the reflex to
  cache before profiling.
- (source: field-05 §2, field-06 §3D)

### D-E — In-process single-flight: useful optimization or dangerous footgun?
- **"Useful" camp (drizzle-orm #5841 fix, OneUptime pattern 3):** in-memory `Map<key, Promise>` dedup is "efficient"
  and the standard single-flight implementation; it's correct for a stateful server.
- **"Footgun" camp (echo's reading + OneUptime's own caveat, verbatim):** "doesn't persist across instances" — on
  serverless it's the Map-bug class; 50 warm instances = a 50-request stampede, not single-flight.
- **echo's working resolution (a *reconciliation*, not a winner):** it's a **latency optimization within one
  process**, NEVER the stampede defense on serverless — there you need a distributed lock (SETNX+Lua) or SWR from
  the shared cache. Both camps are right about different runtimes. Encoded in O-15 (SCENARIO S-04).
- **What would change it:** if a deployment is provably single-instance/stateful (a Durable Object, a long-running
  container), the "useful" camp wins outright.
- (source: field-01 §1, §3)

### D-F (latent) — Is the energy/turbo "Fluid Compute makes the Map racy" framing fully load-bearing for echo's store choice, or partly a turbo inheritance echo should re-verify?
- **Inherited-as-fact:** turbo P-02/O-01 and ecosystem-00 treat Fluid-Compute concurrency (250+ concurrent requests
  per warm instance, default-on 2026) as the *second* reason the `new Map()` law holds. echo carries this as O-01.
- **The honest edge:** the *exact* concurrency numbers (250+, peaks) and "default-on" status come from the turbo
  brain quoting Fluid-Compute discourse, not from an echo-fetched Vercel primary doc this round. The *mechanism*
  (warm instance shares module state → cross-user bleed) is sound and independently reasoned; the *magnitudes* and
  the current default-on status are turbo-inherited.
- **echo's working call:** carry the mechanism with full confidence (it's the founding law), flag the precise
  numbers as turbo-sourced, and re-verify against a current Vercel Fluid Compute doc in the RSI loop. This is a
  *currency* caveat, not a dispute about the law.
- (source: field-00 REF-2, ecosystem-00:69-75 — echo's own honesty annotation)

---

## B. Could NOT be confirmed this round (the verify-flags — carry as "likely," not "fact")

### G-1 — The Shopify Black Friday 2019 stampede *numbers* (mechanism solid, figures secondhand)
The widely-retold figures (hot cache expired ~2:47 AM; ~47,000 concurrent requests; DB CPU → 98%; p50 20ms →
4,500ms; ~8-min outage; ~$10M lost sales) are repeated across multiple 2025-2026 blogs but **no Shopify first-party
postmortem confirms the exact numbers.** Trust the *mechanism* (a hot key expiring → synchronized miss → DB melt) as
canonical; treat the *numbers* as illustrative/secondhand. **Do not cite the figures as fact in a deliverable.**
(source: field-01 §5, field-08 G-1)

### G-2 — The Upstash-cost Reddit threads' full content (cause confirmed, threads un-fetched)
reddit.com is un-fetchable via WebFetch and `bb` (Browserbase) needed an API key not in scope. echo has the OP
*quotes* from firecrawl-search descriptions ("they charge $0.20/100k but I've noticed…"; "commands usage keeps
incrementing without me making any call") and the **authoritative Upstash cost doc** which corroborates the
substance (commands ≫ requests; replication/background commands bill). The *cause* is confirmed by the official doc
+ the multi-region formula; the *full comment threads* are not read. **Note the unit confusion in the wild:** one
source said "$0.2/**million**," the official doc says "$0.2/**100K**" — trust the official doc. (source: field-03 §2,
field-08 G-2)

### G-3 — The namespace-prefix-mismatch incident *specifics* (bug class solid, incident secondhand)
The "5 microservices, tens of thousands of sessions, DEL returns 0" incident came from a **WebSearch synthesis**,
not a fetched first-party postmortem (the DesignGurus and Lukas Niessen articles were paywalled/theoretical at the
relevant section). The *bug class* is solidly corroborated (OneUptime explicitly addresses prefix bugs; `DEL → 0`
behavior is documented Redis semantics); the specific incident's scale numbers are secondhand. Carry the *pattern*
(P-17/S-06), not the headcount. (source: field-04 §2, field-08 G-3)

### G-4 — GCRA's *downsides* (best source is one-sided and dated 2023)
The SlashID write-up — the best GCRA reference — **lists only advantages** and is dated **2023** (the math is
timeless; the currency is flagged). GCRA's real tradeoffs are echo's *inference*, not a cited critique: (a) harder
to reason about than a token count; (b) the dual-rate parameters (`T` emission interval, `τ` burst capacity) are
unintuitive to tune; (c) the "clock drift → false positives (users locked out)" risk if you use app-server clocks
instead of the store's `TIME`. **A 2026 critical source on GCRA would strengthen this** — until then, echo's "GCRA
is the connoisseur's multi-region pick" stance is held with a caveat, not certainty. (source: field-06 §2.3,
ecosystem-03 §4, field-08 G-4)

### G-5 — Independent (non-Upstash) store-latency benchmark
The "Upstash Redis fastest, Cloudflare KV slowest" global-latency ranking is from **Upstash's OWN blog**
(vendor-biased). The architectural reasoning is sound (active-replication full-dataset-per-region beats pull-based
central-store-with-edge-pull for write-then-read; KV's 1-write/sec + 60s-eventual is Cloudflare's *own* documented
limit), but the *magnitudes* (e.g. "28× faster," "6.2ms vs 171.8ms p50") are Upstash-authored. **A neutral
third-party benchmark would be needed to trust the exact magnitudes** — the *ordering* and the *KV-is-wrong-for-
counters* conclusion are independently defensible. (source: ecosystem-04 §latency, field-07 §1, ecosystem-99 gap-1)

### G-6 — Reaction-sorted top issues for `rate-limiter-flexible` and `express-rate-limit` at full depth
echo captured the headline issues (express-rate-limit #234 bypass / #168 standardization / #32 reset-header /
#533/#624 vulnerable-`ip`-dep; rate-limiter-flexible #176 redis-v4 / #290 Valkey / #287 SQLite / #103 serverless
auto-index footgun) but **prioritized the `@upstash/ratelimit` issue dump** as echo's flagship. A deeper
`gh api repos/animir/node-rate-limiter-flexible/issues?sort=reactions` + the same for express-rate-limit would
round out the non-Upstash pitfall coverage. (source: ecosystem-08 §gap, ecosystem-99 gap-2)

### G-7 — Current Vercel KV provisioning path (post-Marketplace transition)
Vercel KV "is Upstash under the hood," but Vercel has been moving KV to the **Marketplace / native-Upstash** over
2025-26. echo could **not pin the EXACT current provisioning UX/SKU as of June 2026** — verify before advising a
specific Vercel-KV setup flow. The *pricing relationship* (Vercel KV ≈ 2× Upstash per-command) is captured; the
*provisioning* is not. (source: ecosystem-04 §Vercel-KV, ecosystem-99 gap-3)

### G-8 — Valkey command/Lua parity vs Redis (asserted-likely, not verified command-by-command)
echo asserts Valkey is command-compatible for everything a limiter/cache needs (`INCR`, `EXPIRE`, `EVAL`, sorted
sets). This is **asserted-as-likely** (Valkey is a direct fork; the basic command surface is identical), **not
verified command-by-command**, and **module parity (RedisJSON/RediSearch) is NOT guaranteed.** Verify Lua/module
parity before a self-host/Valkey migration that uses anything beyond core commands. (source: field-07 §4, field-08
G-6)

### G-9 — X/Twitter signal: deliberately SKIPPED (no claims made from it)
The X session file read was blocked by a secrets hook (correct security behavior) and `bb` needed
`BROWSERBASE_API_KEY` not in scope. The researchers relied on HN (Algolia API, fetched directly), Reddit (firecrawl
descriptions), and GitHub (`gh` CLI, fully working) — richer for this vertical anyway. **No claims in echo's brain
derive from X.** (source: field-08 G-5)

---

## C. EXPERIMENTS echo must run (questions NO source answers — measure, don't assert)

> These are the gaps echo closes *for the fleet* by running its own test/benchmark and writing the result to
> ORG_MEMORY. Each names the question, the method, and the assertion that would resolve it.

### X-1 — Does our default limiter actually hold under multi-instance + HTTP/2 concurrent load?
- **Question.** Given echo's recommended stack (`@upstash/ratelimit` sliding-window on Upstash, identity-keyed), does
  the limit hold when (a) the app is scaled to >1 instance and (b) hit with 100 concurrent HTTP/2 streams in one
  connection? (The S-01 + S-03 combination — the two failure modes that don't show in `vercel dev`.)
- **Method.** Deploy a minimal limiter, hit one key from N simulated instances and from an HTTP/2 multiplexed burst
  (the 47-line `httpx http2=True asyncio.gather` script from field-02 §4); count admitted requests.
- **Resolves.** Confirms (or refutes) that the atomic-shared-counter + concurrency-cap guidance (O-05/O-06) actually
  closes the bypass on the real platform. **Write the admitted-count vs limit to ORG_MEMORY.**
- (grounds: field-02 §2/§4, field-00 REF-2)

### X-2 — What is the real commands/request and monthly cost of each algorithm at our traffic shape?
- **Question.** For echo's actual/expected req/s and region config, what does each algorithm (fixed=2, sliding=4,
  token=4, ±adders, ×regions) cost per month, and where is the Upstash→fixed-instance break-even?
- **Method.** Run each algorithm against a representative load, read the Upstash dashboard command count (verify the
  doc's 2/4/4 counts empirically — and check the "commands increment with no calls" background tax from G-2), and
  compute cost vs a flat Redis Cloud/ElastiCache instance.
- **Resolves.** Turns O-19's arithmetic from a doc-derived estimate into a measured break-even for the fleet.
  **Write the measured cmds/request and break-even point to ORG_MEMORY.**
- (grounds: field-03 §1, ecosystem-02 §pricing)

### X-3 — Confirm `revalidateTag` laziness and the server-vs-client cache disagreement on our Next.js version
- **Question.** On the fleet's pinned Next.js version, does `revalidateTag(tag, "max")` defer (mark-stale + SWR) as
  documented, does `updateTag()` give read-your-writes, and does the client Router Cache disagree with the server
  Data Cache on back-navigation?
- **Method.** A minimal page tagged + mutated; observe whether the next request serves stale; observe back-nav after
  `revalidateTag` vs `updateTag`. (Reproduce the #56822/#91785 symptoms.)
- **Resolves.** Confirms the version-specific behavior behind P-26 so echo advises the right API (`revalidateTag` vs
  `updateTag` vs router refresh) for read-your-writes. **Write the observed behavior + version to ORG_MEMORY.**
- (grounds: ecosystem-05, vercel/next.js #56822/#91785)

### X-4 — Verify the distributed SETNX+Lua single-flight actually serializes the origin fetch across instances
- **Question.** Does echo's recommended distributed single-flight (SETNX lock + UUID-guarded Lua release) reduce N
  concurrent cold-cache requests across multiple instances to **exactly one** origin fetch — and does the Lua
  release only delete a lock the holder owns?
- **Method.** N concurrent cold-cache requests for one key from multiple instances; count origin calls; test that a
  non-owner's release attempt does NOT delete the lock.
- **Resolves.** Proves O-15's distributed single-flight on the real platform (vs the in-process Map that fails).
  **Write origin-call-count + release-ownership result to ORG_MEMORY.**
- (grounds: field-01 §1/§3, SCENARIO S-04)

### X-5 — Benchmark GCRA (Lua) vs sliding-window on memory-per-key and multi-region behavior (closes G-4)
- **Question.** At high key cardinality, does GCRA (one TAT/key, `Losant/redis-gcra` Lua) actually use less memory
  and behave correctly multi-region without a drip worker — and what are its real tuning footguns (the downsides no
  2026 source documents)?
- **Method.** Run GCRA vs sliding-window at high key count; measure Redis memory/key; test clock-drift sensitivity
  using app-clock vs store `TIME`; document parameter-tuning pain.
- **Resolves.** Replaces echo's *inferred* GCRA downsides (G-4) with measured ones, settling whether "GCRA is the
  multi-region pick" survives contact with reality. **Write the memory delta + drift result + tuning notes to
  ORG_MEMORY.**
- (grounds: field-06 §2.3, ecosystem-03 §4)

### X-6 — Verify CF Workers KV genuinely fails open as a limiter (the negative result that justifies O-20)
- **Question.** Does a limiter on CF Workers KV actually exhibit the 60s cross-region lag + 1-write/sec/key drop +
  ~172ms write latency that make it fail open — i.e. can echo *demonstrate* the bug it warns against?
- **Method.** A KV-backed counter hit cross-region and on one busy key; measure write-acceptance rate and
  cross-region staleness window.
- **Resolves.** Turns G-5's vendor-sourced magnitudes into an echo-measured negative result, making O-20 a
  demonstrated stance not a quoted one. **Write the write-drop rate + staleness window to ORG_MEMORY.**
- (grounds: field-07 §1, ecosystem-04 §CF-KV)

---

## How echo uses this file (the discipline)

1. **Before asserting on a DISPUTE (A),** state echo's working resolution AND the condition that would flip it —
   never present one side as settled.
2. **Before citing a verify-flagged claim (B),** mark it "likely/secondhand" — especially the Shopify numbers (G-1),
   the cost-thread specifics (G-2), the prefix-incident scale (G-3), and the vendor benchmark magnitudes (G-5).
3. **When a task hits an EXPERIMENT (C),** run the test and **write the result to ORG_MEMORY** so the gap closes for
   the whole fleet — that is echo dogfooding the "measure, don't assert" rule and the recursively-self-improving
   loop. The RSI cycle should also re-verify the currency caveats (D-F, G-7) against fresh primary docs.
