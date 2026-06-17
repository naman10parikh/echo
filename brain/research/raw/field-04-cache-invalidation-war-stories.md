---
title: "echo FIELD — Cache Invalidation: the hard half of the two hard things (war stories + taste)"
type: field-research
domain: caching
created: "2026-06-16"
researcher: FIELD-INTELLIGENCE (CP123 Wave-R)
currency: "June 2026 — primary sources Jan–Apr 2026; Phil Karlton aphorism is the timeless anchor"
sources:
  - { url: "https://www.the-main-thread.com/p/quarkus-cache-failure-semantics", date: "2026-04-26", author: "Markus Eisele (Red Hat)", note: "BEST source — success-only invalidation, lockTimeout defeats stampede, key-collision silent" }
  - { url: "https://oneuptime.com/blog/post/2026-01-25-redis-cache-invalidation/view", date: "2026-01-25", author: "OneUptime", note: "write-then-delete ordering, delete-vs-update, read-repopulates-stale race" }
  - { url: "https://oneuptime.com/blog/post/2026-01-30-cache-invalidation-strategies/view", date: "2026-01-30", author: "OneUptime", note: "4 strategies (TTL/event/version/tag) + TTL-as-safety-net opinion" }
  - { url: "https://designgurus.substack.com/p/your-cache-is-lying-to-you-5-invalidation", date: "2026-04-14", author: "Arslan Ahmad (DesignGurus)", note: "the 5 invalidation bugs framing (mostly paywalled — Bug #1 captured)" }
  - { url: "https://lukasniessen.medium.com/caching-in-2026-fundamentals-invalidation-and-why-it-matters-more-than-ever-867fee46e98b", date: "2026-02-08", author: "Lukas Niessen", note: "'Cache in as few places as possible'; nested-staleness example; Phil Karlton anchor" }
  - { url: "https://www.buildmvpfast.com/blog/llm-response-caching-cache-keys-invalidation-strategies-2026", date: "2026", author: "BuildMVPFast", note: "LLM caching: version fields (model/RAG version) most-forgotten" }
  - { url: "(search synthesis)", date: "2026", author: "WebSearch aggregate", note: "namespace-prefix-mismatch incident: DEL returns 0, stale persists, 5 microservices / tens of thousands of sessions" }
---

# Cache Invalidation — "There are only two hard things…" — the war stories behind the joke

