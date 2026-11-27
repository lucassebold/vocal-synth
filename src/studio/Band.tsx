import { NoteGrid } from "./NoteGrid.tsx";
import { BEATS, MAX_TRACKS, REST, SHIFTS, SOUNDS, STEPS, STEP_BEATS, VOICES, noteCount, type Beat, type Band, type Mood, type Track } from "./song.ts";

/** One row of choices (the same look as the studio's own). */
export function Pick<T extends string | number>(props: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="choice" role="radiogroup" aria-label={props.label}>
      <span className="choice-label">{props.label}</span>
      <div className="choice-options">
        {props.options.map((o) => (
          <button key={String(o.id)} type="button" role="radio" aria-checked={props.value === o.id} className={`opt${props.value === o.id ? " on" : ""}`} onClick={() => props.onChange(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The rendered mix starts this long after zero (the voices breathe in before the first note). */
export const LEAD_IN = 0.3;
/** beats into the song for a time in the mix, or -1 before it starts */
export const beatAt = (time: number, bpm: number) => (time < 0 ? -1 : Math.max(0, (time - LEAD_IN) * bpm / 60));

/** A track written with exact notes (not on the grid): a small piano roll, with the line and the sounding note. */
export function MiniRoll(props: { notes: [number, number][]; shift: number; beat: number }) {
  const { notes, shift, beat } = props;
  const sounding = notes.filter((n) => n[0] > 0).map((n) => n[0] + shift);
  const total = notes.reduce((t, n) => t + n[1], 0) || 1;
  const lo = Math.min(...sounding), hi = Math.max(...sounding);
  const span = Math.max(12, hi - lo + 2);
  const W = 1000, H = 120;
  const rel = beat >= 0 ? beat % total : -1;
  let t = 0;
  return (
    <svg className="mini-roll" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${sounding.length} notas escritas`}>
      <rect width={W} height={H} fill="#0a1017" />
      {Array.from({ length: Math.ceil(total / 4) + 1 }, (_, b) => (
        <line key={b} x1={(b * 4 * W) / total} x2={(b * 4 * W) / total} y1={0} y2={H} stroke="#16293a" strokeWidth="1" />
      ))}
      {notes.map(([midi, beats], i) => {
        const x = (t * W) / total;
        const w = Math.max(2, (beats * W) / total - 1);
        const isNow = rel >= t && rel < t + beats;
        t += beats;
        if (midi <= 0) return null;
        const y = H - ((midi + shift - lo + 1) / span) * H;
        return <rect key={i} x={x} y={y - 5} width={w} height={10} rx={3} fill={`hsl(${200 - ((midi + shift - lo) / span) * 150} 90% 62%)`} stroke={isNow ? "#fff" : "none"} strokeWidth={isNow ? 3 : 0} />;
      })}
      {rel >= 0 && <line x1={(rel * W) / total} x2={(rel * W) / total} y1={0} y2={H} stroke="#fff" strokeWidth="3" />}
    </svg>
  );
}

/** whether one of an exact-notes voice's notes (not a rest) is sounding at this many beats into the song */
function notesSounding(notes: [number, number][], beat: number): boolean {
  if (beat < 0) return false;
  const total = notes.reduce((t, n) => t + n[1], 0) || 1;
  const rel = beat % total;
  let t = 0;
  for (const [midi, beats] of notes) {
    if (rel >= t && rel < t + beats) return midi > 0;
    t += beats;
  }
  return false;
}

/** the column being played now, and the start of the note that is sounding there (-1 when none yet) */
function position(grid: number[], beat: number): { col: number; now: number } {
  if (beat < 0) return { col: -1, now: -1 };
  const col = Math.floor(beat / STEP_BEATS) % STEPS;
  let now = -1;
  for (let c = col; c >= 0; c--) if (grid[c] !== REST) { now = c; break; }
  return { col, now };
}

const Select = <T extends string | number>(p: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) => (
  <label className="sel">
    <span>{p.label}</span>
    <select value={String(p.value)} onChange={(e) => p.onChange((typeof p.value === "number" ? Number(e.target.value) : e.target.value) as T)}>
      {p.options.map((o) => (
        <option key={String(o.id)} value={String(o.id)}>
          {o.label}
        </option>
      ))}
    </select>
  </label>
);

function Lane(props: {
  track: Track; index: number; mood: Mood; beat: number; playing: boolean;
  onCell: (col: number, row: number) => void; onTrack: (patch: Partial<Track>) => void; onRandom: () => void; onClear: () => void; onRemove: () => void;
}) {
  const { track: t, index, mood, beat, playing } = props;
  const pos = t.grid ? position(t.grid, beat) : { col: -1, now: -1 };
  const sounding = playing && beat >= 0 && t.volume > 0 && (t.grid ? pos.now >= 0 : notesSounding(t.notes ?? [], beat));
  return (
    <section className={`lane${sounding ? " sounding" : ""}${t.volume === 0 ? " muted" : ""}`} aria-label={`Voz: ${t.name}`}>
      <header className="lane-head">
        <strong className="lane-name">
          {t.name}
          {sounding && <em aria-label="cantando agora"> ● cantando</em>}
          {t.volume === 0 && <em> (mudo)</em>}
        </strong>
        <Select label="Quem canta" value={t.voice} options={VOICES} onChange={(voice) => props.onTrack({ voice })} />
        <Select label="O que canta" value={t.sound} options={SOUNDS.map((s) => ({ id: s.id, label: s.label }))} onChange={(sound) => props.onTrack({ sound })} />
        <Select label="Altura" value={t.shift} options={SHIFTS} onChange={(shift) => props.onTrack({ shift })} />
        <label className="sel vol">
          <span>Volume {t.volume === 0 ? "(mudo)" : `${Math.round(t.volume * 100)}%`}</span>
          <input type="range" min={0} max={150} step={5} value={Math.round(t.volume * 100)} onChange={(e) => props.onTrack({ volume: Number(e.target.value) / 100 })} aria-label={`Volume de ${t.name}`} />
        </label>
        {t.grid && (
          <span className="lane-actions">
            <button type="button" className="mini" onClick={props.onRandom} title="Notas aleatórias nesta voz">
              🎲
            </button>
            <button type="button" className="mini" onClick={props.onClear} disabled={noteCount(t.grid) === 0} title="Apagar as notas desta voz">
              Limpar
            </button>
          </span>
        )}
        {index > 0 && (
          <button type="button" className="mini danger" onClick={props.onRemove} title="Tirar esta voz">
            ✕
          </button>
        )}
      </header>
      {t.grid ? (
        <NoteGrid grid={t.grid} mood={mood} head={playing ? pos.col : -1} now={playing ? pos.now : -1} compact onCell={props.onCell} />
      ) : (
        <MiniRoll notes={t.notes ?? []} shift={t.shift} beat={playing ? beat : -1} />
      )}
      {t.notes && <p className="lane-note">Esta voz foi escrita com notas exatas, então aqui você vê e ouve. Dá para mudar quem canta, a altura e o volume.</p>}
    </section>
  );
}

function BeatLane(props: { beat: Beat | null; at: number; playing: boolean; onChange: (b: Beat | null) => void }) {
  const { beat, at, playing } = props;
  const cur: Beat = beat ?? { preset: BEATS[0].id, volume: 1, startBar: 1 };
  const bar = at >= 0 ? Math.floor(at / 4) + 1 : 0;
  const inBeat = beat !== null && playing && bar >= beat.startBar;
  const dot = at >= 0 ? Math.floor(at) % 4 : -1;
  return (
    <section className={`lane beat-lane${inBeat ? " sounding" : ""}${!beat ? " muted" : ""}`} aria-label="Batida">
      <header className="lane-head">
        <strong className="lane-name">
          🥁 Batida
          {inBeat && <em> ● tocando</em>}
          {!beat && <em> (desligada)</em>}
        </strong>
        <span className="lane-actions">
          <button type="button" className={`mini${beat ? " on" : ""}`} onClick={() => props.onChange(beat ? null : cur)}>
            {beat ? "Ligada" : "Desligada"}
          </button>
        </span>
        {beat && (
          <>
            <Select label="Ritmo" value={cur.preset} options={BEATS} onChange={(preset) => props.onChange({ ...cur, preset })} />
            <Select label="Entra no compasso" value={cur.startBar} options={Array.from({ length: 17 }, (_, i) => ({ id: i + 1, label: i === 0 ? "1 (desde o início)" : String(i + 1) }))} onChange={(startBar) => props.onChange({ ...cur, startBar })} />
            <label className="sel vol">
              <span>Volume {Math.round(cur.volume * 100)}%</span>
              <input type="range" min={0} max={150} step={5} value={Math.round(cur.volume * 100)} onChange={(e) => props.onChange({ ...cur, volume: Number(e.target.value) / 100 })} aria-label="Volume da batida" />
            </label>
          </>
        )}
      </header>
      {beat && (
        <div className="beat-dots" aria-hidden="true">
          {[0, 1, 2, 3].map((d) => (
            <i key={d} className={inBeat && dot === d ? "on" : ""} />
          ))}
          <span>{playing && at >= 0 ? (bar < beat.startBar ? `a batida entra no compasso ${beat.startBar} (agora é o ${bar})` : `compasso ${bar}`) : `entra no compasso ${beat.startBar}`}</span>
        </div>
      )}
    </section>
  );
}

/** Every voice stacked, one under the other, with the batida below: the same line runs over all of them. */
export function BandLanes(props: {
  band: Band; mood: Mood; bpm: number; time: number; playing: boolean;
  onCell: (i: number, col: number, row: number) => void;
  onTrack: (i: number, patch: Partial<Track>) => void;
  onRandom: (i: number) => void; onClear: (i: number) => void; onRemove: (i: number) => void;
  onAdd: () => void; onBeat: (b: Beat | null) => void;
}) {
  const { band, mood, bpm, time, playing } = props;
  const beat = playing ? beatAt(time, bpm) : -1;
  return (
    <div className="lanes">
      {band.tracks.map((t, i) => (
        <Lane
          key={t.id}
          track={t}
          index={i}
          mood={mood}
          beat={beat}
          playing={playing}
          onCell={(col, row) => props.onCell(i, col, row)}
          onTrack={(patch) => props.onTrack(i, patch)}
          onRandom={() => props.onRandom(i)}
          onClear={() => props.onClear(i)}
          onRemove={() => props.onRemove(i)}
        />
      ))}
      {band.tracks.length < MAX_TRACKS && (
        <button type="button" className="big add-lane" onClick={props.onAdd}>
          + Adicionar outra voz
        </button>
      )}
      <BeatLane beat={band.beat} at={beat} playing={playing} onChange={props.onBeat} />
    </div>
  );
}

/** The bar above the voices: what to do, what is happening now, and how far along it is. */
export function BandStatus(props: { phase: "idle" | "making" | "playing"; progress: number; secondsLeft: number; bar: number; bars: number }) {
  const { phase, progress, secondsLeft, bar, bars } = props;
  if (phase === "making") {
    return (
      <div className="status making" role="status" aria-live="polite">
        <strong>🎤 As vozes estão ensaiando…</strong>
        <div className="progress" aria-hidden="true">
          <i style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        <span>{secondsLeft > 1 ? `falta mais ou menos ${Math.ceil(secondsLeft)} segundos` : "quase pronto"}</span>
      </div>
    );
  }
  if (phase === "playing") {
    return (
      <div className="status playing" role="status" aria-live="polite">
        <strong>🎵 Tocando!</strong>
        <span>
          Olhe a <b>linha branca</b> passando por todas as vozes. {bar > 0 ? `Compasso ${Math.min(bar, bars)} de ${bars}.` : ""}
        </span>
      </div>
    );
  }
  return (
    <div className="status" role="status">
      <strong>1.</strong> Clique nos quadrados para pôr notas em cada voz. <strong>2.</strong> Aperte ▶ e todas cantam juntas.
    </div>
  );
}
