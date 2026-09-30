import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectCsv, parseCsv, applyMapping } from './lib/csv.mjs';
import { buildDataset } from './lib/stats.mjs';
import { callJson } from './lib/llm.mjs';
import { runAnalysis, loadAnalysis, analysisSummary, partialPatterns, scoreDraft } from './lib/analysis.mjs';
import { jevConfig } from './lib/jev.mjs';
import { EXPLAIN_SYSTEM, PLAYBOOK_SCHEMA, REWRITE_SYSTEM, REWRITE_SCHEMA, buildExplainInput, buildRewriteInput } from './lib/prompts.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const DATA = path.join(ROOT, 'data');
const PUBLIC = path.join(ROOT, 'public');
fs.mkdirSync(DATA, { recursive: true });

const PORT = Number(process.env.PORT || 3140);
const DEFAULTS = { analyze_model: process.env.ANALYZE_MODEL || 'anthropic/claude-opus-5', score_model: process.env.SCORE_MODEL || 'anthropic/claude-sonnet-5' };
export const MODEL_CHOICES = ['anthropic/claude-sonnet-5', 'anthropic/claude-opus-5', 'anthropic/claude-sonnet-5.5', 'anthropic/claude-opus-5.5', 'anthropic/claude-fable-5.1', 'openai/gpt-5.5', 'google/gemini-3.1-pro-preview'];

const file = (name) => path.join(DATA, name);
const readJson = (name, fallback = null) => (fs.existsSync(file(name)) ? JSON.parse(fs.readFileSync(file(name), 'utf8')) : fallback);
const writeJson = (name, obj) => fs.writeFileSync(file(name), JSON.stringify(obj, null, 2));
export const getSettings = () => ({ ...DEFAULTS, ...(readJson('settings.json', {}) || {}) });

function addRefs(dataset) { for (const p of dataset.posts) p.ref = p.eligible ? `P${p.rank}` : `X${p.id}`; return dataset; }
export function datasetSummary(ds) { if (!ds) return null; const { posts, ...rest } = ds; return rest; }
const hookOf = (t) => t.split('\n').map((l) => l.trim()).filter(Boolean)[0] || '';
function postCard(p) {
  return { ref: p.ref, id: p.id, bucket: p.bucket, rank: p.rank ?? null, percentile: p.percentile ?? null, hook: hookOf(p.text), text: p.text, impressions: p.impressions, likes: p.likes, comments: p.comments, reposts: p.reposts, metric: p.metric, engagement_rate: p.engagement_rate, date: p.date, url: p.url, format: p.format };
}

// ---------- core operations (shared with cli.mjs) ----------
export function loadDatasetFromCsv(csvText, { mapping, name, metric } = {}) {
  const { headers, records } = parseCsv(csvText);
  const map = mapping || inspectCsv(csvText).mapping;
  if (!map.text) throw new Error('No text column mapped');
  if (!map.impressions && !map.likes) throw new Error('No engagement metrics mapped (impressions or reactions needed)');
  const posts = applyMapping(records, map);
  if (posts.length < 10) throw new Error(`Only ${posts.length} posts with text found; need at least 10`);
  const ds = addRefs(buildDataset(posts, { metric: metric || 'auto' }));
  ds.source = { name: name || 'upload', headers, mapping: map, uploaded_at: new Date().toISOString() };
  writeJson('dataset.json', ds);
  for (const f of ['analysis.json', 'playbook.json']) if (fs.existsSync(file(f))) fs.unlinkSync(file(f));
  return ds;
}

function readHistory(limit = 25) {
  if (!fs.existsSync(file('history.jsonl'))) return [];
  return fs.readFileSync(file('history.jsonl'), 'utf8').trim().split('\n').filter(Boolean).slice(-limit).reverse().map((l) => JSON.parse(l));
}

// House style for the Claude extras is no em-dashes; scrub any that slip through.
function scrubDashes(v) {
  if (typeof v === 'string') return v.replace(/\s+[—–]\s+/g, ', ').replace(/[—–]/g, '-');
  if (Array.isArray(v)) return v.map(scrubDashes);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubDashes(x)]));
  return v;
}

export async function explainAnalysis(ds, analysis, model) {
  const { data, meta } = await callJson({ model, system: EXPLAIN_SYSTEM, user: buildExplainInput(analysis, ds), schema: PLAYBOOK_SCHEMA, schemaName: 'linkedin_playbook', maxTokens: 12000, temperature: 0.3 });
  const playbook = { ...scrubDashes(data), _meta: { ...meta, created_at: new Date().toISOString(), posts_analyzed: analysis.quality.n, metric: analysis.metricLabel } };
  writeJson('playbook.json', playbook);
  return playbook;
}

export async function rewriteDraft(ds, analysis, result, model) {
  const { data, meta } = await callJson({ model, system: REWRITE_SYSTEM, user: buildRewriteInput({ draft: result.text, result, analysis, ds }), schema: REWRITE_SCHEMA, schemaName: 'rewrite', maxTokens: 6000, temperature: 0.4 });
  return { ...scrubDashes(data), _meta: meta };
}

// ---------- analysis job (one at a time, broadcast to SSE listeners) ----------
let job = null;
function startJob(ds) {
  if (job && !job.finished) return job;
  const ctrl = new AbortController();
  job = { finished: false, listeners: new Set(), last: null, error: null, abort: () => ctrl.abort(), started: Date.now() };
  const emit = (event, data) => { job.last = { event, data }; for (const l of job.listeners) l(event, data); };
  (async () => {
    try {
      const analysis = await runAnalysis(ds, { dataDir: DATA, signal: ctrl.signal, onProgress: (prog) => emit('progress', prog), onPartial: (partial) => emit('partial', partial) });
      emit('done', analysisSummary(analysis));
    } catch (e) {
      job.error = e.message;
      emit('error', { error: e.message });
    } finally {
      job.finished = true;
    }
  })();
  return job;
}

