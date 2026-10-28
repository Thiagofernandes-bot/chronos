'use strict';

// Gera o icone do Chronos (PNG + ICO) desenhando direto nos pixels, com
// supersampling 4x4. Sem dependencia de biblioteca grafica.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');

const STOPS = [
  [0.00, [0x6d, 0x5b, 0xff]],
  [0.55, [0x9d, 0x7b, 0xff]],
  [1.00, [0x3a, 0xd6, 0xbe]]
];

function gradient(t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [p0, c0] = STOPS[i];
    const [p1, c1] = STOPS[i + 1];
    if (t >= p0 && t <= p1) {
      const f = (t - p0) / (p1 - p0);
      return [0, 1, 2].map((k) => Math.round(c0[k] + (c1[k] - c0[k]) * f));
    }
  }
  return STOPS[STOPS.length - 1][1];
}

// Campo de distancia do retangulo arredondado centrado em 0.5,0.5.
function insideRoundRect(x, y, r) {
  const qx = Math.abs(x - 0.5) - (0.5 - r);
  const qy = Math.abs(y - 0.5) - (0.5 - r);
  const d = Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
  return d <= 0;
}

function distToSegment(x, y, x1, y1, x2, y2) {
  const vx = x2 - x1, vy = y2 - y1;
  const wx = x - x1, wy = y - y1;
  const len2 = vx * vx + vy * vy;
  let t = len2 ? (wx * vx + wy * vy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (x1 + vx * t), y - (y1 + vy * t));
}

// Retorna [r,g,b,a] do ponto (coordenadas 0..1).
function shade(x, y) {
  if (!insideRoundRect(x, y, 0.235)) return null;

  const [r, g, b] = gradient((x * 0.65 + y * 0.35));

  const ringDist = Math.abs(Math.hypot(x - 0.5, y - 0.5) - 0.265);
  const onRing = ringDist <= 0.028;
  const onHandA = distToSegment(x, y, 0.5, 0.5, 0.5, 0.315) <= 0.026;
  const onHandB = distToSegment(x, y, 0.5, 0.5, 0.655, 0.575) <= 0.026;

  if (onRing || onHandA || onHandB) return [255, 255, 255, 255];
  return [r, g, b, 255];
}

function raster(size) {
  const px = Buffer.alloc(size * size * 4);
  const SS = 4;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let rs = 0, gs = 0, bs = 0, as = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (i + (sx + 0.5) / SS) / size;
          const y = (j + (sy + 0.5) / SS) / size;
          const c = shade(x, y);
          if (c) { rs += c[0]; gs += c[1]; bs += c[2]; as += 255; }
        }
      }
      const n = SS * SS;
      const o = (j * size + i) * 4;
      const a = as / n;
      // Divide pela cobertura real (nao pelo total de amostras) para a borda
      // nao escurecer: o PNG guarda cor nao pre-multiplicada.
      const k = as ? n / (as / 255) : 0;
      px[o] = Math.round((rs / n) * k);
      px[o + 1] = Math.round((gs / n) * k);
      px[o + 2] = Math.round((bs / n) * k);
      px[o + 3] = Math.round(a);
    }
  }
  return px;
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
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

function png(size) {
  const px = raster(size);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bits por canal
  ihdr[9] = 6;   // RGBA
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let j = 0; j < size; j++) {
    rows[j * (size * 4 + 1)] = 0; // filtro none
    px.copy(rows, j * (size * 4 + 1) + 1, j * size * 4, (j + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function ico(sizes) {
  const images = sizes.map((s) => ({ size: s, data: png(s) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = [];
  for (const img of images) {
    const e = Buffer.alloc(16);
    e[0] = img.size >= 256 ? 0 : img.size;
    e[1] = img.size >= 256 ? 0 : img.size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(img.data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += img.data.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'resources'), { recursive: true });

fs.writeFileSync(path.join(ROOT, 'resources', 'tray.png'), png(32));
fs.writeFileSync(path.join(ROOT, 'resources', 'icon.png'), png(512));
fs.writeFileSync(path.join(ROOT, 'build', 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256]));
console.log('icones gerados');
