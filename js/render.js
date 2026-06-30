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
const LEFT_MARK_GLYPH = { wo: 'ヲ', o: 'オ' };

// Display sizes. Data is stored as sixteenth cells, but a sixteenth is only
// shown at half size where it's actually used (via Space); otherwise an
// eighth (= 2 sixteenths) is drawn at full size.
const H8 = 46;
const H16 = H8 / 2;

// Note glyphs fill their cell vertically.
const FONT_FILL = 0.98;

function sizeCell(el, h) {
  el.style.height = h + 'px';
  el.style.fontSize = h * FONT_FILL + 'px';
}

function cellHasContent(c) {
  return !!(
    c &&
    (
      (c.notes && c.notes.length > 0) ||
      c.rest ||
      c.sustain ||
      c.unconverted ||
      c.iter
    )
  );
}

/*
 * 十七絃の表示変換。
 *
 * 内部データは stringLabel() の結果をそのまま使い、
 * 譜面上の表示だけ変える。
 *
 * 十七絃:
 *   10 → 十
 *   11 → 1
 *   12 → 2
 *   13 → 3
 *   14 → 4
 *   15 → 5
 *   16 → 6
 *   17 → 7
 *
 * 十三絃:
 *   変更なし
 */
function displayStringNameForScore(value, instrumentType) {
  const s = String(value);

  if (String(instrumentType) === '17') {
    const n = Number(s);

    if (n === 10) {
      return '十';
    }

    if (Number.isInteger(n) && n >= 11 && n <= 17) {
      return String(n - 10);
    }
  }

  return s;
}

// Build one measure as a vertical column element.
// opts:
//   instrumentType : string used for the string labels
//   tunings        : tuning sections
//   isCursorCell   : (cellIdx) => bool
function buildMeasureColumn(m, mIdx, opts) {
  const type = opts.instrumentType;
  const tunings = opts.tunings;
  const cursorHere = opts.isCursorCell || (() => false);
  const selHere = opts.isSelCell || (() => false);
  const h8 = opts.h8 || H8;
  const h16 = h8 / 2;

  const mEl = document.createElement('div');
  mEl.className = 'measure';
  mEl.dataset.measure = mIdx;

  // PDF出力などで h8 が指定された場合、縦2:横3の比率を維持
  if (opts.h8) {
    mEl.style.width = 3 * h8 + 'px';
  }

  const ts = m.timeSignature;
  const perBeat = Math.max(1, Math.round(16 / ts.den));
  const eighthsPerBeat = Math.max(1, Math.round(perBeat / 2));
  const beatH = eighthsPerBeat * h8;

  // 調弦変更の印
  if (tunings && tunings.some(t => t.fromMeasure === mIdx && mIdx > 0)) {
    mEl.classList.add('tuning-change');

    const badge = document.createElement('div');
    badge.className = 'tuning-badge';
    badge.textContent = '調弦変更';
    mEl.appendChild(badge);
  }

  const cells = m.cells;
  let i = 0;

  while (i < cells.length) {
    const cell = cells[i];

    // ---- Tuplet block ----
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

        sizeCell(cEl, slotH);

        cEl.classList.add('tuplet');
        cEl.dataset.measure = mIdx;
        cEl.dataset.cell = idx;
        cEl.dataset.tupletId = t.id;
        cEl.dataset.tupletN = t.n;

        if (cursorHere(idx)) cEl.classList.add('active');
        if (selHere(idx)) cEl.classList.add('sel-range');

        block.appendChild(cEl);
      }

      // 連符が拍境界をまたぐ位置に短い線を入れる
      for (let b = 1; b < t.beats; b++) {
        const tick = document.createElement('div');
        tick.className = 'tuplet-beat-tick';
        tick.style.top = b * beatH + 'px';
        block.appendChild(tick);
      }

      mEl.appendChild(block);
      i += span;
      continue;
    }

    // ---- Normal eighth pair ----
    const next = cells[i + 1];
    const subdivided = cellHasContent(next) || cursorHere(i + 1);
    const endsBeat = (i + 2) % perBeat === 0;
    // 出力 (dock) 配置では小節同士は縦に積まれ、次の小節の border-top や
    // 外枠下罫が小節底の線を担うので、最終セルの beat-end は二重線を避ける
    // ため省く。編集画面は小節が横並びなので、拍子混在時に短い小節の底に
    // 線が無くなるのを避けるため最終セルにも beat-end を出す。
    const isLastInMeasure = (i + 2 >= cells.length);
    const skipLastBottom = !!opts.h8 && isLastInMeasure;
    const lineCls = endsBeat
      ? (skipLastBottom ? '' : 'beat-end')
      : 'eighth-end';

    if (subdivided) {
      const a = renderCell(cell, type);
      sizeCell(a, h16);
      a.dataset.measure = mIdx;
      a.dataset.cell = i;
      if (cursorHere(i)) a.classList.add('active');
      if (selHere(i)) a.classList.add('sel-range');
      mEl.appendChild(a);

      const b = renderCell(next || newCell(), type);
      sizeCell(b, h16);
      b.dataset.measure = mIdx;
      b.dataset.cell = i + 1;
      if (lineCls) b.classList.add(lineCls);
      if (cursorHere(i + 1)) b.classList.add('active');
      if (selHere(i + 1)) b.classList.add('sel-range');
      mEl.appendChild(b);
    } else {
      const a = renderCell(cell, type);
      sizeCell(a, h8);
      a.dataset.measure = mIdx;
      a.dataset.cell = i;
      if (lineCls) a.classList.add(lineCls);
      if (cursorHere(i)) a.classList.add('active');
      if (selHere(i)) a.classList.add('sel-range');
      mEl.appendChild(a);
    }

    i += 2;
  }

  return mEl;
}

