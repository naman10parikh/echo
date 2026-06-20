# echo — BRAND

## Name rationale

**echo.** An *echo* is a response that returns from a shared space after a delay. That is precisely the domain: a
**cache hit** returning the value computed last time, a **rate counter** that remembers the last request, a
**stale-while-revalidate** reply returning from the edge while a fresh one is fetched in the background. The name
encodes the through-line of the whole vertical — *state that returns across requests* — in one light, animate word
(the Energy naming family: light / relatable / animate, per CP123 D4). It is the response that comes back from the
shared store the platform cannot recycle out from under you.

## Tagline

> **State that outlives the request — counted, cached, and never leaked. Powered by Energy.**

- *outlives the request* → cross-request state is the founding problem (the `new Map()` law).
- *counted* → rate limiting (atomic, shared counters).
- *cached* → caching + invalidation (always-TTL + jitter, delete-don't-update, keys-as-contracts).
- *never leaked* → tenant isolation + the security stance (a limiter that fails open is worse than none).

## Symbolic connection to the workflow

| echo (the phenomenon) | the domain mechanic |
| --- | --- |
| a sound returning from a shared space | a value returning from a shared external store (Redis/Upstash/KV) |
| arrives after a delay | stale-while-revalidate; the cache hit that beats the origin |
| repeats what was said | the counter that remembers prior requests; idempotency replay returns the original response |
| fades on a timer | the TTL (always set, always jittered) |

## Colors & landing copy

echo shares the **Energy design system** — warm-black surfaces (**#141312**, never pure black), an **amber** accent,
**Instrument Serif** for display + **Poppins** for body (the serif/sans pairing is the single highest-impact
anti-AI-slop move). The canonical tokens live in `.claude/rules/design.md`; the cockpit (D3 product surface,
`scripts/cockpit.mjs`) consumes them — no generic AI purple/pink gradients. echo carries no bespoke brand color of
its own beyond the shared Energy palette; its visual identity is the warm-black + amber editorial system.

**Landing one-liner (human):** *echo has seen every way a rate limiter or cache fails in production — the `new Map()`
that works in `vercel dev` and silently leaks user A's data to user B in prod, the `X-Forwarded-For` spoof that turns
"5/min" into "unlimited," the cache that serves a stale LLM answer with no error. echo picks the right store,
algorithm, and keys — and proves the limit actually holds.*

**Landing one-liner (coding agent):** *Call echo before you store any cross-request state on serverless. It refuses
a `new Map()` counter, keys your limiter on identity not headers, and tells you fail-open vs fail-closed before you
ship. `echo brain "<question>"` — 23 defended opinions, 29 pitfalls, 19 production scenarios.*
