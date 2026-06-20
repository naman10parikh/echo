/**
 * `pnpm run brain:index` — (re)build the BM25 index over brain/ and persist it to brain/.brain-index.json.
 * Reproducible: rerun any time the brain changes. `searchBrain` also auto-rebuilds on first query if the index
 * is missing or stale, so this script is an optimization (warm the index in CI), not a hard prerequisite.
 */
import { buildIndex } from "../brain-index.js";

const artifact = buildIndex();
console.log(`brain:index — built ${artifact.chunkCount} chunks at ${artifact.builtAt}`);
