import type { Song } from "./song.ts";

/** A song as the gallery lists it. */
export interface GalleryItem extends Song {
  id: string;
  createdAt: number;
  /** the token, once the operator has linked it */
  coin: { mint: string; linkedAt: number } | null;
  /** a rendered full-band mix (served from /audio), played instead of the engine */
  audio?: string;
  /** a short note under the title, e.g. "banda completa" */
  label?: string;
}

async function json<T>(r: Response): Promise<T> {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `erro ${r.status}`);
  return body as T;
}

export async function listSongs(): Promise<GalleryItem[]> {
  return (await json<{ songs: GalleryItem[] }>(await fetch("/api/songs"))).songs;
}

export async function publishSong(s: Song): Promise<string> {
  const r = await fetch("/api/songs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
  return (await json<{ id: string }>(r)).id;
}

export const coinUrl = (mint: string) => `https://pump.fun/coin/${encodeURIComponent(mint)}`;

/** Ask the server to sing and mix a band (a few seconds); returns the MP3's address. */
export async function renderBand(s: { bpm: number; repeat: number; mood: string; band: unknown }): Promise<string> {
  const r = await fetch("/api/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bpm: s.bpm, repeat: s.repeat, mood: s.mood, band: s.band }) });
  return "/audio/" + (await json<{ audio: string }>(r)).audio;
}
