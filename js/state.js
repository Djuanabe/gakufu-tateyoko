/* Global app state and data model.
 *
 * Cell levels:
 *   sheet
 *     .timeSignature : default {num, den}
 *     .instrumentType : '13' | '17'
 *     .tuning : { stringIndex(0..n-1) : {letter, accidental, octave, midi} }
 *     .measures : [ Measure ]
 *
 * Measure:
 *   .timeSignature : optional override
 *   .cells : array of half-beat cells. Length = num * (8/den) when den=4 => num*2.
 *
 * Cell:
 *   .notes : array of Note (chord)
 *   .rest  : null | 'quarter' | 'eighth'
 *   .sustain : null | 'quarter' | 'eighth' (=2 marks of伸ばし; quarter has dot, eighth same)
 *   .unconverted : null | {letter, accidental, octave} (couldn't map to a string)
 *
 * Note:
 *   .stringIndex : 0..(n-1) into tuning array
 *   .leftMark : '' | 'wo' (ヲ, 半音下) | 'o' (オ, 全音下)
 *   .source : original pitch {letter, accidental, octave} for diagnostics
 */

const STRING_LABELS_13 = ['一','二','三','四','五','六','七','八','九','十','斗','為','巾'];
// 17-string: 一〜九 then 10〜17 as Arabic numerals
const STRING_LABELS_17 = ['一','二','三','四','五','六','七','八','九','10','11','12','13','14','15','16','17'];

function stringCount(type) { return type === '17' ? 17 : 13; }
function stringLabel(type, idx) {
  return type === '17' ? STRING_LABELS_17[idx] : STRING_LABELS_13[idx];
}

// Default tuning: 平調子 (hira-joshi) for 13絃 - a common starting tuning.
// 一 D4, 二 G4, 三 A4, 四 A♯4(B♭4), 五 D5, 六 E♭5, 七 G5, 八 A5, 九 B♭5, 十 D6, 斗 E♭6, 為 G6, 巾 A6
function defaultTuning13() {
  const pitches = [
    {letter:'D', accidental:'', octave:4},
    {letter:'G', accidental:'', octave:4},
    {letter:'A', accidental:'', octave:4},
    {letter:'B', accidental:'f', octave:4},
    {letter:'D', accidental:'', octave:5},
    {letter:'E', accidental:'f', octave:5},
    {letter:'G', accidental:'', octave:5},
    {letter:'A', accidental:'', octave:5},
    {letter:'B', accidental:'f', octave:5},
    {letter:'D', accidental:'', octave:6},
    {letter:'E', accidental:'f', octave:6},
    {letter:'G', accidental:'', octave:6},
    {letter:'A', accidental:'', octave:6}
  ];
  return pitches.map(p => ({...p, midi: pitchToMidi(p)}));
}

function defaultTuning17() {
  // simple chromatic-ish default; user will customize
  const base = [
    'C2','D2','E2','F2','G2','A2','B2','C3','D3','E3','F3','G3','A3','B3','C4','D4','E4'
  ];
  return base.map(s => {
    const letter = s[0];
    const oct = parseInt(s.slice(1), 10);
    return {letter, accidental:'', octave: oct, midi: pitchToMidi({letter, accidental:'', octave: oct})};
  });
}

const LETTER_TO_SEMI = {C:0, D:2, E:4, F:5, G:7, A:9, B:11};
function pitchToMidi(p) {
  if (!p) return null;
  const acc = p.accidental === 's' ? 1 : p.accidental === 'f' ? -1 : 0;
  return 12 * (p.octave + 1) + LETTER_TO_SEMI[p.letter] + acc;
}

function newCell() {
  return { notes: [], rest: null, sustain: null, unconverted: null, raw: '' };
}

function newMeasure(num, den) {
  const cellCount = num * Math.max(1, Math.round(8/den)); // half-beat cells per measure
  const cells = [];
  for (let i = 0; i < cellCount; i++) cells.push(newCell());
  return { timeSignature: {num, den}, cells };
}

const State = {
  sheet: {
    instrumentType: '13',
    timeSignature: {num:4, den:4},
    tuning: defaultTuning13(),
    measures: []
  },
  cursor: { measure: 0, cell: 0 },

  init() {
    // Start with 4 empty measures
    for (let i = 0; i < 4; i++) {
      this.sheet.measures.push(newMeasure(4, 4));
    }
  },

  setInstrumentType(type) {
    this.sheet.instrumentType = type;
    this.sheet.tuning = type === '17' ? defaultTuning17() : defaultTuning13();
  },

  currentMeasure() { return this.sheet.measures[this.cursor.measure]; },
  currentCell() {
    const m = this.currentMeasure();
    return m ? m.cells[this.cursor.cell] : null;
  },

  advanceHalfBeat() {
    const m = this.currentMeasure();
    if (!m) return;
    if (this.cursor.cell < m.cells.length - 1) {
      this.cursor.cell++;
    } else if (this.cursor.measure < this.sheet.measures.length - 1) {
      this.cursor.measure++;
      this.cursor.cell = 0;
    } else {
      // append a new measure with the same time signature
      const ts = m.timeSignature;
      this.sheet.measures.push(newMeasure(ts.num, ts.den));
      this.cursor.measure++;
      this.cursor.cell = 0;
    }
  },

  advanceBeat() {
    // a beat = 2 half-beat cells for den=4. For other den, ratio differs.
    const m = this.currentMeasure();
    if (!m) return;
    const ts = m.timeSignature;
    const halfBeatsPerBeat = Math.max(1, Math.round(8/ts.den) ); // den=4 => 2
    for (let i = 0; i < halfBeatsPerBeat; i++) this.advanceHalfBeat();
  },

  retreatHalfBeat() {
    if (this.cursor.cell > 0) {
      this.cursor.cell--;
    } else if (this.cursor.measure > 0) {
      this.cursor.measure--;
      this.cursor.cell = this.sheet.measures[this.cursor.measure].cells.length - 1;
    }
  },

  setCursor(mIdx, cIdx) {
    if (mIdx >= 0 && mIdx < this.sheet.measures.length) {
      this.cursor.measure = mIdx;
      const len = this.sheet.measures[mIdx].cells.length;
      this.cursor.cell = Math.max(0, Math.min(cIdx, len - 1));
    }
  },

  clearCurrentCell() {
    const c = this.currentCell();
    if (c) Object.assign(c, newCell());
  },

  addMeasure() {
    const ts = this.sheet.timeSignature;
    this.sheet.measures.push(newMeasure(ts.num, ts.den));
  },

  changeTimeSignatureFromHere(num, den) {
    this.sheet.timeSignature = {num, den};
    // re-shape current and subsequent measures
    for (let i = this.cursor.measure; i < this.sheet.measures.length; i++) {
      const old = this.sheet.measures[i];
      const fresh = newMeasure(num, den);
      // preserve existing cells where possible
      for (let j = 0; j < Math.min(old.cells.length, fresh.cells.length); j++) {
        fresh.cells[j] = old.cells[j];
      }
      this.sheet.measures[i] = fresh;
    }
  },

  serialize() {
    return JSON.stringify(this.sheet);
  },
  deserialize(json) {
    try {
      const obj = JSON.parse(json);
      if (obj && obj.measures && obj.tuning) {
        this.sheet = obj;
        this.cursor = {measure: 0, cell: 0};
        return true;
      }
    } catch (e) { console.warn('load failed', e); }
    return false;
  }
};
