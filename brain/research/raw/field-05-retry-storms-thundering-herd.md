---
title: "echo FIELD — Retry storms & the thundering herd from the CLIENT side (backoff, jitter, circuit breakers)"
type: field-research
domain: rate-limiting / caching / resilience
created: "2026-06-16"
researcher: FIELD-INTELLIGENCE (CP123 Wave-R)
currency: "June 2026 — AWS incident Oct 2025; Depot Nov 2025; HN debate Jan 2026"
sources:
  - { url: "https://www.getpanto.ai/blog/aws-outage-2025-retry-storm", date: "2025-10", author: "Panto AI", note: "AWS Oct 2025: retry amplification + DWFM congestive collapse" }
  - { url: "https://depot.dev/blog/planetscale-to-reduce-the-thundering-herd", date: "2025-11-21", author: "Iris Scholten & Peter Hasko-Nagy (Depot, Staff Eng)", note: "REAL postmortem — retry-driven herd, fixed via query optimization NOT caching" }
  - { url: "https://hn.algolia.com/api/v1/items/46841137", date: "2026-01-31", author: "rjpruitt16 (HN)", note: "'Are retries the wrong abstraction under rate limits?' — taste signal" }
  - { url: "https://distributed-computing-musings.com/2025/08/thundering-herd-problem-preventing-the-stampede/", date: "2025-08", author: "distributed-computing-musings", note: "49pts/20c HN — the canonical 'preventing the stampede' write-up" }
  - { url: "https://github.com/Nodus-protocol/Nodus-Protocol-Core-Engine/issues/46", date: "2026-06-11", author: "issue author", note: "'No retry jitter — synchronized retries cause thundering herd after outages'" }
---

# Retry Storms — the thundering herd you cause yourself when the origin recovers

> **The thesis (carry this).** Cache stampede (field-01) is a herd caused by *expiry*. A retry storm is a herd
> caused by *failure + recovery*: when a dependency goes down, every client retries; the synchronized retries
> become a self-inflicted DDoS that (a) keeps the dependency down and (b) flattens it again the instant it
> recovers. Retries are the most-deployed "best practice" that most-reliably amplifies an outage. echo owns
> the client side of the herd: backoff, jitter, circuit breakers, and load-shedding.

---

## 1. The AWS US-East-1 outage (Oct 19-20, 2025) — retries turned a DNS bug into a 15-hour cascade

**Source:** getpanto.ai + the multi-source WebSearch synthesis. **Root cause** was a DNS race (a slow DNS
"Enactor" applied a stale plan to `dynamodb.us-east-1.amazonaws.com` just as a faster Enactor's cleanup
deleted it → all IPs for the DynamoDB endpoint were removed → endpoint unreachable). That's the *trigger*.
The *amplifier* was retries:

- **Verbatim:** "every AWS SDK, service, and application that relied on DynamoDB began retrying failed
  requests exponentially. Millions of retries flooded internal network systems, and the surge in retry
  traffic overwhelmed load balancers, NAT gateways, and internal routing components, **creating a feedback
  loop that affected even unrelated services**."
- **Recovery made it worse — "congestive collapse" (verbatim):** EC2's DWFM subsystem tracked server leases;
  when DynamoDB recovered, "DWFM attempted to re-establish all leases across the fleet… the system entered a
  **congestive collapse and was unable to make forward progress.**" The herd at *recovery* (every client
  reconnecting at once) was as damaging as the herd during the outage.
- **Scale:** ~15 hours; 4–6.5M+ error reports; 1,000+ companies (Venmo, Zoom, Reddit, Snapchat, Roblox,
  Coinbase, Amazon retail…).

**echo's taste:** the dangerous moment is **recovery**. A dependency coming back up faces the *entire* backlog
of waiting clients simultaneously. Without jittered backoff + a circuit breaker that reopens *gradually* (half-
open, trickle traffic), recovery re-triggers the outage. "Congestive collapse" is the precise term: the system
is so busy retrying that it can't make progress on real work.

---

## 2. Depot's thundering herd (Nov 2025) — a real postmortem where the fix was NOT caching

**Source:** depot.dev, Iris Scholten & Peter Hasko-Nagy (Staff Engineers), 2025-11-21. A valuable *contrarian*
datapoint: not every herd is solved by adding a cache.

**The trigger (verbatim):** "upstream systems outside of our control experience issues" — EC2 capacity
constraints, regional outages affecting the EC2 API, GitHub delivery failures. "Our system attempts to retry
so we can continue to run builds… But when the upstream problem is ongoing, **this demand can build up rather
quickly.**" (Retry-driven herd, §1 mechanism, at a smaller scale.)

**What broke (verbatim):** database CPU "jump[ed] to 100%, which cascades into a much larger problem." One
JSON-extraction query ran "**tens of thousands of times per minute** during the high demand period." Scale
context: "tens of individual builds to tens of millions of builds happening every single week"; p50 target
"below 100ms"; PlanetScale hard transaction timeout 20s.