> **Phil Karlton (the anchor everyone quotes, and they're right):** *"There are only two hard things in
> Computer Science: cache invalidation and naming things."* Lukas Niessen's 2026 piece closes with *"Phil
> Karlton was right. Cache invalidation is hard."* This file is the *why* — the specific, repeatable ways
> invalidation goes wrong in production, each with the fix echo should reach for.

---

## 1. The forgotten write path — the #1 invalidation bug (DesignGurus Bug #1, 2026-04-14)

**The bug (verbatim framing):** "A write operation exists without corresponding cache invalidation logic."
The canonical scenario: the main app updates a user via `/update-profile` and correctly invalidates the cached
user object. "Three months later someone builds an admin dashboard with a separate `/admin/edit-user`
endpoint **without proper invalidation**." Now there are two write paths and only one invalidates → stale
reads for any user edited through admin.

**The fix (verbatim):** "Connect all write paths—regardless of which interface creates them—to the same
invalidation mechanism."

**echo's taste:** invalidation must be a property of the **data**, not the **endpoint**. Centralize it: a
repository/data-access layer that invalidates on every write, or DB-level change-data-capture (CDC) that fires
invalidation regardless of which code path wrote. *If invalidation lives in the controller, the second
controller will forget it.* This is the same shape as the rate-limit "non-middleware route" bug (field-02 §2):
coverage gaps are correctness bugs.

---

## 2. The namespace / key-prefix mismatch — DEL returns 0, stale persists silently

**Source:** WebSearch synthesis (corroborated across multiple 2026 articles; the specific incident below is
secondhand — see GAP). The incident: "A production alert flagged inconsistencies in user profile reads,
tracing it to stale cache entries impacting **five microservices and tens of thousands of active sessions.**
A **namespace prefix mismatch** in the cache invalidation logic caused Redis **DEL commands to target
non-existent keys, returning 0** while stale entries persisted."

**Why it's insidious:** `DEL` returning `0` (deleted nothing) is **not an error** — it looks identical to "the
key wasn't cached." So the invalidation *appears* to succeed; the stale key lives on under a different prefix.
Writer used `user:{id}`, invalidator deleted `users:{id}` (or `v1:user:{id}` vs `v2:user:{id}`). The OneUptime
piece (2026-01-25) addresses exactly this with **explicit, shared key-naming** (`user:{user_id}:orders`).

**echo's taste:**
- **Treat `DEL` returning 0 as a signal, not a no-op.** If you expected to delete a key and got 0, log a
  warning (the energy `Result`/no-silent-failure law applies to cache ops too). A monotonic "invalidations
  that deleted nothing" metric catches prefix drift before it becomes a 5-service incident.
- **Centralize key construction** in one `cacheKey(entity, id)` function used by BOTH reader and invalidator.
  Hand-built key strings on each side are how prefixes drift. (Same root cause as field-02's spoofable-key
  bug — the key is the contract; build it in one place.)

---

## 3. The dual-write race & read-repopulates-stale (OneUptime 2026-01-25)

**The ordering rule (verbatim pattern):** "Update the database **first**" then delete the cache:
```python
update_profile_in_db(user_id, new_data)
r.delete(cache_key)
```
**Delete-vs-update (verbatim judgment):** you *could* "update the cache directly instead of deleting," but the
guide "**defaults to deletion. Deletion is safer because it forces fresh retrieval, avoiding stale-data
propagation.**"

**The race the simple pattern still has (verbatim):** "A concurrent reader might fetch stale data from DB
during the window between DB write and cache delete, then **write that stale data back**." Sequence:
1. Reader misses cache, reads OLD value from DB (write hasn't committed yet).
2. Writer commits NEW value to DB, then `DEL`s the cache.
3. Reader (now resumed) writes the OLD value it read in step 1 back into the cache.
4. Cache now holds OLD value with a fresh TTL — **stale until TTL or next write.**

**The fixes echo reaches for:**
- **Delete, don't update** the cache on write (verbatim consensus above) — an update races worse because two
  writers can interleave and the loser's value sticks.
- **Delayed double-delete** (the pattern OneUptime *omits* but is the standard answer to the step-3 race):
  delete the cache, do the DB write, then **delete the cache again after a short delay** (longer than a read's
  DB-fetch+set window). The second delete evicts any stale value a concurrent reader repopulated. echo should
  carry this explicitly since the cited article notes it's missing.
- **TTL as the safety net** (see §5) — bounds how long any such stale value can live.
- **Strong-consistency path:** for data where staleness is dangerous (auth tokens, permissions, balances),
  read-through with a per-key lock (single-flight, field-01 §3) so there's no repopulate-stale window — or
  don't cache it at all.

---

## 4. Success-only invalidation — the exception leaves stale data (Quarkus, 2026-04-26) — best gotcha

**Source:** the-main-thread.com, Markus Eisele (Red Hat), 2026-04-26. The single sharpest invalidation gotcha
I found, and it generalizes far beyond Quarkus.

**The rule (verbatim):** `@CacheInvalidateAll` "executes **only after successful method completion**. If the
method throws an exception, invalidation is **skipped entirely**."

**The killer line (verbatim, this is echo's voice):** *"Cache annotations look harmless until a failed write
leaves old data in the one place nobody is staring at: the cache."*

**The failure mode (verbatim):** "A method can mutate state in the backing store, then fail during a later
step. The old cache entry persists, serving stale data on subsequent reads with no error indication."

**The escape hatch (verbatim):** "Use `CacheManager.invalidateAll()` in a **`finally` block** for data where
staleness is dangerous (tokens, permissions, **rate limits**)." — note it explicitly names *rate limits*,
echo's other domain.

**Two more from the same source:**
- **Ordering bug (pre-Quarkus 3.32):** "invalidation could run **before** business logic finished, allowing
  concurrent readers to repopulate stale data between invalidation and write." (Same race as §3, caused by
  framework ordering.)
- **Silent key collision (verbatim):** "Typos in cache names create separate caches with defaults. **No error
  is raised**—you get silent behavioral surprises." (Same root cause as §2 — keys/names are an unchecked
  contract.)

**echo's taste:** invalidation must run on **both success and failure paths** when the backing store was (or
might have been) mutated — i.e. invalidate in a `finally`, or invalidate-before-AND-after, not only on the
happy path. A partial failure that mutated the DB but skipped invalidation is the worst kind of stale: silent,
indefinite, in the place nobody monitors.

---

## 5. TTL is the safety net — but the wrong TTL is its own bug

