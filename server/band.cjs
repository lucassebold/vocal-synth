'use strict';
/**
 * Full-band songs: several voice tracks (each its own grid or exact notes, voice, syllable and
 * volume) plus an optional beatbox track. The browser plays one voice at a time, so a band is
 * rendered here: each track through the CHIMERA command line (`render notes`, `render beatbox`),
 * mixed with ffmpeg into one MP3, and cached by the content of the song. Nothing from the
 * request reaches a shell: only numbers and allow-listed words are passed as arguments.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CHIMERA = process.env.CHIMERA_BIN || path.join(ROOT, 'target', 'release', process.platform === 'win32' ? 'chimera.exe' : 'chimera');
const FFMPEG_CANDIDATES = [process.env.FFMPEG, 'D:/channels/_ferramentas/mpt/lib/ffmpeg/ffmpeg-7.0-essentials_build/ffmpeg.exe', 'ffmpeg'].filter(Boolean);
const FFMPEG = FFMPEG_CANDIDATES.find((p) => p === 'ffmpeg' || fs.existsSync(p)) || 'ffmpeg';

const MIDDLE_C = 60;
const STEP_BEATS = 0.5;
const SCALES = {
  alegre: [0, 2, 4, 7, 9, 12, 14, 16],
  triste: [0, 3, 5, 7, 10, 12, 15, 17],
  epico: [0, 2, 3, 5, 7, 8, 10, 12],
  dancante: [0, 2, 3, 5, 7, 9, 10, 12],
};
// one word per note; every word is a single syllable (the renderer needs one syllable per note)
const WORDS = {
  la: ['la'], doo: ['doo', 'wah'], na: ['na'], oh: ['oh'], hey: ['hey', 'ho'], mi: ['mi', 'ma', 'mo'], ah: ['ah'], do: ['doo'],
};
const VOICES = ['male', 'female', 'child'];
const BEATS = ['Boots and cats', 'Four on the floor', 'Breakbeat', 'Rimshot shuffle', 'Inward snare', 'Clicks and pops', 'Hum bass'];
const SHIFTS = [-12, 0, 12];

function clean(v, max) {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}
const num = (v, lo, hi, dflt) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);

/** The band as it will be stored, or an error message. */
function validateBand(b) {
  if (!b || typeof b !== 'object' || !Array.isArray(b.tracks)) return { error: 'banda inválida' };
  if (b.tracks.length < 1 || b.tracks.length > 5) return { error: 'use de 1 a 5 faixas' };
  const tracks = [];
  for (let i = 0; i < b.tracks.length; i++) {
    const t = b.tracks[i] || {};
    if (VOICES.indexOf(t.voice) < 0) return { error: 'voz inválida na faixa ' + (i + 1) };
    if (!WORDS[t.sound]) return { error: 'sílaba inválida na faixa ' + (i + 1) };
    if (SHIFTS.indexOf(t.shift) < 0) return { error: 'oitava inválida na faixa ' + (i + 1) };
    const track = {
      id: 't' + i,
      name: clean(t.name, 20) || 'Faixa ' + (i + 1),
      voice: t.voice, sound: t.sound, shift: t.shift,
      volume: Math.round(num(t.volume, 0, 2, 1) * 100) / 100,
      vibrato: Math.round(num(t.vibrato, 0, 60, 20)),
    };
    if (t.notes !== undefined) {
      if (!Array.isArray(t.notes) || t.notes.length < 1 || t.notes.length > 400) return { error: 'notas inválidas na faixa ' + (i + 1) };
      let sounding = 0;
      track.notes = [];
      for (const n of t.notes) {
        if (!Array.isArray(n) || n.length !== 2) return { error: 'nota inválida na faixa ' + (i + 1) };
        const midi = n[0], beats = n[1];
        if (!Number.isInteger(midi) || (midi !== 0 && (midi < 36 || midi > 96))) return { error: 'altura fora da faixa' };
        if (typeof beats !== 'number' || !(beats >= 0.125 && beats <= 64)) return { error: 'duração inválida' };
        if (midi > 0) sounding++;
        track.notes.push([midi, Math.round(beats * 1000) / 1000]);
      }
      if (!sounding) return { error: 'a faixa ' + (i + 1) + ' está vazia' };
    } else {
      if (!Array.isArray(t.grid) || [16, 32].indexOf(t.grid.length) < 0) return { error: 'grade inválida na faixa ' + (i + 1) };
      let sounding = 0;
      for (const r of t.grid) {
        if (!Number.isInteger(r) || r < -1 || r > 7) return { error: 'grade inválida na faixa ' + (i + 1) };
        if (r >= 0) sounding++;
      }
      if (!sounding) return { error: 'a faixa ' + (i + 1) + ' está vazia' };
      track.grid = t.grid.slice();
    }
    tracks.push(track);
  }
  let beat = null;
  if (b.beat) {
    if (BEATS.indexOf(b.beat.preset) < 0) return { error: 'batida inválida' };
    beat = { preset: b.beat.preset, volume: Math.round(num(b.beat.volume, 0, 2, 1) * 100) / 100, startBar: Math.round(num(b.beat.startBar, 1, 64, 1)) };
  }
  return { band: { tracks, beat } };
}

