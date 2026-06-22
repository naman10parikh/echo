/*
 * echo cockpit SPA logic (PLAN §10 / Cluster G2). Vanilla JS, zero-dep — renders the 4 views and wires each to its
 * live API route on the cockpit server (scripts/cockpit.mjs):
 *   brain  → /api/artifacts, /api/artifact, /api/brain   (the 6 artifacts rendered + BM25 search)
 *   runs   → /api/runs                                    (logs/runs.jsonl + the commands/request metric)
 *   evals  → /api/eval                                    (the Hamel L1/L2/L3 pyramid + pass^k + acceptance)
 *   ask    → /api/ask                                     (`echo ask` → answer + brain citations)
 * No build step, no framework: the cockpit is a thin window, the heavy lifting lives in echo's compiled dist/.
 */
"use strict";

const content = document.getElementById("content");
const nav = document.getElementById("nav");

/** Escape user/file text before inserting into innerHTML (XSS-safe even though all sources are local). */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function getJSON(url) {
  const r = await fetch(url);
  const body = await r.json().catch(() => ({ error: `bad JSON from ${url}` }));
  return { ok: r.ok, status: r.status, body };
}

function errBanner(msg) {
  return `<div class="err-banner">${esc(msg)}</div>`;
}

/* ───────────────────────────── View 1: Brain browser (artifacts + BM25 search) ───────────────────────────── */
async function viewBrain() {
  content.innerHTML = `
    <div class="view-head">
      <h1>Brain browser</h1>
      <p>The six expertise artifacts echo reasons from — searchable by BM25 over the O-/P-/S- anchors. This is what makes any coding agent dangerous in the rate-limit / cache vertical.</p>
    </div>
    <div class="searchbar">
      <input id="brain-q" placeholder="search the brain — try: fail-open, X-Forwarded-For, stampede, CF-KV…" autocomplete="off" />
      <button id="brain-go">Search</button>
    </div>
    <div id="brain-results"></div>
    <div class="section-label">Artifacts</div>
    <div class="artifact-wrap">
      <div class="artifact-nav" id="artifact-nav"><div class="loading">…</div></div>
      <div class="artifact-body md" id="artifact-body"><div class="loading">Select an artifact.</div></div>
    </div>`;

  const q = document.getElementById("brain-q");
  const results = document.getElementById("brain-results");
  const runSearch = async () => {
    const query = q.value.trim();
    if (!query) { results.innerHTML = ""; return; }
    results.innerHTML = `<div class="loading">Searching the brain for “${esc(query)}”…</div>`;
    const { ok, body } = await getJSON(`/api/brain?q=${encodeURIComponent(query)}`);
    if (!ok) { results.innerHTML = errBanner(body.error || "search failed"); return; }
    if (!body.hits.length) { results.innerHTML = `<div class="empty">No brain row matches “${esc(query)}”. echo doesn't invent — try a known anchor (O-04 / P-01 / S-02).</div>`; return; }
    results.innerHTML = body.hits.map((h) => `
      <div class="hit">
        <span class="score">score ${esc(h.score)}</span>
        <span class="cite">${esc(h.citation)}</span>
        <div class="title">${esc(h.title.replace(/^#+\s*/, ""))}</div>
        <div class="snip">${esc(h.snippet)}</div>
      </div>`).join("");
  };
  document.getElementById("brain-go").addEventListener("click", runSearch);
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") runSearch(); });

  // Artifact nav + body.
  const navEl = document.getElementById("artifact-nav");
  const bodyEl = document.getElementById("artifact-body");
  const { body: list } = await getJSON("/api/artifacts");
  const artifacts = list.artifacts || [];
  navEl.innerHTML = artifacts.map((a, i) => `<button data-f="${esc(a)}" class="${i === 0 ? "active" : ""}">${esc(a.replace(/\.md$/, ""))}</button>`).join("");
  const loadArtifact = async (f, btn) => {
    [...navEl.querySelectorAll("button")].forEach((b) => b.classList.remove("active"));
    if (btn) btn.classList.add("active");
    bodyEl.innerHTML = `<div class="loading">Loading ${esc(f)}…</div>`;
    const { ok, body } = await getJSON(`/api/artifact?f=${encodeURIComponent(f)}`);
    bodyEl.innerHTML = ok ? renderMarkdown(body.markdown) : errBanner(body.error || "load failed");
    bodyEl.scrollTop = 0;
  };
  navEl.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => loadArtifact(b.dataset.f, b)));
  if (artifacts.length) loadArtifact(artifacts[0], navEl.querySelector("button"));
}

