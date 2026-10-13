import { describe, expect, it } from "vitest";
import { letterIndex } from "@/lib/pes-bin";

describe("letterIndex (letras PES PSP)", () => {
  it("transparente vira indice 0", () => expect(letterIndex(255, 200, 100, 0)).toBe(0));
  it("preto opaco vira o cinza opaco mais escuro (11)", () => expect(letterIndex(0, 0, 0, 255)).toBe(11));
  it("branco opaco vira o mais claro (15)", () => expect(letterIndex(255, 255, 255, 255)).toBe(15));
  it("borda semitransparente usa indices 8-10", () => expect(letterIndex(0, 0, 0, 120)).toBe(9));
});

import { importLettersColor } from "@/lib/pes-bin";

describe("importLettersColor", () => {
  it("so usa indices opacos 12-15 (o jogo fixa a opacidade por indice)", () => {
    const w = 16, h = 4;
    const d = new Uint8Array(0x80 + (w * h) / 2 + 16);
    const pix = { offset: 0, width: w, height: h, hasPixels: true };
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      // 12 cores diferentes + alguns transparentes
      data.set(i % 13 === 0 ? [0, 0, 0, 0] : [(i * 37) % 256, (i * 91) % 256, (i * 53) % 256, 255], i * 4);
    }
    importLettersColor(d, { textures: [pix] }, pix, { width: w, height: h, data } as unknown as ImageData);
    for (let i = 0; i < w * h; i++) {
      const idx = (d[0x80 + (i >> 1)]! >> ((i & 1) * 4)) & 15;
      if (i % 13 === 0) expect(idx).toBe(0);
      else expect(idx).toBeGreaterThanOrEqual(12);
    }
  });
});
