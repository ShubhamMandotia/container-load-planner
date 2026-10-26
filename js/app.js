import { EQUIPMENT, byId } from './containers.js';
import { planShipment } from './packer.js';
import { Viewer } from './viewer.js';
import { parseTable, toCsv } from './csv.js';
import { buildPdf } from './report.js';

// ------------------------------------------------------------------ state
const STORE_KEY = 'container-load-planner:v3';
const THEME_KEY = 'container-load-planner:theme';
const PALETTE = ['#4a64e8', '#e8973f', '#23a28a', '#d9577a', '#8c6ee0', '#c9a93d', '#3b9bd6', '#b0683f', '#71839a', '#6fae46', '#c056a6', '#3f4a5e'];
const LB = 0.45359237;
const CM_PER = { cm: 1, in: 2.54 };
const KG_PER = { kg: 1, lb: LB };
const CBM_TO_CFT = 35.3147;

let uid = 1;
const newId = () => `s${Date.now().toString(36)}${(uid++).toString(36)}`;

// A cargo line is one carton type.
//   kind "single": one SKU per carton. Cartons = units ÷ case pack (rounded
//                  up), or typed directly when units are left blank.
//   kind "nest":   several SKUs share one carton; `contents` lists each SKU
//                  and how many units of it go in every carton.
// Sizes are stored in cm and weights in kg whatever the display unit.
//
// The example is container TEMU7428660 (40' HC) as shipped, with package
// sizes (in) and weights (lb) from the product master.
const SAMPLE = [
  { kind: 'nest', name: 'NAF2580', cartons: 718, l: 13.5, w: 10.75, h: 25, weight: 20.64, contents: [{ sku: 'NAF2580L', pack: 1 }, { sku: 'NAF2580S', pack: 1 }] },
  { kind: 'single', sku: 'TB3896A', units: 700, casePack: 2, l: 18, w: 9, h: 9.75, weight: 9.5 },
  { kind: 'single', sku: 'CL3687B', units: 740, casePack: 4, l: 12.5, w: 9, h: 12.75, weight: 17.55 },
  { kind: 'single', sku: 'X77610A', units: 504, casePack: 4, l: 15.75, w: 13.25, h: 8, weight: 9.8 },
  { kind: 'single', sku: 'CL2231', units: 504, casePack: 8, l: 15.5, w: 8.5, h: 13, weight: 15.3 },
  { kind: 'single', sku: 'AF3598B', units: 58, casePack: 2, l: 16, w: 11.25, h: 26.75, weight: 13.55 },
];

function normItem(x, color) {
  return {
    id: x.id || newId(),
    kind: x.kind === 'nest' ? 'nest' : 'single',
    sku: x.sku || '',
    name: x.name || '',
    units: x.units || 0,
    casePack: x.casePack || 0,
    cartons: x.cartons || 0,
    contents: (x.contents || []).map((c) => ({ id: c.id || newId(), sku: c.sku || '', pack: c.pack || 0 })),
    l: x.l || 0,
    w: x.w || 0,
    h: x.h || 0,
    weight: x.weight || 0,
    // Which carton dimension must stand vertical: 'l', 'w', 'h', or '' for
    // any side. Most cartons may be laid on their side, so '' is the default.
    // Older saved data used `upright: true`, which means H up.
    up: ['l', 'w', 'h'].includes(x.up) ? x.up : x.upright === true ? 'h' : '',
    stackable: x.stackable !== false,
    color: x.color || color,
  };
}

function defaults() {
  return {
    equipment: '40HQ',
    overrides: {},
    unitLen: 'in',
    unitWt: 'lb',
    keepOrder: false,
    multi: false,
    isSample: true,
    items: SAMPLE.map((s, i) => normItem({ ...s, l: s.l * 2.54, w: s.w * 2.54, h: s.h * 2.54, weight: s.weight * LB }, PALETTE[i])),
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaults();
    const s = { ...defaults(), ...JSON.parse(raw) };
    s.items = Array.isArray(s.items) ? s.items.map((x, i) => normItem(x, PALETTE[i % PALETTE.length])) : [];
    return s;
  } catch {
    return defaults();
  }
}

let state = loadState();
let plan = null; // last result
let active = 0; // which container of a multi-unit plan is shown
let filter = null; // { item } | { block }
let stale = false;
let currentView = 'iso';

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: the app still works for this visit */
  }
}

// ---------------------------------------------------------------- helpers
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n, d = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const trim = (n, d = 2) => (Number.isFinite(n) ? String(Math.round(n * 10 ** d) / 10 ** d) : '');
const posInt = (v) => {
  const n = Number(String(v ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

const lenOut = (cm) => trim(cm / CM_PER[state.unitLen], 2);
const lenIn = (v) => parseFloat(v) * CM_PER[state.unitLen];
const wtOut = (kg) => trim(kg / KG_PER[state.unitWt], 2);
const wtIn = (v) => parseFloat(v) * KG_PER[state.unitWt];
const wtFmt = (kg) => `${fmt(kg / KG_PER[state.unitWt])} ${state.unitWt}`;

// Long lengths: metres, or feet and inches.
function metres(mm, ascii = false) {
  if (state.unitLen === 'cm') return `${(mm / 1000).toFixed(2)} m`;
  const inches = mm / 25.4;
  let ft = Math.floor(inches / 12);
  let inch = Math.round(inches - ft * 12);
  if (inch === 12) {
    ft += 1;
    inch = 0;
  }
  return ascii ? `${ft}' ${inch}"` : `${ft}′ ${inch}″`;
}
const dimsLabel = (Lmm, Wmm, Hmm) =>
  state.unitLen === 'cm'
    ? `${(Lmm / 1000).toFixed(2)} × ${(Wmm / 1000).toFixed(2)} × ${(Hmm / 1000).toFixed(2)} m`
    : `${metres(Lmm)} × ${metres(Wmm)} × ${metres(Hmm)}`;
const cartonLabel = (lcm, wcm, hcm) => `${lenOut(lcm)} × ${lenOut(wcm)} × ${lenOut(hcm)} ${state.unitLen}`;

function spec() {
  const base = byId(state.equipment);
  return { ...base, ...(state.overrides[base.id] || {}) };
}
const insideCbm = (s) => (s.L * s.W * s.H) / 1e9;
const itemCbm = (it) => (it.l * it.w * it.h) / 1e6;

// Cartons for a line, and whether that number comes from units ÷ case pack.
function cartonsOf(it) {
  if (it.kind === 'single' && it.units > 0 && it.casePack > 0) return Math.ceil(it.units / it.casePack);
  return it.cartons || 0;
}
const isComputed = (it) => it.kind === 'single' && it.units > 0 && it.casePack > 0;

function labelOf(it) {
  if (it.kind === 'single') return it.sku || 'Unnamed SKU';
  return it.name || it.contents.map((c) => c.sku).filter(Boolean).join(' + ') || 'Nested carton';
}
function contentsText(it) {
  return it.contents.filter((c) => c.sku).map((c) => `${c.sku} ×${c.pack || 1}`).join(' · ');
}

// Units of each SKU in `n` cartons of this line.
function unitsIn(it, n) {
  if (it.kind === 'nest') return it.contents.filter((c) => c.sku).map((c) => ({ sku: c.sku, units: n * (c.pack || 1) }));
  if (!it.casePack) return [];
  const u = n * it.casePack;
  return [{ sku: it.sku, units: it.units ? Math.min(it.units, u) : u }];
}
const unitsText = (list) => list.map((x) => `${esc(x.sku)} ${fmt(x.units)}`).join(' · ');

function validItem(it) {
  return it.l > 0 && it.w > 0 && it.h > 0 && cartonsOf(it) > 0 && !(it.weight < 0);
}
const touched = (it) => it.l || it.w || it.h || it.units || it.cartons || it.sku || it.name || it.contents.some((c) => c.sku);

let toastTimer;
function toast(msg, ms = 2800) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), ms);
  return t;
}

function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}

// ------------------------------------------------------------------ theme
function applyStoredTheme() {
  let t = null;
  try { t = localStorage.getItem(THEME_KEY); } catch { /* ignore */ }
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
}
function toggleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, root.dataset.theme); } catch { /* ignore */ }
}

// -------------------------------------------------------------- equipment
const equipMeta = (e) =>
  `<span><b>${fmt(e.rated, 0)}</b> CBM rated</span><span><b>${fmt(e.payload / KG_PER[state.unitWt])}</b> ${state.unitWt}</span>`;

function renderEquipment() {
  const maxL = Math.max(...EQUIPMENT.map((e) => e.L));
  $('#equipGrid').innerHTML = EQUIPMENT.map((base) => {
    const e = { ...base, ...(state.overrides[base.id] || {}) };
    const on = e.id === state.equipment;
    return `<button type="button" class="equip${on ? ' on' : ''}" role="radio" aria-checked="${on}" data-equip="${e.id}" id="equip-${e.id}">
      <span class="equip-top"><span class="equip-radio"></span><span class="equip-name">${esc(e.name)}</span><span class="equip-iso">${esc(e.iso)}</span></span>
      <span class="equip-len" title="Inside length ${metres(e.L)}"><span style="width:${(e.L / maxL) * 100}%"></span></span>
      <span class="equip-meta">${equipMeta(e)}</span>
    </button>`;
  }).join('');

}

