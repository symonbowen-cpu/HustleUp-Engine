/**
 * generate.js — creates today's HustleUp Instagram post (image + caption).
 * Does NOT publish. Publishing is a separate step (src/publish.js).
 *
 * Env:
 *   ANTHROPIC_API_KEY  — required unless DRY_RUN=1
 *   DRY_RUN=1          — skip Claude call, use canned copy (for testing)
 */

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const { PENDING, themes, state, saveState, saveJSON, buildHTML } = require("./lib");
const { renderReel } = require("./reel");

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

// ── format decision: reel days vs static days ──
// Config: themes.json "reels": { "days": [1,3,5] }  (0=Sun ... 6=Sat, LA time)
// Override with FORMAT=reel|static for testing.
function decideFormat(cfg) {
  if (process.env.FORMAT === "reel" || process.env.FORMAT === "static") return process.env.FORMAT;
  const reelDays = cfg.reels?.days ?? [1, 3, 5]; // Mon/Wed/Fri
  const laDay = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })).getDay();
  return reelDays.includes(laDay) ? "reel" : "static";
}

// ── pillar rotation ──
function pickTopic(cfg, st) {
  const pillar = cfg.pillars[st.pillarIndex % cfg.pillars.length];
  const tIdx = st.topicIndexes[pillar.id] || 0;
  const topic = pillar.topics[tIdx % pillar.topics.length];
  return { pillar, topic, tIdx };
}

// ── copy schemas per template ──
const SCHEMAS = {
  spotlight: `{
    "hustle": "hustle name e.g. Pet Services",
    "emoji": "single emoji for this hustle",
    "earning": "earning range e.g. $360/month",
    "timeToFirst": "time to first dollar e.g. 3-7 days",
    "hook": "one line max 9 words that stops the scroll",
    "stat": "the money number or key stat, bold and short",
    "body": "2 sentences max 200 chars. Specific and actionable.",
    "caption": "3-4 short lines. Hook first. Real numbers. Soft CTA last.",
    "hashtags": ["..."],
    "alt_text": "one sentence describing the image"
  }`,
  myth: `{
    "myth": "the myth teens/parents believe, max 8 words, first person",
    "fact": "the correction, max 10 words, punchy",
    "body": "1-2 sentences expanding the fact, max 200 chars",
    "caption": "3-4 short lines. Hook first. End with soft CTA.",
    "hashtags": ["..."],
    "alt_text": "one sentence describing the image"
  }`,
  tip: `{
    "eyebrow": "2-4 word label uppercase e.g. QUICK WIN or PRO TIP",
    "headline": "max 9 words, punchy actionable tip",
    "body": "1-2 sentences, max 220 chars, specific steps only",
    "caption": "3-4 short lines. Hook first. One concrete takeaway. Soft CTA last.",
    "hashtags": ["..."],
    "alt_text": "one sentence describing the image"
  }`,
  stat: `{
    "eyebrow": "2-4 word label e.g. DID YOU KNOW",
    "stat": "the number itself e.g. 72% or 1 in 3 — max 6 chars",
    "headline": "max 10 words completing the stat",
    "body": "1 sentence of context, max 180 chars",
    "caption": "3-4 short lines. Hook first. Make the stat feel urgent. Soft CTA last.",
    "hashtags": ["..."],
    "alt_text": "one sentence describing the image"
  }`,
  feature: `{
    "eyebrow": "2-4 word label e.g. INSIDE HUSTLEUP",
    "feature_name": "name of the feature, 2-4 words",
    "headline": "max 9 words about what this feature does for you",
    "body": "1-2 sentences, max 200 chars, make it sound exciting",
    "caption": "3-4 short lines. Hook first. Make them want to try it. Soft CTA last.",
    "hashtags": ["..."],
    "alt_text": "one sentence describing the image"
  }`,
  transformation: `{
    "before": "the before state, max 6 words, relatable",
    "after": "the after state, max 6 words, aspirational",
    "body": "2 sentences max 200 chars. Make the transformation feel real and achievable.",
    "caption": "3-4 short lines. Hook first. Emotional but grounded. Soft CTA last.",
    "hashtags": ["..."],
    "alt_text": "one sentence describing the image"
  }`
};

