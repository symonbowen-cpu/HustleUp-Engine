/**
 * make-audio.js — synthesizes the engine's royalty-free music + SFX library.
 * All audio is generated from scratch (oscillators + noise), so HustleUp
 * owns it outright. Run once: node tools/make-audio.js
 * Outputs WAVs, then encode to .m4a with ffmpeg (see bottom console output).
 */

const fs = require("fs");
const path = require("path");

const SR = 44100;

// ── WAV writer (16-bit stereo) ──
function writeWav(file, L, R) {
  const n = L.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), 44 + i * 4);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), 46 + i * 4);
  }
  fs.writeFileSync(file, buf);
}

// ── tiny DSP toolkit ──
const TWO_PI = Math.PI * 2;
function makeNoise() { let s = 22222; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s / 0x3fffffff) - 1; }; }
function onePoleLP() { let y = 0; return (x, cutoff) => { const a = Math.min(1, TWO_PI * cutoff / SR); y += a * (x - y); return y; }; }
function onePoleHP() { const lp = onePoleLP(); return (x, cutoff) => x - lp(x, cutoff); }

const NOTES = {}; // name -> freq
{
  const names = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  for (let oct = 0; oct <= 7; oct++) names.forEach((nm, i) => {
    NOTES[nm + oct] = 440 * Math.pow(2, (oct * 12 + i - 57) / 12);
  });
}

// ── instruments (render into L/R at sample offset) ──
function kick(L, R, at, len = 0.28, gain = 0.9) {
  const s0 = Math.round(at * SR), n = Math.round(len * SR);
  for (let i = 0; i < n && s0 + i < L.length; i++) {
    const t = i / SR;
    const f = 42 + 110 * Math.exp(-t * 34);
    const env = Math.exp(-t * 13);
    const click = i < 60 ? (1 - i / 60) * 0.5 : 0;
    const v = (Math.sin(TWO_PI * f * t * (1 + 0.5 * Math.exp(-t * 60))) * env + click) * gain;
    L[s0 + i] += v; R[s0 + i] += v;
  }
}

function snare(L, R, at, gain = 0.5) {
  const s0 = Math.round(at * SR), n = Math.round(0.22 * SR);
  const nz = makeNoise(), hp = onePoleHP();
  for (let i = 0; i < n && s0 + i < L.length; i++) {
    const t = i / SR;
    const env = Math.exp(-t * 22);
    const body = Math.sin(TWO_PI * 190 * t) * Math.exp(-t * 40) * 0.6;
    const v = (hp(nz(), 1800) * env + body) * gain;
    L[s0 + i] += v * 0.95; R[s0 + i] += v;
  }
}

function hat(L, R, at, open = false, gain = 0.22) {
  const s0 = Math.round(at * SR), n = Math.round((open ? 0.20 : 0.05) * SR);
  const nz = makeNoise(), hp = onePoleHP();
  for (let i = 0; i < n && s0 + i < L.length; i++) {
    const t = i / SR;
    const env = Math.exp(-t * (open ? 28 : 90));
    const v = hp(nz(), 7000) * env * gain;
    L[s0 + i] += v * (0.8 + 0.2 * Math.sin(at)); R[s0 + i] += v;
  }
}

function bass(L, R, at, freq, len, gain = 0.42) {
  const s0 = Math.round(at * SR), n = Math.round(len * SR);
  const lp = onePoleLP();
  let ph = 0;
  for (let i = 0; i < n && s0 + i < L.length; i++) {
    const t = i / SR;
    ph += freq / SR;
    const saw = 2 * (ph % 1) - 1;
    const sq = Math.sign(Math.sin(TWO_PI * freq * t * 0.5)) * 0.3;
    const env = Math.min(1, t * 120) * Math.exp(-t * 3.2);
    const cutoff = 180 + 900 * Math.exp(-t * 6);
    const v = lp(saw * 0.8 + sq * 0.2, cutoff) * env * gain;
    L[s0 + i] += v; R[s0 + i] += v;
  }
}

function stab(L, R, at, freqs, len, gain = 0.16) {
  const s0 = Math.round(at * SR), n = Math.round(len * SR);
  const lpL = onePoleLP(), lpR = onePoleLP();
  const phs = freqs.flatMap((f) => [ { f: f * 0.997, p: 0 }, { f: f * 1.003, p: 0.3 } ]);
  for (let i = 0; i < n && s0 + i < L.length; i++) {
    const t = i / SR;
    let vl = 0, vr = 0;
    phs.forEach((o, k) => {
      o.p += o.f / SR;
      const saw = 2 * (o.p % 1) - 1;
      if (k % 2) vl += saw; else vr += saw;
    });
    const env = Math.min(1, t * 200) * Math.exp(-t * 5.5);
    const cutoff = 500 + 2600 * Math.exp(-t * 7);
    L[s0 + i] += lpL(vl / phs.length, cutoff) * env * gain * 2;
    R[s0 + i] += lpR(vr / phs.length, cutoff) * env * gain * 2;
  }
}