// One table for every equipment type: rated CBM, payload and inside size.
function renderCapTable() {
  const u = state.unitLen;
  const cell = (id, k, val, label) =>
    `<td><input class="field num" id="cap-${id}-${k}" data-eq="${id}" data-cap="${k}" inputmode="decimal" value="${val}" aria-label="${label}"></td>`;
  $('#capTable').innerHTML = `<thead><tr><th>Equipment</th><th class="r">Rated CBM</th><th class="r">Payload (${state.unitWt})</th><th class="r">Inside L (${u})</th><th class="r">W (${u})</th><th class="r">H (${u})</th><th class="r">Inside CBM</th></tr></thead>
    <tbody>${EQUIPMENT.map((base) => {
      const e = { ...base, ...(state.overrides[base.id] || {}) };
      const changed = !!state.overrides[base.id];
      return `<tr${e.id === state.equipment ? ' class="on"' : ''}>
        <th scope="row"><span class="cap-name">${esc(e.name)}</span>${changed ? '<span class="chip">Edited</span>' : ''}</th>
        ${cell(e.id, 'rated', trim(e.rated, 1), `${e.name} rated CBM`)}
        ${cell(e.id, 'payload', trim(e.payload / KG_PER[state.unitWt], 0), `${e.name} payload`)}
        ${cell(e.id, 'L', lenOut(e.L / 10), `${e.name} inside length`)}
        ${cell(e.id, 'W', lenOut(e.W / 10), `${e.name} inside width`)}
        ${cell(e.id, 'H', lenOut(e.H / 10), `${e.name} inside height`)}
        <td class="r num" data-inside="${e.id}">${fmt(insideCbm(e), 1)}</td>
      </tr>`;
    }).join('')}</tbody>`;
}

function onCapChange(e) {
  const inp = e.target.closest('[data-cap]');
  if (!inp) return;
  const k = inp.dataset.cap;
  const id = inp.dataset.eq;
  const v = k === 'payload' ? wtIn(inp.value) : k === 'rated' ? parseFloat(inp.value) : lenIn(inp.value) * 10;
  const ok = Number.isFinite(v) && v > 0;
  inp.classList.toggle('invalid', !ok);
  if (!ok) return;
  const base = byId(id);
  const next = { ...(state.overrides[id] || {}), [k]: k === 'rated' ? Math.round(v * 10) / 10 : Math.round(v) };
  // Drop values that match the standard so "Edited" only shows real changes.
  for (const key of Object.keys(next)) if (Math.abs(next[key] - base[key]) < 0.5 * (key === 'rated' ? 0.1 : 1)) delete next[key];
  if (Object.keys(next).length) state.overrides[id] = next;
  else delete state.overrides[id];
  save();
  const cell = document.querySelector(`[data-inside="${id}"]`);
  if (cell) {
    cell.textContent = fmt(insideCbm({ ...base, ...(state.overrides[id] || {}) }), 1);
    const th = cell.closest('tr').querySelector('th');
    th.querySelector('.chip')?.remove();
    if (state.overrides[id]) th.insertAdjacentHTML('beforeend', '<span class="chip">Edited</span>');
  }
  updateEquipCards();
  if (id === state.equipment) refreshAfterSetupChange();
}

function updateEquipCards() {
  const maxL = Math.max(...EQUIPMENT.map((e) => e.L));
  for (const base of EQUIPMENT) {
    const e = { ...base, ...(state.overrides[base.id] || {}) };
    const card = document.getElementById(`equip-${e.id}`);
    if (!card) continue;
    card.querySelector('.equip-len span').style.width = `${(e.L / maxL) * 100}%`;
    card.querySelector('.equip-meta').innerHTML = equipMeta(e);
  }
}

// ------------------------------------------------------------------ cargo
const ICON_UP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"></path></svg>';
const ICON_STACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9 5-9 5-9-5z"></path><path d="M3 13l9 5 9-5"></path></svg>';
const ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>';

const UP_TITLES = {
  '': 'Any side can face up. Cartons may be laid on their side.',
  l: 'Length stands vertical: the L edge is the carton height.',
  w: 'Width stands vertical: the W edge is the carton height.',
  h: 'Height stands vertical: the carton stays as packed.',
};
function upPicker(it) {
  return `<div class="up-pick" role="radiogroup" aria-label="Which side is up for ${esc(labelOf(it))}">
    <span class="up-label">${ICON_UP}Up</span>
    ${['', 'l', 'w', 'h']
      .map((v) => {
        const id = `f-${it.id}-up-${v || 'any'}`;
        return `<label class="up-opt" for="${id}" title="${UP_TITLES[v]}"><input type="radio" id="${id}" name="up-${it.id}" data-k="up" value="${v}" ${it.up === v ? 'checked' : ''}><span>${v ? v.toUpperCase() : 'Any'}</span></label>`;
      })
      .join('')}
  </div>`;
}

function cargoCard(it) {
  const f = (k) => `f-${it.id}-${k}`;
  const num = (k, val, label, mode = 'decimal', extra = '') =>
    `<label for="${f(k)}" data-dim="${k}"${k === it.up ? ' class="is-up"' : ''}><span class="lbl">${label}</span><input class="field num" id="${f(k)}" data-k="${k}" inputmode="${mode}" value="${val}" autocomplete="off" ${extra}></label>`;
  const swatch = `<label class="swatch" style="background:${it.color}" title="Change colour"><input type="color" id="${f('color')}" data-k="color" value="${it.color}" aria-label="Colour for ${esc(labelOf(it))}"></label>`;
  const del = `<button type="button" class="del" data-del aria-label="Remove ${esc(labelOf(it))}">${ICON_X}</button>`;
  const dims = `<div class="dims">
      ${num('l', it.l ? lenOut(it.l) : '', `L (${state.unitLen})`)}
      ${num('w', it.w ? lenOut(it.w) : '', `W (${state.unitLen})`)}
      ${num('h', it.h ? lenOut(it.h) : '', `H (${state.unitLen})`)}
      ${num('weight', it.weight ? wtOut(it.weight) : '', `Wt/ctn (${state.unitWt})`)}
    </div>`;
  const foot = `<div class="sku-foot">
      ${upPicker(it)}
      <label class="toggle" title="Other cartons can be stacked on top"><input type="checkbox" id="${f('stackable')}" data-k="stackable" ${it.stackable ? 'checked' : ''}>${ICON_STACK}Stackable</label>
      <span class="sku-cbm" data-cbm></span>
    </div>
    <div class="sku-note" data-note hidden></div>`;

  if (it.kind === 'nest') {
    const lines = it.contents
      .map(
        (c) => `<div class="nest-line" data-cid="${c.id}">
          <input class="field" id="${f(`c-${c.id}-sku`)}" data-c="sku" value="${esc(c.sku)}" placeholder="SKU #" aria-label="SKU in nested carton" autocomplete="off">
          <input class="field num" id="${f(`c-${c.id}-pack`)}" data-c="pack" inputmode="numeric" value="${c.pack || ''}" placeholder="1" aria-label="Units of this SKU per carton" autocomplete="off">
          <button type="button" class="del small" data-cdel aria-label="Remove ${esc(c.sku || 'SKU')} from carton">${ICON_X}</button>
        </div>`
      )
      .join('');
    return `<div class="sku nest" data-id="${it.id}" style="--sku-color:${it.color}">
      <div class="sku-row">
        ${swatch}
        <span class="nest-badge">Nested</span>
        <input class="field sku-name" id="${f('name')}" data-k="name" value="${esc(it.name)}" placeholder="Carton name, e.g. SET-01" aria-label="Nested carton name" autocomplete="off">
        ${del}
      </div>
      <div class="nest-box">
        <div class="nest-head"><span>SKUs in this carton</span><span>Units / ctn</span><span></span></div>
        ${lines}
        <button type="button" class="text-btn nest-add" data-cadd>+ Add SKU to carton</button>
      </div>
      <div class="qty-grid nest-qty">
        ${num('cartons', it.cartons || '', 'Cartons', 'numeric')}
        <div class="nest-units" data-nunits></div>
      </div>
      ${dims}
      ${foot}
    </div>`;
  }

  const computed = isComputed(it);
  return `<div class="sku" data-id="${it.id}" style="--sku-color:${it.color}">
    <div class="sku-row">
      ${swatch}
      <input class="field sku-name" id="${f('sku')}" data-k="sku" value="${esc(it.sku)}" placeholder="SKU #" aria-label="SKU" autocomplete="off">
      ${del}
    </div>
    <div class="qty-grid">
      ${num('units', it.units || '', 'Units', 'numeric')}
      ${num('casePack', it.casePack || '', 'Case pack', 'numeric')}
      ${num('cartons', computed ? cartonsOf(it) : it.cartons || '', 'Cartons', 'numeric', computed ? 'readonly title="Units ÷ case pack, rounded up"' : '')}
    </div>
    ${dims}
    ${foot}
  </div>`;
}

function renderCargo() {
  $('#cargoList').innerHTML = state.items.map(cargoCard).join('');
  state.items.forEach(updateRowInfo);
  updateTotals();
  $('#sampleChip').hidden = !state.isSample;
  highlightInvalid();
}