// ── copywriting via Claude ──
async function writeCopy(cfg, pillar, topic) {
  if (process.env.DRY_RUN === "1") return cannedCopy(pillar);

  const prompt = `You write social media content (Instagram + Facebook) for ${cfg.brand.name} (${cfg.brand.url}), an app that teaches teens 13-19 to make real money through side hustles. Price: ${cfg.brand.price} lifetime access.

Brand voice: ${cfg.brand.voice}

Today's content pillar: ${pillar.id}
Goal: ${pillar.goal}
Topic: ${topic}

Rules:
- ALWAYS speak directly to PARENTS of teens. Parents are the buyer. The teen is the subject of the content, never the audience. Say "your teen", not "you", when describing who does the hustle.
- Tap real parent emotions: pride, worry about screen time, wanting their kid to have direction and confidence. Never guilt-trip or bash teens.
- caption: 3-5 short lines. Hook first line. One concrete takeaway. End with a soft CTA from these options: ${cfg.brand.cta_options.join(", ")}. Max 1-2 emojis. Never use em dashes.
- hashtags: pick 8-12 from this bank plus 2-3 topical ones: ${cfg.hashtag_bank.join(" ")}
- alt_text: one sentence describing the image for accessibility.
- Never invent fake statistics. Only use real, widely-cited figures.
- Always be specific — real numbers, real timelines, real steps.
- Respond with ONLY a JSON object, no markdown, no backticks, matching exactly:
${SCHEMAS[pillar.template]}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1200,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// ── canned copy for dry run testing ──
function cannedCopy(pillar) {
  const canned = {
    spotlight: {
      hustle: "Pet Services",
      emoji: "🐾",
      earning: "$360/month",
      timeToFirst: "3-7 days",
      hook: "3 dogs. $360 a month. A teen who shows up.",
      stat: "$360/mo",
      body: "Dog walking pays $15-25 per walk. With 3 weekly clients, your teen runs a real little business — and learns reliability no chore chart can teach.",
      caption: "3 dog walking clients = $360+ a month for your teen.\n\nNo startup cost. Just your neighborhood and a plan.\n\nHustleUp walks them through finding clients, pitching, and keeping them.\n\nGive them a head start → hustleup.us 🐾",
      hashtags: ["#hustleup", "#parentingteens", "#raisingteens", "#lifeskills", "#teenmoney", "#raisingentrepreneurs", "#momsofteens"],
      alt_text: "Dark background with orange accent showing pet services hustle earning 360 dollars per month on HustleUp app.",
    },
    myth: {
      myth: "My teen is too young to earn real money.",
      fact: "Teens are already earning hundreds per week.",
      body: "Dog walking, tutoring, reselling, content — teens are doing all of it today. They don't need to be 18. They need structure and a first step.",
      caption: "It's not too early.\n\nTeens across the country are earning real money with simple hustles — and learning more than any allowance teaches.\n\nHustleUp gives your teen the structure to start safely.\n\nSee how it works → hustleup.us",
      hashtags: ["#hustleup", "#parentingteens", "#raisingteens", "#moneyskills", "#financialliteracy", "#raisingentrepreneurs"],
      alt_text: "Myth versus fact graphic on dark background: teens can earn real money before age 18.",
    },
    tip: {
      eyebrow: "PARENT PLAYBOOK",
      headline: "Turn 'I'm bored' into their first paying client.",
      body: "Next time your teen says they're bored, offer a deal: walk 10 houses together, introduce them to neighbors with pets. Most teens land their first dog walking client within a week.",
      caption: "'I'm bored' is an opening, not a complaint.\n\nWalk your street together. Ten doors. Most teens land a first client within a week.\n\nHustleUp gives them the exact script so you don't have to.\n\nStart them today → hustleup.us",
      hashtags: ["#hustleup", "#parentingteens", "#parentinghacks", "#raisingteens", "#lifeskills", "#momsofteens"],
      alt_text: "Parent playbook tip graphic on dark background about helping your teen find their first client.",
    },
    stat: {
      eyebrow: "DID YOU KNOW",
      stat: "54%",
      headline: "of teens say they want to start a business.",
      body: "Most never do — not from lack of drive, but because nobody hands them real steps. That's the gap HustleUp fills.",
      caption: "More than half of teens want to build something of their own.\n\nMost never start because nobody gives them a roadmap.\n\nHustleUp turns that ambition into a first client, step by step.\n\nGive them a head start → hustleup.us",
      hashtags: ["#hustleup", "#parentingteens", "#raisingentrepreneurs", "#teenconfidence", "#futureready", "#momsofteens"],
      alt_text: "Large orange statistic 54 percent on dark background about teens wanting to start businesses.",
    },
    feature: {
      eyebrow: "INSIDE HUSTLEUP",
      feature_name: "AI Coach",
      headline: "The mentor for questions teens won't ask you.",
      body: "Every hustle has its own AI coach. Your teen asks about pricing, nerves, first clients — and gets specific, age-appropriate guidance any hour of the day.",
      caption: "Teens don't always want advice from mom or dad. They still need it.\n\nHustleUp's AI coach answers the questions they won't ask you — pricing, clients, confidence.\n\nOne $19.99 payment. Lifetime access. No subscription.\n\nSee how it works → hustleup.us 🤖",
      hashtags: ["#hustleup", "#parentingteens", "#aicoach", "#raisingteens", "#lifeskills", "#futureready"],
      alt_text: "HustleUp AI coach feature reveal on dark background with orange and purple accents.",
    },
    transformation: {
      before: "Scrolling all weekend, asking for money.",
      after: "Earning $90 a weekend with 3 lawn clients.",
      body: "Same kid. The difference is a roadmap. HustleUp turns 'I'm bored' into first clients, first earnings, and a teen who walks taller.",
      caption: "Same kid. Different weekend.\n\nWhen a teen earns their first $90, something changes — and you'll see it in how they carry themselves.\n\nHustleUp gives them the roadmap from bored to booked.\n\nGive them a head start → hustleup.us 🚀",
      hashtags: ["#hustleup", "#parentingteens", "#teenconfidence", "#raisingteens", "#lifeskills", "#parentingwin"],
      alt_text: "Before and after transformation graphic on dark background showing a teen going from scrolling to earning.",
    },
  };
  return canned[pillar.template];
}

// ── render PNG via Puppeteer ──
async function renderPNG(templateName, data, outPath) {
  const html = buildHTML(templateName, data);
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--force-color-profile=srgb"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: outPath, type: "png" });
  } finally {
    await browser.close();
  }
}

// ── render 9:16 story PNG (vertical reel template, final frame) ──
// A 1:1 image zoomed into the story frame crops both sides; this renders a
// true 1080x1920 version so stories always fit the frame.
async function renderStoryPNG(templateName, data, outPath) {
  const REELS = path.join(__dirname, "..", "templates", "reels");
  const html = buildHTML(templateName, data, REELS);
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--force-color-profile=srgb"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);
    // jump the animation timeline to its settled end state
    await page.evaluate(() => window.__seek(11000));
    await page.screenshot({ path: outPath, type: "png" });
  } finally {
    await browser.close();
  }
}

// ── main ──
(async () => {
  const cfg = themes();
  const st = state();
  const { pillar, topic, tIdx } = pickTopic(cfg, st);
  const format = decideFormat(cfg);

  console.log(`Pillar: ${pillar.id} | Topic: ${topic} | Format: ${format}`);
  const copy = await writeCopy(cfg, pillar, topic);

  // inject brand fields
  copy.handle = cfg.brand.handle;
  copy.url = cfg.brand.url;
  copy.tagline = cfg.brand.tagline;

  // clean pending dir so a reel never ships alongside a stale image (or vice versa)
  fs.rmSync(PENDING, { recursive: true, force: true });
  fs.mkdirSync(PENDING, { recursive: true });

  let media = {};
  if (format === "reel") {
    const reel = await renderReel(pillar.template, copy, PENDING, st.postCount);
    media = { video: "post.mp4", preview: "preview.gif", durationSec: reel.durationSec, music: reel.music };
  } else {
    const imgPath = path.join(PENDING, "post.png");
    await renderPNG(pillar.template, copy, imgPath);
    const storyPath = path.join(PENDING, "story.png");
    await renderStoryPNG(pillar.template, copy, storyPath);
    media = { image: "post.png", story: "story.png" };
  }

  const caption =
    `${copy.caption}\n\n` +
    `${(copy.hashtags || []).join(" ")}`;

  saveJSON(path.join(PENDING, "post.json"), {
    createdAt: new Date().toISOString(),
    format,
    pillar: pillar.id,
    template: pillar.template,
    topic,
    caption,
    alt_text: copy.alt_text || "",
    media,
    copy,
  });

  // advance rotation
  st.pillarIndex = (st.pillarIndex + 1) % cfg.pillars.length;
  st.topicIndexes[pillar.id] = tIdx + 1;
  st.postCount += 1;
  st.lastPosted = new Date().toISOString();
  saveState(st);

  console.log(`✅ Generated ${format === "reel" ? path.join(PENDING, "post.mp4") : path.join(PENDING, "post.png")}`);
  console.log(`Caption preview:\n${caption.slice(0, 120)}...`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
