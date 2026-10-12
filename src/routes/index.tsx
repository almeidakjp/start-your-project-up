import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  readBin, writeBin, getPalette, setPaletteColor, toImageData, importPngWithPalette, importShortColorOnly,
  type PesBin, type RGBA,
} from "@/lib/pes-bin";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Editor de .bin — Números e Letras PES 2014 PSP" },
      { name: "description", content: "Abra arquivos .bin de números e letras do PES 2014 PSP, troque cores e imagens e salve um novo .bin." },
      { property: "og:title", content: "Editor de .bin PES 2014 PSP" },
      { property: "og:description", content: "Edite números e letras dos uniformes do PES 2014 PSP pelo celular." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BinEditor,
});

const hex = (c: RGBA) => "#" + c.slice(0, 3).map((x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string, a: number): RGBA => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), a];

function BinEditor() {
  const [bin, setBin] = useState<PesBin | null>(null);
  const [name, setName] = useState("");
  const [pal, setPal] = useState(0);
  const [ver, setVer] = useState(0);
  const [err, setErr] = useState("");
  const [bg, setBg] = useState("#1f2a24");
  const canvas = useRef<HTMLCanvasElement>(null);
  const originalShortPalette = useRef<RGBA[] | null>(null);

  const pix = bin?.textures.find((t) => t.hasPixels);
  const palTex = bin?.textures[pal];

  useEffect(() => {
    if (!bin || !pix || !palTex || !canvas.current) return;
    const c = canvas.current; c.width = pix.width; c.height = pix.height;
    c.getContext("2d")!.putImageData(toImageData(bin.data, pix, palTex), 0, 0);
  }, [bin, pix, palTex, ver]);

  const open = async (f?: File) => {
    if (!f) return; setErr("");
    try { const b = await readBin(await f.arrayBuffer()); originalShortPalette.current = b.textures[2] ? getPalette(b.data, b.textures[2]).map(color => [...color] as RGBA) : null; setBin(b); setName(f.name); setPal(b.textures.indexOf(b.textures.find((t) => t.hasPixels)!)); }
    catch (e) { originalShortPalette.current = null; setBin(null); setErr((e as Error).message); }
  };

  const save = async () => {
    if (!bin) return;
    const out = await writeBin(bin);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([out as BlobPart]));
    a.download = name || "editado.bin"; a.click();
  };

  const exportPng = () => {
    const a = document.createElement("a");
    a.href = canvas.current!.toDataURL("image/png"); a.download = name + ".png"; a.click();
  };

  const importPng = (f?: File) => {
    if (!f || !bin || !pix || !palTex) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas"); c.width = pix.width; c.height = pix.height;
      const ctx = c.getContext("2d")!;
      // Reduzir artes 512x256 para 256x128 sem interpolacao, preservando pixels e contornos.
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, pix.width, pix.height);
      try {
        const png = ctx.getImageData(0, 0, pix.width, pix.height);
        if (pal === 2) importShortColorOnly(bin.data, pix, palTex, png);
        else {
          // Uma unica imagem e um unico conjunto de indices para as 3 paletas.
          // Copiar as 16 entradas tambem preserva a transparencia do PNG.
          importPngWithPalette(bin.data, pix, palTex, png);
          const imported = getPalette(bin.data, palTex);
          bin.textures.forEach(texture => {
            imported.forEach((color, i) =>
              setPaletteColor(bin.data, texture, i, [...color] as RGBA)
            );
          });
        }
        setErr("");
      } catch (e) { setErr((e as Error).message); return; }
      setVer((v) => v + 1);
    };
    img.onerror = () => setErr("Não foi possível abrir o PNG.");
    img.src = URL.createObjectURL(f);
  };

  const restoreShortColors = () => {
    if (!bin?.textures[2] || !originalShortPalette.current) return;
    const short = bin.textures[2];
    const current = getPalette(bin.data, short);
    originalShortPalette.current.forEach((color, i) => {
      // Restaurar somente RGB: nao tocar no desenho compartilhado nem na transparencia atual.
      setPaletteColor(bin.data, short, i, [color[0], color[1], color[2], current[i][3]]);
    });
    setPal(2);
    setErr("");
    setVer(v => v + 1);
  };

  const colors = bin && palTex ? getPalette(bin.data, palTex) : [];
  const setColor = (i: number, c: RGBA) => { setPaletteColor(bin!.data, palTex!, i, c); setVer((v) => v + 1); };

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="font-display text-5xl leading-none tracking-wide text-primary">Editor .BIN</h1>
          <p className="text-sm text-muted-foreground">Números e letras · PES 2014 PSP</p>
        </div>
        <Link to="/desenhar" className="text-sm text-primary underline-offset-4 hover:underline">Desenhar uniforme</Link>
      </header>

      <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed bg-card py-6 text-center hover:bg-accent">
        <span className="font-display text-2xl tracking-wide">{bin ? name : "Abrir arquivo .bin"}</span>
        <span className="text-xs text-muted-foreground">{bin ? "Toque para trocar" : "Ex.: ID01401 (números), ID01402 (letras)"}</span>
        <input type="file" className="hidden" onChange={(e) => open(e.target.files?.[0])} />
      </label>
      {err && <p className="mt-3 rounded-md bg-destructive/15 p-3 text-sm text-destructive">{err}</p>}

      {bin && pix && (
        <>
          <div className="mt-5 rounded-xl border bg-card p-3">
            <div className="rounded-md p-2" style={{ background: bg }}>
              <canvas ref={canvas} className="w-full [image-rendering:pixelated]" />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>{pix.width}×{pix.height} · 16 cores</span>
              <label className="flex items-center gap-2">Fundo
                <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} className="h-6 w-6 bg-transparent" />
              </label>
            </div>
          </div>

          {bin.textures.length > 1 && (
            <div className="mt-4 flex gap-2">
              {bin.textures.map((t, i) => (
                <button key={i} onClick={() => setPal(i)}
                  className={`flex-1 rounded-md border py-2 text-sm font-semibold ${pal === i ? "border-primary bg-primary text-primary-foreground" : "bg-secondary"}`}>
                  Paleta {i + 1}
                </button>
              ))}
            </div>
          )}

          <section className="mt-4 rounded-xl border bg-card p-4">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Cores da paleta</h2>
            <div className="grid grid-cols-8 gap-2">
              {colors.map((c, i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <input type="color" value={hex(c)} onChange={(e) => setColor(i, fromHex(e.target.value, c[3]))}
                    className="h-9 w-9 cursor-pointer rounded border bg-transparent" />
                  <input type="range" min={0} max={255} value={c[3]} onChange={(e) => setColor(i, [c[0], c[1], c[2], +e.target.value])}
                    className="w-9 accent-primary" title="Transparência" />
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">A barrinha embaixo de cada cor controla a transparência.</p>
          </section>

          <section className="mt-4 grid grid-cols-2 gap-2">
            <button onClick={restoreShortColors} disabled={!originalShortPalette.current} className="col-span-2 rounded-md border border-primary py-3 text-sm font-semibold hover:bg-accent disabled:opacity-50">Copiar cores originais do short (Paleta 3)</button>
            <button onClick={exportPng} className="rounded-md bg-secondary py-3 text-sm font-semibold hover:bg-accent">Exportar PNG</button>
            <label className="cursor-pointer rounded-md bg-secondary py-3 text-center text-sm font-semibold hover:bg-accent">
              Importar PNG
              <input type="file" accept="image/png" className="hidden" onChange={(e) => importPng(e.target.files?.[0])} />
            </label>
            <button onClick={save} className="col-span-2 rounded-md bg-primary py-3 font-display text-2xl tracking-wide text-primary-foreground hover:opacity-90">
              Salvar .BIN
            </button>
          </section>
          <p className="mt-3 text-xs text-muted-foreground">Dica: exporte o PNG, edite num app de desenho mantendo o tamanho, e importe de volta.</p>
        </>
      )}
    </main>
  );
}
