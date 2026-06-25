/* Render the tateyoko (vertical) score grid.
 *
 * Layout: Music reads right-to-left. Each MEASURE is one vertical column
 * (so roughly one measure fits in a column, like real 縦譜). Cells stack
 * top-to-bottom inside the measure column. Measures are laid out
 * right-to-left in a "system".
 *
 * Each cell renders:
 *   - the chord (notes stacked vertically inside the cell)
 *   - any left-side ヲ/オ mark to the LEFT of the kanji
 *   - rest symbol ○ (quarter), △ (eighth)
 *   - sustain mark ◉ (quarter), △+• (eighth / half-beat)
 *   - unconverted: red placeholder with original pitch text
 */

const REST_GLYPH = { quarter: '○', eighth: '△' };
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
    const halfBeatsPerBeat = Math.max(1, Math.round(8 / ts.den)); // 4/4 -> 2

    m.cells.forEach((cell, cellIdx) => {
      const cEl = renderCell(cell, state.sheet.instrumentType);
      cEl.dataset.measure = mIdx;
      cEl.dataset.cell = cellIdx;
      // heavier line at the end of each beat
      if ((cellIdx + 1) % halfBeatsPerBeat === 0) cEl.classList.add('beat-end');
      if (state.cursor.measure === mIdx && state.cursor.cell === cellIdx) {
        cEl.classList.add('active');
      }
      mEl.appendChild(cEl);
    });
    sys.appendChild(mEl);
  });

  // attach click handlers for cell selection
  root.querySelectorAll('.cell').forEach(el => {
    el.addEventListener('click', () => {
      const mIdx = parseInt(el.dataset.measure, 10);
      const cIdx = parseInt(el.dataset.cell, 10);
      State.setCursor(mIdx, cIdx);
      renderScore(State);
      const inp = document.getElementById('cell-input');
      inp.focus();
      inp.value = '';
    });
  });

  // Keep the cursor cell scrolled into view inside the fixed-size viewport.
  const active = root.querySelector('.cell.active');
  if (active) {
    const r = active.getBoundingClientRect();
    const sr = root.getBoundingClientRect();
    if (r.left < sr.left || r.right > sr.right) {
      const measureEl = active.closest('.measure');
      if (measureEl) {
        const offset = measureEl.offsetLeft - (root.clientWidth / 2 - measureEl.clientWidth / 2);
        root.scrollLeft = offset;
      }
    }
  }

  // Update the measure-info readout (e.g. "5 / 8")
  const info = document.getElementById('measure-info');
  if (info) {
    info.textContent = `${state.cursor.measure + 1} / ${state.sheet.measures.length}小節`;
  }
}

function makeSustainGlyph(kind) {
  // quarter -> ◉ (circle with dot); eighth/half -> triangle with black dot
  const wrap = document.createElement('span');
  wrap.className = 'sustain';
  if (kind === 'eighth') {
    wrap.classList.add('tri-dot');
    const tri = document.createElement('span');
    tri.className = 'tri';
    tri.textContent = '△';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.textContent = '●';
    wrap.appendChild(tri);
    wrap.appendChild(dot);
  } else {
    wrap.textContent = '◉';
  }
  return wrap;
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
    el.appendChild(makeSustainGlyph(cell.sustain));
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

  // Render notes side-by-side (chord = horizontal); each note is [mark][kanji].
  if (cell.notes && cell.notes.length > 0) {
    const stack = document.createElement('div');
    const n = cell.notes.length;
    stack.className = 'stack ' + (n > 1 ? 'chord' : 'single');
    // shrink chords so they never overflow the cell (squishing is OK)
    if (n > 1) {
      const scale = Math.max(0.4, 1 / Math.sqrt(n));
      stack.style.fontSize = (1.15 * scale) + 'em';
      stack.style.lineHeight = '0.9';
    }
    cell.notes.forEach(n => {
      const row = document.createElement('div');
      row.className = 'note-row';

      const lm = document.createElement('span');
      lm.className = 'left-mark';
      lm.textContent = n.leftMark ? (LEFT_MARK_GLYPH[n.leftMark] || '') : '';
      row.appendChild(lm);

      if (n.stringIndex >= 0) {
        const label = document.createElement('span');
        label.className = 'kanji';
        label.textContent = stringLabel(instrumentType, n.stringIndex) || '?';
        row.appendChild(label);
      }
      stack.appendChild(row);
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
