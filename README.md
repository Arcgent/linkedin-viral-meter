# LinkedIn Viral Meter

Find out what your best LinkedIn posts have in common, then score a new draft in about a second, before you hit post.

Drop in a CSV of your own posts. Jev by TypeSafe (through OpenRouter) labels every post with the same 55 questions: hook type, call to action, post type, topic, how concrete it is, whether it reads AI-generated, reply bait and more. Plain code then does the statistics on your own numbers and shows what separates your viral posts from your flops.

"Viral" always means the top 20% of **your own** posts, not global virality.

Measured on a real account with 197 posts: the pattern search takes 15-30 seconds and costs about $0.03. Scoring a draft takes about a second and costs $0.0002.

It runs locally. Your posts, numbers and results stay on your machine.

> **Want to know how Arcgent can help your company become AI-native?** [Book a 30-minute call](https://cal.com/robin-van-veen-x9jhid/30min).

## What you need

- **Node 22+.** Nothing to `npm install`.
- **An OpenRouter API key** ([openrouter.ai/keys](https://openrouter.ai/keys)).
- **Your posts as a CSV** with the post text plus impressions and/or reactions. Exports from tools such as MagicPost, Taplio, Shield or AuthoredUp work, and so does your own scrape. Column names are detected automatically (English and Dutch), and you can correct them in the app. The "Shares" file from LinkedIn's own data download has the text but no numbers, so it won't work.

## Quick start

```bash
git clone https://github.com/Arcgent/linkedin-viral-meter.git && cd linkedin-viral-meter
cp .env.example .env        # paste your OPENROUTER_API_KEY into .env
npm start                   # open http://127.0.0.1:3140
```

Drop your CSV into step 1. If you want to try it without your own data first, use `examples/posts.sample.csv`. That file has 60 made-up posts with a few patterns built in.

## What you get

1. **Your posts.** Upload the CSV, check the detected columns and load. Posts are ranked by impressions, or by weighted engagement when impressions are missing.
2. **Patterns.** Jev labels every post while you watch the patterns appear. You get the traits that separate viral posts from flops, with the numbers and the posts as evidence, tables by hook type, call to action, post type, topic, emotional angle, asset type and audience, and a quality score for the model ("picks your viral post 8 out of 10 times").
3. **Viral meter.** Paste a draft and get a viral score (its percentile against your own posts), the chance it lands in your top 20%, expected impressions, what pulls the score up and down, the closest past posts with their real numbers, and everything Jev saw in the draft. Turn on **Live** to re-score while you type.

Two optional Claude buttons sit next to this. They never run unless you click them:

- **Explain in words** writes a playbook from your statistics.
- **Rewrite with Claude** gives concrete fixes, three alternative hooks and a full rewritten draft.

Set `CREATOR_CONTEXT` in `.env` (who you are, who you write for) so the playbook and rewrites fit your voice.

## What gets sent where

- **Jev** receives only the first line and the full text of each post (and of your draft). Not your impressions, reactions, dates or post URLs.
- **The statistics** (rankings, patterns, the classifier, the viral score) are computed locally in code.
- **Claude** (only when you click a Claude button) receives your statistics, the hooks of your best and worst posts, and the draft you are rewriting.

## How it works

- **Ranking.** Impressions when at least half the posts have them, otherwise weighted engagement (likes + 3×comments + 5×reposts). Reposts, empty posts and posts younger than 2 days are left out. Buckets by rank: viral = top 20%, good, average, flop = bottom 20%.
- **Labeling.** `lib/questions.mjs` holds the 55 questions. `lib/jev.mjs` sends `{model, state: {first_line, post}, questions}` to OpenRouter's decisions endpoint and turns the answers into a 106-feature vector, plus text counts from `lib/stats.mjs` (words, lines, emoji, hashtags, ...). Labels are cached per post text, so a second run costs nothing.
- **Statistics.** `lib/model.mjs` computes per-trait effects (viral vs flop), per-option tables, a logistic regression for the chance of a top-20% post with a 5-fold cross-validated AUC, and a ridge regression for expected impressions.
- **Scoring.** A draft goes through the same questions and models. The viral score is its percentile among your own posts.

The question bank is written with B2B, AI and automation creators in mind. If you post about something else, change the options of `topic_lane` and `audience` in `lib/questions.mjs`.

## Speed and cost

| Step | Time | Cost |
|---|---|---|
| Label one post with 55 questions | 0.3-0.6 s | $0.00016 |
| Pattern search on 197 posts (10 parallel) | 15-30 s | about $0.03 |
| Score a draft | about 1 s | $0.0002 |
| Explain in words (Claude Opus 5) | 30-90 s | about $0.10-0.30 |
| Rewrite with Claude (Claude Sonnet 5) | 20-40 s | about $0.03 |

## Terminal

```bash
npm run analyze -- examples/posts.sample.csv   # load, label and train; prints the patterns and the AUC
npm run score -- --file draft.md               # score a draft
npm run score -- --file draft.md --rewrite     # plus Claude rewrites
npm run explain                                # Claude playbook from the statistics
npm run reset                                  # empty data/
node cli.mjs inspect my-posts.csv              # show the detected columns
npm run check                                  # offline smoke test (add -- --live to label 2 posts with Jev)
```

## Configuration (`.env`)

| Variable | Default | |
|---|---|---|
| `OPENROUTER_API_KEY` | – | required |
| `CREATOR_CONTEXT` | – | who you are and who you write for; used by the Claude buttons |
| `JEV_MODEL` | `~typesafe/jev-latest` | pin a specific Jev version |
| `JEV_BASE_URL` | `https://openrouter.ai/api/alpha/decisions` | OpenRouter's decisions endpoint is still on `/api/alpha` and may move |
| `JEV_CONCURRENCY` | `10` | parallel Jev calls during the pattern search |
| `JEV_DIRECT` + `TYPESAFE_API_KEY` | off | call TypeSafe directly instead of OpenRouter |
| `ANALYZE_MODEL` | `anthropic/claude-opus-5` | model for "Explain in words" (also switchable in the app) |
| `SCORE_MODEL` | `anthropic/claude-sonnet-5` | model for "Rewrite with Claude" (also switchable in the app) |
| `PORT` | `3140` | local app port |

## Files

```
server.mjs         local web app and API
cli.mjs            inspect / analyze / score / explain / reset
check.mjs          offline smoke test
lib/questions.mjs  the 55 Jev questions and feature names
lib/jev.mjs        Jev client and post labeling
lib/model.mjs      effects, tables, logistic and ridge regression, AUC, scoring
lib/analysis.mjs   pattern search run and draft scoring
lib/csv.mjs        CSV parser and column detection
lib/stats.mjs      text counts, ranking and buckets
lib/llm.mjs        OpenRouter client for the Claude buttons
lib/prompts.mjs    Claude prompts and output schemas
public/index.html  the app
examples/          made-up posts to try it out
```

Everything the app creates lives in `data/`, which git ignores: `dataset.json`, `analysis.json`, `labels-cache.json`, `history.jsonl` (your scored drafts), `playbook.json` and `settings.json`.

## About

Built by Robin van Veen at [Arcgent](https://arcgent.ai). We help companies become AI-native, one process at a time. Also from Arcgent: [LinkedIn ICP Sorter](https://github.com/Arcgent/linkedin-icp-sorter), which sorts your LinkedIn connections into Warm, Maybe warm, Cold and Not relevant.

**Want to know how Arcgent can help your company become AI-native?** [Book a 30-minute call](https://cal.com/robin-van-veen-x9jhid/30min).

## License

MIT
