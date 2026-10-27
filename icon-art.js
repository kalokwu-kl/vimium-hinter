/* global OffscreenCanvas */

// Toolbar icons are drawn at runtime rather than shipped as PNGs: the variants
// are the same artwork plus a grey filter or a dot, so files would only have to
// be regenerated every time the logo changes. background.js caches the results.
const HINTER_ICON_SIZES = [16, 32, 48];

// Amber while the re-scan waits, green once hints are applied.
const HINTER_DOT_COLOURS = { waiting: "#edaf4b", applied: "#80d682" };

// The logo is light blue (#65aee0), where amber and green sit at ~1.3:1
// contrast; a dark ring is what makes the dot readable there and on light
// toolbars.
const HINTER_DOT_RIM = "#2b3440";

function hinterDotGeometry(size) {
  const rim = Math.max(1, size * 0.0625);
  const r = size * 0.245;
  const pad = size * 0.0625;
  return {
    r,
    rim,
    // Bottom-right, with the rim's outer edge kept a pad away from the corner.
    cx: size - pad - r - rim / 2,
    cy: size - pad - r - rim / 2
  };
}

// state: "on" | "off" | "waiting" | "applied"
function hinterRenderIcon(base, size, state) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  if (state === "off") ctx.filter = "grayscale(1)";
  ctx.drawImage(base, 0, 0, size, size);
  ctx.filter = "none";

  const colour = HINTER_DOT_COLOURS[state];
  if (colour) {
    const dot = hinterDotGeometry(size);
    ctx.beginPath();
    ctx.arc(dot.cx, dot.cy, dot.r, 0, Math.PI * 2);
    ctx.fillStyle = colour;
    ctx.fill();
    ctx.lineWidth = dot.rim;
    ctx.strokeStyle = HINTER_DOT_RIM;
    ctx.stroke();
  }

  return ctx.getImageData(0, 0, size, size);
}
