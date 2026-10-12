import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// World space is metres. The container floor sits on y = 0, centred on the
// origin; the front wall is at -x and the doors at +x.
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

const floorTexture = () => {
  const t = canvasTexture(512, 512, (g, w, h) => {
    const planks = 8;
    const ph = h / planks;
    for (let i = 0; i < planks; i++) {
      const tone = 150 + ((i * 37) % 30);
      g.fillStyle = `rgb(${tone}, ${tone * 0.74 | 0}, ${tone * 0.5 | 0})`;
      g.fillRect(0, i * ph, w, ph);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, i * ph, w, 2);
      const joint = ((i * 173) % w);
      g.fillRect(joint, i * ph, 2, ph);
      for (let k = 0; k < 14; k++) {
        g.fillStyle = `rgba(60,35,15,${0.05 + Math.random() * 0.06})`;
        g.fillRect(Math.random() * w, i * ph + Math.random() * ph, 40 + Math.random() * 120, 1.5);
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
  const w = Math.ceil(probe.measureText(text).width + size * 0.6);
  const h = Math.ceil(size * 1.4);
  const t = canvasTexture(w, h, (g) => {
    g.font = font;
    g.fillStyle = '#ffffff';
    g.textBaseline = 'middle';
    g.letterSpacing = '4px';
    g.fillText(text, size * 0.3, h / 2);
  });
  return { tex: t, aspect: w / h };
}

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

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
    c.minDistance = 1.2;
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
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), this.groundMat);
    ground.position.y = -0.031;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.shell = new THREE.Group();
    this.cargo = new THREE.Group();
    this.scene.add(this.shell, this.cargo);

    this.textures = { floor: floorTexture(), corr: corrugationTexture(), carton: cartonTexture() };
    this.labels = [];
    this.mesh = null;
    this.lines = null;
    this.hovered = -1;
    this.filter = null;
    this.tween = null;

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
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyTheme());
    new MutationObserver(() => this.applyTheme()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    this.tick = this.tick.bind(this);
    requestAnimationFrame(this.tick);
  }

  resize() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // Keep the container framed until the user moves the camera themselves.
    if (this.autoFit && this.dims) this.setView(this.view, false);
  }

  applyTheme() {
    const bg = new THREE.Color(token('--scene-bg', '#dfe5ea'));
    this.scene.background = bg;
    this.scene.fog = new THREE.Fog(bg, 45, 150);
    this.groundMat.color.set(token('--scene-ground', '#d3dae0'));
    if (this.grid) this.scene.remove(this.grid);
    const gc = token('--scene-grid', '#bcc6cf');
    this.grid = new THREE.GridHelper(80, 80, gc, gc);
    this.grid.position.y = -0.03;
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.55;
    this.scene.add(this.grid);
    const label = token('--scene-label', '#4b5965');
    this.labels.forEach((m) => m.material.color.set(label));
    if (this.wallMat) this.wallMat.color.set(token('--scene-steel', '#8f9ba6'));
    if (this.lines) this.lines.material.color.set(token('--scene-edge', '#1d2833'));
    this.dimColor = new THREE.Color(token('--scene-dim', '#c5ccd3'));
    if (this.mesh) this.paint();
  }

  // ---------------------------------------------------------------- shell
  // fmtLen(mm) formats the ground labels in the user's length unit.
  setContainer(spec, fmtLen = (mm) => `${(mm / 1000).toFixed(2)} m`) {
    const L = spec.L / 1000, W = spec.W / 1000, H = spec.H / 1000;
    this.dims = { L, W, H };
    this.shell.clear();
    this.labels = [];

    const floorTex = this.textures.floor.clone();
    floorTex.needsUpdate = true;
    floorTex.repeat.set(L / 2.4, W / 2.4);
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(L, 0.03, W),
      new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.85 })
    );
    floor.position.y = -0.015;
    floor.receiveShadow = true;
    this.shell.add(floor);

    const corr = this.textures.corr.clone();
    corr.needsUpdate = true;
    corr.repeat.set(L / 0.28, 1);
    this.wallMat = new THREE.MeshStandardMaterial({
      color: token('--scene-steel', '#8f9ba6'),
      map: corr,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
      roughness: 0.6,
      metalness: 0.2,
    });
    const walls = (this.walls = new THREE.Group());
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(L, H), this.wallMat);
      side.position.set(0, H / 2, (s * W) / 2);
      walls.add(side);
    }
    const frontCorr = corr.clone();
    frontCorr.needsUpdate = true;
    frontCorr.repeat.set(W / 0.28, 1);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(W, H), this.wallMat.clone());
    front.material.map = frontCorr;
    front.rotation.y = Math.PI / 2;
    front.position.set(-L / 2, H / 2, 0);
    walls.add(front);

    // Doors swung open against the sides.
    const doorMat = this.wallMat.clone();
    doorMat.opacity = 0.32;
    const doorCorr = corr.clone();
    doorCorr.needsUpdate = true;
    doorCorr.repeat.set(W / 2 / 0.28, 1);
    doorMat.map = doorCorr;
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(L / 2, 0, (s * W) / 2);
      const leaf = new THREE.Mesh(new THREE.PlaneGeometry(W / 2, H), doorMat);
      leaf.position.set(0, H / 2, (-s * W) / 4);
      pivot.add(leaf);
      pivot.rotation.y = s * -1.95;
      walls.add(pivot);
    }
    this.shell.add(walls);

    // Steel frame along the edges.
    const frameMat = new THREE.MeshStandardMaterial({ color: '#3a4651', roughness: 0.55, metalness: 0.45 });
    const t = 0.05;
    const bar = (sx, sy, sz, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), frameMat);
      m.position.set(x, y, z);
      m.castShadow = true;
      this.shell.add(m);
    };
    for (const zs of [-1, 1]) {
      bar(L + t, t, t, 0, -t / 2 + 0.005, zs * (W / 2 + t / 2));
      bar(L + t, t, t, 0, H + t / 2, zs * (W / 2 + t / 2));
      for (const xs of [-1, 1]) bar(t, H + t, t, xs * (L / 2 + t / 2), H / 2, zs * (W / 2 + t / 2));
    }
    for (const xs of [-1, 1]) {
      bar(t, t, W + 2 * t, xs * (L / 2 + t / 2), H + t / 2, 0);
      bar(t, t, W + 2 * t, xs * (L / 2 + t / 2), -t / 2 + 0.005, 0);
    }

    // Ground labels.
    const labelMat = (text, size) => {
      const { tex, aspect } = labelTexture(text, { size });
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: token('--scene-label', '#4b5965') });
      const hgt = 0.38;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(hgt * aspect, hgt), mat);
      m.rotation.x = -Math.PI / 2;
      this.labels.push(m);
      return m;
    };
    const fr = labelMat('FRONT', 64);
    fr.position.set(-L / 2 - 0.55, 0.002, 0);
    fr.rotation.z = Math.PI / 2;
    const dr = labelMat('DOORS', 64);
    dr.position.set(L / 2 + 1.45, 0.002, 0);
    dr.rotation.z = -Math.PI / 2;
    const len = labelMat(`${fmtLen(spec.L)} inside length`, 52);
    len.position.set(0, 0.002, W / 2 + 0.5);
    const wid = labelMat(fmtLen(spec.W), 52);
    wid.scale.setScalar(0.8);
    wid.position.set(-L / 2 - 1.15, 0.002, 0);
    wid.rotation.z = Math.PI / 2;
    this.shell.add(fr, dr, len, wid);

    // Shadow camera covers the container.
    const s = this.sun.shadow.camera;
    const ext = Math.max(L, W) / 2 + 2;
    s.left = -ext; s.right = ext; s.top = ext; s.bottom = -ext;
    s.near = 0.5; s.far = 80;
    s.updateProjectionMatrix();
    this.sun.position.set(L * 0.35, 18, W * 3 + 6);
    this.sun.target.position.set(0, 0, 0);
  }

  setWallsVisible(v) {
    if (this.walls) this.walls.visible = v;
  }

  // ---------------------------------------------------------------- cargo
  setLoad(load, items) {
    this.cargo.clear();
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.dispose();
    }
    if (this.lines) this.lines.geometry.dispose();
    this.mesh = null;
    this.lines = null;
    this.boxes = [];
    this.hovered = -1;
    this.filter = null;
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
    mesh.instanceMatrix.needsUpdate = true;
    this.paint();
    mesh.computeBoundingSphere();

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.lines = new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({ color: token('--scene-edge', '#1d2833'), transparent: true, opacity: 0.38 })
    );
    this.cargo.add(mesh, this.lines);
    this.setVisibleCount(n);
  }

  setVisibleCount(n) {
    if (!this.mesh) return;
    this.mesh.count = n;
    this.lines.geometry.setDrawRange(0, n * 24);
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
      if (!match) c.lerp(this.dimColor, 0.8);
      if (i === this.hovered) c.offsetHSL(0, 0.04, 0.12);
      this.mesh.setColorAt(i, c);
    });
    this.mesh.instanceColor.needsUpdate = true;
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
    const target = new THREE.Vector3(0, H / 2, 0);
    const dirs = {
      top: new THREE.Vector3(0, 1, 0.015),
      side: new THREE.Vector3(0, 0.12, 1),
      door: new THREE.Vector3(1, 0.16, 0),
      iso: new THREE.Vector3(0.78, 0.6, 1),
    };
    const dir = (dirs[view] || dirs.iso).clone().normalize();
    if (view === 'top') target.y = 0;

    // Closest distance at which every corner of the container (plus a
    // margin) is inside the frustum.
    const pad = 0.35;
    const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const tanH = tanV * cam.aspect;
    const fwd = dir.clone().negate();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd);
    let dist = 0;
    for (const x of [-L / 2 - pad, L / 2 + pad])
      for (const y of [0, H + 0.1])
        for (const z of [-W / 2 - pad, W / 2 + pad]) {
          const v = new THREE.Vector3(x, y, z).sub(target);
          const depth = v.dot(dir);
          dist = Math.max(dist, Math.abs(v.dot(right)) / tanH + depth, Math.abs(v.dot(up)) / tanV + depth);
        }
    dist *= 1.06;
    const to = target.clone().add(dir.multiplyScalar(dist));
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

  snapshot() {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
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
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
