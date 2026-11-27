/**
 * One player for the studio and the gallery: a song plays through the engine's song path (the
 * same one the demo songs use), and only one plays at a time. `useNow` says which, and where.
 */
import { create } from "zustand";
import { useStore } from "../ui/store.ts";
import { playSong, stopSinging, tickSinging, useSing } from "../ui/singing.ts";
import { PRESETS } from "../ui/body.ts";
import { DEFAULT_SOURCE, NEUTRAL, type VoiceSource } from "../wasm/engine.ts";
import { noteSteps, toDemoSong, type Song } from "./song.ts";

interface Now {
  /** what is playing: "studio", a gallery id, "preview", or null */
  key: string | null;
  /** the grid step of the note being sung (-1 before the first) */
  step: number;
  /** seconds into a rendered mix (the band) that is playing; -1 when none */
  time: number;
}

export const useNow = create<Now>(() => ({ key: null, step: -1, time: -1 }));

let starts: number[] = [];
let raf = 0;
/** follows the audio element's clock, so the screen can show where the music is */
let timeRaf = 0;
/** set once the song is really sounding, so "not playing yet" is not read as "finished" */
let heard = false;

function loop(): void {
  tickSinging();
  const sing = useSing.getState();
  if (sing.demo) heard = true;
  else if (heard) return void finish();
  const step = sing.demo ? (starts.length ? (starts[sing.demoAt % starts.length] ?? -1) : -1) : -1;
  if (step !== useNow.getState().step) useNow.setState({ step });
  raf = requestAnimationFrame(loop);
}

/** the volume the person had, while the engine sings silently under a rendered band */
let savedVolume: number | null = null;
let mouthTimer = 0;

function unmute(): void {
  clearTimeout(mouthTimer);
  mouthTimer = 0;
  if (savedVolume === null) return;
  useStore.getState().setVolume(savedVolume);
  savedVolume = null;
}

function finish(): void {
  unmute();
  cancelAnimationFrame(raf);
  raf = 0;
  heard = false;
  cancelAnimationFrame(timeRaf);
  timeRaf = 0;
  useNow.setState({ key: null, step: -1, time: -1 });
}

/** What makes one voice sound like another instrument; anything not named goes back to the default voice. */
export interface Timbre {
  source?: Partial<VoiceSource>;
  /** the singer's ring (0..1) */
  epilarynx?: number;
  /** false folds, the growl (0..1) */
  ventricular?: number;
  /** cents */
  vibrato?: number;
}

const { pressure, breathiness, tension, fry, roughness, drift, brightness, vibratoRate } = DEFAULT_SOURCE;
const BASE_SOURCE = { pressure, breathiness, tension, fry, roughness, drift, brightness, vibratoRate, voiced: true };

/** Every play sets the whole timbre, so one preset never leaks into the next song. */
function applyTimbre(t: Timbre = {}): void {
  const st = useStore.getState();
  st.setSource({ ...BASE_SOURCE, ...t.source });
  st.setArtic({ epilarynx: t.epilarynx ?? NEUTRAL.epilarynx, ventricular: t.ventricular ?? NEUTRAL.ventricular });
  useSing.getState().setVibrato(t.vibrato ?? 35);
}

/** a rendered mix (the full-band songs): an audio file instead of the engine */
let audioEl: HTMLAudioElement | null = null;

function stopAudio(): void {
  unmute();
  cancelAnimationFrame(timeRaf);
  timeRaf = 0;
  if (!audioEl) return;
  audioEl.onended = null;
  audioEl.pause();
  audioEl = null;
}

/**
 * The mix is an audio file, so the mouth has no sound of its own to follow: the engine sings the
 * melody voice silently beside it (volume 0) and the mouth drawing moves with it.
 * `lead` is the silence at the start of the mix, in seconds.
 */
export function playAudio(url: string, key: string, mouth?: { song: Song; timbre?: Timbre; lead: number }): void {
  stopSinging();
  stopAudio();
  cancelAnimationFrame(raf);
  heard = false;
  const el = new Audio(url);
  audioEl = el;
  useNow.setState({ key, step: -1, time: 0 });
  el.onended = () => { stopSinging(); finish(); };
  const follow = () => {
    if (audioEl !== el) return;
    useNow.setState({ time: el.currentTime });
    tickSinging();
    timeRaf = requestAnimationFrame(follow);
  };
  el.play().then(
    () => {
      timeRaf = requestAnimationFrame(follow);
      if (!mouth) return;
      if (savedVolume === null) savedVolume = useStore.getState().volume;
      useStore.getState().setVolume(0);
      applyTimbre(mouth.timbre);
      mouthTimer = window.setTimeout(() => {
        if (audioEl !== el) return;
        void playSong(toDemoSong(mouth.song), PRESETS[mouth.song.voice], useStore.getState().start).catch(() => {});
      }, Math.max(0, mouth.lead * 1000 - 60));
    },
    () => finish(),
  );
}

export async function play(song: Song, key: string, timbre?: Timbre): Promise<void> {
  stopAudio();
  cancelAnimationFrame(raf);
  heard = false;
  applyTimbre(timbre);
  starts = noteSteps(song.grid);
  useNow.setState({ key, step: -1, time: -1 });
  raf = requestAnimationFrame(loop);
  try {
    await playSong(toDemoSong(song), PRESETS[song.voice], useStore.getState().start);
  } catch {
    // audio refused to start: do not leave the button stuck on "playing"
    finish();
  }
}

export function stop(): void {
  stopAudio();
  stopSinging();
  finish();
}
