/* Overlay drawings on the score: straight line, wavy line, arrow.
 *
 * Each drawing is constrained to horizontal ('h') or vertical ('v'); the user
 * can change its position (drag the body) and length (drag the end handle).
 * Drawings live in State.sheet.drawings and are re-rendered with the score.
 */

let selectedDrawingIdx = -1;
const DRAW_THICK = 16; // cross-axis thickness of a drawing's hit/box
const DRAW_NS = 'http://www.w3.org/2000/svg';

function renderDrawings(sys, state) {
  const list = state.sheet.drawings || [];
  if (list.length === 0) return;
  const overlay = document.createElement('div');
  overlay.className = 'draw-overlay';
  list.forEach((d, idx) => overlay.appendChild(makeDrawingEl(d, idx)));
  sys.appendChild(overlay);
}

const INK = '#1b1b1b'; // 墨色（near-black）

// orient-aware point: along-axis position `a`, cross-axis offset `c` from mid.
function pt(a, c, mid, orient) {
  return orient === 'h' ? [a, mid + c] : [mid + c, a];
}

// A brush stroke as a FILLED tapered "leaf": pointed at both ends, fuller in
// the middle — the calligraphic feel of a 毛筆 (Yuji Syuku-like) line.
function brushLeafPath(L, mid, hw, orient, headFull) {
  const a0 = 1, a1 = L - 1, m = L * 0.5;
  // when headFull, keep the far end (where an arrowhead attaches) fuller
  const farHw = headFull ? hw * 0.65 : 0;
  const P = (a, c) => pt(a, c, mid, orient).map(n => n.toFixed(1)).join(' ');
  return `M ${P(a0, 0)} `
       + `Q ${P(m * 0.55, -hw)} ${P(m, -hw)} `
       + `Q ${P(L * 0.82, -hw * 0.8)} ${P(a1, -farHw)} `
       + `L ${P(a1, farHw)} `
       + `Q ${P(L * 0.82, hw * 0.8)} ${P(m, hw)} `
       + `Q ${P(m * 0.55, hw)} ${P(a0, 0)} Z`;
}

// Wave as a brush ribbon: a sine spine offset by a (slightly tapering) half
// width, so it reads as an undulating ink stroke rather than a hairline.
function brushWavePath(L, mid, orient) {
  const amp = 5.5, step = 9, hw = 1.9;
  const top = [], bot = [];
  for (let t = 0; t <= L; t += 2) {
    const off = amp * Math.sin((t / step) * Math.PI);
    const taper = Math.min(1, Math.min(t, L - t) / 8); // thin at both ends
    const h = hw * (0.55 + 0.45 * taper);
    top.push(pt(t, off - h, mid, orient));
    bot.push(pt(t, off + h, mid, orient));
  }
  const seg = (arr) => arr.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  return seg(top) + ' ' + seg(bot.reverse()).replace(/^M/, 'L') + ' Z';
}

function buildDrawingSvg(d) {
  const L = Math.max(10, d.length);
  const w = d.orient === 'h' ? L : DRAW_THICK;
  const h = d.orient === 'h' ? DRAW_THICK : L;
  const mid = DRAW_THICK / 2;
  const HW = 2.1;                 // brush half-width (peak)

  const svg = document.createElementNS(DRAW_NS, 'svg');
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

  const fillPath = (dStr) => {
    const p = document.createElementNS(DRAW_NS, 'path');
    p.setAttribute('d', dStr);
    p.setAttribute('fill', INK);
    p.setAttribute('stroke', INK);
    p.setAttribute('stroke-width', '0.6');
    p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(p);
    return p;
  };

  if (d.type === 'repeat') {
    // ひらがなの「く」を縦に伸ばした繰り返し記号(くの字点)。長さ=半拍単位。
    // 右上 → 左中央の頂点 → 右下 の角ばった筆ストローク。
    const xr = w - 3, xl = 3, mY = L / 2;
    const p = document.createElementNS(DRAW_NS, 'path');
    p.setAttribute('d', `M ${xr} 1 L ${xl} ${mY.toFixed(1)} L ${xr} ${L - 1}`);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', INK);
    p.setAttribute('stroke-width', '2.6');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(p);
  } else if (d.type === 'wave') {
    fillPath(brushWavePath(L, mid, d.orient));
  } else if (d.type === 'arrow') {
    // brush shaft (kept fuller toward the head) + a calligraphic arrowhead
    fillPath(brushLeafPath(L, mid, HW, d.orient, true));
    const a = 8, back = a * 1.15;
    const tip = pt(L - 1, 0, mid, d.orient);
    const wing1 = pt(L - 1 - back, -a, mid, d.orient);
    const wing2 = pt(L - 1 - back, a, mid, d.orient);
    const notch = pt(L - 1 - back * 0.55, 0, mid, d.orient); // concave back (brush)
    const f = n => n.map(v => v.toFixed(1)).join(' ');
    fillPath(`M ${f(tip)} L ${f(wing1)} L ${f(notch)} L ${f(wing2)} Z`);
  } else {
    fillPath(brushLeafPath(L, mid, HW, d.orient, false));
  }
  return { svg, w, h };
}

