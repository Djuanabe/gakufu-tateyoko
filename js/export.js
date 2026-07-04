/* Named score library + ensemble docking + PDF (print) output.
 *
 * A "library" of named scores lives in localStorage. Any number of them can be
 * docked together for a 重奏 (ensemble) layout whose columns interleave by
 * instrument: Ⅰ-col1, Ⅱ-col1, Ⅰ-col2, Ⅱ-col2, … (read right-to-left).
 * The docked layout is shown as an on-screen preview; "PDF出力" prints it
 * (browser → Save as PDF).
 */

const LIB_KEY = 'gakufu_library';
const ROMAN = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ'];

// Name of the library score currently being edited (set when loaded from or
// saved to the library). The 保存 button overwrites this entry when set.
let currentLibraryName = null;
function setCurrentLibraryName(name) { currentLibraryName = name; }
function getCurrentLibraryName() {
  return (currentLibraryName && libNames().includes(currentLibraryName)) ? currentLibraryName : null;
}

function libLoad() {
  try {
    const raw = localStorage.getItem(LIB_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return (obj && typeof obj === 'object') ? obj : {};
  } catch (e) { return {}; }
}
function libSave(obj) {
  localStorage.setItem(LIB_KEY, JSON.stringify(obj));
}
function libNames() {
  return Object.keys(libLoad());
}

// Save the current sheet under a name (deep copy via the existing serializer).
function librarySaveCurrent(name) {
  const lib = libLoad();
  lib[name] = JSON.parse(State.serialize());
  libSave(lib);
}
function libraryDelete(name) {
  const lib = libLoad();
  delete lib[name];
  libSave(lib);
}
// Load a named sheet into the editor (reuses State.deserialize for migration).
function libraryLoadInto(name) {
  const lib = libLoad();
  if (!lib[name]) return false;
  const ok = State.deserialize(JSON.stringify(lib[name]));
  if (ok) currentLibraryName = name; // 保存ボタンの上書き先にする
  return ok;
}

// Normalize a stored sheet to the parts-based shape so the renderer can read
// sheet.parts[0].measures regardless of how old the save is.
function normalizeSheet(sheet) {
  const s = JSON.parse(JSON.stringify(sheet));
  if (!s.parts) {
    if (s.measures) { s.parts = [{ measures: s.measures }]; delete s.measures; }
    else s.parts = [{ measures: [] }];
  }
  if (!s.tunings && s.tuning) s.tunings = [{ fromMeasure: 0, tuning: s.tuning }];
  return s;
}

/* ---- UI: library list + dock selection ---------------------------------- */

function refreshLibraryUI() {
  const names = libNames();

  const list = document.getElementById('lib-list');
  list.innerHTML = '';
  if (names.length === 0) {
    const li = document.createElement('li');
    li.className = 'lib-empty';
    li.textContent = '（保存された楽譜はありません）';
    list.appendChild(li);
  } else {
    names.forEach(name => {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.className = 'lib-name';
      span.textContent = name;
      const loadBtn = document.createElement('button');
      loadBtn.textContent = '読込';
      loadBtn.addEventListener('click', () => {
        if (!confirm(`「${name}」を編集中の楽譜として読み込みます。よろしいですか？`)) return;
        if (libraryLoadInto(name)) {
          document.getElementById('instrument-type').value = State.sheet.instrumentType;
          refresh();
          closeExportModal();
        }
      });
      const delBtn = document.createElement('button');
      delBtn.textContent = '削除';
      delBtn.addEventListener('click', () => {
        if (!confirm(`「${name}」を削除します。よろしいですか？`)) return;
        libraryDelete(name);
        refreshLibraryUI();
      });
      li.appendChild(span);
      li.appendChild(loadBtn);
      li.appendChild(delBtn);
      list.appendChild(li);
    });
  }

  // dock selection (checkboxes, in library order = Ⅰ, Ⅱ, …)
  const dock = document.getElementById('dock-select');
  dock.innerHTML = '';
  if (names.length === 0) {
    dock.textContent = '保存された楽譜がありません。';
  } else {
    names.forEach(name => {
      const row = document.createElement('label');
      row.className = 'dock-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = name;
      cb.checked = dockOrder.includes(name);
      cb.addEventListener('change', () => {
        if (cb.checked) { if (!dockOrder.includes(name)) dockOrder.push(name); }
        else { dockOrder = dockOrder.filter(n => n !== name); }
        updateDockAssignments();
      });
      const txt = document.createElement('span');
      txt.textContent = name;
      row.appendChild(cb);
      row.appendChild(txt);
      dock.appendChild(row);
    });
  }
  // drop names no longer present in the library
  dockOrder = dockOrder.filter(n => names.includes(n));
  updateDockAssignments();
}

// Order in which scores were checked (= Ⅰ, Ⅱ, … assignment for docking).
let dockOrder = [];

// Show Ⅰ/Ⅱ/… next to each dock item, following the CHECK order.
function updateDockAssignments() {
  document.querySelectorAll('#dock-select .dock-item').forEach(row => {
    const tag = row.querySelector('.dock-roman');
    if (tag) tag.remove();
  });
  dockOrder.forEach((name, idx) => {
    const cb = document.querySelector(`#dock-select input[value="${CSS.escape(name)}"]`);
    if (!cb) return;
    const span = document.createElement('span');
    span.className = 'dock-roman';
    span.textContent = ROMAN[idx] || ('第' + (idx + 1));
    cb.parentElement.appendChild(span);
  });
}

function selectedDockSheets() {
  const lib = libLoad();
  return dockOrder
    .filter(name => lib[name])
    .map(name => ({ name, sheet: normalizeSheet(lib[name]) }));
}

/* ---- Docked (interleaved) rendering ------------------------------------- */

// Output layout: each COLUMN holds up to 16 beats (e.g. 4 measures of 4/4)
// stacked vertically. Columns read right-to-left and interleave by instrument
// per 16-beat block (Ⅰ block1, Ⅱ block1, Ⅰ block2, …). A B4-landscape page is
// split into two side-by-side areas of 8 columns each (16 cols/page).
const BEATS_PER_COL = 16;
const COLS_PER_AREA = 8;
const COLS_PER_PAGE = COLS_PER_AREA * 2;
const OUT_H8 = 25;   // eighth-cell height for output (16 beats fit a B4 column)
// Column inner height needed to decide whether content fills column up to
// the outer frame. Must match .dock-col height in CSS.
const COL_INNER_H = 809;

function beatsOfMeasure(m) {
  return m ? (m.timeSignature.num * 4 / m.timeSignature.den) : 4;
}

function renderDockedInto(container, entries) {
  container.innerHTML = '';

  const maxMeasures = Math.max(0, ...entries.map(e => e.sheet.parts[0].measures.length));
  // Group lead-part measures into ≤16-beat blocks (never split a measure).
  const blocks = [];
  const measurePxH = (k) => {
    const m = entries[0].sheet.parts[0].measures[k];
    return m ? (m.cells.length / 2) * OUT_H8 : OUT_H8 * 8;
  };
  let blk = [], blkH = 0;
  for (let k = 0; k < maxMeasures; k++) {
    const mH = measurePxH(k);
    if (blk.length && blkH + 3 + mH > COL_INNER_H) { blocks.push(blk); blk = []; blkH = 0; }
    blkH += (blk.length > 0 ? 3 : 0) + mH;
    blk.push(k);
  }
  if (blk.length) blocks.push(blk);

  // Build one column per (block, instrument) in reading order.
  const measureHasAnyContent = (m) => m && m.cells.some(c =>
    (c.notes && c.notes.length) || c.rest || c.sustain || c.unconverted || c.iter || c.tuplet);

  const multiPart = entries.length > 1;
  const columns = [];
  // entry -> Map<measureIdx, .measure element> — used to anchor drawings into
  // the same measure they sat over in the editor.
  const measureElsByEntry = new Map();
  blocks.forEach(measureIdxs => {
    entries.forEach((entry, instIdx) => {
      const col = document.createElement('div');
      col.className = 'dock-col';
      if (multiPart && instIdx === 0) col.classList.add('block-start');

      const contentIdxs = measureIdxs.filter(k => measureHasAnyContent(entry.sheet.parts[0].measures[k]));
      let renderedH = 0;
      let renderedCount = 0;
      measureIdxs.forEach(k => {
        const m = entry.sheet.parts[0].measures[k];
        if (m) {
          const mEl = buildMeasureColumn(m, k, {
            instrumentType: entry.sheet.instrumentType,
            tunings: entry.sheet.tunings,
            h8: OUT_H8,
          });
          col.appendChild(mEl);
          if (!measureElsByEntry.has(entry)) measureElsByEntry.set(entry, new Map());
          measureElsByEntry.get(entry).set(k, mEl);
          renderedH += (m.cells.length / 2) * OUT_H8;
          renderedCount++;
        }
      });
      if (renderedCount > 0) renderedH += (renderedCount - 1) * 3;
      if (renderedH >= COL_INNER_H) col.classList.add('last-touches-frame');
      col.style.setProperty('--content-h', renderedH + 'px');
      if (contentIdxs.length === 0) col.classList.add('empty');
      columns.push(col);
    });
  });

  // 隣接するブロック境界の太線は、block-start の ::after と block-end の
  // ::before が同じ境界に重なって描くようにする。block-end は DOM-next が
  // block-start となる列。
  for (let i = 0; i < columns.length - 1; i++) {
    if (columns[i + 1].classList.contains('block-start')) {
      columns[i].classList.add('block-end');
    }
  }

  // Drawings: anchor each drawing to the measure it sits over in the editor
  // (the editor system is laid out row-reverse with 138px-wide measures), then
  // place a scaled copy inside the corresponding output measure. Editor and
  // output share the same horizontal:vertical scale (75/138 == 25/46), so a
  // single SCALE works for x, y, and length.
  const EDITOR_H8 = 46;
  const EDITOR_MEASURE_W = 138;
  const SCALE = OUT_H8 / EDITOR_H8;
  entries.forEach(entry => {
    const drawings = entry.sheet.drawings || [];
    if (drawings.length === 0) return;
    const measureEls = measureElsByEntry.get(entry);
    if (!measureEls) return;
    const numMeasures = entry.sheet.parts[0].measures.length;
    if (numMeasures === 0) return;
    const sysW = numMeasures * EDITOR_MEASURE_W;

    drawings.forEach((d, idx) => {
      const clampedX = Math.max(0, Math.min(sysW - 1, d.x || 0));
      const colFromLeft = Math.floor(clampedX / EDITOR_MEASURE_W);
      let mIdx = numMeasures - 1 - colFromLeft;
      if (mIdx < 0) mIdx = 0;
      if (mIdx >= numMeasures) mIdx = numMeasures - 1;
      const mEl = measureEls.get(mIdx);
      if (!mEl) return;

      const measureLeft = colFromLeft * EDITOR_MEASURE_W;
      const localX = (d.x || 0) - measureLeft;
      const localY = (d.y || 0);

      const scaledD = Object.assign({}, d, {
        x: Math.round(localX * SCALE),
        y: Math.round(localY * SCALE),
      });
      if (typeof d.length === 'number') {
        scaledD.length = Math.max(10, Math.round(d.length * SCALE));
      }
      if (d.type === 'text') {
        scaledD.textFontSize = Math.max(6, Math.round(16 * SCALE));
      }

      if (typeof makeDrawingEl === 'function') {
        mEl.appendChild(makeDrawingEl(scaledD, idx));
      }
    });
  });

  // Fixed grid: every page always shows two areas of 8 same-size columns.
  // Empty columns keep the column box (= part of the outer frame's interior)
  // visible but contain NO beat-cells — they read as truly blank columns.
  const emptyCol = () => {
    const c = document.createElement('div');
    c.className = 'dock-col empty';
    return c;
  };
  // Areas without any content are still placed (so the surviving area keeps
  // its read-order position) but visually hidden via .empty-area.
  const mkArea = cols => {
    const area = document.createElement('div');
    area.className = 'dock-area';
    if (!cols.some(c => c && !c.classList.contains('empty'))) {
      area.classList.add('empty-area');
    }
    const inner = document.createElement('div'); inner.className = 'dock-area-inner';
    for (let i = 0; i < COLS_PER_AREA; i++) inner.appendChild(cols[i] || emptyCol());
    area.appendChild(inner);
    return area;
  };
  const pages = Math.max(1, Math.ceil(columns.length / COLS_PER_PAGE));
  for (let pg = 0; pg < pages; pg++) {
    const pageCols = columns.slice(pg * COLS_PER_PAGE, (pg + 1) * COLS_PER_PAGE);
    // Skip pages where neither half has content (e.g., extra block after the
    // score ended — would otherwise become a fully blank page in PDF).
    if (!pageCols.some(c => c && !c.classList.contains('empty'))) continue;
    const page = document.createElement('div');
    page.className = 'dock-page';
    page.appendChild(mkArea(pageCols.slice(COLS_PER_AREA)));    // visually left (read 2nd)
    page.appendChild(mkArea(pageCols.slice(0, COLS_PER_AREA))); // visually right (read 1st)
    container.appendChild(page);
  }

  if (typeof drawTupletBrackets === 'function') drawTupletBrackets(container);
}

/* ---- Modal wiring -------------------------------------------------------- */

function openExportModal() {
  refreshLibraryUI();
  document.getElementById('export-modal').classList.remove('hidden');
}
function closeExportModal() {
  document.getElementById('export-modal').classList.add('hidden');
}

function openDockPreview() {
  const entries = selectedDockSheets();
  if (entries.length === 0) { alert('出力する楽譜を1つ以上選んでください。'); return; }
  renderDockedInto(document.getElementById('dock-preview'), entries);
  document.getElementById('dock-preview-overlay').classList.remove('hidden');
}
function closeDockPreview() {
  document.getElementById('dock-preview-overlay').classList.add('hidden');
}

function printDock() {
  // Ensure the preview is built, then hand off to the browser's print → PDF.
  const entries = selectedDockSheets();
  if (entries.length === 0) { alert('出力する楽譜を1つ以上選んでください。'); return; }
  renderDockedInto(document.getElementById('dock-preview'), entries);
  document.getElementById('dock-preview-overlay').classList.remove('hidden');
  document.body.classList.add('printing');
  window.print();
  document.body.classList.remove('printing');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('open-export').addEventListener('click', openExportModal);
  document.getElementById('export-close').addEventListener('click', closeExportModal);

  document.getElementById('lib-save').addEventListener('click', () => {
    const inp = document.getElementById('save-name');
    const name = inp.value.trim();
    if (!name) { alert('保存名を入力してください。'); return; }
    if (libNames().includes(name) && !confirm(`「${name}」は既にあります。上書きしますか？`)) return;
    librarySaveCurrent(name);
    currentLibraryName = name; // 以後この名前を 保存 ボタンの上書き先に
    inp.value = '';
    refreshLibraryUI();
  });

  document.getElementById('dock-preview-btn').addEventListener('click', openDockPreview);
  document.getElementById('dock-pdf-btn').addEventListener('click', printDock);
  document.getElementById('dock-print-btn').addEventListener('click', () => {
    document.body.classList.add('printing');
    window.print();
    document.body.classList.remove('printing');
  });
  document.getElementById('dock-preview-close').addEventListener('click', closeDockPreview);
});
