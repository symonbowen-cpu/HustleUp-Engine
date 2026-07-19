/**
 * reel.js — renders an animated 9:16 reel (MP4 with music + SFX) from the
 * reel templates in templates/reels/.
 *
 * How it works:
 *   1. Builds the animated HTML (CSS keyframe timeline, declarative beats).
 *   2. Captures deterministic frames by seeking the animation clock
 *      (window.__seek) and screenshotting each frame with Puppeteer.
 *   3. Assembles frames + a bundled royalty-free music track + sound effects
 *      (synced to each animation beat) into an H.264 MP4 via ffmpeg.
 *   4. Emits a small preview.gif for the GitHub approval issue.
 *
 * All music/SFX in assets/ are synthesized originals (tools/make-audio.js) —
 * no licensing constraints for API publishing.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const puppeteer = require("puppeteer");
const { ROOT, buildHTML } = require("./lib");

const REEL_TEMPLATES = path.join(ROOT, "templates", "reels");
const MUSIC_DIR = path.join(ROOT, "assets", "music");
const SFX_DIR = path.join(ROOT, "assets", "sfx");
const FPS = 30;

const SFX_GAIN = { "whoosh-up": 0.4, "whoosh-down": 0.4, pop: 0.55, ding: 0.5, tick: 0.5, riser: 0.4 };

function pickMusic(seed) {
  const tracks = fs.readdirSync(MUSIC_DIR).filter((f) => /\.(m4a|mp3|wav)$/.test(f)).sort();
  if (!tracks.length) throw new Error("No music tracks in assets/music/");
  return path.join(MUSIC_DIR, tracks[seed % tracks.length]);
}

async function captureFrames(templateName, data, framesDir) {
  const html = buildHTML(templateName, data, REEL_TEMPLATES);
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--force-color-profile=srgb"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);

    const timeline = await page.evaluate(() => window.__timeline());
    const totalFrames = Math.round((timeline.duration / 1000) * FPS);

    for (let f = 0; f < totalFrames; f++) {
      const t = (f / FPS) * 1000;
      await page.evaluate((ms) => window.__seek(ms), t);
      await page.screenshot({
        path: path.join(framesDir, `f${String(f).padStart(5, "0")}.jpg`),
        type: "jpeg",
        quality: 92,
      });
      if (f % 60 === 0) console.log(`  frame ${f}/${totalFrames}`);
    }
    return timeline;
  } finally {
    await browser.close();
  }
}

function assemble(framesDir, timeline, musicPath, outPath) {
  const durSec = timeline.duration / 1000;
  const sfx = timeline.sfx.filter((e) => fs.existsSync(path.join(SFX_DIR, `${e.s}.wav`)));

  const args = ["-y", "-loglevel", "error",
    "-framerate", String(FPS), "-i", path.join(framesDir, "f%05d.jpg"),
    "-i", musicPath];
  sfx.forEach((e) => args.push("-i", path.join(SFX_DIR, `${e.s}.wav`)));

  const parts = [];
  parts.push(`[1:a]volume=0.7,afade=t=out:st=${(durSec - 1.2).toFixed(2)}:d=1.2[m]`);
  sfx.forEach((e, i) => {
    const g = SFX_GAIN[e.s] ?? 0.5;
    parts.push(`[${i + 2}:a]volume=${g},adelay=${Math.round(e.t)}|${Math.round(e.t)}[s${i}]`);
  });
  const mixIn = ["[m]", ...sfx.map((_, i) => `[s${i}]`)].join("");
  parts.push(`${mixIn}amix=inputs=${sfx.length + 1}:normalize=0[aout]`);

  args.push(
    "-filter_complex", parts.join(";"),
    "-map", "0:v", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k",
    "-t", durSec.toFixed(2),
    "-movflags", "+faststart",
    outPath
  );
  execFileSync("ffmpeg", args, { stdio: "inherit" });
}

function makePreviewGif(mp4Path, gifPath) {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", mp4Path,
    "-vf", "fps=8,scale=300:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer",
    gifPath]);
}

/**
 * Renders a full reel. Returns { videoPath, gifPath, durationSec, music }.
 */
async function renderReel(templateName, data, outDir, seed = 0) {
  const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-frames-"));
  try {
    console.log(`🎬 Rendering reel (${templateName})...`);
    const timeline = await captureFrames(templateName, data, framesDir);

    const musicPath = pickMusic(seed);
    console.log(`🎵 Music: ${path.basename(musicPath)} | SFX beats: ${timeline.sfx.length}`);

    const videoPath = path.join(outDir, "post.mp4");
    assemble(framesDir, timeline, musicPath, videoPath);

    const gifPath = path.join(outDir, "preview.gif");
    makePreviewGif(videoPath, gifPath);

    return {
      videoPath, gifPath,
      durationSec: timeline.duration / 1000,
      music: path.basename(musicPath),
    };
  } finally {
    fs.rmSync(framesDir, { recursive: true, force: true });
  }
}

module.exports = { renderReel };
