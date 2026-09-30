#!/usr/bin/env node
// CLI: inspect <csv> | analyze <csv> [--metric m] | score "<text>" | score --file draft.md [--rewrite] | explain | reset
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectCsv } from './lib/csv.mjs';
import { runAnalysis, loadAnalysis, scoreDraft } from './lib/analysis.mjs';
import { loadDatasetFromCsv, explainAnalysis, rewriteDraft, getSettings, DATA } from './server.mjs';

const args = process.argv.slice(2);
const cmd = args.shift();
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? false : (args.splice(i, 1), true); };
const opt = (name) => { const i = args.indexOf(name); return i === -1 ? null : args.splice(i, 2)[1]; };
const metric = opt('--metric');
const fileArg = opt('--file');
const model = opt('--model');
const wantRewrite = flag('--rewrite');
const readJson = (n) => JSON.parse(fs.readFileSync(path.join(DATA, n), 'utf8'));
const fmt = (n) => (n === null || n === undefined ? '-' : Number(n).toLocaleString('en-US'));
const usage = () => { console.log('usage:\n  cli.mjs inspect <csv>\n  cli.mjs analyze <csv> [--metric impressions|engagement]\n  cli.mjs score "<draft>" | score --file draft.md [--rewrite]\n  cli.mjs explain [--model m]\n  cli.mjs reset'); process.exit(1); };
const patLine = (p) => `  • ${p.label}: ${p.viral_share_on !== null ? `${p.viral_share_on}% of viral vs ${p.flop_share_on}% of flops` : `avg ${p.viral_mean} vs ${p.flop_mean}`} · viral rate ${Math.round(p.viral_rate_on * 100)}% on / ${Math.round(p.viral_rate_off * 100)}% off · median ${fmt(p.median_metric_on)} vs ${fmt(p.median_metric_off)} [${p.evidence.join(', ')}]`;

try {
  if (cmd === 'inspect') {
    console.log(JSON.stringify({ ...inspectCsv(fs.readFileSync(args[0], 'utf8')), preview: undefined }, null, 2));
  } else if (cmd === 'analyze') {
    if (!args[0]) usage();
    const ds = loadDatasetFromCsv(fs.readFileSync(args[0], 'utf8'), { name: path.basename(args[0]), metric });
    console.log(`Loaded ${ds.total} posts (${ds.eligible} ranked by ${ds.metricLabel}); viral threshold ${fmt(ds.viral_threshold)}`);
    const a = await runAnalysis(ds, { dataDir: DATA, onProgress: (p) => { if (process.stdout.isTTY || p.done % 25 === 0 || p.done === p.total) process.stdout.write(`${process.stdout.isTTY ? '\r' : ''}  labeling ${p.done}/${p.total}  ${(p.elapsed_ms / 1000).toFixed(1)} s  $${p.cost.toFixed(4)}${process.stdout.isTTY ? '   ' : '\n'}`); } });
    console.log(`\n${a.engine.calls} Jev calls (${a.engine.cached} cached), $${a.engine.cost_usd}, ${(a.engine.elapsed_ms / 1000).toFixed(1)} s, ${a.engine.errors.length} errors`);
    console.log(`Model: ${a.quality.n} posts, ${a.quality.positives} viral. Cross-validated AUC ${a.quality.auc_cv} (ranks a random viral post above a random other one ${Math.round(a.quality.auc_cv * 100)}% of the time). Train AUC ${a.quality.auc_train}.`);
    console.log('\nWhat your viral posts share:'); a.viral_patterns.forEach((p) => console.log(patLine(p)));
    console.log('\nWhat your flops share:'); a.flop_patterns.forEach((p) => console.log(patLine(p)));
    for (const id of ['hook_type', 'cta_type', 'post_type', 'topic_lane']) {
      const t = a.tables[id];
      console.log(`\n${t.label}:`); t.options.forEach((o) => console.log(`  ${o.label.padEnd(28)} ${String(o.n).padStart(4)} posts  viral ${String(Math.round(o.viral_rate * 100)).padStart(3)}%  median ${fmt(o.median_metric)}`));
    }
    console.log('\nSaved data/analysis.json');
  } else if (cmd === 'score') {
    const text = fileArg ? fs.readFileSync(fileArg, 'utf8') : args.join(' ');
    if (!text || text.trim().length < 20) usage();
    const ds = readJson('dataset.json');
    const a = loadAnalysis(DATA);
    if (!a) throw new Error('Run analyze first');
    const r = await scoreDraft(text, ds, a);
    fs.appendFileSync(path.join(DATA, 'history.jsonl'), JSON.stringify(r) + '\n');
    console.log(`\nVIRAL SCORE ${r.viral_score}/100 (better than ${r.viral_score}% of your posts) · P(top 20%) ${Math.round(r.probability_top20 * 100)}% · expected ${fmt(r.expected_metric)} ${r.metricKey} → ${r.predicted_bucket.toUpperCase()}   [${r.engine.total_ms} ms, $${r.engine.cost_usd}]`);
    console.log('\nPulling up:'); r.pulling_up.forEach((c) => console.log(`  +${c.contribution.toFixed(2)}  ${c.label} (${c.value})`));
    console.log('Pulling down:'); r.pulling_down.forEach((c) => console.log(`  ${c.contribution.toFixed(2)}  ${c.label} (${c.value})`));
    console.log('\nClosest past posts:'); r.closest_posts.forEach((c) => console.log(`  ${c.ref} [${c.bucket}, ${fmt(c.metric)}] ${c.similarity}  "${c.hook.slice(0, 80)}"`));
    if (wantRewrite) {
      console.log('\nAsking Claude for rewrites...');
      const rw = await rewriteDraft(ds, a, r, model || getSettings().score_model);
      console.log(`\n${rw.verdict}\n`);
      rw.fixes.forEach((f) => console.log(`  • ${f.what}\n    → ${f.rewrite.replace(/\n/g, '\n      ')}`));
      console.log('\nHooks:'); rw.hook_alternatives.forEach((h) => console.log(`  • ${h}`));
      console.log(`\nRewritten post:\n${rw.rewritten_post}\n\n(cost $${rw._meta.cost_usd})`);
    }
  } else if (cmd === 'explain') {
    const ds = readJson('dataset.json');
    const a = loadAnalysis(DATA);
    const pb = await explainAnalysis(ds, a, model || getSettings().analyze_model);
    console.log(pb.summary); console.log(`\nSaved data/playbook.json (cost $${pb._meta.cost_usd})`);
  } else if (cmd === 'reset') {
    for (const f of ['dataset.json', 'analysis.json', 'playbook.json', 'history.jsonl', 'labels-cache.json']) if (fs.existsSync(path.join(DATA, f))) fs.unlinkSync(path.join(DATA, f));
    console.log('data/ cleared');
  } else usage();
} catch (e) {
  console.error('Error:', e.message);
  process.exit(1);
}
