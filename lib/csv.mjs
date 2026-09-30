// CSV parsing + column detection for LinkedIn post exports.
// Handles: BOM, quoted fields with newlines, "" escapes, delimiter sniffing (, ; tab).

export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const count = (ch) => (firstLine.match(new RegExp(ch === '\t' ? '\t' : `\\${ch}`, 'g')) || []).length;
  const delimiter = [',', ';', '\t'].sort((a, b) => count(b) - count(a))[0];

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delimiter) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (!nonEmpty.length) return { headers: [], records: [], delimiter };
  const headers = nonEmpty[0].map((h) => h.trim());
  const records = nonEmpty.slice(1).map((r) => {
    const o = {};
    headers.forEach((h, i) => { o[h] = (r[i] ?? '').trim(); });
    return o;
  });
  return { headers, records, delimiter };
}

// Field -> candidate header names (normalised: lowercase, spaces/underscores/dashes removed).
// Order matters: exact matches are resolved field by field in this order.
const CANDIDATES = {
  text: ['tekst', 'text', 'post', 'posttext', 'content', 'postcontent', 'commentary', 'sharecommentary', 'body', 'caption', 'message', 'inhoud', 'copy'],
  impressions: ['impressies', 'impressions', 'views', 'weergaven', 'reach', 'bereik', 'totalimpressions'],
  likes: ['reacties', 'reactions', 'likes', 'like', 'vindikleuks', 'totalreactions'],
  comments: ['comments', 'comment', 'opmerkingen', 'replies', 'totalcomments'],
  reposts: ['reposts', 'shares', 'herplaatsingen', 'repostcount', 'sharecount', 'totalreposts', 'totalshares'],
  date: ['datum', 'date', 'published', 'publishedat', 'posted', 'postedat', 'created', 'createdat', 'timestamp', 'publishdate', 'postpublishdate', 'publicatiedatum', 'time'],
  url: ['url', 'link', 'sharelink', 'posturl', 'permalink', 'postlink'],
  format: ['formaat', 'format', 'type', 'mediatype', 'posttype', 'contenttype'],
  age_days: ['leeftijddagen', 'agedays', 'age'],
  is_repost: ['repost', 'isrepost'],
  id: ['id', 'postid', 'activityid'],
};

const norm = (s) => String(s).toLowerCase().replace(/[\s_\-]/g, '');

export function detectMapping(headers) {
  const mapping = {};
  const taken = new Set();
  // pass 1: exact
  for (const [field, names] of Object.entries(CANDIDATES)) {
    const hit = headers.find((h) => !taken.has(h) && names.includes(norm(h)));
    if (hit) { mapping[field] = hit; taken.add(hit); }
  }
  // pass 2: substring (only longer candidates, to avoid "id" matching everything)
  for (const [field, names] of Object.entries(CANDIDATES)) {
    if (mapping[field]) continue;
    const hit = headers.find((h) => !taken.has(h) && names.some((n) => n.length >= 5 && norm(h).includes(n)));
    if (hit) { mapping[field] = hit; taken.add(hit); }
  }
  return mapping;
}

const toNum = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/[^0-9.,\-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  if (s === '' || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const toBool = (v) => /^(true|1|yes|ja|y)$/i.test(String(v ?? '').trim());

// Turn raw records into normalised posts using a mapping {field: header}.
export function applyMapping(records, mapping) {
  const posts = [];
  records.forEach((r, i) => {
    const text = mapping.text ? r[mapping.text] : '';
    if (!text || text.trim().length === 0) return;
    posts.push({
      id: mapping.id && r[mapping.id] ? String(r[mapping.id]) : `row${i + 2}`,
      text: text.replace(/\r/g, ''),
      impressions: mapping.impressions ? toNum(r[mapping.impressions]) : null,
      likes: mapping.likes ? toNum(r[mapping.likes]) : null,
      comments: mapping.comments ? toNum(r[mapping.comments]) : null,
      reposts: mapping.reposts ? toNum(r[mapping.reposts]) : null,
      date: mapping.date ? r[mapping.date] : null,
      url: mapping.url ? r[mapping.url] : null,
      format: mapping.format ? r[mapping.format] : null,
      age_days: mapping.age_days ? toNum(r[mapping.age_days]) : null,
      is_repost: mapping.is_repost ? toBool(r[mapping.is_repost]) : false,
    });
  });
  return posts;
}

export function inspectCsv(text) {
  const { headers, records, delimiter } = parseCsv(text);
  const mapping = detectMapping(headers);
  const warnings = [];
  if (!mapping.text) warnings.push('No post text column detected. Pick it manually.');
  if (!mapping.impressions && !mapping.likes) {
    warnings.push('No engagement metrics (impressions or reactions) found. The LinkedIn "Shares" data export has none; use the analytics export or a tool export (MagicPost, Taplio, Shield, AuthoredUp).');
  }
  return { headers, delimiter, rowCount: records.length, mapping, warnings, preview: records.slice(0, 3) };
}