function rerenderCard(it, focusSel) {
  const row = document.querySelector(`.sku[data-id="${it.id}"]`);
  if (!row) return;
  row.outerHTML = cargoCard(it);
  updateRowInfo(it);
  if (focusSel) document.getElementById(focusSel)?.focus();
}

function updateRowInfo(it) {
  const row = document.querySelector(`.sku[data-id="${it.id}"]`);
  if (!row) return;
  const n = cartonsOf(it);
  const cbm = itemCbm(it);
  row.querySelector('[data-cbm]').innerHTML =
    cbm > 0 ? `<b>${cbm.toFixed(3)}</b> CBM/ctn${n ? ` · <b>${(cbm * n).toFixed(2)}</b> CBM` : ''}` : '';

  const note = row.querySelector('[data-note]');
  let msg = '';
  if (it.kind === 'single') {
    const c = row.querySelector('[data-k="cartons"]');
    const computed = isComputed(it);
    c.readOnly = computed;
    c.classList.toggle('computed', computed);
    c.title = computed ? 'Units ÷ case pack, rounded up' : '';
    if (computed && document.activeElement !== c) c.value = n;
    if (computed && it.units % it.casePack) msg = `Last carton is part-filled with ${it.units % it.casePack} unit${it.units % it.casePack === 1 ? '' : 's'}.`;
  } else {
    const u = unitsIn(it, n);
    row.querySelector('[data-nunits]').innerHTML = n && u.length ? `Ships ${unitsText(u)} units` : 'Add SKUs and the number of cartons.';
  }
  note.textContent = msg;
  note.hidden = !msg;
}

function updateTotals() {
  const valid = state.items.filter(validItem);
  const ctns = valid.reduce((s, it) => s + cartonsOf(it), 0);
  const cbm = valid.reduce((s, it) => s + itemCbm(it) * cartonsOf(it), 0);
  const kg = valid.reduce((s, it) => s + (it.weight || 0) * cartonsOf(it), 0);
  const s = spec();
  $('#cargoTotals').innerHTML = state.items.length
    ? `<span><b>${state.items.length}</b> line${state.items.length === 1 ? '' : 's'}</span><span><b>${fmt(ctns)}</b> cartons</span><span><b>${cbm.toFixed(2)}</b> CBM <span class="num">(${fmt((cbm / s.rated) * 100)}% of ${fmt(s.rated)})</span></span>${kg ? `<span><b>${wtFmt(kg)}</b></span>` : ''}`
    : '<span>No cargo yet. Add a SKU, a nested carton, or import a CSV.</span>';
}

function onCargoInput(e) {
  const row = e.target.closest('.sku');
  if (!row) return;
  const it = state.items.find((x) => x.id === row.dataset.id);
  const inp = e.target;

  if (inp.dataset.c) {
    const c = it.contents.find((x) => x.id === inp.closest('[data-cid]').dataset.cid);
    if (inp.dataset.c === 'sku') c.sku = inp.value;
    else {
      c.pack = posInt(inp.value);
      inp.classList.toggle('invalid', inp.value.trim() !== '' && !c.pack);
    }
  } else if (inp.dataset.k) {
    const k = inp.dataset.k;
    if (k === 'sku' || k === 'name') it[k] = inp.value;
    else if (k === 'color') {
      it.color = inp.value;
      row.querySelector('.swatch').style.background = inp.value;
      row.style.setProperty('--sku-color', inp.value);
    } else if (k === 'stackable') it[k] = inp.checked;
    else if (k === 'up') {
      it.up = inp.value;
      row.querySelectorAll('[data-dim]').forEach((el) => el.classList.toggle('is-up', el.dataset.dim === it.up));
    }
    else if (k === 'units' || k === 'casePack' || k === 'cartons') {
      if (inp.readOnly) return;
      it[k] = posInt(inp.value);
      inp.classList.toggle('invalid', inp.value.trim() !== '' && !it[k]);
    } else if (k === 'weight') {
      const v = inp.value.trim() === '' ? 0 : wtIn(inp.value);
      it.weight = Number.isFinite(v) && v >= 0 ? v : 0;
      inp.classList.toggle('invalid', inp.value.trim() !== '' && !(v >= 0));
    } else {
      const v = lenIn(inp.value);
      it[k] = Number.isFinite(v) && v > 0 ? v : 0;
      inp.classList.toggle('invalid', inp.value.trim() !== '' && !(v > 0));
    }
    if (k === 'color' && plan) {
      const p = plan.items.find((x) => x.id === it.id);
      if (p) {
        p.color = it.color;
        showLoad();
        renderResults();
      }
      save();
      return;
    }
  } else return;

  if (state.isSample) {
    state.isSample = false;
    $('#sampleChip').hidden = true;
  }
  updateRowInfo(it);
  updateTotals();
  save();
  markStale();
}

function onCargoClick(e) {
  const row = e.target.closest('.sku');
  if (!row) return;
  const it = state.items.find((x) => x.id === row.dataset.id);
  if (e.target.closest('[data-del]') && !e.target.closest('[data-cdel]')) {
    state.items = state.items.filter((x) => x !== it);
    state.isSample = false;
    save();
    renderCargo();
    markStale();
    return;
  }
  if (e.target.closest('[data-cadd]')) {
    const c = { id: newId(), sku: '', pack: 1 };
    it.contents.push(c);
    save();
    rerenderCard(it, `f-${it.id}-c-${c.id}-sku`);
    return;
  }
  const cdel = e.target.closest('[data-cdel]');
  if (cdel) {
    const cid = cdel.closest('[data-cid]').dataset.cid;
    it.contents = it.contents.filter((c) => c.id !== cid);
    save();
    rerenderCard(it);
    markStale();
  }
}

function nextColor() {
  const used = new Set(state.items.map((x) => x.color));
  return PALETTE.find((c) => !used.has(c)) || PALETTE[state.items.length % PALETTE.length];
}
function addItem(data = {}) {
  const it = normItem(data, nextColor());
  state.items.push(it);
  return it;
}

function markStale() {
  if (!plan || stale) return;
  stale = true;
  renderResults();
}

function highlightInvalid() {
  for (const it of state.items) {
    const row = document.querySelector(`.sku[data-id="${it.id}"]`);
    if (row) row.classList.toggle('bad', !validItem(it) && !!touched(it));
  }
}

// ------------------------------------------------------------- CSV import
const HEADERS = () => [
  'SKU', 'Units', 'Case Pack', 'Cartons',
  `Length (${state.unitLen})`, `Width (${state.unitLen})`, `Height (${state.unitLen})`,
  `Weight per Carton (${state.unitWt})`, 'This Side Up (L/W/H/N)', 'Stackable (Y/N)', 'Nest Group',
];

