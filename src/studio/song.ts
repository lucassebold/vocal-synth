/**
 * A studio song: a 32-step grid, one note per step at most. The rows are a pentatonic scale, so
 * any click sounds right. A step with no note holds the note before it (that is how a note gets
 * longer); the song is a few bytes of JSON and the engine, being deterministic, sings it the
 * same way for everyone, so no audio is ever stored.
 */
import type { DemoSong } from "../wasm/types.ts";
import type { BodyName } from "../worklet/protocol.ts";

export const STEPS = 32;
export const ROWS = 8;
/** a step lasts half a beat */
export const STEP_BEATS = 0.5;
/** the grid cell with no note */
export const REST = -1;

export type Mood = "alegre" | "triste" | "epico" | "dancante";
export const MOODS: { id: Mood; label: string; hint: string }[] = [
  { id: "alegre", label: "Alegre", hint: "soa feliz" },
  { id: "triste", label: "Triste", hint: "soa melancólico" },
  { id: "epico", label: "Épico", hint: "soa grandioso" },
  { id: "dancante", label: "Dançante", hint: "soa de pista" },
];

/** semitones above middle C, bottom row first (major / minor pentatonic over two octaves) */
const SCALES: Record<Mood, number[]> = {
  alegre: [0, 2, 4, 7, 9, 12, 14, 16],
  triste: [0, 3, 5, 7, 10, 12, 15, 17],
  // natural minor, one octave
  epico: [0, 2, 3, 5, 7, 8, 10, 12],
  // dorian: minor with a bright sixth
  dancante: [0, 2, 3, 5, 7, 9, 10, 12],
};
const MIDDLE_C = 60;

export const VOICES: { id: BodyName; label: string }[] = [
  { id: "male", label: "Homem" },
  { id: "female", label: "Mulher" },
  { id: "child", label: "Criança" },
];

export const SOUNDS: { id: string; label: string; lyrics: string }[] = [
  { id: "la", label: "La la la", lyrics: "la la la" },
  { id: "doo", label: "Doo wah", lyrics: "doo wah" },
  { id: "na", label: "Na na na", lyrics: "na na na" },
  { id: "oh", label: "Oh oh oh", lyrics: "oh oh oh" },
  { id: "hey", label: "Hey ho", lyrics: "hey ho" },
  { id: "mi", label: "Mi ma mo", lyrics: "mi ma mo" },
  // used by the band's choir and ostinato tracks
  { id: "ah", label: "Ah ah ah", lyrics: "ah ah ah" },
  { id: "do", label: "Doo doo doo", lyrics: "doo doo doo" },
];

export interface Song {
  title: string;
  author: string;
  bpm: number;
  mood: Mood;
  voice: BodyName;
  /** a SOUNDS id */
  sound: string;
  /** how many times the 32 steps are played in a row */
  repeat: number;
  /** one entry per step: the row of the note, or REST (empty for a score) */
  grid: number[];
  /** words to sing instead of the SOUNDS preset (the timbre test uses it; never stored) */
  lyrics?: string;
  /** a score: exact notes [midi, beats], used instead of the grid */
  notes?: [number, number][];
  /** a full band: several voice tracks and a beat, rendered together (the grid above is the melody's) */
  band?: Band;
}

/** One voice of the band: its own grid (or exact notes, with rests as midi 0), voice, syllable and loudness. */
export interface Track {
  id: string;
  name: string;
  voice: BodyName;
  sound: string;
  /** semitones from the written pitch: -12, 0 or 12 */
  shift: number;
  /** 0..2, 1 = the voice as rendered */
  volume: number;
  vibrato: number;
  grid?: number[];
  notes?: [number, number][];
}

export interface Beat {
  /** one of BEATS */
  preset: string;
  volume: number;
  /** the bar the beat comes in on (1 = from the start) */
  startBar: number;
}

export interface Band {
  tracks: Track[];
  beat: Beat | null;
}

export const MAX_TRACKS = 5;
export const SHIFTS: { id: number; label: string }[] = [
  { id: -12, label: "Grave" },
  { id: 0, label: "Normal" },
  { id: 12, label: "Agudo" },
];
/** the beatbox patterns the engine ships with */
export const BEATS: { id: string; label: string }[] = [
  { id: "Boots and cats", label: "Bumbo e caixa" },
  { id: "Four on the floor", label: "Pista (4 por 4)" },
  { id: "Breakbeat", label: "Quebrada" },
  { id: "Rimshot shuffle", label: "Shuffle" },
  { id: "Inward snare", label: "Caixa invertida" },
  { id: "Clicks and pops", label: "Estalos" },
  { id: "Hum bass", label: "Baixo cantarolado" },
];

export const REPEATS = [1, 2, 3, 4];
export const BPM_MIN = 60;
export const BPM_MAX = 180;

export function emptySong(): Song {
  return { title: "", author: "", bpm: 100, mood: "alegre", voice: "female", sound: "la", repeat: 1, grid: Array<number>(STEPS).fill(REST) };
}

export const midiOf = (row: number, mood: Mood) => MIDDLE_C + SCALES[mood][row];

