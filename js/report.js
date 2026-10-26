// Builds the load plan PDF. jsPDF and its table plugin are loaded from the
// CDN the first time someone exports, so they don't slow down the page.

const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const AUTOTABLE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if ([...document.scripts].some((s) => s.src === src)) return resolve();
    const el = document.createElement('script');
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error(`Couldn't load ${src}`));
    document.head.append(el);
  });
}

async function loadJsPdf() {
  if (!window.jspdf) await loadScript(JSPDF_URL);
  if (!window.jspdf.jsPDF.API.autoTable) await loadScript(AUTOTABLE_URL);
  return window.jspdf.jsPDF;
}

// Letter landscape, in points.
const PAGE_W = 792;
const PAGE_H = 612;
const M = 36;
const CONTENT_W = PAGE_W - 2 * M;

const INK = [11, 14, 20];
const INK_2 = [53, 59, 72];
const MUTED = [106, 114, 128];
const LINE = [228, 231, 236];
const SOFT = [247, 248, 250];
const ACCENT = [53, 80, 230];
const TONES = {
  good: { fg: [15, 122, 85], bg: [230, 244, 238] },
  warn: { fg: [166, 88, 10], bg: [252, 242, 228] },
  bad: { fg: [192, 51, 29], bg: [252, 235, 232] },
};

// The built-in PDF font only covers Latin-1, so swap the few symbols the app
// uses for plain equivalents.
const clean = (s) =>
  String(s ?? '')
    .replace(/′/g, "'")
    .replace(/″/g, '"')
    .replace(/→/g, 'to')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '');

const rgb = (hex) => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};

function pageHeader(doc, report, unit) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...ACCENT);
  doc.text('CONTAINER LOAD PLAN', M, 40);
  doc.setFontSize(20);
  doc.setTextColor(...INK);
  doc.text(clean(unit.heading), M, 64);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(clean(report.subtitle), M, 80);
  doc.text(clean(report.date), PAGE_W - M, 40, { align: 'right' });
  if (report.reference) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...INK);
    doc.text(clean(`Ref: ${report.reference}`), PAGE_W - M, 56, { align: 'right' });
  }
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.8);
  doc.line(M, 90, PAGE_W - M, 90);
}

function compactHeader(doc, report, label) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text(clean(label), M, 36);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...MUTED);
  doc.text(clean([report.reference && `Ref: ${report.reference}`, report.date].filter(Boolean).join('  ·  ')), PAGE_W - M, 36, { align: 'right' });
  doc.setDrawColor(...LINE);
  doc.line(M, 46, PAGE_W - M, 46);
}

function kpiRow(doc, kpis, y) {
  const gap = 8;
  const w = (CONTENT_W - gap * (kpis.length - 1)) / kpis.length;
  kpis.forEach((k, i) => {
    const x = M + i * (w + gap);
    doc.setFillColor(...SOFT);
    doc.setDrawColor(...LINE);
    doc.roundedRect(x, y, w, 56, 4, 4, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(clean(k.label.toUpperCase()), x + 9, y + 14);
    doc.setFontSize(15);
    doc.setTextColor(...(i === 0 ? ACCENT : INK));
    doc.text(clean(k.value), x + 9, y + 34);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(doc.splitTextToSize(clean(k.sub), w - 16)[0] || '', x + 9, y + 47);
  });
  return y + 56;
}

function verdictBox(doc, verdict, y) {
  const tone = TONES[verdict.tone] || TONES.good;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  const lines = doc.splitTextToSize(clean(verdict.text), CONTENT_W - 24);
  const h = 12 + lines.length * 12;
  doc.setFillColor(...tone.bg);
  doc.roundedRect(M, y, CONTENT_W, h, 4, 4, 'F');
  doc.setTextColor(...tone.fg);
  doc.text(lines, M + 12, y + 16);
  return y + h;
}

function viewImage(doc, label, img, x, y, w, h) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text(label.toUpperCase(), x, y - 5);
  doc.addImage(img, 'JPEG', x, y, w, h, undefined, 'FAST');
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.8);
  doc.rect(x, y, w, h);
}

function legend(doc, rows, x, y, maxY) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text('COLOUR KEY', x, y - 5);
  doc.setFontSize(8.5);
  let yy = y + 8;
  for (const r of rows) {
    if (yy > maxY) {
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...MUTED);
      doc.text('See cargo table for the rest.', x, yy);
      break;
    }
    doc.setFillColor(...rgb(r.color));
    doc.roundedRect(x, yy - 7, 8, 8, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...INK);
    doc.text(clean(r.label), x + 14, yy);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...MUTED);
    doc.text(clean(r.detail), x + 150, yy);
    yy += 14;
  }
}

