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

// Display sizes. Data is stored as sixteenth cells, but a sixteenth is only
// shown at half size where it's actually used (via Space); otherwise an
// eighth (= 2 sixteenths) is drawn at full size.
const H8 = 40;        // eighth-note cell height (px)
const H16 = H8 / 2;   // sixteenth-note cell height (px)

function cellHasContent(c) {
  return !!(c && ((c.notes && c.notes.length > 0) || c.rest || c.sustain || c.unconverted));
}

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
    const perBeat = Math.max(1, Math.round(16 / ts.den));        // sixteenth cells per beat (4/4 -> 4)
    const eighthsPerBeat = Math.max(1, Math.round(perBeat / 2)); // 4/4 -> 2
    const beatH = eighthsPerBeat * H8;

    // mark a tuning change that begins at this measure
    if (state.sheet.tunings &&
        state.sheet.tunings.some(t => t.fromMeasure === mIdx && mIdx > 0)) {
      mEl.classList.add('tuning-change');
      const badge = document.createElement('div');
      badge.className = 'tuning-badge';
      badge.textContent = '調弦変更';
      mEl.appendChild(badge);
    }

    const cursorHere = (idx) => state.cursor.measure === mIdx && state.cursor.cell === idx;
    const type = state.sheet.instrumentType;
    const cells = m.cells;

    let i = 0;
    while (i < cells.length) {
      const cell = cells[i];

      // ---- Tuplet block (redistributed over its beats) ----
      if (cell.tuplet && cell.tuplet.pos === 0) {
        const t = cell.tuplet;
        const span = t.span;
        const blockH = t.beats * beatH;
        const slotH = blockH / t.n;
        const block = document.createElement('div');
        block.className = 'tuplet-block';
        block.style.height = blockH + 'px';

        for (let s = 0; s < t.n; s++) {
          const idx = i + s;
          const cEl = renderCell(cells[idx], type);
          cEl.style.height = slotH + 'px';
          cEl.classList.add('tuplet');
          cEl.dataset.measure = mIdx;
          cEl.dataset.cell = idx;
          cEl.dataset.tupletId = t.id;
          cEl.dataset.tupletN = t.n;
          if (cursorHere(idx)) cEl.classList.add('active');
          block.appendChild(cEl);
        }
        // short ticks where the tuplet crosses an internal beat boundary
        for (let b = 1; b < t.beats; b++) {
          const tick = document.createElement('div');
          tick.className = 'tuplet-beat-tick';
          tick.style.top = (b * beatH) + 'px';
          block.appendChild(tick);
        }
        mEl.appendChild(block);
        i += span;
        continue;
      }

      // ---- Normal eighth pair (cells i, i+1) ----
      const next = cells[i + 1];
      const subdivided = cellHasContent(next) || cursorHere(i + 1);
      const endsBeat = ((i + 2) % perBeat === 0);

      if (subdivided) {
        const a = renderCell(cell, type);
        a.style.height = H16 + 'px';
        a.dataset.measure = mIdx; a.dataset.cell = i;
        if (cursorHere(i)) a.classList.add('active');
        mEl.appendChild(a); // no divider line under the first sixteenth

        const b = renderCell(next || newCell(), type);
        b.style.height = H16 + 'px';
        b.dataset.measure = mIdx; b.dataset.cell = i + 1;
        b.classList.add(endsBeat ? 'beat-end' : 'eighth-end');
        if (cursorHere(i + 1)) b.classList.add('active');
        mEl.appendChild(b);
      } else {
        const a = renderCell(cell, type);
        a.style.height = H8 + 'px';
        a.dataset.measure = mIdx; a.dataset.cell = i;
        a.classList.add(endsBeat ? 'beat-end' : 'eighth-end');
        if (cursorHere(i)) a.classList.add('active');
        mEl.appendChild(a);
      }
      i += 2;
    }
    sys.appendChild(mEl);
  });

  // Draw tuplet brackets (needs the cells laid out in the DOM for offsets).
  drawTupletBrackets(root);

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
    // vertical: keep the active cell within the viewport height
    if (r.top < sr.top || r.bottom > sr.bottom) {
      root.scrollTop += (r.top - sr.top) - root.clientHeight / 2 + r.height / 2;
    }
  }

  // Update the measure-info readout (e.g. "5 / 8")
  const info = document.getElementById('measure-info');
  if (info) {
    info.textContent = `${state.cursor.measure + 1} / ${state.sheet.measures.length}小節`;
  }
}

const SVGNS = 'http://www.w3.org/2000/svg';

// Overlay a slur-like curve + number on each run of tuplet cells.
function drawTupletBrackets(root) {
  root.querySelectorAll('.measure').forEach(mEl => {
    const cells = [...mEl.querySelectorAll('.cell.tuplet')];
    let i = 0;
    while (i < cells.length) {
      const id = cells[i].dataset.tupletId;
      const n = cells[i].dataset.tupletN;
      let j = i;
      while (j + 1 < cells.length && cells[j + 1].dataset.tupletId === id) j++;
      const first = cells[i], last = cells[j];
      // measure offsets via rects (slots live inside a positioned block)
      const mRect = mEl.getBoundingClientRect();
      const fRect = first.getBoundingClientRect();
      const lRect = last.getBoundingClientRect();
      const top = fRect.top - mRect.top;
      const h = lRect.bottom - fRect.top;

      const W = 16; // bracket width to the right of the column
      const wrap = document.createElement('div');
      wrap.className = 'tuplet-bracket';
      wrap.style.top = top + 'px';
      wrap.style.height = h + 'px';

      const svg = document.createElementNS(SVGNS, 'svg');
      svg.setAttribute('width', W);
      svg.setAttribute('height', h);
      svg.setAttribute('viewBox', `0 0 ${W} ${h}`);
      // a curve bowing to the right, covering the notes from top to bottom
      const path = document.createElementNS(SVGNS, 'path');
      path.setAttribute('d', `M 2 2 Q ${W - 1} ${h / 2} 2 ${h - 2}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', '#333');
      path.setAttribute('stroke-width', '1.3');
      svg.appendChild(path);
      wrap.appendChild(svg);

      const num = document.createElement('span');
      num.className = 'tuplet-num';
      num.textContent = n;
      num.style.top = (h / 2) + 'px';
      wrap.appendChild(num);

      mEl.appendChild(wrap);
      i = j + 1;
    }
  });
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
      } else {
        // No kanji (standalone ヲ/オ): keep the slot the same shape as a normal
        // note so the mark sits in the same left-of-center position.
        const spacer = document.createElement('span');
        spacer.className = 'kanji-spacer';
        row.appendChild(spacer);
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
