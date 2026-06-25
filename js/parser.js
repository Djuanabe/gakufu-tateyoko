/* Parse cell text input.
 *
 * Special single-char tokens (whole input):
 *   1  -> quarter rest (advances 1 full beat)
 *   2  -> eighth rest  (advances half beat)
 *   3  -> sustain marker (quarter, with-dot)  - advances half beat
 *   4  -> sustain marker (eighth)             - advances half beat
 *   w  -> just ヲ mark, no note (left-side accidental indicator)
 *   o  -> just オ mark
 *
 * Otherwise: comma-separated chord notes. Each note token:
 *   [h|m|l]?  letter(A-G)  (s|ss|f|ff|n)?
 *
 * Examples:
 *   haf       -> high A♭
 *   lbss      -> low B double-sharp
 *   mcn       -> mid C natural
 *   c,e,g     -> chord C-E-G (no octave preference)
 */

const SPECIAL_TOKENS = {
  '1': {type: 'rest', value: 'quarter'},
  '2': {type: 'rest', value: 'eighth'},
  '3': {type: 'sustain', value: 'quarter'},
  '4': {type: 'sustain', value: 'eighth'},
  'w': {type: 'mark', value: 'wo'},
  'o': {type: 'mark', value: 'o'}
};

function parseCellInput(text) {
  const t = (text || '').trim().toLowerCase();
  if (!t) return {type: 'empty'};

  if (SPECIAL_TOKENS[t]) return SPECIAL_TOKENS[t];

  // chord parse
  const tokens = t.split(',').map(s => s.trim()).filter(Boolean);
  const notes = [];
  for (const tok of tokens) {
    const note = parseNoteToken(tok);
    if (!note) return {type: 'error', message: `音名を解析できません: ${tok}`};
    notes.push(note);
  }
  return {type: 'chord', notes};
}

function parseNoteToken(tok) {
  // match: optional octave prefix h/m/l, then letter a-g, then accidentals
  const m = /^([hml]?)([a-g])(ss|ff|s|f|n)?$/i.exec(tok);
  if (!m) return null;
  const pref = (m[1] || '').toLowerCase();
  const letter = m[2].toUpperCase();
  const accRaw = (m[3] || '').toLowerCase();
  let accidental = '';
  let doubleShift = 0;
  if (accRaw === 's') accidental = 's';
  else if (accRaw === 'ss') { accidental = 's'; doubleShift = 1; }
  else if (accRaw === 'f') accidental = 'f';
  else if (accRaw === 'ff') { accidental = 'f'; doubleShift = -1; }
  else if (accRaw === 'n') accidental = '';
  return {
    letter,
    accidental,
    doubleShift,            // for ss/ff, add extra semitone
    octavePref: pref || '', // h | m | l | ''
    octave: null            // not yet specified
  };
}
