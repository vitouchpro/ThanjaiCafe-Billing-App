import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'photo-backups/originals';
const OUT = 'public/products';
const W = 400, H = 300;

/* Per-image pixel trims (out of 400x300) to crop before resizing back to
   400x300 — pulls a distracting prop, watermark, or extra object out of
   frame. Anything not listed gets a light uniform tightening. */
const CROPS = {
  'filter-coffee.webp': { left: 20, top: 55, right: 70, bottom: 8 },   // laptop keyboard, top-right
  'cold-coffee.webp': { left: 8, top: 8, right: 55, bottom: 20 },      // hand/arm, bottom-right
  'lemon-tea.webp': { left: 8, top: 8, right: 150, bottom: 8 },        // extra water glass, right
  'rava-kesari.webp': { left: 130, top: 8, right: 8, bottom: 60 },     // blog watermark, bottom-left
  'samosa.webp': { left: 8, top: 175, right: 8, bottom: 8 },           // printed napkin text, top
  'murukku.webp': { left: 8, top: 8, right: 110, bottom: 8 },          // decorative flower prop, right
  'masala-dosa.webp': { left: 55, top: 30, right: 55, bottom: 30 },    // zoom onto the white plate
  'poori-2-pcs.webp': { left: 30, top: 15, right: 30, bottom: 15 },
  'ragi-adai.webp': { left: 30, top: 15, right: 30, bottom: 15 },
};
const DEFAULT_CROP = { left: 14, top: 10, right: 14, bottom: 10 };

/* The fade-to-white treatment only reads as "white card" on photos whose
   background is already light — on a dark or wood-grain background it just
   adds a hazy patch without ever reaching white, so those keep their real
   background, lightly tightened, inside the card's own white padding. */
const FADE = new Set([
  'badam-milk.webp', 'green-tea.webp', 'sukku-coffee.webp', 'plain-dosa.webp',
  'pongal.webp', 'masala-dosa.webp', 'poori-2-pcs.webp', 'ragi-adai.webp',
]);

const maskSvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="g" cx="50%" cy="47%" r="70%">
      <stop offset="60%" stop-color="#fff" stop-opacity="1"/>
      <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
</svg>`;

async function processOne(file) {
  const crop = CROPS[file] ?? DEFAULT_CROP;
  const src = path.join(SRC, file);
  const meta = await sharp(src).metadata();
  const cw = meta.width - crop.left - crop.right;
  const ch = meta.height - crop.top - crop.bottom;

  const cropped = await sharp(src)
    .extract({ left: crop.left, top: crop.top, width: cw, height: ch })
    .resize(W, H, { fit: 'cover' })
    .modulate({ brightness: 1.04, saturation: 1.04 })
    .toBuffer();

  if (!FADE.has(file)) {
    return sharp(cropped).webp({ quality: 82 }).toBuffer();
  }

  const maskBuf = await sharp(Buffer.from(maskSvg)).png().toBuffer();

  const faded = await sharp(cropped)
    .ensureAlpha()
    .composite([{ input: maskBuf, blend: 'dest-in' }])
    .png()
    .toBuffer();

  return sharp({
    create: { width: W, height: H, channels: 3, background: '#ffffff' },
  })
    .composite([{ input: faded }])
    .webp({ quality: 82 })
    .toBuffer();
}

const only = process.argv[2]; // optional: process a single file for a quick look

const files = only ? [only] : fs.readdirSync(SRC).filter((f) => f.endsWith('.webp'));
for (const file of files) {
  const buf = await processOne(file);
  fs.writeFileSync(path.join(OUT, file), buf);
  console.log(file, '->', buf.length, 'bytes', FADE.has(file) ? '[fade]' : '');
}