function renderScore(state) {
  const root = document.getElementById('score');
  root.innerHTML = '';

  const sheet = state.sheet;
  const measures = sheet.parts[0].measures;

  const sys = document.createElement('div');
  sys.className = 'system';
  root.appendChild(sys);

  measures.forEach((m, mIdx) => {
    const mEl = buildMeasureColumn(m, mIdx, {
      instrumentType: sheet.instrumentType,
      tunings: sheet.tunings,
      isCursorCell: idx => state.cursor.measure === mIdx && state.cursor.cell === idx,
      isSelCell: idx =>
        typeof isCellInSelRange === 'function' && isCellInSelRange(mIdx, idx),
    });

    // 編集画面だけ小節番号を表示
    const num = document.createElement('div');
    num.className = 'measure-num';
    num.textContent = mIdx + 1;
    mEl.appendChild(num);

    sys.appendChild(mEl);
  });

  drawTupletBrackets(root);

  if (typeof renderDrawings === 'function') {
    renderDrawings(sys, state);
  }

  // セルクリックでカーソル移動。
  // 描画 (繰り返し記号など) を選択中だった場合は解除する。これをしないと
  // セル編集中に Backspace が描画削除へ飛んで消えてしまう。
  root.querySelectorAll('.cell').forEach(el => {
    el.addEventListener('click', (e) => {
      const mIdx = parseInt(el.dataset.measure, 10);
      const cIdx = parseInt(el.dataset.cell, 10);

      // ドラッグ選択が終わった直後のクリックはカーソル移動しない
      if (typeof _selDragActive !== 'undefined' && _selDragActive) return;

      if (typeof selectedDrawingIdx !== 'undefined' && selectedDrawingIdx >= 0) {
        selectedDrawingIdx = -1;
        document.querySelectorAll('.drawing.selected').forEach(d => d.classList.remove('selected'));
      }

      // Shift+Click: 選択範囲を延長（カーソルは動かさない）
      if (e.shiftKey && typeof selRangeStart !== 'undefined' && selRangeStart) {
        selRangeEnd = { measure: mIdx, cell: cIdx };
        renderScore(State);
        return;
      }

      // 通常クリック: 選択を解除してカーソル移動
      if (typeof clearSelection === 'function') clearSelection();

      State.setCursor(mIdx, cIdx, 0);
      renderScore(State);

      const inp = document.getElementById('cell-input');
      inp.focus();
      inp.value = '';
    });
  });

  // カーソルセルを表示範囲内に保つ。row-reverse 配置で offsetLeft が
  // ブラウザにより一貫しないので、scrollIntoView でブラウザ任せにする。
  const active = root.querySelector('.cell.active');

  if (active) {
    const r = active.getBoundingClientRect();
    const sr = root.getBoundingClientRect();
    const outsideH = r.left < sr.left || r.right > sr.right;
    const outsideV = r.top < sr.top || r.bottom > sr.bottom;

    if (outsideH || outsideV) {
      const measureEl = active.closest('.measure');
      if (measureEl) {
        measureEl.scrollIntoView({ inline: 'center', block: 'nearest' });
      } else {
        active.scrollIntoView({ inline: 'center', block: 'nearest' });
      }
    }
  }

  const info = document.getElementById('measure-info');

  if (info) {
    info.textContent = `${state.cursor.measure + 1} / ${measures.length}小節`;
  }
}

const SVGNS = 'http://www.w3.org/2000/svg';

