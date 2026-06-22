// Image processing algorithms. All functions operate on ImageData and return new ImageData.

export const cloneImageData = (d: ImageData): ImageData =>
  new ImageData(new Uint8ClampedArray(d.data), d.width, d.height);

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

export function adjustBrightness(src: ImageData, value: number): ImageData {
  const out = cloneImageData(src);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = clamp(d[i] + value);
    d[i + 1] = clamp(d[i + 1] + value);
    d[i + 2] = clamp(d[i + 2] + value);
  }
  return out;
}

export function adjustContrast(src: ImageData, value: number): ImageData {
  const out = cloneImageData(src);
  const d = out.data;
  const f = (259 * (value + 255)) / (255 * (259 - value));
  for (let i = 0; i < d.length; i += 4) {
    d[i] = clamp(f * (d[i] - 128) + 128);
    d[i + 1] = clamp(f * (d[i + 1] - 128) + 128);
    d[i + 2] = clamp(f * (d[i + 2] - 128) + 128);
  }
  return out;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h, s, l];
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r: number, g: number, b: number;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [r * 255, g * 255, b * 255];
}

export function adjustHueSaturation(src: ImageData, hueShift: number, satMul: number): ImageData {
  const out = cloneImageData(src);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
    const nh = (h + hueShift / 360 + 1) % 1;
    const ns = Math.min(1, Math.max(0, s * satMul));
    const [r, g, b] = hslToRgb(nh, ns, l);
    d[i] = clamp(r); d[i + 1] = clamp(g); d[i + 2] = clamp(b);
  }
  return out;
}

export function gammaCorrection(src: ImageData, gamma: number): ImageData {
  const out = cloneImageData(src);
  const d = out.data;
  const inv = 1 / gamma;
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = clamp(255 * Math.pow(i / 255, inv));
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]];
  }
  return out;
}

export function thresholdGlobal(src: ImageData, t: number): ImageData {
  const out = cloneImageData(src);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = gray >= t ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  return out;
}

export function thresholdAdaptive(src: ImageData, blockSize: number, c: number): ImageData {
  const { width: w, height: h, data } = src;
  const out = cloneImageData(src);
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  const r = Math.max(1, Math.floor(blockSize / 2));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, n = 0;
      for (let j = -r; j <= r; j++) {
        const yy = y + j; if (yy < 0 || yy >= h) continue;
        for (let i = -r; i <= r; i++) {
          const xx = x + i; if (xx < 0 || xx >= w) continue;
          sum += gray[yy * w + xx]; n++;
        }
      }
      const mean = sum / n;
      const idx = (y * w + x) * 4;
      const v = gray[y * w + x] >= mean - c ? 255 : 0;
      out.data[idx] = out.data[idx + 1] = out.data[idx + 2] = v;
    }
  }
  return out;
}

export function histogramEqualize(src: ImageData): ImageData {
  const { width: w, height: h, data } = src;
  const out = cloneImageData(src);
  const hist = new Array(256).fill(0);
  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const g = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    gray[p] = g; hist[g]++;
  }
  const cdf = new Array(256).fill(0);
  cdf[0] = hist[0];
  for (let i = 1; i < 256; i++) cdf[i] = cdf[i - 1] + hist[i];
  const total = w * h;
  const lut = new Uint8ClampedArray(256);
  let cdfMin = 0;
  for (let i = 0; i < 256; i++) if (cdf[i] > 0) { cdfMin = cdf[i]; break; }
  for (let i = 0; i < 256; i++) lut[i] = Math.round(((cdf[i] - cdfMin) / (total - cdfMin)) * 255);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const oldG = gray[p]; if (oldG === 0) continue;
    const ratio = lut[oldG] / oldG;
    out.data[i] = clamp(data[i] * ratio);
    out.data[i + 1] = clamp(data[i + 1] * ratio);
    out.data[i + 2] = clamp(data[i + 2] * ratio);
  }
  return out;
}

export function contrastStretch(src: ImageData): ImageData {
  const out = cloneImageData(src);
  const d = out.data;
  const mins = [255, 255, 255], maxs = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      if (d[i + c] < mins[c]) mins[c] = d[i + c];
      if (d[i + c] > maxs[c]) maxs[c] = d[i + c];
    }
  }
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const range = maxs[c] - mins[c] || 1;
      d[i + c] = clamp(((d[i + c] - mins[c]) / range) * 255);
    }
  }
  return out;
}

export function convolve(src: ImageData, kernel: number[][], divisor = 1, bias = 0, grayOut = false): ImageData {
  const { width: w, height: h, data } = src;
  const out = cloneImageData(src);
  const kh = kernel.length, kw = kernel[0].length;
  const kcy = Math.floor(kh / 2), kcx = Math.floor(kw / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let ky = 0; ky < kh; ky++) {
        for (let kx = 0; kx < kw; kx++) {
          const yy = Math.min(h - 1, Math.max(0, y + ky - kcy));
          const xx = Math.min(w - 1, Math.max(0, x + kx - kcx));
          const idx = (yy * w + xx) * 4;
          const k = kernel[ky][kx];
          r += data[idx] * k; g += data[idx + 1] * k; b += data[idx + 2] * k;
        }
      }
      const i = (y * w + x) * 4;
      r = r / divisor + bias; g = g / divisor + bias; b = b / divisor + bias;
      if (grayOut) {
        const v = clamp(Math.abs(0.299 * r + 0.587 * g + 0.114 * b));
        out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
      } else {
        out.data[i] = clamp(r); out.data[i + 1] = clamp(g); out.data[i + 2] = clamp(b);
      }
    }
  }
  return out;
}

