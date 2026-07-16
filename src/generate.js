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

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

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

  const prompt = `You write Instagram content for ${cfg.brand.name} (${cfg.brand.url}), an app that teaches teens 13-19 to make real money through side hustles. Price: ${cfg.brand.price} lifetime access.

Brand voice: ${cfg.brand.voice}

Today's content pillar: ${pillar.id}
Goal: ${pillar.goal}
Topic: ${topic}

Rules:
- Speak directly to teens OR parents depending on the pillar. Parent pillar = speak to parents. All others = speak to teens.
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
      hook: "3 dogs. $360 a month. Zero experience needed.",
      stat: "$360/mo",
      body: "Dog walking pays $15-25 per walk. Lock in 3 weekly clients and you have a real business before next week.",
      caption: "3 weekly dog walking clients = $360+ a month.\n\nNo experience. No startup cost. Just your neighborhood.\n\nHustleUp gives you the exact steps to find them, pitch them, and keep them.\n\nLink in bio 🐾",
      hashtags: ["#hustleup", "#teenentrepreneur", "#sidehustle", "#teenmoney", "#dogwalking", "#petservices", "#makemoneyasateen"],
      alt_text: "Dark background with orange accent showing pet services hustle earning $360 per month on HustleUp app.",
    },
    myth: {
      myth: "You need to be 18 to make real money.",
      fact: "Teens are already making hundreds per week.",
      body: "Dog walking, tutoring, content creation, reselling — none of these require you to be 18. They require you to start.",
      caption: "Nobody told us this at 16.\n\nYou don't need to be 18. You need a plan.\n\nHustleUp gives teens 8 real side hustle roadmaps with step-by-step guidance.\n\nhustleup.us",
      hashtags: ["#hustleup", "#teenentrepreneur", "#sidehustle", "#teenmoney", "#makemoneyasateen", "#youngentrepreneur"],
      alt_text: "Myth versus fact graphic on dark background: teens can make real money before age 18.",
    },
    tip: {
      eyebrow: "QUICK WIN",
      headline: "Find your first dog walking client today.",
      body: "Knock on 10 doors on your street. Say: 'Hi, I'm [name] from nearby. Dog walking from $15. Reliable and local.' Your first client is probably 3 houses away.",
      caption: "Your first client is closer than you think.\n\nKnock on 10 doors on your own street. Introduce yourself. Give your rate.\n\nMost teens get their first booking within a week of actually trying.\n\nhustleup.us",
      hashtags: ["#hustleup", "#sidehustle", "#teenmoney", "#teenentrepreneur", "#dogwalking", "#makemoneyasateen"],
      alt_text: "Quick win tip graphic on dark background about finding your first dog walking client.",
    },
    stat: {
      eyebrow: "DID YOU KNOW",
      stat: "54%",
      headline: "of teens say they want to start a business.",
      body: "Most never do because nobody gives them real steps. HustleUp fixes that.",
      caption: "More than half of teens want to be entrepreneurs.\n\nMost never start because nobody gives them a real roadmap.\n\nHustleUp changes that. 8 hustles. Step by step. AI coach included.\n\nhustleup.us",
      hashtags: ["#hustleup", "#teenentrepreneur", "#sidehustle", "#teenmoney", "#youngentrepreneur", "#makemoneyasateen"],
      alt_text: "Large orange statistic 54% on dark background about teens wanting to start businesses.",
    },
    feature: {
      eyebrow: "INSIDE HUSTLEUP",
      feature_name: "AI Coach",
      headline: "Your personal coach for every hustle.",
      body: "Every hustle has its own AI coach with a unique personality. Ask it anything — pricing, clients, first steps — and get real specific advice, not generic tips.",
      caption: "Imagine having a personal coach for your exact side hustle.\n\nThat's what HustleUp's AI coach does. Specific, actionable, always available.\n\nContent creator? Design? Dog walking? There's a coach for that.\n\nhustleup.us 🤖",
      hashtags: ["#hustleup", "#aicoach", "#teenentrepreneur", "#sidehustle", "#teenmoney", "#makemoneyonline"],
      alt_text: "HustleUp AI coach feature reveal on dark background with orange and purple accents.",
    },
    transformation: {
      before: "Bored, broke, asking parents for money.",
      after: "Earning $90 this weekend with 3 lawn clients.",
      body: "The only difference is a roadmap. HustleUp gives you every step from zero to first dollar, then from first dollar to real income.",
      caption: "This time last month you were bored.\n\nThis weekend you could be earning $90.\n\nHustleUp gives teens the exact roadmap to make it real.\n\nhustleup.us 🚀",
      hashtags: ["#hustleup", "#teenentrepreneur", "#sidehustle", "#teenmoney", "#transformation", "#makemoneyasateen"],
      alt_text: "Before and after transformation graphic on dark background showing teen going from broke to earning.",
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

// ── main ──
(async () => {
  const cfg = themes();
  const st = state();
  const { pillar, topic, tIdx } = pickTopic(cfg, st);

  console.log(`Pillar: ${pillar.id} | Topic: ${topic}`);
  const copy = await writeCopy(cfg, pillar, topic);

  // inject brand fields
  copy.handle = cfg.brand.handle;
  copy.url = cfg.brand.url;
  copy.tagline = cfg.brand.tagline;

  fs.mkdirSync(PENDING, { recursive: true });
  const imgPath = path.join(PENDING, "post.png");
  await renderPNG(pillar.template, copy, imgPath);

  const caption =
    `${copy.caption}\n\n` +
    `${(copy.hashtags || []).join(" ")}`;

  saveJSON(path.join(PENDING, "post.json"), {
    createdAt: new Date().toISOString(),
    pillar: pillar.id,
    template: pillar.template,
    topic,
    caption,
    alt_text: copy.alt_text || "",
    copy,
  });

  // advance rotation
  st.pillarIndex = (st.pillarIndex + 1) % cfg.pillars.length;
  st.topicIndexes[pillar.id] = tIdx + 1;
  st.postCount += 1;
  st.lastPosted = new Date().toISOString();
  saveState(st);

  console.log(`✅ Generated ${imgPath}`);
  console.log(`Caption preview:\n${caption.slice(0, 120)}...`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
