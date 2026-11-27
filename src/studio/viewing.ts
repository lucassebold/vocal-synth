/**
 * "Ver como é feito": a gallery song handed to the studio, with its grid and every option set,
 * so a person sees how it is built and can change it. The studio reads it when it opens.
 */
import { create } from "zustand";
import type { GalleryItem } from "./api.ts";
import { BPM_MAX, BPM_MIN, REST, STEPS, gridFromNotes, type Band, type Song } from "./song.ts";

export interface Viewing {
  /** the song to load into the studio (a copy: the original stays as published) */
  song: Song;
  /** the original's title, for the banner */
  from: string;
  /** a score or a band mix, shown as the grid can hold it (melody only, first 32 steps) */
  simplified: boolean;
  /** the original is a rendered band mix */
  band: boolean;
}

export const useViewing = create<{ viewing: Viewing | null }>(() => ({ viewing: null }));

/** "<title> (cópia)", the title shortened (not the suffix) when it would pass the 40-character limit */
function copyTitle(title: string): string {
  const suffix = " (cópia)";
  return (title.length + suffix.length <= 40 ? title : title.slice(0, 40 - suffix.length).trimEnd()) + suffix;
}

export function fromGallery(g: GalleryItem): Viewing {
  // a band song: every track comes along, exactly as it was made
  if (g.band) {
    const band = JSON.parse(JSON.stringify(g.band)) as Band;
    for (const t of band.tracks) if (t.grid) while (t.grid.length < STEPS) t.grid.push(REST);
    const melody = band.tracks[0]?.grid;
    return {
      song: { title: copyTitle(g.title), author: "", bpm: Math.min(220, Math.max(40, Math.round(g.bpm))), mood: g.mood, voice: g.voice, sound: g.sound, repeat: g.repeat ?? 1, grid: melody ? melody.slice() : Array<number>(STEPS).fill(REST), band },
      from: g.title,
      simplified: false,
      band: true,
    };
  }
  const fromGrid = g.grid.length > 0;
  const grid = fromGrid ? g.grid.slice(0, STEPS) : gridFromNotes(g.notes ?? [], g.mood);
  while (grid.length < STEPS) grid.push(REST);
  const song: Song = {
    title: copyTitle(g.title),
    author: "",
    bpm: Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(g.bpm))),
    mood: g.mood,
    voice: g.voice,
    sound: g.sound,
    repeat: g.repeat ?? 1,
    grid,
  };
  return { song, from: g.title, simplified: !fromGrid, band: !!g.audio };
}