/** a track's notes in beats, with rests as midi 0: a grid step with no note holds the one before */
function trackNotes(t, mood, repeat) {
  let one = [];
  if (t.notes) {
    one = t.notes.map((n) => [n[0] > 0 ? n[0] + t.shift : 0, n[1]]);
  } else {
    const scale = SCALES[mood];
    let lead = 0;
    for (const row of t.grid) {
      if (row >= 0) one.push([MIDDLE_C + scale[row] + t.shift, STEP_BEATS]);
      else if (one.length) one[one.length - 1][1] += STEP_BEATS;
      else lead += STEP_BEATS;
    }
    if (lead) one.unshift([0, lead]);
  }
  const all = [];
  for (let i = 0; i < repeat; i++) for (const n of one) all.push([n[0], n[1]]);
  return all;
}

const run = (file, args, timeout) => new Promise((resolve, reject) => {
  execFile(file, args, { timeout: timeout || 180000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
    if (err) return reject(new Error((stderr || err.message || '').toString().slice(0, 300)));
    resolve(stdout);
  });
});

let chain = Promise.resolve();
let waiting = 0;
/** one render at a time (it takes the CPU); a short queue, then "busy" */
function queued(fn) {
  if (waiting >= 3) return Promise.reject(new Error('servidor ocupado, tente de novo em instantes'));
  waiting++;
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p.finally(() => { waiting--; });
}

/** song = {bpm, repeat, mood, band} (validated). Returns the audio file name in audioDir. */
function renderBand(song, audioDir) {
  const key = crypto.createHash('sha1').update(JSON.stringify([song.bpm, song.repeat, song.mood, song.band])).digest('hex').slice(0, 24);
  const name = key + '.mp3';
  const out = path.join(audioDir, name);
  if (fs.existsSync(out)) return Promise.resolve(name);
  return queued(async () => {
    if (fs.existsSync(out)) return name;
    fs.mkdirSync(audioDir, { recursive: true });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chimera-band-'));
    try {
      const inputs = [];
      let totalBeats = 0;
      for (let i = 0; i < song.band.tracks.length; i++) {
        const t = song.band.tracks[i];
        const notes = trackNotes(t, song.mood, song.repeat);
        const sounding = notes.filter((n) => n[0] > 0).length;
        const words = WORDS[t.sound];
        const lyrics = Array.from({ length: sounding }, (_, k) => words[k % words.length]).join(' ');
        const json = path.join(tmp, 't' + i + '.json');
        fs.writeFileSync(json, JSON.stringify({ bpm: song.bpm, lyrics, notes, vibrato: t.vibrato }));
        await run(CHIMERA, ['render', 'notes', json, path.join(tmp, 't' + i), t.voice]);
        inputs.push({ file: path.join(tmp, 't' + i + '.wav'), volume: t.volume });
        totalBeats = Math.max(totalBeats, notes.reduce((s, n) => s + n[1], 0));
      }
      const totalSec = totalBeats * 60 / song.bpm + 0.5;
      const filters = inputs.map((x, i) => '[' + i + ']volume=' + x.volume.toFixed(3) + '[a' + i + ']');
      const labels = inputs.map((_, i) => '[a' + i + ']');
      const beat = song.band.beat;
      if (beat && beat.volume > 0) {
        const delaySec = (beat.startBar - 1) * 4 * 60 / song.bpm;
        const bars = Math.max(1, Math.ceil(totalBeats / 4) - (beat.startBar - 1));
        if (delaySec < totalSec - 2) {
          const dir = path.join(tmp, 'beat');
          await run(CHIMERA, ['render', 'beatbox', dir, beat.preset, 'male', String(song.bpm), String(bars)]);
          const slug = beat.preset.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          const wav = path.join(dir, slug + '.wav');
          const n = inputs.length;
          inputs.push({ file: wav });
          const keepSec = Math.max(2, totalSec - delaySec);
          const ms = Math.round(delaySec * 1000);
          filters.push('[' + n + ']atrim=0:' + keepSec.toFixed(2) + ',volume=' + (beat.volume * 3).toFixed(3) + ',afade=t=out:st=' + Math.max(0, keepSec - 1.8).toFixed(2) + ':d=1.8,adelay=' + ms + '|' + ms + '[b]');
          labels.push('[b]');
        }
      }
      const filter = filters.join(';') + ';' + labels.join('') + 'amix=inputs=' + labels.length + ':normalize=0:duration=longest,alimiter=limit=0.9[m]';
      const args = ['-y', '-hide_banner', '-loglevel', 'error'];
      for (const x of inputs) args.push('-i', x.file);
      args.push('-filter_complex', filter, '-map', '[m]', '-ar', '44100', '-b:a', '160k', out + '.part.mp3');
      await run(FFMPEG, args, 120000);
      fs.renameSync(out + '.part.mp3', out);
      return name;
    } finally {
      // Node 12 has no fs.rm; recursive rmdir exists since 12.10
      try { fs.rmdirSync(tmp, { recursive: true }); } catch (e) { /* temp files: the OS cleans them later */ }
    }
  });
}

module.exports = { validateBand, trackNotes, renderBand, VOICES, BEATS };
