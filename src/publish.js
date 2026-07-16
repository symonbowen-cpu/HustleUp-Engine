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

async function graph(endpoint, params) {
  const url = new URL(`${GRAPH}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { method: "POST" });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`Graph API error on ${endpoint}: ${JSON.stringify(data.error || data)}`);
  }
  return data;
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

  const imageUrl =
    process.env.IMAGE_PUBLIC_URL ||
    `https://raw.githubusercontent.com/${process.env.GITHUB_REPOSITORY}/${process.env.GITHUB_SHA || "main"}/out/pending/post.png`;

  console.log(`📸 Image URL: ${imageUrl}`);
  console.log(`📝 Caption preview: ${post.caption.slice(0, 80)}...`);

  // 1. create media container
  const container = await graph(`${IG_USER_ID}/media`, {
    image_url: imageUrl,
    caption: post.caption,
    access_token: IG_ACCESS_TOKEN,
  });
  console.log(`✅ Container created: ${container.id}`);

  // 2. wait for Instagram to process the image
  await sleep(8000);

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
  fs.renameSync(path.join(PENDING, "post.png"), path.join(PUBLISHED, `${stamp}.png`));
  post.publishedAt = new Date().toISOString();
  post.mediaId = published.id;
  saveJSON(path.join(PUBLISHED, `${stamp}.json`), post);
  fs.unlinkSync(postPath);

  console.log(`📁 Archived to out/published/${stamp}.*`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
