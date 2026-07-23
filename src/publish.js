/**
 * publish.js — publishes out/pending/post.png to Instagram via the Graph API.
 * Run ONLY after the pending image has been committed and pushed to GitHub,
 * because Instagram fetches the image from a public raw.githubusercontent.com URL.
 *
 * Env:
 *   IG_USER_ID           — Instagram Business Account ID (numeric)
 *   IG_ACCESS_TOKEN      — long-lived / system-user token with instagram_content_publish
 *   FB_PAGE_ID           — Facebook Page ID (numeric)
 *   FB_PAGE_ACCESS_TOKEN — Page access token with pages_manage_posts
 *   GITHUB_REPOSITORY    — owner/repo (set automatically in Actions)
 *   GITHUB_SHA           — commit sha of the pushed media (set in workflow after push)
 *   IMAGE_PUBLIC_URL     — optional override URL (static posts)
 *   VIDEO_PUBLIC_URL     — optional override URL (reels)
 *   IG_GRAPH_HOST        — graph.instagram.com (Route A) or graph.facebook.com (Route B, default)
 *   STORY_ENABLED        — set to "false" to skip the Instagram Story ride-along
 *
 * Publishes to every platform whose credentials are present (one approval,
 * all angles). A platform with missing secrets is skipped with a log line.
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

// ── Instagram ──
async function publishInstagram(post, mediaUrl, isReel) {
  const { IG_USER_ID, IG_ACCESS_TOKEN } = process.env;

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
  console.log(`  IG container created: ${container.id}`);

  // 2. wait for Instagram to process the media
  if (isReel) {
    await waitForContainer(container.id, IG_ACCESS_TOKEN);
  } else {
    await sleep(8000);
  }

  // 3. publish with retries
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const published = await graph(`${IG_USER_ID}/media_publish`, {
        creation_id: container.id,
        access_token: IG_ACCESS_TOKEN,
      });
      return published.id;
    } catch (e) {
      if (attempt === 4) throw e;
      console.log(`  IG attempt ${attempt} not ready, retrying in 10s...`);
      await sleep(10000);
    }
  }
}

// ── Instagram Story (same media, posted right after the feed publish) ──
async function publishInstagramStory(mediaUrl, isReel) {
  const { IG_USER_ID, IG_ACCESS_TOKEN } = process.env;
  const container = await graph(`${IG_USER_ID}/media`, isReel
    ? { media_type: "STORIES", video_url: mediaUrl, access_token: IG_ACCESS_TOKEN }
    : { media_type: "STORIES", image_url: mediaUrl, access_token: IG_ACCESS_TOKEN });
  console.log(`  IG story container created: ${container.id}`);

  if (isReel) {
    await waitForContainer(container.id, IG_ACCESS_TOKEN);
  } else {
    await sleep(8000);
  }

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const published = await graph(`${IG_USER_ID}/media_publish`, {
        creation_id: container.id,
        access_token: IG_ACCESS_TOKEN,
      });
      return published.id;
    } catch (e) {
      if (attempt === 4) throw e;
      console.log(`  IG story attempt ${attempt} not ready, retrying in 10s...`);
      await sleep(10000);
    }
  }
}

// ── Facebook Page ──
async function publishFacebook(post, mediaUrl, isReel) {
  const { FB_PAGE_ID, FB_PAGE_ACCESS_TOKEN } = process.env;
  if (isReel) {
    // post the video to the Page (Facebook processes it async after the call)
    const res = await graph(`${FB_PAGE_ID}/videos`, {
      file_url: mediaUrl,
      description: post.caption,
      access_token: FB_PAGE_ACCESS_TOKEN,
    });
    return res.id;
  }
  const res = await graph(`${FB_PAGE_ID}/photos`, {
    url: mediaUrl,
    message: post.caption,
    access_token: FB_PAGE_ACCESS_TOKEN,
  });
  return res.post_id || res.id;
}

(async () => {
  const hasIG = !!(process.env.IG_USER_ID && process.env.IG_ACCESS_TOKEN);
  const hasFB = !!(process.env.FB_PAGE_ID && process.env.FB_PAGE_ACCESS_TOKEN);
  if (!hasIG && !hasFB) {
    throw new Error("No platform credentials: set IG_USER_ID/IG_ACCESS_TOKEN and/or FB_PAGE_ID/FB_PAGE_ACCESS_TOKEN");
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

  const results = {};
  const failures = [];

  if (hasIG) {
    try {
      console.log("📱 Publishing to Instagram...");
      results.instagram = await publishInstagram(post, mediaUrl, isReel);
      console.log(`✅ Instagram published: ${results.instagram}`);
    } catch (e) {
      failures.push(`Instagram: ${e.message}`);
      console.error(`❌ Instagram failed: ${e.message}`);
    }

    // story ride-along: only after a successful feed publish, and a story
    // failure is a warning, not a failed run. Reels are already 9:16; static
    // posts use the dedicated vertical story.png so nothing gets cropped.
    if (results.instagram && process.env.STORY_ENABLED !== "false") {
      try {
        const storyFile = isReel ? "post.mp4" : (post.media?.story || "post.png");
        const storyUrl = mediaUrl.replace(/[^/]+$/, storyFile);
        console.log(`📖 Posting to Instagram Story (${storyFile})...`);
        results.instagram_story = await publishInstagramStory(storyUrl, isReel);
        console.log(`✅ Story posted: ${results.instagram_story}`);
      } catch (e) {
        failures.push(`Instagram story: ${e.message}`);
        console.error(`⚠️ Story failed (feed post is live): ${e.message}`);
      }
    }
  } else {
    console.log("⏭️ Instagram skipped (no IG_USER_ID/IG_ACCESS_TOKEN)");
  }

  if (hasFB) {
    try {
      console.log("📘 Publishing to Facebook Page...");
      results.facebook = await publishFacebook(post, mediaUrl, isReel);
      console.log(`✅ Facebook published: ${results.facebook}`);
    } catch (e) {
      failures.push(`Facebook: ${e.message}`);
      console.error(`❌ Facebook failed: ${e.message}`);
    }
  } else {
    console.log("⏭️ Facebook skipped (no FB_PAGE_ID/FB_PAGE_ACCESS_TOKEN)");
  }

  if (Object.keys(results).length === 0) {
    throw new Error(`All platforms failed:\n${failures.join("\n")}`);
  }

  // archive (runs when at least one platform succeeded)
  const stamp = new Date().toISOString().slice(0, 10);
  fs.mkdirSync(PUBLISHED, { recursive: true });
  const ext = isReel ? "mp4" : "png";
  fs.renameSync(path.join(PENDING, mediaFile), path.join(PUBLISHED, `${stamp}.${ext}`));
  for (const extra of ["preview.gif", "story.png"]) {
    const p = path.join(PENDING, extra);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  post.publishedAt = new Date().toISOString();
  post.published = results;
  if (failures.length) post.publishFailures = failures;
  saveJSON(path.join(PUBLISHED, `${stamp}.json`), post);
  fs.unlinkSync(postPath);

  console.log(`📁 Archived to out/published/${stamp}.*`);
  if (failures.length) {
    console.log(`⚠️ Partial publish — failed: ${failures.join("; ")}`);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
