import { describe, expect, it } from "vitest";
import { letterIndex } from "@/lib/pes-bin";

describe("letterIndex (letras PES PSP)", () => {
  it("transparente vira indice 0", () => expect(letterIndex(255, 200, 100, 0)).toBe(0));
  it("preto opaco vira o cinza opaco mais escuro (11)", () => expect(letterIndex(0, 0, 0, 255)).toBe(11));
  it("branco opaco vira o mais claro (15)", () => expect(letterIndex(255, 255, 255, 255)).toBe(15));
  it("borda semitransparente usa indices 8-10", () => expect(letterIndex(0, 0, 0, 120)).toBe(9));
});
