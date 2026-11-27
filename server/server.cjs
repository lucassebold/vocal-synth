'use strict';
/**
 * Gallery server for the studio: serves the built app (dist/) and a tiny songs API. No
 * dependencies, no database: songs live in one JSON file (data/songs.json).
 *
 *   GET   /api/songs                  the gallery, newest first
 *   POST  /api/songs                  publish a song (validated, rate-limited)
 *   PATCH /api/songs/:id/coin         link the song's token (needs the x-admin-key header
 *                                     to equal the ADMIN_KEY env var; off when it is unset)
 *
 * The server never creates a token and holds no wallet: it only records the mint address
 * the operator links after launching the coin.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const band = require('./band.cjs');

const PORT = Number(process.env.PORT) || 5320;
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const FILE = path.join(DATA_DIR, 'songs.json');
const ADMIN_KEY = process.env.ADMIN_KEY || '';

const MAX_SONGS = 5000;
const MAX_BODY = 4096;
const PER_HOUR = 10;
const RENDERS_PER_HOUR = 30;
const AUDIO_DIR = path.join(DATA_DIR, 'audio');

const STEP_COUNTS = [16, 32];
const ROWS = 8;
const MOODS = ['alegre', 'triste', 'epico', 'dancante'];
const VOICES = ['male', 'female', 'child'];
const SOUNDS = ['la', 'doo', 'na', 'oh', 'hey', 'mi', 'ah', 'do'];
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.otf': 'font/otf',
  '.woff2': 'font/woff2',
  '.gz': 'application/gzip',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

// ---------------------------------------------------------------- storage

// First start on an empty disk (a new volume): begin with the songs bundled in seed/, so the
// gallery is not empty. Later starts keep whatever is on the disk.
(function seedIfEmpty() {
  const seed = path.join(ROOT, 'seed');
  if (fs.existsSync(FILE) || !fs.existsSync(path.join(seed, 'songs.json'))) return;
  fs.mkdirSync(path.join(DATA_DIR, 'audio'), { recursive: true });
  const bundled = path.join(seed, 'audio');
  if (fs.existsSync(bundled)) {
    for (const name of fs.readdirSync(bundled)) fs.copyFileSync(path.join(bundled, name), path.join(DATA_DIR, 'audio', name));
  }
  fs.copyFileSync(path.join(seed, 'songs.json'), FILE);
  console.log('gallery started from seed/');
})();

let songs = [];
try {
  songs = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch (e) {
  songs = [];
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(songs));
  fs.renameSync(tmp, FILE);
}

// ---------------------------------------------------------------- helpers

function send(res, status, body, headers) {
  const h = Object.assign({ 'Cache-Control': 'no-store' }, headers || {});
  if (typeof body !== 'string' && !Buffer.isBuffer(body)) {
    body = JSON.stringify(body);
    h['Content-Type'] = 'application/json; charset=utf-8';
  }
  res.writeHead(status, h);
  res.end(body);
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? String(fwd).split(',')[0].trim() : req.socket.remoteAddress) || 'unknown';
}

function readJson(req, cb) {
  let size = 0;
  const chunks = [];
  let dead = false;
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) {
      dead = true;
      cb(new Error('corpo grande demais'));
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on('end', () => {
    if (dead) return;
    try {
      cb(null, JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch (e) {
      cb(new Error('JSON inválido'));
    }
  });
}

/** text for display: no control characters, no angle brackets, trimmed, capped */
function clean(v, max) {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** A score: exact notes [midi, beats], any pitch and length (a melody someone wrote out). */
function validateScore(b, title, author, bpm, repeat) {
  if (!Array.isArray(b.notes) || b.notes.length < 3 || b.notes.length > 400) return { error: 'partitura inválida' };
  let total = 0;
  const notes = [];
  for (let i = 0; i < b.notes.length; i++) {
    const n = b.notes[i];
    if (!Array.isArray(n) || n.length !== 2) return { error: 'nota inválida' };
    const midi = n[0], beats = n[1];
    if (!Number.isInteger(midi) || midi < 36 || midi > 96) return { error: 'altura fora da faixa' };
    if (typeof beats !== 'number' || !(beats >= 0.125 && beats <= 16)) return { error: 'duração inválida' };
    total += beats;
    notes.push([midi, Math.round(beats * 1000) / 1000]);
  }
  if (total * 60 / bpm > 300) return { error: 'música longa demais (máx. 5 min)' };
  return { song: { title, author, bpm, repeat, mood: b.mood, voice: b.voice, sound: b.sound, grid: [], notes } };
}

/** The song as the studio makes it, or an error message. */
function validate(b) {
  if (!b || typeof b !== 'object') return { error: 'música inválida' };
  const title = clean(b.title, 40);
  if (!title) return { error: 'dê um nome para a música' };
  const author = clean(b.author, 24) || 'anônimo';
  const bpm = Number(b.bpm);
  const repeat = b.repeat === undefined ? 1 : b.repeat;
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 4) return { error: 'repetição inválida' };
  if (!Number.isInteger(bpm) || bpm < 40 || bpm > 220 || (b.notes === undefined && b.band === undefined && (bpm < 60 || bpm > 180))) return { error: 'velocidade inválida' };
  if (MOODS.indexOf(b.mood) < 0) return { error: 'humor inválido' };
  if (VOICES.indexOf(b.voice) < 0) return { error: 'voz inválida' };
  if (SOUNDS.indexOf(b.sound) < 0) return { error: 'som inválido' };
  if (b.band !== undefined) {
    const vb = band.validateBand(b.band);
    if (vb.error) return vb;
    // the cover and the listing use the melody track: its grid, or its sounding notes
    const melody = vb.band.tracks[0];
    const common = { title, author, bpm, repeat, mood: b.mood, voice: b.voice, sound: b.sound, band: vb.band, label: 'banda completa' };
    if (melody.grid) return { song: Object.assign(common, { grid: melody.grid.slice() }) };
    return { song: Object.assign(common, { grid: [], notes: melody.notes.filter((n) => n[0] > 0).slice(0, 400) }) };
  }
  if (b.notes !== undefined) return validateScore(b, title, author, bpm, repeat);
  if (!Array.isArray(b.grid) || STEP_COUNTS.indexOf(b.grid.length) < 0) return { error: 'grade inválida' };
  let notes = 0;
  for (let i = 0; i < b.grid.length; i++) {
    const r = b.grid[i];
    if (!Number.isInteger(r) || r < -1 || r >= ROWS) return { error: 'grade inválida' };
    if (r >= 0) notes++;
  }
  if (notes < 3) return { error: 'use pelo menos 3 notas' };
  return { song: { title, author, bpm, repeat, mood: b.mood, voice: b.voice, sound: b.sound, grid: b.grid.slice() } };
}

