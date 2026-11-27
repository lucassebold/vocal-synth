import { useEffect, useRef, useState } from "react";
import { AnatomyView } from "../ui/components/AnatomyView.tsx";
import { Screen } from "../ui/components/Screen.tsx";
import { singInfo, singWords } from "../ui/components/SingPanel.tsx";
import { play, playAudio, stop, useNow } from "./player.ts";
import { publishSong, renderBand } from "./api.ts";
import { useViewing } from "./viewing.ts";
import { NoteGrid } from "./NoteGrid.tsx";
import { BandLanes, BandStatus, LEAD_IN, Pick, beatAt } from "./Band.tsx";
import {
  BPM_MAX, BPM_MIN, MOODS, REPEATS, REST, ROWS, SHIFTS, SOUNDS, STEPS, STEP_BEATS, VOICES,
  bandBeats, bandHasNotes, defaultBand, emptySong, midiOf, newTrack, noteCount, problem, randomGrid, type Band, type Beat, type Song, type Track,
} from "./song.ts";

const DRAFT = "chimera-songs:draft";
const AUTHOR = "chimera-songs:author";

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function keep(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // no storage (private window): the draft just won't survive a reload
  }
}

const validGrid = (g: unknown): g is number[] => Array.isArray(g) && g.length === STEPS && g.every((r) => Number.isInteger(r) && r >= REST && r < ROWS);

/** a band from storage, kept only if every track still has the shape of one */
function savedBand(b: unknown): Band | undefined {
  const band = b as Band | undefined;
  if (!band || !Array.isArray(band.tracks) || band.tracks.length < 1 || band.tracks.length > 5) return undefined;
  const ok = band.tracks.every(
    (t) =>
      VOICES.some((v) => v.id === t.voice) && SOUNDS.some((s) => s.id === t.sound) && SHIFTS.some((s) => s.id === t.shift) &&
      typeof t.volume === "number" && (t.grid ? validGrid(t.grid) : Array.isArray(t.notes)),
  );
  return ok ? band : undefined;
}

/** a draft from storage, kept only if it still has the shape of a song */
function draft(): Song {
  const d = load<Partial<Song>>(DRAFT, {});
  const base = emptySong();
  const band = savedBand(d.band);
  return {
    ...base,
    bpm: typeof d.bpm === "number" ? Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(d.bpm))) : base.bpm,
    mood: MOODS.some((m) => m.id === d.mood) ? d.mood! : base.mood,
    voice: VOICES.some((v) => v.id === d.voice) ? d.voice! : base.voice,
    sound: SOUNDS.some((s) => s.id === d.sound) ? d.sound! : base.sound,
    repeat: typeof d.repeat === "number" && REPEATS.includes(d.repeat) ? d.repeat : base.repeat,
    grid: validGrid(d.grid) ? d.grid : base.grid,
    title: typeof d.title === "string" ? d.title.slice(0, 40) : "",
    author: load<string>(AUTHOR, "").slice(0, 24),
    ...(band ? { band } : {}),
  };
}

/** the band as it is sent: voices with no notes stay out (the server refuses an empty one) */
function liveBand(b: Band): Band {
  return { ...b, tracks: b.tracks.filter((t) => (t.grid ? noteCount(t.grid) > 0 : (t.notes ?? []).some((n) => n[0] > 0))) };
}

/** the first voice of the band as a plain song, so the engine can sing it (silently) for the mouth */
function melodySong(song: Song, t: Track | undefined): Song {
  if (!t) return { ...song, band: undefined };
  const notes: [number, number][] = t.notes ? t.notes.map((n) => [n[0] > 0 ? n[0] + t.shift : n[0], n[1]]) : [];
  if (!t.notes && t.grid) for (const row of t.grid) {
    if (row !== REST) notes.push([midiOf(row, song.mood) + t.shift, STEP_BEATS]);
    else if (notes.length) notes[notes.length - 1][1] += STEP_BEATS;
  }
  return { ...song, band: undefined, voice: t.voice, sound: t.sound, grid: [], notes };
}

