/* Render the tateyoko (vertical) score grid.
 *
 * Layout: Music reads right-to-left, top-to-bottom within a column.
 * For simplicity, we put all measures of the score in one flexbox row
 * (flex-direction: row-reverse, so first measure is rightmost).
 * Inside a measure: each column = 1 beat (for 4/4 = 4 columns); each column
 * contains halfBeatsPerBeat cells stacked vertically.
 *
 * Each cell renders:
 *   - the chord (notes stacked vertically inside the cell)
 *   - any left-side ヲ/オ mark to the left of the note
 *   - rest symbol ○ (quarter), △ (eighth)
 *   - sustain mark ⊙ (or similar)
 *   - unconverted: red placeholder with original pitch text
 */

const REST_GLYPH = { quarter: '○', eighth: '△' };
const SUSTAIN_GLYPH = { quarter: '◉', eighth: '◉' };
const LEFT_MARK_GLYPH = { 'wo': 'ヲ', 'o': 'オ' };

function renderScore(state) {
  const root = document.getElementById('score');
  root.innerHTML = '';
  const sys = document.createElement('div');
  sys.className = 'system';
  root.appendChild(sys);

  state.sheet.measures.forEach((m, mIdx) => {
    const mEl = document.createElement('div');
    mEl.className = 'measure';
    mEl.dataset.measure = mIdx;

    const ts = m.timeSignature;
    const halfBeatsPerBeat = Math.max(1, Math.round(8/ts.den)); // 4/4 -> 2
    const beats = ts.num;

    for (let b = 0; b < beats; b++) {
      const colEl = document.createElement('div');
      colEl.className = 'column';
      for (let h = 0; h < halfBeatsPerBeat; h++) {
        const cellIdx = b * halfBeatsPerBeat + h;
        const cell = m.cells[cellIdx];
        const cEl = renderCell(cell, state.sheet.instrumentType);
        cEl.dataset.measure = mIdx;
        cEl.dataset.cell = cellIdx;
        if (h === halfBeatsPerBeat - 1) cEl.classList.add('beat-end');
        if (state.cursor.measure === mIdx && state.cursor.cell === cellIdx) {
          cEl.classList.add('active');
        }
        colEl.appendChild(cEl);
      }
      mEl.appendChild(colEl);
    }
    sys.appendChild(mEl);
  });

  // attach click handlers for cell selection
  root.querySelectorAll('.cell').forEach(el => {
    el.addEventListener('click', () => {
      const mIdx = parseInt(el.dataset.measure, 10);
      const cIdx = parseInt(el.dataset.cell, 10);
      State.setCursor(mIdx, cIdx);
      renderScore(State);
      document.getElementById('cell-input').focus();
      document.getElementById('cell-input').value = '';
    });
  });
}

function renderCell(cell, instrumentType) {
  const el = document.createElement('div');
  el.className = 'cell';

  if (cell.rest) {
    const s = document.createElement('span');
    s.className = 'rest';
    s.textContent = REST_GLYPH[cell.rest] || '○';
    el.appendChild(s);
    return el;
  }
  if (cell.sustain) {
    const s = document.createElement('span');
    s.className = 'sustain';
    s.textContent = SUSTAIN_GLYPH[cell.sustain] || '◉';
    el.appendChild(s);
    return el;
  }
  if (cell.unconverted && (!cell.notes || cell.notes.length === 0)) {
    el.classList.add('unconverted');
    const s = document.createElement('span');
    s.className = 'unknown';
    s.textContent = cell.unconverted
      .map(p => `${p.octavePref || ''}${p.letter}${p.accidental || ''}`)
      .join(',');
    el.appendChild(s);
    return el;
  }

  // Render notes stacked
  if (cell.notes && cell.notes.length > 0) {
    const stack = document.createElement('div');
    stack.className = 'stack';
    cell.notes.forEach(n => {
      const wrap = document.createElement('div');
      wrap.style.position = 'relative';
      if (n.leftMark) {
        const lm = document.createElement('span');
        lm.className = 'left-mark';
        lm.textContent = LEFT_MARK_GLYPH[n.leftMark] || '';
        wrap.appendChild(lm);
      }
      if (n.stringIndex >= 0) {
        const label = document.createElement('span');
        label.textContent = stringLabel(instrumentType, n.stringIndex) || '?';
        wrap.appendChild(label);
      }
      stack.appendChild(wrap);
    });
    el.appendChild(stack);
  }
  // Append any partially-unconverted notes as red text alongside
  if (cell.unconverted && cell.notes && cell.notes.length > 0) {
    const u = document.createElement('span');
    u.className = 'unknown';
    u.textContent = '+' + cell.unconverted
      .map(p => `${p.octavePref || ''}${p.letter}${p.accidental || ''}`)
      .join(',');
    el.appendChild(u);
    el.classList.add('unconverted');
  }
  return el;
}
