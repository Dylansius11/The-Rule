import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const scratch = path.join(root, "scratch/sfx");
const candidatesDir = path.join(scratch, "candidates");
const outputDir = path.join(root, "apps/web/public/sfx");
const brief =
  "Warm tactile hand-inked paper world, playful and understated, close and dry, no music, no voices, no reverb, never harsh, no arcade or casino sounds. ";
const sounds = {
  tap: [0.5, "One very short soft fingertip tick on thick paper."],
  toggle: [0.5, "One small soft wooden toggle click with a touch of paper."],
  open: [0.7, "A small paper envelope opening with a gentle rustle."],
  close: [0.6, "A small paper envelope closing with a soft papery tap."],
  whoosh: [0.7, "A quick soft swish of a paper sheet moving past."],
  page: [0.7, "One quick turn of a thick paper notebook page."],
  stamp: [
    0.7,
    "One heavy rubber stamp thunk on thick paper atop a wooden desk.",
  ],
  yes: [
    0.9,
    "A bright gentle two-note wooden marimba-like ding followed by a tiny paper flutter.",
  ],
  no: [
    0.7,
    "One dull soft felt thud on paper, sympathetic and quiet, not a buzzer.",
  ],
  duplicate: [
    0.7,
    "Two lightly muted taps of a wooden clerk stamp on paper, matter-of-fact.",
  ],
  pending: [
    0.7,
    "A soft single ink bottle cork plop and a tiny paper rustle, anticipatory.",
  ],
  refund: [
    0.8,
    "A soft paper slip sliding back across a wooden desk and a muted tick.",
  ],
  error: [
    0.7,
    "A gentle low wooden knock and soft paper rustle, not an alarm.",
  ],
  seal: [
    1.0,
    "Brittle wax seal cracking once, followed by a soft paper unfold.",
  ],
  "replay-pass": [
    0.9,
    "Two warm wooden chime notes and a quiet paper tick, reassuring.",
  ],
  "replay-fail": [
    0.8,
    "A muted low wooden chime and a soft paper tap, restrained.",
  ],
  mint: [
    0.6,
    "One small bright delicate coin-like clink on a wooden desk, not a jackpot.",
  ],
  blot: [0.6, "A tiny cute squishy rubber squeak, like a small wax mascot."],
  success: [
    0.8,
    "A cheerful soft wooden two-note chime and a paper slip landing.",
  ],
};
const outputFormat = "mp3_44100_64";
const influence = 0.55;
const manifestPath = path.join(scratch, "manifest.json");
let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  manifest = {
    outputFormat,
    promptInfluence: influence,
    loop: false,
    requests: 0,
    ffmpeg: false,
    sounds: {},
  };
}
if (
  manifest.outputFormat !== outputFormat ||
  manifest.promptInfluence !== influence
)
  throw new Error(
    "Existing manifest parameters differ; archive it before starting a new run",
  );
const ffmpeg =
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
manifest.ffmpeg = ffmpeg;
await mkdir(candidatesDir, { recursive: true });
await mkdir(outputDir, { recursive: true });
const env = await readFile(path.join(root, ".env"), "utf8");
const match = env.match(
  /^\s*(?:export\s+)?ELEVEN_LABS_API_KEY\s*=\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s#]+))/m,
);
const key = match?.[1] ?? match?.[2] ?? match?.[3];
if (!key) throw new Error("ELEVEN_LABS_API_KEY is missing from the root .env");