export function Studio(props: { onPublished: () => void }) {
  // a song opened from the gallery ("Ver como é feito"): its settings replace the draft until closed
  const [viewing, setViewing] = useState(() => useViewing.getState().viewing);
  const [song, setSong] = useState<Song>(() => (viewing ? { ...viewing.song, author: draft().author } : draft()));
  const [busy, setBusy] = useState(false);
  /** the band is being sung on the server: when it started and about how long it takes */
  const [making, setMaking] = useState<{ since: number; estimate: number } | null>(null);
  const [, setTick] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const now = useNow();
  const playing = now.key === "studio";
  const renderId = useRef(0);

  const band = song.band;

  useEffect(() => {
    // while looking at someone else's song the person's own draft is left alone
    if (viewing) return;
    keep(DRAFT, song);
    keep(AUTHOR, song.author);
  }, [song, viewing]);
  // the gallery's handoff is used once: coming back to this tab later starts from the draft
  useEffect(() => () => useViewing.setState({ viewing: null }), []);
  // leaving the studio stops its song, and a band still being made is dropped when it arrives
  useEffect(() => () => {
    renderId.current++;
    if (useNow.getState().key === "studio" || useNow.getState().key === "preview") stop();
  }, []);
  // the progress bar moves while the band is being made
  useEffect(() => {
    if (!making) return;
    const id = setInterval(() => setTick((n) => n + 1), 200);
    return () => clearInterval(id);
  }, [making]);

  const edit = (patch: Partial<Song>) => {
    setMsg(null);
    setSong((s) => ({ ...s, ...patch }));
  };

  /** change the band (and keep the song's own grid/voice/sound in step with the melody voice) */
  function editBand(change: (b: Band) => Band) {
    setMsg(null);
    setSong((s) => {
      if (!s.band) return s;
      const b = change(s.band);
      const m = b.tracks[0];
      return { ...s, band: b, grid: m?.grid ? m.grid.slice() : s.grid, voice: m?.voice ?? s.voice, sound: m?.sound ?? s.sound };
    });
  }
  const editTrack = (i: number, patch: Partial<Track>) => editBand((b) => ({ ...b, tracks: b.tracks.map((t, k) => (k === i ? { ...t, ...patch } : t)) }));

  function clickTrack(i: number, col: number, row: number) {
    const track = band?.tracks[i];
    if (!track?.grid) return;
    const grid = track.grid.slice();
    const off = grid[col] === row;
    grid[col] = off ? REST : row;
    editTrack(i, { grid });
    // hear the note you just placed, with this voice and height
    if (!off && !playing) void play({ ...song, band: undefined, voice: track.voice, sound: track.sound, grid: [], notes: [[midiOf(row, song.mood) + track.shift, 1]] }, "preview");
  }

  function click(col: number, row: number) {
    const grid = song.grid.slice();
    const off = grid[col] === row;
    grid[col] = off ? REST : row;
    edit({ grid });
    // hear the note you just placed (not while the whole song is playing)
    if (!off && !playing) void play({ ...song, grid: [row, REST] }, "preview");
  }

  function closeViewing() {
    renderId.current++;
    stop();
    useViewing.setState({ viewing: null });
    setViewing(null);
    setMsg(null);
    setMaking(null);
    setSong(draft());
  }

  function useBand() {
    stop();
    setSong((s) => ({ ...s, band: s.band ?? defaultBand(s) }));
  }
  function useVoiceOnly() {
    renderId.current++;
    stop();
    setMaking(null);
    setMsg(null);
    setSong((s) => {
      const m = s.band?.tracks[0];
      const { band: _drop, ...rest } = s;
      return { ...rest, voice: m?.voice ?? s.voice, sound: m?.sound ?? s.sound, grid: m?.grid ? m.grid.slice() : s.grid };
    });
  }

  async function toggle() {
    if (playing) {
      renderId.current++;
      stop();
      return;
    }
    if (!band) return void play(song, "studio");
    // a band is sung and mixed on the server, which takes a few seconds
    const sent = liveBand(band);
    const id = ++renderId.current;
    setMaking({ since: Date.now(), estimate: (bandBeats(sent, song.repeat) * 60) / song.bpm * 1.1 + 4 });
    setMsg(null);
    try {
      const url = await renderBand({ bpm: song.bpm, repeat: song.repeat, mood: song.mood, band: sent });
      if (id === renderId.current) playAudio(url, "studio", { song: melodySong(song, sent.tracks[0]), lead: LEAD_IN });
    } catch (e) {
      if (id === renderId.current) setMsg({ ok: false, text: e instanceof Error ? e.message : "não foi possível gerar a banda" });
    } finally {
      if (id === renderId.current) setMaking(null);
    }
  }

  async function publish() {
    const reason = band ? (!bandHasNotes(band) ? "Coloque notas em pelo menos uma voz." : song.title.trim() ? null : "Dê um nome para a música.") : problem(song);
    if (reason) return setMsg({ ok: false, text: reason });
    setBusy(true);
    try {
      const sent = band ? liveBand(band) : undefined;
      const m = sent?.tracks[0];
      await publishSong({ ...song, ...(sent ? { band: sent, voice: m?.voice ?? song.voice, sound: m?.sound ?? song.sound, grid: m?.grid ?? [] } : {}), title: song.title.trim(), author: song.author.trim() });
      setMsg({ ok: true, text: "Publicada! Ela já está na aba Moedas." });
      props.onPublished();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "não foi possível publicar" });
    } finally {
      setBusy(false);
    }
  }

  const bandOn = band !== undefined;
  const notes = band ? (bandHasNotes(band) ? 1 : 0) : noteCount(song.grid);
  const elapsed = making ? (Date.now() - making.since) / 1000 : 0;
  const bars = band ? Math.max(1, Math.ceil(bandBeats(band, song.repeat) / 4)) : 1;
  const beatNow = playing && band ? beatAt(now.time, song.bpm) : -1;
  const phase = making ? "making" : playing ? "playing" : "idle";

  return (
    <div className={`studio${viewing ? " has-viewing" : ""}${bandOn ? " band-mode" : ""}`}>
      {viewing && (
        <aside className="viewing" role="note">
          <div>
            <h2>Como “{viewing.from}” é feita</h2>
            {band && !viewing.simplified ? (
              <p>
                Esta música tem <b>banda completa</b>: cada faixa abaixo é uma <b>voz</b> cantando a sua parte, e a <b>batida</b> é o beatbox por baixo. Aperte ▶ e veja a linha branca passando por todas ao mesmo tempo. Mexa à vontade e crie a sua versão: a original não muda.
              </p>
            ) : (
              <p>
                Cada quadrado aceso é uma nota, e as escolhas ao lado (humor, voz, o que canta, velocidade e repetições) são as da música. Aperte ▶ Tocar, mexa nos quadrados e crie a sua versão. A original não muda.
              </p>
            )}
            {viewing.simplified && (
              <p className="note">
                {viewing.band
                  ? "Essa música tem banda completa (baixo, coro e batida), mas ela não guardou as faixas. Aqui aparece só a melodia, simplificada nos primeiros 32 passos."
                  : "Essa música tem notas e ritmos exatos que a grade não guarda. Aqui aparece uma versão simplificada dos primeiros 32 passos."}
              </p>
            )}
          </div>
          <button type="button" className="big" onClick={closeViewing}>
            Voltar ao meu rascunho
          </button>
        </aside>
      )}

      <section className="panel grid-panel" aria-label={bandOn ? "Vozes da banda" : "Grade de notas"}>
        <div className="mode-row">
          <Pick label="Montar" value={bandOn ? "banda" : "voz"} options={[{ id: "voz", label: "Só uma voz" }, { id: "banda", label: "Banda completa (várias vozes)" }]} onChange={(m) => (m === "banda" ? useBand() : useVoiceOnly())} />
        </div>

        {band ? (
          <>
            <div className="band-bar">
              <button type="button" className="big primary play" onClick={() => void toggle()} disabled={!notes || making !== null}>
                {making ? "Preparando…" : playing ? "■ Parar" : "▶ Ouvir a banda"}
              </button>
              <BandStatus
                phase={phase}
                progress={making ? Math.min(0.95, elapsed / making.estimate) : 0}
                secondsLeft={making ? Math.max(0, making.estimate - elapsed) : 0}
                bar={beatNow >= 0 ? Math.floor(beatNow / 4) + 1 : 0}
                bars={bars}
              />
            </div>
            {msg && !msg.ok && (
              <p className="bad" role="alert">
                {msg.text}
              </p>
            )}
            <div className="band-mouth">
              <Screen title="Boca" sub={playing ? "cantando a melodia, ao vivo" : "aperte ▶ para ver a boca cantar"}>
                <AnatomyView info={singInfo} overlay={singWords} showFormants={false} />
              </Screen>
            </div>
            <h2>1. Cada linha é uma voz. Clique nos quadrados para pôr notas.</h2>
            <BandLanes
              band={band}
              mood={song.mood}
              bpm={song.bpm}
              time={now.time}
              playing={playing}
              onCell={clickTrack}
              onTrack={editTrack}
              onRandom={(i) => editTrack(i, { grid: randomGrid() })}
              onClear={(i) => editTrack(i, { grid: emptySong().grid })}
              onRemove={(i) => {
                if (i > 0) editBand((b) => ({ ...b, tracks: b.tracks.filter((_, k) => k !== i) }));
              }}
              onAdd={() => editBand((b) => ({ ...b, tracks: [...b.tracks, newTrack(b.tracks.length)] }))}
              onBeat={(beat: Beat | null) => editBand((b) => ({ ...b, beat }))}
            />
            <p className="help">As vozes são cantadas e misturadas no servidor, então leva alguns segundos antes de tocar. Voz sem notas fica de fora.</p>
          </>
        ) : (
          <>
            <h2>1. Clique nos quadrados para criar a melodia</h2>
            <p className="help">Cada coluna é um instante. Uma nota por coluna; coluna vazia segura a nota anterior. Não tem nota errada.</p>
            <NoteGrid grid={song.grid} mood={song.mood} head={playing ? now.step : -1} onCell={click} />
            <div className="actions">
              <button type="button" className="big primary" onClick={() => void toggle()} disabled={!notes}>
                {playing ? "■ Parar" : "▶ Tocar"}
              </button>
              <button type="button" className="big" onClick={() => edit({ grid: randomGrid() })}>
                🎲 Surpreender
              </button>
              <button type="button" className="big" onClick={() => edit({ grid: emptySong().grid })} disabled={noteCount(song.grid) === 0}>
                Limpar
              </button>
            </div>
          </>
        )}
      </section>

      <section className="panel options-panel" aria-label="Estilo">
        <h2>2. Escolha o jeito</h2>
        <Pick label="Humor" value={song.mood} options={MOODS} onChange={(mood) => edit({ mood })} />
        {!band && (
          <>
            <Pick label="Voz" value={song.voice} options={VOICES} onChange={(voice) => edit({ voice })} />
            <Pick label="Canta" value={song.sound} options={SOUNDS} onChange={(sound) => edit({ sound })} />
          </>
        )}
        <Pick label="Repetir" value={String(song.repeat)} options={REPEATS.map((n) => ({ id: String(n), label: `${n}x` }))} onChange={(v) => edit({ repeat: Number(v) })} />
        <label className="speed">
          <span className="choice-label">Velocidade</span>
          <input type="range" min={BPM_MIN} max={BPM_MAX} step={5} value={song.bpm} onChange={(e) => edit({ bpm: Number(e.target.value) })} aria-label="Velocidade" />
          <span className="speed-ends">
            <i>lenta</i>
            <i>rápida</i>
          </span>
        </label>
      </section>

      {!band && (
        <section className="panel mouth-panel" aria-label="Boca cantando">
          <Screen title="Boca" sub="ao vivo">
            <AnatomyView info={singInfo} overlay={singWords} showFormants={false} />
          </Screen>
        </section>
      )}

      <section className="panel publish-panel" aria-label="Publicar">
        <h2>3. Dê um nome e publique</h2>
        <div className="fields">
          <label>
            <span>Nome da música</span>
            <input value={song.title} maxLength={40} placeholder="ex.: Lua de Neon" onChange={(e) => edit({ title: e.target.value })} />
          </label>
          <label>
            <span>Seu nome (opcional)</span>
            <input value={song.author} maxLength={24} placeholder="anônimo" onChange={(e) => edit({ author: e.target.value })} />
          </label>
        </div>
        <button type="button" className="big primary" onClick={() => void publish()} disabled={busy}>
          {busy ? (band ? "Preparando e publicando…" : "Publicando…") : "Publicar na galeria"}
        </button>
        {msg && (msg.ok || !band) && (
          <p className={msg.ok ? "ok" : "bad"} role="status">
            {msg.text}
          </p>
        )}
      </section>
    </div>
  );
}
