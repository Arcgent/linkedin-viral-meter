// Statistics and a small classifier on top of the labeled posts. Plain JS, no dependencies.
import { jevFeatureNames, STRUCT_KEYS, featureLabel, featureKind, QUESTIONS } from './questions.mjs';

export const FEATURE_NAMES = [...jevFeatureNames(), ...STRUCT_KEYS];

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const median = (a) => { const s = [...a].sort((x, y) => x - y); if (!s.length) return 0; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const r3 = (x) => Math.round(x * 1000) / 1000;

export function toVector(features, names = FEATURE_NAMES) {
  return names.map((n) => Number(features[n]) || 0);
}

export function fitStandardizer(X) {
  const d = X[0].length;
  const mu = Array(d).fill(0);
  const sd = Array(d).fill(1);
  for (let j = 0; j < d; j++) {
    const col = X.map((r) => r[j]);
    mu[j] = mean(col);
    sd[j] = std(col) || 1;
  }
  return { mu, sd };
}
export const standardize = (x, { mu, sd }) => x.map((v, j) => (v - mu[j]) / sd[j]);

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

// L2-regularised logistic regression by gradient descent on standardized features.
export function logisticFit(Z, y, { l2 = 2.0, iters = 800, lr = 0.05 } = {}) {
  const n = Z.length;
  const d = Z[0].length;
  let w = Array(d).fill(0);
  let b = Math.log((mean(y) + 1e-6) / (1 - mean(y) + 1e-6));
  for (let it = 0; it < iters; it++) {
    const gw = Array(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      const p = sigmoid(dot(w, Z[i]) + b);
      const err = p - y[i];
      for (let j = 0; j < d; j++) gw[j] += err * Z[i][j];
      gb += err;
    }
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + (l2 / n) * w[j]);
    b -= lr * (gb / n);
  }
  return { w, b };
}
export const logisticPredict = (z, { w, b }) => sigmoid(dot(w, z) + b);

// Ridge regression via normal equations (Gaussian elimination).
export function ridgeFit(Z, t, { lambda = 5.0 } = {}) {
  const n = Z.length;
  const d = Z[0].length;
  const tm = mean(t);
  const A = Array.from({ length: d }, () => Array(d).fill(0));
  const bvec = Array(d).fill(0);
  for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) {
    bvec[j] += Z[i][j] * (t[i] - tm);
    for (let k = 0; k < d; k++) A[j][k] += Z[i][j] * Z[i][k];
  }
  for (let j = 0; j < d; j++) A[j][j] += lambda;
  const w = solve(A, bvec);
  return { w, b: tm };
}
export const ridgePredict = (z, { w, b }) => dot(w, z) + b;

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c] || 1e-9;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / piv;
      if (!f) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-9));
}

function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

