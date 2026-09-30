// The fixed Jev question bank. Every post and every draft is labeled with exactly these questions.
// Rules (TypeSafe docs): one judgment per question, describe situations not degrees, reference
// state fields with backticks, never ask Jev to count or compare dates.
// State shape: { first_line, post }

const noul = (label, instructions) => ({ type: 'noul', label, instructions });
const score = (label, instructions, levels) => ({ type: 'score', label, instructions, criteria: levels });
const choice = (label, instructions, options) => ({ type: 'choice', label, instructions, criteria: options });

export const QUESTIONS = {
  // ---------- hook (first line) ----------
  hook_type: choice('Hook type', 'What kind of opening is `first_line`?', {
    number_proof: 'Leads with a concrete number as proof: downloads, people, agents, hours saved, revenue',
    personal_story: 'Drops into a moment from the author\'s own life or work (something happened to me, I did X)',
    bold_claim: 'States a strong opinion or claim as fact, without a number',
    contrarian: 'Pushes against what most people believe or do (stop doing X, everyone is wrong about Y)',
    question: 'Asks the reader a question',
    promise_how_to: 'Promises a method, steps or a way to get a result (how to, here is how, the way I)',
    tool_news: 'Announces or reacts to a product launch, update or industry news',
    other: 'None of the above',
  }),
  hook_has_number: noul('Hook contains a number', '`first_line` contains a specific number, count, percentage or amount'),
  hook_first_person: noul('Hook in first person', '`first_line` is written from the author\'s own perspective (I, I\'m, my, we)'),
  hook_names_tool: noul('Hook names a tool', '`first_line` names a specific product, tool, model or company (for example n8n, Claude, ChatGPT, Notion, Apify, HubSpot)'),
  hook_addresses_you: noul('Hook addresses "you"', '`first_line` speaks directly to the reader using you or your'),
  hook_generic: noul('Hook anyone could have written', '`first_line` is a generic statement that any creator in this space could have written; nothing in it is specific to this author\'s own experience'),
  hook_curiosity_gap: score('Hook curiosity gap', 'How much does `first_line` make the reader need to keep reading?', [
    '`first_line` fully explains itself; nothing is left to find out',
    '`first_line` hints at something, but the payoff is predictable',
    '`first_line` opens a clear gap: the reader must keep reading to learn what happened, what it was, or how',
  ]),
  hook_specificity: score('Hook specificity', 'How concrete is `first_line`?', [
    '`first_line` is abstract: no names, numbers, tools or concrete situation',
    '`first_line` has one concrete detail',
    '`first_line` is packed with concrete detail: a named thing, a number and a situation',
  ]),
  line_two_twist: noul('Line two adds a twist', 'The second line of `post` adds a twist, tension or promise instead of restating `first_line`'),

  // ---------- offer and call to action ----------
  keyword_comment_gate: noul('Keyword comment gate', '`post` asks readers to comment a specific word or keyword to receive something'),
  free_asset_offered: noul('Free asset offered', '`post` offers a free downloadable or sendable thing: template, guide, checklist, file, workflow, tool, video or access'),
  asset_type: choice('Asset type', 'What free thing does `post` offer the reader?', {
    template: 'A template, workflow file, JSON, Notion workspace or starter kit',
    guide: 'A written guide, ebook, PDF, playbook or document',
    tool: 'A working tool, app, agent, bot or skill the reader can use',
    checklist: 'A checklist, question list, framework or one-pager',
    video: 'A video, recording, course or webinar',
    other_asset: 'Some other free thing',
    none: 'No free asset is offered',
  }),
  cta_type: choice('Call to action type', 'How does `post` ask the reader to act at the end?', {
    comment_keyword: 'Asks the reader to comment a keyword to get something',
    dm_me: 'Asks the reader to send a DM or message',
    link: 'Points the reader to a link, in the post or in the comments',
    open_question: 'Ends by asking the reader for their opinion, experience or thoughts',
    follow: 'Asks the reader to follow, connect or subscribe',
    save_repost: 'Asks the reader to save, share or repost',
    none: 'No call to action',
  }),
  urgency_or_scarcity: noul('Urgency or scarcity', '`post` includes a deadline, limited window, limited spots or "early access ends" type pressure'),
  ps_line_present: noul('Has a P.S.', '`post` contains a P.S. line'),
  asks_save_or_repost: noul('Asks to save or repost', '`post` asks the reader to save, share or repost it'),
  ends_with_open_question: noul('Ends with an open question', 'The last lines of `post` ask the reader an open question about their opinion or experience, rather than asking for a specific action'),
  link_in_comments: noul('Link parked in comments', '`post` says a link, video or resource is in the comments or the first comment'),

  // ---------- content ----------
  post_type: choice('Post type', 'Which description fits `post` best?', {
    build_reveal: 'The author shows something they built or set up themselves and what it does',
    lead_magnet_drop: 'The main point of the post is to give away a free resource',
    tool_news_reaction: 'The author reacts to a product launch, update or industry news and says what it means',
    personal_story: 'A story about something that happened to the author, with a lesson',
    opinion_essay: 'An argument or point of view explained in paragraphs',
    how_to_list: 'Steps, tips or a list that teaches how to do something',
    case_study_result: 'A result achieved for a client or in the author\'s business, with numbers',
    question_to_audience: 'The post mainly asks the audience something or runs a poll',
  }),
  topic_lane: choice('Topic lane', 'What is `post` mainly about?', {
    building_with_ai_tools: 'Building agents, automations or workflows with specific AI tools',
    ai_industry_news: 'News, launches or updates from AI companies and what they mean',
    business_operations_process: 'How companies organise work: processes, SOPs, readiness, change management',
    sales_marketing_growth: 'Sales, lead generation, marketing, content growth, outreach',
    personal_story_career: 'The author\'s personal journey, career or life lessons',
    productivity_habits: 'Personal productivity, habits, focus, routines',
    hiring_team_culture: 'Hiring, team building, culture, leadership',
    other: 'Something else',
  }),
  audience: choice('Written for', 'Who is `post` written for?', {
    builders: 'People who build with AI and automation tools themselves',
    business_owners: 'Founders and business owners deciding what to do with AI',
    operators_managers: 'Managers, operations or department leads inside companies',
    general_professionals: 'Any LinkedIn professional',
    other: 'Unclear or other',
  }),
  emotional_angle: choice('Emotional angle', 'What makes `post` work emotionally?', {
    proof: 'It shows evidence that something works',
    curiosity: 'It makes the reader want to know what happened or how',
    fear_of_missing_out: 'It suggests the reader is falling behind or missing something',
    aspiration: 'It paints a better future or result the reader wants',
    frustration: 'It names a pain, annoyance or failure the reader shares',
    humor: 'It works through a joke or an absurd situation',
    none: 'No clear emotional angle',
  }),
  named_tools_in_body: noul('Names specific tools', '`post` names specific products, tools, models or platforms, not just "AI" or "automation"'),
  concrete_outcome_numbers: noul('Concrete result numbers', '`post` states concrete results with numbers: hours saved, revenue, downloads, response rates, counts'),
  social_proof_number: noul('Social proof number', '`post` cites how many people did something: downloaded, signed up, watched, used, asked'),
  time_effort_claim: noul('Low effort claim', '`post` states how little time or effort something took or takes (built in an evening, 10 minutes, one prompt)'),
  step_by_step_present: noul('Step by step', '`post` walks through numbered or ordered steps of how something was done'),
  list_of_capabilities: noul('Lists what it does', '`post` lists what something can do or what is included (features, capabilities, contents)'),
  gives_copyable_detail: noul('Copyable prompt or setup', '`post` includes an actual prompt, code snippet, workflow description or setting a reader could copy'),
  teaches_actionable: noul('Actionable takeaway', 'A reader could do something concrete after reading `post`: a step, a setting, a script, a question to ask'),
  reader_benefit_clear: noul('Reader benefit is clear', 'It is clear what the reader gets out of `post`: a resource, a lesson or a method'),
  unique_personal_detail: noul('Only-this-author detail', '`post` contains at least one specific, slightly odd or personal detail that only this author could have written: a real moment, a real conversation, a strange specific fact'),
  story_present: noul('Tells a story', '`post` tells a short story with a moment in time and something that happened, not only advice'),
  self_deprecating_or_failure: noul('Admits a failure', '`post` admits a mistake, failure or something that went wrong for the author'),
  contrast_before_after: noul('Before vs after contrast', '`post` contrasts a before and an after, or an old way versus a new way'),
  names_real_people_or_companies: noul('Names real people or companies', '`post` names real people, clients or companies, not "a client" or "a company"'),
  client_result: noul('Client result', '`post` describes a result achieved for a client or customer'),
  personal_result: noul('Own result', '`post` describes a result the author achieved in their own business or life'),
  mentions_price_or_money: noul('Mentions money', '`post` mentions prices, costs, revenue or money amounts'),
  mentions_ai_agents: noul('About AI agents', '`post` is about AI agents specifically: agents that act or run tasks, not just chat or prompts'),
  warning_or_mistake_frame: noul('Mistake or warning frame', '`post` frames its content as a mistake to avoid or a warning'),
  own_content_performance: noul('Talks about own content stats', '`post` refers to the performance of the author\'s own content, audience or followers'),
  reads_ai_generated: noul('Reads AI-generated', '`post` reads like it was generated by an AI writing assistant: polished but generic phrasing, symmetrical lists, safe conclusions, no lived detail'),
  reply_bait: noul('Reply bait', '`post` fishes for comments with a low-effort prompt such as "agree?", "thoughts?", "who else?" or a poll-like question with no substance behind it'),
  abstraction_level: score('Abstraction level', 'How abstract is `post`?', [
    '`post` is concrete throughout: real tools, real numbers, a real situation',
    '`post` mixes concrete examples with general advice',
    '`post` stays abstract: principles, readiness, mindset or strategy with no concrete example',
  ]),
  controversy: score('Takes a stance', 'How much does `post` push against common opinion?', [
    '`post` says nothing anyone would disagree with',
    '`post` takes a mild stance some readers may push back on',
    '`post` directly contradicts common advice or calls something out',
  ]),
  clarity: score('Clarity of the point', 'How clear is the point of `post`?', [
    '`post` is hard to follow: unclear point, tangled sentences',
    '`post` is understandable but the point takes effort to find',
    '`post` makes one clear point a reader gets on first read',
  ]),
  sales_pitchiness: score('Sales pitch level', 'How much is `post` a pitch for the author\'s paid work?', [
    '`post` sells nothing and mentions no service',
    '`post` mentions the author\'s service or offer in passing',
    '`post` is mainly a pitch for the author\'s paid service',
  ]),
  jargon: score('Jargon level', 'How much unexplained jargon does `post` use?', [
    '`post` uses everyday words a non-expert would follow',
    '`post` uses some industry terms but explains or contextualises them',
    '`post` leans on jargon and abbreviations without explanation',
  ]),
  confidence_tone: score('Conviction', 'How much conviction does `post` speak with?', [
    '`post` hedges: maybe, I think, could be, not sure',
    '`post` is balanced, with some hedging',
    '`post` states things with full conviction, no hedging',
  ]),
  tone_conversational: score('Conversational tone', 'How does `post` sound?', [
    '`post` reads formal or corporate',
    '`post` reads neutral professional',
    '`post` reads like the author talking to a friend',
  ]),
  density: score('Content density', 'How does the length of `post` match what it says?', [
    '`post` says less than its length justifies; it feels padded or repetitive',
    '`post` length matches its content',
    '`post` is dense: more ideas than its length comfortably carries',
  ]),

  // ---------- format (judgments that complement the deterministic counts) ----------
  scannability: score('Scannability', 'How is `post` laid out?', [
    '`post` is prose paragraphs of several sentences each',
    '`post` mixes short lines with some longer paragraphs',
    '`post` is one idea per line with white space, easy to skim on a phone',
  ]),
  checkmark_list: noul('Marker list', '`post` contains a list where lines start with a checkmark, bullet, arrow, number or emoji marker'),
  promise_delivered: noul('Delivers on the hook', 'The body of `post` actually delivers what `first_line` promises or sets up'),
};

