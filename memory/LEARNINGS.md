# echo — LEARNINGS (append-only)

Every error → root cause → rule. Auto-compressed when >500 lines (memory-compress.sh).

## 2026-06-21 · A version pin must exist on npm

- **What broke:** the bootstrap memory, the heartbeat and `dsip.json` pinned `@upstash/ratelimit` 2.0.81, a version
  that does not exist (npm E404; the real one is 2.0.8). The RSI loop then reported drift on every run.
- **Root cause:** a synthesized number drifted from the brain's own table and nobody checked it against npm; the
  loop's hardcoded pin copied the bad value.
- **Rule:** check every pinned version with `npm view <pkg> version` before writing it, and keep one source for each
  pin (`brain/TOOL-MATRIX.md`). A loop that always reports drift hides the real drift.

## 2026-06-21 · The detector flagged a request-local Map

- **What broke:** `echo audit`, the hook and the eval classifier flagged an indented `const m = new Map()` inside a
  handler as a source-of-truth Map.
- **Root cause:** the local-declaration check required "indented and not module scope", but the module-scope regex
  matched any indented `const`, so the two conditions contradicted each other.
- **Rule:** a Map declared inside a function body is request-local and fine; test the detector against the
  flagship skill's BUG/OK table before changing it, since three surfaces share it.

## 2026-06-22 · A step that fails by design needs `set +e`

- **What broke:** the CI acceptance step ran `echo audit <bad fixture>; rc=$?`, and GitHub's implicit `bash -e`
  killed the step on the expected exit 1, turning a green product red.
- **Root cause:** the shell exited before the next command could read the return code.
- **Rule:** wrap any command that is expected to fail in `set +e` and assert the captured code explicitly.

## 2026-06-22 · Clamp and warn on nonsense input

- **What broke:** a first-time user got a negative bill from `echo cost --rps -5`, and an unknown `--algo` was
  silently priced as if it were known.
- **Root cause:** inputs were trusted as given.
- **Rule:** clamp numeric inputs to their valid range and say so; warn on an unknown option value instead of
  guessing.

## 2026-10-19 · A bin name can be shadowed, and an npx bin is a symlink

- **What broke:** `npx -y -p github:naman10parikh/echo echo --help` printed `--help` (the shell's built-in `echo`
  ran), and `echo-mcp` through npx exited at once with no server.
- **Root cause:** a bin named after a shell builtin never runs from a shell; the MCP start guard matched
  `process.argv[1]` against `mcp-server.js`, but npx starts the bin through a symlink in `node_modules/.bin`.
- **Rule:** never name a bin after a shell builtin (`echo-cli` is the runnable name); resolve `argv[1]` with
  `realpathSync` before a main-module check; prove every bin through npx from GitHub.
