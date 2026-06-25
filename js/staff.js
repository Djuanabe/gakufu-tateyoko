/* Sample staff (五線譜) for click input.
 *
 * Coordinate system: 400×240 viewport.
 * Staff lines: y = 60, 80, 100, 120, 140 (5 lines, 20px apart).
 *
 * Treble clef: bottom line (y=140) = E4.
 * Bass clef:   bottom line (y=140) = G2.
 *
 * Steps: each diatonic step (= 10px in y). Above the top line we draw ledger
 * lines (up to 2 above), and likewise below.
 *
 * On hover we show a marker; on click we emit a letter A-G into the input
 * with the current key signature's accidental applied (flat-only per spec).
 */

const STAFF = {
  width: 400, height: 240,
  topLine: 60, lineGap: 20,
  leftMargin: 80, rightMargin: 20
};

// Bottom-line letter+octave per clef
const CLEF_BOTTOM = {
  treble: {letter: 'E', octave: 4},
  bass:   {letter: 'G', octave: 2}
};
const LETTERS = ['C','D','E','F','G','A','B'];

// Flat order in key signature
const FLAT_ORDER = ['B','E','A','D','G','C','F'];

function staffYToPitch(y, clef) {
  // bottom line y = topLine + 4*lineGap = 140 -> step 0 = bottom-line pitch
  const stepFromBottom = Math.round((STAFF.topLine + 4 * STAFF.lineGap - y) / (STAFF.lineGap / 2));
  const base = CLEF_BOTTOM[clef];
  // each step = one diatonic letter
  const baseLetterIdx = LETTERS.indexOf(base.letter);
  const letterIdx = (baseLetterIdx + stepFromBottom) % 7;
  const wrapped = ((letterIdx % 7) + 7) % 7;
  const octaveShift = Math.floor((baseLetterIdx + stepFromBottom) / 7);
  return {
    letter: LETTERS[wrapped],
    octave: base.octave + octaveShift,
    step: stepFromBottom
  };
}

function pitchToY(letter, octave, clef) {
  const base = CLEF_BOTTOM[clef];
  const stepFromBottom = (octave - base.octave) * 7 + (LETTERS.indexOf(letter) - LETTERS.indexOf(base.letter));
  return STAFF.topLine + 4 * STAFF.lineGap - stepFromBottom * (STAFF.lineGap / 2);
}

function flatAccidentalsFor(keySig) {
  // keySig is negative for flats. -1 = Bf, -2 = Bf,Ef, ...
  const n = Math.max(0, -keySig);
  return new Set(FLAT_ORDER.slice(0, n));
}

function renderStaff() {
  const svg = document.getElementById('staff-svg');
  svg.innerHTML = '';
  const clef = document.getElementById('clef').value;
  const keySig = parseInt(document.getElementById('key-sig').value, 10) || 0;
  const flats = flatAccidentalsFor(keySig);

  const NS = 'http://www.w3.org/2000/svg';

  // 5 staff lines
  for (let i = 0; i < 5; i++) {
    const y = STAFF.topLine + i * STAFF.lineGap;
    const l = document.createElementNS(NS, 'line');
    l.setAttribute('x1', STAFF.leftMargin - 20);
    l.setAttribute('x2', STAFF.width - STAFF.rightMargin);
    l.setAttribute('y1', y); l.setAttribute('y2', y);
    l.setAttribute('stroke', '#222'); l.setAttribute('stroke-width', '1');
    svg.appendChild(l);
  }
  // Clef glyph (text approximation using Unicode)
  const clefText = document.createElementNS(NS, 'text');
  clefText.setAttribute('x', STAFF.leftMargin - 50);
  clefText.setAttribute('y', clef === 'treble' ? 135 : 95);
  clefText.setAttribute('font-size', clef === 'treble' ? '80' : '60');
  clefText.setAttribute('font-family', 'serif');
  clefText.textContent = clef === 'treble' ? '𝄞' : '𝄢';
  svg.appendChild(clefText);

  // Draw key signature flats
  let kx = STAFF.leftMargin - 5;
  const flatYTreble = {B: 80, E: 60, A: 90, D: 70, G: 100, C: 80, F: 110};
  const flatYBass   = {B: 100, E: 80, A: 110, D: 90, G: 120, C: 100, F: 130};
  const flatYMap = clef === 'treble' ? flatYTreble : flatYBass;
  FLAT_ORDER.forEach(l => {
    if (!flats.has(l)) return;
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', kx);
    t.setAttribute('y', flatYMap[l]);
    t.setAttribute('font-size', '22');
    t.textContent = '♭';
    svg.appendChild(t);
    kx += 10;
  });

  // Render clickable note slots (one for each diatonic step from a few ledger
  // lines below the staff to a few above)
  const minStep = -4, maxStep = 14;
  for (let s = minStep; s <= maxStep; s++) {
    const y = STAFF.topLine + 4 * STAFF.lineGap - s * (STAFF.lineGap / 2);
    const x = kx + 30 + ((s + 4) % 2) * 0; // single column for simplicity
    // hit area: tall full-width rect
    const hit = document.createElementNS(NS, 'rect');
    hit.setAttribute('x', kx + 20);
    hit.setAttribute('y', y - STAFF.lineGap / 4);
    hit.setAttribute('width', STAFF.width - STAFF.rightMargin - (kx + 20));
    hit.setAttribute('height', STAFF.lineGap / 2);
    hit.setAttribute('fill', 'transparent');
    hit.setAttribute('class', 'staff-note');
    hit.addEventListener('mouseenter', () => hit.setAttribute('fill', 'rgba(201,138,20,0.2)'));
    hit.addEventListener('mouseleave', () => hit.setAttribute('fill', 'transparent'));
    hit.addEventListener('click', () => {
      const p = staffYToPitch(y, clef);
      const accidental = flats.has(p.letter) ? 'f' : '';
      // octave preference: choose h/m/l based on octave vs middle
      let pref = '';
      const baseOct = clef === 'treble' ? 5 : 3;
      if (p.octave > baseOct) pref = 'h';
      else if (p.octave < baseOct) pref = 'l';
      else pref = 'm';
      const token = pref + p.letter.toLowerCase() + accidental;
      appendToCellInput(token);
    });
    svg.appendChild(hit);

    // optional: thin ledger line for notes above/below the staff
    if (s < 0 || s > 8) {
      if (s % 2 === 0) {
        const ll = document.createElementNS(NS, 'line');
        ll.setAttribute('x1', x - 12); ll.setAttribute('x2', x + 12);
        ll.setAttribute('y1', y); ll.setAttribute('y2', y);
        ll.setAttribute('stroke', '#888'); ll.setAttribute('stroke-width', '1');
        svg.appendChild(ll);
      }
    }
  }
}

function appendToCellInput(token) {
  const inp = document.getElementById('cell-input');
  const cur = inp.value.trim();
  inp.value = cur ? cur + ',' + token : token;
  inp.focus();
}
