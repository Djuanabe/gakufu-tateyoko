/* Sample staff (五線譜) for click input.
 *
 * A full diatonic run of note heads is laid out left-to-right, low pitch to
 * high pitch, each at its correct vertical position on the staff (with ledger
 * lines as needed). Each note head is clickable and shows its letter+octave
 * below, so the whole scale is visible at a glance.
 *
 * Treble clef: bottom line = E4.  Bass clef: bottom line = G2.
 * Key signature is flat-only per spec; flats apply the ♭ to matching letters.
 */

const STAFF = {
  width: 660, height: 220,
  topLine: 40, lineGap: 20,
  noteStartPad: 36,   // gap after key signature before first note
  noteSpacing: 34
};

const CLEF_BOTTOM = {
  treble: {letter: 'E', octave: 4},
  bass:   {letter: 'G', octave: 2}
};
const LETTERS = ['C','D','E','F','G','A','B'];
const FLAT_ORDER = ['B','E','A','D','G','C','F'];

const NS = 'http://www.w3.org/2000/svg';

// step 0 = bottom staff line. Each step = half a line gap (one diatonic letter).
// rowTop is the y of the top staff line of the row being drawn.
function stepToY(step, rowTop) {
  const top = (rowTop == null) ? STAFF.topLine : rowTop;
  return top + 4 * STAFF.lineGap - step * (STAFF.lineGap / 2);
}

function stepToPitch(step, clef) {
  const base = CLEF_BOTTOM[clef];
  const baseLetterIdx = LETTERS.indexOf(base.letter);
  const total = baseLetterIdx + step;
  const wrapped = ((total % 7) + 7) % 7;
  const octaveShift = Math.floor(total / 7);
  return { letter: LETTERS[wrapped], octave: base.octave + octaveShift, step };
}

function flatAccidentalsFor(keySig) {
  const n = Math.max(0, -keySig);
  return new Set(FLAT_ORDER.slice(0, n));
}

function line(svg, x1, y1, x2, y2, color, w) {
  const l = document.createElementNS(NS, 'line');
  l.setAttribute('x1', x1); l.setAttribute('y1', y1);
  l.setAttribute('x2', x2); l.setAttribute('y2', y2);
  l.setAttribute('stroke', color); l.setAttribute('stroke-width', w || 1);
  svg.appendChild(l);
  return l;
}

// Range of diatonic steps shown, extended by one octave (7 steps) up and down.
const STAFF_LOW_STEP = -9;
const STAFF_HIGH_STEP = 17;
const STAFF_ROW_GAP = 150; // vertical distance between stacked staff rows

function drawStaffRow(svg, rowTop, clef, flats) {
  // 5 staff lines
  for (let i = 0; i < 5; i++) {
    const y = rowTop + i * STAFF.lineGap;
    line(svg, 30, y, STAFF.width - 10, y, '#222', 1);
  }
  // Clef glyph
  const clefText = document.createElementNS(NS, 'text');
  clefText.setAttribute('x', 34);
  clefText.setAttribute('y', clef === 'treble' ? rowTop + 78 : rowTop + 42);
  clefText.setAttribute('font-size', clef === 'treble' ? '78' : '58');
  clefText.setAttribute('font-family', 'serif');
  clefText.textContent = clef === 'treble' ? '𝄞' : '𝄢';
  svg.appendChild(clefText);

  // Key signature flats
  let kx = 78;
  FLAT_ORDER.forEach(l => {
    if (!flats.has(l)) return;
    const step = letterStepNearMiddle(l, clef);
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', kx);
    t.setAttribute('y', stepToY(step, rowTop) + 6);
    t.setAttribute('font-size', '22');
    t.textContent = '♭';
    svg.appendChild(t);
    kx += 12;
  });
  return kx; // x after the key signature
}

