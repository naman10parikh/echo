/**
 * echo brain-index — a real BM25 index over the expertise brain (`brain/`).
 *
 * This is echo's queryable MEMORY layer (component C2 / HARNESS-OVERRIDES §2). It chunks the 6 brain artifacts by
 * their section anchors (the O-/P-/S-/X-/GT- IDs), builds an Okapi-BM25 index over those chunks, and answers a
 * natural-language query with the cited brain rows. The `echo brain "<q>"` CLI command and the `echo_ask` MCP tool
 * both call `searchBrain` / `askBrain` here — so the SAME index serves the CLI, the MCP, and the cockpit.
 *
 * Why BM25 (not embeddings): zero-dep, deterministic, offline, fast, and the brain is small (~1,900 lines). BM25 is
 * the right tool for a section-anchored corpus this size; an embedding store would be speculative gold-plating for
 * a few hundred chunks. (Karpathy: Simplicity First.)
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** A single indexed brain chunk: one section anchor (e.g. OPINIONS.md#O-04). */
export interface BrainChunk {
  /** Citation, e.g. "brain/OPINIONS.md#O-04". */
  readonly citation: string;
  /** The anchor ID alone, e.g. "O-04" (empty for a file preamble chunk). */
  readonly anchor: string;
  /** The source file basename, e.g. "OPINIONS.md". */
  readonly file: string;
  /** The section heading line (one line). */
  readonly title: string;
  /** The full section body (heading + text until the next anchor). */
  readonly text: string;
}

/** A scored search result. */
export interface BrainHit {
  readonly citation: string;
  readonly anchor: string;
  readonly file: string;
  readonly title: string;
  readonly snippet: string;
  readonly score: number;
}

/** The persisted index artifact shape (written by `buildIndex`, read on query). */
export interface BrainIndexArtifact {
  readonly builtAt: string;
  readonly chunkCount: number;
  readonly chunks: readonly BrainChunk[];
}

// The 6 brain artifacts echo indexes (preamble/MOC/ORG_* files are excluded — they carry no O-/P-/S- rows).
const INDEXED_FILES = [
  "EXPERTISE-MAP.md",
  "BATTLE-TESTED-SCENARIOS.md",
  "KNOWN-PITFALLS.md",
  "OPINIONS.md",
  "GAPS-AND-DISPUTES.md",
  "TOOL-MATRIX.md",
] as const;

// Section-anchor headers look like: `## O-04 — ...`, `### P-04 🔴 — ...`, `## S-02 🔴 ...`, `## X-1 ...`, `## GT-1 ...`.
const ANCHOR_RE = /^#{2,4}\s+((?:O|P|S|X|GT)-\d+)\b/;

const BM25_K1 = 1.5;
const BM25_B = 0.75;

/** Resolve the repo root from this module's location (src/ → repo root). */
function repoRoot(): string {
  // At runtime this file lives at <root>/dist/brain-index.js or <root>/src/brain-index.ts.
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/ or src/ → parent is the repo root.
  return resolve(here, "..");
}

function brainDir(root = repoRoot()): string {
  return join(root, "brain");
}

function indexPath(root = repoRoot()): string {
  return join(brainDir(root), ".brain-index.json");
}

/** Tokenize for BM25: lowercase, keep alphanumerics + the anchor punctuation, split on the rest. */
export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    // keep hyphenated tokens together (fail-open, x-forwarded-for, o-04) by treating - as part of a word
    .replace(/[^a-z0-9\-]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && t !== "-");
}

