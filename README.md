# HustleUp Content Engine

Autonomous daily Instagram content for [hustleup.us](https://hustleup.us).

**How it works:** A GitHub Action runs daily → rotates through 7 content pillars → Claude writes copy in the HustleUp brand voice → Puppeteer renders a branded 1080x1080 card → post is either published straight to Instagram or sent to a GitHub issue for one-tap approval.

- Setup: see [SETUP.md](SETUP.md)
- Content & voice: `content/themes.json`
- Card designs: `templates/`
- Mode switch: repo variable `AUTO_PUBLISH` (`true` = fully autonomous)

```
daily cron ─► generate.js ─► commit image ─► AUTO_PUBLISH?
                                              ├─ true  ─► publish.js ─► Instagram
                                              └─ false ─► GitHub issue ─► /approve ─► Instagram
```

## Content Pillars (7 rotating)

1. **hustle_spotlight** — showcases one hustle with earning potential
2. **myth_bust** — busts a common teen money myth
3. **quick_win** — one actionable tip teens can use this week
4. **stat** — a motivating statistic about teen entrepreneurship
5. **parent_pitch** — speaks to parents about HustleUp's value
6. **feature_reveal** — showcases an app feature
7. **transformation** — before/after of using HustleUp

## Commands

```bash
npm run generate        # Generate today's post with Claude
npm run generate:dry    # Test run with canned copy (no API call)
npm run publish:ig      # Publish pending post to Instagram
```
