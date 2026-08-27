/**
 * Renders the app icons.
 *
 * Written by hand (supersampled rasteriser + zlib PNG encoder) rather than
 * pulled from a design tool, so the icon set is reproducible from source in CI
 * with no binary assets checked in and no image dependency.
 *
 *   node scripts/generate-icons.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BRAND = [0x8c, 0x1d, 0x24];
const BRAND_DEEP = [0x6f, 0x15, 0x1b];
const PAPER = [0xfd, 0xf9, 0xf5];
const AMBER = [0xe6, 0xb4, 0x55];

const SS = 4; // supersampling factor

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // no filter
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Signed distance from a point to a segment — used for stroked marks. */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function roundedRectContains(x, y, size, radius, inset = 0) {
  const min = inset;
  const max = size - inset;
  const r = Math.min(radius, (max - min) / 2);
  const cx = Math.min(Math.max(x, min + r), max - r);
  const cy = Math.min(Math.max(y, min + r), max - r);
  if (x < min || x > max || y < min || y > max) return false;
  return Math.hypot(x - cx, y - cy) <= r || (x >= min + r && x <= max - r) || (y >= min + r && y <= max - r);
}

function render(size, { maskable = false } = {}) {
  const S = size * SS;
  const acc = new Float64Array(S * S * 4);
  const radius = maskable ? S : S * 0.22;
  const inset = 0;
  // The maskable variant keeps the mark inside the 80% safe zone.
  const scale = maskable ? 0.62 : 0.78;
  const pad = (S * (1 - scale)) / 2;

  const put = (i, color, alpha) => {
    acc[i] = acc[i] * (1 - alpha) + color[0] * alpha;
    acc[i + 1] = acc[i + 1] * (1 - alpha) + color[1] * alpha;
    acc[i + 2] = acc[i + 2] * (1 - alpha) + color[2] * alpha;
    acc[i + 3] = Math.max(acc[i + 3], alpha * 255);
  };

  for (let y = 0; y < S; y += 1) {
    for (let x = 0; x < S; x += 1) {
      const i = (y * S + x) * 4;
      if (!roundedRectContains(x, y, S, radius, inset)) continue;
      // Vertical warm gradient so the tile has some depth at large sizes.
      const t = y / S;
      put(
        i,
        [
          BRAND[0] + (BRAND_DEEP[0] - BRAND[0]) * t,
          BRAND[1] + (BRAND_DEEP[1] - BRAND[1]) * t,
          BRAND[2] + (BRAND_DEEP[2] - BRAND[2]) * t,
        ],
        1,
      );
    }
  }

  // The mark: a bookmark/page silhouette with a checkmark cut through it.
  const w = S * scale;
  const left = pad + w * 0.14;
  const right = pad + w * 0.86;
  const top = pad + w * 0.06;
  const bottom = pad + w * 0.94;
  const notch = w * 0.11;
  const stroke = w * 0.115;

  for (let y = 0; y < S; y += 1) {
    for (let x = 0; x < S; x += 1) {
      const i = (y * S + x) * 4;
      // Page body
      const insidePage =
        x >= left && x <= right && y >= top && y <= bottom - notch * (x > (left + right) / 2 ? 0 : 0);
      if (insidePage) {
        // Bookmark notch at the bottom centre.
        const cx = (left + right) / 2;
        const notchDepth = notch * (1 - Math.abs(x - cx) / ((right - left) / 2));
        if (y <= bottom - Math.max(0, notchDepth)) put(i, PAPER, 1);
      }
      // Amber rule near the top of the page.
      if (x >= left + w * 0.12 && x <= right - w * 0.12) {
        const ruleY = top + w * 0.22;
        if (Math.abs(y - ruleY) <= stroke * 0.28) put(i, AMBER, 1);
      }
      // Checkmark
      const d = Math.min(
        distanceToSegment(x, y, left + w * 0.21, top + w * 0.48, left + w * 0.34, top + w * 0.61),
        distanceToSegment(x, y, left + w * 0.34, top + w * 0.61, left + w * 0.57, top + w * 0.36),
      );
      if (d <= stroke * 0.5) put(i, BRAND, 1);
    }
  }

  // Downsample.
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const i = ((y * SS + sy) * S + (x * SS + sx)) * 4;
          r += acc[i];
          g += acc[i + 1];
          b += acc[i + 2];
          a += acc[i + 3];
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return encodePng(size, size, out);
}

mkdirSync('public/icons', { recursive: true });
const targets = [
  ['public/icons/icon-192.png', 192, {}],
  ['public/icons/icon-512.png', 512, {}],
  ['public/icons/maskable-512.png', 512, { maskable: true }],
  ['public/icons/apple-touch-icon.png', 180, {}],
  ['public/icons/favicon-32.png', 32, {}],
];
for (const [path, size, opts] of targets) {
  writeFileSync(path, render(size, opts));
  console.log(`wrote ${path} (${size}px)`);
}
