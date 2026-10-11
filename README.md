# Pixelbrowser

The 128bit family's window to the internet. A fast, private, pixel-styled
browser that turns browsing into quests, streaks, and XP. The web, but
chunkier. Part of the 128bit family.

> **Status:** a Comet-style AI browser for desktop ([`apps/desktop`](apps/desktop))
> and phone ([`apps/mobile`](apps/mobile)). It works with any AI the user picks,
> has an agent that can click and type on pages, and syncs between devices
> with end-to-end encryption. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for
> what's done and what's next.
>
> ```bash
> npm install
> npm test              # shared AI + sync tests
> npm run desktop       # desktop browser
> npm run sync-server   # local sync server on :8787
> npm run mobile        # phone app (Expo)
> ```

## Concept (starter — Daniel decides)

A browser with two jobs:

1. **Browse fast and private.** A real browser engine under a chunky pixel
   UI: pixel tab bar with grouping and session restore, built-in tracker
   and ad blocking, sane cookie controls, a read-later list with a clean
   reading mode. Private by default — no creepy ad profiles.
2. **Browsing, gamified.** XP for deep reads, streaks for daily check-ins,
   tab quests ("close 5 stale tabs", "finish 3 read-later articles").
   Pixelbrowser emits browsing events into the shared 128bit feed —
   128bitlife issues the quests, the browser keeps the record.

## Architecture — real engine, pixel shell

```
src/
  engine/      # The actual web renderer. Platform call comes first:
               # mobile via WKWebView / Android WebView to match the
               # 128bit family, or a Chromium-based desktop shell.
               # Daniel picks the platform; Carlos picks the engine.
  tabs/        # Pixel tab bar: tab CRUD, grouping, session restore,
               # tab quests and tab-hoarder stats.
  privacy/     # Tracker + ad block lists, cookie controls, private
               # pixel mode. Block lists update like a quest pack.
  reader/      # Read-later list, reading-mode renderer, pixel
               # progress bars per article.
  gamify/      # XP + streaks for browsing habits. Emits events only —
               # 128bitlife owns the quest and XP logic.
  events.ts    # 128bit shared event schema — emit tab.opened,
               # article.finished, readlater.cleared, streak.milestone,
               # etc. 128bitlife subscribes for quests + XP.
```

Rules:
- **Privacy by default.** Blocking on, tracking off, private mode real.
- **Gamify the habit, not the addiction.** No dark patterns, no infinite
  scroll tricks — the XP rewards finishing, not lingering.
- **It's still a browser.** Fast, stable, and correct come before the
  pixel chrome. A quest is worthless on a crashing tab.
- **Local-first history.** Browsing history is personal; sync is opt-in,
  never required.
- Never store raw credentials in the repo.

## Start-here brief for Claude

```
We're building Pixelbrowser — the 128bit family's pixel-styled browser:
fast, private, gamified browsing. Read this README first.

Build order:
1. Platform call (ask Daniel): mobile WebView app to match the 128bit
   family, or Chromium-based desktop shell? Engine choice follows.
2. src/engine/ — minimal working browser: address bar, navigation,
   one tab that renders real pages. Correct before cute.
3. src/tabs/ — pixel tab bar: CRUD, grouping, session restore.
4. src/privacy/ — tracker/ad block lists, cookie controls, private mode.
5. src/reader/ — read-later list + reading mode with progress bars.
6. src/events.ts — shared 128bit event schema; emit tab.opened,
   article.finished. (Check sibling repos for the schema stub.)
7. src/gamify/ — XP + streak hooks on the events; 128bitlife issues
   the quests, this side only emits.

Constraints: privacy by default, local-first history, gamify finishing
not lingering. Small commits. Never commit credentials.
```

## 128bit tie-in

Pixelbrowser is the family's window: `article.finished`,
`readlater.cleared`, and `streak.milestone` events flow into the shared
feed so 128bitlife can issue browsing quests and XP. It also reads the
feed — quest packs from 128bitlife ("finish 3 articles today") land as
tab quests. Don't silo the data.

## Monetization (family default)

128bit Pro bundle covers Pixelbrowser. Core browsing — tabs, privacy,
reader — is free forever. Cosmetic IAPs (pixel themes, tab-bar skins)
like the rest of the family; advanced stats (reading streaks, yearly
"web in pixels") can sit behind Pro later.
