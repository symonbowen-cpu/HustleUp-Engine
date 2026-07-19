# HustleUp Content Engine

Autonomous daily Instagram + Facebook content for [hustleup.us](https://hustleup.us).

**Audience: parents of teens.** Parents are the buyer — every post speaks to
them (their teen is the subject). Facebook is where most parents are, so one
approval publishes to both the Instagram account and the Facebook Page.

**How it works:** A GitHub Action runs daily → rotates through 7 content pillars → Claude writes parent-focused copy in the HustleUp brand voice → Puppeteer renders a branded card (1080x1080 image, or a 12s animated reel on reel days) → the post is either published straight to both platforms or sent to a GitHub issue for one-tap approval.

- Setup: see [SETUP.md](SETUP.md)
- Content & voice: `content/themes.json`
- Card designs: `templates/` (static) and `templates/reels/` (animated)
- Mode switch: repo variable `AUTO_PUBLISH` (`true` = fully autonomous)

```
daily cron ─► generate.js ─► commit media ─► AUTO_PUBLISH?
                                              ├─ true  ─► publish.js ─► Instagram + Facebook
                                              └─ false ─► GitHub issue ─► /approve ─► Instagram + Facebook
```

## Content Pillars (7 rotating, all parent-facing)

1. **hustle_spotlight** — one hustle their teen could run: earnings, speed, skills
2. **myth_bust** — busts a myth parents believe about teens and money
3. **parent_win** — one concrete step to help their teen start this week
4. **stat** — a statistic that reframes what their teen is capable of
5. **confidence** — before/after: bored scroller → confident earner
6. **feature_reveal** — why the app is safe, structured, and worth $19.99 once
7. **gift_angle** — the smartest $19.99 vs games and subscriptions

## Commands

```bash
npm run generate           # Generate today's post with Claude
npm run generate:dry       # Test run with canned copy (no API call)
npm run generate:reel      # Force reel format (video)
npm run generate:reel:dry  # Test reel with canned copy
npm run publish:ig         # Publish pending post to Instagram
npm run make:audio         # Regenerate the music/SFX library
```

## Reels

Reels run **daily** by default (`reels.days` in `content/themes.json` — remove
days there to bring back static-image days). Each run renders a 12-second
animated 9:16 video. Manual runs (Actions → Run workflow) have a **format**
dropdown to force a reel or a static post for that run:

- Animated versions of every template (staggered text, count-up stats, CTA pulse)
  live in `templates/reels/`. Beats are declared in the markup via
  `data-fx` / `data-at` / `data-sfx` attributes.
- Music and sound effects are synthesized originals in `assets/` (regenerate
  with `npm run make:audio`) — fully owned, safe for API publishing.
- Frames are captured deterministically with Puppeteer and assembled with
  ffmpeg (preinstalled on GitHub runners) into `out/pending/post.mp4`,
  plus a `preview.gif` embedded in the approval issue.
- Publishing uses the Graph API `REELS` media type and polls the container
  until Instagram finishes processing. If Instagram ever rejects the
  raw.githubusercontent.com video URL, set `VIDEO_PUBLIC_URL` (e.g. enable
  GitHub Pages on the repo and use the pages URL, which serves video/mp4).
