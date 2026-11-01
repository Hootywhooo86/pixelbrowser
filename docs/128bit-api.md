# 128bit accounts API (v1)

What a 128bit server needs to do so that Bit Browser, 128bitlife, BitCaller and 128bittracker can share one account, XP, streaks and quests. Bit Browser's client is `apps/mobile/src/family128.js`. Until a server exists, the app shows "coming soon".

## Basics
- Base URL: e.g. `https://api.128bit.example`. HTTPS only.
- JSON in and out (`Content-Type: application/json`).
- Every request sends `X-Client: bitbrowser` (or the app's name).
- Signed-in requests send `Authorization: Bearer <token>`.
- Errors look like `{ "error": "Plain-language message" }`. The app shows the message, so it should be short and readable.
- Status codes:
  - `400` bad input
  - `401` token missing, expired or revoked: the app signs the user out
  - `404` not found
  - `429` rate limited: send `Retry-After`
  - `5xx` server trouble

## Sign-in (email code, no passwords)

### `POST /v1/auth/start`
```json
{ "email": "you@example.com", "app": "bitbrowser" }
```
Emails a 6-digit code that's valid for 10 minutes.
- Response `200`: `{ "challengeId": "c_01H…" }`
- Always answer `200`, even for unknown emails, to avoid revealing who has an account. Create the account on first verify.
- Rate limits: 5 per email per hour, 20 per IP per hour.

### `POST /v1/auth/verify`
```json
{ "challengeId": "c_01H…", "code": "123456", "device": { "app": "bitbrowser", "id": "<device uuid>", "name": "Phone" } }
```
- Response `200`:
```json
{ "token": "<opaque, 256-bit random>", "account": { "id": "u_…", "email": "you@example.com", "name": "Dan" } }
```
- Allow 5 wrong codes per challenge, then expire it.
- Tokens are per device and long-lived (rolling 180 days). Store only a hash.

### `DELETE /v1/auth/session`
Signs this device out by revoking the token. Response `204`.

## Events (what the apps share)

### `POST /v1/events`
```json
{ "events": [
  { "v": 1, "type": "quest.completed", "app": "bitbrowser", "at": "2026-11-01T18:00:00Z", "deviceId": "…", "data": { "quest": "block1000", "xp": 50 } }
] }
```
- Up to 100 events per request. Response `200`: `{ "accepted": 100 }`.
- Event types Bit Browser sends, and only if the user turned each one on (`apps/mobile/src/events.js`):

| Type | `data` |
|---|---|
| `tab.opened` | `{}` (a count only, never the address) |
| `article.finished` | `{ site, seconds }` |
| `readlater.cleared` | `{ count }` |
| `streak.milestone` | `{ days }` |
| `tabs.cleaned` | `{ count }` |
| `quest.completed` | `{ quest, xp }` |

- Rules for the server:
  - Ignore unknown types; don't reject them.
  - Deduplicate on `(deviceId, type, at)`.
  - Never require page addresses; Bit Browser won't send them.
- Rate limit: 60 requests per hour per token.

## Progress

### `GET /v1/me/progress`
```json
{
  "xp": 1240,
  "level": 5,
  "streak": 6,
  "badges": [{ "id": "trackers1000", "label": "1,000 Trackers Squashed", "at": "2026-10-30T…" }],
  "quests": [{ "id": "family-read-10", "title": "Family: read 10 articles this week", "progress": 7, "goal": 10, "done": false, "xp": 100 }]
}
```
- The server owns family-wide XP and quests.
- The app keeps its own local XP too, and shows the server's numbers in the 128bit account screen.

## Account

| Endpoint | Does |
|---|---|
| `GET /v1/me` | `{ id, email, name, family: { id, name, members: [{ id, name, role }] } }` |
| `PATCH /v1/me` | `{ name }` |
| `DELETE /v1/me` | Deletes the account and all events (privacy law requires this) |

## Family groups (optional, later)

| Endpoint | Does |
|---|---|
| `POST /v1/family` | `{ name }` creates a family; the caller becomes its owner |
| `POST /v1/family/invite` | `{ email }` invites someone by email |
| `POST /v1/family/join` | `{ inviteCode }` joins a family |

Family sharing of bookmarks and passwords does **not** go through this API: it uses end-to-end encrypted share chains on the sync server (`packages/sync-core/src/sharing.js`). That keeps the 128bit server unable to read them.

## Privacy rules
- Store only the email address, the account name and opted-in events.
- Delete events older than 13 months.
- Encrypt data at rest. Keep no IP logs beyond 30 days for abuse protection.
- Document all of this in the 128bit privacy policy, alongside `docs/PRIVACY.md`.

## Build notes
Any small stack works:
- Node or Go
- Postgres
- an email provider (Postmark, Resend or SES)
- hosting on Fly.io or Render, like the sync server

Point the apps at it in Settings → 128bit family → "Testing your own 128bit server?" (stored as `state.family.server`).
