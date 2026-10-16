# HN Digest

A fast, beautiful Hacker News front-page reader with glanceable AI digests.

Live: **https://hn-digest.ramanduke.workers.dev**

## What it does

- Shows the current HN top 30 stories
- Each card includes rank, title, domain, points, comments, author, age, and a glanceable AI digest (one-line takeaway + up to 2 short bullets)
- Light/dark theme, mobile-friendly

## Architecture

Designed for the Cloudflare Workers **free plan** (~10 ms CPU / request, tight KV write quota):

| Piece | Role |
| --- | --- |
| **Worker** `hn-digest` | Serves the static UI + JSON API |
| **KV** `hn-digest-cache` | Caches frontpage + per-story summaries |
| **Workers AI** | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` for summaries |
| **Cron** `0 */6 * * *` | Refreshes HN list every 6 hours and summarizes a few new stories per run |
| **Page visits** | Read KV only — never wait on AI or article fetches |

Designed to stay under the Workers **free-tier KV write limit** (1,000 puts/day): cron is infrequent, the unused `meta` key is not written, frontpage is written once when the cache is warm (early write only if empty), and unchanged id/score/summary-status snapshots are skipped.

### Refresh flow

1. Cron (or `GET /api/refresh?key=…`) pulls top story IDs from the [HN Firebase API](https://github.com/HackerNews/API).
2. If the frontpage cache is empty, story metadata is written to KV immediately; otherwise the write waits until the end of the run (and is skipped if ids/scores/summary statuses are unchanged).
3. Up to `SUMMARIES_PER_RUN` (default 3) pending stories are processed:
   - Article HTML is fetched with a size cap; text is extracted via **HTMLRewriter** (no heavy DOM parsers).
   - Ask/Show/text posts use the post body.
   - If the article is blocked/paywalled/PDF, fall back to title + top comments, or mark **Summary unavailable**.
4. Summaries are cached by story id and reused across refreshes.

### API

| Endpoint | Description |
| --- | --- |
| `GET /api/stories` | Cached frontpage JSON |
| `GET /api/health` | Counts (ready / pending / unavailable) |
| `GET\|POST /api/refresh?key=ADMIN_SECRET` | Trigger a refresh (protected) |

## Local development

```bash
npm install
npm test
npx wrangler dev
```

Set secrets in `.dev.vars`:

```
ADMIN_SECRET=dev-secret
```

## Deploy / CI

GitHub Actions (`.github/workflows/ci.yml`):

1. On PR and push to `main`: install, test, typecheck
2. On push to `main`: `wrangler deploy` via `cloudflare/wrangler-action@v3`

Required repo secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Worker secret (set once):

```bash
echo "$ADMIN_SECRET" | npx wrangler secret put ADMIN_SECRET
```

## Config (`wrangler.toml`)

- Cron — `0 */6 * * *` (every 6 hours; keep sparse on free-tier KV)
- `AI_MODEL` — Workers AI model id
- `TOP_N` — stories to keep (≤ 30)
- `SUMMARIES_PER_RUN` — max new summaries per cron/admin refresh (keep small on free plan)

## License

MIT
