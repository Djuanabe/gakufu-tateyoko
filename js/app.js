/* App glue: wire UI events to state + parser + tuning + render. */

/* Write the parsed input into the current cell WITHOUT moving the cursor.
 * Returns a hint describing the natural advance for the Enter key:
 *   'beat' | 'half' | 'empty' | 'error' | 'done'
 * (Space always advances a single sixteenth regardless of the hint.) */
function applyInputToCell(text, opts) {
  const cell = State.currentCell();
  if (!cell) return 'done';
  const circle = !!(opts && opts.circle);
  const parsed = parseCellInput(text);

  if (parsed.type === 'empty') return 'empty';
  if (parsed.type === 'error') { alert(parsed.message); return 'error'; }

  if (parsed.type === 'rest') {
    Object.assign(cell, { rest: parsed.value, sustain: null, notes: [], unconverted: null, circled: false });
    return parsed.value === 'quarter' ? 'beat' : 'half';
  }
  if (parsed.type === 'sustain') {
    Object.assign(cell, { sustain: parsed.value, rest: null, notes: [], unconverted: null, circled: false });
    return parsed.value === 'quarter' ? 'beat' : 'half';
  }
  if (parsed.type === 'mark') {
    cell.notes = [{ stringIndex: -1, leftMark: parsed.value, source: null }];
    cell.rest = null; cell.sustain = null; cell.unconverted = null; cell.circled = circle;
    cell.centerText = []; cell.left = [];
    return 'half';
  }
  if (parsed.type === 'composite') {
    applyChord(cell, parsed.notes, State.tuningForCursor()); // sets notes + unconverted
    cell.left = parsed.left;        // katakana/text symbols, placed to the left
    cell.centerText = [];
    cell.rest = null; cell.sustain = null;
    cell.raw = text;
    cell.circled = circle; // 和音もまとめて○で囲む
    return 'half';
  }
  return 'done';
}

// Enter: write the cell and advance by the natural duration. Inside a tuplet,
// advance slot-to-slot instead.
function commitEnter(text, opts) {
  const inTuplet = (() => { const c = State.currentCell(); return c && c.tuplet && c.tuplet.pos != null; })();
  const hint = applyInputToCell(text, opts);
  if (hint === 'error') return false;
  if (inTuplet) { State.advanceTupletSlot(); return true; }
  if (hint === 'empty') State.advanceHalfBeat();
  else if (hint === 'beat') State.advanceBeat();
  else State.advanceHalfBeat();
  return true;
}

// Space: quarter-beat (sixteenth) step. Empty -> place 三角＋黒丸; else write cell.
// Inside a tuplet, Space also moves slot-to-slot.
function commitSpace(text, opts) {
  const c0 = State.currentCell();
  const inTuplet = c0 && c0.tuplet && c0.tuplet.pos != null;
  if (text.trim() === '') {
    const cell = State.currentCell();
    if (cell) {
      const keepTuplet = cell.tuplet;
      Object.assign(cell, newCell(), { sustain: 'eighth' }); // △＋黒丸
      if (keepTuplet) cell.tuplet = keepTuplet;
    }
    if (inTuplet) State.advanceTupletSlot(); else State.advanceSixteenth();
    return true;
  }
  const hint = applyInputToCell(text, opts);
  if (hint === 'error') return false;
  if (inTuplet) State.advanceTupletSlot(); else State.advanceSixteenth();
  return true;
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
  // Backspace always steps back half a beat.
  State.retreatHalfBeat();
  refresh();
}

// Which tuning section (by fromMeasure) is currently shown in the modal.
let editingTuningFrom = 0;

function openTuningModal() {
  // default to the section that governs the cursor's measure
  let from = 0;
  for (const t of State.sheet.tunings) {
    if (t.fromMeasure <= State.cursor.measure) from = t.fromMeasure; else break;
  }
  editingTuningFrom = from;
  tuningPick = [];
  updateTuningCount();
  buildTuningSections();
  buildTuningTable();
  document.getElementById('tuning-modal').classList.remove('hidden');
  // Render the modal's own sample staff (takes over the shared staff selection
  // state while open; the main staff is re-rendered when the modal closes).
  renderTuningStaff();
}

