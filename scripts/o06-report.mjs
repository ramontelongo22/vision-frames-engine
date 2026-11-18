// Builds a side-by-side page from two runner output folders (gemini/ and openai/).
// Shows only observable facts: outcome, attempts, QA findings, errors, latency, token usage.
// It does not score quality; the owner judges the images.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const root = process.argv[2];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const providers = ['gemini', 'openai'];
const runs = {};
for (const p of providers) {
  const dir = join(root, p);
  const runPath = join(dir, 'run.json');
  runs[p] = existsSync(runPath) ? JSON.parse(readFileSync(runPath, 'utf8')) : null;
  runs[p] && (runs[p].images = readdirSync(dir).filter((f) => /^frame.*\.(png|jpg|webp)$/.test(f)).sort());
}

function stats(run) {
  if (!run) return { missing: true };
  const t = run.timings || [];
  const by = (op) => t.filter((x) => x.operation === op);
  const ms = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b.durationMs, 0) / arr.length) : null);
  const fails = t.filter((x) => x.outcome !== 'ok');
  return {
    outcome: run.publicOutcome,
    generator: run.models?.generator,
    analyzer: run.models?.analyzer,
    totalSec: Math.round(run.durationMs / 100) / 10,
    generate: by('generate').length,
    refine: by('refine').length,
    analyze: by('analyze').length,
    normalize: by('normalize').length,
    avgGenMs: ms([...by('generate'), ...by('refine')]),
    avgQaMs: ms(by('analyze')),
    errors: fails.map((f) => `${f.operation}: ${f.outcome}`),
    usage: (run.providerResponses || []).map((r) => ({ op: `${r.provider}/${r.operation}`, model: r.servedModel || r.requestedModel, usage: r.usage })),
    frames: run.frames || [run],
  };
}

const s = Object.fromEntries(providers.map((p) => [p, stats(runs[p])]));
const rows = [
  ['Delivered to user?', (x) => x.outcome],
  ['Image model', (x) => x.generator],
  ['Wall time (s)', (x) => x.totalSec],
  ['Image calls (generate + refine)', (x) => `${x.generate} + ${x.refine}`],
  ['QA calls', (x) => x.analyze],
  ['Cleanup calls', (x) => x.normalize],
  ['Avg seconds per image call', (x) => (x.avgGenMs == null ? '-' : (x.avgGenMs / 1000).toFixed(1))],
  ['Avg seconds per QA call', (x) => (x.avgQaMs == null ? '-' : (x.avgQaMs / 1000).toFixed(1))],
  ['Errors', (x) => (x.errors.length ? x.errors.join(', ') : 'none')],
];
const table = rows
  .map(([label, f]) => `<tr><th>${esc(label)}</th>${providers.map((p) => `<td>${s[p].missing ? 'no run' : esc(f(s[p]) ?? '-')}</td>`).join('')}</tr>`)
  .join('');

const frameCount = Math.max(...providers.map((p) => (s[p].missing ? 0 : s[p].frames.length)));
let frames = '';
for (let i = 0; i < frameCount; i++) {
  frames += `<h3>Frame ${i + 1}</h3><div class="pair">`;
  for (const p of providers) {
    const f = s[p].missing ? null : s[p].frames[i];
    const pos = f?.position;
    const img = runs[p]?.images.find((n) => (pos ? n.startsWith(`frame-${pos}.`) : n.startsWith('frame.')));
    const data = img ? `data:image/${img.split('.').pop() === 'jpg' ? 'jpeg' : img.split('.').pop()};base64,${readFileSync(join(root, p, img)).toString('base64')}` : null;
    const violations = (f?.violations || []).flat(Infinity).filter(Boolean).map((v) => (typeof v === 'string' ? v : JSON.stringify(v)));
    frames += `<figure><figcaption><b>${p}</b> · ${esc(f?.status || f?.exitReason || 'no frame')} · gens ${f?.generationAttempts ?? '-'}/3 · refines ${f?.refinementAttempts ?? '-'}/2</figcaption>${
      data ? `<img src="${data}">` : '<div class="none">No image delivered</div>'
    }${violations.length ? `<p class="v">QA findings on discarded tries: ${esc(violations.join('; '))}</p>` : ''}</figure>`;
  }
  frames += '</div>';
}

const usage = providers
  .map((p) => `<h3>${p}</h3><pre>${esc(JSON.stringify(s[p].usage ?? [], null, 1))}</pre>`)
  .join('');

writeFileSync(
  join(root, 'compare.html'),
  `<!doctype html><meta charset="utf-8"><title>O-06 Gemini vs OpenAI</title><style>
body{font:15px/1.45 system-ui;margin:24px;max-width:1300px}table{border-collapse:collapse}th,td{border:1px solid #ccc;padding:6px 10px;text-align:left}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}img{width:100%;border-radius:6px}.none{padding:60px;background:#eee;text-align:center}.v{color:#a33;font-size:13px}pre{font-size:12px;overflow:auto}
</style><h1>O-06 live test: Gemini vs OpenAI as image maker</h1>
<p>Same photos, identity and places. QA and language cleanup were identical for both. No quality score is computed; judge the images.</p>
<table><tr><th></th>${providers.map((p) => `<th>${p}</th>`).join('')}</tr>${table}</table>${frames}<h2>Token usage per call (for cost)</h2>${usage}`
);
console.log(`wrote ${join(root, 'compare.html')}`);
