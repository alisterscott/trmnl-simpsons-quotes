#!/usr/bin/env node
// Renders the plugin through the local TRMNL preview across devices,
// orientations, views and quote lengths, and writes an HTML report for a quick
// visual check. Layout problems (overlaps, clipping, broken images) are flagged
// automatically.
//
//   npm run report                      core devices, open nothing
//   npm run report -- --open            open the report when done
//   npm run report -- --all-devices     include small/odd screens too
//   npm run report -- --devices og,x    only some devices (see DEVICES below)
//   npm run report -- --views quadrant  only some views
//   npm run report -- --strict          exit 1 if any problem is found
//
// Needs network access: the preview loads TRMNL's CSS/JS, fonts and the
// character artwork from the internet.
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { parseArgs } = require("node:util");
const { chromium } = require("@playwright/test");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");

// --- Configuration ----------------------------------------------------------

// Device specs come from https://trmnl.com/api/models. The preview renders a
// screen at (width / scale) x (height / scale) CSS pixels, using the classes
// below, exactly as its own device picker does.
const DEVICES = [
  { id: "og", label: "TRMNL OG (1-bit)", w: 800, h: 480, scale: 1, device: "screen--og_png", size: "screen--md", palette: "screen--1bit", core: true },
  { id: "og_plus", label: "TRMNL OG+ (2-bit)", w: 800, h: 480, scale: 1, device: "screen--ogv2", size: "screen--md", palette: "screen--2bit", core: true },
  { id: "x", label: "TRMNL X (4-bit)", w: 1872, h: 1404, scale: 1.8, device: "screen--v2", size: "screen--lg", palette: "screen--4bit", core: true },
  { id: "kindle_2024", label: "Kindle 2024 (small screen class)", w: 1400, h: 840, scale: 1.75, device: "screen--amazon_kindle_2024", size: "screen--sm", palette: "screen--4bit", core: true },
  { id: "kindle_7", label: "Kindle 7 (4:3)", w: 800, h: 600, scale: 1, device: "screen--amazon_kindle_7", size: "screen--md", palette: "screen--4bit", core: true },
  { id: "generic_16_9", label: "Generic 16:9", w: 1920, h: 1080, scale: 2.4, device: "screen--generic_16_9", size: "screen--md", palette: "screen--4bit", core: true },
  { id: "playdate", label: "Playdate (400x240)", w: 400, h: 240, scale: 1, device: "screen--playdate", size: "screen--md", palette: "screen--1bit", core: false },
  { id: "frame", label: "Frame (2560x1440)", w: 2560, h: 1440, scale: 1, device: "screen--frame", size: "screen--md", palette: "screen--1bit", core: false },
  { id: "kobo_sage", label: "Kobo Sage (large, 1x density)", w: 1920, h: 1440, scale: 1.4004, device: "screen--kobo_sage", size: "screen--lg", palette: "screen--4bit", core: false },
];

const VIEWS = ["full", "half_horizontal", "half_vertical", "quadrant"];
const ORIENTATIONS = ["landscape", "portrait"];
const TOLERANCE_PX = 3; // glyph boxes can exceed line boxes by a pixel or two
const CONCURRENCY = 4;

// --- Command line -------------------------------------------------------------

const { values: opts } = parseArgs({
  options: {
    out: { type: "string", default: path.join(ROOT, "preview-report") },
    devices: { type: "string" },
    views: { type: "string" },
    "all-devices": { type: "boolean", default: false },
    port: { type: "string", default: process.env.TRML_PREVIEW_PORT ?? "4567" },
    open: { type: "boolean", default: false },
    strict: { type: "boolean", default: false },
  },
});

function pick(all, requested, key, what) {
  if (!requested) return all;
  const wanted = requested.split(",").map((s) => s.trim());
  const unknown = wanted.filter((w) => !all.some((a) => key(a) === w));
  if (unknown.length) {
    throw new Error(`Unknown ${what}: ${unknown.join(", ")}. Choose from: ${all.map(key).join(", ")}`);
  }
  return all.filter((a) => wanted.includes(key(a)));
}