// Options that carry no signal on their own (dropped from the feature vector)
const DROP_OPTIONS = new Set(['other', 'none', 'other_asset']);

// The bank as sent to Jev (labels stripped).
export function bankForJev() {
  const out = {};
  for (const [id, q] of Object.entries(QUESTIONS)) {
    const { label, ...rest } = q;
    out[id] = rest;
  }
  return out;
}

// Ordered feature names produced from Jev answers.
export function jevFeatureNames() {
  const names = [];
  for (const [id, q] of Object.entries(QUESTIONS)) {
    if (q.type === 'choice') {
      for (const opt of Object.keys(q.criteria)) if (!DROP_OPTIONS.has(opt)) names.push(`${id}=${opt}`);
    } else names.push(id);
  }
  return names;
}

const humanize = (s) => s.replace(/_/g, ' ');

// Human label for any feature name (Jev or structural).
export function featureLabel(name) {
  if (name.includes('=')) {
    const [id, opt] = name.split('=');
    return `${QUESTIONS[id]?.label || humanize(id)}: ${humanize(opt)}`;
  }
  if (QUESTIONS[name]) return QUESTIONS[name].label;
  return STRUCT_LABELS[name] || humanize(name);
}

export function featureKind(name) {
  if (name.includes('=')) return 'choice';
  const q = QUESTIONS[name];
  if (q) return q.type; // noul | score
  return 'struct';
}

