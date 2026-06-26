/* Convert pitch -> string index against the current tuning, with ヲ/オ fallback.
 *
 * Strategy:
 *   1. Compute target pitch-class (0..11) from letter + accidental + doubleShift.
 *   2. Try offsets 0, -1, -2 (semitones). Strings whose pitch-class matches
 *      (target + offset) mod 12 are candidates. Offset 0 -> direct, -1 -> ヲ
 *      (the string is a half-step LOWER than target, raised by 半音押し),
 *      -2 -> オ (whole-step lower, raised by 一音押し).
 *   3. Among candidates, use octavePref (h/m/l) to disambiguate: l = lowest
 *      octave available, h = highest, m = middle, "" = middle (default).
 *   4. If still none, return null (caller flags cell as unconverted).
 */

function pitchClass(letter, accidental, doubleShift) {
  let pc = LETTER_TO_SEMI[letter];
  if (accidental === 's') pc += 1;
  else if (accidental === 'f') pc -= 1;
  pc += (doubleShift || 0);
  return ((pc % 12) + 12) % 12;
}

function convertPitch(pitch, tuning) {
  const offsets = [
    {delta: 0, leftMark: ''},
    {delta: -1, leftMark: 'wo'},
    {delta: -2, leftMark: 'o'}
  ];

  // New format: explicit octave -> match exact midi, then half/whole down.
  if (pitch.octave != null) {
    const base = pitchToMidi({ letter: pitch.letter, accidental: pitch.accidental || '', octave: pitch.octave });
    const target = base + (pitch.doubleShift || 0);
    for (const off of offsets) {
      const want = target + off.delta;
      const idx = tuning.findIndex(s => s.midi === want);
      if (idx >= 0) return { stringIndex: idx, leftMark: off.leftMark, source: pitch };
    }
    return null;
  }

  // Legacy fallback (old saves stored octavePref instead of an octave).
  const targetPc = pitchClass(pitch.letter, pitch.accidental || '', pitch.doubleShift || 0);
  const pref = pitch.octavePref || '';
  for (const off of offsets) {
    const wantPc = ((targetPc + off.delta) % 12 + 12) % 12;
    const candidates = [];
    tuning.forEach((s, idx) => {
      if (((s.midi % 12) + 12) % 12 === wantPc) candidates.push({idx, string: s});
    });
    if (candidates.length === 0) continue;
    const picked = pickByOctavePref(candidates, pref);
    return { stringIndex: picked.idx, leftMark: off.leftMark, source: pitch };
  }
  return null;
}

function pickByOctavePref(candidates, pref) {
  const sorted = [...candidates].sort((a, b) => a.string.midi - b.string.midi);
  if (pref === 'l') return sorted[0];
  if (pref === 'h') return sorted[sorted.length - 1];
  // 'm' or '' = middle
  return sorted[Math.floor(sorted.length / 2)];
}

function applyChord(cell, chordPitches, tuning) {
  cell.notes = [];
  cell.unconverted = null;
  const unresolved = [];
  for (const p of chordPitches) {
    const r = convertPitch(p, tuning);
    if (r) { r.circled = !!p.circled; cell.notes.push(r); }
    else unresolved.push(p);
  }
  if (unresolved.length > 0) {
    cell.unconverted = unresolved;
  }
}