const fingerprint = (s) => crypto.createHash('sha1').update([s.bpm, s.repeat, s.mood, s.voice, s.sound, s.grid.join(','), (s.notes || []).join(';'), s.band ? JSON.stringify(s.band) : ''].join('|')).digest('hex');

const posts = new Map();
const renders = new Map();
function rateLimited(ip) {
  return rateLimitedBy(posts, ip, PER_HOUR);
}
function rateLimitedBy(map, ip, limit) {
  const now = Date.now();
  const recent = (map.get(ip) || []).filter((t) => now - t < 3600e3);
  if (recent.length >= limit) {
    map.set(ip, recent);
    return true;
  }
  recent.push(now);
  map.set(ip, recent);
  return false;
}

// ---------------------------------------------------------------- api

function api(req, res, url) {
  const parts = url.split('/').filter(Boolean); // ['api', 'songs', id?, 'coin'?]

  if (parts.length === 2 && parts[1] === 'render' && req.method === 'POST') {
    const ip = clientIp(req);
    if (rateLimitedBy(renders, ip, RENDERS_PER_HOUR)) return send(res, 429, { error: 'muitas gerações seguidas, tente mais tarde' });
    return readJson(req, (err, body) => {
      if (err) return send(res, 400, { error: err.message });
      const bpm = Number(body && body.bpm), repeat = body && body.repeat === undefined ? 1 : body && body.repeat;
      if (!Number.isInteger(bpm) || bpm < 40 || bpm > 220) return send(res, 400, { error: 'velocidade inválida' });
      if (!Number.isInteger(repeat) || repeat < 1 || repeat > 4) return send(res, 400, { error: 'repetição inválida' });
      if (MOODS.indexOf(body.mood) < 0) return send(res, 400, { error: 'humor inválido' });
      const vb = band.validateBand(body.band);
      if (vb.error) return send(res, 400, { error: vb.error });
      band.renderBand({ bpm, repeat, mood: body.mood, band: vb.band }, AUDIO_DIR).then(
        (name) => send(res, 200, { audio: name }),
        (e) => send(res, 503, { error: 'não foi possível gerar a banda: ' + (e && e.message ? e.message : 'erro') }),
      );
    });
  }

  if (parts[1] !== 'songs') return send(res, 404, { error: 'não encontrado' });

  if (parts.length === 2 && req.method === 'GET') {
    return send(res, 200, { songs: songs.slice().reverse().map((s) => ({ id: s.id, createdAt: s.createdAt, coin: s.coin, title: s.title, author: s.author, bpm: s.bpm, repeat: s.repeat || 1, mood: s.mood, voice: s.voice, sound: s.sound, grid: s.grid, notes: s.notes, audio: s.audio, label: s.label, band: s.band })) });
  }

  if (parts.length === 2 && req.method === 'POST') {
    const ip = clientIp(req);
    if (rateLimited(ip)) return send(res, 429, { error: 'muitas músicas seguidas, tente mais tarde' });
    return readJson(req, (err, body) => {
      if (err) return send(res, 400, { error: err.message });
      const v = validate(body);
      if (v.error) return send(res, 400, { error: v.error });
      if (songs.length >= MAX_SONGS) return send(res, 507, { error: 'galeria cheia' });
      const fp = fingerprint(v.song);
      if (songs.some((s) => s.fp === fp)) return send(res, 409, { error: 'essa música já está na galeria' });
      const song = Object.assign({ id: crypto.randomBytes(5).toString('hex'), fp: fp, createdAt: Date.now(), coin: null }, v.song);
      if (!song.band) {
        songs.push(song);
        save();
        return send(res, 201, { id: song.id });
      }
      // a band is rendered before it is listed (a render already made in the studio is reused)
      return band.renderBand({ bpm: song.bpm, repeat: song.repeat, mood: song.mood, band: song.band }, AUDIO_DIR).then(
        (name) => {
          song.audio = name;
          songs.push(song);
          save();
          send(res, 201, { id: song.id });
        },
        (e) => send(res, 503, { error: 'não foi possível gerar a banda: ' + (e && e.message ? e.message : 'erro') }),
      );
    });
  }

  if (parts.length === 4 && parts[3] === 'coin' && req.method === 'PATCH') {
    if (!ADMIN_KEY || req.headers['x-admin-key'] !== ADMIN_KEY) return send(res, 403, { error: 'sem permissão' });
    return readJson(req, (err, body) => {
      if (err) return send(res, 400, { error: err.message });
      const song = songs.find((s) => s.id === parts[2]);
      if (!song) return send(res, 404, { error: 'música não encontrada' });
      if (!body || !BASE58.test(String(body.mint))) return send(res, 400, { error: 'endereço da moeda inválido' });
      song.coin = { mint: String(body.mint), linkedAt: Date.now() };
      save();
      return send(res, 200, { ok: true });
    });
  }

  return send(res, 405, { error: 'método não permitido' });
}

