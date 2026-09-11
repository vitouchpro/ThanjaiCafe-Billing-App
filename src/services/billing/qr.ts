/* Minimal QR Code encoder (byte mode, ECC level M).
   Implemented in-repo rather than pulled from a dependency so the POS keeps
   producing scannable payment codes with no network and no vendored bundle.

   Supports versions 1–10, which covers UPI URIs comfortably. */

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

const gfMul = (a: number, b: number): number =>
  a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = rsGeneratorPoly(ecLen);
  const res = new Uint8Array(data.length + ecLen);
  res.set(data);
  for (let i = 0; i < data.length; i++) {
    const factor = res[i];
    if (factor === 0) continue;
    for (let j = 0; j < gen.length; j++) res[i + j] ^= gfMul(gen[j], factor);
  }
  return res.slice(data.length);
}

/* Per-version, ECC level M: [total codewords, ec codewords per block, blocks] */
const VERSION_M: Record<number, [number, number, number]> = {
  1: [26, 10, 1], 2: [44, 16, 1], 3: [70, 26, 1], 4: [100, 18, 2],
  5: [134, 24, 2], 6: [172, 16, 4], 7: [196, 18, 4], 8: [242, 22, 4],
  9: [292, 22, 5], 10: [346, 26, 5],
};

const ALIGNMENT: Record<number, number[]> = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

/** Bytes that fit after the 4-bit mode indicator and the character count
    field (8 bits below version 10, 16 bits from version 10). */
const capacityBytes = (v: number): number => {
  const [total, ecPerBlock, blocks] = VERSION_M[v];
  const dataCodewords = total - ecPerBlock * blocks;
  const headerBits = 4 + (v >= 10 ? 16 : 8);
  return Math.floor((dataCodewords * 8 - headerBits) / 8);
};

