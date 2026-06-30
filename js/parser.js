/* Parse cell text input.
 *
 * Special single-char tokens (whole input):
 *   1 -> quarter rest, 2 -> eighth rest, 3/4 -> sustain, w -> ヲ, o -> オ
 *
 * Otherwise the input is COMPOSITE:
 *   - A "center" part and a "left" part are separated by the first space or
 *     読点(、). Everything before -> center, everything after -> left.
 *   - Within a part, items are separated by comma / 読点 / space.
 *   - Center note tokens (5c, 4bf, ...) form a chord (converted to strings).
 *     Center non-note tokens are literal text (hiragana auto -> katakana).
 *   - Left items are always literal text/kana, placed to the LEFT like ヲ/オ.
 *   - A leading separator (input starts with space/、) makes everything left.
 *
 * Examples:
 *   5af            -> A♭ in octave 5
 *   4c,4e,4g       -> chord C-E-G (octave 4)
 *   5c ツ          -> string for 5C, with カナ「ツ」on its left
 *   、ス           -> just カナ「ス」on the left (no note)
 */

const SPECIAL_TOKENS = {
  '1': {type: 'rest', value: 'quarter'},
  '2': {type: 'rest', value: 'eighth'},
  '3': {type: 'sustain', value: 'quarter'},
  '4': {type: 'sustain', value: 'eighth'},
  '5': {type: 'iter', value: 'ゝ'},   // 一音の繰り返し記号
};

// 'w' → ヲ, 'o' → オ; hiragana/katakana tokens are treated as kana left-marks.
const KANA_MARK_MAP = { w: 'ヲ', o: 'オ' };
const KANA_RE = /^[ぁ-ゖァ-ヺー・]+$/;

// Convert hiragana to katakana (leave everything else untouched).
function toKatakana(s) {
  return s.replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

const SEP_RE = /[,、]+/; // chord/symbol separators: comma and 読点 only (no space)

function parseCellInput(text) {
  const t = (text || '').trim();
  if (!t) return {type: 'empty'};

  const low = t.toLowerCase();
  if (SPECIAL_TOKENS[low]) return SPECIAL_TOKENS[low];

  // Tokens: note tokens form the chord; '8' pins to the far RIGHT;
  // 'w'/'o'/hiragana/katakana tokens become kana left-marks; everything
  // else goes to the LEFT symbol column.
  const notes = [];
  const kanaMarks = [];
  const left = [];
  const right = [];
  for (const tok of t.split(SEP_RE).filter(Boolean)) {
    if (tok === '8') { right.push('8'); continue; }
    const note = parseNoteToken(tok.toLowerCase());
    if (note) {
      // Uppercase note letter (A〜G) means: circle THIS note only.
      note.circled = /[A-G]/.test(tok);
      notes.push(note);
    } else if (KANA_MARK_MAP[tok.toLowerCase()]) {
      kanaMarks.push(KANA_MARK_MAP[tok.toLowerCase()]);
    } else if (KANA_RE.test(tok)) {
      kanaMarks.push(toKatakana(tok));
    } else {
      left.push(toKatakana(tok));
    }
  }

  // Pure kana with no notes → standalone left-mark cell (like o/w alone).
  if (kanaMarks.length > 0 && notes.length === 0 && left.length === 0) {
    return { type: 'mark', value: kanaMarks[0] };
  }

  // Kana + notes → composite with kanaLeftMark applied to each note.
  const kanaLeftMark = kanaMarks.length > 0 ? kanaMarks[0] : null;
  return { type: 'composite', notes, kanaLeftMark, left, right };
}

function parseNoteToken(tok) {
  // new format: optional leading octave digit, then letter a-g, then accidental
  //   e.g. 5c, 4bf, 3gs, 4cn   (digit omitted -> octave 4)
  const m = /^(\d)?([a-g])(ss|ff|s|f|n)?$/i.exec(tok);
  if (!m) return null;
  const octave = (m[1] != null && m[1] !== '') ? parseInt(m[1], 10) : 4;
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
    doubleShift,   // for ss/ff, add extra semitone
    octave         // explicit octave (C-delimited)
  };
}
