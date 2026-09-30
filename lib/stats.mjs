// Deterministic feature extraction, bucketing and profile stats for a set of posts.

const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const LIST_LINE_RE = /^\s*([-•▪◦→✅✔☑✓*]|\d+[.)])\s+/;
const CTA_RE = /\b(comment|comments below|dm me|send me a dm|link in|drop a|reply|let me know|share this|repost this|follow me|follow for|save this|tag someone|what do you think|agree\?|thoughts\?)\b/i;

export function extractFeatures(text) {
  const clean = String(text || '').replace(/\r/g, '').trim();
  const lines = clean.split('\n').map((l) => l.trim());
  const nonEmpty = lines.filter(Boolean);
  const hook = nonEmpty[0] || '';
  const words = clean.split(/\s+/).filter(Boolean);
  const sentences = clean.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  const listLines = nonEmpty.filter((l) => LIST_LINE_RE.test(l)).length;
  const emojiCount = (clean.match(EMOJI_RE) || []).length;
  const hashtags = (clean.match(/(^|\s)#[\p{L}\p{N}_]+/gu) || []).length;
  const shortLines = nonEmpty.filter((l) => l.split(/\s+/).length <= 12).length;
  const lastLine = nonEmpty[nonEmpty.length - 1] || '';
  return {
    chars: clean.length,
    words: words.length,
    lines: nonEmpty.length,
    paragraph_breaks: (clean.match(/\n\s*\n/g) || []).length,
    hook_chars: hook.length,
    hook_words: hook.split(/\s+/).filter(Boolean).length,
    hook_is_question: /\?\s*$/.test(hook),
    hook_has_number: /\d/.test(hook),
    hook_first_person: /^(i |i'|i’|my |we |we'|we’)/i.test(hook),
    hook_addresses_you: /\byou(r)?\b/i.test(hook),
    has_emoji: emojiCount > 0,
    emoji_count: emojiCount,
    hashtags,
    has_list: listLines >= 2,
    list_lines: listLines,
    ends_with_question: /\?\s*$/.test(lastLine),
    has_cta: CTA_RE.test(lastLine) || CTA_RE.test(nonEmpty.slice(-2).join(' ')),
    has_url: /https?:\/\//i.test(clean),
    avg_sentence_words: sentences.length ? +(words.length / sentences.length).toFixed(1) : words.length,
    short_line_share: nonEmpty.length ? +(shortLines / nonEmpty.length).toFixed(2) : 0,
  };
}

export const FEATURE_LABELS = {
  words: 'Word count',
  chars: 'Character count',
  lines: 'Number of lines',
  paragraph_breaks: 'Paragraph breaks',
  hook_chars: 'Hook length (chars)',
  hook_words: 'Hook length (words)',
  hook_is_question: 'Hook is a question',
  hook_has_number: 'Hook contains a number',
  hook_first_person: 'Hook starts in first person',
  hook_addresses_you: 'Hook addresses "you"',
  has_emoji: 'Uses emoji',
  emoji_count: 'Emoji count',
  hashtags: 'Hashtags',
  has_list: 'Contains a list',
  list_lines: 'List lines',
  ends_with_question: 'Ends with a question',
  has_cta: 'Has a call to action',
  has_url: 'Contains a link',
  avg_sentence_words: 'Avg words per sentence',
  short_line_share: 'Share of short lines',
};

function parseDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const median = (arr) => {
  const a = [...arr].sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const mean = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);
const round = (n, d = 1) => +Number(n).toFixed(d);

// Build the dataset: features, ranking metric, buckets and per-bucket profiles.
export function buildDataset(posts, { metric = 'auto', freshDays = 2 } = {}) {
  const withImpr = posts.filter((p) => p.impressions !== null && p.impressions > 0).length;
  const metricKey = metric === 'auto' ? (withImpr >= posts.length * 0.5 ? 'impressions' : 'engagement') : metric;

  const dates = posts.map((p) => parseDate(p.date)).filter(Boolean);
  const latest = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;

  const enriched = posts.map((p) => {
    const d = parseDate(p.date);
    const ageDays = p.age_days !== null && p.age_days !== undefined ? p.age_days : d && latest ? (latest - d) / 86400000 : null;
    const engagement = (p.likes || 0) + 3 * (p.comments || 0) + 5 * (p.reposts || 0);
    const metricValue = metricKey === 'impressions' ? p.impressions || 0 : metricKey === 'comments' ? p.comments || 0 : engagement;
    return {
      ...p,
      weekday: d ? d.getDay() : null,
      hour: d ? d.getHours() : null,
      age_days: ageDays === null ? null : round(ageDays, 1),
      engagement,
      engagement_rate: p.impressions ? round((100 * ((p.likes || 0) + (p.comments || 0) + (p.reposts || 0))) / p.impressions, 2) : null,
      metric: metricValue,
      features: extractFeatures(p.text),
      eligible: !p.is_repost && p.text.trim().length >= 20 && (ageDays === null || ageDays >= freshDays),
    };
  });

  const eligible = enriched.filter((p) => p.eligible).sort((a, b) => b.metric - a.metric);
  const n = eligible.length;
  eligible.forEach((p, i) => {
    p.rank = i + 1;
    p.percentile = n > 1 ? round(100 * (1 - i / (n - 1)), 0) : 100;
    p.bucket = i < n * 0.2 ? 'viral' : i < n * 0.5 ? 'good' : i < n * 0.8 ? 'average' : 'flop';
  });
  enriched.filter((p) => !p.eligible).forEach((p) => { p.bucket = 'excluded'; });

  const buckets = {};
  for (const b of ['viral', 'good', 'average', 'flop']) {
    const rows = eligible.filter((p) => p.bucket === b);
    const prof = {};
    for (const key of Object.keys(FEATURE_LABELS)) {
      const vals = rows.map((p) => p.features[key]);
      prof[key] = typeof vals[0] === 'boolean' ? round(100 * mean(vals.map(Number)), 0) : round(mean(vals), 1);
    }
    buckets[b] = {
      n: rows.length,
      metric_min: rows.length ? rows[rows.length - 1].metric : 0,
      metric_median: median(rows.map((p) => p.metric)),
      metric_mean: round(mean(rows.map((p) => p.metric)), 0),
      impressions_median: median(rows.map((p) => p.impressions || 0)),
      likes_median: median(rows.map((p) => p.likes || 0)),
      comments_median: median(rows.map((p) => p.comments || 0)),
      reposts_median: median(rows.map((p) => p.reposts || 0)),
      engagement_rate_median: median(rows.map((p) => p.engagement_rate || 0)),
      profile: prof,
      formats: countBy(rows.map((p) => (p.format || 'unknown').toLowerCase())),
      weekdays: countBy(rows.map((p) => p.weekday).filter((x) => x !== null).map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d])),
      hour_mean: round(mean(rows.map((p) => p.hour).filter((x) => x !== null)), 1),
    };
  }

  return {
    metricKey,
    metricLabel: metricKey === 'impressions' ? 'impressions' : metricKey === 'comments' ? 'comments' : 'weighted engagement (likes + 3×comments + 5×reposts)',
    total: posts.length,
    eligible: n,
    excluded: enriched.length - n,
    viral_threshold: buckets.viral.metric_min,
    latest_date: latest ? latest.toISOString().slice(0, 10) : null,
    buckets,
    posts: enriched,
  };
}

