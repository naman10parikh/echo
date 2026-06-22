# echo — SANDBOX.md (the runtime envelope for the acceptance test)

> Component **C11 · Sandbox / Infra** (HARNESS-OVERRIDES §11; PLAN §3 C11, §5, §8; DECISIONS **D15**).
>
> echo's real integration point is a **live Redis-protocol store** — `@upstash/ratelimit` is HTTP-only (P-12), so
> the deterministic test envelope is a local **Redis + serverless-redis-http (SRH)** pair that speaks the Upstash
> REST API. `@upstash/ratelimit` talks to SRH **exactly** as it talks to Upstash, with **zero Upstash creds**.
> This is the `D15` local-first / `$0` / no-creds merge gate: the CI `acceptance` job boots this envelope and the
> limiter hits it (rc 0, proven by run-id). The **live-Upstash** path is a SEPARATE, ADDITIVE, non-blocking
> `workflow_dispatch` job (D7 → CHAIRMAN-CHECKLIST), never a merge blocker.

---

## 1. The deterministic / $0 envelope (the CI default)

Two GitHub Actions `services:` (in `.github/workflows/echo-ci.yml`, job `acceptance`):

| service | image | role | port |
| --- | --- | --- | --- |
| `redis` | `redis:7` | the real Redis-protocol store (the atomic counter backing) | `6379` |
| `srh` | `hiett/serverless-redis-http:latest` | translates Upstash REST → Redis, so `@upstash/ratelimit` (HTTP-only) runs unchanged | `8080` |

The env the job (and the limiter) reads — **inline, hermetic, no account**:

```yaml
env:
  SRH_TOKEN: example_token
  UPSTASH_REDIS_REST_URL: http://localhost:8080
  UPSTASH_REDIS_REST_TOKEN: example_token
```

SRH is configured (via its own env) to accept exactly that token and to dial the `redis:7` service:

```yaml
srh:
  image: hiett/serverless-redis-http:latest
  env:
    SRH_MODE: env
    SRH_TOKEN: example_token
    SRH_CONNECTION_STRING: "redis://redis:6379"
  ports:
    - 8080:80
```

> **Why SRH and not a mock:** HARNESS-OVERRIDES §11 ✅ requires the acceptance job to **actually boot SRH and
> have the limiter hit it** — a `SANDBOX.md` that only *describes* it is 🟡. SRH is Upstash's own recommended CI
> path; the documented alt is `upstash-redis-local` (`DarthBenro008/upstash-redis-local`). We pin the Redis store
> to a `7` major; SRH tracks `latest` (it is a thin REST shim, low churn).

### Running the SRH envelope locally (optional — Docker)

The Vitest acceptance tests are **local-first** and run on a bare checkout with **no Docker** (see §3). To exercise
the *real* `@upstash/ratelimit` + SRH path locally (the same one CI runs), bring the envelope up by hand:

```bash
# 1. Redis
docker run -d --name echo-redis -p 6379:6379 redis:7
# 2. SRH pointing at it (REST on :8080, token = example_token)
docker run -d --name echo-srh -p 8080:80 \
  -e SRH_MODE=env -e SRH_TOKEN=example_token -e SRH_CONNECTION_STRING="redis://host.docker.internal:6379" \
  hiett/serverless-redis-http:latest
# 3. point echo at it and run the SRH smoke (the real lib against the real REST path)
UPSTASH_REDIS_REST_URL=http://localhost:8080 UPSTASH_REDIS_REST_TOKEN=example_token \
  node scripts/acceptance/srh-limiter-smoke.mjs
# teardown
docker rm -f echo-redis echo-srh
```

---

## 2. What the envelope proves (the acceptance clauses — PLAN §5)

The `acceptance` job, with the envelope up, runs the three clauses (red-blocking on PR + push to main):

1. **Limiter holds** — the real `@upstash/ratelimit` `slidingWindow` against SRH: fire `N > limit` concurrent
   requests, assert **`admitted == limit`** (NOT `>`). Proves an **atomic + shared** counter (O-06/S-01/S-03) —
   the bug class a `new Map()` per-instance counter silently fails. (`scripts/acceptance/srh-limiter-smoke.mjs`.)
2. **Cache SWR** — `test:acceptance:cache`: the 3 SWR states (miss→fill, hit, stale-served + bg-refetch) and a
   **jittered TTL** (two keys written together get different expiries — S-09).
3. **Anti-pattern** — `echo audit eval/fixtures/bad-map-counter/` → **exit 1**; `echo audit
   eval/fixtures/ok-ephemeral-cache/` → **exit 0** (the P-01 vs P-02 signature judgment).

---

## 3. Local-first behavior (D15) — why the merge gate needs zero infra

Per **D15** (the fleet-wide C2 acceptance-bar shape: *local-first / $0 / no-creds*), the Vitest gate must be green
on a **bare `pnpm install && pnpm build && pnpm run test:acceptance:*`** with **no Docker and no creds**:

- **`test:acceptance:limiter`** is **environment-aware**. When `UPSTASH_REDIS_REST_URL` is set + reachable (CI with
  SRH, or a hand-run local envelope), it runs the **real** `@upstash/ratelimit` path. Otherwise it runs an
  **in-process sliding-window limiter** with the *same atomic-shared semantics* against one serialized counter —
  the literal "in-proc-limiter" D15 names for echo. Both modes assert `admitted == limit`.
- **`test:acceptance:cache`** runs entirely in-process (it asserts SWR-state + TTL-jitter logic, no store needed).
- The CI `acceptance` job ADDS the SRH smoke (`scripts/acceptance/srh-limiter-smoke.mjs`) so the **real lib + real
  REST path** is exercised against the booted SRH — satisfying §11's "limiter hitting SRH (rc 0, run-id)".

Net: the merge gate is GREEN with **zero chairman action** (SRH is hermetic; the in-proc fallback needs nothing).

---

## 4. The live-Upstash path (on-demand, ADDITIVE, NOT a merge blocker)

A SEPARATE `workflow_dispatch` job (`live-upstash`) proves the real Upstash REST path + genuine multi-instance
behavior (X-1) against a **free-tier** Upstash account (provisioned under D7). It is **non-blocking** by design
(quota / flake isolation, mirrors the fleet's rocket-V5 / turbo-V2 pattern). Its secrets are a CHAIRMAN-CHECKLIST
item (`ECHO-2`), never required for merge:

```bash
# chairman-only, one-time (free tier, console.upstash.com → [removed]):
gh secret set UPSTASH_REDIS_REST_URL   --repo <owner>/echo --body "https://<db>.upstash.io"
gh secret set UPSTASH_REDIS_REST_TOKEN --repo <owner>/echo --body "<rest-token>"
# then: Actions tab → "echo CI" → live-upstash → Run workflow
```

Until provisioned, `live-upstash` is skipped (the job guards on the secret being non-empty) — the deterministic
`acceptance` job is the gate and it is already green.

---

## See also

- `PLAN.md` §5 (the acceptance test) · §8 (required secrets) · §3 C11 (sandbox component).
- `HARNESS-OVERRIDES.md` §11 (the ✅ bar) · §9 (evals + the acceptance test green in CI).
- `CHAIRMAN-CHECKLIST.md` — `ECHO-2` (live-Upstash secrets) · `ECHO-3` (post-push acceptance run-id).
- `.github/workflows/echo-ci.yml` — the `acceptance` + `live-upstash` jobs.
- `test/acceptance/limiter.test.ts` · `test/acceptance/cache.test.ts` · `scripts/acceptance/srh-limiter-smoke.mjs`.