export function encodeQr(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);

  let version = 0;
  for (let v = 1; v <= 10; v++) {
    if (bytes.length <= capacityBytes(v)) { version = v; break; }
  }
  if (!version) throw new Error('QR payload too large');

  const [totalCodewords, ecPerBlock, blockCount] = VERSION_M[version];
  const dataCodewords = totalCodewords - ecPerBlock * blockCount;

  /* ---- bit stream ---- */
  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };

  push(0b0100, 4);                                  // byte mode
  push(bytes.length, version >= 10 ? 16 : 8);       // char count
  for (const b of bytes) push(b, 8);

  const capacityBits = dataCodewords * 8;
  push(0, Math.min(4, capacityBits - bits.length)); // terminator
  while (bits.length % 8) bits.push(0);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  }
  // Pad alternately with 0xEC / 0x11 per spec.
  const PAD = [0xec, 0x11];
  for (let i = 0; codewords.length < dataCodewords; i++) codewords.push(PAD[i % 2]);

  /* ---- interleave data + ECC blocks ---- */
  const shortLen = Math.floor(dataCodewords / blockCount);
  const longCount = dataCodewords % blockCount;

  const dataBlocks: number[][] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (let b = 0; b < blockCount; b++) {
    const len = shortLen + (b >= blockCount - longCount ? 1 : 0);
    const block = codewords.slice(offset, offset + len);
    offset += len;
    dataBlocks.push(block);
    ecBlocks.push(rsEncode(Uint8Array.from(block), ecPerBlock));
  }

  const final: number[] = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) {
    for (const block of dataBlocks) if (i < block.length) final.push(block[i]);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const block of ecBlocks) final.push(block[i]);
  }

  /* ---- matrix ---- */
  const size = version * 4 + 17;
  const modules: (boolean | null)[][] = Array.from({ length: size }, () => Array(size).fill(null));

  const setFn = (r: number, c: number, v: boolean) => {
    if (r >= 0 && r < size && c >= 0 && c < size) modules[r][c] = v;
  };

  // Finder patterns + separators
  for (const [fr, fc] of [[0, 0], [0, size - 7], [size - 7, 0]] as const) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const inner = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const on = inner && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        setFn(fr + r, fc + c, on);
      }
    }
  }

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (modules[6][i] === null) modules[6][i] = i % 2 === 0;
    if (modules[i][6] === null) modules[i][6] = i % 2 === 0;
  }

  // Alignment patterns. The three combinations that would sit on top of a
  // finder pattern (first/first, first/last, last/first) are omitted.
  const aligns = ALIGNMENT[version];
  const last = aligns.length - 1;
  for (let i = 0; i < aligns.length; i++) {
    for (let j = 0; j < aligns.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      const r = aligns[i];
      const c = aligns[j];
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          setFn(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
  }

  // Dark module
  modules[size - 8][8] = true;

  // Reserve format areas
  const reserveFormat = () => {
    for (let i = 0; i <= 8; i++) {
      if (modules[8][i] === null) modules[8][i] = false;
      if (modules[i][8] === null) modules[i][8] = false;
    }
    for (let i = 0; i < 8; i++) {
      if (modules[8][size - 1 - i] === null) modules[8][size - 1 - i] = false;
      if (modules[size - 1 - i][8] === null) modules[size - 1 - i][8] = false;
    }
  };
  reserveFormat();

  // Version info (v7+)
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const versionBits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((versionBits >> i) & 1) === 1;
      modules[Math.floor(i / 3)][size - 11 + (i % 3)] = bit;
      modules[size - 11 + (i % 3)][Math.floor(i / 3)] = bit;
    }
  }

  /* ---- place data with mask 0 ---- */
  let bitIndex = 0;
  const dataBits: number[] = [];
  for (const cw of final) for (let i = 7; i >= 0; i--) dataBits.push((cw >> i) & 1);

  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip the vertical timing column
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (let k = 0; k < 2; k++) {
        const col = right - k;
        if (modules[row][col] !== null) continue;
        const bit = bitIndex < dataBits.length ? dataBits[bitIndex++] === 1 : false;
        // Mask 0: (row + col) % 2 === 0
        modules[row][col] = (row + col) % 2 === 0 ? !bit : bit;
      }
    }
    upward = !upward;
  }

  /* ---- format info (ECC M = 0b00, mask 0) ---- */
  const formatData = (0b00 << 3) | 0;
  let rem = formatData;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const format = ((formatData << 10) | rem) ^ 0x5412;

  // The 15-bit format string is written MSB-first: bit index i below counts
  // from the most significant end, which is what decoders expect.
  const fbit = (i: number) => ((format >> (14 - i)) & 1) === 1;

  // Copy 1, wrapped around the top-left finder.
  for (let i = 0; i <= 5; i++) modules[8][i] = fbit(i);
  modules[8][7] = fbit(6);
  modules[8][8] = fbit(7);
  modules[7][8] = fbit(8);
  for (let i = 9; i < 15; i++) modules[14 - i][8] = fbit(i);

  // Copy 2, split between the bottom-left and top-right finders.
  for (let i = 0; i < 7; i++) modules[size - 1 - i][8] = fbit(i);
  for (let i = 7; i < 15; i++) modules[8][size - 15 + i] = fbit(i);

  // The module just above the bottom-left format run is always dark.
  modules[size - 8][8] = true;

  return modules.map((row) => row.map((v) => v === true));
}

/** Renders the matrix as an SVG data URL — crisp at any size, no canvas. */
export function qrToDataUrl(text: string, quietZone = 4): string {
  const m = encodeQr(text);
  const size = m.length + quietZone * 2;

  let path = '';
  for (let r = 0; r < m.length; r++) {
    for (let c = 0; c < m.length; c++) {
      if (m[r][c]) path += `M${c + quietZone} ${r + quietZone}h1v1h-1z`;
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="#fff"/>` +
    `<path d="${path}" fill="#000"/></svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