/** The engine's own shape for a song: notes in beats, a held step lengthening the note before. */
export function toDemoSong(s: Song): DemoSong {
  const notes: [number, number][] = s.notes ? s.notes.map((n) => [n[0], n[1]]) : [];
  if (!s.notes) for (const row of s.grid) {
    if (row !== REST) notes.push([midiOf(row, s.mood), STEP_BEATS]);
    else if (notes.length) notes[notes.length - 1][1] += STEP_BEATS;
  }
  const lyrics = s.lyrics ?? (SOUNDS.find((x) => x.id === s.sound) ?? SOUNDS[0]).lyrics;
  // male one octave down, so the lowest rows stay singable (a score keeps its written pitch)
  const pass = notes;
  const all: [number, number][] = [];
  for (let i = 0; i < Math.max(1, Math.min(4, s.repeat || 1)); i++) for (const n of pass) all.push([n[0], n[1]]);
  return { name: s.title || "Minha música", bpm: s.bpm, lyrics, notes: all, octave: s.notes ? { male: 0, female: 0, child: 0 } : { male: -1, female: 0, child: 0 } };
}

/** For each sung note, the step it starts on (what the playhead follows). */
export function noteSteps(grid: number[]): number[] {
  const out: number[] = [];
  grid.forEach((row, i) => row !== REST && out.push(i));
  return out;
}

export const noteCount = (grid: number[]) => grid.reduce((n, r) => n + (r !== REST ? 1 : 0), 0);

/** A random tune that wanders up and down by small steps and comes home on the lowest note. */
export function randomGrid(): number[] {
  const grid = Array<number>(STEPS).fill(REST);
  let row = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < STEPS; i++) {
    const rest = i > 0 && Math.random() < 0.35;
    if (!rest) {
      grid[i] = row;
      row = Math.min(ROWS - 1, Math.max(0, row + Math.floor(Math.random() * 5) - 2));
    }
  }
  grid[STEPS - 1] = REST;
  // the last sounding step goes home
  for (let i = STEPS - 1; i >= 0; i--) if (grid[i] !== REST) { grid[i] = 0; break; }
  return grid;
}

/** The server's check of a song, mirrored here so the form can say what is missing. */
export function problem(s: Song): string | null {
  if (!noteCount(s.grid)) return "Coloque pelo menos uma nota na grade.";
  if (noteCount(s.grid) < 3) return "Use pelo menos 3 notas.";
  if (!s.title.trim()) return "Dê um nome para a música.";
  return null;
}

/**
 * A score's notes folded onto the studio grid, to show roughly how it would be built there:
 * each note takes the nearest row of the mood's scale and the step where it starts (half a
 * beat per step), and only the first 32 steps fit. A simplified view, not the same song.
 */
export function gridFromNotes(notes: [number, number][], mood: Mood): number[] {
  const grid = Array<number>(STEPS).fill(REST);
  const top = SCALES[mood][ROWS - 1];
  let t = 0;
  for (const [midi, beats] of notes) {
    const step = Math.round(t / STEP_BEATS);
    if (step >= STEPS) break;
    // bring the pitch into the grid's own range, then take the closest row
    let m = midi;
    while (m < MIDDLE_C) m += 12;
    while (m > MIDDLE_C + top) m -= 12;
    let best = 0;
    for (let row = 1; row < ROWS; row++) if (Math.abs(m - midiOf(row, mood)) < Math.abs(m - midiOf(best, mood))) best = row;
    grid[step] = best;
    t += beats;
  }
  return grid;
}

const emptyGrid = () => Array<number>(STEPS).fill(REST);

/** The band a person starts from: their melody plus an empty bass and choir, and a beat. */
export function defaultBand(s: Song): Band {
  return {
    tracks: [
      { id: "t0", name: "Melodia", voice: s.voice, sound: s.sound, shift: 0, volume: 1, vibrato: 20, grid: s.grid.slice() },
      { id: "t1", name: "Baixo", voice: "male", sound: "oh", shift: -12, volume: 0.8, vibrato: 8, grid: emptyGrid() },
      { id: "t2", name: "Coro", voice: "female", sound: "ah", shift: 0, volume: 0.25, vibrato: 26, grid: emptyGrid() },
    ],
    beat: { preset: BEATS[0].id, volume: 1, startBar: 1 },
  };
}

/** A new empty track, named after how many there are. */
export function newTrack(n: number): Track {
  return { id: "t" + n, name: "Faixa " + (n + 1), voice: "female", sound: "la", shift: 0, volume: 0.6, vibrato: 20, grid: emptyGrid() };
}

/** The band is only worth rendering with at least one note somewhere. */
export function bandHasNotes(b: Band): boolean {
  return b.tracks.some((t) => (t.grid ? noteCount(t.grid) > 0 : (t.notes ?? []).some((n) => n[0] > 0)));
}

/** how long the band lasts, in beats (the longest voice, times the repeats) */
export function bandBeats(b: Band, repeat: number): number {
  const one = b.tracks.map((t) => (t.grid ? t.grid.length * STEP_BEATS : (t.notes ?? []).reduce((sum, n) => sum + n[1], 0)));
  return Math.max(0, ...one) * Math.max(1, repeat);
}