// Area under the ROC curve = P(random positive scores above random negative).
export function auc(scores, labels) {
  const pos = scores.filter((_, i) => labels[i] === 1);
  const neg = scores.filter((_, i) => labels[i] === 0);
  if (!pos.length || !neg.length) return null;
  let wins = 0;
  for (const p of pos) for (const q of neg) wins += p > q ? 1 : p === q ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

export function crossValidatedAuc(X, y, k = 5, opts = {}) {
  const n = X.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  // deterministic shuffle
  let seed = 42;
  for (let i = n - 1; i > 0; i--) { seed = (seed * 9301 + 49297) % 233280; const j = Math.floor((seed / 233280) * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  const scores = Array(n).fill(0);
  for (let f = 0; f < k; f++) {
    const test = idx.filter((_, i) => i % k === f);
    const train = idx.filter((_, i) => i % k !== f);
    const st = fitStandardizer(train.map((i) => X[i]));
    const model = logisticFit(train.map((i) => standardize(X[i], st)), train.map((i) => y[i]), opts);
    for (const i of test) scores[i] = logisticPredict(standardize(X[i], st), model);
  }
  return { auc: auc(scores, y), scores };
}

// Univariate effects: which features separate viral from flop.
export function univariateEffects(rows, names = FEATURE_NAMES, { minSupport = 6 } = {}) {
  const viral = rows.filter((r) => r.bucket === 'viral');
  const flop = rows.filter((r) => r.bucket === 'flop');
  const eligible = rows.filter((r) => r.bucket && r.bucket !== 'excluded');
  const logs = eligible.map((r) => Math.log1p(r.metric || 0));
  const out = [];
  for (const name of names) {
    const v = viral.map((r) => Number(r.features[name]) || 0);
    const f = flop.map((r) => Number(r.features[name]) || 0);
    const all = eligible.map((r) => Number(r.features[name]) || 0);
    if (!v.length || !f.length) continue;
    const kind = featureKind(name);
    if (std(all) < 1e-9) continue; // no variance, no signal
    // floor the pooled spread so a perfectly separating feature gets a large but finite effect
    const floor = kind === 'struct' ? std(all) * 0.15 : 0.1;
    const sdPooled = Math.max(Math.sqrt((std(v) ** 2 + std(f) ** 2) / 2), floor);
    const d = (mean(v) - mean(f)) / sdPooled;
    const isProb = kind === 'noul' || kind === 'choice';
    // viral rate when the feature is "on" vs "off"
    const cut = isProb ? 0.5 : median(all);
    const on = eligible.filter((r) => (Number(r.features[name]) || 0) >= (isProb ? cut : cut + 1e-9));
    const off = eligible.filter((r) => (Number(r.features[name]) || 0) < (isProb ? cut : cut + 1e-9));
    if (on.length < minSupport || off.length < minSupport) continue;
    const rate = (g) => g.filter((r) => r.bucket === 'viral').length / g.length;
    const corr = pearson(all, logs);
    out.push({
      name, label: featureLabel(name), kind,
      viral_mean: r3(mean(v)), flop_mean: r3(mean(f)), all_mean: r3(mean(all)),
      viral_share_on: isProb ? Math.round(100 * v.filter((x) => x >= 0.5).length / v.length) : null,
      flop_share_on: isProb ? Math.round(100 * f.filter((x) => x >= 0.5).length / f.length) : null,
      viral_rate_on: r3(rate(on)), viral_rate_off: r3(rate(off)), n_on: on.length, n_off: off.length,
      median_metric_on: median(on.map((r) => r.metric || 0)), median_metric_off: median(off.map((r) => r.metric || 0)),
      effect: r3(d), corr: r3(corr),
    });
  }
  return out.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
}

function pearson(a, b) {
  const ma = mean(a); const mb = mean(b);
  let num = 0; let da = 0; let db = 0;
  for (let i = 0; i < a.length; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

// Per-option tables for the choice questions (hook type, CTA, post type, topic, ...).
export function choiceTables(rows) {
  const eligible = rows.filter((r) => r.bucket && r.bucket !== 'excluded' && r.answers);
  const tables = {};
  for (const [id, q] of Object.entries(QUESTIONS)) {
    if (q.type !== 'choice') continue;
    const opts = {};
    for (const opt of Object.keys(q.criteria)) opts[opt] = [];
    for (const r of eligible) { const c = r.answers[id]?.choice; if (c && opts[c]) opts[c].push(r); }
    tables[id] = {
      label: q.label,
      options: Object.entries(opts).filter(([, g]) => g.length).map(([opt, g]) => ({
        option: opt, label: opt.replace(/_/g, ' '), n: g.length, share: Math.round(100 * g.length / eligible.length),
        viral_rate: r3(g.filter((r) => r.bucket === 'viral').length / g.length),
        median_metric: median(g.map((r) => r.metric || 0)),
        top_refs: g.filter((r) => r.bucket === 'viral').sort((a, b) => (b.metric || 0) - (a.metric || 0)).slice(0, 3).map((r) => r.ref),
      })).sort((a, b) => b.median_metric - a.median_metric),
    };
  }
  return tables;
}

// Evidence refs for a pattern: the strongest posts in the relevant bucket for that feature.
export function evidenceFor(rows, name, bucket, k = 4) {
  return rows.filter((r) => r.bucket === bucket).sort((a, b) => (Number(b.features[name]) || 0) - (Number(a.features[name]) || 0) || (b.metric || 0) - (a.metric || 0)).slice(0, k).map((r) => r.ref);
}

// Train everything on labeled rows: [{id, ref, bucket, metric, features, answers}]
export function trainAnalysis(rows, { metricKey = 'impressions' } = {}) {
  const eligible = rows.filter((r) => r.bucket && r.bucket !== 'excluded');
  const X = eligible.map((r) => toVector(r.features));
  const y = eligible.map((r) => (r.bucket === 'viral' ? 1 : 0));
  const t = eligible.map((r) => Math.log1p(r.metric || 0));
  const st = fitStandardizer(X);
  const Z = X.map((x) => standardize(x, st));
  // pick the regularisation strength with the best cross-validated AUC (small data, many features)
  let best = { l2: 20, auc: -1 };
  for (const l2 of [10, 20, 40, 80, 160, 320]) {
    const r = crossValidatedAuc(X, y, 5, { l2 });
    if (r.auc !== null && r.auc > best.auc + 1e-6) best = { l2, auc: r.auc };
  }
  const logistic = { ...logisticFit(Z, y, { l2: best.l2 }), l2: best.l2 };
  const ridge = ridgeFit(Z, t, { lambda: best.l2 });
  const cv = { auc: best.auc };
  const fitted = Z.map((z) => logisticPredict(z, logistic));
  const effects = univariateEffects(rows);
  const viral_patterns = effects.filter((e) => e.effect > 0).slice(0, 12).map((e) => ({ ...e, evidence: evidenceFor(rows, e.name, 'viral') }));
  const flop_patterns = effects.filter((e) => e.effect < 0).slice(0, 12).map((e) => ({ ...e, evidence: evidenceFor(rows, e.name, 'flop') }));
  const weights = FEATURE_NAMES.map((n, j) => ({ name: n, label: featureLabel(n), w: r3(logistic.w[j]) })).sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
  return {
    names: FEATURE_NAMES,
    standardizer: st,
    logistic,
    ridge,
    quality: { n: eligible.length, positives: y.filter(Boolean).length, auc_cv: cv.auc < 0 ? null : r3(cv.auc), auc_train: r3(auc(fitted, y)), base_rate: r3(mean(y)), l2: best.l2 },
    fitted_scores: eligible.map((r, i) => ({ id: r.id, ref: r.ref, p: r3(fitted[i]) })),
    effects,
    viral_patterns,
    flop_patterns,
    tables: choiceTables(rows),
    weights: weights.slice(0, 30),
    metricKey,
  };
}

// Score one feature vector against a trained analysis.
export function scoreFeatures(features, analysis, rows) {
  const x = toVector(features, analysis.names);
  const z = standardize(x, analysis.standardizer);
  const p = logisticPredict(z, analysis.logistic);
  const expected = Math.expm1(ridgePredict(z, analysis.ridge));
  const ps = analysis.fitted_scores.map((s) => s.p);
  const percentile = Math.round((100 * ps.filter((q) => q < p).length) / Math.max(1, ps.length));
  const contributions = analysis.names.map((n, j) => ({ name: n, label: featureLabel(n), value: r3(x[j]), z: r3(z[j]), contribution: r3(analysis.logistic.w[j] * z[j]) }))
    .filter((c) => Math.abs(c.contribution) > 0.01)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  const eligible = rows.filter((r) => r.bucket && r.bucket !== 'excluded');
  const closest = eligible.map((r) => {
    const zr = standardize(toVector(r.features, analysis.names), analysis.standardizer);
    return { ref: r.ref, id: r.id, bucket: r.bucket, metric: r.metric, similarity: r3(cosine(z, zr)) };
  }).sort((a, b) => b.similarity - a.similarity).slice(0, 5);
  return {
    probability_top20: r3(p),
    percentile,
    expected_metric: Math.max(0, Math.round(expected)),
    pulling_up: contributions.filter((c) => c.contribution > 0).slice(0, 8),
    pulling_down: contributions.filter((c) => c.contribution < 0).slice(0, 8),
    closest,
  };
}

function cosine(a, b) {
  let s = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
  return na && nb ? s / Math.sqrt(na * nb) : 0;
}