export const KERNELS = {
  mean3: [[1, 1, 1], [1, 1, 1], [1, 1, 1]],
  gaussian3: [[1, 2, 1], [2, 4, 2], [1, 2, 1]],
  gaussian5: [[1, 4, 6, 4, 1], [4, 16, 24, 16, 4], [6, 24, 36, 24, 6], [4, 16, 24, 16, 4], [1, 4, 6, 4, 1]],
  sharpen: [[0, -1, 0], [-1, 5, -1], [0, -1, 0]],
  laplacian: [[0, -1, 0], [-1, 4, -1], [0, -1, 0]],
  sobelX: [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]],
  sobelY: [[-1, -2, -1], [0, 0, 0], [1, 2, 1]],
  prewittX: [[-1, 0, 1], [-1, 0, 1], [-1, 0, 1]],
  prewittY: [[-1, -1, -1], [0, 0, 0], [1, 1, 1]],
  emboss: [[-2, -1, 0], [-1, 1, 1], [0, 1, 2]],
};

export function meanBlur(src: ImageData) { return convolve(src, KERNELS.mean3, 9); }
export function gaussianBlur(src: ImageData, size: 3 | 5 = 5) {
  return size === 3 ? convolve(src, KERNELS.gaussian3, 16) : convolve(src, KERNELS.gaussian5, 256);
}
export function sharpen(src: ImageData) { return convolve(src, KERNELS.sharpen, 1); }
export function laplacianEdges(src: ImageData) { return convolve(src, KERNELS.laplacian, 1, 0, true); }
export function embossFilter(src: ImageData) { return convolve(src, KERNELS.emboss, 1, 128); }

function gradientMagnitude(src: ImageData, kx: number[][], ky: number[][]): ImageData {
  const gx = convolve(src, kx, 1, 0, true);
  const gy = convolve(src, ky, 1, 0, true);
  const out = cloneImageData(src);
  for (let i = 0; i < out.data.length; i += 4) {
    const v = clamp(Math.hypot(gx.data[i], gy.data[i]));
    out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
  }
  return out;
}
export const sobelEdges = (s: ImageData) => gradientMagnitude(s, KERNELS.sobelX, KERNELS.sobelY);
export const prewittEdges = (s: ImageData) => gradientMagnitude(s, KERNELS.prewittX, KERNELS.prewittY);

function rankFilter(src: ImageData, radius: number, pick: (arr: number[]) => number): ImageData {
  const { width: w, height: h, data } = src;
  const out = cloneImageData(src);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const R: number[] = [], G: number[] = [], B: number[] = [];
      for (let j = -radius; j <= radius; j++) {
        const yy = Math.min(h - 1, Math.max(0, y + j));
        for (let i = -radius; i <= radius; i++) {
          const xx = Math.min(w - 1, Math.max(0, x + i));
          const idx = (yy * w + xx) * 4;
          R.push(data[idx]); G.push(data[idx + 1]); B.push(data[idx + 2]);
        }
      }
      const i = (y * w + x) * 4;
      out.data[i] = pick(R); out.data[i + 1] = pick(G); out.data[i + 2] = pick(B);
    }
  }
  return out;
}
const median = (a: number[]) => { a.sort((x, y) => x - y); return a[a.length >> 1]; };
export const medianFilter = (s: ImageData, r = 1) => rankFilter(s, r, median);
export const maxFilter = (s: ImageData, r = 1) => rankFilter(s, r, a => Math.max(...a));
export const minFilter = (s: ImageData, r = 1) => rankFilter(s, r, a => Math.min(...a));

// Morphological operations operate on grayscale per channel via min/max
export const erode = (s: ImageData, r = 1) => rankFilter(s, r, a => Math.min(...a));
export const dilate = (s: ImageData, r = 1) => rankFilter(s, r, a => Math.max(...a));
export const opening = (s: ImageData, r = 1) => dilate(erode(s, r), r);
export const closing = (s: ImageData, r = 1) => erode(dilate(s, r), r);

// Frequency-domain approximation: separate low/high frequencies via Gaussian.
export function lowPass(src: ImageData) { return gaussianBlur(src, 5); }
export function highPass(src: ImageData): ImageData {
  const lp = gaussianBlur(src, 5);
  const out = cloneImageData(src);
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = clamp(src.data[i] - lp.data[i] + 128);
    out.data[i + 1] = clamp(src.data[i + 1] - lp.data[i + 1] + 128);
    out.data[i + 2] = clamp(src.data[i + 2] - lp.data[i + 2] + 128);
  }
  return out;
}

