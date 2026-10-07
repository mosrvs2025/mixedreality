// Public-domain melodies for the learn mode. Each note is [pitch, beats]; a null
// pitch is a rest. Quarter note = 1 beat.
const BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function parseNote(name) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  return 12 * (Number(m[3]) + 1) + BASE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

function seq(list) {
  const notes = [];
  let t = 0;
  for (const [n, d] of list) {
    if (n) notes.push({ midi: parseNote(n), start: t, dur: d });
    t += d;
  }
  return notes;
}

// "C4 C4 G4(2)" style shorthand: a note followed by optional (beats).
function tune(text) {
  return seq(
    text
      .trim()
      .split(/\s+/)
      .map((tok) => {
        const m = /^([A-G][#b]?\d|-)(?:\((\d*\.?\d+)\))?$/.exec(tok);
        if (!m) throw new Error(`bad token ${tok}`);
        return [m[1] === '-' ? null : m[1], m[2] ? Number(m[2]) : 1];
      }),
  );
}

export const SONGS = [
  {
    id: 'twinkle',
    title: 'Twinkle Twinkle',
    level: 'easy',
    bpm: 96,
    notes: tune(`
      C4 C4 G4 G4 A4 A4 G4(2) F4 F4 E4 E4 D4 D4 C4(2)
      G4 G4 F4 F4 E4 E4 D4(2) G4 G4 F4 F4 E4 E4 D4(2)
      C4 C4 G4 G4 A4 A4 G4(2) F4 F4 E4 E4 D4 D4 C4(2)`),
  },
  {
    id: 'ode',
    title: 'Ode to Joy',
    level: 'easy',
    bpm: 108,
    notes: tune(`
      E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4(1.5) D4(0.5) D4(2)
      E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4(1.5) C4(0.5) C4(2)
      D4 D4 E4 C4 D4 E4(0.5) F4(0.5) E4 C4 D4 E4(0.5) F4(0.5) E4 D4 C4 D4 G3(2)
      E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4(1.5) C4(0.5) C4(2)`),
  },
  {
    id: 'birthday',
    title: 'Happy Birthday',
    level: 'easy',
    bpm: 100,
    notes: tune(`
      G4(0.75) G4(0.25) A4 G4 C5 B4(2)
      G4(0.75) G4(0.25) A4 G4 D5 C5(2)
      G4(0.75) G4(0.25) G5 E5 C5 B4 A4
      F5(0.75) F5(0.25) E5 C5 D5 C5(2)`),
  },
  {
    id: 'elise',
    title: 'Für Elise',
    level: 'medium',
    bpm: 112,
    notes: tune(`
      E5(0.25) D#5(0.25) E5(0.25) D#5(0.25) E5(0.25) B4(0.25) D5(0.25) C5(0.25) A4(0.5) -(0.25) C4(0.25) E4(0.25) A4(0.25)
      B4(0.5) -(0.25) E4(0.25) G#4(0.25) B4(0.25) C5(0.5) -(0.25) E4(0.25) E5(0.25) D#5(0.25)
      E5(0.25) D#5(0.25) E5(0.25) B4(0.25) D5(0.25) C5(0.25) A4(0.5) -(0.25) C4(0.25) E4(0.25) A4(0.25)
      B4(0.5) -(0.25) E4(0.25) C5(0.25) B4(0.25) A4(1)`),
  },
];

export function songRange(song) {
  let lo = 127;
  let hi = 0;
  for (const n of song.notes) {
    lo = Math.min(lo, n.midi);
    hi = Math.max(hi, n.midi);
  }
  return { lo, hi };
}