function renderTuningStaff() {
  renderStaff({ svgId: 'tuning-staff-svg', clefId: 'tuning-clef', keyId: 'tuning-key-sig' });
}

/* Staff-based tuning entry: pick notes on the sample staff, then 決定 assigns
 * them (sorted low -> high) to strings 一, 二, ... */
let tuningPick = []; // [{letter, accidental, octave, midi}]
function tuningModalOpen() {
  return !document.getElementById('tuning-modal').classList.contains('hidden');
}
function onStaffPick(token) {
  if (tuningModalOpen()) addTuningPick(token);
  else appendToCellInput(token);
}
function addTuningPick(token) {
  if (!token) return;
  const note = parseNoteToken(token.toLowerCase());
  if (!note) return;
  const pitch = { letter: note.letter, accidental: note.accidental, octave: note.octave };
  tuningPick.push({ ...pitch, midi: pitchToMidi(pitch) });
  updateTuningCount();
}
function updateTuningCount() {
  const need = stringCount(State.sheet.instrumentType);
  const el = document.getElementById('tuning-staff-count');
  if (el) el.textContent = `選択 ${tuningPick.length} / ${need}`;
}
function applyTuningPick() {
  const need = stringCount(State.sheet.instrumentType);
  if (tuningPick.length !== need) {
    alert(`${need}個の音符を選んでください（現在 ${tuningPick.length} 個）`);
    return;
  }
  History.push();
  const sorted = [...tuningPick].sort((a, b) => a.midi - b.midi);
  currentTuningEntry().tuning = sorted.map(p => ({
    letter: p.letter, accidental: p.accidental, octave: p.octave, midi: p.midi
  }));
  tuningPick = [];
  updateTuningCount();
  buildTuningTable();
  State.reconvertAll();
  refresh();
}

function buildTuningSections() {
  const sel = document.getElementById('tuning-section');
  sel.innerHTML = '';
  State.sheet.tunings.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.fromMeasure;
    opt.textContent = t.fromMeasure === 0
      ? '1小節〜（基本調弦）'
      : `${t.fromMeasure + 1}小節〜`;
    sel.appendChild(opt);
  });
  sel.value = String(editingTuningFrom);
  // disable remove for the base section
  document.getElementById('tuning-remove').disabled = (editingTuningFrom === 0);
}

function currentTuningEntry() {
  return State.sheet.tunings.find(t => t.fromMeasure === editingTuningFrom)
      || State.sheet.tunings[0];
}