function renderStaff() {
  const svg = document.getElementById('staff-svg');
  svg.innerHTML = '';
  const clef = document.getElementById('clef').value;
  const keySig = parseInt(document.getElementById('key-sig').value, 10) || 0;
  const flats = flatAccidentalsFor(keySig);

  // Figure out how many notes fit per row (so we can wrap to a 2nd row).
  // Draw one row's clef+keysig off-screen first just to learn startX.
  const probeKx = 78 + [...flats].length * 12;
  const startX = probeKx + STAFF.noteStartPad;
  const maxX = STAFF.width - 14;
  const perRow = Math.max(1, Math.floor((maxX - startX) / STAFF.noteSpacing) + 1);

  const totalNotes = STAFF_HIGH_STEP - STAFF_LOW_STEP + 1;
  const rows = Math.ceil(totalNotes / perRow);

  // Resize the SVG viewBox to fit all rows.
  const totalHeight = STAFF.topLine + (rows - 1) * STAFF_ROW_GAP + 4 * STAFF.lineGap + 50;
  svg.setAttribute('viewBox', `0 0 ${STAFF.width} ${totalHeight}`);

  // Draw each row's staff background.
  for (let r = 0; r < rows; r++) {
    const rowTop = STAFF.topLine + r * STAFF_ROW_GAP;
    drawStaffRow(svg, rowTop, clef, flats);
  }

  // Lay out the diatonic run, wrapping into rows.
  let i = 0;
  for (let s = STAFF_LOW_STEP; s <= STAFF_HIGH_STEP; s++, i++) {
    const r = Math.floor(i / perRow);
    const col = i % perRow;
    const rowTop = STAFF.topLine + r * STAFF_ROW_GAP;
    const x = startX + col * STAFF.noteSpacing;
    const y = stepToY(s, rowTop);
    drawLedgersForStep(svg, x, s, rowTop);

    const p = stepToPitch(s, clef);
    const accidental = flats.has(p.letter) ? 'f' : '';

    // note head
    const head = document.createElementNS(NS, 'ellipse');
    head.setAttribute('cx', x);
    head.setAttribute('cy', y);
    head.setAttribute('rx', 7);
    head.setAttribute('ry', 5);
    head.setAttribute('transform', `rotate(-20 ${x} ${y})`);
    head.setAttribute('class', 'staff-note');
    svg.appendChild(head);

    if (accidental === 'f') {
      const fl = document.createElementNS(NS, 'text');
      fl.setAttribute('x', x - 16);
      fl.setAttribute('y', y + 5);
      fl.setAttribute('font-size', '16');
      fl.setAttribute('fill', '#555');
      fl.textContent = '♭';
      svg.appendChild(fl);
    }

    // label below the staff row
    const pref = octavePrefForStaff(p.octave, clef);
    const lbl = document.createElementNS(NS, 'text');
    lbl.setAttribute('x', x);
    lbl.setAttribute('y', rowTop + 4 * STAFF.lineGap + 38);
    lbl.setAttribute('font-size', '10');
    lbl.setAttribute('text-anchor', 'middle');
    lbl.setAttribute('fill', '#777');
    lbl.textContent = p.letter + (accidental === 'f' ? '♭' : '') + p.octave;
    svg.appendChild(lbl);

    // click target
    const hit = document.createElementNS(NS, 'rect');
    hit.setAttribute('x', x - STAFF.noteSpacing / 2);
    hit.setAttribute('y', rowTop - 25);
    hit.setAttribute('width', STAFF.noteSpacing);
    hit.setAttribute('height', 4 * STAFF.lineGap + 70);
    hit.setAttribute('fill', 'transparent');
    hit.setAttribute('class', 'staff-hit');
    const token = pref + p.letter.toLowerCase() + accidental;
    hit.addEventListener('mouseenter', () => head.classList.add('hover'));
    hit.addEventListener('mouseleave', () => head.classList.remove('hover'));
    hit.addEventListener('click', () => appendToCellInput(token));
    svg.appendChild(hit);
  }
}

// Draw ledger lines for notes that sit outside the 5-line staff row.
function drawLedgersForStep(svg, x, step, rowTop) {
  if (step < 0) {
    for (let s = -2; s >= step; s -= 2) {
      const y = stepToY(s, rowTop);
      line(svg, x - 11, y, x + 11, y, '#888', 1);
    }
  } else if (step > 8) {
    for (let s = 10; s <= step; s += 2) {
      const y = stepToY(s, rowTop);
      line(svg, x - 11, y, x + 11, y, '#888', 1);
    }
  }
}

function letterStepNearMiddle(letter, clef) {
  // find the step (within 0..8 roughly) whose pitch letter matches
  for (let s = 0; s <= 8; s++) {
    if (stepToPitch(s, clef).letter === letter) return s;
  }
  return 4;
}

function octavePrefForStaff(octave, clef) {
  const baseOct = clef === 'treble' ? 5 : 3;
  if (octave > baseOct) return 'h';
  if (octave < baseOct) return 'l';
  return 'm';
}

function appendToCellInput(token) {
  const inp = document.getElementById('cell-input');
  const cur = inp.value.trim();
  inp.value = cur ? cur + ',' + token : token;
  inp.focus();
}
