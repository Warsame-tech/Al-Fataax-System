/*
 * Electronics & mobile shops: product types with their units, usual tracking method and technical
 * specification fields (the owner can add more per type: Products → Specification fields).
 *   units     units offered for the type (first = default), e.g. Network Cable: Meter or Roll
 *   tracking  qty | serial | imei | serial_imei — suggested for new products of the type
 *   specs     specification fields shown in the product form (brand, model and warranty are separate fields)
 */
export const TRACKING = ["qty", "serial", "imei", "serial_imei"];

export const PRODUCT_TYPES = [
  { key: "Smartphone", units: ["pcs"], tracking: "imei", specs: ["RAM", "Internal Storage", "Color", "Network Support", "SIM Configuration", "Operating System", "Screen Size", "Battery Capacity", "Processor", "Camera"] },
  { key: "Feature Phone", units: ["pcs"], tracking: "imei", specs: ["Color", "SIM Configuration", "Network Support", "Battery Capacity", "Screen Size"] },
  { key: "Tablet", units: ["pcs"], tracking: "serial", specs: ["RAM", "Storage", "Screen Size", "Operating System", "Wi-Fi / Cellular", "SIM Support", "Color"] },
  { key: "Laptop", units: ["pcs"], tracking: "serial", specs: ["Processor Brand", "Processor Model", "Processor Generation", "RAM", "Storage Type", "Storage Capacity", "Graphics", "Screen Size", "Operating System", "Keyboard Layout", "Color"] },
  { key: "Desktop Computer", units: ["pcs"], tracking: "serial", specs: ["Processor", "RAM", "Storage Type", "Storage Capacity", "Graphics", "Operating System"] },
  { key: "Monitor", units: ["pcs"], tracking: "serial", specs: ["Screen Size", "Resolution", "Panel Type", "Refresh Rate", "Ports"] },
  { key: "Printer", units: ["pcs"], tracking: "serial", specs: ["Printing Technology", "Color / Mono", "Connection Type", "Paper Size"] },
  { key: "Barcode Scanner", units: ["pcs"], tracking: "serial", specs: ["Scanner Technology", "Connection Type", "Supported Barcode Types", "Interface"] },
  { key: "Receipt Printer", units: ["pcs"], tracking: "serial", specs: ["Printing Technology", "Paper Width", "Connection Type", "Supported Operating Systems", "Print Speed"] },
  { key: "Keyboard", units: ["pcs"], tracking: "qty", specs: ["Wired / Wireless", "Connection Type", "Layout / Language", "Compatibility", "Color"] },
  { key: "Mouse", units: ["pcs"], tracking: "qty", specs: ["Wired / Wireless", "Connection Type", "Compatibility", "Color"] },
  { key: "Charger", units: ["pcs"], tracking: "qty", specs: ["Wattage", "Connector Type", "Input Voltage", "Output Voltage", "Compatibility", "Color"] },
  { key: "USB Cable", units: ["pcs"], tracking: "qty", specs: ["Connector Type", "Length", "Color"] },
  { key: "Headphones", units: ["pcs"], tracking: "qty", specs: ["Wired / Wireless", "Connection Type", "Color"] },
  { key: "Earphones", units: ["pcs"], tracking: "qty", specs: ["Wired / Wireless", "Connection Type", "Color"] },
  { key: "Speaker", units: ["pcs"], tracking: "qty", specs: ["Wired / Wireless", "Power Output", "Connection Type", "Color"] },
  { key: "Power Bank", units: ["pcs"], tracking: "qty", specs: ["Capacity", "Output", "Ports", "Color"] },
  { key: "Router / Networking", units: ["pcs"], tracking: "serial", specs: ["Wi-Fi Standard", "Speed", "Bands", "Ports"] },
  { key: "Flash Drive", units: ["pcs"], tracking: "qty", specs: ["Capacity", "USB Version"] },
  { key: "Memory Card", units: ["pcs"], tracking: "qty", specs: ["Capacity", "Speed Class"] },
  { key: "Storage Device", units: ["pcs"], tracking: "serial", specs: ["Capacity", "Type", "Interface"] },
  { key: "Batteries", units: ["pcs", "pack"], tracking: "qty", specs: ["Size / Type", "Voltage", "Pieces per Pack"] },
  { key: "Screws", units: ["pcs", "pack"], tracking: "qty", specs: ["Size", "Material"] },
  { key: "Network Cable", units: ["meter", "roll"], tracking: "qty", specs: ["Category", "Length per Roll"] },
  { key: "Printer Paper", units: ["roll", "pack"], tracking: "qty", specs: ["Paper Size", "Sheets / Length"] },
  { key: "Thermal Paper", units: ["roll", "box"], tracking: "qty", specs: ["Paper Width", "Roll Length", "Rolls per Box"] },
  { key: "Computer Components", units: ["pcs"], tracking: "qty", specs: ["Component Type", "Compatibility"] },
  { key: "Screen Protector", units: ["pcs", "pack"], tracking: "qty", specs: ["Compatible Model", "Type"] },
  { key: "Electronic Accessories", units: ["pcs", "pack"], tracking: "qty", specs: ["Compatibility", "Color"] },
  { key: "Other", units: ["pcs", "pack", "box", "roll", "meter"], tracking: "qty", specs: [] }
];

export const typeOf = (key) => PRODUCT_TYPES.find((x) => x.key === key) || null;

/** Specification fields of a type: its template + the owner's extra fields for it. */
export function specFieldsFor(key, extra = {}) {
  const base = typeOf(key)?.specs || [];
  return [...base, ...(extra[key] || []).filter((f) => !base.includes(f))];
}

/** A variant label from the specs, e.g. "8GB / 256GB / Blue" (RAM, storage, colour). */
export function variantFromSpecs(specs = {}) {
  const pick = (...keys) => keys.map((k) => specs[k]).find((v) => v && String(v).trim());
  const compact = (v) => String(v).replace(/\s+(GB|TB|MB)\b/i, "$1");
  return [pick("RAM"), pick("Internal Storage", "Storage", "Storage Capacity", "Capacity"), pick("Color")].filter(Boolean).map(compact).join(" / ");
}

/** Short tracking label for lists: "IMEI", "S/N", "S/N + IMEI" (nothing for quantities). */
export const trackingShort = (t) => ({ serial: "S/N", imei: "IMEI", serial_imei: "S/N + IMEI" }[t] || "");