function buildTuningTable() {
  const tbl = document.getElementById('tuning-table');
  tbl.innerHTML = '';
  const head = document.createElement('tr');
  head.innerHTML = '<th>絃</th><th>音名（例: 3c, 4d, 5gs, 6ef）</th><th>現在の音</th>';
  tbl.appendChild(head);
  const type = State.sheet.instrumentType;
  const tuning = currentTuningEntry().tuning;
  tuning.forEach((s, idx) => {
    const tr = document.createElement('tr');
    const tdLabel = document.createElement('td');
    tdLabel.textContent = stringLabel(type, idx);
    const tdInput = document.createElement('td');
    const inp = document.createElement('input');
    const cur = tuningPitchToText(s);
    inp.value = cur;
    inp.addEventListener('change', () => {
      const pitch = parseTuningPitch(inp.value.trim().toLowerCase());
      if (!pitch) { alert('入力形式が不正です'); inp.value = cur; return; }
      History.push();
      tuning[idx] = {...pitch, midi: pitchToMidi(pitch)};
      tdMidi.textContent = pitchToMidi(pitch);
      inp.value = tuningPitchToText(tuning[idx]);
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

// Display a tuning pitch in the "<octave><letter><acc>" form, e.g. 3c, 4ef.
function tuningPitchToText(s) {
  return `${s.octave}${s.letter.toLowerCase()}${s.accidental || ''}`;
}

// Parse a tuning pitch using the same note format (octave digit recommended).
function parseTuningPitch(str) {
  const note = parseNoteToken(str);
  if (!note) return null;
  return { letter: note.letter, accidental: note.accidental, octave: note.octave };
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
      commitEnter(input.value, { circle: e.shiftKey }); // Shift+Enter -> ○囲み
      input.value = '';
      refresh();
      return;
    }
    if (e.key === ' ' || e.code === 'Space') {
      // Space = quarter-beat (sixteenth) step
      e.preventDefault();
      History.push();
      commitSpace(input.value, { circle: e.shiftKey }); // Shift+Space -> ○囲み
      input.value = '';
      refresh();
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      moveStaffSel(+1); // higher pitch
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      moveStaffSel(-1); // lower pitch
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

  document.getElementById('tuplet-add').addEventListener('click', () => {
    History.push();
    const n = parseInt(document.getElementById('tuplet-n').value, 10) || 3;
    const beats = parseInt(document.getElementById('tuplet-beats').value, 10) || 1;
    State.markTupletAtCursor(n, beats);
    refresh();
    document.getElementById('cell-input').focus();
  });
  document.getElementById('tuplet-clear').addEventListener('click', () => {
    History.push();
    State.clearTupletAtCursor();
    refresh();
  });

  document.getElementById('draw-add').addEventListener('click', () => {
    History.push();
    const type = document.getElementById('draw-type').value;
    const orient = document.getElementById('draw-orient').value;
    selectedDrawingIdx = State.addDrawing(type, orient);
    refresh();
  });
  document.getElementById('draw-del').addEventListener('click', () => {
    if (selectedDrawingIdx < 0) return;
    History.push();
    State.removeDrawing(selectedDrawingIdx);
    selectedDrawingIdx = -1;
    refresh();
  });
  // Delete key removes the selected drawing (when not typing in a field)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    if (selectedDrawingIdx < 0) return;
    e.preventDefault();
    History.push();
    State.removeDrawing(selectedDrawingIdx);
    selectedDrawingIdx = -1;
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

  document.getElementById('open-tuning').addEventListener('click', openTuningModal);
  document.getElementById('tuning-close').addEventListener('click', () => {
    document.getElementById('tuning-modal').classList.add('hidden');
    renderStaff(); // restore the main-panel staff + its selection state
    refresh();
  });
  document.getElementById('tuning-clef').addEventListener('change', renderTuningStaff);
  document.getElementById('tuning-key-sig').addEventListener('change', renderTuningStaff);
  document.getElementById('tuning-section').addEventListener('change', (e) => {
    editingTuningFrom = parseInt(e.target.value, 10) || 0;
    buildTuningSections();
    buildTuningTable();
  });
  document.getElementById('tuning-add').addEventListener('click', () => {
    History.push();
    const entry = State.addTuningChange(State.cursor.measure);
    editingTuningFrom = entry.fromMeasure;
    buildTuningSections();
    buildTuningTable();
    State.reconvertAll();
    refresh();
  });
  document.getElementById('tuning-remove').addEventListener('click', () => {
    if (editingTuningFrom === 0) return;
    History.push();
    State.removeTuningChange(editingTuningFrom);
    editingTuningFrom = 0;
    buildTuningSections();
    buildTuningTable();
    State.reconvertAll();
    refresh();
  });

  document.getElementById('tuning-staff-add').addEventListener('click', () => {
    addTuningPick(selectedStaffToken());
  });
  document.getElementById('tuning-staff-undo').addEventListener('click', () => {
    tuningPick.pop(); updateTuningCount();
  });
  document.getElementById('tuning-staff-reset').addEventListener('click', () => {
    tuningPick = []; updateTuningCount();
  });
  document.getElementById('tuning-staff-apply').addEventListener('click', applyTuningPick);

  // Arrow keys move the staff selection while the tuning modal is open
  // (unless a text input has focus, where arrows move the caret).
  document.addEventListener('keydown', (e) => {
    if (!tuningModalOpen()) return;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); moveStaffSel(+1); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); moveStaffSel(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); addTuningPick(selectedStaffToken()); }
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
  document.getElementById('staff-pick').addEventListener('click', () => {
    const tok = selectedStaffToken();
    if (tok) appendToCellInput(tok);
  });

  renderStaff();
  refresh();
  input.focus();
});