// --- Quote scenarios ----------------------------------------------------------

function loadCatalog() {
  const characters = JSON.parse(fs.readFileSync(path.join(SRC, "characters.json"), "utf8"));
  const entries = characters.flatMap((character) =>
    character.quotes.map((quote) => ({ quote, character })),
  );
  if (!entries.length) throw new Error("src/characters.json has no quotes");
  return { characters, entries };
}

const longestWord = (quote) => Math.max(...quote.split(/\s+/).map((w) => w.length));

// Representative quotes chosen from the catalog by length, plus the one with
// the longest unbroken word.
function buildScenarios({ entries }) {
  const byLength = [...entries].sort((a, b) => a.quote.length - b.quote.length);
  const at = (fraction) => byLength[Math.min(byLength.length - 1, Math.floor(fraction * byLength.length))];
  const nearest = (n) => byLength.reduce((best, e) => (Math.abs(e.quote.length - n) < Math.abs(best.quote.length - n) ? e : best));
  const longWord = entries.reduce((best, e) => (longestWord(e.quote) > longestWord(best.quote) ? e : best));
  return [
    { id: "short", label: "Short", ...nearest(15) },
    { id: "typical", label: "Typical", ...at(0.5) },
    { id: "long", label: "Long", ...at(0.9) },
    { id: "longest", label: "Longest", ...byLength[byLength.length - 1] },
    { id: "long-word", label: "Long word", ...longWord },
    { id: "live", label: "Live (random)", live: true },
  ];
}

// --- Mirroring the templates' size rules ---------------------------------------
// Injected quotes need the same text-size classes the template would pick, so
// they are read from the view files and shared.liquid rather than duplicated.

function readTemplateRules() {
  const param = (src, name) => src.match(new RegExp(`${name}:\\s*"([^"]*)"`))?.[1];
  const shared = fs.readFileSync(path.join(SRC, "shared.liquid"), "utf8");
  const longLength = Number(shared.match(/assign long_quote_length = (\d+)/)?.[1]);
  if (!longLength) throw new Error("Could not find long_quote_length in src/shared.liquid");
  const views = {};
  for (const view of VIEWS) {
    const src = fs.readFileSync(path.join(SRC, `${view}.liquid`), "utf8");
    views[view] = Object.fromEntries(
      ["sm_size", "sm_long_size", "lg_size", "lg_long_size"].map((p) => [p, param(src, p)]),
    );
  }
  return { longLength, views };
}

const escapeHtml = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function injectScenario(html, scenario, view, rules) {
  const sizes = rules.views[view];
  const isLong = scenario.quote.length > rules.longLength;
  const textClasses = isLong ? `${sizes.sm_long_size} ${sizes.lg_long_size}` : `${sizes.sm_size} ${sizes.lg_size}`;
  const { character } = scenario;
  return html
    .replace(
      /(<blockquote\b[^>]*)class="[^"]*"([^>]*>)[\s\S]*?(<\/blockquote>)/,
      `$1class="${textClasses} pl--1"$2&ldquo;${escapeHtml(scenario.quote)}&rdquo;$3`,
    )
    .replace(/(data-testid="character-name">)[\s\S]*?(<\/p>)/, `$1${escapeHtml(character.name)}$2`)
    .replace(
      /(<img class="image[^"]*")[^>]*>/,
      `$1 src="${escapeHtml(character.imageUrl)}" alt="${escapeHtml(character.name)}">`,
    );
}

// --- Preview server -------------------------------------------------------------

async function isUp(baseUrl) {
  try {
    return (await fetch(`${baseUrl}/full`)).ok;
  } catch {
    return false;
  }
}