**The fix (verbatim approach):** "Rather than read replicas or caching, Depot focused on **query
optimization**" — missing indexes, better index selection via EXPLAIN, batched WHERE-IN clauses, transactions
refactored under the 20s timeout, and a **composite index with the JSON extraction built in** so MySQL could
"evaluate `json_extract` as part of the index scan rather than extracting from every row." Result: "while we
did see increased CPU load… we avoided the 100% CPU state that previously made it unusable."

**echo's taste (important humility):** *caching is not the only answer to a herd, and sometimes it's the wrong
one.* If the herd hammers a query that's slow because it's *unindexed*, a cache just hides a fixable problem
(and adds invalidation risk, field-04). The honest decision tree: (1) is the origin slow because it's
*inefficient*? → fix the query/index first. (2) is the origin slow because it's *intrinsically expensive* and
*re-computed redundantly*? → then cache + single-flight. echo must not reflexively reach for a cache; the
Depot story is the receipt.

---

## 3. The retry-design debate — "Are retries the wrong abstraction?" (HN, Jan 2026)

**Source:** HN Ask "Are retries the wrong abstraction under rate limits?" by `rjpruitt16`, 2026-01-31.
**Verbatim thesis:** "in systems with high concurrency, fan-out, or shared downstream dependencies, retries
often seem to **amplify load instead of smoothing it**… It's made me wonder whether retries are solving the
wrong problem at the wrong layer — treating a **coordination issue** as an application-level error-handling
concern."

This is the same insight Arcjet states for rate limiting ("distributed rate limiting is fundamentally a
consistency problem," field-06) applied to retries: a retry is a *local* decision with *global* consequences.
N independent clients each making the locally-correct choice ("retry after backoff") produce a globally-
catastrophic synchronized wave.

**echo's taste:** retries are necessary but must be *coordinated*, not just *backed off*:
- **Jitter is non-negotiable** (see §4). Plain exponential backoff without jitter synchronizes the herd —
  every client retries at t=1s, 2s, 4s together.
- **Cap total retries AND total in-flight retries** (a budget), not just per-request attempts. AWS's own
  guidance is a **retry token bucket**: retries consume tokens; when the bucket empties, stop retrying
  (fail fast) so the system sheds load instead of amplifying it. This is the "retries as the wrong layer"
  fix — make retry a *coordinated, budgeted* resource, not a per-call reflex.
- **Circuit breaker over retry** for a *down* dependency: once it's clearly down, stop retrying entirely
  (open the breaker), and reopen *gradually* (half-open trickle) to avoid the recovery herd (§1).

---

## 4. Jitter — the one-line fix the whole industry keeps forgetting (2026 GitHub volume)

Both the cache stampede (field-01 §4) and the retry storm have the **same root cause: synchronization** — and
the **same one-line fix: jitter.** The June-2026 GitHub issue volume proves practitioners forget it constantly:
- **Nodus-Protocol #46** (2026-06-11): "**No retry jitter** — synchronized retries cause thundering herd
  after outages." (Exactly the §1 recovery herd.)
- **aiokafka #1165** (2026-05-31): "fetch backoff for NotLeaderForPartitionError uses **fixed delay** —
  thundering herd risk."
- **Agent-Hellboy/mcp-runtime #304**, **igortsives/togetherly #103**, **theplant/cachex #8** — all "add
  jitter."

**The canonical reference** (AWS Architecture Blog, "Exponential Backoff And Jitter," and the HN-popular
distributed-computing-musings 2025-08 write-up): **"full jitter"** — `sleep = random(0, min(cap, base*2^n))` —
beats "equal jitter" and plain exponential backoff, because it *maximally de-synchronizes* the retry times.
The intuition: backoff controls the *average* retry rate; jitter controls the *variance* — and it's the
zero-variance (everyone retries at the same instant) that causes the herd, not the average.

**echo's taste (a law):** *every retry backoff and every cache TTL gets jitter.* Fixed intervals are scheduled
herds. Prefer **full jitter** for retries. This is the single rule that connects echo's two domains (caching
+ rate limiting) — both herds, both fixed by the same line.

---

## 5. echo's resilience decision (client-side herd control)

1. **Jitter every backoff (full jitter) and every TTL.** Synchronization is the root cause of both herds. (§4)
2. **Budget retries with a retry-token-bucket**, not just per-request backoff — shed load when the budget is
   empty rather than amplifying. (§3)
3. **Circuit-break a down dependency** (stop retrying), and **reopen gradually** (half-open trickle) to avoid
   the recovery herd / congestive collapse. (§1, §3)
4. **Don't reflexively cache a herd — first ask if the origin is just inefficient.** Fix the index/query if
   so; cache only intrinsically-expensive redundant work. (§2)
5. **Plan for the recovery moment, not just the failure moment** — the entire backlog hits at once when a
   dependency comes back. (§1)
