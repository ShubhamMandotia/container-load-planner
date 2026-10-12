// Container loading heuristic.
//
// Coordinates are integer millimetres. x runs along the length (0 = front wall,
// L = doors), y across the width, z up from the floor.
//
// The planner keeps a list of empty cuboid "spaces" whose floors are always
// fully supported (by the container floor or by the tops of placed cartons).
// It repeatedly takes the space closest to the front wall and fills it with
// the best "block" of identical cartons (columns stacked to the ceiling, then
// across the width, then towards the door). Several strategies are tried and
// the one that loads the most volume wins.

export function orientations(it) {
  const { l, w, h } = it;
  const list = it.upright
    ? [[l, w, h], [w, l, h]]
    : [[l, w, h], [w, l, h], [l, h, w], [h, l, w], [w, h, l], [h, w, l]];
  const seen = new Set();
  return list.filter((o) => {
    const k = o.join('x');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const STRATEGIES = ['volume', 'column', 'wall', 'sequence'];

export function packContainer(C, items, opts = {}) {
  const strategies = opts.keepOrder ? ['sequence'] : STRATEGIES;
  let best = null;
  for (const s of strategies) {
    const r = run(C, items, s);
    if (
      !best ||
      r.loadedVolume > best.loadedVolume ||
      (r.loadedVolume === best.loadedVolume && r.usedLength < best.usedLength)
    ) best = r;
  }
  return best;
}

// Packs one container after another until everything is loaded (or only one
// container when `multi` is off).
export function planShipment(C, items, opts = {}) {
  const maxContainers = opts.multi ? opts.maxContainers || 25 : 1;
  let rem = items.map((it) => it.qty);
  const loads = [];
  while (loads.length < maxContainers && rem.some((q) => q > 0)) {
    const r = packContainer(C, items.map((it, i) => ({ ...it, qty: rem[i] })), opts);
    if (r.boxes.length === 0) break;
    loads.push(r);
    rem = r.remaining;
  }
  const neverFits = items.map((it) => !fitsEmpty(C, it));
  return { loads, unplaced: rem, neverFits };
}

function fitsEmpty(C, it) {
  if (it.weight > 0 && it.weight > C.payload) return false;
  return orientations(it).some(([l, w, h]) => l <= C.L && w <= C.W && h <= C.H);
}

function run(C, items, strategy) {
  const types = items.map((it, i) => ({
    i,
    weight: it.weight || 0,
    stackable: it.stackable !== false,
    vol: it.l * it.w * it.h,
    orients: orientations(it),
  }));
  const rem = items.map((it) => Math.max(0, it.qty | 0));
  let spaces = [{ x0: 0, y0: 0, z0: 0, x1: C.L, y1: C.W, z1: C.H }];
  spaces = tidy(spaces, types, rem);
  const boxes = [];
  const blocks = [];
  let weight = 0;
  let volume = 0;
  let guard = 0;

  while (spaces.length && guard++ < 100000) {
    const si = pickSpace(spaces);
    const S = spaces[si];
    const cand = bestBlock(S, types, rem, C.payload - weight, strategy);
    if (!cand) {
      spaces.splice(si, 1);
      continue;
    }
    const { t, o, nx, ny, nz } = cand;
    const [l, w, h] = o;
    const B = { x0: S.x0, y0: S.y0, z0: S.z0, x1: S.x0 + nx * l, y1: S.y0 + ny * w, z1: S.z0 + nz * h };
    const n = nx * ny * nz;
    const id = blocks.length;
    blocks.push({ id, item: t.i, n, nx, ny, nz, dims: o, ...B });
    for (let a = 0; a < nx; a++)
      for (let b = 0; b < ny; b++)
        for (let c = 0; c < nz; c++)
          boxes.push({ item: t.i, block: id, x: B.x0 + a * l, y: B.y0 + b * w, z: B.z0 + c * h, l, w, h });
    rem[t.i] -= n;
    weight += n * t.weight;
    volume += n * t.vol;
    spaces = tidy(splitSpaces(spaces, B, t.stackable), types, rem);
  }

  // Loading order: front wall to doors, floor up, left to right.
  boxes.sort((a, b) => a.x - b.x || a.z - b.z || a.y - b.y);
  boxes.forEach((b, k) => (b.seq = k));
  blocks.sort((a, b) => a.x0 - b.x0 || a.z0 - b.z0 || a.y0 - b.y0);
  blocks.forEach((b, k) => (b.step = k + 1));

  const loaded = items.map((it, i) => (Math.max(0, it.qty | 0)) - rem[i]);
  let usedLength = 0;
  for (const b of boxes) usedLength = Math.max(usedLength, b.x + b.l);

  return { strategy, boxes, blocks, loaded, remaining: rem, loadedVolume: volume, weight, usedLength };
}

function pickSpace(spaces) {
  let bi = 0;
  for (let i = 1; i < spaces.length; i++) {
    const a = spaces[i];
    const b = spaces[bi];
    if (a.x0 < b.x0 || (a.x0 === b.x0 && (a.z0 < b.z0 || (a.z0 === b.z0 && a.y0 < b.y0)))) bi = i;
  }
  return bi;
}

// "wall" and "column" score a block by how much of the space's cross-section
// (width x height) it fills, plus what the best carton could still fill in the
// strip left beside it and above it. That lets the planner leave a lane free
// for a rotated carton instead of wasting a narrow gap.
const LOOKAHEAD = new Set(['wall', 'column']);

function bestBlock(S, types, rem, capKg, strategy) {
  const sx = S.x1 - S.x0;
  const sy = S.y1 - S.y0;
  const sz = S.z1 - S.z0;
  const look = LOOKAHEAD.has(strategy);
  const avail = look ? types.filter((t) => rem[t.i] > 0) : null;
  let best = null;
  for (const t of types) {
    if (rem[t.i] <= 0) continue;
    let q = rem[t.i];
    if (t.weight > 0) q = Math.min(q, Math.floor(capKg / t.weight + 1e-9));
    if (q <= 0) continue;
    for (const o of t.orients) {
      const [l, w, h] = o;
      if (l > sx || w > sy || h > sz) continue;
      const mx = Math.floor(sx / l);
      const my = Math.floor(sy / w);
      const mz = t.stackable ? Math.floor(sz / h) : 1;
      const nzTop = Math.min(mz, q);
      const nzMin = look ? Math.max(1, nzTop - 2) : nzTop;
      for (let nz = nzTop; nz >= nzMin; nz--) {
        const nyTop = Math.min(my, Math.floor(q / nz));
        const nyMin = look ? Math.max(1, nyTop - 4) : nyTop;
        for (let ny = nyTop; ny >= nyMin; ny--) {
          const nx = strategy === 'wall' ? 1 : Math.min(mx, Math.floor(q / (nz * ny)));
          const n = nx * ny * nz;
          let face = ny * w * nz * h;
          if (look) {
            face += stripFill(avail, sy - ny * w, sz, sx);
            face += stripFill(avail, ny * w, sz - nz * h, sx);
          }
          const c = { t, o, nx, ny, nz, n, vol: n * t.vol, face: face / (sy * sz), depth: nx * l };
          if (better(c, best, strategy)) best = c;
        }
      }
    }
    // "sequence" loads SKUs strictly in list order: first SKU that fits wins.
    if (strategy === 'sequence' && best) return best;
  }
  return best;
}

// Largest cross-section area one carton type can fill in a gw x gh strip.
function stripFill(types, gw, gh, sx) {
  if (gw <= 0 || gh <= 0) return 0;
  let best = 0;
  for (const t of types) {
    for (const [l, w, h] of t.orients) {
      if (l > sx || w > gw || h > gh) continue;
      const a = Math.floor(gw / w) * w * (t.stackable ? Math.floor(gh / h) * h : h);
      if (a > best) best = a;
    }
  }
  return best;
}

function better(c, b, strategy) {
  if (!b) return true;
  if (LOOKAHEAD.has(strategy)) {
    if (Math.abs(c.face - b.face) > 1e-9) return c.face > b.face;
    if (c.vol !== b.vol) return c.vol > b.vol;
    return c.depth < b.depth;
  }
  if (c.vol !== b.vol) return c.vol > b.vol;
  if (c.depth !== b.depth) return c.depth < b.depth;
  return c.face > b.face;
}

function overlaps(a, b) {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0 && a.z0 < b.z1 && a.z1 > b.z0;
}

// Removes block B from every space it touches. Pieces beside B keep their
// parent's (supported) floor; the piece above B is limited to B's footprint so
// its floor is fully supported by B.
function splitSpaces(spaces, B, stackable) {
  const out = [];
  for (const S of spaces) {
    if (!overlaps(S, B)) {
      out.push(S);
      continue;
    }
    if (B.x0 > S.x0) out.push({ ...S, x1: B.x0 });
    if (B.x1 < S.x1) out.push({ ...S, x0: B.x1 });
    if (B.y0 > S.y0) out.push({ ...S, y1: B.y0 });
    if (B.y1 < S.y1) out.push({ ...S, y0: B.y1 });
    if (B.z0 > S.z0) out.push({ ...S, z1: B.z0 });
    if (stackable && B.z1 < S.z1)
      out.push({
        x0: Math.max(S.x0, B.x0), x1: Math.min(S.x1, B.x1),
        y0: Math.max(S.y0, B.y0), y1: Math.min(S.y1, B.y1),
        z0: B.z1, z1: S.z1,
      });
  }
  return out;
}

function contains(a, b) {
  return a.x0 <= b.x0 && a.y0 <= b.y0 && a.z0 <= b.z0 && a.x1 >= b.x1 && a.y1 >= b.y1 && a.z1 >= b.z1;
}

function tidy(spaces, types, rem) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  for (const t of types) {
    if (rem[t.i] <= 0) continue;
    for (const [l, w, h] of t.orients) {
      if (l < minX) minX = l;
      if (w < minY) minY = w;
      if (h < minZ) minZ = h;
    }
  }
  if (minX === Infinity) return [];
  let list = spaces.filter((s) => s.x1 - s.x0 >= minX && s.y1 - s.y0 >= minY && s.z1 - s.z0 >= minZ);

  // Merge neighbours that share a floor, a ceiling and one full edge.
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (a.z0 !== b.z0 || a.z1 !== b.z1) continue;
        let m = null;
        if (a.x0 === b.x0 && a.x1 === b.x1 && a.y1 >= b.y0 && b.y1 >= a.y0 && !(contains(a, b) || contains(b, a)))
          m = { ...a, y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1) };
        else if (a.y0 === b.y0 && a.y1 === b.y1 && a.x1 >= b.x0 && b.x1 >= a.x0 && !(contains(a, b) || contains(b, a)))
          m = { ...a, x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1) };
        if (m) {
          list.splice(j, 1);
          list[i] = m;
          merged = true;
          break outer;
        }
      }
    }
  }

  // Drop spaces that sit entirely inside a bigger one.
  list.sort((a, b) => vol(b) - vol(a));
  const keep = [];
  for (const s of list) if (!keep.some((k) => contains(k, s))) keep.push(s);
  return keep;
}

function vol(s) {
  return (s.x1 - s.x0) * (s.y1 - s.y0) * (s.z1 - s.z0);
}
