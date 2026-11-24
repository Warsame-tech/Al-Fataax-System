/*
 * The PDF of a report (one template for every report): the business's logo, name and contact details, the report's
 * title, subject, period and generation date; summary figures; details; then each section as a table whose header
 * repeats on every page, with its totals at the end; a footer with the business name and "Page x of y".
 * The report comes from the server (routes/pdfReports.js); `fmt(col, value)` formats a cell, `L(key)` translates.
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

const NAVY = [11, 13, 61], ORANGE = [255, 138, 76], MUTED = [93, 96, 121], LINE = [226, 228, 238], SOFT = [246, 247, 251];

/** An image URL → data URL (for the logo); null when it can't be read. */
export async function imageData(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => ok(null); r.readAsDataURL(blob); });
  } catch { return null; }
}
const imageSize = (data) => new Promise((ok) => { const i = new Image(); i.onload = () => ok({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => ok(null); i.src = data; });

export async function buildReportPdf({ business, logo, report, title, subtitle, periodText, generatedText, L, fmt, labelOf }) {
  const wide = report.sections.some((s) => s.columns.length > 7);
  const doc = new jsPDF({ orientation: wide ? "landscape" : "portrait", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 14;

  /* ---------- header (first page) ---------- */
  let x = M, y = M;
  if (logo) {
    const size = await imageSize(logo);
    if (size) {
      const h = 18, w = Math.min(40, (size.w / size.h) * h);
      try { doc.addImage(logo, M, y, w, h, undefined, "FAST"); x = M + w + 5; } catch { /* unreadable image: no logo */ }
    }
  }
  // the business: its name (on as many lines as it needs), then its contact details under it
  const leftW = W / 2 - x + M - 4;
  doc.setTextColor(...NAVY).setFont("helvetica", "bold").setFontSize(14);
  const nameLines = doc.splitTextToSize(business.name || "", leftW).slice(0, 2);
  doc.text(nameLines, x, y + 6);
  let ly = y + 6 + (nameLines.length - 1) * 5.6 + 5.4;
  const contact = [business.phone, business.email].filter(Boolean).join("  ·  ");
  doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(...MUTED);
  if (contact) { doc.text(doc.splitTextToSize(contact, leftW)[0], x, ly); ly += 4.4; }
  if (business.address) { doc.text(doc.splitTextToSize(business.address, leftW)[0], x, ly); ly += 4.4; }
  // the report's title on the right
  doc.setTextColor(...NAVY).setFont("helvetica", "bold").setFontSize(15).text(title, W - M, y + 6, { align: "right", maxWidth: W / 2 - M });
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...MUTED);
  let ry = y + 11.5;
  if (subtitle) { doc.setTextColor(...NAVY).setFont("helvetica", "bold").text(subtitle, W - M, ry, { align: "right", maxWidth: W / 2 - M }); doc.setFont("helvetica", "normal").setTextColor(...MUTED); ry += 4.5; }
  if (periodText) { doc.text(periodText, W - M, ry, { align: "right" }); ry += 4.5; }
  doc.setFontSize(7.5).text(generatedText, W - M, ry, { align: "right" });
  y = Math.max(y + 22, ry + 3, ly + 1);
  doc.setDrawColor(...ORANGE).setLineWidth(0.8).line(M, y, W - M, y);
  y += 6;

  /* ---------- summary figures ---------- */
  const stats = (report.stats || []).filter((s) => s.value !== null && s.value !== undefined);
  if (stats.length) {
    const per = wide ? 6 : 4, gap = 3, bw = (W - 2 * M - gap * (per - 1)) / per, bh = 15;
    stats.forEach((s, i) => {
      const cx = M + (i % per) * (bw + gap), cy = y + Math.floor(i / per) * (bh + gap);
      doc.setFillColor(...SOFT).setDrawColor(...LINE).setLineWidth(0.2).roundedRect(cx, cy, bw, bh, 2, 2, "FD");
      doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...MUTED).text(labelOf("f", s.key), cx + 3, cy + 5.2, { maxWidth: bw - 6 });
      doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...NAVY).text(String(fmt({ type: s.type, key: s.key }, s.value)), cx + 3, cy + 11.5, { maxWidth: bw - 6 });
    });
    y += Math.ceil(stats.length / per) * (bh + gap) + 3;
  }

  /* ---------- details (key / value) ---------- */
  if (report.details?.length) {
    autoTable(doc, {
      startY: y, margin: { left: M, right: M }, theme: "plain", styles: { fontSize: 8.5, cellPadding: { top: 1.4, bottom: 1.4, left: 2, right: 2 }, textColor: NAVY },
      columnStyles: { 0: { cellWidth: 45, textColor: MUTED }, 1: { fontStyle: "bold" } },
      body: report.details.map(([k, v, type]) => [labelOf("f", k), String(fmt({ type: type || "text", key: k }, v))]),
      didDrawCell: (d) => { if (d.section === "body") doc.setDrawColor(...LINE).setLineWidth(0.1).line(d.cell.x, d.cell.y + d.cell.height, d.cell.x + d.cell.width, d.cell.y + d.cell.height); }
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  /* ---------- sections ---------- */
  for (const sec of report.sections) {
    if (sec.title) {
      if (y > H - 40) { doc.addPage(); y = M; }
      doc.setFont("helvetica", "bold").setFontSize(10.5).setTextColor(...NAVY).text(labelOf("sec", sec.title), M, y);
      y += 3;
    }
    const cols = sec.columns;
    const num = (c) => ["money", "qty", "int", "pct"].includes(c.type);
    const body = sec.rows.length ? sec.rows.map((r) => cols.map((c) => String(fmt(c, r[c.key], r)))) : [[{ content: L("noRows"), colSpan: cols.length, styles: { halign: "center", textColor: MUTED } }]];
    const foot = sec.totals ? [cols.map((c, i) => (c.key in sec.totals ? String(fmt(c, sec.totals[c.key])) : i === 0 ? L("total") : ""))] : undefined;
    autoTable(doc, {
      startY: y, margin: { left: M, right: M, top: M + 4, bottom: 16 },
      head: [cols.map((c) => c.label || labelOf("f", c.key))], body, foot, showHead: "everyPage", showFoot: "lastPage",
      styles: { font: "helvetica", fontSize: 8.2, cellPadding: { top: 2, bottom: 2, left: 2.2, right: 2.2 }, textColor: NAVY, lineColor: LINE, lineWidth: 0.1, overflow: "linebreak" },
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold", fontSize: 8 },
      footStyles: { fillColor: [236, 238, 246], textColor: NAVY, fontStyle: "bold" },
      alternateRowStyles: { fillColor: SOFT },
      columnStyles: Object.fromEntries(cols.map((c, i) => [i, num(c) ? { halign: "right" } : c.type === "date" ? { cellWidth: 22 } : {}])),
      didParseCell: (d) => {
        if (num(cols[d.column.index] || {}) && d.section !== "body") d.cell.styles.halign = "right";
        if (d.section === "body" && sec.rows[d.row.index]?._strong) d.cell.styles.fontStyle = "bold";
        if (d.section === "body" && sec.rows[d.row.index]?._muted) d.cell.styles.textColor = MUTED;
      }
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  /* ---------- footer on every page ---------- */
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...LINE).setLineWidth(0.2).line(M, H - 11, W - M, H - 11);
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...MUTED);
    doc.text(doc.splitTextToSize(`${business.name || ""}  ·  ${title}`, W - 2 * M - 50)[0], M, H - 6.5);
    doc.text(`${L("pageOf").replace("{p}", p).replace("{n}", pages)}  ·  Faatix`, W - M, H - 6.5, { align: "right" });
  }
  doc.setProperties({ title: `${title} · ${business.name || ""}`, author: business.name || "Faatix", creator: "Faatix" });
  return doc;
}
