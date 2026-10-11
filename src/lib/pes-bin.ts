// Leitor/gravador de arquivos .bin de texturas do PES 2014 PSP (números, letras).
// Formato: cabeçalho 32 bytes [0x00010600, tamComprimido, tamOriginal, ...] + zlib.
// Dentro: [qtd, 8, offsets...] e cada textura: magic 0x29857294, tamanho, largura/altura,
// paleta 16 cores RGBA em +0x40 e pixels 4bpp em +0x80 (sem swizzle).

export const TEX_MAGIC = 0x29857294;
export const BIN_MAGIC = 0x00010600;

export type Tex = { offset: number; width: number; height: number; hasPixels: boolean };
export type PesBin = { header: Uint8Array; data: Uint8Array; textures: Tex[] };

async function inflate(b: Uint8Array) {
  const s = new Blob([b as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function deflate(b: Uint8Array) {
  const s = new Blob([b as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

export function parseContainer(data: Uint8Array): Tex[] {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const n = v.getUint32(0, true);
  if (n < 1 || n > 256) throw new Error("Arquivo sem texturas reconhecidas");
  const out: Tex[] = [];
  for (let i = 0; i < n; i++) {
    const o = v.getUint32(8 + i * 4, true);
    if (o + 0x80 > data.length || v.getUint32(o, true) !== TEX_MAGIC) continue;
    const size = v.getUint32(o + 8, true);
    const width = v.getUint16(o + 0x14, true), height = v.getUint16(o + 0x16, true);
    out.push({ offset: o, width, height, hasPixels: size >= 0x80 + (width * height) / 2 });
  }
  if (!out.length) throw new Error("Nenhuma textura encontrada");
  return out;
}

export async function readBin(buf: ArrayBuffer): Promise<PesBin> {
  const u = new Uint8Array(buf);
  const v = new DataView(buf);
  if (v.getUint32(0, true) !== BIN_MAGIC) throw new Error("Não é um .bin do PES PSP");
  const csize = v.getUint32(4, true);
  if (u[0x20] !== 0x78) throw new Error("Este arquivo é criptografado (ex.: uniforme completo) e ainda não é suportado");
  const data = await inflate(u.slice(0x20, 0x20 + csize));
  return { header: u.slice(0, 0x20), data, textures: parseContainer(data) };
}

export async function writeBin(bin: PesBin): Promise<Uint8Array> {
  const comp = await deflate(bin.data);
  const out = new Uint8Array(0x20 + comp.length);
  out.set(bin.header);
  const v = new DataView(out.buffer);
  v.setUint32(4, comp.length, true);
  v.setUint32(8, bin.data.length, true);
  out.set(comp, 0x20);
  return out;
}

export type RGBA = [number, number, number, number];
export const getPalette = (d: Uint8Array, t: Tex): RGBA[] =>
  Array.from({ length: 16 }, (_, i) => {
    const p = t.offset + 0x40 + i * 4;
    return [d[p] ?? 0, d[p + 1] ?? 0, d[p + 2] ?? 0, d[p + 3] ?? 0];
  });
export const setPaletteColor = (d: Uint8Array, t: Tex, i: number, c: RGBA) => d.set(c, t.offset + 0x40 + i * 4);

/** Converte textura para RGBA usando a paleta de `palTex` (pixels sempre da textura principal). */
export function toImageData(d: Uint8Array, pix: Tex, palTex: Tex = pix) {
  const pal = getPalette(d, palTex);
  const { width: w, height: h } = pix;
  const img = new ImageData(w, h);
  const base = pix.offset + 0x80;
  for (let i = 0; i < w * h; i++) {
    const idx = ((d[base + (i >> 1)] ?? 0) >> ((i & 1) * 4)) & 15;
    img.data.set(pal[idx] ?? [0, 0, 0, 0], i * 4);
  }
  return img;
}

/** Substitui os pixels por uma imagem, usando a cor mais próxima da paleta atual. */
export function fromImageData(d: Uint8Array, t: Tex, img: ImageData) {
  const pal = getPalette(d, t);
  const base = t.offset + 0x80;
  for (let i = 0; i < t.width * t.height; i++) {
    const px = img.data;
    const r = px[i * 4] ?? 0, g = px[i * 4 + 1] ?? 0, b = px[i * 4 + 2] ?? 0, a = px[i * 4 + 3] ?? 0;
    let best = 0, bd = Infinity;
    pal.forEach((p, k) => {
      const dd = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2 + 2 * (p[3] - a) ** 2;
      if (dd < bd) { bd = dd; best = k; }
    });
    const pos = base + (i >> 1);
    const cur = d[pos] ?? 0;
    d[pos] = i & 1 ? (cur & 0x0f) | (best << 4) : (cur & 0xf0) | best;
  }
}
