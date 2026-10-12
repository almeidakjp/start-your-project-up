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


/** Cria uma paleta indexada de 16 cores a partir do PNG antes de gravar pixels. */
export function importPngWithPalette(d: Uint8Array, pix: Tex, paletteTexture: Tex, img: ImageData) {
  if (img.width !== pix.width || img.height !== pix.height)
    throw new Error("PNG precisa ter as dimensões originais da textura");
  const frequency = new Map<string, { rgba: RGBA; count: number }>();
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3]!;
    const rgba: RGBA = a < 8 ? [0, 0, 0, 0] : [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!, a];
    const key = rgba.join(",");
    const item = frequency.get(key);
    if (item) item.count++;
    else frequency.set(key, { rgba, count: 1 });
  }
  // PNG indexado com ate 16 cores: preservar RGBA exato, sem quantizar.
  if (frequency.size <= 16) {
    const colors = [...frequency.values()].map(v => v.rgba);
    const transparent = colors.findIndex(c => c[3] === 0);
    if (transparent > 0) colors.unshift(...colors.splice(transparent, 1));
    const lookup = new Map(colors.map((c, i) => [c.join(","), i]));
    colors.forEach((color, i) => setPaletteColor(d, paletteTexture, i, color));
    for (let i = colors.length; i < 16; i++) setPaletteColor(d, paletteTexture, i, [0, 0, 0, 0]);
    const base = pix.offset + 0x80;
    for (let i = 0; i < pix.width * pix.height; i++) {
      const p = i * 4;
      const rgba: RGBA = img.data[p + 3]! < 8
        ? [0, 0, 0, 0]
        : [img.data[p]!, img.data[p + 1]!, img.data[p + 2]!, img.data[p + 3]!];
      const idx = lookup.get(rgba.join(","));
      if (idx === undefined) throw new Error("Cor nao encontrada na paleta.");
      const pos = base + (i >> 1), old = d[pos] ?? 0;
      d[pos] = i & 1 ? (old & 15) | (idx << 4) : (old & 240) | idx;
    }
    return;
  }
  const entries = [...frequency.values()].sort((a, b) => b.count - a.count);
  const hasTransparent = entries.some(e => e.rgba[3] === 0);
  const palette: RGBA[] = hasTransparent ? [[0, 0, 0, 0]] : [];
  for (const entry of entries) {
    if (entry.rgba[3] === 0) continue;
    if (palette.length >= 16) break;
    palette.push([...entry.rgba] as RGBA);
  }
  const start = hasTransparent ? 1 : 0;
  if (entries.length > 16) {
    for (let pass = 0; pass < 6; pass++) {
      const sums = palette.map(() => [0, 0, 0, 0, 0]);
      for (const entry of entries) {
        if (entry.rgba[3] === 0) continue;
        let best = start, distance = Infinity;
        for (let k = start; k < palette.length; k++) {
          const p = palette[k]!, c = entry.rgba;
          const delta = (p[0]-c[0])**2 + (p[1]-c[1])**2 + (p[2]-c[2])**2 + 2*(p[3]-c[3])**2;
          if (delta < distance) { distance = delta; best = k; }
        }
        for (let j = 0; j < 4; j++) sums[best]![j]! += entry.rgba[j]! * entry.count;
        sums[best]![4]! += entry.count;
      }
      for (let k = start; k < palette.length; k++) {
        const sum = sums[k]!;
        if (sum[4]!) palette[k]! = [0,1,2,3].map(j => Math.round(sum[j]! / sum[4]!)) as RGBA;
      }
    }
  }
  while (palette.length < 16) palette.push([0, 0, 0, 0]);
  palette.forEach((color, i) => setPaletteColor(d, paletteTexture, i, color));
  // fromImageData usa a paleta da textura de pixels; a paleta selecionada
  // pode estar em outra textura, então os índices são escritos aqui.
  const base = pix.offset + 0x80;
  for (let i = 0; i < pix.width * pix.height; i++) {
    const p = i * 4, a = img.data[p + 3]!;
    const c: RGBA = a < 8 ? [0,0,0,0] : [img.data[p]!,img.data[p+1]!,img.data[p+2]!,a];
    let best = 0, distance = Infinity;
    for (let k = 0; k < 16; k++) {
      const v = palette[k]!;
      const delta = (v[0]-c[0])**2+(v[1]-c[1])**2+(v[2]-c[2])**2+2*(v[3]-c[3])**2;
      if (delta < distance) { distance = delta; best = k; }
    }
    const pos = base + (i >> 1), old = d[pos] ?? 0;
    d[pos] = (i & 1) ? (old & 15) | (best << 4) : (old & 240) | best;
  }
}

/**
 * PES PSP: a paleta 3 (short) usa os mesmos indices do desenho principal.
 * Extrai a cor predominante dos pixels visiveis na metade direita do PNG
 * de PES PC e recolore somente os indices ja visiveis da paleta 3.
 * Nao altera pixels compartilhados, transparencias nem outras paletas.
 */
export function importShortColorOnly(d: Uint8Array, pix: Tex, paletteTexture: Tex, img: ImageData) {
  // PNG do short: recolorir a paleta 3, nunca os pixels 4bpp compartilhados.
  // Associar as cores por semelhanca RGB com a paleta atual, nao por frequencia
  // dos indices (isso trocava contornos dourados por preenchimento preto).
  const frequency = new Map<string, { rgb: [number, number, number]; count: number }>();
  for (let y = 0; y < img.height; y++) {
    for (let x = Math.floor(img.width / 2); x < img.width; x++) {
      const p = (y * img.width + x) * 4;
      if (img.data[p + 3]! < 128) continue;
      const rgb: [number, number, number] = [img.data[p]!, img.data[p + 1]!, img.data[p + 2]!];
      const key = rgb.join(",");
      const item = frequency.get(key);
      if (item) item.count++;
      else frequency.set(key, { rgb, count: 1 });
    }
  }
  if (!frequency.size) throw new Error("Nenhuma cor visivel encontrada na metade direita do PNG do short.");
  const candidates = [...frequency.values()];
  const current = getPalette(d, paletteTexture);
  const base = pix.offset + 0x80;
  const used = new Set<number>();
  for (let i = 0; i < pix.width * pix.height; i++) {
    used.add(((d[base + (i >> 1)] ?? 0) >> ((i & 1) * 4)) & 15);
  }
  const distance = (a: number[], b: number[]) =>
    (a[0]! - b[0]!) ** 2 + (a[1]! - b[1]!) ** 2 + (a[2]! - b[2]!) ** 2;
  // Os PNGs de camisa e short podem compartilhar cores exatas: manter a
  // correspondencia entre cada indice e sua cor, inclusive contornos.
  current.forEach((color, index) => {
    if (!used.has(index) || color[3] === 0) return;
    let best = candidates[0]!;
    let minDist = Infinity;
    for (const candidate of candidates) {
      const d2 = distance(color, candidate.rgb);
      if (d2 < minDist) { minDist = d2; best = candidate; }
    }
    setPaletteColor(d, paletteTexture, index, [
      best.rgb[0], best.rgb[1], best.rgb[2], color[3]
    ]);
  });
}
