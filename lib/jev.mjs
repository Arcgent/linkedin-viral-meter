// Jev (TypeSafe System One model) client through OpenRouter's decisions endpoint,
// with optional direct TypeSafe API. Plus post labeling helpers.
import { createHash } from 'node:crypto';
import { bankForJev, answersToFeatures, STRUCT_KEYS } from './questions.mjs';
import { extractFeatures } from './stats.mjs';

const DEFAULT_BASE = 'https://openrouter.ai/api/alpha/decisions';

export function jevConfig() {
  const direct = process.env.JEV_DIRECT === '1' && process.env.TYPESAFE_API_KEY;
  return direct
    ? { base: 'https://api.typesafe.ai/v1/systemone', key: process.env.TYPESAFE_API_KEY, model: (process.env.JEV_MODEL || 'jev-latest').replace(/^~?typesafe\//, ''), via: 'typesafe' }
    : { base: process.env.JEV_BASE_URL || DEFAULT_BASE, key: process.env.OPENROUTER_API_KEY, model: process.env.JEV_MODEL || '~typesafe/jev-latest', via: 'openrouter' };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One decisions call. Retries on 429/5xx/network with exponential backoff.
export async function decide({ state, questions, signal, timeoutMs = 25000, retries = 4 }) {
  const cfg = jevConfig();
  if (!cfg.key) throw new Error(cfg.via === 'openrouter' ? 'OPENROUTER_API_KEY is not set (put it in .env)' : 'TYPESAFE_API_KEY is not set');
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const onAbort = () => ctrl.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const t0 = Date.now();
    try {
      const res = await fetch(cfg.base, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json', 'X-Title': 'LinkedIn Viral Meter' },
        body: JSON.stringify({ model: cfg.model, state, questions }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 429 || res.status === 529 || res.status >= 500) throw Object.assign(new Error(`Jev ${res.status}: ${json?.error?.message || json?.message || 'retryable'}`), { retryable: true, status: res.status });
      if (!res.ok || json.error) throw Object.assign(new Error(`Jev ${res.status}: ${json?.error?.message || json?.message || JSON.stringify(json).slice(0, 200)}`), { status: res.status });
      return { answers: json.answers || {}, model: json.model, cost: json.usage?.cost ?? null, tokens: json.usage?.input_tokens ?? null, ms: Date.now() - t0 };
    } catch (e) {
      lastErr = e;
      if (signal?.aborted) throw new Error('cancelled');
      const retryable = e.retryable || e.name === 'AbortError' || e.code === 'ECONNRESET' || e.name === 'TypeError';
      if (!retryable || attempt === retries) throw e;
      await sleep(500 * 2 ** attempt + Math.random() * 250);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
  throw lastErr;
}

export const textHash = (text) => createHash('sha1').update(String(text)).digest('hex');

function stateFor(text) {
  const clean = String(text || '').replace(/\r/g, '').trim();
  const first_line = clean.split('\n').map((l) => l.trim()).filter(Boolean)[0] || '';
  return { first_line, post: clean };
}

// Full feature vector for one text: Jev features + structural counts.
export function structFeatures(text) {
  const s = extractFeatures(text);
  const out = {};
  for (const k of STRUCT_KEYS) out[k] = typeof s[k] === 'boolean' ? (s[k] ? 1 : 0) : Number(s[k]) || 0;
  return out;
}

export async function labelPost(text, { signal } = {}) {
  const r = await decide({ state: stateFor(text), questions: bankForJev(), signal });
  return { answers: r.answers, features: { ...answersToFeatures(r.answers), ...structFeatures(text) }, cost: r.cost, tokens: r.tokens, ms: r.ms, model: r.model };
}

// Label many posts with a worker pool. `cache` maps textHash -> {answers}. Calls onProgress after each post.
export async function labelMany(posts, { concurrency = 10, onProgress, onResult, signal, cache = {} } = {}) {
  const results = {};
  let done = 0;
  let cost = 0;
  let calls = 0;
  const t0 = Date.now();
  const queue = [...posts];
  const errors = [];
  async function worker() {
    while (queue.length) {
      if (signal?.aborted) return;
      const p = queue.shift();
      const h = textHash(p.text);
      try {
        let answers;
        let c = 0;
        if (cache[h]?.answers) answers = cache[h].answers;
        else {
          const r = await decide({ state: stateFor(p.text), questions: bankForJev(), signal });
          answers = r.answers;
          c = r.cost || 0;
          calls++;
          cache[h] = { answers, model: r.model };
        }
        cost += c;
        results[p.id] = { answers, features: { ...answersToFeatures(answers), ...structFeatures(p.text) } };
        onResult?.(p, results[p.id]);
      } catch (e) {
        if (signal?.aborted) return;
        errors.push({ id: p.id, error: e.message });
      }
      done++;
      onProgress?.({ done, total: posts.length, cost, calls, elapsed_ms: Date.now() - t0, lastId: p.id });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, posts.length) }, worker));
  if (signal?.aborted) throw new Error('cancelled');
  return { results, cost, calls, errors, elapsed_ms: Date.now() - t0 };
}
