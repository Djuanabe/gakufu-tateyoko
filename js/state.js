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
    {letter:'D', accidental:'', octave:3},
    {letter:'G', accidental:'', octave:3},
    {letter:'A', accidental:'', octave:3},
    {letter:'B', accidental:'f', octave:3},
    {letter:'D', accidental:'', octave:4},
    {letter:'E', accidental:'f', octave:4},
    {letter:'G', accidental:'', octave:4},
    {letter:'A', accidental:'', octave:4},
    {letter:'B', accidental:'f', octave:4},
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
  return { notes: [], rest: null, sustain: null, unconverted: null, raw: '',
           tuplet: null, circled: false, centerText: [], left: [], right: [] };
}

// Smallest cell = a sixteenth note (= quarter of a beat when den=4).
function cellsPerBeat(den) { return Math.max(1, Math.round(16 / den)); }

function newMeasure(num, den) {
  const cellCount = num * cellsPerBeat(den);
  const cells = [];
  for (let i = 0; i < cellCount; i++) cells.push(newCell());
  return { timeSignature: {num, den}, cells };
}

const State = {
  sheet: {
    instrumentType: '13',
    timeSignature: {num:4, den:4},
    // Ordered list of tuning sections. The first (fromMeasure 0) is the base
    // tuning; later entries override it from their measure onward.
    tunings: [{ fromMeasure: 0, tuning: defaultTuning13() }],
    // Ensemble parts (重奏). parts[0] = 第1, parts[1] = 第2 (optional). Every
    // part keeps the same number of measures / time signatures (they play
    // together); only the cell contents differ.
    parts: [{ measures: [] }],
    // Free-form drawings overlaid on the score (straight / wavy / arrow),
    // constrained to horizontal or vertical. Coords are px within the system.
    drawings: []
  },
  // unit = the "length" the cursor currently represents: 'half' (eighth) or
  // 'quarter' (sixteenth). It drives how far Backspace retreats over blanks.
  // part = which ensemble part is being edited (0 = 第1, 1 = 第2).
  cursor: { part: 0, measure: 0, cell: 0, unit: 'half' },

  init() {
    // Start with 4 empty measures in the first part
    for (let i = 0; i < 4; i++) {
      this.sheet.parts[0].measures.push(newMeasure(4, 4));
    }
  },

  // The measures of the score being edited (single part; parts[0]).
  activeMeasures() { return this.sheet.parts[this.cursor.part].measures; },

  setInstrumentType(type) {
    this.sheet.instrumentType = type;
    // string count changes -> reset to a single base tuning for the new instrument
    this.sheet.tunings = [{ fromMeasure: 0, tuning: type === '17' ? defaultTuning17() : defaultTuning13() }];
  },

  /* Tuning sections ---------------------------------------------------- */
  baseTuning() { return this.sheet.tunings[0].tuning; },

  // The tuning in effect at a given measure index.
  tuningForMeasure(mIdx) {
    let chosen = this.sheet.tunings[0];
    for (const t of this.sheet.tunings) {
      if (t.fromMeasure <= mIdx) chosen = t;
      else break;
    }
    return chosen.tuning;
  },

  tuningForCursor() { return this.tuningForMeasure(this.cursor.measure); },

  // Add (or fetch) a tuning section starting at the given measure, seeded
  // with a deep copy of whatever tuning is currently active there.
  addTuningChange(fromMeasure) {
    const existing = this.sheet.tunings.find(t => t.fromMeasure === fromMeasure);
    if (existing) return existing;
    const seed = JSON.parse(JSON.stringify(this.tuningForMeasure(fromMeasure)));
    const entry = { fromMeasure, tuning: seed };
    this.sheet.tunings.push(entry);
    this.sheet.tunings.sort((a, b) => a.fromMeasure - b.fromMeasure);
    return entry;
  },

  removeTuningChange(fromMeasure) {
    if (fromMeasure === 0) return; // base cannot be removed
    this.sheet.tunings = this.sheet.tunings.filter(t => t.fromMeasure !== fromMeasure);
  },

  currentMeasure() { return this.activeMeasures()[this.cursor.measure]; },
  currentCell() {
    const m = this.currentMeasure();
    return m ? m.cells[this.cursor.cell] : null;
  },

  // Move one sixteenth-note cell forward (the smallest step).
  advanceSixteenth() {
    const m = this.currentMeasure();
    if (!m) return;
    if (this.cursor.cell < m.cells.length - 1) {
      this.cursor.cell++;
    } else if (this.cursor.measure < this.activeMeasures().length - 1) {
      this.cursor.measure++;
      this.cursor.cell = 0;
    } else {
      // append a new measure (same time signature) to every part so the
      // ensemble parts stay aligned
      const ts = m.timeSignature;
      this.sheet.parts.forEach(p => p.measures.push(newMeasure(ts.num, ts.den)));
      this.cursor.measure++;
      this.cursor.cell = 0;
    }
  },

  advanceHalfBeat() {
    const ts = this.currentMeasure() ? this.currentMeasure().timeSignature : {den:4};
    const steps = Math.max(1, Math.round(cellsPerBeat(ts.den) / 2)); // den=4 => 2 (an eighth)
    for (let i = 0; i < steps; i++) this.advanceSixteenth();
  },

  advanceBeat() {
    const ts = this.currentMeasure() ? this.currentMeasure().timeSignature : {den:4};
    const steps = cellsPerBeat(ts.den); // den=4 => 4
    for (let i = 0; i < steps; i++) this.advanceSixteenth();
  },

  // Move one sixteenth (quarter-beat) cell backward, crossing measures.
  retreatSixteenth() {
    if (this.cursor.cell > 0) {
      this.cursor.cell--;
    } else if (this.cursor.measure > 0) {
      this.cursor.measure--;
      this.cursor.cell = this.activeMeasures()[this.cursor.measure].cells.length - 1;
    }
  },

  // A half beat (eighth) = two sixteenth cells.
  retreatHalfBeat() {
    const ts = this.currentMeasure() ? this.currentMeasure().timeSignature : {den:4};
    const steps = Math.max(1, Math.round(cellsPerBeat(ts.den) / 2)); // den=4 => 2
    for (let i = 0; i < steps; i++) this.retreatSixteenth();
  },

  // The "length" of the note name occupying a cell: an eighth ('half') when it
  // sits on an eighth boundary with an empty following sixteenth, otherwise a
  // sixteenth ('quarter').
  noteUnitAt(mIdx, cIdx) {
    const m = this.activeMeasures()[mIdx];
    if (!m) return 'half';
    if (cIdx % 2 === 1) return 'quarter';
    const next = m.cells[cIdx + 1];
    const nextHas = next && ((next.notes && next.notes.length) || next.rest || next.sustain || next.unconverted);
    return nextHas ? 'quarter' : 'half';
  },

  // After a move, make the cursor's unit follow whatever note name is now under
  // it (blank cell => half-beat cursor).
  syncUnitToCell() {
    const c = this.currentCell();
    const has = c && ((c.notes && c.notes.length) || c.rest || c.sustain || c.unconverted);
    this.cursor.unit = has ? this.noteUnitAt(this.cursor.measure, this.cursor.cell) : 'half';
  },

  setCursor(mIdx, cIdx, partIdx) {
    if (partIdx != null && partIdx >= 0 && partIdx < this.sheet.parts.length) {
      this.cursor.part = partIdx;
    }
    const measures = this.activeMeasures();
    if (mIdx >= 0 && mIdx < measures.length) {
      this.cursor.measure = mIdx;
      const len = measures[mIdx].cells.length;
      this.cursor.cell = Math.max(0, Math.min(cIdx, len - 1));
      this.syncUnitToCell();
    }
  },

  clearCurrentCell() {
    const c = this.currentCell();
    if (c) Object.assign(c, newCell());
  },

  /* Tuplets ------------------------------------------------------------ *
   * A tuplet tags N consecutive cells (one note per cell) as a group,
   * labelled with N (3=三連符, 5=五連符...). `beats` records the intended
   * duration in beats (e.g. 2拍三連符 -> n:3, beats:2) for display. */
  _tupletSeq: 0,
  // n notes redistributed over `beats` beats. Reserves beats*cellsPerBeat
  // sixteenth cells (so measure timing stays aligned); the first n hold the
  // notes (pos 0..n-1) and the rest are filler (pos null).
  markTupletAtCursor(n, beats) {
    const m = this.currentMeasure();
    if (!m) return;
    const per = cellsPerBeat(m.timeSignature.den);
    // snap start down to an eighth boundary so the grid stays aligned
    let start = this.cursor.cell - (this.cursor.cell % 2);
    const span = Math.min(beats * per, m.cells.length - start);
    if (span < n) return; // not enough room
    const id = ++this._tupletSeq;
    for (let i = start; i < start + span; i++) {
      const rel = i - start;
      const pos = rel < n ? rel : null;
      if (pos === null) Object.assign(m.cells[i], newCell()); // clear filler
      m.cells[i].tuplet = { id, n, beats, span, pos };
    }
    this.cursor.cell = start; // park on the first slot
  },
  clearTupletAtCursor() {
    const m = this.currentMeasure();
    const c = this.currentCell();
    if (!m || !c || !c.tuplet) return;
    const id = c.tuplet.id;
    for (const cell of m.cells) {
      if (cell.tuplet && cell.tuplet.id === id) cell.tuplet = null;
    }
  },

  /* Drawings ---------------------------------------------------------- */
  addDrawing(type, orient) {
    if (!this.sheet.drawings) this.sheet.drawings = [];
    this.sheet.drawings.push({ type, orient, x: 24, y: 24, length: 120 });
    return this.sheet.drawings.length - 1;
  },
  // Free-form text annotation overlay (separate type stored in drawings).
  addText(text, orient) {
    if (!this.sheet.drawings) this.sheet.drawings = [];
    this.sheet.drawings.push({ type: 'text', text: text || '文章', orient: orient || 'h', x: 24, y: 24 });
    return this.sheet.drawings.length - 1;
  },
  setDrawingText(idx, text) {
    const d = this.sheet.drawings[idx];
    if (d && d.type === 'text') d.text = text;
  },
  removeDrawing(idx) {
    if (this.sheet.drawings && idx >= 0 && idx < this.sheet.drawings.length) {
      this.sheet.drawings.splice(idx, 1);
    }
  },

  // If the cursor sits on a tuplet slot, advance to the next slot, or out of
  // the tuplet after the last slot. Returns true if it handled the advance.
  advanceTupletSlot() {
    const c = this.currentCell();
    if (!c || !c.tuplet || c.tuplet.pos == null) return false;
    const t = c.tuplet;
    const m = this.currentMeasure();
    const slotStart = this.cursor.cell - t.pos;
    if (t.pos < t.n - 1) {
      this.cursor.cell = slotStart + t.pos + 1;
    } else {
      // exit past the whole tuplet span
      const exit = slotStart + t.span;
      if (exit < m.cells.length) this.cursor.cell = exit;
      else this.advanceSixteenth();
    }
    return true;
  },

  /* Re-run pitch->string conversion for every cell, using the original
   * pitch info stored in note.source (or in cell.unconverted). Standalone
   * marks (no source) are left untouched. */
  reconvertAll() {
    this.sheet.parts.forEach(part => {
      part.measures.forEach((m, mIdx) => {
        const tuning = this.tuningForMeasure(mIdx);
        for (const c of m.cells) {
          const pitches = [];
          const standalone = [];
          if (c.notes && c.notes.length > 0) {
            for (const n of c.notes) {
              if (n.source) pitches.push(n.source);
              else if (n.stringIndex < 0 && n.leftMark) standalone.push(n);
            }
          }
          if (c.unconverted) for (const p of c.unconverted) pitches.push(p);
          if (pitches.length === 0) continue;
          applyChord(c, pitches, tuning);
          if (standalone.length > 0) {
            c.notes = [...standalone, ...(c.notes || [])];
          }
        }
      });
    });
  },

  addMeasure() {
    const ts = this.sheet.timeSignature;
    // keep every part the same length
    this.sheet.parts.forEach(p => p.measures.push(newMeasure(ts.num, ts.den)));
  },

  changeTimeSignatureFromHere(num, den) {
    this.sheet.timeSignature = {num, den};
    // re-shape current and subsequent measures in every part
    this.sheet.parts.forEach(part => {
      for (let i = this.cursor.measure; i < part.measures.length; i++) {
        const old = part.measures[i];
        const fresh = newMeasure(num, den);
        // preserve existing cells where possible
        for (let j = 0; j < Math.min(old.cells.length, fresh.cells.length); j++) {
          fresh.cells[j] = old.cells[j];
        }
        part.measures[i] = fresh;
      }
    });
  },

  serialize() {
    return JSON.stringify(this.sheet);
  },
  deserialize(json) {
    try {
      const obj = JSON.parse(json);
      if (obj && (obj.parts || obj.measures) && (obj.tunings || obj.tuning)) {
        // migrate old single-tuning saves
        if (!obj.tunings && obj.tuning) {
          obj.tunings = [{ fromMeasure: 0, tuning: obj.tuning }];
          delete obj.tuning;
        }
        // migrate old single-part saves (sheet.measures -> sheet.parts[0])
        if (!obj.parts && obj.measures) {
          obj.parts = [{ measures: obj.measures }];
          delete obj.measures;
        }
        if (!obj.drawings) obj.drawings = [];
        this.sheet = obj;
        this.cursor = {part: 0, measure: 0, cell: 0, unit: 'half'};
        return true;
      }
    } catch (e) { console.warn('load failed', e); }
    return false;
  }
};
