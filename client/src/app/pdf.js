/*
 * "Save as PDF": builds the PDF file in the browser from a page element and downloads it
 * (no print dialog). While it is captured the element gets the "is-exporting" class, so CSS
 * can show print-only parts (.pdf-only) and drop screen-only decoration.
 *
 *   await savePdf(el, "INV-0001.pdf")                         A4 portrait
 *   await savePdf(el, "R-0001.pdf", { paperWidth: 80 })        thermal receipt: 80 mm wide, as long as the content
 */
export async function savePdf(el, filename, { paperWidth, margin = 8, orientation = "portrait", avoid = ["tr"] } = {}) {
  if (!el) return;
  el.classList.add("is-exporting");
  try {
    const { default: html2pdf } = await import("html2pdf.js");
    const format = paperWidth
      ? [paperWidth, Math.ceil((paperWidth * el.scrollHeight) / el.scrollWidth) + 2]
      : "a4";
    await html2pdf().set({
      margin: paperWidth ? 0 : [margin, margin, margin, margin],
      filename,
      image: { type: "jpeg", quality: 0.96 },
      html2canvas: { scale: paperWidth ? 3 : 2, useCORS: true, backgroundColor: "#ffffff" },
      jsPDF: { unit: "mm", format, orientation: paperWidth ? "portrait" : orientation },
      pagebreak: paperWidth ? { mode: [] } : { mode: ["css", "legacy"], avoid }
    }).from(el).save();
  } finally {
    el.classList.remove("is-exporting");
  }
}
