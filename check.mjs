// Offline smoke test (no API calls unless --live): CSV parsing, feature matrix, model fit + CV AUC on synthetic labels.
import fs from 'node:fs';
import { inspectCsv, parseCsv, applyMapping } from './lib/csv.mjs';
import { buildDataset } from './lib/stats.mjs';
import { FEATURE_NAMES, trainAnalysis, scoreFeatures } from './lib/model.mjs';
import { structFeatures } from './lib/jev.mjs';
import { QUESTIONS, bankForJev } from './lib/questions.mjs';

const live = process.argv.includes('--live');
let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) failed++; };

// 1. CSV: the example export, plus column detection for other header styles
const SAMPLE = 'examples/posts.sample.csv';
{
  const csv = fs.readFileSync(SAMPLE, 'utf8');
  const info = inspectCsv(csv);
  const ds = buildDataset(applyMapping(parseCsv(csv).records, info.mapping));
  ok(ds.eligible >= 50 && ds.buckets.viral.n >= 10, `${SAMPLE}: ${ds.eligible} ranked, viral threshold ${ds.viral_threshold}`);
}
for (const [header, expect] of [
  ['URL,Post,Format,Impressions,Likes,Comments,Date', { text: 'Post', impressions: 'Impressions', likes: 'Likes', date: 'Date' }],
  ['id;datum;formaat;impressies;reacties;comments;reposts;tekst', { text: 'tekst', impressions: 'impressies', likes: 'reacties', reposts: 'reposts' }],
]) {
  const { mapping } = inspectCsv(`${header}\n`);
  ok(Object.entries(expect).every(([k, v]) => mapping[k] === v), `detects columns in "${header}"`);
}

// 2. Question bank sanity
const bank = bankForJev();
ok(Object.keys(bank).length >= 50, `question bank has ${Object.keys(bank).length} questions, ${FEATURE_NAMES.length} features`);
ok(Object.values(QUESTIONS).every((q) => q.label && q.instructions), 'every question has a label and instructions');
ok(Object.values(QUESTIONS).filter((q) => q.type === 'score').every((q) => q.criteria.length >= 2 && q.criteria.length <= 10), 'score levels within 2-10');

// 3. Synthetic model: plant two signals and check the model finds them
let seed = 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
const rows = [];
for (let i = 0; i < 200; i++) {
  const f = {}; for (const n of FEATURE_NAMES) f[n] = rnd();
  Object.assign(f, structFeatures('Line one\n\nLine two ✅ item\n✅ item two'));
  const gate = rnd() < 0.4 ? 1 : 0; f.keyword_comment_gate = gate; f.ends_with_open_question = gate ? rnd() * 0.3 : rnd();
  const metric = Math.round(500 + 8000 * gate + 3000 * (1 - f.ends_with_open_question) + 2000 * rnd());
  rows.push({ id: `p${i}`, ref: `P${i}`, metric, features: f, answers: { hook_type: { choice: gate ? 'number_proof' : 'question' } } });
}
rows.sort((a, b) => b.metric - a.metric).forEach((r, i) => { r.bucket = i < 40 ? 'viral' : i < 100 ? 'good' : i < 160 ? 'average' : 'flop'; });
const a = trainAnalysis(rows);
ok(a.quality.auc_cv > 0.65, `synthetic CV AUC ${a.quality.auc_cv} (train ${a.quality.auc_train})`);
ok(a.viral_patterns[0].name === 'keyword_comment_gate', `top viral pattern = ${a.viral_patterns[0].label} (effect ${a.viral_patterns[0].effect})`);
ok(a.flop_patterns[0].name === 'ends_with_open_question', `top flop pattern = ${a.flop_patterns[0].label} (effect ${a.flop_patterns[0].effect})`);
const hi = scoreFeatures(rows[0].features, a, rows); const lo = scoreFeatures(rows[199].features, a, rows);
ok(hi.percentile > lo.percentile && hi.expected_metric > lo.expected_metric, `score top ${hi.percentile} (exp ${hi.expected_metric}) > bottom ${lo.percentile} (exp ${lo.expected_metric})`);
ok(a.tables.hook_type.options[0].option === 'number_proof', 'hook table ranks number_proof first');

// 4. Live: label the best and the worst example post
if (live) {
  const { labelPost } = await import('./lib/jev.mjs');
  const csv = fs.readFileSync(SAMPLE, 'utf8');
  const ds = buildDataset(applyMapping(parseCsv(csv).records, inspectCsv(csv).mapping));
  const posts = ds.posts.filter((p) => p.eligible).sort((x, y) => x.rank - y.rank);
  for (const p of [posts[0], posts[posts.length - 1]]) {
    const r = await labelPost(p.text);
    ok(Object.keys(r.features).length === FEATURE_NAMES.length, `live label ${p.bucket} post: ${r.ms} ms, $${r.cost}, gate=${r.features.keyword_comment_gate}, open_q=${r.features.ends_with_open_question}`);
  }
}
console.log(failed ? `\nFAILED ${failed}` : '\nOK');
process.exit(failed ? 1 : 0);
