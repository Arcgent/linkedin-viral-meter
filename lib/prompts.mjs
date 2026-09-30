// Prompts + JSON schemas for the optional Claude extras: "explain in words" and "rewrite".
// The hot path (patterns + scoring) runs on Jev and never touches these.

// Who writes the posts and for whom. Set CREATOR_CONTEXT in .env so the playbook and rewrites fit your voice.
const CREATOR_CONTEXT = `Creator: ${process.env.CREATOR_CONTEXT?.trim() || 'not described. Infer the language, niche and audience from the posts.'}`;
const fmt = (n) => (n === null || n === undefined ? '-' : Number(n).toLocaleString('en-US'));

function patternLine(p) {
  const share = p.viral_share_on !== null ? `present in ${p.viral_share_on}% of viral vs ${p.flop_share_on}% of flop posts` : `avg ${p.viral_mean} in viral vs ${p.flop_mean} in flop posts (0-1 scale)`;
  return `- ${p.label}: ${share}; viral rate ${Math.round(p.viral_rate_on * 100)}% when present vs ${Math.round(p.viral_rate_off * 100)}% when absent; median ${fmt(p.median_metric_on)} vs ${fmt(p.median_metric_off)}; evidence ${p.evidence.join(', ')}`;
}
function tableBlock(t) {
  return `${t.label}:\n${t.options.map((o) => `  - ${o.label}: ${o.n} posts (${o.share}%), viral rate ${Math.round(o.viral_rate * 100)}%, median ${fmt(o.median_metric)}${o.top_refs.length ? `, best ${o.top_refs.join(' ')}` : ''}`).join('\n')}`;
}

export function buildExplainInput(analysis, ds) {
  const byRef = Object.fromEntries(ds.posts.map((p) => [p.ref, p]));
  const hook = (ref) => { const p = byRef[ref]; return p ? `${ref} (${fmt(p.metric)}): "${p.text.split('\n').map((l) => l.trim()).filter(Boolean)[0]}"` : ref; };
  const top = ds.posts.filter((p) => p.bucket === 'viral').sort((a, b) => a.rank - b.rank).slice(0, 12).map((p) => hook(p.ref));
  const bottom = ds.posts.filter((p) => p.bucket === 'flop').sort((a, b) => b.rank - a.rank).slice(0, 8).map((p) => hook(p.ref));
  return `${CREATOR_CONTEXT}

## Dataset
${analysis.quality.n} posts ranked by ${analysis.metricLabel}; viral = top 20% (threshold ${fmt(analysis.viral_threshold)}). A decision model (TypeSafe Jev) labeled every post with 55 typed questions; a classifier trained on those labels reaches cross-validated AUC ${analysis.quality.auc_cv} (it ranks a random viral post above a random non-viral one ${Math.round(analysis.quality.auc_cv * 100)}% of the time).

## What viral posts share (strongest separators first)
${analysis.viral_patterns.map(patternLine).join('\n')}

## What flops share
${analysis.flop_patterns.map(patternLine).join('\n')}

## Tables
${Object.values(analysis.tables).map(tableBlock).join('\n\n')}

## Hooks of the best posts
${top.map((h) => `- ${h}`).join('\n')}

## Hooks of the worst posts
${bottom.map((h) => `- ${h}`).join('\n')}`;
}

export const EXPLAIN_SYSTEM = `You are a LinkedIn performance analyst working for one creator. You receive statistics computed from their own posts: which labeled traits separate their viral posts from their flops, per-option tables, and the hooks of their best and worst posts.

Turn these numbers into a written playbook the creator can act on. Rules:
- Only claim what the numbers support. Cite post refs (P1, P7, ...) from the evidence fields; never invent posts.
- Be specific and testable. Prefer "hook names a tool and a number" over "be authentic".
- The scoring rubric must map onto the strongest separators, weights 1-5 by effect size.
- Plain English, short sentences, no em-dashes. Never leave a field empty.`;

