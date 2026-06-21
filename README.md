# echo

**The Energy fleet's rate-limiting / caching domain-expert employee.** State that outlives the request — counted, cached, and never leaked. Powered by Energy.

echo turns "use Upstash" into a *correct, tested, costed* limiter/cache: it picks the store, algorithm, key schema, TTL, invalidation, and idempotency semantics, refuses a `new Map()` counter / a spoofable-header key / a limiter on Cloudflare KV, and proves the limit actually holds under concurrent load. Consumed by coding agents (CLI + MCP) first, humans (the cockpit) second.

- **CLI:** `echo --help` · `echo audit <path>` · `echo limiter <kind>` · `echo cache <pattern>` · `echo brain "<question>"`
- **MCP:** `echo_design_limiter` / `echo_design_cache` / `echo_audit_state` / `echo_cost` / `echo_ask` (stdio; registered in `.mcp.json`)
- **Brain:** 23 defended opinions, 29 version-pinned pitfalls, 19 production failure scenarios (`brain/`) — `echo brain "<q>"`.

A recursively self-improving, agent-native harness — built on the Energy harness formula. See `AGENTS.md` (how to invoke), `CLAUDE.md` (operating rules), `identity/SOUL.md` (full persona).