/* ───────────────────────────── View 2: Run log (runs.jsonl + commands/request) ───────────────────────────── */
async function viewRuns() {
  content.innerHTML = `<div class="view-head"><h1>Run log</h1><p>Every <code>echo</code> CLI / MCP invocation, newest first — tool, duration, outcome, and the domain-native <strong>commands/request</strong> a cost run computed (O-19).</p></div><div id="runs-body"><div class="loading">Loading run log…</div></div>`;
  const el = document.getElementById("runs-body");
  const { ok, body } = await getJSON("/api/runs");
  if (!ok) { el.innerHTML = errBanner(body.error || "run log failed"); return; }
  const runs = body.runs || [];
  const lc = body.lastCost;
  const stats = `
    <div class="grid stats" style="margin-bottom:18px">
      <div class="card stat"><div class="k">Total runs logged</div><div class="v">${runs.length}</div><div class="sub">append-only · logs/runs.jsonl</div></div>
      <div class="card stat"><div class="k">Last commands / request</div><div class="v amber">${lc ? esc(lc.cmdsPerReq) : "—"}</div><div class="sub">${lc ? "echo's domain metric (O-19)" : "run `echo cost` to populate"}</div></div>
      <div class="card stat"><div class="k">Last projected monthly</div><div class="v">${lc ? "$" + esc(Number(lc.monthlyUSD).toLocaleString()) : "—"}</div><div class="sub">${lc ? "at the costed RPS" : "—"}</div></div>
    </div>`;
  if (!runs.length) { el.innerHTML = stats + `<div class="empty">${esc(body.note || "No runs yet — invoke any echo command.")}</div>`; return; }
  const rows = runs.map((r) => `
    <tr>
      <td class="mono">${esc((r.ts || "").replace("T", " ").replace(/\..+$/, ""))}</td>
      <td><strong style="color:var(--text)">${esc(r.tool)}</strong></td>
      <td><span class="badge ${r.outcome === "ok" ? "ok" : "err"}">${esc(r.outcome)}</span></td>
      <td>${esc(r.duration_ms)} ms</td>
      <td>${typeof r.cmdsPerReq === "number" ? esc(r.cmdsPerReq) + " cmd/req" : ""}${typeof r.monthlyUSD === "number" ? ` · $${esc(Number(r.monthlyUSD).toLocaleString())}/mo` : ""}</td>
    </tr>`).join("");
  el.innerHTML = stats + `<div class="card" style="padding:0"><table class="data"><thead><tr><th>When</th><th>Tool</th><th>Outcome</th><th>Duration</th><th>Domain metric</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/* ───────────────────────────── View 3: Eval scores (the Hamel pyramid) ───────────────────────────── */
async function viewEvals() {
  content.innerHTML = `<div class="view-head"><h1>Eval scores</h1><p>The golden-task pyramid (L1 static · L2 calibrated detectors · L3 trajectory judge), graded binary at pass<sup>3</sup>. 🔴 = CI-blocking; 🟠 = advisory.</p></div><div id="eval-body"><div class="loading">Running the eval suite (deterministic, $0)…</div></div>`;
  const el = document.getElementById("eval-body");
  const { ok, body } = await getJSON("/api/eval");
  if (!ok) { el.innerHTML = errBanner(body.error || "eval failed"); return; }
  const tasks = body.tasks || [];
  const cal = body.calibration || [];
  const blocking = tasks.filter((t) => t.block === "blocking");
  const passBlocking = blocking.filter((t) => t.status === "PASS").length;
  const stats = `
    <div class="grid stats" style="margin-bottom:18px">
      <div class="card stat"><div class="k">CI-blocking (🔴)</div><div class="v ${passBlocking === blocking.length ? "amber" : ""}">${passBlocking}/${blocking.length}</div><div class="sub">red-block golden tasks green</div></div>
      <div class="card stat"><div class="k">Calibrated detectors</div><div class="v">${cal.filter((c) => c.status === "PASS").length}/${cal.length}</div><div class="sub">F1≥0.8 or κ≥0.6</div></div>
      <div class="card stat"><div class="k">Eval exit</div><div class="v ${body.exitCode === 0 ? "amber" : ""}">${body.exitCode === 0 ? "PASS" : "FAIL"}</div><div class="sub">${esc(body.summary || "")}</div></div>
    </div>`;
  const taskRows = tasks.map((t) => `
    <tr>
      <td><span class="badge ${t.status === "PASS" ? "pass" : "fail"}">${esc(t.status)}</span></td>
      <td><span class="badge ${t.block === "blocking" ? "block" : "adv"}">${t.block === "blocking" ? "🔴 block" : "🟠 adv"}</span></td>
      <td><strong style="color:var(--text)">${esc(t.id)}</strong> <span class="mono">${esc(t.level)}</span></td>
      <td class="mono">${esc(t.scenario)}</td>
      <td>${esc(t.desc)}</td>
    </tr>`).join("");
  const calRows = cal.map((c) => `
    <tr>
      <td><span class="badge ${c.status === "PASS" ? "pass" : "fail"}">${esc(c.status)}</span></td>
      <td><strong style="color:var(--text)">${esc(c.detector)}</strong></td>
      <td class="mono">${esc(c.scenarios)}</td>
      <td class="mono">${esc(c.metrics)}</td>
    </tr>`).join("");
  el.innerHTML = stats +
    `<div class="section-label">Golden tasks (GT-1..GT-14 → S-01..S-19)</div>
     <div class="card" style="padding:0"><table class="data"><thead><tr><th>Result</th><th>Gate</th><th>Task</th><th>Scenario</th><th>Assertion</th></tr></thead><tbody>${taskRows || '<tr><td colspan="5" class="empty">no tasks parsed</td></tr>'}</tbody></table></div>
     <div class="section-label">L2 calibration (echo's own detectors over the mined corpus)</div>
     <div class="card" style="padding:0"><table class="data"><thead><tr><th>Result</th><th>Detector</th><th>Scenarios</th><th>Metrics</th></tr></thead><tbody>${calRows || '<tr><td colspan="4" class="empty">no calibration parsed</td></tr>'}</tbody></table></div>`;
}

/* ───────────────────────────── View 4: Ask the employee (`echo ask`) ───────────────────────────── */
async function viewAsk() {
  content.innerHTML = `
    <div class="view-head"><h1>Ask the employee</h1><p>Ask echo a rate-limit / cache question. It answers from its brain with citations — and refuses to invent when nothing matches.</p></div>
    <div class="searchbar">
      <input id="ask-q" placeholder="e.g. should my limiter fail open or closed? how do I key it?" autocomplete="off" />
      <button id="ask-go">Ask</button>
    </div>
    <div id="ask-body"><div class="empty">Try: “fail-open vs fail-closed”, “X-Forwarded-For”, “cache an LLM response”.</div></div>`;
  const q = document.getElementById("ask-q");
  const el = document.getElementById("ask-body");
  const ask = async () => {
    const question = q.value.trim();
    if (!question) return;
    el.innerHTML = `<div class="loading">echo is consulting its brain…</div>`;
    const { ok, body } = await getJSON(`/api/ask?q=${encodeURIComponent(question)}`);
    if (!ok) { el.innerHTML = errBanner(body.error || "ask failed"); return; }
    const cites = (body.citations || []).map((c) => `<span class="chip">${esc(c)}</span>`).join("");
    const [first, ...rest] = (body.answer || "").split("\n\n");
    el.innerHTML = `
      <div class="answer">
        <div class="title">${esc((first || "").replace(/^#+\s*/, ""))}</div>
        ${rest.length ? `<div class="body">${esc(rest.join("\n\n"))}</div>` : ""}
        ${cites ? `<div class="cites">${cites}</div>` : ""}
      </div>`;
  };
  document.getElementById("ask-go").addEventListener("click", ask);
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") ask(); });
}

/* ───────────────────────────── Minimal markdown renderer (artifacts only; local trusted content) ───────────────────────────── */
function renderMarkdown(md) {
  const lines = String(md).split("\n");
  const out = [];
  let inCode = false, inTable = false;
  const flushTable = () => { if (inTable) { out.push("</tbody></table>"); inTable = false; } };
  for (let raw of lines) {
    if (raw.startsWith("```")) {
      flushTable();
      if (!inCode) { out.push("<pre style='background:var(--bg-3);padding:12px;border-radius:8px;overflow-x:auto'><code>"); inCode = true; }
      else { out.push("</code></pre>"); inCode = false; }
      continue;
    }
    if (inCode) { out.push(esc(raw)); continue; }
    // tables: a row with leading | and a separator row of dashes.
    if (/^\s*\|.*\|\s*$/.test(raw)) {
      const cells = raw.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "")) continue; // separator
      if (!inTable) { out.push("<table><tbody>"); inTable = true; }
      out.push("<tr>" + cells.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>");
      continue;
    }
    flushTable();
    const h = raw.match(/^(#{1,4})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    if (/^\s*[-*]\s+/.test(raw)) { out.push(`<li>${inline(raw.replace(/^\s*[-*]\s+/, ""))}</li>`); continue; }
    if (raw.trim() === "") { out.push(""); continue; }
    out.push(`<p>${inline(raw)}</p>`);
  }
  flushTable();
  return out.join("\n");
}
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[\[([^\]]+)\]\]/g, "<em>$1</em>");
}

/* ───────────────────────────── Router ───────────────────────────── */
const VIEWS = { brain: viewBrain, runs: viewRuns, evals: viewEvals, ask: viewAsk };
function show(view) {
  [...nav.querySelectorAll("button")].forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  (VIEWS[view] || viewBrain)();
  if (location.hash !== `#${view}`) location.hash = view;
}
nav.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));
window.addEventListener("hashchange", () => { const v = location.hash.replace("#", ""); if (VIEWS[v]) show(v); });
show(location.hash.replace("#", "") in VIEWS ? location.hash.replace("#", "") : "brain");
