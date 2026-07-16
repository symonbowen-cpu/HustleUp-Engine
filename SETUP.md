# HustleUp Content Engine — Setup Guide

One-time setup: about 30–45 minutes. After that, the engine runs itself every day.

---

## Part 1 — Instagram & Meta

### 1. Set up your HustleUp Instagram account
1. Create account with handle **@hustleupapp** in the Instagram app
2. Fill out profile: rocket emoji as avatar, bio from themes.json, link to hustleup.us
3. **Profile → Settings → Account type and tools → Switch to professional account → Business**

### 2. Choose your route

| | Route A: No Facebook Page | Route B: Facebook Page linked |
|---|---|---|
| API host | `graph.instagram.com` | `graph.facebook.com` (default) |
| Token life | ~60 days (auto-refresh workflow included) | **Never expires** (System User) |
| Extra setup | One GitHub PAT for token refresh | Create + link a Facebook Page |

**Route B is recommended** — set it up once and it never expires.

---

#### Route B (Facebook Page — never-expiring token)

1. Create a Facebook Page named "HustleUp" at facebook.com/pages/create
2. In Instagram: **Settings → Business tools → Connect a Facebook Page** → select it
3. Go to **developers.facebook.com** → My Apps → **Create App** → Business type
4. In the app, add the **Instagram Graph API** product
5. Go to **business.facebook.com → Settings → System Users**
6. Create a system user (Admin role)
7. Click **Add Assets** → assign your Facebook Page and app
8. Click **Generate New Token** → select your app → expiration: **Never** → check:
   - `instagram_basic`
   - `instagram_content_publish`
   - `pages_show_list`
   - `pages_read_engagement`
9. Copy the token — this is your **IG_ACCESS_TOKEN**

#### Get your Instagram User ID
In Graph API Explorer (developers.facebook.com/tools/explorer):
```
GET me/accounts → copy your Page's "id"
GET {page-id}?fields=instagram_business_account
```
The number under `instagram_business_account.id` is your **IG_USER_ID**.

---

## Part 2 — GitHub Setup

### 1. Create the repo
Create a **public** repo named `hustleup-content-engine`.

> Must be public so Instagram can fetch the image from raw.githubusercontent.com.
> If you want it private, copy post.png to your Vercel /public folder and set IMAGE_PUBLIC_URL.

```bash
cd hustleup-content-engine
git init && git add -A && git commit -m "content engine v1"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/hustleup-content-engine.git
git push -u origin main
```

### 2. Add secrets
Repo → **Settings → Secrets and variables → Actions → Secrets**:

| Secret | Value |
|---|---|
| `ANTHROPIC_API_KEY` | From console.anthropic.com |
| `IG_USER_ID` | From Part 1 |
| `IG_ACCESS_TOKEN` | From Part 1 |

### 3. Set mode variable
Repo → **Settings → Secrets and variables → Actions → Variables**:

| Variable | Value |
|---|---|
| `AUTO_PUBLISH` | `false` to start (approval mode) |

Set to `true` when you're ready for full autonomy.

### 4. Test it
1. Repo → **Actions** tab → **Daily Instagram Post** → **Run workflow**
2. In approval mode: a GitHub issue opens with the image preview and caption
3. Comment `/approve` → publishes to Instagram and closes the issue
4. Comment `/skip` → discards the draft
5. Install **GitHub mobile app** — get push notifications and approve from your phone in 5 seconds

---

## Daily Operation

| Mode | What happens at 9 AM PT |
|---|---|
| Approval (`AUTO_PUBLISH=false`) | Generates post → GitHub issue → you comment `/approve` or `/skip` |
| Full auto (`AUTO_PUBLISH=true`) | Generates and publishes. You do nothing. |

---

## Customizing

**Content pillars and topics:** Edit `content/themes.json`
- Add/remove topics in any pillar
- Adjust the brand voice line
- Add hashtags to the bank

**Card designs:** Edit `templates/*.html`
- Colors use CSS variables in `templates/_base.html`
- All cards are 1080x1080px

**Posting schedule:** Edit the cron in `.github/workflows/daily-post.yml`
- Daily: `0 16 * * *` (9am PT)
- 3x/week: `0 16 * * 1,3,5`

**Test locally:**
```bash
npm install
npm run generate:dry   # canned copy, no API call
npm run generate       # real Claude generation (needs ANTHROPIC_API_KEY in .env)
```

---

## Costs
- GitHub Actions: free tier covers this easily (~2 min/day)
- Claude API: one small call per day — a few cents per month
- Instagram API: free

## Troubleshooting

**Publish fails with "media not ready"** — retry loop handles it; if not, check the repo is public and raw URL opens in incognito.

**Token expired** — use System User token (never expires) or check the refresh-token workflow.

**Image looks wrong locally** — install Chrome first; Puppeteer downloads Chromium automatically but needs system dependencies on Linux.