function pluck(L, R, at, freq, gain = 0.13, pan = 0) {
  const s0 = Math.round(at * SR), n = Math.round(0.24 * SR);
  for (let i = 0; i < n && s0 + i < L.length; i++) {
    const t = i / SR;
    const tri = Math.asin(Math.sin(TWO_PI * freq * t)) * (2 / Math.PI);
    const shimmer = Math.sin(TWO_PI * freq * 2 * t) * 0.25;
    const env = Math.min(1, t * 400) * Math.exp(-t * 16);
    const v = (tri + shimmer) * env * gain;
    L[s0 + i] += v * (1 - Math.max(0, pan)); R[s0 + i] += v * (1 + Math.min(0, pan));
  }
}

// ── sidechain duck + master ──
function duck(L, R, beatTimes, depth = 0.45, rel = 0.18) {
  for (let i = 0; i < L.length; i++) {
    const t = i / SR;
    let g = 1;
    for (const bt of beatTimes) {
      const dt = t - bt;
      if (dt >= 0 && dt < rel) g = Math.min(g, 1 - depth * (1 - dt / rel));
    }
    L[i] *= g; R[i] *= g;
  }
}

function master(L, R, fadeIn = 0.05, fadeOut = 1.0) {
  const n = L.length;
  for (let i = 0; i < n; i++) {
    const t = i / SR, tEnd = (n - i) / SR;
    let g = 1;
    if (t < fadeIn) g *= t / fadeIn;
    if (tEnd < fadeOut) g *= tEnd / fadeOut;
    // soft clip
    L[i] = Math.tanh(L[i] * 1.4) * 0.85 * g;
    R[i] = Math.tanh(R[i] * 1.4) * 0.85 * g;
  }
}

// ── track builder ──
// prog: array of bars; each bar = { root: "A1", chord: ["A2","C3","E3"], penta: [...] }
function buildTrack(file, { bpm, bars, prog, halfTimeSnare = false, arp = true }) {
  const beat = 60 / bpm;
  const totalSec = bars * 4 * beat + 1.2;
  const N = Math.round(totalSec * SR);
  const L = new Float64Array(N), Rr = new Float64Array(N);
  const kicks = [];

  for (let bar = 0; bar < bars; bar++) {
    const t0 = bar * 4 * beat;
    const ch = prog[bar % prog.length];
    const rootF = NOTES[ch.root];
    const chordF = ch.chord.map((x) => NOTES[x]);
    const penta = ch.penta.map((x) => NOTES[x]);

    for (let b = 0; b < 4; b++) {
      const bt = t0 + b * beat;
      kick(L, Rr, bt); kicks.push(bt);
      hat(L, Rr, bt + beat / 2, b === 3);           // offbeat hats, open on 4th
      if (halfTimeSnare ? b === 2 : (b === 1 || b === 3)) snare(L, Rr, bt);
      for (let s = 0; s < 4; s++) if (s % 2 === 1) hat(L, Rr, bt + (s * beat) / 4, false, 0.09);
      // bass: root 8ths with octave hop
      bass(L, Rr, bt, rootF * (b === 3 ? 2 : 1), beat * 0.9);
      bass(L, Rr, bt + beat / 2, rootF, beat * 0.45, 0.3);
    }
    // chord stabs: syncopated
    [0, 1.5, 2.5, 3.5].forEach((pos) => stab(L, Rr, t0 + pos * beat, chordF, beat * 0.9));
    // arp plucks on 16ths (sparse pattern)
    if (arp) {
      const pat = [0, 3, 5, 7, 8, 11, 13, 14];
      pat.forEach((s, i) =>
        pluck(L, Rr, t0 + (s * beat) / 4, penta[i % penta.length], 0.11, i % 2 ? 0.5 : -0.5)
      );
    }
  }

  duck(L, Rr, kicks);
  master(L, Rr);
  writeWav(file, L, Rr);
  console.log(`♪ ${path.basename(file)} — ${totalSec.toFixed(1)}s @ ${bpm}bpm`);
}

// ── SFX ──
function sfxWhoosh(file, dir = 1) { // dir 1 = up, -1 = down
  const len = 0.5, N = Math.round(len * SR);
  const L = new Float64Array(N), R = new Float64Array(N);
  const nz = makeNoise(); const lp = onePoleLP(); const hp = onePoleHP();
  for (let i = 0; i < N; i++) {
    const t = i / SR, x = t / len;
    const sweep = dir > 0 ? 300 + 4800 * x * x : 4200 - 3900 * x * x + 300;
    const env = Math.sin(Math.PI * Math.min(1, x * 1.15)) ** 1.5;
    const v = lp(hp(nz(), sweep * 0.5), sweep) * env * 0.7;
    const p = (x - 0.5) * dir;
    L[i] = v * (1 - p * 0.6); R[i] = v * (1 + p * 0.6);
  }
  writeWav(file, L, R); console.log(`✦ ${path.basename(file)}`);
}

function sfxPop(file) {
  const len = 0.16, N = Math.round(len * SR);
  const L = new Float64Array(N), R = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const f = 300 + 500 * Math.exp(-t * 90);
    const env = Math.exp(-t * 42);
    const click = i < 40 ? (1 - i / 40) * 0.4 : 0;
    const v = (Math.sin(TWO_PI * f * t) * env + click) * 0.8;
    L[i] = v; R[i] = v;
  }
  writeWav(file, L, R); console.log(`✦ ${path.basename(file)}`);
}

