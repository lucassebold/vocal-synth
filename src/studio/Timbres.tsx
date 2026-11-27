import { play, stop, useNow, type Timbre } from "./player.ts";
import type { Song } from "./song.ts";

/**
 * The same short phrase sung as different "instruments": a voice imitating them, the way a
 * vocal group does. Each one is a guess (syllable, breath, brightness, ring, vibrato) to be
 * judged by ear; what sounds good goes into the studio as a choice.
 */
interface Preset {
  id: string;
  label: string;
  hint: string;
  voice: Song["voice"];
  /** semitones added to the phrase */
  shift: number;
  lyrics: string;
  /** the notes shorter than the phrase's own beats, for a plucked feel (1 = as written) */
  length?: number;
  timbre: Timbre;
}

const PRESETS: Preset[] = [
  { id: "voz", label: "Voz normal", hint: "para comparar", voice: "female", shift: 0, lyrics: "la", timbre: {} },
  { id: "flauta", label: "Flauta", hint: "“uu” soprado, sem vibrato, uma oitava acima", voice: "female", shift: 12, lyrics: "ooh", timbre: { source: { breathiness: 0.75, brightness: 0.15, tension: 0.2 }, vibrato: 6 } },
  { id: "trompete", label: "Trompete", hint: "“wah” brilhante com ring forte", voice: "male", shift: 0, lyrics: "wah", timbre: { source: { brightness: 0.95, tension: 0.8, pressure: 1 }, epilarynx: 0.9, vibrato: 14 } },
  { id: "baixo", label: "Baixo", hint: "cantarolado grave, uma oitava abaixo (experimental)", voice: "male", shift: -12, lyrics: "mum", timbre: { source: { brightness: 0.15 }, vibrato: 0 } },
  { id: "coro", label: "Coro / cordas", hint: "“ah” longo com vibrato lento", voice: "female", shift: 0, lyrics: "ah", timbre: { source: { breathiness: 0.12, brightness: 0.4, vibratoRate: 5.2 }, epilarynx: 0.4, vibrato: 32 } },
  { id: "sinte", label: "Sintetizador", hint: "vogal dura, sem vibrato, tom seco", voice: "male", shift: 0, lyrics: "ah", timbre: { source: { brightness: 0.85, tension: 0.9, drift: 0 }, vibrato: 0 } },
  { id: "pluck", label: "Beliscado", hint: "sílaba “ta” em cada nota (experimental)", voice: "female", shift: 0, lyrics: "ta", timbre: { source: { breathiness: 0.05, brightness: 0.7 }, vibrato: 0 } },
];

/** an original run up an arpeggio and back, only to hear the timbres */
const PHRASE: [number, number][] = [[60, 0.5], [64, 0.5], [67, 0.5], [72, 0.5], [71, 0.5], [67, 0.5], [64, 0.5], [62, 0.5], [64, 0.5], [67, 0.5], [72, 0.5], [67, 0.5], [64, 0.5], [60, 2]];

function song(p: Preset): Song {
  return {
    title: p.label,
    author: "teste",
    bpm: 110,
    mood: "alegre",
    voice: p.voice,
    sound: "la",
    repeat: 1,
    grid: [],
    lyrics: p.lyrics,
    notes: PHRASE.map(([m, b]) => [m + p.shift, b * (p.length ?? 1)]),
  };
}

export function Timbres() {
  const key = useNow((n) => n.key);
  return (
    <div className="timbres">
      <h2>Teste de timbres</h2>
      <p className="help">A mesma frase curta cantada como “instrumentos”. É a voz imitando, não o instrumento de verdade. Ouça e me diga quais soam bem.</p>
      <ul className="cards">
        {PRESETS.map((p) => {
          const k = `t:${p.id}`;
          const playing = key === k;
          return (
            <li key={p.id} className="card">
              <div className="card-body">
                <h3>{p.label}</h3>
                <p className="meta">{p.hint}</p>
                <div className="card-actions">
                  <button type="button" className={`big${playing ? "" : " primary"}`} onClick={() => (playing ? stop() : void play(song(p), k, p.timbre))}>
                    {playing ? "■ Parar" : "▶ Ouvir"}
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
