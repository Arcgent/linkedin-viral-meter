// Orchestrates the Jev labeling run + training, with progress callbacks. Shared by server and CLI.
import fs from 'node:fs';
import path from 'node:path';
import { labelMany, labelPost } from './jev.mjs';
import { trainAnalysis, univariateEffects, scoreFeatures, evidenceFor } from './model.mjs';
import { answersSummary } from './questions.mjs';
import { statCheck } from './stats.mjs';

const readJson = (f, fb = null) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : fb);

export function loadAnalysis(dataDir) { return readJson(path.join(dataDir, 'analysis.json')); }

// What the UI needs (no per-post feature rows, no raw weights)
export function analysisSummary(a) {
  if (!a) return null;
  const { rows, standardizer, logistic, ridge, fitted_scores, effects, ...rest } = a;
  return { ...rest, effects: effects.slice(0, 40), labeled: rows.length };
}

function rowsFor(ds, results) {
  return ds.posts.filter((p) => p.eligible && results[p.id]).map((p) => ({ id: p.id, ref: p.ref, bucket: p.bucket, metric: p.metric, features: results[p.id].features, answers: results[p.id].answers }));
}

// Quick pattern preview on the posts labeled so far (used for the live "partial" events)
export function partialPatterns(ds, results) {
  const rows = rowsFor(ds, results);
  if (rows.filter((r) => r.bucket === 'viral').length < 4 || rows.filter((r) => r.bucket === 'flop').length < 4) return null;
  const effects = univariateEffects(rows, undefined, { minSupport: 3 });
  return {
    labeled: rows.length,
    viral_patterns: effects.filter((e) => e.effect > 0).slice(0, 8).map((e) => ({ ...e, evidence: evidenceFor(rows, e.name, 'viral', 3) })),
    flop_patterns: effects.filter((e) => e.effect < 0).slice(0, 8).map((e) => ({ ...e, evidence: evidenceFor(rows, e.name, 'flop', 3) })),
  };
}

export async function runAnalysis(ds, { dataDir, concurrency = Number(process.env.JEV_CONCURRENCY || 10), onProgress, onPartial, partialEvery = 20, signal } = {}) {
  const cacheFile = path.join(dataDir, 'labels-cache.json');
  const cache = readJson(cacheFile, {});
  // label from both ends of the ranking (best, worst, 2nd best, 2nd worst, ...) so the live
  // preview sees viral and flop posts from the first batch on
  const ranked = ds.posts.filter((p) => p.eligible).sort((a, b) => a.rank - b.rank);
  const posts = [];
  for (let i = 0, j = ranked.length - 1; i <= j; i++, j--) { posts.push(ranked[i]); if (i !== j) posts.push(ranked[j]); }
  const results = {};
  const { cost, calls, errors, elapsed_ms } = await labelMany(posts, {
    concurrency, signal, cache,
    onResult: (p, r) => { results[p.id] = r; },
    onProgress: (prog) => {
      onProgress?.(prog);
      if (onPartial && (prog.done % partialEvery === 0) && prog.done < prog.total) {
        try { const partial = partialPatterns(ds, results); if (partial) onPartial(partial); } catch { /* best effort */ }
      }
    },
  });
  fs.writeFileSync(cacheFile, JSON.stringify(cache));
  const rows = rowsFor(ds, results);
  if (rows.length < 20) throw new Error(`Only ${rows.length} posts labeled (${errors.length} errors). Need at least 20.`);
  const model = trainAnalysis(rows, { metricKey: ds.metricKey });
  const analysis = {
    ...model,
    rows,
    created_at: new Date().toISOString(),
    source: ds.source?.name || null,
    metricLabel: ds.metricLabel,
    viral_threshold: ds.viral_threshold,
    engine: { model: Object.values(cache)[0]?.model || 'jev', calls, cached: rows.length - calls, cost_usd: Math.round(cost * 1e6) / 1e6, elapsed_ms, errors },
  };
  fs.writeFileSync(path.join(dataDir, 'analysis.json'), JSON.stringify(analysis));
  return analysis;
}

export function bucketForPercentile(pct) { return pct >= 80 ? 'viral' : pct >= 50 ? 'good' : pct >= 20 ? 'average' : 'flop'; }

export async function scoreDraft(text, ds, analysis, { signal } = {}) {
  const t0 = Date.now();
  const lab = await labelPost(text, { signal });
  const s = scoreFeatures(lab.features, analysis, analysis.rows);
  const byId = Object.fromEntries(ds.posts.map((p) => [p.id, p]));
  const sc = statCheck(text, ds);
  return {
    id: `s${Date.now()}`,
    ts: new Date().toISOString(),
    text,
    viral_score: s.percentile,
    probability_top20: s.probability_top20,
    predicted_bucket: bucketForPercentile(s.percentile),
    expected_metric: s.expected_metric,
    metricKey: ds.metricKey,
    pulling_up: s.pulling_up,
    pulling_down: s.pulling_down,
    closest_posts: s.closest.map((c) => { const p = byId[c.id]; return { ...c, hook: p ? p.text.split('\n').map((l) => l.trim()).filter(Boolean)[0] : '', url: p?.url || null, impressions: p?.impressions ?? null }; }),
    stat_check: sc.checks,
    jev: answersSummary(lab.answers),
    features: lab.features,
    engine: { model: lab.model, cost_usd: lab.cost, tokens: lab.tokens, jev_ms: lab.ms, total_ms: Date.now() - t0 },
  };
}
