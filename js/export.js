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
  return State.deserialize(JSON.stringify(lib[name]));
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
      cb.addEventListener('change', updateDockAssignments);
      const txt = document.createElement('span');
      txt.textContent = name;
      row.appendChild(cb);
      row.appendChild(txt);
      dock.appendChild(row);
    });
  }
}

// Show Ⅰ/Ⅱ/… next to each checked dock item, in check order.
function updateDockAssignments() {
  const checked = [...document.querySelectorAll('#dock-select input:checked')];
  document.querySelectorAll('#dock-select .dock-item').forEach(row => {
    const tag = row.querySelector('.dock-roman');
    if (tag) tag.remove();
  });
  checked.forEach((cb, idx) => {
    const span = document.createElement('span');
    span.className = 'dock-roman';
    span.textContent = ROMAN[idx] || ('第' + (idx + 1));
    cb.parentElement.appendChild(span);
  });
}

function selectedDockSheets() {
  const checked = [...document.querySelectorAll('#dock-select input:checked')];
  const lib = libLoad();
  return checked.map(cb => ({ name: cb.value, sheet: normalizeSheet(lib[cb.value]) }));
}

/* ---- Docked (interleaved) rendering ------------------------------------- */

// Build the ensemble layout into `container`. Columns interleave by measure:
//   measure 0: Ⅰ, Ⅱ, …   measure 1: Ⅰ, Ⅱ, …   (each appended → row-reverse
// puts Ⅰ-m0 at the right, reading right-to-left as requested).
function renderDockedInto(container, entries) {
  container.innerHTML = '';
  const sys = document.createElement('div');
  sys.className = 'system docked';

  const maxMeasures = Math.max(0, ...entries.map(e => e.sheet.parts[0].measures.length));
  for (let k = 0; k < maxMeasures; k++) {
    entries.forEach((entry, instIdx) => {
      const measures = entry.sheet.parts[0].measures;
      const m = measures[k];
      const col = document.createElement('div');
      col.className = 'dock-col inst-' + (instIdx % 6);
      if (instIdx === entries.length - 1) col.classList.add('group-end'); // last instrument of the measure group

      const label = document.createElement('div');
      label.className = 'dock-col-label';
      label.textContent = (ROMAN[instIdx] || ('第' + (instIdx + 1))) + (k + 1);
      col.appendChild(label);

      if (m) {
        const mEl = buildMeasureColumn(m, k, {
          instrumentType: entry.sheet.instrumentType,
          tunings: entry.sheet.tunings,
        });
        col.appendChild(mEl);
      } else {
        const blank = document.createElement('div');
        blank.className = 'measure dock-blank';
        col.appendChild(blank);
      }
      sys.appendChild(col);
    });
  }
  container.appendChild(sys);
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
