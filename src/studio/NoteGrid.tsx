import { ROWS, STEPS, midiOf, type Mood } from "./song.ts";

/**
 * The 32 x 8 grid of squares: one note per column. `head` lights the column being played now (the
 * line that moves), `now` marks the note that is sounding; `compact` is the short version used
 * when several voices are stacked.
 */
export function NoteGrid(props: { grid: number[]; mood: Mood; head: number; now?: number; compact?: boolean; onCell: (col: number, row: number) => void }) {
  const { grid, mood, head, now = -1, compact, onCell } = props;
  return (
    <div className={`note-grid${compact ? " compact" : ""}`} style={{ gridTemplateColumns: `repeat(${STEPS}, 1fr)` }}>
      {Array.from({ length: ROWS }, (_, r) => ROWS - 1 - r).map((row) =>
        Array.from({ length: STEPS }, (_, col) => {
          const on = grid[col] === row;
          return (
            <button
              key={`${row}-${col}`}
              type="button"
              className={`cell${on ? " on" : ""}${on && now === col ? " now" : ""}${head === col ? " head" : ""}${col % 4 === 0 ? " beat" : ""}`}
              style={{ "--hue": `${200 - row * 22}` } as React.CSSProperties}
              aria-label={`coluna ${col + 1}, nota ${midiOf(row, mood)}`}
              aria-pressed={on}
              onClick={() => onCell(col, row)}
            />
          );
        }),
      )}
    </div>
  );
}
