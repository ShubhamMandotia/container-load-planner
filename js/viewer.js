import * as THREE from '../vendor/three.module.min.js';
import { OrbitControls } from '../vendor/OrbitControls.js';

// World space is metres. The loading floor sits on y = 0, centred on the
// origin; the front wall is at -x and the doors at +x. The ground is below
// the floor by however high the unit stands (container sills, trailer deck
// height or pallet thickness).
const GAP = 0.006; // visual gap between cartons so stacks read clearly

function token(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Plank floor. A fixed pseudo-random sequence keeps the grain identical on
// every load, so screenshots and PDFs of the same plan match.
const floorTexture = () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const t = canvasTexture(512, 512, (g, w, h) => {
    const planks = 8;
    const ph = h / planks;
    for (let i = 0; i < planks; i++) {
      const tone = 150 + ((i * 37) % 30);
      g.fillStyle = `rgb(${tone}, ${(tone * 0.74) | 0}, ${(tone * 0.5) | 0})`;
      g.fillRect(0, i * ph, w, ph);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, i * ph, w, 2);
      g.fillRect((i * 173) % w, i * ph, 2, ph);
      for (let k = 0; k < 14; k++) {
        g.fillStyle = `rgba(60,35,15,${0.05 + rnd() * 0.06})`;
        g.fillRect(rnd() * w, i * ph + rnd() * ph, 40 + rnd() * 120, 1.5);
      }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
};

const corrugationTexture = () => {
  const t = canvasTexture(64, 4, (g, w) => {
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.35, '#d8d8d8');
    grad.addColorStop(0.5, '#a9a9a9');
    grad.addColorStop(0.65, '#d8d8d8');
    grad.addColorStop(1, '#ffffff');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, 4);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
};

const cartonTexture = () =>
  canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    const grad = g.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w * 0.75);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.22)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });

function labelTexture(text, { size = 64, weight = 500 } = {}) {
  const font = `${weight} ${size}px "Zalando Sans", "Helvetica Neue", Arial, sans-serif`;
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font;
  // measureText ignores the letter spacing used when drawing, so add it.
  const w = Math.ceil(probe.measureText(text).width + text.length * 3 + size * 0.5);
  const h = Math.ceil(size * 1.4);
  const t = canvasTexture(w, h, (g) => {
    g.font = font;
    g.fillStyle = '#ffffff';
    g.textBaseline = 'middle';
    g.letterSpacing = '3px';
    g.fillText(text, size * 0.25, h / 2);
  });
  return { tex: t, aspect: w / h };
}

// Light scene colours for PDF images, so prints look the same in either theme.
const PRINT_PALETTE = {
  '--scene-bg': '#f5f6f8',
  '--scene-ground': '#eceff3',
  '--scene-grid': '#d7dce3',
  '--scene-steel': '#8892a1',
  '--scene-frame': '#3a4651',
  '--scene-edge': '#1a2030',
  '--scene-label': '#4b5563',
  '--scene-dim': '#dde1e6',
  '--scene-accent': '#2f5be6',
};

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function disposeTree(root) {
  root.traverse((o) => {
    o.geometry?.dispose();
    for (const m of [].concat(o.material || [])) {
      m.map?.dispose();
      m.dispose();
    }
  });
  root.clear();
}

export class Viewer {
  constructor(host, { onHover } = {}) {
    this.host = host;
    this.onHover = onHover;

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.domElement.className = 'vp-canvas';
    host.prepend(r.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.05, 400);
    this.camera.position.set(14, 8, 12);

    const c = (this.controls = new OrbitControls(this.camera, r.domElement));
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.maxPolarAngle = Math.PI * 0.495;
    c.minDistance = 0.6;
    c.maxDistance = 90;
    c.screenSpacePanning = true;
    c.addEventListener('start', () => {
      this.tween = null;
      this.autoFit = false;
    });
    this.autoFit = true;
    this.view = 'iso';

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x7d848c, 1.15);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    const fill = new THREE.DirectionalLight(0xffffff, 0.55);
    fill.position.set(-12, 7, -9);
    this.scene.add(this.hemi, this.sun, this.sun.target, fill);

