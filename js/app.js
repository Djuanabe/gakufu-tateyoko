/* App glue: wire UI events to state + parser + tuning + render. */

function commitInput(text) {
  const cell = State.currentCell();
  if (!cell) return;
  const parsed = parseCellInput(text);

  if (parsed.type === 'empty') {
    State.advanceHalfBeat();
    return;
  }
  if (parsed.type === 'error') {
    alert(parsed.message);
    return;
  }
  if (parsed.type === 'rest') {
    Object.assign(cell, { rest: parsed.value, sustain: null, notes: [], unconverted: null });
    if (parsed.value === 'quarter') State.advanceBeat();
    else State.advanceHalfBeat();
    return;
  }
  if (parsed.type === 'sustain') {
    Object.assign(cell, { sustain: parsed.value, rest: null, notes: [], unconverted: null });
    // quarter sustain (3) advances a full beat; eighth (4) advances half a beat
    if (parsed.value === 'quarter') State.advanceBeat();
    else State.advanceHalfBeat();
    return;
  }
  if (parsed.type === 'mark') {
    // Standalone ヲ or オ in a cell with no note: store as a "note" with no string
    cell.notes = [{ stringIndex: -1, leftMark: parsed.value, source: null }];
    cell.rest = null; cell.sustain = null; cell.unconverted = null;
    State.advanceHalfBeat();
    return;
  }
  if (parsed.type === 'chord') {
    applyChord(cell, parsed.notes, State.sheet.tuning);
    cell.rest = null; cell.sustain = null;
    cell.raw = text;
    State.advanceHalfBeat();
    return;
  }
}

function refresh() {
  renderScore(State);
}

/* Undo / redo: snapshot the whole sheet + cursor before each mutation. */
const History = {
  undoStack: [],
  redoStack: [],
  snapshot() {
    return JSON.stringify({ sheet: State.sheet, cursor: State.cursor });
  },
  restore(snap) {
    const obj = JSON.parse(snap);
    State.sheet = obj.sheet;
    State.cursor = obj.cursor;
  },
  push() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  },
  undo() {
    if (this.undoStack.length === 0) return;
    this.redoStack.push(this.snapshot());
    this.restore(this.undoStack.pop());
    refresh();
  },
  redo() {
    if (this.redoStack.length === 0) return;
    this.undoStack.push(this.snapshot());
    this.restore(this.redoStack.pop());
    refresh();
  }
};

/* Backspace behavior on an empty input box:
 *   - if the current cell has content -> clear it (delete here)
 *   - else -> move the cursor back one cell
 * So one Backspace steps back onto the last note, the next clears it. */
function handleBackspace() {
  const cell = State.currentCell();
  const hasContent = cell && (
    (cell.notes && cell.notes.length > 0) || cell.rest || cell.sustain || cell.unconverted
  );
  History.push();
  if (hasContent) {
    State.clearCurrentCell();
  } else {
    State.retreatHalfBeat();
  }
  refresh();
}

function buildTuningTable() {
  const tbl = document.getElementById('tuning-table');
  tbl.innerHTML = '';
  const head = document.createElement('tr');
  head.innerHTML = '<th>絃</th><th>音名（例: lc, md, hgs）</th><th>現在の音</th>';
  tbl.appendChild(head);
  const type = State.sheet.instrumentType;
  State.sheet.tuning.forEach((s, idx) => {
    const tr = document.createElement('tr');
    const tdLabel = document.createElement('td');
    tdLabel.textContent = stringLabel(type, idx);
    const tdInput = document.createElement('td');
    const inp = document.createElement('input');
    const cur = `${octavePrefFor(s.octave)}${s.letter.toLowerCase()}${s.accidental || ''}`;
    inp.value = cur;
    inp.addEventListener('change', () => {
      const note = parseNoteToken(inp.value.trim().toLowerCase());
      if (!note) { alert('入力形式が不正です'); inp.value = cur; return; }
      const oct = octaveFromPref(note.octavePref, note.letter);
      const pitch = {letter: note.letter, accidental: note.accidental, octave: oct};
      History.push();
      State.sheet.tuning[idx] = {...pitch, midi: pitchToMidi(pitch)};
      tdMidi.textContent = pitchToMidi(pitch);
      State.reconvertAll();
      refresh();
    });
    tdInput.appendChild(inp);
    const tdMidi = document.createElement('td');
    tdMidi.textContent = s.midi;
    tr.appendChild(tdLabel); tr.appendChild(tdInput); tr.appendChild(tdMidi);
    tbl.appendChild(tr);
  });
}

