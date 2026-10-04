# GrokBot → ShadowData Intelligence Feed API

GrokBot publishes market intelligence into the ShadowData **Intelligence Feed**
(`https://shadowdata.oxfordhub.app/intel`). This file is the contract.

## Auth

Every request carries the feed key:

```
Authorization: Bearer <INTEL_FEED_API_KEY>
```

The key is stored as the `INTEL_FEED_API_KEY` variable on the ShadowData Railway
service. **Never commit it** — this repo is public. The key can create posts, edit
posts, and read the feed. It cannot delete anything or touch categories, tickers,
portfolios or anyone's saved folders (admins do that in the app at `/intel/admin`).

## Create posts — `POST /api/intel/posts`

Send one post object, `{ "posts": [ ... ] }`, or a bare array. Max 50 per request.

```json
{
  "posts": [
    {
      "title": "Required. Headline, max 300 chars",
      "summary": "1-3 sentence takeaway shown on the card (max 2000)",
      "body": "Full write-up, plain text. Blank lines = paragraphs. URLs auto-link. (max 50000)",
      "sourceUrl": "https://… original article / filing / post",
      "sourceName": "Publisher or site name",
      "imageUrl": "https://… optional",
      "tickers": ["NVDA", "AMD"],
      "categories": ["Earnings", "Supply Chain"],
      "externalId": "your stable id for this item",
      "publishedAt": "2026-10-04T13:30:00Z"
    }
  ]
}
```

Rules:
- `tickers`: US symbols, uppercase; a leading `$` is stripped. Invalid ones are dropped. Max 25.
- `categories`: names (or ids). Unknown names are created automatically — check
  `GET /api/intel/meta` first and reuse existing names so admins don't have to merge duplicates.
- **Dedup:** a post with an `externalId` or `sourceUrl` that already exists is skipped, not
  duplicated. Always send one of them so re-runs are safe.
- `publishedAt` defaults to now. The feed sorts newest `publishedAt` first.
- Plain text only. HTML/markdown is shown literally, not rendered.
- No price targets or buy/sell calls — ShadowData is decision-support only.

Response `201`:

```json
{ "created": [ { "id": "…", "title": "…" } ],
  "skipped": [ { "title": "…", "reason": "duplicate", "existingId": "…" } ] }
```

## Edit a post — `PATCH /api/intel/posts/:id`

Send only the fields to change (same names as above). `tickers` and `categories`
replace the existing lists.

## Read

- `GET /api/intel/meta` → `{ categories, tickers, portfolios }`
- `GET /api/intel/posts?ticker=NVDA,AMD&portfolio=<id>&category=<id>&q=<text>&limit=30&offset=0`
  → `{ posts, total }`
- `GET /api/intel/posts/:id` → `{ post }`

## Errors

`400` bad input · `401` missing/wrong key · `403` not allowed for this key · `404` not found.
Bodies are `{ "error": "message" }`.

## Example

```bash
curl -X POST https://shadowdata.oxfordhub.app/api/intel/posts \
  -H "Authorization: Bearer $INTEL_FEED_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title":"…","summary":"…","sourceUrl":"https://…","tickers":["NVDA"],"categories":["Earnings"]}'
```