function runFfmpeg(args) {
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", ...args],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.status !== 0)
    throw new Error("ffmpeg failed while processing audio");
  return result.stdout;
}
function inspect(file) {
  const bytes = runFfmpeg([
    "-i",
    file,
    "-ac",
    "1",
    "-ar",
    "44100",
    "-f",
    "f32le",
    "-",
  ]);
  const count = bytes.length / 4;
  let peak = 0,
    first = count,
    last = 0,
    clipped = 0,
    previous = 0;
  for (let i = 0; i < count; i++) {
    const sample = bytes.readFloatLE(i * 4);
    const amplitude = Math.abs(sample);
    peak = Math.max(peak, amplitude);
    if (amplitude >= 0.005) {
      first = Math.min(first, i);
      last = i;
    }
    // MP3 decoding can overshoot full scale without clipping; repeated full-scale
    // samples are evidence of a flattened waveform, not merely codec overshoot.
    if (amplitude >= 0.999 && sample === previous) clipped++;
    previous = sample;
  }
  return {
    duration: count / 44100,
    onset: first / 44100,
    end: last / 44100,
    peak,
    clipped,
  };
}
function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
async function save() {
  await writeFile(
    path.join(scratch, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  const sections = Object.entries(manifest.sounds)
    .map(
      ([name, sound]) =>
        `<section><h2>${escapeHtml(name)}</h2><p>${escapeHtml(sound.prompt)}</p><p>Target: ${sound.durationSeconds}s; chosen: ${sound.chosen ?? "not selected"}</p>${sound.candidates.map((c) => `<div><strong>Candidate ${c.number}${c.number === sound.chosen ? " — CHOSEN" : ""}</strong><br><audio controls preload="none" src="candidates/${name}-${c.number}.mp3"></audio></div>`).join("")}</section>`,
    )
    .join("\n");
  await writeFile(
    path.join(scratch, "audition.html"),
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>THE RULE sound audition</title><style>body{font:16px system-ui;background:#fffbea;color:#141210;max-width:850px;margin:2rem auto;padding:0 1rem}section{border-top:2px solid;padding:1rem 0}audio{max-width:100%}section div{margin:1rem 0}</style><h1>THE RULE sound audition</h1><p>Generated candidates. CHOSEN marks the objective selection; listen and request swaps.</p>${sections}</html>`,
  );
}
try {
  for (const [name, [duration, detail]] of Object.entries(sounds)) {
    const sound = manifest.sounds[name] ?? {
      prompt: brief + detail,
      durationSeconds: duration,
      candidates: [],
      chosen: null,
    };
    if (sound.prompt !== brief + detail || sound.durationSeconds !== duration)
      throw new Error(
        `Existing ${name} prompt differs; archive the manifest before starting a new run`,
      );
    manifest.sounds[name] = sound;
    if (sound.chosen) continue;
    for (let number = sound.candidates.length + 1; number <= 3; number++) {
      if (manifest.requests >= 70) throw new Error("Request cap reached");
      manifest.requests++;
      const response = await fetch(
        `https://api.elevenlabs.io/v1/sound-generation?output_format=${outputFormat}`,
        {
          method: "POST",
          headers: { "xi-api-key": key, "content-type": "application/json" },
          body: JSON.stringify({
            text: sound.prompt,
            duration_seconds: duration,
            prompt_influence: influence,
            loop: false,
          }),
        },
      );
      if (!response.ok)
        throw new Error(
          `Sound generation stopped at ${name} candidate ${number}: HTTP ${response.status}`,
        );
      const file = path.join(candidatesDir, `${name}-${number}.mp3`);
      await writeFile(file, Buffer.from(await response.arrayBuffer()));
      const candidate = { number, file: `candidates/${name}-${number}.mp3` };
      if (ffmpeg) candidate.measurements = inspect(file);
      sound.candidates.push(candidate);
      await save();
    }
    if (ffmpeg) {
      for (const candidate of sound.candidates)
        candidate.measurements = inspect(path.join(scratch, candidate.file));
      const valid = sound.candidates.filter(
        (c) =>
          c.measurements.peak > 0.005 &&
          c.measurements.clipped === 0 &&
          c.measurements.end > c.measurements.onset &&
          c.measurements.duration <= duration + 0.15,
      );
      if (!valid.length)
        throw new Error(
          `No usable candidates for ${name}; inspect audition files`,
        );
      valid.sort(
        (a, b) =>
          a.measurements.onset - b.measurements.onset ||
          b.measurements.peak - a.measurements.peak,
      );
      const chosen = valid[0];
      const m = chosen.measurements;
      const start = Math.max(0, m.onset - 0.002);
      const end = Math.min(m.duration, m.end + 0.02);
      const length = end - start;
      const gain = Math.min(8, 0.75 / m.peak);
      runFfmpeg([
        "-y",
        "-i",
        path.join(candidatesDir, `${name}-${chosen.number}.mp3`),
        "-af",
        `atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,volume=${gain},afade=t=out:st=${Math.max(0, length - 0.04)}:d=${Math.min(0.04, length)}`,
        "-ac",
        "1",
        "-ar",
        "44100",
        "-codec:a",
        "libmp3lame",
        "-b:a",
        "64k",
        path.join(outputDir, `${name}.mp3`),
      ]);
      sound.shippedMeasurements = inspect(path.join(outputDir, `${name}.mp3`));
      if (
        sound.shippedMeasurements.onset >= 0.01 ||
        sound.shippedMeasurements.clipped ||
        sound.shippedMeasurements.peak >= 0.999
      )
        throw new Error(`Processed ${name} failed onset or clipping checks`);
      sound.chosen = chosen.number;
      sound.selectionReason =
        "Non-silent, unclipped, within target duration; earliest measured onset among valid candidates. Trimmed, peak-normalised and faded.";
    } else {
      const sizes = await Promise.all(
        sound.candidates.map(async (c) => ({
          candidate: c,
          size: (await readFile(path.join(scratch, c.file))).length,
        })),
      );
      sizes.sort((a, b) => a.size - b.size);
      const chosen = sizes[0].candidate;
      sound.chosen = chosen.number;
      sound.selectionReason =
        "Smallest raw candidate; ffmpeg unavailable, so duration, clipping and onset are unverified and require audition.";
      await copyFile(
        path.join(scratch, chosen.file),
        path.join(outputDir, `${name}.mp3`),
      );
      console.warn(
        `ffmpeg unavailable: ${name} shipped raw; audio checks unverified`,
      );
    }
    await save();
    console.log(`Generated ${name}: candidate ${sound.chosen}`);
  }
  let total = 0;
  for (const name of Object.keys(sounds))
    total += (await readFile(path.join(outputDir, `${name}.mp3`))).length;
  manifest.shippedBytes = total;
  if (total > 600 * 1024)
    throw new Error(`Shipped sound budget exceeded: ${total} bytes`);
  await save();
  console.log(`Done: ${manifest.requests} requests, ${total} bytes total`);
} catch (error) {
  await save();
  console.error(
    error instanceof Error ? error.message : "Sound generation failed",
  );
  process.exitCode = 1;
}