async function ensureServer(port) {
  const baseUrl = `http://localhost:${port}`;
  if (await isUp(baseUrl)) return { baseUrl, stop() {} };
  console.log(`Starting preview server on port ${port}...`);
  const child = spawn("bundle", ["exec", "trmnlp", "serve", "--port", port], {
    cwd: ROOT,
    env: { ...process.env, APP_ENV: "production" },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    if (await isUp(baseUrl)) return { baseUrl, stop: () => child.kill() };
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error("The preview server did not start within 30 seconds");
}

// --- Rendering and checks ----------------------------------------------------------

function screenClasses(device, orientation) {
  return ["screen", device.palette, device.device, device.size, ...(orientation === "portrait" ? ["screen--portrait"] : []), "screen--1x"].join(" ");
}

function viewport(device, orientation) {
  const w = Math.round(device.w / device.scale);
  const h = Math.round(device.h / device.scale);
  return orientation === "portrait" ? { width: h, height: w } : { width: w, height: h };
}

// Runs in the browser: measures the rendered view.
function measureView() {
  const box = (e) => {
    const b = e.getBoundingClientRect();
    return { x: b.x, y: b.y, r: b.right, b: b.bottom, w: b.width, h: b.height };
  };
  const view = document.querySelector("div.view");
  const quote = view.querySelector("blockquote");
  const name = view.querySelector('[data-testid="character-name"]');
  const container = view.querySelector('[data-content-limiter="true"]');
  const image = view.querySelector("img");
  const range = document.createRange();
  range.selectNodeContents(quote);
  const normalise = (s) => (s ?? "").replace(/\s+/g, " ").trim();
  return {
    view: box(view),
    quote: box(quote),
    container: box(container),
    name: box(name),
    textRight: Math.max(...[...range.getClientRects()].map((r) => r.right)),
    fontSize: parseFloat(getComputedStyle(quote).fontSize),
    quoteText: normalise(quote.innerText),
    truncated: normalise(quote.innerText) !== normalise(quote.getAttribute("data-clamp-original")),
    characterName: normalise(name.innerText),
    imageLoaded: image.complete && image.naturalWidth > 0,
  };
}

function findProblems(m) {
  const problems = [];
  if (m.quote.b > m.name.y + TOLERANCE_PX) problems.push("Quote overlaps the character name");
  else if (m.quote.b > m.container.b + TOLERANCE_PX) problems.push("Quote runs past its container");
  if (m.name.b > m.view.b + TOLERANCE_PX) problems.push("Character name is cut off at the bottom");
  if (m.textRight > m.quote.r + TOLERANCE_PX || m.quote.r > m.view.r + TOLERANCE_PX) problems.push("Quote text runs off the side");
  if (!m.imageLoaded) problems.push("Character image failed to load");
  return problems;
}

async function renderShot(context, baseUrl, job, rules, imagesDir) {
  const { device, orientation, view, scenario } = job;
  const page = await context.newPage();
  try {
    await page.setViewportSize(viewport(device, orientation));
    if (!scenario.live) {
      await page.route("**/render/*.html*", async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, body: injectScenario(await response.text(), scenario, view, rules) });
      });
    }
    const url = `${baseUrl}/render/${view}.html?screen_classes=${encodeURIComponent(screenClasses(device, orientation))}`;
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    // The framework script truncates the quote and then marks it as cached.
    await page.locator('div.view blockquote[data-clamp-cached="true"]').waitFor({ timeout: 10000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const metrics = await page.evaluate(measureView);
    const file = `${job.id}.png`;
    await page.locator("div.view").screenshot({ path: path.join(imagesDir, file) });
    return { ...job, file, metrics, problems: findProblems(metrics) };
  } finally {
    await page.close();
  }
}

async function renderAll(browser, baseUrl, jobs, rules, imagesDir) {
  const results = new Array(jobs.length);
  let next = 0;
  let done = 0;
  async function worker() {
    const context = await browser.newContext();
    while (next < jobs.length) {
      const index = next++;
      const job = jobs[index];
      let result;
      for (let attempt = 1; attempt <= 2 && !result; attempt++) {
        try {
          result = await renderShot(context, baseUrl, job, rules, imagesDir);
        } catch (error) {
          if (attempt === 2) result = { ...job, file: null, problems: [`Render failed: ${String(error).split("\n")[0]}`] };
        }
      }
      results[index] = result;
      process.stdout.write(`\rRendering ${++done}/${jobs.length}`);
    }
    await context.close();
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  process.stdout.write("\n");
  return results;
}

// --- HTML report -----------------------------------------------------------------------

const REPORT_CSS = `
:root{--bg:#f6f6f4;--fg:#1d1d1b;--muted:#6b6b66;--card:#fff;--line:#dcdcd6;--ok:#1f7a3d;--warn:#b25e00;--bad:#b3261e;--accent:#2a5bd7}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#171716;--fg:#ececea;--muted:#9a9a94;--card:#222220;--line:#3a3a36;--ok:#5fcf86;--warn:#f0a24b;--bad:#ff8a80;--accent:#8fb0ff}}
:root[data-theme=dark]{--bg:#171716;--fg:#ececea;--muted:#9a9a94;--card:#222220;--line:#3a3a36;--ok:#5fcf86;--warn:#f0a24b;--bad:#ff8a80;--accent:#8fb0ff}
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}
main{max-width:1500px;margin:0 auto;padding:20px 16px 60px}
h1{margin:0 0 4px;font-size:22px} h2{margin:34px 0 2px;font-size:18px} h3{margin:18px 0 8px;font-size:14px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
.meta,.spec{color:var(--muted)} .meta{margin:0 0 14px}
.banner{padding:12px 14px;border-radius:8px;border:1px solid var(--line);background:var(--card);margin:12px 0;border-left:5px solid var(--ok)}
.banner.bad{border-left-color:var(--bad)} .banner ul{margin:6px 0 0;padding-left:20px}
.controls{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;padding:10px 12px;margin:14px 0;background:var(--card);border:1px solid var(--line);border-radius:8px}
.controls label{display:inline-flex;gap:5px;align-items:center;white-space:nowrap}
.controls select,.controls input[type=range]{font:inherit}
table.scenarios{border-collapse:collapse;width:100%;background:var(--card);border:1px solid var(--line)}
table.scenarios td,table.scenarios th{padding:6px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
.view-row{margin:0 0 14px} .view-row h4{margin:0 0 6px;font-size:13px}
.cards{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start}
figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px;width:var(--card-w,300px);max-width:100%}
figure.problem{border-color:var(--bad);box-shadow:0 0 0 1px var(--bad)}
figure img{display:block;width:100%;height:auto;border:1px solid var(--line);background:#fff;cursor:zoom-in}
figcaption{margin-top:6px;display:flex;flex-wrap:wrap;gap:4px 6px;align-items:center;font-size:12px}
.badge{padding:1px 7px;border-radius:99px;border:1px solid currentColor;font-size:11px;white-space:nowrap}
.badge.ok{color:var(--ok)} .badge.warn{color:var(--warn)} .badge.bad{color:var(--bad)} .scn{font-weight:600}
dialog{max-width:96vw;max-height:94vh;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--fg);padding:12px}
dialog::backdrop{background:rgba(0,0,0,.6)} dialog img{max-width:100%;max-height:78vh;display:block;margin:8px 0;border:1px solid var(--line);background:#fff}
dialog pre{margin:6px 0 0;white-space:pre-wrap;font-size:12px;color:var(--muted)}
[hidden]{display:none!important}
`;

const REPORT_JS = `
const $ = (s, r = document) => [...r.querySelectorAll(s)];
const state = { device: "", view: "", orientation: "", scenario: "", problems: false };
function apply() {
  $("figure[data-id]").forEach(f => {
    f.hidden = (state.view && f.dataset.view !== state.view) || (state.orientation && f.dataset.orientation !== state.orientation) ||
      (state.scenario && f.dataset.scenario !== state.scenario) || (state.problems && f.dataset.problem !== "1");
  });
  $("section.device").forEach(s => { s.hidden = state.device && s.dataset.device !== state.device; });
  $(".view-row").forEach(r => { r.hidden = !$("figure:not([hidden])", r).length; });
  $(".orient").forEach(o => { o.hidden = !$("figure:not([hidden])", o).length; });
  $("section.device").forEach(s => { if (!$("figure:not([hidden])", s).length) s.hidden = true; });
}
$("[data-filter]").forEach(el => el.addEventListener("input", () => {
  state[el.dataset.filter] = el.type === "checkbox" ? el.checked : el.value; apply();
}));
document.getElementById("size").addEventListener("input", e => document.documentElement.style.setProperty("--card-w", e.target.value + "px"));
const dlg = document.getElementById("zoom");
document.addEventListener("click", e => {
  const img = e.target.closest("figure[data-id] img"); if (!img) return;
  const f = img.closest("figure");
  dlg.querySelector("img").src = img.src; dlg.querySelector("h3").textContent = f.dataset.title;
  dlg.querySelector("pre").textContent = f.dataset.detail; dlg.showModal();
});
dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); });
`;

function renderCard(r) {
  const m = r.metrics;
  const badges = [];
  if (!r.problems.length) badges.push('<span class="badge ok">OK</span>');
  for (const p of r.problems) badges.push(`<span class="badge bad">${escapeHtml(p)}</span>`);
  if (m?.truncated) badges.push('<span class="badge warn">Truncated</span>');
  const detail = [
    r.problems.length ? `Problems:\n- ${r.problems.join("\n- ")}\n` : "No layout problems detected.\n",
    m ? `Character: ${m.characterName}\nQuote (${m.quoteText.length} chars${m.truncated ? ", truncated" : ""}): ${m.quoteText}\nFont size: ${m.fontSize}px` : "",
  ].join("\n");
  const title = `${r.device.label} · ${r.orientation} · ${r.view} · ${r.scenario.label}`;
  const attrs = `data-id="${r.id}" data-view="${r.view}" data-orientation="${r.orientation}" data-scenario="${r.scenario.id}" data-problem="${r.problems.length ? 1 : 0}" data-title="${escapeHtml(title)}" data-detail="${escapeHtml(detail)}"`;
  const img = r.file ? `<img src="images/${r.file}" loading="lazy" alt="${escapeHtml(title)}">` : '<div style="padding:30px 8px;color:var(--bad)">No screenshot</div>';
  return `<figure id="${r.id}" class="${r.problems.length ? "problem" : ""}" ${attrs}>${img}<figcaption><span class="scn">${escapeHtml(r.scenario.label)}</span>${badges.join("")}</figcaption></figure>`;
}

function renderReport({ results, devices, views, scenarios, meta }) {
  const problems = results.filter((r) => r.problems.length);
  const options = (items) => items.map(([v, l]) => `<option value="${v}">${escapeHtml(l)}</option>`).join("");
  const deviceSections = devices.map((device) => {
    const vp = viewport(device, "landscape");
    const spec = `${vp.width}x${vp.height} CSS px (${device.w}x${device.h} @ ${device.scale}x) · ${device.size.replace("screen--", "")} · ${device.palette.replace("screen--", "")}`;
    const orientations = ORIENTATIONS.map((orientation) => {
      const rows = views.map((view) => {
        const cards = results.filter((r) => r.device === device && r.orientation === orientation && r.view === view).map(renderCard).join("");
        return `<div class="view-row"><h4>${view}</h4><div class="cards">${cards}</div></div>`;
      }).join("");
      return `<div class="orient"><h3>${orientation}</h3>${rows}</div>`;
    }).join("");
    return `<section class="device" data-device="${device.id}"><h2>${escapeHtml(device.label)}</h2><div class="spec">${spec}</div>${orientations}</section>`;
  }).join("");

  const describe = (r) => `${r.device.label} · ${r.orientation} · ${r.view} · ${r.scenario.label}`;
  const perDevice = devices
    .map((device) => ({ device, found: problems.filter((r) => r.device === device) }))
    .filter(({ found }) => found.length)
    .map(({ device, found }) => {
      const views = [...new Set(found.map((r) => r.view))].join(", ");
      return `<li><strong>${escapeHtml(device.label)}</strong>: ${found.length} screenshots (${views}) — <a href="#${found[0].id}">jump to first</a></li>`;
    })
    .join("");
  const banner = problems.length
    ? `<div class="banner bad"><strong>${problems.length} of ${results.length} screenshots have layout problems</strong><ul>${perDevice}</ul>
<details><summary>All problems</summary><ul>${problems.map((r) => `<li><a href="#${r.id}">${escapeHtml(describe(r))}</a>: ${escapeHtml(r.problems.join("; "))}</li>`).join("")}</ul></details></div>`
    : `<div class="banner"><strong>No layout problems detected</strong> in ${results.length} screenshots. Truncated quotes are marked but not counted as problems.</div>`;

  const scenarioRows = scenarios.map((s) => s.live
    ? `<tr><th>${s.label}</th><td colspan="3">The quote the preview picked at random for this render (no injection).</td></tr>`
    : `<tr><th>${escapeHtml(s.label)}</th><td>${s.quote.length}</td><td>${escapeHtml(s.character.name)}</td><td>${escapeHtml(s.quote)}</td></tr>`).join("");

  return `<title>Simpsons Quotes layout report</title>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${REPORT_CSS}</style>
<main>
<h1>Simpsons Quotes layout report</h1>
<p class="meta">Generated ${escapeHtml(meta.generated)} · ${escapeHtml(meta.git)} · ${results.length} screenshots · ${devices.length} devices</p>
${banner}
<div class="controls">
  <label>Device <select data-filter="device"><option value="">All</option>${options(devices.map((d) => [d.id, d.label]))}</select></label>
  <label>View <select data-filter="view"><option value="">All</option>${options(views.map((v) => [v, v]))}</select></label>
  <label>Orientation <select data-filter="orientation"><option value="">All</option>${options(ORIENTATIONS.map((o) => [o, o]))}</select></label>
  <label>Quote <select data-filter="scenario"><option value="">All</option>${options(scenarios.map((s) => [s.id, s.label]))}</select></label>
  <label><input type="checkbox" data-filter="problems"> Only problems</label>
  <label>Size <input type="range" id="size" min="160" max="700" value="300"></label>
</div>
<details><summary>Quotes used</summary>
<table class="scenarios"><tr><th>Scenario</th><th>Chars</th><th>Character</th><th>Quote</th></tr>${scenarioRows}</table></details>
${deviceSections}
</main>
<dialog id="zoom"><h3></h3><img alt=""><pre></pre></dialog>
<script>${REPORT_JS}</script>`;
}

// --- Main -------------------------------------------------------------------------------

function gitSummary() {
  try {
    const run = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
    const dirty = run("status", "--porcelain", "--", "src") ? " + uncommitted changes in src/" : "";
    return `commit ${run("rev-parse", "--short", "HEAD")}${dirty}`;
  } catch {
    return "no git info";
  }
}

async function main() {
  const devices = pick(
    opts["all-devices"] ? DEVICES : DEVICES.filter((d) => d.core),
    opts.devices,
    (d) => d.id,
    "device",
  );
  const views = pick(VIEWS, opts.views, (v) => v, "view");
  const catalog = loadCatalog();
  const scenarios = buildScenarios(catalog);
  const rules = readTemplateRules();

  const jobs = [];
  for (const device of devices)
    for (const orientation of ORIENTATIONS)
      for (const view of views)
        for (const scenario of scenarios)
          jobs.push({ id: `${device.id}-${orientation}-${view}-${scenario.id}`, device, orientation, view, scenario });

  const imagesDir = path.join(opts.out, "images");
  fs.rmSync(opts.out, { recursive: true, force: true });
  fs.mkdirSync(imagesDir, { recursive: true });

  const server = await ensureServer(opts.port);
  const browser = await chromium.launch();
  try {
    const results = await renderAll(browser, server.baseUrl, jobs, rules, imagesDir);
    const meta = { generated: new Date().toLocaleString(), git: gitSummary() };
    const reportPath = path.join(opts.out, "index.html");
    fs.writeFileSync(reportPath, renderReport({ results, devices, views, scenarios, meta }));
    const problems = results.filter((r) => r.problems.length).length;
    console.log(`${results.length} screenshots, ${problems} with layout problems`);
    console.log(`Report: ${reportPath}`);
    if (opts.open) execFileSync(process.platform === "darwin" ? "open" : "xdg-open", [reportPath]);
    if (opts.strict && problems) process.exitCode = 1;
  } finally {
    await browser.close();
    server.stop();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