    this.groundMat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
    const ground = (this.ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), this.groundMat));
    this.groundY = -0.16;
    ground.position.y = this.groundY;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.shell = new THREE.Group(); // the unit itself
    this.annot = new THREE.Group(); // ruler, dimension lines and labels
    this.cargo = new THREE.Group(); // cartons
    this.marks = new THREE.Group(); // used-length marker
    this.scene.add(this.shell, this.annot, this.cargo, this.marks);

    this.textures = { floor: floorTexture(), corr: corrugationTexture(), carton: cartonTexture() };
    this.labels = [];
    this.mesh = null;
    this.lines = null;
    this.boxes = [];
    this.visible = 0;
    this.peel = { axis: 'none', amount: 0 };
    this.hovered = -1;
    this.filter = null;
    this.tween = null;
    this.dirty = true;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.dragging = false;
    let down = null;
    r.domElement.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      down = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('pointerup', (e) => {
      this.dragging = false;
      // Touch has no hover, so a tap (press without dragging) inspects a carton.
      if (down && e.pointerType !== 'mouse' && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8) this.pick(e);
      down = null;
    });
    r.domElement.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') this.pick(e);
    });
    r.domElement.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && this.setHover(-1));

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();

    this.applyTheme();
    new MutationObserver(() => this.applyTheme()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    this.tick = this.tick.bind(this);
    requestAnimationFrame(this.tick);
  }

  // The scene is only redrawn when something changed.
  invalidate() {
    this.dirty = true;
  }

  resize() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // Keep the unit framed until the user moves the camera themselves.
    if (this.autoFit && this.dims) this.setView(this.view, false);
    this.invalidate();
  }

  // Colours come from the page's CSS tokens, or from `palette` (used to render
  // print images in a light scheme whatever the page theme is).
  applyTheme(palette = null) {
    const t = (name, fallback) => (palette && palette[name]) || token(name, fallback);
    this.themeColor = t;
    const bg = new THREE.Color(t('--scene-bg', '#dfe5ea'));
    this.scene.background = bg;
    this.scene.fog = new THREE.Fog(bg, 45, 150);
    this.groundMat.color.set(t('--scene-ground', '#d3dae0'));
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      this.grid.material.dispose();
    }
    const gc = t('--scene-grid', '#bcc6cf');
    this.grid = new THREE.GridHelper(80, 80, gc, gc);
    this.grid.position.y = this.groundY + 0.001;
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.55;
    this.scene.add(this.grid);
    const label = t('--scene-label', '#4b5965');
    this.labels.forEach((m) => m.material.color.set(m.userData.accent ? t('--scene-accent', '#3550e6') : label));
    if (this.annotMat) this.annotMat.color.set(label);
    if (this.usedMat) this.usedMat.color.set(t('--scene-accent', '#3550e6'));
    if (this.wallMats) this.wallMats.forEach((m) => m.color.set(t('--scene-steel', '#8f9ba6')));
    if (this.frameMat) this.frameMat.color.set(t('--scene-frame', '#3a4651'));
    if (this.envMat) this.envMat.color.set(t('--scene-edge', '#1d2833'));
    if (this.lines) this.lines.material.color.set(t('--scene-edge', '#1d2833'));
    this.dimColor = new THREE.Color(t('--scene-dim', '#c5ccd3'));
    if (this.mesh) this.paint();
    this.invalidate();
  }

  color(name, fallback) {
    return (this.themeColor || token)(name, fallback);
  }

  // ------------------------------------------------------------ annotation
  // A flat text label lying on the floor plane, readable from the +z side.
  label(text, height, { accent = false } = {}) {
    const { tex, aspect } = labelTexture(text);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      color: this.color(accent ? '--scene-accent' : '--scene-label', '#4b5965'),
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(height * aspect, height), mat);
    m.rotation.x = -Math.PI / 2;
    m.userData.accent = accent;
    m.userData.width = height * aspect;
    this.labels.push(m);
    return m;
  }

  // Ruler along the length, width and height dimension lines, and end labels.
  buildAnnotations(spec, fmtLen, unit) {
    const { L, W, H } = this.dims;
    const s = Math.sqrt(L * W) / 5.3; // text and tick size follows the unit's size
    const small = L < 2.5;
    const seg = [];
    const line = (x0, y0, z0, x1, y1, z1) => seg.push(x0, y0, z0, x1, y1, z1);
    const y = 0.004;

    // Length ruler on the near (+z) side, measured from the front wall.
    const z0 = W / 2 + 0.2 * s;
    const step = unit === 'in'
      ? small ? { minor: 0.1524, every: 2, text: (m) => `${Math.round(m / 0.0254)}"` } : { minor: 0.3048, every: 5, text: (m) => `${Math.round(m / 0.3048)}'` }
      : small ? { minor: 0.1, every: 2, text: (m) => `${Math.round(m * 100)}` } : { minor: 0.5, every: 4, text: (m) => `${Math.round(m)} m` };
    line(-L / 2, y, z0, L / 2, y, z0);
    const lh = 0.27 * s;
    const end = this.label(fmtLen(spec.L), lh * 1.1);
    for (let i = 0; i * step.minor <= L + 1e-6; i++) {
      const d = i * step.minor;
      const major = i % step.every === 0;
      const x = -L / 2 + d;
      line(x, y, z0, x, y, z0 + (major ? 0.2 : 0.1) * s);
      if (major && i > 0 && L - d > end.userData.width * 0.75 + lh) {
        const t = this.label(step.text(d), lh);
        t.position.set(x, y, z0 + 0.42 * s);
        this.annot.add(t);
      }
    }
    line(L / 2, y, z0, L / 2, y, z0 + 0.2 * s);
    end.position.set(L / 2 - end.userData.width / 2 + lh * 0.3, y, z0 + 0.42 * s);
    this.annot.add(end);
    this.ruler = { z0, s, lh };

    // Width, across the front.
    const xw = -L / 2 - 0.28 * s;
    line(xw, y, -W / 2, xw, y, W / 2);
    for (const z of [-W / 2, W / 2]) line(xw - 0.08 * s, y, z, xw + 0.08 * s, y, z);
    const wl = this.label(fmtLen(spec.W), lh);
    wl.rotation.z = Math.PI / 2;
    wl.position.set(xw - 0.24 * s, y, 0);
    this.annot.add(wl);

    // Height, standing at the front near corner.
    const zh = W / 2 + 0.2 * s;
    line(xw, 0, zh, xw, H, zh);
    for (const yy of [0, H]) line(xw - 0.08 * s, yy, zh, xw + 0.08 * s, yy, zh);
    const hl = this.label(spec.pallet ? `${fmtLen(spec.H - (spec.deck || 0))} of cartons` : fmtLen(spec.H), lh);
    hl.rotation.set(0, 0, Math.PI / 2);
    hl.position.set(xw - 0.24 * s, H / 2, zh);
    this.annot.add(hl);

    if (spec.pallet) {
      const cap = this.label(`${fmtLen(spec.H)} max with pallet`, lh * 0.9);
      cap.position.set(0, y, z0 + 1.2 * s);
      this.annot.add(cap);
    } else {
      const fr = this.label('FRONT', 0.36 * s);
      fr.rotation.z = Math.PI / 2;
      fr.position.set(xw - 0.78 * s, y, 0);
      const dr = this.label('DOORS', 0.36 * s);
      dr.rotation.z = -Math.PI / 2;
      dr.position.set(L / 2 + W / 2 + 0.45, y, 0);
      this.annot.add(fr, dr);
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    this.annotMat = new THREE.LineBasicMaterial({ color: this.color('--scene-label', '#4b5965'), fog: false, toneMapped: false });
    this.annot.add(new THREE.LineSegments(g, this.annotMat));
  }

  // Coloured strip on the ruler showing how much floor length the load uses.
  setUsed(mm, text) {
    this.used = { mm, text };
    disposeTree(this.marks);
    this.labels = this.labels.filter((m) => !m.userData.used);
    this.usedMat = null;
    if (!mm || !this.ruler || !this.dims) return this.invalidate();
    const { L } = this.dims;
    const { z0, s, lh } = this.ruler;
    const used = Math.min(L, mm / 1000);
    this.usedMat = new THREE.MeshBasicMaterial({ color: this.color('--scene-accent', '#3550e6'), fog: false, toneMapped: false });
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(used, 0.07 * s).rotateX(-Math.PI / 2), this.usedMat);
    strip.position.set(-L / 2 + used / 2, 0.006, z0 - 0.055 * s);
    const t = this.label(text, lh, { accent: true });
    t.userData.used = true;
    const half = t.userData.width / 2;
    t.position.set(Math.max(-L / 2 + half, Math.min(L / 2 - half, -L / 2 + used - half)), 0.006, z0 + 0.82 * s);
    this.marks.add(strip, t);
    this.marks.visible = this.annot.visible;
    this.invalidate();
  }

  // ---------------------------------------------------------------- shell
  // opts.fmtLen(mm) formats lengths; opts.unit is 'in' or 'cm' for the ruler.
  setContainer(spec, { fmtLen = (mm) => `${(mm / 1000).toFixed(2)} m`, unit = 'cm' } = {}) {
    const L = spec.L / 1000, W = spec.W / 1000, H = (spec.H - (spec.deck || 0)) / 1000;
    disposeTree(this.shell);
    disposeTree(this.annot);
    disposeTree(this.marks);
    this.labels = [];
    this.envMat = null;
    this.wallMats = [];
    this.usedMat = null;
    this.frameMat = new THREE.MeshStandardMaterial({ color: this.color('--scene-frame', '#3a4651'), roughness: 0.55, metalness: 0.45 });
    this.walls = new THREE.Group();
    this.doors = new THREE.Group();

    const lift = spec.pallet ? (spec.deck || 150) / 1000 : spec.trailer ? 1.22 : 0.16;
    this.dims = { L, W, H, base: -lift };
    this.setGround(-lift);

    if (spec.pallet) this.buildPallet(L, W, H, lift);
    else this.buildBox(spec, L, W, H, lift);

    this.shell.add(this.walls, this.doors);
    this.setWallsVisible(this.wallsOn !== false);
    this.buildAnnotations(spec, fmtLen, unit);
    // Redrawing the unit (a unit switch, or fonts finishing loading) keeps
    // the used-length marker of the load that is still on show.
    if (this.used && this.mesh) this.setUsed(this.used.mm, this.used.text);
    this.fitShadow(L, W);
    this.invalidate();
  }

  bar(sx, sy, sz, x, y, z, mat = this.frameMat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    this.shell.add(m);
    return m;
  }

  // Container or trailer body: plank floor, see-through corrugated walls,
  // open doors and a steel frame, standing on sills or on trailer running gear.
  buildBox(spec, L, W, H, lift) {
    const floorTex = this.textures.floor.clone();
    floorTex.needsUpdate = true;
    floorTex.repeat.set(L / 2.4, W / 2.4);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(L, 0.03, W), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.85 }));
    floor.position.y = -0.015;
    floor.receiveShadow = true;
    this.shell.add(floor);

    const steel = this.color('--scene-steel', '#8f9ba6');
    const wallMat = (repeat, opacity) => {
      const map = this.textures.corr.clone();
      map.needsUpdate = true;
      map.repeat.set(repeat / 0.28, 1);
      const m = new THREE.MeshStandardMaterial({ color: steel, map, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, roughness: 0.6, metalness: 0.2 });
      this.wallMats.push(m);
      return m;
    };
    const sideMat = wallMat(L, 0.2);
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(L, H), sideMat);
      side.position.set(0, H / 2, (s * W) / 2);
      this.walls.add(side);
    }
    const front = new THREE.Mesh(new THREE.PlaneGeometry(W, H), wallMat(W, 0.2));
    front.rotation.y = Math.PI / 2;
    front.position.set(-L / 2, H / 2, 0);
    this.walls.add(front);

    // Doors swung open against the sides.
    const doorMat = wallMat(W / 2, 0.32);
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(L / 2, 0, (s * W) / 2);
      const leaf = new THREE.Mesh(new THREE.PlaneGeometry(W / 2, H), doorMat);
      leaf.position.set(0, H / 2, (-s * W) / 4);
      pivot.add(leaf);
      pivot.rotation.y = s * -1.95;
      this.doors.add(pivot);
    }

    // Steel frame along the edges.
    const t = 0.05;
    for (const zs of [-1, 1]) {
      this.bar(L + t, t, t, 0, -t / 2 + 0.005, zs * (W / 2 + t / 2));
      this.bar(L + t, t, t, 0, H + t / 2, zs * (W / 2 + t / 2));
      for (const xs of [-1, 1]) this.bar(t, H + t, t, xs * (L / 2 + t / 2), H / 2, zs * (W / 2 + t / 2));
    }
    for (const xs of [-1, 1]) {
      this.bar(t, t, W + 2 * t, xs * (L / 2 + t / 2), H + t / 2, 0);
      this.bar(t, t, W + 2 * t, xs * (L / 2 + t / 2), -t / 2 + 0.005, 0);
    }

    if (spec.trailer) this.buildRunningGear(L, W, lift);
    else {
      // Container understructure and the eight corner castings.
      this.bar(L, lift - 0.04, W - 0.1, 0, -0.03 - (lift - 0.04) / 2, 0);
      for (const xs of [-1, 1])
        for (const zs of [-1, 1])
          for (const yy of [-lift + 0.06, H + 0.01])
            this.bar(0.18, 0.12, 0.16, xs * (L / 2 - 0.04), yy, zs * (W / 2 - 0.03));
    }
  }

  // Trailer chassis: frame rails, a tandem at the rear, landing gear near
  // the nose and a rear impact guard.
  buildRunningGear(L, W, lift) {
    const dark = new THREE.MeshStandardMaterial({ color: '#15181d', roughness: 0.9 });
    const hub = new THREE.MeshStandardMaterial({ color: '#9aa3ad', roughness: 0.5, metalness: 0.6 });
    for (const zs of [-1, 1]) this.bar(L - 0.2, 0.3, 0.1, 0, -0.18, zs * 0.5);
    this.bar(L, 0.06, W + 0.02, 0, -0.062, 0);

    const R = 0.5;
    const tyre = new THREE.CylinderGeometry(R, R, 0.26, 28).rotateX(Math.PI / 2);
    const rim = new THREE.CylinderGeometry(R * 0.55, R * 0.55, 0.27, 20).rotateX(Math.PI / 2);
    for (const ax of [L / 2 - 1.3, L / 2 - 2.55]) {
      this.bar(0.12, 0.12, W - 0.5, ax, -lift + R, 0);
      for (const zs of [-1, 1])
        for (const k of [0, 1]) {
          const z = zs * (W / 2 - 0.17 - k * 0.31);
          const w = new THREE.Mesh(tyre, dark);
          w.position.set(ax, -lift + R, z);
          w.castShadow = true;
          const h = new THREE.Mesh(rim, hub);
          h.position.copy(w.position);
          this.shell.add(w, h);
        }
    }
    const legX = -L / 2 + 2.9;
    for (const zs of [-1, 1]) {
      this.bar(0.12, lift - 0.06, 0.12, legX, -lift / 2 - 0.03, zs * 0.75);
      this.bar(0.3, 0.03, 0.3, legX, -lift + 0.015, zs * 0.75);
    }
    this.bar(0.08, 0.08, 1.6, legX, -0.5, 0);
    // Rear impact guard.
    for (const zs of [-1, 1]) this.bar(0.08, 0.6, 0.08, L / 2 - 0.1, -0.36, zs * 0.6);
    this.bar(0.1, 0.1, W - 0.3, L / 2 - 0.1, -0.66, 0);
  }

  // A wooden pallet under the load: deck boards across the width, three
  // stringers along the length, and a dashed outline showing how high cartons
  // may be stacked. Cartons stand on the deck at y = 0.
  buildPallet(L, W, H, deck) {
    const board = 0.016;
    const stringerH = deck - 2 * board;
    const wood = new THREE.MeshStandardMaterial({ color: '#b98b5b', roughness: 0.9 });
    const bw = 0.14;
    const n = 7;
    for (let i = 0; i < n; i++) this.bar(bw, board, W, -L / 2 + bw / 2 + (i * (L - bw)) / (n - 1), -board / 2, 0, wood);
    for (const z of [-W / 2 + 0.022, 0, W / 2 - 0.022]) this.bar(L, stringerH, 0.044, 0, -board - stringerH / 2, z, wood);
    for (const x of [-L / 2 + bw / 2, 0, L / 2 - bw / 2]) this.bar(bw, board, W, x, -deck + board / 2, 0, wood);

    const env = new THREE.EdgesGeometry(new THREE.BoxGeometry(L, H, W));
    env.translate(0, H / 2, 0);
    this.envMat = new THREE.LineDashedMaterial({ color: this.color('--scene-edge', '#1d2833'), dashSize: 0.05, gapSize: 0.035, transparent: true, opacity: 0.6 });
    const outline = new THREE.LineSegments(env, this.envMat);
    outline.computeLineDistances();
    this.walls.add(outline);
  }

  setGround(y) {
    this.groundY = y;
    this.ground.position.y = y;
    if (this.grid) this.grid.position.y = y + 0.001;
  }

  // Shadow camera covers the load area.
  fitShadow(L, W) {
    const s = this.sun.shadow.camera;
    const ext = Math.max(L, W) / 2 + 2;
    s.left = -ext; s.right = ext; s.top = ext; s.bottom = -ext;
    s.near = 0.5; s.far = 80;
    s.updateProjectionMatrix();
    this.sun.position.set(L * 0.35, 18, W * 3 + 6);
    this.sun.target.position.set(0, 0, 0);
  }

  setWallsVisible(v) {
    this.wallsOn = v;
    if (this.walls) this.walls.visible = v;
    if (this.doors) this.doors.visible = v;
    this.invalidate();
  }

  setAnnotationsVisible(v) {
    this.annot.visible = v;
    this.marks.visible = v;
    this.invalidate();
  }

  // ---------------------------------------------------------------- cargo
  setLoad(load, items) {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.mesh.dispose();
    }
    if (this.lines) {
      this.lines.geometry.dispose();
      this.lines.material.dispose();
    }
    this.cargo.clear();
    this.mesh = null;
    this.lines = null;
    this.boxes = [];
    this.hovered = -1;
    this.filter = null;
    this.invalidate();
    if (!load || !load.boxes.length) return;

    const { L, W } = this.dims;
    const boxes = (this.boxes = load.boxes);
    const n = boxes.length;
    const mat = new THREE.MeshStandardMaterial({ map: this.textures.carton, roughness: 0.82, metalness: 0 });
    const mesh = (this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, n));
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const pos = new Float32Array(n * 24 * 3);
    this.centers = new Float32Array(n * 3);
    let k = 0;
    const push = (x, y, z) => {
      pos[k++] = x;
      pos[k++] = y;
      pos[k++] = z;
    };
    this.base = [];
    boxes.forEach((b, i) => {
      const x0 = b.x / 1000 - L / 2 + GAP / 2, x1 = (b.x + b.l) / 1000 - L / 2 - GAP / 2;
      const y0 = b.z / 1000 + GAP / 2, y1 = (b.z + b.h) / 1000 - GAP / 2;
      const z0 = b.y / 1000 - W / 2 + GAP / 2, z1 = (b.y + b.w) / 1000 - W / 2 - GAP / 2;
      p.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      s.set(x1 - x0, y1 - y0, z1 - z0);
      this.centers.set([p.x, p.y, p.z], i * 3);
      mesh.setMatrixAt(i, m4.compose(p, q, s));
      this.base.push(new THREE.Color(items[b.item].color));
      for (const y of [y0, y1]) {
        push(x0, y, z0); push(x1, y, z0);
        push(x1, y, z0); push(x1, y, z1);
        push(x1, y, z1); push(x0, y, z1);
        push(x0, y, z1); push(x0, y, z0);
      }
      for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) {
        push(x, y0, z);
        push(x, y1, z);
      }
    });
    this.matrices = mesh.instanceMatrix.array.slice();
    this.paint();
    mesh.computeBoundingSphere();

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.lineIndex = new Uint32Array(n * 24);
    g.setIndex(new THREE.BufferAttribute(this.lineIndex, 1));
    this.lines = new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({ color: this.color('--scene-edge', '#1d2833'), transparent: true, opacity: 0.38 })
    );
    this.cargo.add(mesh, this.lines);
    this.visible = n;
    this.refresh();
  }

  // Loading sequence: show only the first n cartons.
  setVisibleCount(n) {
    if (!this.mesh) return;
    this.visible = n;
    this.refresh();
  }

  // Peel cartons away to look inside the load. axis is 'none', 'side' (from
  // the near side), 'top' or 'door'; amount is the share removed, 0 to 1.
  setPeel(axis, amount) {
    this.peel = { axis, amount: axis === 'none' ? 0 : Math.max(0, Math.min(1, amount)) };
    this.refresh();
  }

  isPeeled(i) {
    const { axis, amount } = this.peel;
    if (!amount) return false;
    const { L, W, H } = this.dims;
    const c = this.centers;
    if (axis === 'side') return c[i * 3 + 2] > W / 2 - amount * W;
    if (axis === 'top') return c[i * 3 + 1] > H - amount * H;
    return c[i * 3] > L / 2 - amount * L;
  }

  // Applies the loading sequence and the peel to the cartons and their edges.
  refresh() {
    if (!this.mesh) return;
    const n = this.boxes.length;
    const arr = this.mesh.instanceMatrix.array;
    const idx = this.lineIndex;
    let k = 0;
    for (let i = 0; i < n; i++) {
      const show = i < this.visible && !this.isPeeled(i);
      const o = i * 16;
      if (show) {
        for (let j = 0; j < 16; j++) arr[o + j] = this.matrices[o + j];
        for (let j = 0; j < 24; j++) idx[k++] = i * 24 + j;
      } else {
        // A zero-size carton draws nothing and can't be hovered.
        arr[o] = arr[o + 5] = arr[o + 10] = 0;
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.lines.geometry.index.needsUpdate = true;
    this.lines.geometry.setDrawRange(0, k);
    this.invalidate();
  }

  // filter: null | { item } | { block }
  setFilter(filter) {
    this.filter = filter;
    this.paint();
  }

  paint() {
    if (!this.mesh) return;
    const f = this.filter;
    const c = new THREE.Color();
    this.boxes.forEach((b, i) => {
      c.copy(this.base[i]);
      const match = !f || (f.item != null && b.item === f.item) || (f.block != null && b.block === f.block);
      if (!match) c.lerp(this.dimColor, 0.82);
      if (i === this.hovered) c.offsetHSL(0, 0.04, 0.12);
      this.mesh.setColorAt(i, c);
    });
    this.mesh.instanceColor.needsUpdate = true;
    this.invalidate();
  }

  pick(e) {
    if (!this.mesh || this.dragging) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.mesh, false)[0];
    const id = hit ? hit.instanceId : -1;
    this.setHover(id);
    if (this.onHover) this.onHover(id >= 0 ? { box: this.boxes[id], x: e.clientX - rect.left, y: e.clientY - rect.top } : null);
  }

  setHover(id) {
    if (id === this.hovered) return;
    this.hovered = id;
    this.paint();
    if (id < 0 && this.onHover) this.onHover(null);
  }

  // ---------------------------------------------------------------- camera
  setView(view, animate = true) {
    if (!this.dims) return;
    this.view = view;
    this.autoFit = true;
    const { L, W, H } = this.dims;
    const cam = this.camera;
    const base = this.dims.base || 0;
    const target = new THREE.Vector3(0, (H + base) / 2, 0);
    const dirs = {
      top: new THREE.Vector3(0, 1, 0.015),
      side: new THREE.Vector3(0, 0.12, 1),
      door: new THREE.Vector3(1, 0.16, 0),
      iso: new THREE.Vector3(0.8, 0.52, 1),
    };
    const dir = (dirs[view] || dirs.iso).clone().normalize();
    if (view === 'top') target.y = 0;

    // Closest distance at which every corner of the unit (plus a margin for
    // the ruler and labels) is inside the frustum.
    const s = Math.sqrt(L * W) / 5.3;
    const pad = 0.45 * s;
    const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const tanH = tanV * cam.aspect;
    const fwd = dir.clone().negate();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd);
    let dist = 0;
    for (const x of [-L / 2 - pad, L / 2 + pad])
      for (const y of [base, H + 0.1])
        for (const z of [-W / 2 - pad, W / 2 + pad * (view === 'door' ? 1 : 2.3)]) {
          const v = new THREE.Vector3(x, y, z).sub(target);
          const depth = v.dot(dir);
          dist = Math.max(dist, Math.abs(v.dot(right)) / tanH + depth, Math.abs(v.dot(up)) / tanV + depth);
        }
    dist *= 1.04;
    const to = target.clone().add(dir.multiplyScalar(dist));
    this.invalidate();
    if (!animate) {
      cam.position.copy(to);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }
    this.tween = {
      t0: performance.now(),
      dur: 750,
      fromPos: cam.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPos: to,
      toTarget: target,
    };
  }

  // Renders each named view (iso, top, side, door) off-screen at its own size
  // and returns JPEG data URLs, then puts the live view back as it was.
  // Each shot is { view, width, height, fov?, walls?, labels? }. A narrow fov
  // gives a near-flat, plan-like projection; walls: false hides walls and
  // doors; labels: false hides the ruler and dimension labels.
  captureViews(shots, palette = PRINT_PALETTE) {
    const r = this.renderer;
    const cam = this.camera;
    const prev = {
      ratio: r.getPixelRatio(),
      pos: cam.position.clone(),
      target: this.controls.target.clone(),
      view: this.view,
      autoFit: this.autoFit,
      filter: this.filter,
      hovered: this.hovered,
      visible: this.visible,
      peel: this.peel,
      fov: cam.fov,
      annot: this.annot.visible,
    };
    const wallsOn = this.wallsOn !== false;
    this.tween = null;
    this.filter = null;
    this.hovered = -1;
    this.peel = { axis: 'none', amount: 0 };
    this.applyTheme(palette);
    this.visible = this.boxes.length;
    this.refresh();
    r.setPixelRatio(1);

    const out = {};
    for (const { view, width, height, fov, walls = true, labels = true } of shots) {
      this.annot.visible = this.marks.visible = labels;
      r.setSize(width, height, false);
      cam.aspect = width / height;
      cam.fov = fov || prev.fov;
      cam.updateProjectionMatrix();
      const show = walls && wallsOn;
      this.walls.visible = show;
      this.doors.visible = show;
      this.setView(view, false);
      r.render(this.scene, cam);
      out[view] = r.domElement.toDataURL('image/jpeg', 0.9);
    }

    r.setPixelRatio(prev.ratio);
    cam.fov = prev.fov;
    this.setWallsVisible(wallsOn);
    this.setAnnotationsVisible(prev.annot);
    this.view = prev.view;
    this.autoFit = prev.autoFit;
    this.filter = prev.filter;
    this.hovered = prev.hovered;
    this.peel = prev.peel;
    this.visible = prev.visible;
    this.resize();
    if (!prev.autoFit) {
      cam.position.copy(prev.pos);
      this.controls.target.copy(prev.target);
      this.controls.update();
    }
    this.applyTheme();
    this.refresh();
    return out;
  }

  tick(now) {
    requestAnimationFrame(this.tick);
    const tw = this.tween;
    if (tw) {
      const k = Math.min(1, (now - tw.t0) / tw.dur);
      const e = easeInOut(k);
      this.camera.position.lerpVectors(tw.fromPos, tw.toPos, e);
      this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, e);
      if (k >= 1) this.tween = null;
    }
    const moved = this.controls.update();
    if (!moved && !tw && !this.dirty) return;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
  }
}
