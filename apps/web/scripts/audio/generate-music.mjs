// Prompt: Calm, playful ink-and-wax game cabinet ambience, soft mallets, warm pads and gentle plucks, warm and unhurried, instrumental, no vocals, no drums that pop, narrow dynamic range, loopable.
// One Music generation; falls back to a single sound-effects generation only for plan/permission errors.
// Post-process: ffmpeg -y -i source.mp3 -af loudnorm=I=-24:TP=-6:LRA=7 -codec:a libmp3lame -b:a 96k public/music/ambient.mp3
import { readFile, mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const prompt =
  'Calm, playful ink-and-wax game cabinet ambience, soft mallets, warm pads and gentle plucks, warm and unhurried, instrumental, no vocals, no drums that pop, narrow dynamic range, loopable.';
const env = await readFile(
  'C:/Users/HP Victus/Documents/personal-projects/hackathon/near-hackathon/the-rule/.env',
  'utf8',
);
const match = env.match(/^\s*ELEVEN_LABS_API_KEY\s*=\s*([^\r\n]*)/m);
const key = match?.[1].trim().replace(/^(['"])(.*)\1$/, '$2');
if (!key) throw new Error('ELEVEN_LABS_API_KEY is missing');
const headers = { 'xi-api-key': key, 'Content-Type': 'application/json' };
let api = 'music';
let response = await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_64', {
  method: 'POST',
  headers,
  body: JSON.stringify({ prompt, music_length_ms: 60000, force_instrumental: true }),
});
if (response.status === 401 || response.status === 402 || response.status === 403) {
  api = 'sound-generation';
  response = await fetch('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_64', {
    method: 'POST',
    headers,
    body: JSON.stringify({ text: prompt, duration_seconds: 30, loop: true }),
  });
}
if (!response.ok)
  throw new Error(`${api} API returned HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
const dir = await mkdtemp(join(tmpdir(), 'the-rule-music-'));
try {
  const input = join(dir, 'source.mp3');
  await writeFile(input, Buffer.from(await response.arrayBuffer()));
  await mkdir(resolve('public/music'), { recursive: true });
  const result = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-i',
      input,
      '-af',
      'loudnorm=I=-24:TP=-6:LRA=7',
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '96k',
      resolve('public/music/ambient.mp3'),
    ],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) throw new Error('ffmpeg failed');
  console.log(`Generated using ${api}`);
} finally {
  await rm(dir, { recursive: true, force: true });
}
