import { REST, ROWS, STEPS, type Song } from "./song.ts";

const HUES: Record<Song["mood"], [number, number]> = { alegre: [48, 150], triste: [270, 200], epico: [8, 48], dancante: [310, 190] };

/** a score on a 32-column, 8-row grid: time across, pitch (relative to the song's own range) up */
function scoreCells(notes: [number, number][]): number[] {
  const total = notes.reduce((t, n) => t + n[1], 0) || 1;
  const lo = Math.min(...notes.map((n) => n[0])), hi = Math.max(...notes.map((n) => n[0]));
  const cells = Array<number>(32).fill(REST);
  let t = 0;
  for (const [midi, beats] of notes) {
    const col = Math.min(31, Math.floor((t / total) * 32));
    if (cells[col] === REST) cells[col] = hi === lo ? 3 : Math.round(((midi - lo) / (hi - lo)) * (ROWS - 1));
    t += beats;
  }
  return cells;
}

/** The song drawn as its own cover: its notes as a little constellation of bars. */
export function Cover(props: { song: Pick<Song, "grid" | "mood" | "notes">; size?: number }) {
  const { grid: gridIn, mood, notes } = props.song;
  // a score is drawn as a piano roll, folded onto the same 32 x 8 cells
  const grid = notes ? scoreCells(notes) : gridIn;
  const [h0, h1] = HUES[mood];
  const w = 160;
  const pad = 14;
  const steps = grid.length;
  const cw = (w - pad * 2) / steps;
  const ch = (w - pad * 2) / ROWS;
  return (
    <svg className="cover" viewBox={`0 0 ${w} ${w}`} width={props.size} height={props.size} role="img" aria-label="Capa da música">
      <rect width={w} height={w} rx="14" fill={`hsl(${h1} 45% 8%)`} />
      {grid.map((row, i) => {
        if (row === REST) return null;
        let len = 1;
        while (i + len < steps && grid[i + len] === REST) len++;
        const hue = h0 + ((h1 - h0) * row) / (ROWS - 1);
        return <rect key={i} x={pad + i * cw + 1} y={pad + (ROWS - 1 - row) * ch + 2} width={cw * len - 2} height={ch - 4} rx="3" fill={`hsl(${hue} 90% 62%)`} />;
      })}
    </svg>
  );
}