export const PLAYBOOK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'what_viral_posts_share', 'what_flops_share', 'hooks', 'structure', 'topics', 'formats_and_timing', 'scoring_rubric', 'pre_publish_checklist', 'contradictions_with_common_advice'],
  properties: {
    summary: { type: 'string', description: 'Three to five sentences: the big picture of what works for this account.' },
    what_viral_posts_share: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['pattern', 'why_it_works', 'evidence_posts', 'how_to_apply'], properties: { pattern: { type: 'string' }, why_it_works: { type: 'string' }, evidence_posts: { type: 'array', items: { type: 'string' } }, how_to_apply: { type: 'string' } } } },
    what_flops_share: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['pattern', 'why_it_fails', 'evidence_posts', 'avoid_by'], properties: { pattern: { type: 'string' }, why_it_fails: { type: 'string' }, evidence_posts: { type: 'array', items: { type: 'string' } }, avoid_by: { type: 'string' } } } },
    hooks: { type: 'object', additionalProperties: false, required: ['winning_hook_types', 'failing_hook_types', 'hook_rules'], properties: {
      winning_hook_types: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['type', 'example_from_data', 'post_ref', 'note'], properties: { type: { type: 'string' }, example_from_data: { type: 'string' }, post_ref: { type: 'string' }, note: { type: 'string' } } } },
      failing_hook_types: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['type', 'example_from_data', 'post_ref', 'note'], properties: { type: { type: 'string' }, example_from_data: { type: 'string' }, post_ref: { type: 'string' }, note: { type: 'string' } } } },
      hook_rules: { type: 'array', items: { type: 'string' } } } },
    structure: { type: 'object', additionalProperties: false, required: ['ideal_word_count_min', 'ideal_word_count_max', 'ideal_line_count_min', 'ideal_line_count_max', 'formatting_rules', 'ending_and_cta'], properties: { ideal_word_count_min: { type: 'integer' }, ideal_word_count_max: { type: 'integer' }, ideal_line_count_min: { type: 'integer' }, ideal_line_count_max: { type: 'integer' }, formatting_rules: { type: 'array', items: { type: 'string' } }, ending_and_cta: { type: 'string' } } },
    topics: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['topic', 'performance', 'note'], properties: { topic: { type: 'string' }, performance: { type: 'string', enum: ['viral', 'good', 'average', 'flop'] }, note: { type: 'string' } } } },
    formats_and_timing: { type: 'string' },
    scoring_rubric: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['criterion', 'weight', 'description', 'what_a_10_looks_like', 'what_a_2_looks_like'], properties: { criterion: { type: 'string' }, weight: { type: 'integer' }, description: { type: 'string' }, what_a_10_looks_like: { type: 'string' }, what_a_2_looks_like: { type: 'string' } } } },
    pre_publish_checklist: { type: 'array', items: { type: 'string' } },
    contradictions_with_common_advice: { type: 'array', items: { type: 'string' } },
  },
};

export const REWRITE_SYSTEM = `You are the rewrite desk for one LinkedIn creator. You get a draft, its viral-meter breakdown (a decision model's labels plus which learned traits pull the score up or down, with the creator's own numbers), the creator's strongest patterns, and hooks of their best posts.

Write concrete rewrites, not advice. Keep the creator's voice: first person, plain English, short lines, no em-dashes, no hashtags. Every fix must address one of the "pulling down" traits or a missing "viral" pattern and quote or point at the draft. hook_alternatives: exactly 3 alternative first lines in the creator's winning hook styles. director_cut_line: the one line only this creator could have written; if none, say so and propose one.`;

export const REWRITE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'fixes', 'hook_alternatives', 'director_cut_line', 'rewritten_post'],
  properties: {
    verdict: { type: 'string', description: 'One or two sentences on what would move this draft into the top 20%.' },
    fixes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['what', 'why', 'rewrite'], properties: { what: { type: 'string' }, why: { type: 'string' }, rewrite: { type: 'string' } } } },
    hook_alternatives: { type: 'array', items: { type: 'string' } },
    director_cut_line: { type: 'object', additionalProperties: false, required: ['found', 'line', 'note'], properties: { found: { type: 'boolean' }, line: { type: 'string' }, note: { type: 'string' } } },
    rewritten_post: { type: 'string', description: 'The full draft rewritten with all fixes applied, ready to paste.' },
  },
};

export function buildRewriteInput({ draft, result, analysis, ds }) {
  const byRef = Object.fromEntries(ds.posts.map((p) => [p.ref, p]));
  const top = ds.posts.filter((p) => p.bucket === 'viral').sort((a, b) => a.rank - b.rank).slice(0, 8).map((p) => `- ${p.ref} (${fmt(p.metric)}): "${p.text.split('\n').map((l) => l.trim()).filter(Boolean)[0]}"`);
  const line = (c) => `- ${c.label}: draft value ${c.value} (${c.contribution > 0 ? '+' : ''}${c.contribution})`;
  return `${CREATOR_CONTEXT}

## Viral meter result
score ${result.viral_score}/100 (better than ${result.viral_score}% of the creator's past posts), P(top 20%) ${result.probability_top20}, expected ${result.metricKey} ${fmt(result.expected_metric)}, bucket ${result.predicted_bucket}.

## Pulling the score up
${result.pulling_up.map(line).join('\n') || '- nothing notable'}

## Pulling the score down
${result.pulling_down.map(line).join('\n') || '- nothing notable'}

## Decision-model labels on the draft (selection)
${result.jev.filter((j) => j.kind !== 'noul' || j.value >= 0.5).map((j) => `- ${j.label}: ${j.kind === 'noul' ? 'yes' : j.kind === 'score' ? `${j.value}/${j.max}` : j.value}`).join('\n')}

## This creator's strongest viral patterns
${analysis.viral_patterns.slice(0, 8).map(patternLine).join('\n')}

## What their flops share
${analysis.flop_patterns.slice(0, 6).map(patternLine).join('\n')}

## Hooks of their best posts
${top.join('\n')}

## Closest past posts to this draft
${result.closest_posts.map((c) => `- ${c.ref} [${c.bucket}, ${fmt(c.metric)}]: "${c.hook}"`).join('\n')}

## THE DRAFT
"""
${draft.trim()}
"""`;
}
