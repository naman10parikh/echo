---
name: echo-invalidation
description: Cache a hot path without leaking across tenants or serving stale data. Use when the task is "cache this", "speed up this endpoint", "why is my cache stale", or "users still see old data after I updated it". Encodes always-TTL+jitter, delete-don't-update, invalidate-in-finally, centralize-in-the-data-layer, keys-as-contracts, and version-keying for LLM/RAG caches. Knows revalidateTag is LAZY.
---

# echo-invalidation — caching without the stale-data bug (the hard half)

> **Brain anchors:** O-10, O-11, O-12, O-13, O-14 (OPINIONS) · P-17, P-18, P-19, P-20, P-21, P-26 (PITFALLS) ·
> S-05, S-06, S-07, S-08, S-18 (BATTLE-TESTED-SCENARIOS). Behind `echo cache <pattern>` + `echo key`.
> *"There are only two hard things in CS: cache invalidation and naming things."* — echo owns both.

## Trigger

- "cache this" / "speed up this endpoint" / "add a cache layer".
- "why is my cache stale" / "users still see old data after I updated it" / "I revalidated but nothing changed".
- A multi-tenant read path (any cache that could serve tenant A's value to tenant B).
- Caching an **LLM / RAG** response (the silent-stale danger zone — a stale answer has no error signature).

## The 5 stances echo applies to every cache

1. **ALWAYS set a TTL, and JITTER it (O-10 / P-21 / P-22).** The TTL is the only thing that *guarantees* eventual
   correctness when invalidation has a bug (forgotten path, prefix mismatch, dual-write race) — it flushes zombie
   entries. And a *fixed* TTL across a fleet of keys is a **scheduled stampede** (synchronized expiry) → write
   `ttl ± rand`. No escape hatch; even with event-driven invalidation on top, the TTL stays as the net.
2. **DELETE, don't UPDATE; DB FIRST, then DEL; double-delete for strict freshness (O-11 / P-18).** Updating the cache
   races worse than deleting (two writers interleave, the loser's value sticks). A **delayed double-delete** closes
   the window where a concurrent reader writes back the OLD value after your DEL.
3. **Invalidate in `finally` — on success AND failure — when the store was mutated (O-12 / P-19).** Success-only
   invalidation (framework cache annotations) leaves stale data when a method mutates then throws: *"the old entry
   persists in the one place nobody is staring at."*
4. **Centralize invalidation in the DATA LAYER / CDC, not the endpoint; keys are CONTRACTS built in ONE function
   (O-13 / P-17 / P-20).** *"If invalidation lives in the controller, the second controller will forget it"* (the #1
   invalidation bug — the admin endpoint that didn't invalidate). Hand-built key strings drift (`user:` vs `users:`)
   → `DEL` returns 0, stale persists silently. Build the key once with `echo key <entity> <id>`; the reader, the
   invalidator, AND the limiter import the SAME builder. **A `DEL → 0` on an expected key is a logged signal, not a success.**
5. **VERSION-KEY anything whose validity depends on external state (O-14 / S-18).** An LLM/RAG/schema-version-bound
   value: put the **model version + prompt-template version + RAG-corpus version** in the key. After an upgrade, old
   entries simply never match again — no risky DEL sweep, no silently-wrong stale answer.

## Platform gotcha echo always flags (P-26)

**`revalidateTag` is LAZY** — it marks the tag stale and SWR-refetches on the *next* visit; until then the previous
response is served. *"I revalidated but users still see old data."* For **read-your-writes** (a user's own
just-edited profile) combine it with a router refresh / the newer **`updateTag()`** (eager), or route the writer's
reads to origin, or accept the stale window. Plus the **two-cache problem** (server Data Cache vs client Router Cache
disagree on back-navigation). Design tag cardinality carefully: over-broad → invalidate-the-world stampede;
too-granular → forget one.

## Steps

1. Decide per-tenant isolation: the key MUST include the tenant/user scope (build it via `echo key`).
2. Choose the refresh model: **stale-while-revalidate** (the default — serve stale, refetch in background) for
   read-mostly; write-through only for read-your-writes-critical via a single logical writer.
3. Emit the cache with `echo cache <pattern>` (SWR + always-TTL+jitter + per-tenant key). For LLM: `echo cache llm`
   (version-keyed on model + prompt-template + RAG-corpus, O-14).
4. Wire invalidation **in the data layer**, **delete-not-update**, **DB-first-then-DEL**, **in `finally`**, and **log
   any expected `DEL → 0`**.
5. **Verify:** miss→fill, then HIT within TTL, then stale-served+bg-refetch after the stale window; two keys written
   together have **different** expiries (jitter proof); a model-version bump serves NO pre-bump answer.

## Output format

Emitted cache code (stdout) + the `key()` contract function + a rationale block naming: **per-tenant key · TTL+jitter
· SWR · delete-don't-update · invalidate-in-finally · data-layer-centralized**, each tied to its stance (O-1x). For
an LLM cache, the version-key composition is shown explicitly.