**Source:** OneUptime 2026-01-30. **The strongest production opinion (verbatim):** *"Always set a TTL as a
safety net. This prevents zombie cache entries from persisting indefinitely if your invalidation logic has
bugs."* echo treats this as a **law**: every cached key gets a TTL, full stop, because every invalidation
scheme above can fail and the TTL is the only thing that *guarantees* eventual correctness.

But TTL choice itself is a tradeoff and a bug source:
- **Too long** → stale data lives long when invalidation is missed (§1–§4).
- **Too short** → cache hit-rate collapses → you're back to hammering the origin → stampede risk (field-01).
- **Nested staleness** (Lukas Niessen's concrete example, verbatim): "Real data changes → 0:00 Inventory cache
  still fresh → until 1:00 Recommendation fetches at 0:59, gets **59-second-old data**." When cache A is built
  from cache B, the *effective* staleness is the **sum** of the TTLs, not either one. Layered caches compound
  staleness.
- **Synchronized TTLs** → the stampede in field-01 §4 (always jitter).

**echo's taste:** pick TTL from the data's *tolerance for staleness*, jitter it, and account for **layered
staleness** (a value cached downstream of another cache can be as stale as the sum of the TTLs). When in
doubt, **shorter TTL + stale-while-revalidate** beats a long TTL (fresh-enough + no user-facing latency).

---

## 6. The strategy menu + the "fewest places" principle

**Four invalidation strategies (OneUptime 2026-01-30), echo's verdict appended:**
| Strategy | Mechanism (verbatim) | echo verdict |
|----------|----------------------|--------------|
| **TTL-based** | "expiration time, after which it is automatically removed" | The **safety net** — always on, even with another scheme on top. |
| **Event-driven** | "invalidate the cache immediately when the source data changes" | Best freshness; vulnerable to §1 (forgotten path) and §4 (failure path). Centralize it. |
| **Version-based** | "Embed a version number in the cache key… increment the version to invalidate all old entries" | Best for **bulk** invalidation and the LLM case (§7). No DEL needed — old keys just age out by TTL. |
| **Tag-based** | "Invalidating a tag removes all entries with that tag" | Grouped invalidation across related data; watch the tag-set's own TTL ("expire the tag set slightly after the longest possible TTL"). |

**The overarching principle (Lukas Niessen, verbatim):** *"Cache in as few places as possible."* Every cache
layer is another place invalidation can be missed (§1) and another term in the layered-staleness sum (§5).
echo's bias: **cache once, at one well-chosen layer**, not opportunistically at every layer.

---

## 7. LLM response caching — invalidation's newest, nastiest variant

**Source:** BuildMVPFast LLM-caching piece + the WebSearch synthesis. **Why it's worse (verbatim):** "With
LLMs, cache invalidation is harder because **you can't always tell when a cached response has gone stale—it
still looks like a valid answer, it's just wrong.** **Version fields (model version, RAG version) are the ones
people forget most often, and they're the ones that cause the longest-lived bugs.**"

**echo's taste (directly relevant to the Energy fleet, which caches LLM calls):**
- **Put the model version, prompt-template version, and RAG-corpus version IN the cache key.** A response
  cached under `gpt-5.x + promptv3 + ragv12` must NOT be served after you upgrade the model or re-index the
  corpus. Version-keying (strategy 3) means the old entries simply never match again — no risky DEL sweep.
- A stale LLM answer has **no error signature** — it's plausible and wrong. So the version-in-key discipline
  is not optional; there's no "looks broken" signal to catch it later.

---

## 8. echo's invalidation decision (what echo tells a builder)

1. **Always set a TTL** (the safety net — every invalidation scheme can fail). Jitter it. (§5)
2. **Delete, don't update** the cache on write; **DB first, then DEL**. (§3)
3. **For data with concurrent readers + strict freshness, use delayed-double-delete** or a single-flight lock
   to close the repopulate-stale window. (§3)
4. **Invalidate on success AND failure** (`finally`) when the store was mutated. (§4)
5. **Centralize key construction** (`cacheKey(entity,id)`) so reader and invalidator can't drift prefixes;
   **treat `DEL → 0` as a logged signal**. (§2)
6. **Centralize invalidation in the data layer / CDC, not the endpoint** — every endpoint forgets. (§1)
7. **Version-key anything whose validity depends on external state** (LLM model/RAG version, schema version).
   (§7)
8. **Cache in as few places as possible**; account for **layered staleness = sum of TTLs**. (§5, §6)