// 連符括弧を描画
function drawTupletBrackets(root) {
  root.querySelectorAll('.measure').forEach(mEl => {
    const cells = [...mEl.querySelectorAll('.cell.tuplet')];
    let i = 0;

    while (i < cells.length) {
      const id = cells[i].dataset.tupletId;
      const n = cells[i].dataset.tupletN;

      let j = i;

      while (
        j + 1 < cells.length &&
        cells[j + 1].dataset.tupletId === id
      ) {
        j++;
      }

      const first = cells[i];
      const last = cells[j];

      const mRect = mEl.getBoundingClientRect();
      const fRect = first.getBoundingClientRect();
      const lRect = last.getBoundingClientRect();

      const top = fRect.top - mRect.top;
      const h = lRect.bottom - fRect.top;
      const W = 16;

      const wrap = document.createElement('div');
      wrap.className = 'tuplet-bracket';
      wrap.style.top = top + 'px';
      wrap.style.height = h + 'px';

      const svg = document.createElementNS(SVGNS, 'svg');
      svg.setAttribute('width', W);
      svg.setAttribute('height', h);
      svg.setAttribute('viewBox', `0 0 ${W} ${h}`);

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
      num.style.top = h / 2 + 'px';

      wrap.appendChild(num);
      mEl.appendChild(wrap);

      i = j + 1;
    }
  });
}

function makeSustainGlyph(kind) {
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

  if (cell.iter) {
    const s = document.createElement('span');
    s.className = 'kanji iter-mark';
    s.textContent = cell.iter;
    el.appendChild(s);
    return el;
  }

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
    s.textContent = cell.unconverted.map(pitchLabel).join(',');

    el.appendChild(s);
    return el;
  }

  const notes = cell.notes || [];
  const leftText = cell.left || [];
  const rightText = cell.right || [];
  const total = notes.length + leftText.length + rightText.length;

  if (total > 0) {
    const stack = document.createElement('div');
    const hasMark = notes.some(x => x.leftMark);

    stack.className =
      'stack ' +
      (total > 1 ? 'chord' : 'single') +
      (hasMark ? ' has-mark' : '');

    if (cell.circled) {
      stack.classList.add('circled');
    }

    if (notes.length > 1) {
      const sx = 1 / (1 + (notes.length - 1) * 0.5);
      stack.style.transform = `scaleX(${sx.toFixed(3)})`;
      stack.style.transformOrigin = 'center';
    }

    const addText = txt => {
      const row = document.createElement('div');
      row.className = 'note-row';

      const label = document.createElement('span');
      label.className = 'kanji';
      label.textContent = txt;

      row.appendChild(label);
      stack.appendChild(row);
    };

    // 左側記号
    leftText.forEach(addText);

    // 音名行
    const buildNoteRow = (n, asCircled) => {
      const row = document.createElement('div');
      row.className = 'note-row' + (asCircled ? ' circled' : '');

      if (n.leftMark) {
        const lm = document.createElement('span');
        lm.className = 'left-mark';
        lm.textContent = LEFT_MARK_GLYPH[n.leftMark] || '';
        row.appendChild(lm);
      }

      if (n.stringIndex >= 0) {
        const label = document.createElement('span');
        label.className = 'kanji';

        const rawLbl = stringLabel(instrumentType, n.stringIndex) || '?';
        const displayLbl = displayStringNameForScore(rawLbl, instrumentType);

        label.textContent = displayLbl;

        // 変換後の表示文字で判定する
        // 十七絃の 10 は「十」になるため multichar ではない
        if (displayLbl.length > 1) {
          label.classList.add('multichar');
        }

        row.appendChild(label);
      } else {
        const spacer = document.createElement('span');
        spacer.className = 'kanji-spacer';
        row.appendChild(spacer);
      }

      return row;
    };

    // 大文字入力の○囲み
    const circled = notes.filter(n => n.circled);
    const uncircled = notes.filter(n => !n.circled);

    if (circled.length >= 2) {
      const group = document.createElement('div');
      group.className = 'circle-group';

      circled.forEach(n => {
        group.appendChild(buildNoteRow(n, false));
      });

      stack.appendChild(group);
    } else if (circled.length === 1) {
      stack.appendChild(buildNoteRow(circled[0], true));
    }

    uncircled.forEach(n => {
      stack.appendChild(buildNoteRow(n, false));
    });

    // 右側記号
    rightText.forEach(addText);

    el.appendChild(stack);
  }

  // 一部だけ変換できなかった音
  if (cell.unconverted && notes.length > 0) {
    const u = document.createElement('span');
    u.className = 'unknown';
    u.textContent = '+' + cell.unconverted.map(pitchLabel).join(',');

    el.appendChild(u);
    el.classList.add('unconverted');
  }

  return el;
}

// Text label for an unconverted pitch, e.g. "5c", "4bf".
function pitchLabel(p) {
  return `${p.octave != null ? p.octave : ''}${(p.letter || '').toLowerCase()}${p.accidental || ''}`;
}