/** Chunk a single brain file into section-anchored chunks. */
export function chunkFile(file: string, content: string): BrainChunk[] {
  const lines = content.split("\n");
  const chunks: BrainChunk[] = [];
  let current: { anchor: string; title: string; body: string[] } | null = null;

  const flush = () => {
    if (current && current.body.join("").trim().length > 0) {
      chunks.push({
        citation: current.anchor ? `brain/${file}#${current.anchor}` : `brain/${file}`,
        anchor: current.anchor,
        file,
        title: current.title.trim(),
        text: [current.title, ...current.body].join("\n").trim(),
      });
    }
  };

  for (const line of lines) {
    const m = line.match(ANCHOR_RE);
    if (m) {
      flush();
      current = { anchor: m[1], title: line, body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  flush();
  return chunks;
}

/** Read + chunk all indexed brain files. */
export function loadChunks(root = repoRoot()): BrainChunk[] {
  const dir = brainDir(root);
  const present = new Set(existsSync(dir) ? readdirSync(dir) : []);
  const chunks: BrainChunk[] = [];
  for (const f of INDEXED_FILES) {
    if (!present.has(f)) continue;
    const content = readFileSync(join(dir, f), "utf8");
    chunks.push(...chunkFile(f, content));
  }
  return chunks;
}

/** Build the index artifact and persist it to brain/.brain-index.json. Reproducible: rerun any time. */
export function buildIndex(root = repoRoot()): BrainIndexArtifact {
  const chunks = loadChunks(root);
  const artifact: BrainIndexArtifact = {
    builtAt: new Date().toISOString(),
    chunkCount: chunks.length,
    chunks,
  };
  writeFileSync(indexPath(root), JSON.stringify(artifact, null, 2));
  return artifact;
}

/** Load the persisted index; build-on-first-query if it is missing or stale relative to the brain files. */
export function loadIndex(root = repoRoot()): BrainIndexArtifact {
  const path = indexPath(root);
  if (existsSync(path)) {
    try {
      const artifact = JSON.parse(readFileSync(path, "utf8")) as BrainIndexArtifact;
      if (artifact.chunks && artifact.chunks.length > 0 && !isStale(path, root)) return artifact;
    } catch {
      // fall through to rebuild on any parse/shape error
    }
  }
  return buildIndex(root);
}

/** The index is stale if any indexed brain file is newer than the index artifact. */
function isStale(path: string, root: string): boolean {
  const idxMtime = statSync(path).mtimeMs;
  const dir = brainDir(root);
  for (const f of INDEXED_FILES) {
    const fp = join(dir, f);
    if (existsSync(fp) && statSync(fp).mtimeMs > idxMtime) return true;
  }
  return false;
}

/**
 * Okapi-BM25 search over the brain chunks. Returns the top-`limit` scored hits.
 * An anchor-ID query (e.g. "O-04") gets a direct boost so `echo brain O-04` lands its row.
 */
export function searchBrain(query: string, limit = 5, root = repoRoot()): BrainHit[] {
  const artifact = loadIndex(root);
  const chunks = artifact.chunks;
  if (chunks.length === 0) return [];

  // Build doc-frequency table.
  const docTokens = chunks.map((c) => tokenize(c.text));
  const docLens = docTokens.map((t) => t.length);
  const avgdl = docLens.reduce((a, b) => a + b, 0) / Math.max(1, docLens.length);

  const df = new Map<string, number>();
  for (const toks of docTokens) {
    for (const t of new Set(toks)) df.set(t, (df.get(t) ?? 0) + 1);
  }

  const N = chunks.length;
  const qTokens = tokenize(query);
  const queryUpper = query.toUpperCase();

  const scored = chunks.map((chunk, i) => {
    const toks = docTokens[i];
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);

    let score = 0;
    for (const qt of qTokens) {
      const f = tf.get(qt);
      if (!f) continue;
      const n = df.get(qt) ?? 0;
      // BM25 IDF (always positive variant: log(1 + (N - n + 0.5)/(n + 0.5))).
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const denom = f + BM25_K1 * (1 - BM25_B + (BM25_B * docLens[i]) / avgdl);
      score += idf * ((f * (BM25_K1 + 1)) / denom);
    }
    // Direct anchor-ID match boost (so `echo brain "O-04"` returns the O-04 row deterministically).
    if (chunk.anchor && queryUpper.includes(chunk.anchor)) score += 1000;
    return { chunk, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ chunk, score }) => ({
      citation: chunk.citation,
      anchor: chunk.anchor,
      file: chunk.file,
      title: chunk.title,
      snippet: snippet(chunk.text),
      score: Math.round(score * 1000) / 1000,
    }));
}

/** A short snippet (the title line + the first non-empty body line). */
function snippet(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  return lines.slice(0, 3).join(" ").slice(0, 280);
}

/**
 * Answer shape for the MCP `echo_ask` tool / cockpit Ask box: the top hit's text as the answer + the citations.
 * Returns `{ answer, citations }` — never invents; if nothing matches, says so (echo's "measure, don't assert").
 */
export function askBrain(question: string, root = repoRoot()): { answer: string; citations: string[] } {
  const hits = searchBrain(question, 3, root);
  if (hits.length === 0) {
    return {
      answer: `No brain row matches "${question}". (echo does not invent — query a known anchor like O-04/P-01/S-02 or rephrase.)`,
      citations: [],
    };
  }
  const top = hits[0];
  return { answer: `${top.title}\n\n${top.snippet}`, citations: hits.map((h) => h.citation) };
}