// Wrap runs of ASCII letters in <i> so romaji is italicised inside an HTML span.
function italicizeRomaji(str) {
  const tmp = document.createElement('span');
  let i = 0;
  while (i < str.length) {
    const ch = str[i];
    if (/[A-Za-z]/.test(ch)) {
      let j = i;
      while (j < str.length && /[A-Za-z]/.test(str[j])) j++;
      const it = document.createElement('i');
      it.textContent = str.slice(i, j);
      tmp.appendChild(it);
      i = j;
    } else {
      tmp.appendChild(document.createTextNode(ch));
      i++;
    }
  }
  return tmp;
}

function makeDrawingEl(d, idx) {
  if (d.type === 'text') return makeTextEl(d, idx);
  const { svg, w, h } = buildDrawingSvg(d);

  const wrap = document.createElement('div');
  wrap.className = 'drawing' + (idx === selectedDrawingIdx ? ' selected' : '');
  wrap.style.left = d.x + 'px';
  wrap.style.top = d.y + 'px';
  wrap.style.width = w + 'px';
  wrap.style.height = h + 'px';
  wrap.appendChild(svg);

  const handle = document.createElement('div');
  handle.className = 'draw-handle';
  if (d.orient === 'h') { handle.style.right = '-4px'; handle.style.top = '50%'; }
  else { handle.style.bottom = '-4px'; handle.style.left = '50%'; }
  wrap.appendChild(handle);

  // drag body = move position
  wrap.addEventListener('pointerdown', (e) => {
    if (e.target === handle) return;
    e.preventDefault();
    selectDrawing(idx);
    History.push();
    const sx = e.clientX, sy = e.clientY, ox = d.x, oy = d.y;
    const move = (ev) => {
      d.x = Math.round(ox + (ev.clientX - sx));
      d.y = Math.round(oy + (ev.clientY - sy));
      wrap.style.left = d.x + 'px';
      wrap.style.top = d.y + 'px';
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });

  // drag handle = change length (orientation fixed)
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    selectDrawing(idx);
    History.push();
    const sx = e.clientX, sy = e.clientY, oL = d.length;
    const move = (ev) => {
      const delta = d.orient === 'h' ? (ev.clientX - sx) : (ev.clientY - sy);
      if (d.type === 'repeat') {
        // 半拍(=H8)単位でスナップして拍数を変える（最小1半拍）
        const units = Math.max(1, Math.round((oL + delta) / H8));
        d.length = units * H8;
      } else {
        d.length = Math.max(10, Math.round(oL + delta));
      }
      const built = buildDrawingSvg(d);
      wrap.style.width = built.w + 'px';
      wrap.style.height = built.h + 'px';
      wrap.querySelector('svg').replaceWith(built.svg);
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });

  return wrap;
}

function selectDrawing(idx) {
  selectedDrawingIdx = idx;
  document.querySelectorAll('.drawing').forEach((el, i) => {
    el.classList.toggle('selected', i === idx);
  });
}

function makeTextEl(d, idx) {
  const wrap = document.createElement('div');
  wrap.className = 'drawing drawing-text'
    + (d.orient === 'v' ? ' vertical' : '')
    + (idx === selectedDrawingIdx ? ' selected' : '');
  wrap.style.left = d.x + 'px';
  wrap.style.top = d.y + 'px';
  wrap.appendChild(italicizeRomaji(d.text && d.text.length > 0 ? d.text : '（文章）'));

  // drag to move
  wrap.addEventListener('pointerdown', (e) => {
    if (e.detail >= 2) return; // double-click handled below
    e.preventDefault();
    selectDrawing(idx);
    History.push();
    const sx = e.clientX, sy = e.clientY, ox = d.x, oy = d.y;
    const move = (ev) => {
      d.x = Math.round(ox + (ev.clientX - sx));
      d.y = Math.round(oy + (ev.clientY - sy));
      wrap.style.left = d.x + 'px';
      wrap.style.top = d.y + 'px';
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });

  // double-click to edit text
  wrap.addEventListener('dblclick', (e) => {
    e.preventDefault();
    selectDrawing(idx);
    const next = prompt('文章を編集', d.text || '');
    if (next == null) return;
    History.push();
    State.setDrawingText(idx, next);
    wrap.innerHTML = '';
    wrap.appendChild(italicizeRomaji(next));
  });

  return wrap;
}
