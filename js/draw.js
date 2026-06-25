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

function wavePath(len, mid, orient) {
  const amp = 5, step = 8;
  let path = '';
  for (let t = 0; t <= len; t += 2) {
    const off = amp * Math.sin((t / step) * Math.PI);
    const x = orient === 'h' ? t : mid + off;
    const y = orient === 'h' ? mid + off : t;
    path += (t === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
  }
  return path;
}

function buildDrawingSvg(d) {
  const L = Math.max(10, d.length);
  const w = d.orient === 'h' ? L : DRAW_THICK;
  const h = d.orient === 'h' ? DRAW_THICK : L;
  const mid = DRAW_THICK / 2;
  const stroke = '#222', sw = 1.6;

  const svg = document.createElementNS(DRAW_NS, 'svg');
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

  if (d.type === 'wave') {
    const p = document.createElementNS(DRAW_NS, 'path');
    p.setAttribute('d', wavePath(L, mid, d.orient));
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', stroke);
    p.setAttribute('stroke-width', sw);
    svg.appendChild(p);
  } else {
    const ln = document.createElementNS(DRAW_NS, 'line');
    if (d.orient === 'h') { ln.setAttribute('x1', 1); ln.setAttribute('y1', mid); ln.setAttribute('x2', L - 1); ln.setAttribute('y2', mid); }
    else { ln.setAttribute('x1', mid); ln.setAttribute('y1', 1); ln.setAttribute('x2', mid); ln.setAttribute('y2', L - 1); }
    ln.setAttribute('stroke', stroke);
    ln.setAttribute('stroke-width', sw);
    svg.appendChild(ln);
    if (d.type === 'arrow') {
      const a = 6;
      const head = document.createElementNS(DRAW_NS, 'path');
      const dp = d.orient === 'h'
        ? `M ${L - 1} ${mid} L ${L - 1 - a} ${mid - a} M ${L - 1} ${mid} L ${L - 1 - a} ${mid + a}`
        : `M ${mid} ${L - 1} L ${mid - a} ${L - 1 - a} M ${mid} ${L - 1} L ${mid + a} ${L - 1 - a}`;
      head.setAttribute('d', dp);
      head.setAttribute('fill', 'none');
      head.setAttribute('stroke', stroke);
      head.setAttribute('stroke-width', sw);
      svg.appendChild(head);
    }
  }
  return { svg, w, h };
}

function makeDrawingEl(d, idx) {
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
      d.length = Math.max(10, Math.round(oL + delta));
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