function columnFor(h) {
  const s = h.toLowerCase().replace(/\s+/g, ' ').trim();
  if (/cbm|upc|gtin|hts|\bhs\b|fob|price|cost|duty|tariff|freight|container q|name|type|date|code/.test(s)) return null;
  if (/nest/.test(s)) return 'nest';
  if (/weight|\bwt\b|gross/.test(s)) return 'weight';
  if (/side up|up side|upright|orient/.test(s)) return 'up';
  if (/stack/.test(s)) return 'stackable';
  if (/length|^l\b|^l \(/.test(s)) return 'l';
  if (/width|^w\b|^w \(/.test(s)) return 'w';
  if (/height|depth|^h\b|^h \(/.test(s)) return 'h';
  if (/case ?pack|cspk|cs ?pk|inner ?pack|per (carton|ctn|case)/.test(s)) return 'casePack';
  if (/carton|ctn/.test(s)) return 'cartons';
  if (/unit|qty|quantity|pcs|pieces/.test(s)) return 'units';
  if (/sku|item|style|part/.test(s)) return 'sku';
  return null;
}

// When several headers map to the same field (product master sheets have
// both "Pro. Length" and "Package Length"), prefer the carton one.
function headerScore(h) {
  const s = h.toLowerCase();
  let n = 0;
  if (/package|carton|ctn|master|box|case/.test(s)) n += 2;
  if (/product|pro\./.test(s)) n -= 2;
  if (/^sku#?$/.test(s.trim())) n += 3;
  return n;
}
function mapHeaders(first) {
  const cols = first.map(columnFor);
  const best = {};
  cols.forEach((k, j) => {
    if (k && (best[k] === undefined || headerScore(first[j]) > headerScore(first[best[k]]))) best[k] = j;
  });
  return cols.map((k, j) => (k && best[k] === j ? k : null));
}
const DEFAULT_ORDER = ['sku', 'units', 'casePack', 'cartons', 'l', 'w', 'h', 'weight', 'up', 'stackable', 'nest'];

// "This Side Up" column: L, W or H names the side that stands vertical;
// Y means H (the usual "this way up"); N or blank means any side.
function upOf(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (/^(l|len|length)$/.test(s)) return 'l';
  if (/^(w|wid|width)$/.test(s)) return 'w';
  if (/^(h|ht|height|y|yes|true|1|x)$/.test(s)) return 'h';
  return '';
}

function yesNo(v, dflt) {
  const s = String(v ?? '').trim().toLowerCase();
  if (/^(y|yes|true|1|x)$/.test(s)) return true;
  if (/^(n|no|false|0)$/.test(s)) return false;
  return dflt;
}

// Turns table rows into cargo lines. Rows that share a Nest Group become one
// nested carton; Case Pack on those rows is the units of that SKU per carton.
function importRows(rows) {
  const errors = [];
  if (!rows.length) return { items: [], errors };
  let cols = DEFAULT_ORDER;
  let lenUnit = state.unitLen;
  let wtUnit = state.unitWt;
  let start = 0;
  const first = rows[0];
  const mapped = mapHeaders(first);
  if (mapped.filter(Boolean).length >= 3 && !first.slice(1).some((c) => /^\s*[\d.,]+\s*$/.test(c))) {
    cols = mapped;
    start = 1;
    const joined = first.join(' ').toLowerCase();
    if (/\((cm|centimet)/.test(joined)) lenUnit = 'cm';
    else if (/\((in|inch|")/.test(joined)) lenUnit = 'in';
    if (/\((kg|kilo)/.test(joined)) wtUnit = 'kg';
    else if (/\((lb|lbs|pound)/.test(joined)) wtUnit = 'lb';
  }
  const num = (v) => {
    const n = Number(String(v ?? '').replace(/,/g, '').replace(/[^\d.\-]/g, ''));
    return Number.isFinite(n) && String(v ?? '').trim() !== '' ? n : 0;
  };

  const records = [];
  for (let i = start; i < rows.length; i++) {
    const r = {};
    cols.forEach((k, j) => k && r[k] === undefined && (r[k] = rows[i][j] ?? ''));
    if (!Object.values(r).some((v) => String(v).trim())) continue;
    records.push({
      line: i + 1,
      sku: String(r.sku ?? '').trim(),
      nest: String(r.nest ?? '').trim(),
      units: Math.floor(num(r.units)),
      casePack: Math.floor(num(r.casePack)),
      cartons: Math.floor(num(r.cartons)),
      l: num(r.l) * CM_PER[lenUnit],
      w: num(r.w) * CM_PER[lenUnit],
      h: num(r.h) * CM_PER[lenUnit],
      weight: num(r.weight) * KG_PER[wtUnit],
      up: upOf(r.up),
      stackable: yesNo(r.stackable, true),
    });
  }

  const items = [];
  const groups = new Map();
  for (const r of records) {
    if (r.nest) {
      if (!groups.has(r.nest)) {
        groups.set(r.nest, []);
        items.push({ nest: r.nest });
      }
      groups.get(r.nest).push(r);
    } else items.push(r);
  }

  const out = [];
  const warnings = [];
  for (const x of items) {
    if (x.nest) {
      const g = groups.get(x.nest);
      const pick = (k) => g.find((r) => r[k] > 0)?.[k] || 0;
      const fromUnits = g.filter((r) => r.units).map((r) => Math.ceil(r.units / (r.casePack || 1)));
      let cartons = pick('cartons');
      if (!cartons) cartons = Math.max(0, ...fromUnits);
      if (new Set(fromUnits).size > 1)
        warnings.push(`${x.nest}: the SKU units give ${[...new Set(fromUnits)].join(' and ')} cartons. Using ${cartons}; check Units and Case Pack.`);
      if (g.length === 1) warnings.push(`${x.nest}: only one SKU has this Nest Group code. Check the code on the other rows.`);
      const sized = g.filter((r) => r.l && r.w && r.h);
      if (sized.some((r) => r.l !== sized[0].l || r.w !== sized[0].w || r.h !== sized[0].h))
        warnings.push(`${x.nest}: rows have different carton sizes. Using the first row's size.`);
      const it = {
        kind: 'nest', name: x.nest, cartons,
        l: pick('l'), w: pick('w'), h: pick('h'), weight: pick('weight'),
        up: g[0].up, stackable: g[0].stackable,
        contents: g.map((r) => ({ sku: r.sku, pack: r.casePack || 1 })),
      };
      if (!(it.l && it.w && it.h)) {
        errors.push(`${x.nest} (line ${g[0].line})`);
        continue;
      }
      out.push(it);
    } else {
      const it = { kind: 'single', ...x };
      if (!(it.l && it.w && it.h)) {
        errors.push(`line ${x.line}`);
        continue;
      }
      out.push(it);
    }
  }
  return { items: out, errors, warnings };
}

function cargoRows(list = state.items) {
  const rows = [HEADERS()];
  const L = (cm) => (cm ? lenOut(cm) : '');
  const yn = (b) => (b ? 'Y' : 'N');
  list.forEach((it, k) => {
    const common = [L(it.l), L(it.w), L(it.h), it.weight ? wtOut(it.weight) : '', it.up ? it.up.toUpperCase() : 'N', yn(it.stackable)];
    if (it.kind === 'single') {
      rows.push([it.sku, it.units || '', it.casePack || '', isComputed(it) ? cartonsOf(it) : it.cartons || '', ...common, '']);
    } else {
      const group = it.name || `NEST-${k + 1}`;
      const n = cartonsOf(it);
      (it.contents.length ? it.contents : [{ sku: '', pack: '' }]).forEach((c) =>
        rows.push([c.sku, n && c.pack ? n * c.pack : '', c.pack || '', n || '', ...common, group])
      );
    }
  });
  return rows;
}

// Shows how pasted or uploaded rows will be read, before importing.
function renderImportPreview() {
  const box = $('#importPreview');
  const text = $('#importText').value;
  if (!text.trim()) {
    box.hidden = true;
    return;
  }
  const { items, errors, warnings } = importRows(parseTable(text));
  const ctns = items.reduce((a, it) => a + cartonsOf(it), 0);
  const cbm = items.reduce((a, it) => a + itemCbm(it) * cartonsOf(it), 0);
  const nests = items.filter((it) => it.kind === 'nest').length;
  const shown = items.slice(0, 60);
  box.innerHTML = `
    <div class="preview-head"><span class="eyebrow">Preview</span><span>${items.length} line${items.length === 1 ? '' : 's'}${nests ? ` · ${nests} nested` : ''} · ${fmt(ctns)} cartons · ${cbm.toFixed(2)} CBM</span></div>
    ${items.length ? `<div class="table-wrap"><table class="preview-table"><thead><tr><th>Carton</th><th>Inside</th><th class="r">Cartons</th><th class="r">Size (${state.unitLen})</th></tr></thead><tbody>${shown
      .map((it) => {
        const n = cartonsOf(it);
        const inside = it.kind === 'nest'
          ? `<span class="nest-badge">Nested</span> ${esc(contentsText(it))}`
          : it.casePack ? `${it.casePack} unit${it.casePack === 1 ? '' : 's'} / ctn` : '–';
        return `<tr><td>${esc(it.kind === 'nest' ? it.name : it.sku || 'Unnamed SKU')}</td><td>${inside}</td><td class="r${n ? '' : ' short'}">${n ? fmt(n) : 'missing'}</td><td class="r">${lenOut(it.l)} × ${lenOut(it.w)} × ${lenOut(it.h)}</td></tr>`;
      })
      .join('')}</tbody></table></div>${items.length > shown.length ? `<p class="hint">…and ${items.length - shown.length} more</p>` : ''}` : ''}
    ${warnings.length ? `<ul class="preview-warn">${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    ${errors.length ? `<p class="preview-err">Will skip ${esc(errors.slice(0, 6).join(', '))}${errors.length > 6 ? '…' : ''}: no carton size.</p>` : ''}`;
  box.hidden = false;
}

function exampleCsv() {
  return toCsv(cargoRows(defaults().items));
}

// ------------------------------------------------------------------- plan
// Carton size in whole mm, turned so the side the user marked as "up" is the
// packer's height. With no up side the packer may use any orientation.
function packDims(it) {
  const mm = (cm) => Math.ceil(cm * 10 - 1e-6);
  const [l, w, h] = [mm(it.l), mm(it.w), mm(it.h)];
  if (it.up === 'l') return { l: w, w: h, h: l };
  if (it.up === 'w') return { l, w: h, h: w };
  return { l, w, h };
}

function runPlan({ quiet = false } = {}) {
  const s = spec();
  const valid = state.items.filter(validItem);
  const skipped = state.items.filter((it) => !validItem(it) && touched(it)).length;
  if (!valid.length) {
    plan = null;
    stale = false;
    showLoad();
    renderResults();
    if (!quiet) toast('Add at least one line with carton size and number of cartons.');
    highlightInvalid();
    return;
  }
  const items = valid.map((it) => ({
    ...it,
    contents: it.contents.map((c) => ({ ...c })),
    label: labelOf(it),
    qty: cartonsOf(it),
    mm: packDims(it),
  }));
  const packItems = items.map((it) => ({ l: it.mm.l, w: it.mm.w, h: it.mm.h, qty: it.qty, weight: it.weight || 0, upright: !!it.up, stackable: it.stackable }));
  const result = planShipment({ L: s.L, W: s.W, H: s.H, payload: s.payload }, packItems, { keepOrder: state.keepOrder, multi: state.multi });
  plan = { spec: s, items, result, multi: state.multi };
  active = 0;
  filter = null;
  stale = false;
  showLoad();
  renderResults();
  if (skipped && !quiet) toast(`Skipped ${skipped} line${skipped === 1 ? '' : 's'} with a missing size or carton count.`);
  highlightInvalid();
  playSequence(true);
}

function refreshAfterSetupChange() {
  updateTotals();
  viewer.setContainer(spec(), (mm) => metres(mm, true));
  if (plan) runPlan({ quiet: true });
  else {
    showLoad();
    renderResults();
  }
  updateBadge();
}

// ------------------------------------------------------------------ viewer
const viewer = new Viewer($('#scene'), { onHover: showTooltip });

function currentLoad() {
  return plan?.result.loads[active] || null;
}

function showLoad() {
  const load = currentLoad();
  viewer.setLoad(load, plan?.items || []);
  viewer.setFilter(filter);
  $('#vpEmpty').hidden = !!load;
  $('#seqBar').hidden = !load;
  const n = load ? load.boxes.length : 0;
  const r = $('#seqRange');
  r.max = n;
  r.value = n;
  updateSeqOut(n);
  updateBadge();
}

function updateBadge() {
  const s = plan?.spec || spec();
  const units = plan?.result.loads.length || 0;
  $('#vpBadge').innerHTML = `<b>${esc(s.name)}</b><span>${dimsLabel(s.L, s.W, s.H)}</span><span class="num">${fmt(s.rated)} CBM rated</span>${
    units > 1 ? `<span class="chip">Unit ${active + 1} of ${units}</span>` : ''
  }`;
}

function updateSeqOut(n) {
  const load = currentLoad();
  $('#seqOut').textContent = `${fmt(n)} / ${fmt(load ? load.boxes.length : 0)}`;
}

let playRaf = 0;
function playSequence(fromStart) {
  const load = currentLoad();
  if (!load) return;
  cancelAnimationFrame(playRaf);
  const total = load.boxes.length;
  const range = $('#seqRange');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    range.value = total;
    viewer.setVisibleCount(total);
    updateSeqOut(total);
    return;
  }
  const start = fromStart || +range.value >= total ? 0 : +range.value;
  const dur = Math.min(5200, 1400 + total * 6) * ((total - start) / total);
  const t0 = performance.now();
  $('#playBtn').classList.add('playing');
  const step = (now) => {
    const k = Math.min(1, (now - t0) / Math.max(dur, 1));
    const n = Math.round(start + (total - start) * k);
    range.value = n;
    viewer.setVisibleCount(n);
    updateSeqOut(n);
    if (k < 1) playRaf = requestAnimationFrame(step);
    else $('#playBtn').classList.remove('playing');
  };
  playRaf = requestAnimationFrame(step);
}
function stopSequence() {
  cancelAnimationFrame(playRaf);
  $('#playBtn').classList.remove('playing');
}

function orientNote(it, b) {
  const turned = b.l !== it.mm.l;
  if (it.up) return `${it.up.toUpperCase()} side up${turned ? ', turned 90°' : ''}`;
  if (b.h === it.mm.h) return turned ? 'Turned 90°' : 'As entered';
  return 'On its side';
}

function showTooltip(hit) {
  const tt = $('#tooltip');
  if (!hit || !plan) {
    tt.hidden = true;
    return;
  }
  const b = hit.box;
  const it = plan.items[b.item];
  const block = currentLoad().blocks.find((x) => x.id === b.block);
  const inside = it.kind === 'nest' ? contentsText(it) : it.casePack ? `${it.casePack} unit${it.casePack === 1 ? '' : 's'}` : '';
  tt.innerHTML = `
    <div class="tt-head"><span class="dot" style="background:${it.color}"></span>${esc(it.label)}</div>
    ${inside ? `<div class="tt-row"><span>Inside</span><span>${esc(inside)}</span></div>` : ''}
    <div class="tt-row"><span>Carton</span><span>${cartonLabel(it.l, it.w, it.h)}</span></div>
    <div class="tt-row"><span>Placed as</span><span>${orientNote(it, b)}</span></div>
    <div class="tt-row"><span>From front wall</span><span>${metres(b.x)}</span></div>
    <div class="tt-row"><span>Height off floor</span><span>${metres(b.z)}</span></div>
    <div class="tt-row"><span>Load step</span><span>${block ? block.step : '–'} · carton ${fmt(b.seq + 1)}</span></div>`;
  tt.hidden = false;
  const vp = $('#scene').getBoundingClientRect();
  const w = tt.offsetWidth;
  const h = tt.offsetHeight;
  let x = hit.x + 16;
  let y = hit.y + 16;
  if (x + w > vp.width - 8) x = hit.x - w - 16;
  if (y + h > vp.height - 8) y = hit.y - h - 16;
  tt.style.left = `${Math.max(8, x)}px`;
  tt.style.top = `${Math.max(8, y)}px`;
}

// ----------------------------------------------------------------- results
const ICON_OK = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M8 12.5l2.5 2.5L16 9.5"></path></svg>';
const ICON_WARN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l10 18H2z"></path><path d="M12 10v5M12 18v.01"></path></svg>';

function renderResults() {
  const el = $('#results');
  if (!plan) {
    el.innerHTML = `<div class="res-empty"><b>No plan yet</b><span>Pick a container, enter your cartons and press Fill container. The plan shows CBM against the rated capacity, weight, floor length and a step-by-step stacking order.</span></div>`;
    return;
  }
  const { spec: s, items, result } = plan;
  const loads = result.loads;
  const load = loads[active];
  const totalQty = items.reduce((a, it) => a + it.qty, 0);
  const unplacedQty = result.unplaced.reduce((a, q) => a + q, 0);
  const unplacedCbm = result.unplaced.reduce((a, q, i) => a + q * itemCbm(items[i]), 0);

  let html = '';
  if (stale) html += `<div class="stale">Cargo changed. Press Fill container to update the plan.</div>`;

  if (loads.length > 1) {
    html += `<div class="unit-tabs" role="tablist" aria-label="Containers">${loads
      .map((l, i) => `<button type="button" role="tab" class="unit-tab${i === active ? ' on' : ''}" aria-selected="${i === active}" data-unit="${i}" id="unit-${i}"><b>Unit ${i + 1}</b><span class="num">${(l.loadedVolume / 1e9).toFixed(1)} CBM · ${fmt(l.boxes.length)} ctns</span></button>`)
      .join('')}</div>`;
  }

  if (!load) {
    html += `<div class="res-section">${verdict()}</div>`;
    el.innerHTML = html;
    return;
  }

  const cbm = load.loadedVolume / 1e9;
  const pct = cbm / s.rated;
  const inside = insideCbm(s);
  const kg = load.boxes.reduce((a, b) => a + (items[b.item].weight || 0), 0);
  const stackTop = load.boxes.reduce((m, b) => Math.max(m, b.z + b.h), 0);
  const status = unplacedQty || result.neverFits.some(Boolean)
    ? ['bad', 'Overflow']
    : loads.length > 1
      ? ['warn', `${loads.length} units`]
      : ['good', 'Fits'];

  // Capacity bar runs to the inside volume, with a tick at the rated CBM.
  const ratedPct = Math.min(100, (s.rated / inside) * 100);
  const fillPct = Math.min(100, (cbm / inside) * 100);
  const stat = (label, value, sub, used, total, limit = false) => {
    const r = total > 0 ? used / total : 0;
    const cls = !limit ? '' : r > 0.98 ? 'bad' : r > 0.9 ? 'warn' : '';
    return `<div class="stat"><span class="eyebrow">${label}</span><b>${value}</b><small>${sub}</small>${
      total ? `<div class="bar"><i class="${cls}" style="width:${Math.min(100, r * 100)}%"></i></div>` : ''
    }</div>`;
  };

  html += `<div class="res-section">
    <h3><span>Load summary${loads.length > 1 ? ` · unit ${active + 1}` : ''}</span><span class="status ${status[0]}">${status[1]}</span></h3>
    <div class="kpi">
      <div class="kpi-main"><b>${fmt(pct * 100, 1)}%</b><span>of ${fmt(s.rated)} CBM rated capacity</span></div>
      <div class="kpi-side"><b class="num">${cbm.toFixed(2)}</b><span>CBM loaded · ${fmt(cbm * CBM_TO_CFT)} cu ft</span></div>
    </div>
    <div class="capbar" role="img" aria-label="${cbm.toFixed(1)} CBM loaded of ${fmt(inside, 1)} CBM inside volume; rated ${fmt(s.rated)} CBM">
      <div class="capbar-track"><div class="capbar-fill${cbm > s.rated ? ' over' : ''}" style="width:0;--rated-pct:${(s.rated / cbm) * 100}%" data-w="${fillPct}%"></div><span class="capbar-tick" style="left:${ratedPct}%"></span></div>
      <div class="capbar-legend"><span class="l-zero">0</span><span class="l-rated" style="left:${ratedPct}%">Rated ${fmt(s.rated)}</span><span class="l-inside">Inside ${fmt(inside, 1)}</span></div>
    </div>
    <div class="stats">
      ${stat('Cartons', fmt(load.boxes.length), `of ${fmt(totalQty)} planned`, 0, 0)}
      ${stat('Weight', kg ? wtFmt(kg) : '–', kg ? `of ${wtFmt(s.payload)} payload` : 'No weights entered', kg, kg ? s.payload : 0, true)}
      ${stat('Floor used', metres(load.usedLength), `of ${metres(s.L)}`, load.usedLength, s.L)}
      ${stat('Highest stack', metres(stackTop), `of ${metres(s.H)}`, stackTop, s.H)}
    </div>
    ${verdict()}
  </div>`;

  const rows = items.map((it, i) => {
    const n = load.loaded[i];
    const short = result.unplaced[i];
    const sel = filter && filter.item === i;
    const u = unitsIn(it, n);
    return `<tr class="pick${sel ? ' sel' : ''}" data-item="${i}" tabindex="0" aria-label="Highlight ${esc(it.label)} in 3D">
      <td><div class="name"><span class="dot" style="background:${it.color}"></span><span>${esc(it.label)}</span></div>${
        u.length && n ? `<div class="units-line">${it.kind === 'nest' ? unitsText(u) : fmt(u[0].units)} units</div>` : ''
      }</td>
      <td class="r">${fmt(n)}</td>
      <td class="r">${fmt(it.qty)}</td>
      <td class="r">${(n * itemCbm(it)).toFixed(2)}</td>
      ${unplacedQty ? `<td class="r ${short ? 'short' : ''}">${short ? fmt(short) : '–'}</td>` : ''}
    </tr>`;
  });
  html += `<div class="res-section"><h3>By carton${loads.length > 1 ? ` · unit ${active + 1}` : ''}</h3>
    <div class="table-wrap"><table class="sku-table"><thead><tr><th>SKU / carton</th><th class="r">Loaded</th><th class="r">Of</th><th class="r">CBM</th>${unplacedQty ? '<th class="r">Left out</th>' : ''}</tr></thead>
    <tbody>${rows.join('')}</tbody></table></div></div>`;

  const steps = load.blocks
    .slice()
    .sort((a, b) => a.step - b.step)
    .map((bl) => {
      const it = items[bl.item];
      const sel = filter && filter.block === bl.id;
      const [l, , h] = bl.dims;
      const pos = bl.z0 === 0 ? 'on the floor' : `on top, from ${metres(bl.z0)} up`;
      const turn = it.up
        ? `, ${it.up.toUpperCase()} side up${l === it.mm.l ? '' : ', turned 90°'}`
        : h === it.mm.h ? (l === it.mm.l ? '' : ', turned 90°') : ', on its side';
      return `<li><button type="button" class="step${sel ? ' sel' : ''}" data-block="${bl.id}" id="step-${bl.id}">
        <span class="step-n" style="background:${it.color}">${bl.step}</span>
        <span class="step-body">
          <span class="step-title"><span>${esc(it.label)}</span><span>${fmt(bl.n)} ctns</span></span>
          <span class="step-desc">${bl.ny} across × ${bl.nz} high × ${bl.nx} deep${turn}, ${pos}</span>
          <span class="step-desc num">${metres(bl.x0)} → ${metres(bl.x1)} from front</span>
        </span></button></li>`;
    });
  html += `<div class="res-section"><h3>Stacking plan <span class="chip">${load.blocks.length} steps</span></h3>
    <p class="sub" style="margin:-4px 0 10px">Load from the front wall towards the doors. Select a step to see it in 3D.</p>
    <ol class="steps">${steps.join('')}</ol></div>`;

  html += `<div class="res-section"><div class="res-actions">
    <button type="button" class="ghost-btn" id="copyBtn"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"></rect><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"></path></svg>Copy summary</button>
    <button type="button" class="ghost-btn" id="pdfBtn2"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6z"></path><path d="M14 3v4h4M12 11v6M9.5 14.5L12 17l2.5-2.5"></path></svg><span>Download PDF</span></button>
    <button type="button" class="ghost-btn" id="csvBtn"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"></path></svg>Stacking plan CSV</button>
  </div></div>`;

  el.innerHTML = html;
  requestAnimationFrame(() => {
    const bar = el.querySelector('.capbar-fill');
    if (bar) bar.style.width = bar.dataset.w;
  });

  function verdict() {
    const never = items.filter((_, i) => result.neverFits[i]);
    if (never.length) {
      return `<div class="verdict bad">${ICON_WARN}<span><b>${never.map((it) => esc(it.label)).join(', ')}</b> can't fit in a ${esc(s.name)} in any allowed position (too large or too heavy).</span></div>`;
    }
    if (unplacedQty) {
      const weightBound = load && kg > 0 && items.some((it, i) => result.unplaced[i] && it.weight && kg + it.weight > s.payload);
      const why = weightBound ? ' The payload limit is reached.' : '';
      const more = !plan.multi ? ` <button type="button" class="link" id="addUnitBtn">Plan them in more containers</button>` : '';
      return `<div class="verdict bad">${ICON_WARN}<span><b>${fmt(unplacedQty)} cartons (${unplacedCbm.toFixed(2)} CBM) don't fit.</b>${why}${more}</span></div>`;
    }
    if (loads.length > 1) {
      return `<div class="verdict warn">${ICON_OK}<span><b>Needs ${loads.length} × ${esc(s.name)}.</b> All ${fmt(totalQty)} cartons are planned.</span></div>`;
    }
    const freeFloor = s.L - load.usedLength;
    const floorNote = freeFloor > 50 ? ` ${metres(freeFloor)} of clear floor is left at the doors.` : '';
    if (cbm > s.rated) {
      return `<div class="verdict good">${ICON_OK}<span><b>All ${fmt(totalQty)} cartons fit,</b> ${(cbm - s.rated).toFixed(1)} CBM above the ${fmt(s.rated)} CBM rating. Load by this plan; there's little slack for loose stacking.${floorNote}</span></div>`;
    }
    return `<div class="verdict good">${ICON_OK}<span><b>All ${fmt(totalQty)} cartons fit.</b> ${(s.rated - cbm).toFixed(1)} CBM left before the ${fmt(s.rated)} CBM rating.${floorNote}</span></div>`;
  }
}

function summaryText() {
  const { spec: s, items, result } = plan;
  const lines = [`Load plan: ${result.loads.length > 1 ? `${result.loads.length} × ` : ''}${s.name} (${dimsLabel(s.L, s.W, s.H)} inside, rated ${fmt(s.rated)} CBM)`];
  result.loads.forEach((l, i) => {
    const kg = l.boxes.reduce((a, b) => a + (items[b.item].weight || 0), 0);
    const cbm = l.loadedVolume / 1e9;
    lines.push(
      `${result.loads.length > 1 ? `Unit ${i + 1}: ` : ''}${fmt(l.boxes.length)} cartons, ${cbm.toFixed(2)} CBM (${fmt((cbm / s.rated) * 100, 1)}% of rated)${kg ? `, ${wtFmt(kg)}` : ''}, floor used ${metres(l.usedLength)}`
    );
    items.forEach((it, k) => {
      if (!l.loaded[k]) return;
      const u = unitsIn(it, l.loaded[k]);
      lines.push(`  ${it.label}: ${fmt(l.loaded[k])} ctns${u.length ? ` (${u.map((x) => `${x.sku} ${fmt(x.units)}`).join(', ')} units)` : ''}`);
    });
  });
  const left = result.unplaced.reduce((a, q) => a + q, 0);
  if (left) {
    lines.push(`Not loaded: ${fmt(left)} cartons`);
    items.forEach((it, k) => {
      if (result.unplaced[k]) lines.push(`  ${it.label}: ${fmt(result.unplaced[k])} ctns`);
    });
  }
  return lines.join('\n');
}

function planCsv() {
  const { items, result } = plan;
  const u = state.unitLen;
  const rows = [['Unit', 'Step', 'SKU / carton', 'Contents', 'Cartons', 'Across', 'High', 'Deep', `Placed L (${u})`, `Placed W (${u})`, `Placed H (${u})`, 'From front (m)', 'To (m)', 'Bottom height (m)']];
  result.loads.forEach((l, k) => {
    l.blocks
      .slice()
      .sort((a, b) => a.step - b.step)
      .forEach((b) => {
        const it = items[b.item];
        rows.push([k + 1, b.step, it.label, it.kind === 'nest' ? contentsText(it) : '', b.n, b.ny, b.nz, b.nx, lenOut(b.dims[0] / 10), lenOut(b.dims[1] / 10), lenOut(b.dims[2] / 10), (b.x0 / 1000).toFixed(3), (b.x1 / 1000).toFixed(3), (b.z0 / 1000).toFixed(3)]);
      });
  });
  if (result.unplaced.some((x) => x)) {
    rows.push([]);
    rows.push(['Not loaded']);
    items.forEach((it, k) => result.unplaced[k] && rows.push(['', '', it.label, '', result.unplaced[k]]));
  }
  return toCsv(rows);
}

// -------------------------------------------------------------------- PDF
function verdictPlain() {
  const { spec: s, items, result } = plan;
  const loads = result.loads;
  const totalQty = items.reduce((a, it) => a + it.qty, 0);
  const unplacedQty = result.unplaced.reduce((a, q) => a + q, 0);
  const unplacedCbm = result.unplaced.reduce((a, q, i) => a + q * itemCbm(items[i]), 0);
  const never = items.filter((_, i) => result.neverFits[i]);
  if (never.length) return { tone: 'bad', text: `${never.map((it) => it.label).join(', ')} can't fit in a ${s.name} in any allowed position (too large or too heavy).` };
  if (unplacedQty) return { tone: 'bad', text: `${fmt(unplacedQty)} cartons (${unplacedCbm.toFixed(2)} CBM) don't fit. They are listed under Not loaded at the end.` };
  if (loads.length > 1) return { tone: 'warn', text: `Needs ${loads.length} × ${s.name}. All ${fmt(totalQty)} cartons are planned.` };
  const cbm = loads[0].loadedVolume / 1e9;
  const freeFloor = s.L - loads[0].usedLength;
  const floor = freeFloor > 50 ? ` ${metres(freeFloor)} of clear floor is left at the doors.` : '';
  if (cbm > s.rated) return { tone: 'good', text: `All ${fmt(totalQty)} cartons fit, ${(cbm - s.rated).toFixed(1)} CBM above the ${fmt(s.rated)} CBM rating. Load by this plan; there's little slack for loose stacking.${floor}` };
  return { tone: 'good', text: `All ${fmt(totalQty)} cartons fit. ${(s.rated - cbm).toFixed(1)} CBM left before the ${fmt(s.rated)} CBM rating.${floor}` };
}

// Image sizes match the PDF slots: a wide 3D view, long top and side views,
// and a near-square door view.
// Top, side and door use a narrow lens so they read like flat drawings; top
// and side also drop the walls and doors so nothing covers the cargo.
const SHOTS = [
  { view: 'iso', width: 1800, height: 874 },
  { view: 'top', width: 2000, height: 400, fov: 10, walls: false },
  { view: 'side', width: 2000, height: 400, fov: 10, walls: false, labels: false },
  { view: 'door', width: 920, height: 800, fov: 14 },
];

function buildReport() {
  const { spec: s, items, result } = plan;
  const loads = result.loads;
  const inside = insideCbm(s);
  const totalQty = items.reduce((a, it) => a + it.qty, 0);
  const u = state.unitLen;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const upText = (it) => (it.up ? `${it.up.toUpperCase()} up` : 'Any');

  const units = loads.map((load, i) => {
    viewer.setLoad(load, items);
    const images = viewer.captureViews(SHOTS);
    images.isoAspect = 1800 / 874;
    images.longAspect = 2000 / 400;
    images.doorAspect = 920 / 800;

    const cbm = load.loadedVolume / 1e9;
    const kg = load.boxes.reduce((a, b) => a + (items[b.item].weight || 0), 0);
    const stackTop = load.boxes.reduce((m, b) => Math.max(m, b.z + b.h), 0);
    const label = loads.length > 1 ? `${s.name} · Unit ${i + 1} of ${loads.length}` : s.name;
    const inUnit = items.map((it, k) => ({ it, k, n: load.loaded[k] })).filter((x) => x.n > 0);

    return {
      heading: label,
      label,
      images,
      verdict: verdictPlain(),
      kpis: [
        { label: 'Rated capacity used', value: `${fmt((cbm / s.rated) * 100, 1)}%`, sub: `of ${fmt(s.rated)} CBM rated` },
        { label: 'CBM loaded', value: cbm.toFixed(2), sub: `${fmt((cbm / inside) * 100)}% of ${fmt(inside, 1)} CBM inside` },
        { label: 'Cartons', value: fmt(load.boxes.length), sub: `of ${fmt(totalQty)} planned` },
        { label: 'Weight', value: kg ? wtFmt(kg) : '-', sub: kg ? `of ${wtFmt(s.payload)} payload` : 'No weights entered' },
        { label: 'Floor used', value: metres(load.usedLength), sub: `of ${metres(s.L)}` },
        { label: 'Highest stack', value: metres(stackTop), sub: `of ${metres(s.H)}` },
      ],
      legend: inUnit.map(({ it, n }) => ({
        color: it.color,
        label: it.label.length > 26 ? `${it.label.slice(0, 25)}...` : it.label,
        detail: `${fmt(n)} ctns · ${upText(it)}`,
      })),
      cargo: {
        title: 'Cargo in this unit',
        head: ['SKU / carton', 'Inside carton', 'Up side', `Carton L × W × H (${u})`, 'Loaded', 'Of', 'CBM', 'Units loaded'],
        right: [4, 5, 6],
        colors: inUnit.map(({ it }) => it.color),
        rows: inUnit.map(({ it, n }) => {
          const units = unitsIn(it, n);
          return [
            it.label,
            it.kind === 'nest' ? contentsText(it) : it.casePack ? `${it.casePack} per ctn` : '-',
            upText(it),
            `${lenOut(it.l)} × ${lenOut(it.w)} × ${lenOut(it.h)}`,
            fmt(n),
            fmt(it.qty),
            (n * itemCbm(it)).toFixed(2),
            units.length ? (it.kind === 'nest' ? units.map((x) => `${x.sku} ${fmt(x.units)}`).join(', ') : fmt(units[0].units)) : '-',
          ];
        }),
      },
      steps: {
        title: 'Stacking plan (load from the front wall towards the doors)',
        compact: true,
        head: ['Step', 'SKU / carton', 'Cartons', 'Across × high × deep', 'Placed', 'From front', 'To', 'Bottom at'],
        right: [2, 5, 6, 7],
        colors: null,
        rows: load.blocks
          .slice()
          .sort((a, b) => a.step - b.step)
          .map((bl) => {
            const it = items[bl.item];
            return [
              String(bl.step),
              it.label,
              fmt(bl.n),
              `${bl.ny} × ${bl.nz} × ${bl.nx}`,
              orientNote(it, { l: bl.dims[0], h: bl.dims[2] }),
              metres(bl.x0),
              metres(bl.x1),
              bl.z0 === 0 ? 'Floor' : metres(bl.z0),
            ];
          }),
      },
    };
  });
  showLoad();

  const left = items.map((it, k) => ({ it, q: result.unplaced[k] })).filter((x) => x.q > 0);
  const refSlug = state.ref ? `-${state.ref.replace(/[^\w-]+/g, '_').slice(0, 30)}` : '';
  return {
    filename: `load-plan-${s.id}${refSlug}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.pdf`,
    date: now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
    reference: state.ref || '',
    subtitle: `${s.name} (${s.iso}) · inside ${dimsLabel(s.L, s.W, s.H)} · ${fmt(inside, 1)} CBM inside · rated ${fmt(s.rated)} CBM · payload ${wtFmt(s.payload)}`,
    footer: `Load Planner · ${s.name}${state.ref ? ` · ${state.ref}` : ''}`,
    units,
    notLoaded: left.length
      ? {
          title: 'Not loaded',
          head: ['SKU / carton', 'Cartons not loaded', 'CBM'],
          right: [1, 2],
          colors: left.map(({ it }) => it.color),
          rows: left.map(({ it, q }) => [it.label, fmt(q), (q * itemCbm(it)).toFixed(2)]),
        }
      : null,
  };
}

let pdfBusy = false;
async function exportPdf() {
  if (pdfBusy) return;
  if (!plan || !plan.result.loads.length) return toast('Fill the container first, then download the PDF.');
  pdfBusy = true;
  const buttons = [$('#pdfBtn'), $('#pdfBtn2')].filter(Boolean);
  buttons.forEach((b) => {
    b.disabled = true;
    const span = b.querySelector('span');
    if (span) {
      b.dataset.label = span.textContent;
      span.textContent = 'Preparing…';
    }
  });
  stopSequence();
  try {
    // Let the button state paint before the heavy rendering starts.
    await new Promise((r) => setTimeout(r, 30));
    await buildPdf(buildReport());
    toast('PDF downloaded');
  } catch (err) {
    console.error(err);
    toast("Couldn't create the PDF. Check your internet connection; the PDF tool loads from the web.", 5000);
  } finally {
    pdfBusy = false;
    [$('#pdfBtn'), $('#pdfBtn2')].filter(Boolean).forEach((b) => {
      b.disabled = false;
      const span = b.querySelector('span');
      if (span && b.dataset.label) span.textContent = b.dataset.label;
    });
  }
}

// ----------------------------------------------------------------- events
function syncToggles() {
  document.querySelectorAll('[data-unit-len]').forEach((b) => b.classList.toggle('on', b.dataset.unitLen === state.unitLen));
  document.querySelectorAll('[data-unit-wt]').forEach((b) => b.classList.toggle('on', b.dataset.unitWt === state.unitWt));
  $('#optOrder').checked = state.keepOrder;
  $('#optRef').value = state.ref || '';
  $('#optMulti').checked = state.multi;
}

function setView(v) {
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  viewer.setView(v);
}

function toggleFilter(f) {
  const same = filter && ((f.item != null && filter.item === f.item) || (f.block != null && filter.block === f.block));
  filter = same ? null : f;
  viewer.setFilter(filter);
  renderResults();
}

function showUndo(prev) {
  const t = toast('Cargo cleared. ', 6000);
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'text-btn toast-btn';
  b.textContent = 'Undo';
  b.addEventListener('click', () => {
    state.items = prev;
    save();
    renderCargo();
    t.remove();
  });
  t.append(b);
}

function openImport() {
  $('#importUnits').textContent = `Sizes in ${state.unitLen === 'in' ? 'inches' : 'centimetres'} and weight in ${state.unitWt}, unless the header row names a unit, e.g. "Length (cm)".`;
  $('#importErr').hidden = true;
  $('#importFileName').textContent = '';
  renderImportPreview();
  $('#importReplace').checked = state.isSample || !state.items.length;
  $('#importDialog').showModal();
}

function readImportFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    $('#importText').value = String(reader.result).replace(/^﻿/, '');
    const n = parseTable($('#importText').value).length;
    $('#importFileName').textContent = `${file.name} · ${n} row${n === 1 ? '' : 's'}`;
    renderImportPreview();
    $('#importOk').focus();
  };
  reader.onerror = () => {
    $('#importErr').textContent = `Couldn't read ${file.name}. Save it as CSV (comma separated) and try again.`;
    $('#importErr').hidden = false;
  };
  reader.readAsText(file);
}

function bind() {
  $('#themeBtn').addEventListener('click', toggleTheme);

  const unitChange = () => {
    save();
    syncToggles();
    renderEquipment();
    renderCargo();
    viewer.setContainer(spec(), (mm) => metres(mm, true));
    showLoad();
    renderResults();
  };
  document.querySelectorAll('[data-unit-len]').forEach((b) =>
    b.addEventListener('click', () => {
      state.unitLen = b.dataset.unitLen;
      unitChange();
    })
  );
  document.querySelectorAll('[data-unit-wt]').forEach((b) =>
    b.addEventListener('click', () => {
      state.unitWt = b.dataset.unitWt;
      unitChange();
    })
  );

  $('#equipGrid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-equip]');
    if (!b || b.dataset.equip === state.equipment) return;
    state.equipment = b.dataset.equip;
    save();
    renderEquipment();
    refreshAfterSetupChange();
    setView(currentView);
  });
  const cap = $('#capDialog');
  $('#capBtn').addEventListener('click', () => {
    renderCapTable();
    cap.showModal();
  });
  $('#capClose').addEventListener('click', () => cap.close());
  $('#capTable').addEventListener('change', onCapChange);
  $('#capReset').addEventListener('click', () => {
    state.overrides = {};
    save();
    renderEquipment();
    renderCapTable();
    refreshAfterSetupChange();
    toast('All equipment reset to standard sizes and CBM');
  });

  const list = $('#cargoList');
  list.addEventListener('input', onCargoInput);
  list.addEventListener('click', onCargoClick);
  list.addEventListener('change', (e) => {
    const inp = e.target.closest('[data-k]');
    if (!inp || !['l', 'w', 'h', 'weight'].includes(inp.dataset.k)) return;
    const it = state.items.find((x) => x.id === inp.closest('.sku').dataset.id);
    if (it && it[inp.dataset.k] > 0) inp.value = inp.dataset.k === 'weight' ? wtOut(it.weight) : lenOut(it[inp.dataset.k]);
  });

  $('#addRow').addEventListener('click', () => {
    const it = addItem({ kind: 'single' });
    state.isSample = false;
    save();
    renderCargo();
    document.getElementById(`f-${it.id}-sku`)?.focus();
  });
  $('#addNest').addEventListener('click', () => {
    const it = addItem({ kind: 'nest', contents: [{ sku: '', pack: 1 }, { sku: '', pack: 1 }] });
    state.isSample = false;
    save();
    renderCargo();
    document.getElementById(`f-${it.id}-name`)?.focus();
  });
  $('#clearBtn').addEventListener('click', () => {
    if (!state.items.length) return;
    const prev = state.items;
    state.items = [];
    state.isSample = false;
    save();
    renderCargo();
    markStale();
    showUndo(prev);
  });
  $('#importBtn').addEventListener('click', openImport);
  $('#exportBtn').addEventListener('click', () => {
    if (!state.items.length) return toast('There is no cargo to export yet.');
    download('cargo.csv', new Blob(['﻿' + toCsv(cargoRows())], { type: 'text/csv' }));
  });
  const template = () => download('cargo-template.csv', new Blob(['﻿' + toCsv([HEADERS()])], { type: 'text/csv' }));
  $('#templateBtn').addEventListener('click', template);
  $('#importTemplate').addEventListener('click', template);

  $('#optRef').addEventListener('input', (e) => {
    state.ref = e.target.value.trim();
    save();
  });
  $('#optOrder').addEventListener('change', (e) => {
    state.keepOrder = e.target.checked;
    save();
    if (plan) runPlan({ quiet: true });
  });
  $('#optMulti').addEventListener('change', (e) => {
    state.multi = e.target.checked;
    save();
    if (plan) runPlan({ quiet: true });
  });

  $('#fillBtn').addEventListener('click', () => runPlan());
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !$('#importDialog').open) {
      e.preventDefault();
      runPlan();
    }
  });

  // Viewer toolbar
  document.querySelectorAll('[data-view]').forEach((b) =>
    b.addEventListener('click', () => {
      currentView = b.dataset.view;
      setView(currentView);
    })
  );
  $('#wallsBtn').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const on = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', on);
    viewer.setWallsVisible(on);
  });
  $('#pdfBtn').addEventListener('click', exportPdf);
  $('#seqRange').addEventListener('input', (e) => {
    stopSequence();
    viewer.setVisibleCount(+e.target.value);
    updateSeqOut(+e.target.value);
  });
  $('#playBtn').addEventListener('click', () => {
    if ($('#playBtn').classList.contains('playing')) stopSequence();
    else playSequence(false);
  });

  // Results interactions
  const res = $('#results');
  res.addEventListener('click', (e) => {
    const unit = e.target.closest('[data-unit]');
    if (unit) {
      active = +unit.dataset.unit;
      filter = null;
      showLoad();
      renderResults();
      playSequence(true);
      return;
    }
    const row = e.target.closest('[data-item]');
    if (row) return toggleFilter({ item: +row.dataset.item });
    const step = e.target.closest('[data-block]');
    if (step) return toggleFilter({ block: +step.dataset.block });
    if (e.target.id === 'addUnitBtn') {
      state.multi = true;
      save();
      syncToggles();
      runPlan({ quiet: true });
      return;
    }
    if (e.target.closest('#copyBtn')) {
      const text = summaryText();
      navigator.clipboard?.writeText(text).then(
        () => toast('Summary copied'),
        () => toast("Couldn't copy. Your browser blocked clipboard access.")
      );
      return;
    }
    if (e.target.closest('#pdfBtn2')) return exportPdf();
    if (e.target.closest('#csvBtn')) {
      download(`stacking-plan-${plan.spec.id}.csv`, new Blob(['﻿' + planCsv()], { type: 'text/csv' }));
    }
  });
  res.addEventListener('keydown', (e) => {
    const row = e.target.closest('[data-item]');
    if (row && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      toggleFilter({ item: +row.dataset.item });
    }
  });

  // Import dialog
  const dlg = $('#importDialog');
  $('#importCancel').addEventListener('click', () => dlg.close());
  $('#importClose').addEventListener('click', () => dlg.close());
  let previewTimer;
  $('#importText').addEventListener('input', () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderImportPreview, 200);
  });
  $('#importExample').addEventListener('click', () =>
    download('cargo-example.csv', new Blob(['﻿' + exampleCsv()], { type: 'text/csv' }))
  );
  $('#importFile').addEventListener('change', (e) => readImportFile(e.target.files[0]));
  const drop = $('#importDrop');
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    readImportFile(e.dataTransfer.files[0]);
  });
  $('#importForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const { items, errors } = importRows(parseTable($('#importText').value));
    if (!items.length) {
      $('#importErr').textContent = errors.length
        ? `No usable rows. Each needs a carton length, width and height (check ${errors.slice(0, 4).join(', ')}).`
        : 'No rows found. Choose a CSV file or paste rows from Excel.';
      $('#importErr').hidden = false;
      return;
    }
    if ($('#importReplace').checked) state.items = [];
    items.forEach((x) => addItem(x));
    state.isSample = false;
    save();
    renderCargo();
    dlg.close();
    $('#importText').value = '';
    $('#importFile').value = '';
    const nests = items.filter((x) => x.kind === 'nest').length;
    const noQty = state.items.filter((x) => x.l && !cartonsOf(x)).length;
    toast(
      `Imported ${items.length} line${items.length === 1 ? '' : 's'}${nests ? ` (${nests} nested)` : ''}${errors.length ? `. Skipped ${errors.slice(0, 3).join(', ')}${errors.length > 3 ? '…' : ''}` : ''}${noQty ? `. ${noQty} need units or cartons` : ''}`,
      5000
    );
    runPlan({ quiet: true });
  });
}

// ------------------------------------------------------------------- boot
applyStoredTheme();
syncToggles();
renderEquipment();
renderCargo();
bind();
viewer.setContainer(spec(), (mm) => metres(mm, true));
document.fonts?.ready.then(() => viewer.setContainer(spec(), (mm) => metres(mm, true)));
setView('iso');
viewer.setView('iso', false);
if (state.items.some(validItem)) runPlan({ quiet: true });
else {
  showLoad();
  renderResults();
}
