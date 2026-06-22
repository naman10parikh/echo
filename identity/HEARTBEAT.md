# echo — Heartbeat

> echo is a CLI/MCP **tool-employee**, not an autonomous opportunity-scanner — its recurring schedule is the
> **deterministic RSI loop** (`dsip.json` `loop.cadence: nightly`, run by `.github/workflows/echo-rsi.yml`), which
> keeps the brain current and the evals green. Each entry: what to check · frequency · action on anomaly.

## Schedule (the deterministic $0 RSI half — tokenless, D8)

| Check | Frequency | Action on anomaly |
| --- | --- | --- |
| **Version-currency** — `npm view @upstash/ratelimit version` vs the pinned **2.0.8** | Nightly | Flag drift to `brain/ORG_MEMORY.md` |
| **Doc-currency** — the brain's flagged caveats (Fluid-Compute magnitudes, Vercel-KV provisioning, version pins) have a fresh re-check date | Nightly | Flag stale caveats to `brain/ORG_MEMORY.md` |
| **Eval-regression** — re-run the L1 golden assertions + THE acceptance test (the 8 🔴 golden tasks) | Nightly + every PR/push | Any red = a diff proposed; CI red-blocks the 🔴 tasks |
| **Link-check** — the brain's cited sources still resolve (the receipts stay valid) | Nightly | Flag a broken source link |

## Health indicators

- **Healthy:** `darwin-check dsip.json` ≥ L1; the latest `echo-rsi.yml` run is green; no version drift unflagged.
- **Warning:** version drift detected (pinned 2.0.8 ≠ latest) OR a brain caveat past its re-check date.
- **Critical:** the acceptance test is red OR a 🔴 golden task regressed → CI blocks the merge.

## The deferred Claude half (lights up on `CLAUDE_CODE_OAUTH_TOKEN`, D8)

When the token is set, the nightly loop additionally runs the **6 experiments** (X-1 multi-instance + HTTP/2 hold ·
X-2 measured cmds/request + break-even · X-3 `revalidateTag` laziness on the pinned Next version · X-4 distributed
SETNX+Lua serializes origin · X-5 GCRA memory/drift · X-6 CF-KV-fails-open negative result), writes each measured
result to `brain/ORG_MEMORY.md`, and proposes a brain edit (a settled dispute moves from `GAPS-AND-DISPUTES.md` into
`OPINIONS.md` with the measured backing). This is echo dogfooding its own "measure, don't assert" stance.

## Recovery

1. Read the failing check from the latest `echo-rsi.yml` run / `logs/runs.jsonl`.
2. Check `brain/KNOWN-PITFALLS.md` (detection columns) + `memory/LEARNINGS.md` for a known fix.
3. If fixable (a version bump, a re-pin, a fixture refresh): apply, re-run the eval pyramid, commit named files.
4. If not (a genuine brain dispute surfaced): record it in `brain/GAPS-AND-DISPUTES.md` and defer the measurement
   to the Claude-half experiment that owns it.
