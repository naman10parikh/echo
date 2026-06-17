# echo ECOSYSTEM-08 — top GitHub issues that reveal real-world breakage

> Sorted by reaction count + comment engagement (the signal that an issue hit many people).
> Source: `gh api repos/upstash/ratelimit-js/issues/*` + `mcp__github__search_issues
> sort:reactions-desc`, retrieved 2026-06-16. These are the bugs echo's eval scenarios should
> reproduce — real pain, not listicle features.

## @upstash/ratelimit-js — the high-engagement issues

### #17 🔴 "Unable to check remaining uses without triggering an increment" (CLOSED, +6, **18 comments**)
> "it's useful to show the end user a count of how many uses they have left … there doesn't
> appear to be any way to access the key consistently without also triggering an increment …
> The key appears to be appended with a variable number value that gets in the way of doing a
> standard redis GET." (source: github.com/upstash/ratelimit-js/issues/17)
- **The real-world breakage:** developers naively GET the Redis key to render "X requests left,"
  but the key name embeds a window-id suffix (so you can't reconstruct it), and even if you
  could, the natural API only exposes the count *as a side effect of consuming one*. The fix
  shipped: a **`getRemaining(identifier)`** method that reads WITHOUT decrementing. **echo eval
  scenario:** "show remaining quota in a header without burning a request" → must use
  `getRemaining`, not `limit`. 18 comments = this confused a LOT of people. The reset-time of
  `getRemaining` for sliding window is still "start of next window," not exact (see #59).

### #115 🟠 "ioredis compatibility" (OPEN, +4, 13 comments)
> "Would like to use upstash via ioredis to remove http overhead … ioredis is one of the
> recommended clients for upstash, but it's not compatible with ratelimit-js." (source: issues/115)
- **Breakage:** you cannot use a raw-TCP client (ioredis/node-redis) as the store — only the
  @upstash/redis HTTP client. On long-running Node servers the HTTP hop is pure latency overhead
  vs a pooled TCP connection. Still UNRESOLVED 2026-06. **echo must document this as a hard
  boundary:** @upstash/ratelimit = HTTP-Redis only; if you need TCP-Redis rate limiting on a
  persistent server, use `rate-limiter-flexible` (which speaks ioredis/node-redis) instead.

### #9 🔴 "Next.js middleware example does not work — Module not found: Can't resolve 'stream'" (CLOSED, 2 comments)
> "Error: Module not found: Can't resolve 'stream' … ./node_modules/@upstash/redis/esm/
> platforms/nodejs.js … You're using a Node.js module (stream) which is [not available in the
> Edge runtime]." (source: github.com/upstash/ratelimit-js/issues/9)
- **Breakage:** the SDK auto-picked the **Node** platform build inside Next.js **Edge
  middleware**, which has no `stream` polyfill → build break. Root cause = importing the wrong
  platform entry for the runtime. **echo eval scenario:** "rate-limit in Next.js middleware" →
  must import the edge-safe entry / `Redis.fromEnv()` resolves correctly on modern versions; on
  old versions you import `@upstash/redis/cloudflare` etc. This is the canonical "right library,
  wrong runtime build" trap.

### #71 🟠 "Limiting Concurrency" (CLOSED, +2, 12 comments)
> "Would love to use this library … but a few APIs incur concurrency/parallelity limitations.
> Currently using bottleneck." (source: issues/71)
- **Breakage/scope-limit:** rate limiting (requests per *time*) ≠ concurrency limiting (max *in-
  flight at once*). @upstash/ratelimit does NOT do concurrency caps. **echo must teach the
  distinction:** for "max N concurrent calls to a downstream" you need a semaphore/`bottleneck`/
  `p-limit` or `rate-limiter-flexible`'s `RateLimiterConcurrency`, not a token bucket. Conflating
  the two is a common design error.

### #58 🟡 "Dynamic token cost on tokenBucket" (CLOSED, +1) → answered by the `rate` param
> "Is there a way to dynamically calculate how many tokens a request should cost?" (issues/58)
- Resolved by `limit(id, { rate: cost })`. **echo scenario:** weight expensive endpoints (an
  LLM call costs 10 tokens, a health check costs 1) using a single bucket.

### #59 / #80 🟡 reset-time + reset-a-specific-identifier
- #59 "Ratelimit doesn't seem to return proper reset time" + #80 "Support getting and resetting
  limit of a specific identifier" (11 comments). The fix: a **`resetUsedTokens(identifier)`** /
  `resetTokens` method exists now; and the `reset` field for sliding window is documented as
  approximate ("start of next window"), which is why people thought it was "wrong." (source:
  issues/59, issues/80) **echo scenario:** "admin manually clears a user's rate-limit" → use the
  reset method; "show exact retry-after" → don't trust sliding-window `reset` literally.

### #14 🟢 the `ephermeralCache` typo (CLOSED)
- The ephemeral cache option was misspelled `ephermeralCache` in an early version → silently
  no-op'd the in-memory cache for anyone who spelled it correctly. Fixed. **echo lesson:** TS
  doesn't catch a misspelled optional option key — a class of silent-no-op bug echo's eval
  should guard against. (source: issues/14)

## Cross-cutting pattern across these issues (echo's synthesis)
The recurring theme is **"the limiter is a black box and I need to introspect/override it"**:
read remaining without consuming (#17), reset a key (#80), exact retry-after (#59), variable cost
(#58), different store (#115), concurrency not rate (#71). echo's value-add over the raw library
is exactly this introspection/override layer + steering users to the right tool when the library
doesn't fit (concurrency → semaphore; TCP-Redis → rate-limiter-flexible; exact global →
Durable Object).

## GAP to fill (flagged for GAPS-AND-DISPUTES)
- I could not enumerate the top issues of `rate-limiter-flexible` and `express-rate-limit` with
  the same reaction-sort depth in this pass (the upstash issue dump was prioritized as echo's
  flagship). A follow-up `gh api repos/animir/node-rate-limiter-flexible/issues?sort=reactions`
  and the same for express-rate-limit would round this out.