function octavePrefFor(octave) {
  if (octave >= 6) return 'h';
  if (octave <= 3) return 'l';
  return 'm';   // 4-5 -> m
}
function octaveFromPref(pref, letter) {
  // l=3, m=4, h=6 (matches the koto default tuning's octave layout)
  if (pref === 'h') return 6;
  if (pref === 'l') return 3;
  return 4;
}

document.addEventListener('DOMContentLoaded', () => {
  State.init();

  const input = document.getElementById('cell-input');
  input.addEventListener('keydown', (e) => {
    // Undo / redo (Ctrl+Z / Ctrl+Y, and Ctrl+Shift+Z for redo)
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      History.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' ||
        (e.shiftKey && e.key.toLowerCase() === 'z'))) {
      e.preventDefault();
      History.redo();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      History.push();
      commitInput(input.value);
      input.value = '';
      refresh();
      return;
    }
    if (e.key === 'Backspace' && input.value === '') {
      // empty box: step back / delete instead of editing text
      e.preventDefault();
      handleBackspace();
      return;
    }
  });

  document.getElementById('next-cell').addEventListener('click', () => {
    State.advanceHalfBeat();
    refresh();
  });
  document.getElementById('prev-cell').addEventListener('click', () => {
    State.retreatHalfBeat();
    refresh();
  });
  document.getElementById('del-cell').addEventListener('click', () => {
    History.push();
    State.clearCurrentCell();
    refresh();
  });
  document.getElementById('add-measure').addEventListener('click', () => {
    History.push();
    State.addMeasure();
    // jump cursor to the new measure so the viewport scrolls to show it
    State.setCursor(State.sheet.measures.length - 1, 0);
    refresh();
  });

  const jumpInput = document.getElementById('jump-measure');
  const doJump = () => {
    const n = parseInt(jumpInput.value, 10);
    if (!isNaN(n) && n >= 1 && n <= State.sheet.measures.length) {
      State.setCursor(n - 1, 0);
      refresh();
      document.getElementById('cell-input').focus();
    }
  };
  document.getElementById('jump-btn').addEventListener('click', doJump);
  jumpInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doJump(); }
  });

  document.getElementById('instrument-type').addEventListener('change', (e) => {
    History.push();
    State.setInstrumentType(e.target.value);
    State.reconvertAll();
    refresh();
  });

  document.getElementById('apply-ts').addEventListener('click', () => {
    History.push();
    const num = parseInt(document.getElementById('ts-num').value, 10) || 4;
    const den = parseInt(document.getElementById('ts-den').value, 10) || 4;
    State.changeTimeSignatureFromHere(num, den);
    refresh();
  });

  document.getElementById('open-tuning').addEventListener('click', () => {
    buildTuningTable();
    document.getElementById('tuning-modal').classList.remove('hidden');
  });
  document.getElementById('tuning-close').addEventListener('click', () => {
    document.getElementById('tuning-modal').classList.add('hidden');
    refresh();
  });

  document.getElementById('save').addEventListener('click', () => {
    localStorage.setItem('gakufu', State.serialize());
    alert('保存しました');
  });
  document.getElementById('load').addEventListener('click', () => {
    const data = localStorage.getItem('gakufu');
    if (data && State.deserialize(data)) {
      document.getElementById('instrument-type').value = State.sheet.instrumentType;
      refresh();
      alert('読み込みました');
    } else {
      alert('保存データがありません');
    }
  });

  document.getElementById('clef').addEventListener('change', renderStaff);
  document.getElementById('key-sig').addEventListener('change', renderStaff);

  renderStaff();
  refresh();
  input.focus();
});
