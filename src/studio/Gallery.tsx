import { useCallback, useEffect, useState } from "react";
import { Cover } from "./Cover.tsx";
import { coinUrl, listSongs, type GalleryItem } from "./api.ts";
import { play, playAudio, stop, useNow } from "./player.ts";
import { MOODS, SOUNDS, VOICES, noteCount } from "./song.ts";

const label = <T extends { id: string; label: string }>(list: T[], id: string) => list.find((x) => x.id === id)?.label ?? id;

function Card({ song, onOpen }: { song: GalleryItem; onOpen: (s: GalleryItem) => void }) {
  const key = `g:${song.id}`;
  const playing = useNow((n) => n.key === key);
  return (
    <li className="card">
      <Cover song={song} />
      <div className="card-body">
        <h3>{song.title}</h3>
        <p className="by">por {song.author}{song.label ? ` · ${song.label}` : ""}</p>
        <p className="meta">
          {label(MOODS, song.mood)} · {label(VOICES, song.voice)} · {label(SOUNDS, song.sound)} · {song.bpm} bpm · {song.notes ? song.notes.length : noteCount(song.grid)} notas
        </p>
        <div className="card-actions">
          <button type="button" className={`big${playing ? "" : " primary"}`} onClick={() => (playing ? stop() : song.audio ? playAudio(`/audio/${song.audio}`, key) : void play(song, key))}>
            {playing ? "■ Parar" : "▶ Ouvir"}
          </button>
          {song.coin ? (
            <a className="coin on" href={coinUrl(song.coin.mint)} target="_blank" rel="noreferrer">
              ◎ Ver moeda
            </a>
          ) : (
            <span className="coin">sem moeda ainda</span>
          )}
          <button type="button" className="big see" onClick={() => onOpen(song)}>
            🔍 Ver como é feito
          </button>
        </div>
      </div>
    </li>
  );
}

export function Gallery(props: { refreshKey: number; onOpen: (s: GalleryItem) => void }) {
  const [songs, setSongs] = useState<GalleryItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setErr(null);
    listSongs()
      .then(setSongs)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : "não foi possível carregar"));
  }, []);

  useEffect(refresh, [refresh, props.refreshKey]);
  useEffect(() => () => { if (useNow.getState().key?.startsWith("g:")) stop(); }, []);

  return (
    <div className="gallery">
      <div className="gallery-head">
        <h2>Todas as músicas</h2>
        <button type="button" className="big" onClick={refresh}>
          Atualizar
        </button>
      </div>
      {err && <p className="bad">{err}</p>}
      {!err && songs === null && <p className="help">Carregando…</p>}
      {songs && songs.length === 0 && <p className="help">Nenhuma música ainda. Crie a primeira!</p>}
      {songs && songs.length > 0 && (
        <ul className="cards">
          {songs.map((s) => (
            <Card key={s.id} song={s} onOpen={props.onOpen} />
          ))}
        </ul>
      )}
    </div>
  );
}