function sfxDing(file) {
  const len = 0.7, N = Math.round(len * SR);
  const L = new Float64Array(N), R = new Float64Array(N);
  const f0 = NOTES["A5"];
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const env = Math.exp(-t * 6);
    const v = (Math.sin(TWO_PI * f0 * t) + Math.sin(TWO_PI * f0 * 2.01 * t) * 0.4 + Math.sin(TWO_PI * f0 * 2.99 * t) * 0.18) * env * 0.35;
    L[i] = v * 0.9; R[i] = v;
  }
  writeWav(file, L, R); console.log(`✦ ${path.basename(file)}`);
}

function sfxTick(file) {
  const len = 0.05, N = Math.round(len * SR);
  const L = new Float64Array(N), R = new Float64Array(N);
  const nz = makeNoise(); const hp = onePoleHP();
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const v = hp(nz(), 3500) * Math.exp(-t * 160) * 0.5 + Math.sin(TWO_PI * 1200 * t) * Math.exp(-t * 200) * 0.3;
    L[i] = v; R[i] = v;
  }
  writeWav(file, L, R); console.log(`✦ ${path.basename(file)}`);
}

function sfxRiser(file) {
  const len = 1.2, N = Math.round(len * SR);
  const L = new Float64Array(N), R = new Float64Array(N);
  const nz = makeNoise(); const lp = onePoleLP();
  for (let i = 0; i < N; i++) {
    const t = i / SR, x = t / len;
    const f = 120 * Math.pow(2, x * 3);
    const tone = Math.sin(TWO_PI * f * t) * 0.25;
    const wind = lp(nz(), 800 + 5000 * x) * 0.4;
    const env = x ** 1.4;
    const v = (tone + wind) * env * 0.7;
    L[i] = v * (1 - 0.3 * x); R[i] = v;
  }
  writeWav(file, L, R); console.log(`✦ ${path.basename(file)}`);
}

// ── generate library ──
const MUSIC = path.join(__dirname, "..", "assets", "music");
const SFX = path.join(__dirname, "..", "assets", "sfx");
fs.mkdirSync(MUSIC, { recursive: true });
fs.mkdirSync(SFX, { recursive: true });

// Track 1: "Momentum" — 124bpm, A minor, driving
buildTrack(path.join(MUSIC, "momentum.wav"), {
  bpm: 124, bars: 8,
  prog: [
    { root: "A1", chord: ["A2","C3","E3","A3"], penta: ["A4","C5","D5","E5","G5"] },
    { root: "F1", chord: ["F2","A2","C3","F3"], penta: ["F4","A4","C5","D5","F5"] },
    { root: "C2", chord: ["C3","E3","G3","C4"], penta: ["C5","D5","E5","G5","A5"] },
    { root: "G1", chord: ["G2","B2","D3","G3"], penta: ["G4","B4","D5","E5","G5"] },
  ],
});

// Track 2: "Hype" — 100bpm halftime, D minor, heavier
buildTrack(path.join(MUSIC, "hype.wav"), {
  bpm: 100, bars: 6, halfTimeSnare: true,
  prog: [
    { root: "D1", chord: ["D2","F2","A2","D3"], penta: ["D4","F4","G4","A4","C5"] },
    { root: "A#1", chord: ["A#1","D2","F2","A#2"], penta: ["A#3","D4","F4","G4","A#4"] },
    { root: "F1", chord: ["F2","A2","C3","F3"], penta: ["F4","G4","A4","C5","D5"] },
    { root: "C2", chord: ["C2","E2","G2","C3"], penta: ["C4","D4","E4","G4","A4"] },
  ],
});

// Track 3: "Spark" — 132bpm, E minor, bright
buildTrack(path.join(MUSIC, "spark.wav"), {
  bpm: 132, bars: 8,
  prog: [
    { root: "E2", chord: ["E3","G3","B3","E4"], penta: ["E5","G5","A5","B5","D6"] },
    { root: "C2", chord: ["C3","E3","G3","C4"], penta: ["C5","D5","E5","G5","A5"] },
    { root: "G1", chord: ["G2","B2","D3","G3"], penta: ["G4","A4","B4","D5","E5"] },
    { root: "D2", chord: ["D3","F#3","A3","D4"], penta: ["D5","E5","F#5","A5","B5"] },
  ],
});

// SFX
sfxWhoosh(path.join(SFX, "whoosh-up.wav"), 1);
sfxWhoosh(path.join(SFX, "whoosh-down.wav"), -1);
sfxPop(path.join(SFX, "pop.wav"));
sfxDing(path.join(SFX, "ding.wav"));
sfxTick(path.join(SFX, "tick.wav"));
sfxRiser(path.join(SFX, "riser.wav"));

console.log("\nDone. Encode music to m4a for the repo:");
console.log('for f in assets/music/*.wav; do ffmpeg -y -i "$f" -c:a aac -b:a 160k "${f%.wav}.m4a"; done');