// AI-style automatic color correction: per-channel percentile contrast stretch + gentle saturation lift.
export function autoColor(src: ImageData): ImageData {
  const stretched = contrastStretch(src);
  return adjustHueSaturation(stretched, 0, 1.15);
}

// Artistic filter: cartoon-style (smooth + posterize + edges overlay)
export function artisticCartoon(src: ImageData): ImageData {
  const smooth = medianFilter(src, 2);
  const out = cloneImageData(smooth);
  // posterize to 5 levels
  for (let i = 0; i < out.data.length; i += 4) {
    for (let c = 0; c < 3; c++) out.data[i + c] = Math.round(out.data[i + c] / 51) * 51;
  }
  const edges = sobelEdges(src);
  for (let i = 0; i < out.data.length; i += 4) {
    if (edges.data[i] > 80) { out.data[i] = out.data[i + 1] = out.data[i + 2] = 0; }
  }
  return out;
}

// Grayscale / invert / sepia
export function grayscale(src: ImageData): ImageData {
  const out = cloneImageData(src);
  for (let i = 0; i < out.data.length; i += 4) {
    const v = 0.299 * out.data[i] + 0.587 * out.data[i + 1] + 0.114 * out.data[i + 2];
    out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
  }
  return out;
}
export function invert(src: ImageData): ImageData {
  const out = cloneImageData(src);
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = 255 - out.data[i]; out.data[i + 1] = 255 - out.data[i + 1]; out.data[i + 2] = 255 - out.data[i + 2];
  }
  return out;
}
export function sepia(src: ImageData): ImageData {
  const out = cloneImageData(src);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    d[i] = clamp(0.393 * r + 0.769 * g + 0.189 * b);
    d[i + 1] = clamp(0.349 * r + 0.686 * g + 0.168 * b);
    d[i + 2] = clamp(0.272 * r + 0.534 * g + 0.131 * b);
  }
  return out;
}

// Canvas helpers
export function imageDataToCanvas(d: ImageData): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = d.width; c.height = d.height;
  c.getContext("2d")!.putImageData(d, 0, 0);
  return c;
}

export function rotateImageData(src: ImageData, deg: number): ImageData {
  const rad = (deg * Math.PI) / 180;
  const c = imageDataToCanvas(src);
  const w = src.width, h = src.height;
  const sin = Math.abs(Math.sin(rad)), cos = Math.abs(Math.cos(rad));
  const nw = Math.round(w * cos + h * sin), nh = Math.round(w * sin + h * cos);
  const out = document.createElement("canvas");
  out.width = nw; out.height = nh;
  const ctx = out.getContext("2d")!;
  ctx.translate(nw / 2, nh / 2);
  ctx.rotate(rad);
  ctx.drawImage(c, -w / 2, -h / 2);
  return ctx.getImageData(0, 0, nw, nh);
}

export function flipImageData(src: ImageData, axis: "h" | "v"): ImageData {
  const c = imageDataToCanvas(src);
  const out = document.createElement("canvas");
  out.width = src.width; out.height = src.height;
  const ctx = out.getContext("2d")!;
  if (axis === "h") { ctx.translate(src.width, 0); ctx.scale(-1, 1); }
  else { ctx.translate(0, src.height); ctx.scale(1, -1); }
  ctx.drawImage(c, 0, 0);
  return ctx.getImageData(0, 0, src.width, src.height);
}

export function resizeImageData(src: ImageData, nw: number, nh: number): ImageData {
  const c = imageDataToCanvas(src);
  const out = document.createElement("canvas");
  out.width = nw; out.height = nh;
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(c, 0, 0, nw, nh);
  return ctx.getImageData(0, 0, nw, nh);
}

export function cropImageData(src: ImageData, x: number, y: number, w: number, h: number): ImageData {
  const c = imageDataToCanvas(src);
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  out.getContext("2d")!.drawImage(c, x, y, w, h, 0, 0, w, h);
  return out.getContext("2d")!.getImageData(0, 0, w, h);
}

// Perspective / shear transformation via affine matrix
export function perspectiveSkew(src: ImageData, sx: number, sy: number): ImageData {
  const c = imageDataToCanvas(src);
  const w = src.width, h = src.height;
  const nw = w + Math.abs(sx) * h, nh = h + Math.abs(sy) * w;
  const out = document.createElement("canvas");
  out.width = nw; out.height = nh;
  const ctx = out.getContext("2d")!;
  ctx.translate(sx < 0 ? -sx * h : 0, sy < 0 ? -sy * w : 0);
  ctx.transform(1, sy, sx, 1, 0, 0);
  ctx.drawImage(c, 0, 0);
  return ctx.getImageData(0, 0, nw, nh);
}

// Compute 256-bin luminance histogram for display.
export function luminanceHistogram(src: ImageData): number[] {
  const h = new Array(256).fill(0);
  for (let i = 0; i < src.data.length; i += 4) {
    const v = Math.round(0.299 * src.data[i] + 0.587 * src.data[i + 1] + 0.114 * src.data[i + 2]);
    h[v]++;
  }
  return h;
}