// ---------- http ----------
const send = (res, status, body, type = 'application/json') => { res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' }); res.end(type === 'application/json' ? JSON.stringify(body) : body); };
const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = []; let size = 0;
  req.on('data', (c) => { size += c.length; if (size > 30e6) { reject(new Error('Body too large')); req.destroy(); } chunks.push(c); });
  req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
  req.on('error', reject);
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  try {
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) return send(res, 200, fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'), 'text/html');

    if (req.method === 'GET' && p === '/api/state') {
      const ds = readJson('dataset.json');
      return send(res, 200, {
        dataset: datasetSummary(ds), analysis: analysisSummary(loadAnalysis(DATA)), playbook: readJson('playbook.json'),
        settings: getSettings(), model_choices: MODEL_CHOICES, jev: { ...jevConfig(), key: undefined },
        history: readHistory().map((r) => ({ ...r, hook: hookOf(r.text) })), has_key: Boolean(process.env.OPENROUTER_API_KEY),
        job: job ? { running: !job.finished, error: job.error, last: job.last?.event === 'progress' ? job.last.data : null } : null,
      });
    }
    if (req.method === 'GET' && p === '/api/posts') {
      const ds = readJson('dataset.json');
      if (!ds) return send(res, 404, { error: 'No dataset loaded' });
      const bucket = url.searchParams.get('bucket');
      return send(res, 200, { posts: ds.posts.filter((x) => !bucket || x.bucket === bucket).sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9)).map(postCard) });
    }
    if (req.method === 'POST' && p === '/api/csv/inspect') {
      const { csv } = await readBody(req);
      if (!csv) return send(res, 400, { error: 'csv missing' });
      return send(res, 200, inspectCsv(csv));
    }
    if (req.method === 'POST' && p === '/api/dataset') {
      const { csv, mapping, name, metric } = await readBody(req);
      if (!csv) return send(res, 400, { error: 'csv missing' });
      if (job && !job.finished) job.abort();
      const ds = loadDatasetFromCsv(csv, { mapping, name, metric });
      return send(res, 200, { dataset: datasetSummary(ds) });
    }
    if (req.method === 'GET' && p === '/api/analyze/stream') {
      const ds = readJson('dataset.json');
      if (!ds) return send(res, 400, { error: 'Load a CSV first' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      const write = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      const j = startJob(ds);
      if (j.finished) { write(j.error ? 'error' : 'done', j.error ? { error: j.error } : analysisSummary(loadAnalysis(DATA))); return res.end(); }
      const listener = (event, data) => { write(event, data); if (event === 'done' || event === 'error') res.end(); };
      j.listeners.add(listener);
      if (j.last) write(j.last.event, j.last.data);
      req.on('close', () => j.listeners.delete(listener));
      return;
    }
    if (req.method === 'POST' && p === '/api/analyze/cancel') { if (job && !job.finished) job.abort(); return send(res, 200, { ok: true }); }

    if (req.method === 'POST' && p === '/api/score') {
      const ds = readJson('dataset.json');
      const analysis = loadAnalysis(DATA);
      if (!ds || !analysis) return send(res, 400, { error: 'Load a CSV and let the pattern search finish first' });
      const { text, save = true } = await readBody(req);
      if (!text || text.trim().length < 20) return send(res, 400, { error: 'Paste a draft of at least 20 characters' });
      const result = await scoreDraft(text, ds, analysis);
      if (save) fs.appendFileSync(file('history.jsonl'), JSON.stringify(result) + '\n');
      return send(res, 200, { result });
    }
    if (req.method === 'POST' && p === '/api/explain') {
      const ds = readJson('dataset.json');
      const analysis = loadAnalysis(DATA);
      if (!ds || !analysis) return send(res, 400, { error: 'Run the pattern search first' });
      const { model } = await readBody(req);
      return send(res, 200, { playbook: await explainAnalysis(ds, analysis, model || getSettings().analyze_model) });
    }
    if (req.method === 'POST' && p === '/api/rewrite') {
      const ds = readJson('dataset.json');
      const analysis = loadAnalysis(DATA);
      if (!ds || !analysis) return send(res, 400, { error: 'Run the pattern search first' });
      const { result, model } = await readBody(req);
      if (!result?.text) return send(res, 400, { error: 'Measure the draft first' });
      return send(res, 200, { rewrite: await rewriteDraft(ds, analysis, result, model || getSettings().score_model) });
    }
    if (req.method === 'POST' && p === '/api/reset') {
      if (job && !job.finished) job.abort();
      for (const f of ['dataset.json', 'analysis.json', 'playbook.json', 'history.jsonl', 'labels-cache.json']) if (fs.existsSync(file(f))) fs.unlinkSync(file(f));
      job = null;
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/settings') {
      const body = await readBody(req);
      const next = { ...getSettings(), ...Object.fromEntries(Object.entries(body).filter(([k]) => ['analyze_model', 'score_model'].includes(k))) };
      writeJson('settings.json', next);
      return send(res, 200, { settings: next });
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(`[${new Date().toISOString()}] ${req.method} ${p} failed:`, e.message);
    if (!res.headersSent) return send(res, e.status && e.status < 500 ? e.status : 500, { error: e.message });
    res.end();
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, '127.0.0.1', () => {
    const j = jevConfig();
    console.log(`LinkedIn Viral Meter v2 on http://127.0.0.1:${PORT}  (engine: ${j.model} via ${j.via}; Claude extras: ${getSettings().analyze_model} / ${getSettings().score_model})`);
  });
}
