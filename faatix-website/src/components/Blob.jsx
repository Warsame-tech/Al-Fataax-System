/*
 * Organic "rounded triangle" shapes in the brand colours (navy front, orange
 * behind), as in the design reference. Drawn in a 200×200 box.
 */
export const BLOB_FRONT =
  "M100 10 C132 10 152 34 168 66 C184 98 198 126 192 156 C186 184 158 194 126 194 L74 194 C42 194 14 184 8 156 C2 126 16 98 32 66 C48 34 68 10 100 10 Z";
export const BLOB_BACK =
  "M108 4 C146 6 162 36 176 70 C190 104 200 134 188 162 C176 188 144 196 110 194 L68 192 C34 190 10 176 8 146 C6 116 24 90 40 60 C56 30 74 2 108 4 Z";

/** Decorative two-layer blob that fills its parent (position: absolute). */
export default function BlobLayers({ className = "" }) {
  return (
    <svg className={"blob-layers " + className} viewBox="0 0 200 200" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path className="blob-layers__back" d={BLOB_BACK} />
      <path className="blob-layers__front" d={BLOB_FRONT} />
    </svg>
  );
}