function table(doc, report, label, data, startY) {
  if (startY > PAGE_H - 140) {
    doc.addPage();
    compactHeader(doc, report, label);
    startY = 70;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text(clean(data.title), M, startY);
  const pad = data.compact ? 3.5 : 5;
  doc.autoTable({
    head: [data.head.map(clean)],
    body: data.rows.map((r) => r.map(clean)),
    startY: startY + 8,
    margin: { left: M, right: M, top: 60, bottom: 40 },
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: data.compact ? 8 : 8.5, textColor: INK_2, cellPadding: { top: pad, bottom: pad, left: 5, right: 5 }, lineColor: LINE, lineWidth: { bottom: 0.6 } },
    headStyles: { fillColor: INK, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5, lineWidth: 0 },
    alternateRowStyles: { fillColor: SOFT },
    columnStyles: Object.assign(
      { 0: { cellPadding: { top: pad, bottom: pad, left: data.colors ? 18 : 5, right: 5 }, fontStyle: 'bold', textColor: INK } },
      ...(data.right || []).map((i) => ({ [i]: { halign: 'right' } }))
    ),
    didParseCell: (d) => {
      if (d.section === 'head' && (data.right || []).includes(d.column.index)) d.cell.styles.halign = 'right';
    },
    didDrawCell: (d) => {
      if (!data.colors || d.section !== 'body' || d.column.index !== 0) return;
      const c = data.colors[d.row.index];
      if (!c) return;
      doc.setFillColor(...rgb(c));
      doc.roundedRect(d.cell.x + 6, d.cell.y + d.cell.height / 2 - 4, 8, 8, 1.5, 1.5, 'F');
    },
    didDrawPage: (d) => {
      // Continuation pages of a long table get the small header too.
      if (d.pageNumber > 1) compactHeader(doc, report, label);
    },
  });
  return doc.lastAutoTable.finalY;
}

// report: { filename, date, reference, subtitle, units: [...], notLoaded }
// unit:   { heading, label, kpis, verdict, images: { iso, top, side, door },
//           legend, cargo, steps }
export async function buildPdf(report) {
  const JsPDF = await loadJsPdf();
  const doc = new JsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter', compress: true });

  report.units.forEach((u, i) => {
    if (i) doc.addPage();

    // Page 1: summary and 3D view.
    pageHeader(doc, report, u);
    let y = kpiRow(doc, u.kpis, 102);
    y = verdictBox(doc, u.verdict, y + 10);
    const isoTop = y + 24;
    const isoH = Math.min(PAGE_H - 46 - isoTop, CONTENT_W / u.images.isoAspect);
    const isoW = isoH * u.images.isoAspect;
    viewImage(doc, '3D view', u.images.iso, M + (CONTENT_W - isoW) / 2, isoTop, isoW, isoH);

    // Page 2: top, side and door views.
    doc.addPage();
    compactHeader(doc, report, `${u.label} · Views`);
    const longH = CONTENT_W / u.images.longAspect;
    viewImage(doc, 'Top view (front wall on the left, doors on the right)', u.images.top, M, 76, CONTENT_W, longH);
    const sideY = 76 + longH + 26;
    viewImage(doc, 'Side view', u.images.side, M, sideY, CONTENT_W, longH);
    const doorY = sideY + longH + 26;
    const doorH = PAGE_H - 46 - doorY;
    const doorW = doorH * u.images.doorAspect;
    viewImage(doc, 'Door view', u.images.door, M, doorY, doorW, doorH);
    legend(doc, u.legend, M + doorW + 28, doorY, PAGE_H - 50);

    // Page 3+: cargo and stacking plan.
    doc.addPage();
    compactHeader(doc, report, `${u.label} · Cargo`);
    const end = table(doc, report, `${u.label} · Cargo`, u.cargo, 72);
    table(doc, report, `${u.label} · Stacking plan`, u.steps, end + 30);
  });

  if (report.notLoaded) {
    doc.addPage();
    compactHeader(doc, report, 'Not loaded');
    table(doc, report, 'Not loaded', report.notLoaded, 72);
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(clean(report.footer), M, PAGE_H - 20);
    doc.text(`Page ${p} of ${pages}`, PAGE_W - M, PAGE_H - 20, { align: 'right' });
  }
  doc.save(report.filename);
}