function countBy(arr) {
  const m = {};
  for (const x of arr) m[x] = (m[x] || 0) + 1;
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
}

// Compare a new post's features to the viral vs flop profile. Only features that
// differ meaningfully between the two buckets are reported.
export function statCheck(text, dataset) {
  const f = extractFeatures(text);
  const v = dataset.buckets.viral.profile;
  const fl = dataset.buckets.flop.profile;
  const out = [];
  for (const key of Object.keys(FEATURE_LABELS)) {
    const isBool = typeof f[key] === 'boolean';
    const value = isBool ? (f[key] ? 100 : 0) : f[key];
    const vv = v[key];
    const fv = fl[key];
    const spread = Math.abs(vv - fv);
    const base = Math.max(Math.abs(vv), Math.abs(fv), 1e-9);
    if (spread / base < 0.15 && spread < (isBool ? 15 : 1)) continue; // no real signal
    const dV = Math.abs(value - vv);
    const dF = Math.abs(value - fv);
    const verdict = dV < dF * 0.8 ? 'viral-like' : dF < dV * 0.8 ? 'flop-like' : 'neutral';
    out.push({ key, label: FEATURE_LABELS[key], value: isBool ? (f[key] ? 'yes' : 'no') : value, viral_avg: isBool ? `${vv}%` : vv, flop_avg: isBool ? `${fv}%` : fv, verdict });
  }
  return { features: f, checks: out };
}
