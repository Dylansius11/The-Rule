// THE RULE cheerful detective layer, 2026-11-12. Original bed retained; no Music API.
// Run: node scripts/web/gen-music.mjs --choose-music=4. Review stays in scratch/audio-review/.
// Cached FX sources + deterministic music synthesis reproduce shipped bytes; music makes no API calls.
// This is measurement-led selection, NOT a listening review. Founder audition remains required.
import { mkdir, readFile, writeFile, copyFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const review = path.join(root, 'scratch/audio-review');
export const statePath = path.join(review, 'manifest.json');
export const rate = 44100;
export const authorization = 'Lead explicitly authorized at most 45 sound-generation requests despite missing user_read quota permission. Stop on 401/402/429 or quota error; request-shape 400 may be fixed and retried explicitly.';
export async function state() {
  await mkdir(path.join(review, 'candidates'), { recursive: true });
  try {
    const saved = JSON.parse(await readFile(statePath, 'utf8'));
    saved.authorization = authorization;
    return saved;
  }
  catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return { authorization, requestCap: 45, requests: [], quota: {}, sounds: {}, music: null, earReviewed: false };
  }
}
export async function key() {
  const env = await readFile(path.join(root, '.env'), 'utf8');
  const match = env.match(/^\s*(?:export\s+)?ELEVEN_LABS_API_KEY\s*=\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s#]+))/m);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  if (!value) throw new Error('ELEVEN_LABS_API_KEY is missing from the root .env');
  return value;
}
export async function quota(s, when) {
  const response = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': await key() } });
  if (response.ok) {
    const q = await response.json();
    s.quota[when] = { status: response.status, tier: q.tier, used: q.character_count, limit: q.character_limit, remaining: q.character_limit - q.character_count };
  } else {
    s.quota[when] = { status: response.status, unavailable: 'Key lacks user_read; no quota number is inferred.' };
  }
  await save(s);
  console.log('Quota', when, JSON.stringify(s.quota[when]));
}
export async function generate(s, name, number, prompt, seconds, loop = false) {
  const relative = `candidates/${name}-${number}-raw.mp3`;
  const file = path.join(review, relative);
  try { await readFile(file); return relative; } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (s.requests.some(r => [401,402,429].includes(r.status) || r.quotaError || r.status === 'started'))
    throw new Error('Previous quota/auth/rate/network failure; no further requests allowed in this run');
  if (prompt.length > 450) throw new Error(`Prompt exceeds API's 450-character limit: ${name}`);
  if (s.requests.length >= s.requestCap) throw new Error('45-request cap reached');
  // A generated second costs more than a prompt character; when quota is readable,
  // reserve 10% and budget conservatively at 100 credits per generated second.
  const before = s.quota.before;
  if (before?.remaining != null && s.requests.reduce((n, r) => n + r.seconds * 100, 0) + seconds * 100 > before.remaining * 0.9)
    throw new Error('Conservative credit budget reached; leave quota in reserve');
  const record = { name, candidate: number, seconds, prompt, status: 'started' };
  s.requests.push(record);
  await save(s);
  const response = await fetch('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128', {
    method: 'POST', headers: { 'xi-api-key': await key(), 'content-type': 'application/json' },
    body: JSON.stringify({ text: prompt, duration_seconds: seconds, prompt_influence: 0.7, loop }),
  });
  record.status = response.status;
  if (!response.ok) {
    record.body = await response.text();
    record.quotaError = /quota|insufficient.credit|credit.limit/i.test(record.body);
  }
  await save(s);
  console.log(`${name} candidate ${number}: HTTP ${response.status}${record.body ? ': ' + record.body : ''}`);
  if (!response.ok) throw new Error(`Generation stopped: HTTP ${response.status}`);
  await writeFile(file, Buffer.from(await response.arrayBuffer()));
  return relative;
}
export function ff(args, loglevel = 'error') {
  const p = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', loglevel, ...args], { maxBuffer: 64 * 1024 * 1024 });
  if (p.status !== 0) throw new Error(`ffmpeg failed: ${p.stderr?.toString().slice(-1800)}`);
  return p;
}
export function pcm(file, channels = 1) {
  return ff(['-i', file, '-ac', String(channels), '-ar', String(rate), '-f', 'f32le', '-']).stdout;
}
export function loudness(file) {
  // EBU R128 needs a 400-ms block. Pad only the measurement of shorter effects;
  // the shipped files themselves are not padded or delayed.
  const p = ff(['-i', file, '-af', 'apad=whole_dur=0.4,loudnorm=I=-18:TP=-2:LRA=7:print_format=json', '-f', 'null', '-'], 'info');
  const text = p.stderr.toString();
  const json = JSON.parse(text.slice(text.lastIndexOf('{'), text.lastIndexOf('}') + 1));
  return { integrated: Number(json.input_i), truePeak: Number(json.input_tp), lra: Number(json.input_lra) };
}
export async function inspect(file) {
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name,channels,bit_rate,sample_rate', '-of', 'json', file], { encoding: 'utf8' });
  if (probe.status !== 0) throw new Error(`ffprobe failed: ${file}`);
  const metadata = JSON.parse(probe.stdout), channels = metadata.streams[0].channels;
  const bytes = pcm(file, channels);
  let first = bytes.length / 4, last = 0, peak = 0, clippedSamples = 0;
  for (let i = 0; i < bytes.length / 4; i++) {
    const a = Math.abs(bytes.readFloatLE(i * 4));
    peak = Math.max(peak, a);
    if (a >= 0.005) { first = Math.min(first, i); last = i; }
    if (a >= 1) clippedSamples++;
  }
  return { ...metadata, duration: bytes.length / 4 / channels / rate, onsetMs: Math.floor(first / channels) / rate * 1000, end: Math.floor(last / channels) / rate,
    peakDb: 20 * Math.log10(peak), clippedSamples, ...loudness(file), size: (await readFile(file)).length };
}
const escape = t => String(t).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
export async function save(s) {
  await writeFile(statePath, JSON.stringify(s, null, 2) + '\n');
  const groups = [...(s.music ? [['ambient', s.music]] : []), ...Object.entries(s.sounds)];
  const html = groups.map(([name, v]) => `<section><h2>${escape(name)}</h2><p>${escape(v.prompt ?? '')}</p><p>Chosen: ${escape(v.chosen ?? 'not selected')}. ${escape(v.reason ?? '')}</p>${(v.candidates ?? []).map(c => `<article><h3>${escape(c.id)} ${c.id === v.chosen ? '— CHOSEN' : ''}</h3><p>${escape(c.prompt ?? v.prompt ?? '')}</p><audio controls preload="none" src="${escape(c.file)}"></audio>${c.raw ? `<p>Raw/layer: <audio controls preload="none" src="${escape(c.raw)}"></audio></p>` : ''}<pre>${escape(JSON.stringify(c.measurements ?? {}, null, 2))}</pre></article>`).join('')}<p>Shipped</p><audio controls preload="none" src="../../apps/web/public/${name === 'ambient' ? 'music/ambient' : 'sfx/' + name}.mp3"></audio>${name === 'ambient' ? '<p>Original bed: <audio controls preload="none" src="ambient-base.mp3"></audio></p><p>Three repeated joins: <audio controls preload="none" src="ambient-three-loops.mp3"></audio></p>' : ''}<pre>${escape(JSON.stringify(v.shipped ?? {}, null, 2))}</pre></section>`).join('\n');
  await writeFile(path.join(review, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>THE RULE — audio review</title><style>body{font:16px system-ui;background:#fffbea;color:#141210;max-width:960px;margin:2rem auto;padding:0 1rem}section{border-top:3px solid;padding:1rem 0}article{border-left:4px solid #6e3bff;padding:0 1rem;margin:1rem 0}audio{max-width:100%}pre{white-space:pre-wrap;font-size:12px}</style><h1>THE RULE — audio review</h1><p>Measurement-led selections. NOT listened to by the agent: male character, timbre, musical phrasing, fun, absence of unwanted voices and groove require your ears. Candidates are cached; changing the chosen id and re-running ships an alternate without API spend.</p><p>Onset threshold: -46 dBFS (0.005 linear). Integrated LUFS: EBU R128, with measurement-only silence to 400 ms for shorter effects. All durations below are gapless decoded duration; MP3 container duration includes framing.</p><pre>${escape(JSON.stringify({quota:s.quota,requests:s.requests,totals:s.totals,loopSeam:s.music?.loopSeam},null,2))}</pre>${html}</html>`);
}
function seam(file) {
  const b = pcm(file, 2), n = b.length / 8;
  let jump = 0, firstPower = 0, lastPower = 0, derivativePower = 0;
  const w = Math.min(Math.floor(rate * 0.1), n);
  for (let c = 0; c < 2; c++) {
    jump = Math.max(jump, Math.abs(b.readFloatLE(c * 4) - b.readFloatLE((n - 1) * 8 + c * 4)));
    for (let i = 0; i < w; i++) {
      firstPower += b.readFloatLE(i * 8 + c * 4) ** 2;
      lastPower += b.readFloatLE((n - w + i) * 8 + c * 4) ** 2;
    }
    for (let i = 1; i < n; i++) derivativePower += (b.readFloatLE(i * 8 + c * 4) - b.readFloatLE((i - 1) * 8 + c * 4)) ** 2;
  }
  return { boundaryJumpDb: 20 * Math.log10(jump), adjacent100msLevelDifferenceDb: 10 * Math.log10(firstPower / lastPower), typicalDerivativeRmsDb: 10 * Math.log10(derivativePower / (2 * (n - 1))), earChecked: false };
}
export async function music(s) {
  await mkdir(path.join(root, 'apps/web/public/music'), { recursive: true });
  const base = path.join(review, 'ambient-base.mp3');
  try { await readFile(base); }
  catch (e) {
    if (e.code !== 'ENOENT') throw e;
    const override = process.argv.find(a => a.startsWith('--base='))?.slice(7);
    await copyFile(override ?? path.join(root, 'apps/web/public/music/ambient.mp3'), base);
  }
  const baseHash = createHash('sha256').update(await readFile(base)).digest('hex');
  if (baseHash !== '4153f92db076aca5ce9775ac2eb720472891de8d4e4331e65f42ac29f272c9fa')
    throw new Error('Wrong original bed; restore the original recording with --base=original.mp3 rather than layer an already remixed file');
  // [V] librosa analysis of the original 30-second bed: 112.347 BPM;
  // C major (0.667 chroma correlation), A minor runner-up (0.606).
  // Follow the measured beat grid rather than forcing a generated track to fit.
  // C-major/A-minor pentatonic notes avoid an unverified major/minor third clash.
  const beats = [0.116100,0.650159,1.184218,1.718277,2.275556,2.832834,3.343673,3.924172,4.458231,5.015510,5.526349,6.083628,6.640907,7.198186,7.732245,8.289524,8.823583,9.380862,9.914921,10.472200,11.006259,11.540317,12.074376,12.631655,13.165714,13.699773,14.233832,14.744671,15.301950,15.836009,16.393288,16.927347,17.484626,18.018685,18.552744,19.086803,19.620862,20.178141,20.735420,21.269478,21.826757,22.360816,22.894875,23.428934,23.986213,24.543492,25.100771,25.634830,26.192109,26.726168,27.283447,27.817506,28.374785,28.932063,29.466122,29.976961];
  const basePcm = pcm(base, 2), frames = basePcm.length / 8;
  if (frames !== 30 * rate) throw new Error('Layer recipe requires the original 30-second base; pass --base=original.mp3');
  s.music ??= { prompt: 'Keep the existing detective bed recognisable; add beat-aligned C/A-pentatonic marimba/plucks, glockenspiel answers and soft claps. Deterministic additive synthesis, no generated replacement or unmatched recording.', chosen: null, candidates: [] };
  const patterns = [[72,76,79,81,79,76,74,79], [72,79,76,79,81,79,76,74], [79,81,79,76,74,76,79,72]];
  for (let id = 1; id <= 6; id++) {
    if (s.music.candidates.some(c => c.id === id)) continue;
    const arrangement = (id - 1) % 3, energy = id > 3 ? 4 : 1;
    const layer = new Float64Array(frames * 2);
    const add = (time, midi, gain, kind, pan = 0) => {
      const length = kind === 'bell' ? 0.65 : kind === 'clap' ? 0.085 : 0.23;
      const frequency = 440 * 2 ** ((midi - 69) / 12);
      let seed = 541 + midi * 73 + Math.round(time * 1000);
      for (let i = 0; i < length * rate; i++) {
        const t = i / rate, phase = 2 * Math.PI * frequency * t;
        seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
        const noise = seed / 2147483648;
        const voice = kind === 'clap' ? noise * Math.exp(-t * 65) * (0.7 + 0.3 * Math.cos(t * 1700))
          : kind === 'bell' ? (Math.sin(phase) + 0.24 * Math.sin(phase * 2.76) * Math.exp(-t * 18)) * Math.exp(-t * 7)
          : (Math.sin(phase) + 0.32 * Math.sin(phase * 4) * Math.exp(-t * 35)) * Math.exp(-t * 17);
        const attack = Math.min(1, i / 80);
        const index = (Math.round(time * rate) + i) % frames;
        layer[index * 2] += voice * attack * gain * Math.sqrt((1 - pan) / 2);
        layer[index * 2 + 1] += voice * attack * gain * Math.sqrt((1 + pan) / 2);
      }
    };
    // Sparse eight-beat question/answer hook leaves room for the existing tune.
    beats.forEach((time, i) => {
      const beatLength = (beats[i + 1] ?? 30.51) - time;
      if (i % 8 < (arrangement === 2 ? 6 : 4)) {
        add(time, patterns[arrangement][i % 8], energy * (arrangement === 1 ? 0.027 : 0.034), 'pluck', -0.25);
        if (i % 2 === 0) add(time + beatLength * 0.5, patterns[arrangement][(i + 1) % 8], energy * 0.019, 'pluck', 0.3);
      }
      if (i % 8 === 6) add(time, 84 + (i % 16 === 6 ? 7 : 0), energy * 0.014, 'bell', 0.3);
      if (i % 4 === 1 || i % 4 === 3) add(time, 0, energy * (arrangement === 1 ? 0.009 : 0.012), 'clap');
    });
    const mixed = Buffer.alloc(frames * 8), layerBytes = Buffer.alloc(frames * 8);
    for (let i = 0; i < frames; i++) {
      // Eight-millisecond raised-cosine edge window removes a PCM discontinuity
      // without shortening or shifting the original loop. No long level dip.
      const edge = Math.min(1, i / (rate * 0.008), (frames - 1 - i) / (rate * 0.008));
      const window = 0.5 - 0.5 * Math.cos(Math.PI * edge);
      for (let c = 0; c < 2; c++) {
        const p = i * 2 + c;
        layerBytes.writeFloatLE(layer[p], p * 4);
        mixed.writeFloatLE((basePcm.readFloatLE(p * 4) + layer[p]) * window, p * 4);
      }
    }
    const mixFile = path.join(review, `ambient-${id}.f32`);
    const layerFile = path.join(review, `ambient-layer-${id}.f32`);
    await writeFile(mixFile, mixed);
    await writeFile(layerFile, layerBytes);
    const file = `candidates/ambient-${id}.mp3`, raw = `candidates/ambient-layer-${id}.mp3`;
    ff(['-y','-f','f32le','-ar',String(rate),'-ac','2','-i',mixFile,'-af','lowpass=f=10000,loudnorm=I=-17:TP=-2:LRA=6','-ar',String(rate),'-ac','2','-c:a','libmp3lame','-b:a','128k',path.join(review,file)]);
    ff(['-y','-f','f32le','-ar',String(rate),'-ac','2','-i',layerFile,'-c:a','libmp3lame','-b:a','128k',path.join(review,raw)]);
    await unlink(mixFile);
    await unlink(layerFile);
    s.music.candidates.push({id,file,raw,prompt:`${s.music.prompt} Arrangement ${id}: ${patterns[arrangement].join(',')} MIDI; ${arrangement === 1 ? 'lighter layer' : arrangement === 2 ? 'busier hook' : 'balanced question/answer'}; layer energy ${energy}x.`,measurements:await inspect(path.join(review,file)),loopSeam:seam(path.join(review,file))});
    await save(s);
  }
  for (const candidate of s.music.candidates)
    candidate.measurements = await inspect(path.join(review, candidate.file));
  const valid = s.music.candidates.filter(c => c.measurements.size < 700000 && c.measurements.clippedSamples === 0 && c.measurements.integrated >= -18 && c.measurements.integrated <= -16);
  if (!valid.length) throw new Error('No music candidate meets delivery limits');
  // 1–3 are deliberately subtle; 4–6 lift the new layer by 12 dB. The original
  // recording remains louder than the layer. Select explicitly to swap by ear.
  const selection = process.argv.find(a => a.startsWith('--choose-music='))?.slice(15);
  if (selection) s.music.chosen = Number(selection);
  s.music.chosen ??= 4;
  const chosen = valid.find(c => c.id === s.music.chosen);
  if (!chosen) throw new Error('Chosen music candidate does not meet delivery limits');
  s.music.reason = `Arrangement ${s.music.chosen}: sparse marimba question/answer and glockenspiel/claps over unchanged base timing. Measured beat grid; C-major/A-minor pentatonic compatibility is a statistical inference. Brighter mixes 4–6 raise the cheerful layer 12 dB over the restrained 1–3. No listening claim.`;
  await copyFile(path.join(review, chosen.file), path.join(root, 'apps/web/public/music/ambient.mp3'));
  s.music.shipped = chosen.measurements;
  s.music.loopSeam = chosen.loopSeam;
  ff(['-y','-stream_loop','2','-i',path.join(review,chosen.file),'-c:a','libmp3lame','-b:a','128k',path.join(review,'ambient-three-loops.mp3')]);
  await save(s);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const s = await state();
  await music(s);
}