// Structural features taken from lib/stats.mjs extractFeatures (deterministic counts).
export const STRUCT_KEYS = ['words', 'lines', 'paragraph_breaks', 'hook_words', 'hook_is_question', 'has_emoji', 'emoji_count', 'hashtags', 'has_list', 'list_lines', 'ends_with_question', 'has_cta', 'has_url', 'avg_sentence_words', 'short_line_share'];
export const STRUCT_LABELS = {
  words: 'Word count', lines: 'Number of lines', paragraph_breaks: 'Paragraph breaks', hook_words: 'Hook length (words)', hook_is_question: 'Hook is a question (text check)',
  has_emoji: 'Uses emoji', emoji_count: 'Emoji count', hashtags: 'Hashtags', has_list: 'Contains a list (text check)', list_lines: 'List lines', ends_with_question: 'Ends with "?" (text check)',
  has_cta: 'CTA words present (text check)', has_url: 'Contains a link', avg_sentence_words: 'Avg words per sentence', short_line_share: 'Share of short lines',
};

// Convert raw Jev answers to the flat feature vector (object name -> number).
export function answersToFeatures(answers) {
  const f = {};
  for (const [id, q] of Object.entries(QUESTIONS)) {
    const a = answers[id];
    if (!a) continue;
    if (q.type === 'noul') f[id] = clamp(a.noul);
    else if (q.type === 'score') f[id] = clamp((a.score ?? 0) / (q.criteria.length - 1));
    else if (q.type === 'choice') {
      for (const opt of Object.keys(q.criteria)) if (!DROP_OPTIONS.has(opt)) f[`${id}=${opt}`] = clamp(a.probabilities?.[opt] ?? (a.choice === opt ? 1 : 0));
    }
  }
  return f;
}

// Compact, human-readable view of the answers (for the UI and the Claude prompts).
export function answersSummary(answers) {
  const out = [];
  for (const [id, q] of Object.entries(QUESTIONS)) {
    const a = answers[id];
    if (!a) continue;
    if (q.type === 'noul') out.push({ id, label: q.label, kind: 'noul', value: round2(a.noul) });
    else if (q.type === 'score') out.push({ id, label: q.label, kind: 'score', value: round2(a.score), max: q.criteria.length - 1, level: q.criteria[Math.round(a.score)] || '', confidence: round2(a.confidence) });
    else out.push({ id, label: q.label, kind: 'choice', value: a.choice, probability: round2(a.probabilities?.[a.choice]), confidence: round2(a.confidence) });
  }
  return out;
}

const clamp = (x) => Math.max(0, Math.min(1, Number(x) || 0));
const round2 = (x) => (x === undefined || x === null ? null : Math.round(Number(x) * 100) / 100);
