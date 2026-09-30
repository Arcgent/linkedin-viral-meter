// OpenRouter client with JSON-schema structured output, fallback parsing and validation.

const BASE = 'https://openrouter.ai/api/v1';

function apiKey() {
  const k = process.env.OPENROUTER_API_KEY;
  if (!k) throw new Error('OPENROUTER_API_KEY is not set (put it in .env)');
  return k;
}

async function chat(body) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
      'X-Title': 'LinkedIn Viral Meter',
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const msg = json?.error?.message || `HTTP ${res.status}`;
    const err = new Error(`OpenRouter: ${msg}`);
    err.status = res.status;
    err.raw = json;
    throw err;
  }
  return json;
}

export function extractJson(content) {
  if (typeof content !== 'string') content = JSON.stringify(content);
  let s = content.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in model output');
  return JSON.parse(s.slice(start, end + 1));
}

// Minimal JSON-schema validator (type, required, enum, items, properties). Coerces numeric strings.
export function validate(schema, data, path = '$', errors = []) {
  const t = schema.type;
  if (t === 'object') {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) { errors.push(`${path}: expected object`); return errors; }
    for (const req of schema.required || []) if (!(req in data)) errors.push(`${path}.${req}: missing`);
    for (const [k, sub] of Object.entries(schema.properties || {})) if (k in data) validate(sub, data[k], `${path}.${k}`, errors);
  } else if (t === 'array') {
    if (!Array.isArray(data)) { errors.push(`${path}: expected array`); return errors; }
    if (schema.items) data.forEach((x, i) => validate(schema.items, x, `${path}[${i}]`, errors));
  } else if (t === 'number' || t === 'integer') {
    if (typeof data === 'string' && data.trim() !== '' && !Number.isNaN(Number(data))) return errors; // coerced later
    if (typeof data !== 'number' || Number.isNaN(data)) errors.push(`${path}: expected number`);
  } else if (t === 'string') {
    if (typeof data !== 'string') errors.push(`${path}: expected string`);
  } else if (t === 'boolean') {
    if (typeof data !== 'boolean') errors.push(`${path}: expected boolean`);
  }
  if (schema.enum && !schema.enum.includes(data)) errors.push(`${path}: expected one of ${schema.enum.join('|')}`);
  return errors;
}

export function coerce(schema, data) {
  const t = schema.type;
  if (t === 'object' && data && typeof data === 'object') {
    for (const [k, sub] of Object.entries(schema.properties || {})) if (k in data) data[k] = coerce(sub, data[k]);
    return data;
  }
  if (t === 'array' && Array.isArray(data)) return data.map((x) => coerce(schema.items || {}, x));
  if ((t === 'number' || t === 'integer') && typeof data === 'string') return Number(data);
  return data;
}

// Call a model and get back an object that matches `schema`.
export async function callJson({ model, system, user, schema, schemaName = 'result', maxTokens = 8000, temperature = 0.3 }) {
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  const base = { model, messages, max_tokens: maxTokens, temperature };
  let response;
  let usedStructured = true;
  try {
    response = await chat({ ...base, response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } } });
  } catch (e) {
    if (e.status && e.status >= 500) throw e;
    // Provider or model does not accept the schema: fall back to instructed JSON.
    usedStructured = false;
    const sys2 = `${system}\n\nReturn ONLY a JSON object (no prose, no code fences) that matches this JSON schema exactly:\n${JSON.stringify(schema)}`;
    response = await chat({ ...base, messages: [{ role: 'system', content: sys2 }, messages[1]] });
  }

  let content = response.choices?.[0]?.message?.content ?? '';
  let data;
  let errors;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      data = coerce(schema, extractJson(content));
      errors = validate(schema, data);
      if (!errors.length) break;
    } catch (e) {
      errors = [e.message];
    }
    if (attempt === 0) {
      // One repair round: send the errors back.
      const repair = await chat({
        ...base,
        messages: [
          ...messages,
          { role: 'assistant', content: typeof content === 'string' ? content : JSON.stringify(content) },
          { role: 'user', content: `Your JSON did not validate:\n- ${errors.join('\n- ')}\n\nReturn the corrected JSON object only, matching this schema:\n${JSON.stringify(schema)}` },
        ],
      });
      content = repair.choices?.[0]?.message?.content ?? '';
      response.usage = { ...(response.usage || {}), cost: (response.usage?.cost || 0) + (repair.usage?.cost || 0) };
    }
  }
  if (errors?.length) throw new Error(`Model output failed validation: ${errors.slice(0, 5).join('; ')}`);

  return {
    data,
    meta: {
      model: response.model || model,
      provider: response.provider,
      structured: usedStructured,
      cost_usd: response.usage?.cost ?? null,
      prompt_tokens: response.usage?.prompt_tokens ?? null,
      completion_tokens: response.usage?.completion_tokens ?? null,
    },
  };
}
