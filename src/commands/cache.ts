/**
 * `echo cache <pattern> [--runtime]` — emit a correct cache (O-10..O-14; S-09/S-18; GT-4/5/10).
 *
 * Every emitted cache carries the required properties:
 *   - stale-while-revalidate (serve stale instantly, refetch in background) — the default refresh (TOOL-MATRIX §3)
 *   - ALWAYS a TTL, and JITTER it (a fixed TTL across a fleet is a scheduled stampede) — O-10/S-09
 *   - a PER-TENANT key built by the ONE cacheKey() contract (no cross-tenant bleed) — O-13/S-06
 *   - delete-don't-update + DB-first-then-DEL + invalidate in `finally` — O-11/O-12
 *   - `cache llm` VERSION-KEYS on model + prompt-template + RAG-corpus (a stale LLM answer has no error
 *     signature) — O-14/S-18/GT-10
 */
import chalk from "chalk";

function emitGenericCache(pattern: string): string {
  return `// echo cache — ${pattern}. SWR + always-TTL+jitter + per-tenant key + delete-don't-update invalidation.
import { Redis } from "@upstash/redis";
const redis = Redis.fromEnv();

// ✅ the ONE key contract — reader + invalidator import the SAME function (O-13/S-06).
export function cacheKey(tenantId: string, id: string): string {
  return \`${pattern}:\${tenantId}:\${id}\`; // PER-TENANT — never leak across tenants
}

// ✅ always a TTL, and JITTER it — a fixed TTL across keys is a scheduled stampede (O-10/S-09).
function jitteredTtl(baseSec = 300): number {
  return baseSec + Math.floor(Math.random() * baseSec * 0.2); // ±20% spread
}

// ✅ stale-while-revalidate: serve stale instantly, refetch in the background (TOOL-MATRIX §3).
export async function readSWR(tenantId: string, id: string, fetchFresh: () => Promise<unknown>) {
  const key = cacheKey(tenantId, id);
  const wrapped = await redis.get<{ v: unknown; soft: number }>(key);
  const now = Date.now();
  if (wrapped) {
    if (now < wrapped.soft) return wrapped.v;            // HIT (fresh)
    void revalidate(key, fetchFresh);                    // STALE → serve stale, refetch in bg
    return wrapped.v;
  }
  return fill(key, fetchFresh);                          // MISS → fill
}

async function fill(key: string, fetchFresh: () => Promise<unknown>) {
  const v = await fetchFresh();
  const ttl = jitteredTtl();
  await redis.set(key, { v, soft: Date.now() + ttl * 0.5 * 1000 }, { ex: ttl });
  return v;
}
async function revalidate(key: string, fetchFresh: () => Promise<unknown>) {
  try { await fill(key, fetchFresh); } catch { /* keep serving stale on refetch failure */ }
}

// ✅ invalidate: DELETE (don't update), DB FIRST then DEL, in a finally (O-11/O-12).
export async function onWrite(tenantId: string, id: string, writeDb: () => Promise<void>) {
  const key = cacheKey(tenantId, id);
  try { await writeDb(); }
  finally {
    const deleted = await redis.del(key);
    if (deleted === 0) console.warn("[cache] expected DEL returned 0 — prefix drift? (S-06)", key);
    setTimeout(() => void redis.del(key), 500); // delayed double-delete closes the repopulate race (S-07)
  }
}`;
}

function emitLlmCache(): string {
  return `// echo cache llm — VERSION-KEYED on model + prompt-template + RAG-corpus (O-14/S-18). A stale LLM answer
// has NO error signature; version-keying means old entries simply never match after an upgrade (no DEL sweep).
import { Redis } from "@upstash/redis";
import { createHash } from "node:crypto";
const redis = Redis.fromEnv();

// ✅ the key includes EVERY external-state version — model, prompt-template, RAG-corpus (O-14).
export function llmCacheKey(opts: {
  modelVersion: string;        // e.g. "claude-opus-4-8"
  promptTemplateVersion: string;
  ragCorpusVersion: string;
  prompt: string;
}): string {
  const h = createHash("sha256").update(opts.prompt).digest("hex").slice(0, 16);
  return \`llm:\${opts.modelVersion}:\${opts.promptTemplateVersion}:\${opts.ragCorpusVersion}:\${h}\`;
}

export async function cachedLlm(key: string, call: () => Promise<string>) {
  const hit = await redis.get<string>(key);
  if (hit !== null && hit !== undefined) return hit;       // HIT
  const fresh = await call();
  const ttl = 86400 + Math.floor(Math.random() * 3600);    // always-TTL + jitter (safety net, O-10)
  await redis.set(key, fresh, { ex: ttl });
  return fresh;
}
// After a model/template/corpus bump, NO pre-bump response is ever served — the key no longer matches (GT-10).`;
}

export function runCache(pattern: string, opts: { runtime?: string; json?: boolean } = {}): number {
  const isLlm = pattern.toLowerCase() === "llm";
  const code = isLlm ? emitLlmCache() : emitGenericCache(pattern);
  const rationale = isLlm
    ? ["version-key on model+prompt-template+RAG-corpus (O-14/S-18)", "always-TTL+jitter as the safety net (O-10)"]
    : [
        "stale-while-revalidate default (TOOL-MATRIX §3)",
        "always-TTL + JITTER — fixed TTL across keys is a scheduled stampede (O-10/S-09)",
        "per-tenant key via the ONE cacheKey() contract (O-13/S-06)",
        "delete-don't-update, DB-first-then-DEL, invalidate in finally, delayed-double-delete (O-11/O-12/S-07)",
      ];

  if (opts.json) {
    process.stdout.write(JSON.stringify({ pattern, runtime: opts.runtime ?? "node", code, rationale }, null, 2) + "\n");
    return 0;
  }
  process.stderr.write(
    chalk.bold(`echo cache — ${pattern} (${opts.runtime ?? "node"})\n`) +
      rationale.map((r) => chalk.dim(`  • ${r}`)).join("\n") + "\n\n",
  );
  process.stdout.write(code + "\n");
  return 0;
}
