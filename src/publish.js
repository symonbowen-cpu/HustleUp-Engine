/**
 * publish.js — publishes out/pending/post.png to Instagram via the Graph API.
 * Run ONLY after the pending image has been committed and pushed to GitHub,
 * because Instagram fetches the image from a public raw.githubusercontent.com URL.
 *
 * Env:
 *   IG_USER_ID        — Instagram Business Account ID (numeric)
 *   IG_ACCESS_TOKEN   — long-lived / system-user token with instagram_content_publish
 *   GITHUB_REPOSITORY — owner/repo (set automatically in Actions)
 *   GITHUB_SHA        — commit sha of the pushed image (set in workflow after push)
 *   IMAGE_PUBLIC_URL  — optional override URL
 *   IG_GRAPH_HOST     — graph.instagram.com (Route A) or graph.facebook.com (Route B, default)
 */

const fs = require("fs");
const path = require("path");
const { PENDING, PUBLISHED, loadJSON, saveJSON } = require("./lib");

const HOST = process.env.IG_GRAPH_HOST || "graph.facebook.com";
const GRAPH = `https://${HOST}/v21.0`;

async function graph(endpoint, params, method = "POST") {
  const url = new URL(`${GRAPH}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { method });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`Graph API error on ${endpoint}: ${JSON.stringify(data.error || data)}`);
  }
  return data;
}

/** Poll a video container until Instagram finishes processing it. */
async function waitForContainer(containerId, token, timeoutMs = 5 * 60 * 1000) {
  const started = Date.now();
  for (;;) {
    const { status_code } = await graph(containerId, {
      fields: "status_code",
      access_token: token,
    }, "GET");
    if (status_code === "FINISHED") return;
    if (status_code === "ERROR" || status_code === "EXPIRED") {
      throw new Error(`Container ${containerId} processing failed: ${status_code}`);
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Container ${containerId} still ${status_code} after ${timeoutMs / 1000}s`);
    }
    console.log(`  processing... (${status_code})`);
    await sleep(10000);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { IG_USER_ID, IG_ACCESS_TOKEN } = process.env;
  if (!IG_USER_ID || !IG_ACCESS_TOKEN) {
    throw new Error("Missing IG_USER_ID or IG_ACCESS_TOKEN");
  }

  const postPath = path.join(PENDING, "post.json");
  if (!fs.existsSync(postPath)) throw new Error("No pending post found in out/pending/");
  const post = loadJSON(postPath);

  const isReel = post.format === "reel";
  const mediaFile = isReel ? "post.mp4" : "post.png";
  const mediaUrl =
    (isReel ? process.env.VIDEO_PUBLIC_URL : process.env.IMAGE_PUBLIC_URL) ||
    `https://raw.githubusercontent.com/${process.env.GITHUB_REPOSITORY}/${process.env.GITHUB_SHA || "main"}/out/pending/${mediaFile}`;

  console.log(`${isReel ? "🎬 Video" : "📸 Image"} URL: ${mediaUrl}`);
  console.log(`📝 Caption preview: ${post.caption.slice(0, 80)}...`);

  // 1. create media container
  const container = await graph(`${IG_USER_ID}/media`, isReel
    ? {
        media_type: "REELS",
        video_url: mediaUrl,
        caption: post.caption,
        share_to_feed: "true",
        access_token: IG_ACCESS_TOKEN,
      }
    : {
        image_url: mediaUrl,
        caption: post.caption,
        access_token: IG_ACCESS_TOKEN,
      });
  console.log(`✅ Container created: ${container.id}`);

  // 2. wait for Instagram to process the media
  if (isReel) {
    await waitForContainer(container.id, IG_ACCESS_TOKEN);
  } else {
    await sleep(8000);
  }

  // 3. publish with retries
  let published;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      published = await graph(`${IG_USER_ID}/media_publish`, {
        creation_id: container.id,
        access_token: IG_ACCESS_TOKEN,
      });
      break;
    } catch (e) {
      if (attempt === 4) throw e;
      console.log(`Attempt ${attempt} not ready, retrying in 10s...`);
      await sleep(10000);
    }
  }
  console.log(`🚀 Published! Media ID: ${published.id}`);

  // 4. archive
  const stamp = new Date().toISOString().slice(0, 10);
  fs.mkdirSync(PUBLISHED, { recursive: true });
  const ext = isReel ? "mp4" : "png";
  fs.renameSync(path.join(PENDING, mediaFile), path.join(PUBLISHED, `${stamp}.${ext}`));
  for (const extra of ["preview.gif"]) {
    const p = path.join(PENDING, extra);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  post.publishedAt = new Date().toISOString();
  post.mediaId = published.id;
  saveJSON(path.join(PUBLISHED, `${stamp}.json`), post);
  fs.unlinkSync(postPath);

  console.log(`📁 Archived to out/published/${stamp}.*`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