// ---------------------------------------------------------------- audio (full-band mixes)

/** /audio/<hex>.mp3 from DATA_DIR/audio; files are put there by a local script, never uploaded */
function serveAudio(req, res, url) {
  const name = decodeURIComponent(url.split('?')[0].slice('/audio/'.length));
  if (!/^[a-f0-9]{6,40}\.mp3$/.test(name)) return send(res, 404, 'not found');
  fs.readFile(path.join(DATA_DIR, 'audio', name), (e, buf) => {
    if (e) return send(res, 404, 'not found');
    send(res, 200, buf, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=3600' });
  });
}

// previews rendered in the studio and never published are cleaned up after six hours
function collectAudio() {
  const used = new Set(songs.map((s) => s.audio).filter(Boolean));
  fs.readdir(AUDIO_DIR, (e, names) => {
    if (e) return;
    for (const n of names) {
      if (used.has(n) || !/\.mp3$/.test(n)) continue;
      const p = path.join(AUDIO_DIR, n);
      fs.stat(p, (e2, st) => { if (!e2 && Date.now() - st.mtimeMs > 6 * 3600e3) fs.unlink(p, () => {}); });
    }
  });
}
collectAudio();
setInterval(collectAudio, 3600e3).unref();

// ---------------------------------------------------------------- static

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.split('?')[0]);
  if (rel.indexOf('\0') >= 0) return send(res, 400, 'bad request');
  let file = path.normalize(path.join(DIST, rel));
  if (file.indexOf(DIST) !== 0) return send(res, 403, 'forbidden');
  fs.stat(file, (e, st) => {
    if (e || !st.isFile()) {
      // the single page: unknown paths without an extension get the app
      if (path.extname(rel)) return send(res, 404, 'not found');
      file = path.join(DIST, 'index.html');
    }
    fs.readFile(file, (e2, buf) => {
      if (e2) return send(res, 404, 'not found (rode "bun run build" antes)');
      const type = MIME[path.extname(file)] || 'application/octet-stream';
      const immutable = file.indexOf(path.join(DIST, 'assets')) === 0;
      send(res, 200, buf, { 'Content-Type': type, 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
    });
  });
}

http
  .createServer((req, res) => {
    const url = req.url || '/';
    try {
      if (url.indexOf('/api/') === 0) return api(req, res, url.split('?')[0]);
      if (url.indexOf('/audio/') === 0 && req.method === 'GET') return serveAudio(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
      return serveStatic(req, res, url);
    } catch (e) {
      return send(res, 500, { error: 'erro interno' });
    }
  })
  .listen(PORT, () => console.log('Chimera Songs em http://localhost:' + PORT + (ADMIN_KEY ? '' : '  (ADMIN_KEY ausente: ligar moeda desativado)')));
