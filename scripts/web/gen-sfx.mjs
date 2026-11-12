// THE RULE sound upgrade, 2026-11-12: 25 mono 64-kbps MP3s.
// Run: node scripts/web/gen-sfx.mjs (cached raw candidates are reused, never regenerated).
// Run --offline to reprocess/select cached candidates without any API calls.
// Run --measure to ffprobe/decode every shipped asset and refresh the review/report.
// Prompts, processing, candidate selection and limitations are recorded in the review manifest.
// Change a chosen id in scratch/audio-review/manifest.json to audition/ship an alternate.
// Keep the original scratch/sfx/manifest.json and its three candidates per retained sound.
// No seed exists in sound-generation: exact reproduction uses cached raw candidates.
import { readFile, writeFile, mkdir, copyFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { root, review, state, save, quota, generate, ff, pcm, inspect, rate, music } from './gen-music.mjs';

const out = path.join(root, 'apps/web/public/sfx');
const brief = 'Single game sound in a joyful hand-inked paper cartoon world. Close, tactile and dry, rounded warm tone, no harsh treble, no background ambience, no speech, no casino or slot machine sounds. ';
// Ordered by founder priority. Each has three fresh candidates, 33 requests total.
const sounds = {
  win: [3, 2.7, 'A big joyful victory fanfare: punchy warm toy brass, rising marimba and glockenspiel flourish, handclaps and a burst of paper confetti, a triumphant resolved final chord. Exciting and celebratory, not a jackpot, no coins, no voice.'],
  'stamp-roll': [2.3, 2.1, 'A suspenseful dry snare and wooden desk fingertip drumroll that starts immediately, accelerates and swells, with a tight papery little stop at the end. One anticipatory roll, no resolution chime, no verdict, no music and no voice.'],
  correct: [1.5, 1.25, 'An instantly rewarding you-got-it musical sting: three bright rising marimba and rounded glockenspiel notes resolving in a warm major chord, with a little playful paper star pop. Clear happy achievement, no voice.'],
  yes: [1.0, 0.85, 'A punchy joyful YES reward: strong wooden marimba attack, three quick rising bright warm chime notes, a small springy pop and papery star flutter. Clear uplifting major harmony, immediate rewarding response, no voice.'],
  stamp: [0.7, 0.45, 'One powerful heavy rubber stamp slamming thick paper on a solid wooden desk: deep rounded woody THUNK with a crisp paper crack and a short rubber compression squeak. Physical weight, immediate attack, dry short decay, not a gunshot, no music and no voice.'],
  blot: [0.8, 0.65, 'One very quick low-pitched male cartoon creature vocalization, a mischievous baritone little hup-grr-chuckle with a smile, like a playful rubbery wax blob being poked. Chesty, fast, bouncy, nonverbal; no female voice, child or music.'],
  sign: [0.6, 0.48, 'A quick confident fountain pen signature scratching across textured paper, ending in a tiny airy paper whoosh and a satisfyingly precise ink tick. Immediately audible, one compact gesture, no music and no voice.'],
  nav: [0.5, 0.19, 'One ultra-short crisp light tactile navigation click: tiny wooden bead tick and dry paper snap together, satisfying and clean, very fast attack, no tail, no music and no voice.'],
  no: [0.7, 0.5, 'One sympathetic but clearly distinct soft NO response: rounded low wooden tok and a little descending rubbery plop on felt and paper. Gentle disappointment, not punishing, not a buzzer or alarm, immediate attack, no voice.'],
  mint: [0.7, 0.58, 'A satisfying little token creation sound: crisp bright wooden clink, a quick ascending two-note glassy plink and a soft wax pop. Small lively rewarding accent, not a shower of coins, not a casino jackpot, no voice.'],
  success: [1.0, 0.8, 'A cheerful punchy task-complete flourish: bright staccato marimba rising into two warm bell notes and a satisfying paper sticker slap. Friendly sunny major harmony, compact and resolved, no voice.'],
};
const all = ['tap','toggle','open','close','whoosh','page','stamp','yes','no','duplicate','pending','refund','error','seal','replay-pass','replay-fail','mint','blot','jump','success','nav','sign','stamp-roll','win','correct'];

async function processEffect(source, destination, name, maxDuration) {
  const raw = await inspect(source);
  if (!Number.isFinite(raw.integrated) || raw.end <= raw.onsetMs / 1000) throw new Error(`Silent source: ${name}`);
  const start = Math.max(0, raw.onsetMs / 1000 - 0.001);
  const active = Math.min(raw.duration - start, raw.end + 0.025 - start);
  // Pitch estimates of the first processed Blot set were 300–470 Hz, still too
  // high for the requested chesty character. Lower one octave, then speed up
  // with pitch-preserving tempo stages. Net speed is 1.2x, not a slow monster.
  const pitch = name === 'blot' ? `asetrate=${rate * 0.5},aresample=${rate},atempo=2,atempo=1.2,` : '';
  const characterSpeed = name === 'blot' ? 1.2 : 1;
  const speed = name === 'nav' ? 1 : Math.max(1, active / maxDuration / characterSpeed);
  const length = Math.min(maxDuration, active / speed / characterSpeed);
  const temp = destination + '.wav';
  ff(['-y','-i',source,'-af',`atrim=start=${start}:duration=${active},asetpts=PTS-STARTPTS,${pitch}atempo=${speed},atrim=duration=${length},highpass=f=65,lowpass=f=10500,acompressor=threshold=0.18:ratio=3:attack=1:release=60,afade=t=in:d=0.001,afade=t=out:st=${Math.max(0,length-0.025)}:d=0.025`,'-ar',String(rate),'-ac','1','-c:a','pcm_f32le',temp]);
  let m = await inspect(temp);
  const target = name === 'no' ? -20 : -18;
  if (target - m.integrated > -2.5 - m.peakDb + 1.5) {
    // A peak-only normaliser made old paper clicks 7–9 LU quieter than verdicts.
    // Reduce excessive crest factor before normalising, never hard-clip a peak.
    const compressed = destination + '.compressed.wav';
    ff(['-y','-i',temp,'-af',`volume=${-6-m.peakDb}dB,acompressor=threshold=0.025:ratio=12:attack=0.1:release=15`,'-c:a','pcm_f32le',compressed]);
    await copyFile(compressed,temp);
    await unlink(compressed);
    m = await inspect(temp);
  }
  const gain = Math.min(target - m.integrated, -2.5 - m.peakDb);
  ff(['-y','-i',temp,'-af',`volume=${gain}dB`,'-ac','1','-ar',String(rate),'-c:a','libmp3lame','-b:a','64k',destination]);
  // Measure the final decoder, not the source: normalisation and MP3 framing can
  // move the threshold. Correct only real leading silence, never mute an attack.
  let shipped = await inspect(destination);
  if (shipped.onsetMs >= 10) {
    ff(['-y','-i',temp,'-af',`volume=${gain}dB,atrim=start=${Math.max(0,shipped.onsetMs/1000-0.001)},asetpts=PTS-STARTPTS`,'-ac','1','-ar',String(rate),'-c:a','libmp3lame','-b:a','64k',destination]);
    shipped = await inspect(destination);
  }
  await unlink(temp);
  if (shipped.clippedSamples || shipped.peakDb >= -0.5 || shipped.onsetMs >= 10) throw new Error(`Processed ${name} failed headroom/onset checks`);
  return shipped;
}
function transientScore(c, name) {
  const m = c.measurements;
  // Do not confuse earliest raw onset with the best sound: all final onsets are
  // trimmed. Prefer a full usable gesture, consistent LUFS, and headroom.
  const duration = sounds[name]?.[1] ?? m.duration;
  return Math.abs(m.integrated - (name === 'no' ? -20 : -18)) * 0.7
    + Math.abs(m.duration - duration) * 4 + Math.max(0,m.peakDb + 2) * 2;
}
async function effects(s, offline) {
  await mkdir(out, {recursive:true});
  const old = JSON.parse(await readFile(path.join(root,'scratch/sfx/manifest.json'),'utf8'));
  for (const [name,[seconds,maxDuration,detail]] of Object.entries(sounds)) {
    s.sounds[name] ??= {prompt:brief+detail,chosen:null,candidates:[]};
    const sound = s.sounds[name];
    if (sound.prompt !== brief + detail) {
      if (sound.candidates.length) throw new Error(`Cached ${name} prompt differs`);
      sound.prompt = brief + detail;
    }
    for (let id=1;id<=3;id++) {
      const existing = sound.candidates.find(c=>c.id===id);
      let raw;
      if (offline) {
        raw = `candidates/${name}-${id}-raw.mp3`;
        await readFile(path.join(review,raw));
      } else raw = await generate(s,name,id,sound.prompt,seconds);
      const file = `candidates/${name}-${id}.mp3`;
      const measurements = await processEffect(path.join(review,raw),path.join(review,file),name,maxDuration);
      if (existing) Object.assign(existing,{raw,file,measurements});
      else sound.candidates.push({id,raw,file,measurements});
      await save(s);
    }
    const ranked = [...sound.candidates].sort((a,b)=>transientScore(a,name)-transientScore(b,name));
    sound.chosen ??= ranked[0].id;
    const chosen = sound.candidates.find(c=>c.id===sound.chosen);
    if (!chosen) throw new Error(`Invalid chosen candidate: ${name}`);
    sound.reason = 'Measured full compact gesture, immediate attack, best duration/target-LUFS balance with unclipped headroom. Three alternatives retained. Semantics, character and timbre require founder audition; not listened to by agent.';
    if (name === 'blot') sound.reason = 'Candidate 3 had the lowest measured voiced pitch before the octave-down/1.2x-speed processing. Chosen for a deeper, quick cartoon character; perceived masculinity still requires founder audition.';
    await copyFile(path.join(review,chosen.file),path.join(out,`${name}.mp3`));
    sound.shipped = chosen.measurements;
    await save(s);
  }
  for (const name of all.filter(n=>!sounds[n])) {
    const prior = old.sounds[name];
    const sound = {prompt:prior.prompt,chosen:s.sounds[name]?.chosen ?? prior.chosen,candidates:[],reason:'Original selected gesture retained; level/trim/codec standardised, excessive crest factor compressed where needed for consistent effect loudness. All three original candidates kept for audition.'};
    for (const c of prior.candidates) {
      const raw = `candidates/${name}-${c.number}-original.mp3`;
      await copyFile(path.join(root,'scratch/sfx',c.file),path.join(review,raw));
      sound.candidates.push({id:c.number,file:raw,measurements:await inspect(path.join(review,raw))});
    }
    const chosen=sound.candidates.find(c=>c.id===sound.chosen);
    if (!chosen) throw new Error(`Invalid chosen candidate: ${name}`);
    const processed=`candidates/${name}-${sound.chosen}.mp3`;
    sound.shipped=await processEffect(path.join(review,chosen.file),path.join(review,processed),name,prior.durationSeconds);
    chosen.raw=chosen.file;chosen.file=processed;chosen.measurements=sound.shipped;
    await copyFile(path.join(review,processed),path.join(out,`${name}.mp3`));
    s.sounds[name]=sound;
    await save(s);
  }
}
async function report(s) {
  let bytes=0;
  const lines=['name,duration_s,onset_ms,peak_dbfs,integrated_lufs,true_peak_dbtp,size_bytes,channels,bitrate'];
  for(const name of all) {
    const m=await inspect(path.join(out,`${name}.mp3`));
    if(m.streams[0].channels!==1||m.streams[0].bit_rate!=='64000'||m.clippedSamples||m.onsetMs>=10)throw new Error(`Delivery validation failed: ${name}`);
    s.sounds[name].shipped=m;bytes+=m.size;
    lines.push([name,m.duration.toFixed(3),m.onsetMs.toFixed(2),m.peakDb.toFixed(2),m.integrated.toFixed(2),m.truePeak.toFixed(2),m.size,1,64000].join(','));
  }
  const m=await inspect(path.join(root,'apps/web/public/music/ambient.mp3'));
  s.music.shipped=m;
  lines.push(['ambient',m.duration.toFixed(3),m.onsetMs.toFixed(2),m.peakDb.toFixed(2),m.integrated.toFixed(2),m.truePeak.toFixed(2),m.size,m.streams[0].channels,m.streams[0].bit_rate].join(','));
  s.totals={sfxBytes:bytes,sfxCount:all.length,musicBytes:m.size,generationRequests:s.requests.length};
  if(bytes>=900000||m.size>=700000||m.integrated < -18||m.integrated > -16||m.clippedSamples)throw new Error('Delivery budget/loudness/clipping failed');
  await writeFile(path.join(review,'measurements.csv'),lines.join('\n')+'\n');
  await save(s);
  console.log(lines.join('\n'));console.log(JSON.stringify(s.totals));
}
const s=await state();
const offline=process.argv.includes('--offline');
try {
  if(process.argv.includes('--measure')) await report(s);
  else {
    if(!offline) await quota(s,'before');
    await music(s);
    await effects(s,offline);
    await report(s);
  }
} finally {
  if(!offline&&!process.argv.includes('--measure')) await quota(s,'after');
}
