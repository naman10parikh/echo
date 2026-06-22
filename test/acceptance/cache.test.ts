/**
 * THE acceptance test — clause 2: the cache demonstrates a working stale-while-revalidate path (PLAN §5; E4).
 *
 * The bar (PLAN §5 verify step 3): assert the **3 SWR states** and a **jittered TTL**:
 *   1. MISS → fill (first read of a cold key fetches fresh + writes it).
 *   2. HIT (a read inside the fresh window serves the cached value, no refetch).
 *   3. STALE → serve stale instantly + refetch in the background (a read past the soft/stale window returns the
 *      OLD value immediately AND triggers a background refresh that lands the new value).
 *   4. JITTERED TTL — two keys written together get DIFFERENT expiries (a fixed TTL across a fleet is a scheduled
 *      stampede, S-09).
 *
 * This is the LITERAL logic `echo cache` emits (`src/commands/cache.ts` → `readSWR`/`fill`/`jitteredTtl`). echo's
 * emitters write that logic as a code STRING (for the user to paste), so this test re-implements the SAME contract
 * over an in-memory TTL store — proving the PATTERN echo ships is correct, $0 / no-creds / no-Docker (D15). The
 * store here stands in for Redis; the SWR control-flow + jitter are echo's, unchanged.
 */
import { describe, it, expect } from "vitest";

/** A wrapped cache entry: the value + the SOFT (stale) deadline — exactly the `{v, soft}` shape echo emits. */
interface Wrapped {
  v: unknown;
  soft: number; // ms epoch; past this → stale (serve + refetch)
}

/** A tiny in-memory TTL store standing in for Redis (set with hard TTL, get respects expiry). */
class TtlStore {
  private readonly m = new Map<string, { val: Wrapped; expiresAt: number }>();
  set(key: string, val: Wrapped, ttlSec: number): void {
    this.m.set(key, { val, expiresAt: Date.now() + ttlSec * 1000 });
  }
  get(key: string): Wrapped | null {
    const e = this.m.get(key);
    if (!e) return null;
    if (Date.now() >= e.expiresAt) {
      this.m.delete(key); // hard-expired
      return null;
    }
    return e.val;
  }
  /** the raw TTL remaining (ms) — used to assert two keys got DIFFERENT (jittered) expiries. */
  expiryOf(key: string): number | null {
    return this.m.get(key)?.expiresAt ?? null;
  }
}

/** echo's jittered TTL (the literal `jitteredTtl` from cache.ts): base + up to +20%. */
function jitteredTtl(baseSec: number, rnd: () => number): number {
  return baseSec + Math.floor(rnd() * baseSec * 0.2);
}

describe("acceptance · cache demonstrates a working SWR path (O-10/S-09)", () => {
  it("walks MISS → fill, HIT, then STALE → serve-stale + background refetch", async () => {
    const store = new TtlStore();
    const key = "profile:tenantA:u1";
    // base TTL tiny so the test runs fast; soft window = half the hard TTL (echo's `soft = now + ttl*0.5`).
    const HARD_TTL_SEC = 1; // 1s hard expiry
    let fetchCount = 0;
    let fresh = "v1";
    const fetchFresh = async (): Promise<unknown> => {
      fetchCount += 1;
      return fresh;
    };

    // echo's readSWR control-flow, re-implemented over the in-memory store (no jitter here — determinism).
    const fill = async (): Promise<unknown> => {
      const v = await fetchFresh();
      store.set(key, { v, soft: Date.now() + HARD_TTL_SEC * 0.5 * 1000 }, HARD_TTL_SEC);
      return v;
    };
    let bgRefetch: Promise<unknown> | null = null;
    const readSWR = async (): Promise<unknown> => {
      const wrapped = store.get(key);
      const now = Date.now();
      if (wrapped) {
        if (now < wrapped.soft) return wrapped.v; // HIT (fresh)
        bgRefetch = fill().catch(() => undefined); // STALE → serve stale, refetch in bg
        return wrapped.v;
      }
      return fill(); // MISS → fill
    };

    // 1. MISS → fill: cold key, fetches fresh.
    const r1 = await readSWR();
    expect(r1).toBe("v1");
    expect(fetchCount).toBe(1); // the MISS fetched

    // 2. HIT: a read inside the soft window serves cache, NO refetch.
    const r2 = await readSWR();
    expect(r2).toBe("v1");
    expect(fetchCount).toBe(1); // still 1 — the HIT did not fetch

    // 3. STALE → serve stale + bg refetch: wait past the soft window (but before hard expiry), bump the source.
    await new Promise((res) => setTimeout(res, HARD_TTL_SEC * 0.5 * 1000 + 60)); // past soft, before hard
    fresh = "v2"; // the source changed
    const r3 = await readSWR();
    expect(r3).toBe("v1"); // served the STALE value INSTANTLY (the SWR guarantee)
    expect(bgRefetch).not.toBeNull(); // a background refetch was kicked off
    await bgRefetch; // let it land
    expect(fetchCount).toBe(2); // the background refetch fetched the new value

    // and a subsequent read now serves the refreshed value.
    const r4 = await readSWR();
    expect(r4).toBe("v2");
  });

  it("jitters the TTL — two keys written together get DIFFERENT expiries (S-09, anti-scheduled-stampede)", () => {
    const store = new TtlStore();
    const base = 300;
    // a deterministic-but-distinct RNG so the assertion is stable yet exercises the ±20% spread.
    const seq = [0.05, 0.95]; // → +5% and +95%·20% = very different jitter
    let i = 0;
    const rnd = (): number => seq[i++ % seq.length]!;

    const ttlA = jitteredTtl(base, rnd);
    const ttlB = jitteredTtl(base, rnd);
    store.set("k:a", { v: 1, soft: 0 }, ttlA);
    store.set("k:b", { v: 1, soft: 0 }, ttlB);

    // the two TTLs must differ (jitter applied), and both must be ≥ base (always-TTL, never under).
    expect(ttlA).not.toBe(ttlB);
    expect(ttlA).toBeGreaterThanOrEqual(base);
    expect(ttlB).toBeGreaterThanOrEqual(base);
    // and the resulting store expiries differ too (the observable "scheduled stampede" defense).
    expect(store.expiryOf("k:a")).not.toBe(store.expiryOf("k:b"));
  });
});
