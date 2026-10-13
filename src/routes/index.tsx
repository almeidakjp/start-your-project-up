import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  readBin, writeBin, getPalette, setPaletteColor, toImageData, importPngWithPalette, importShortColorOnly, importLettersMask,
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
  const [keepColors, setKeepColors] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);

  const pix = bin?.textures.find((t) => t.hasPixels);
  const palTex = bin?.textures[pal];

  useEffect(() => {
    if (!bin || !pix || !palTex || !canvas.current) return;
    const c = canvas.current; c.width = pix.width; c.height = pix.height;
    c.getContext("2d")!.putImageData(toImageData(bin.data, pix, palTex), 0, 0);
  }, [bin, pix, palTex, ver]);

  const open = async (f?: File) => {
    if (!f) return; setErr("");
    try { const b = await readBin(await f.arrayBuffer()); setBin(b); setName(f.name); setPal(b.textures.indexOf(b.textures.find((t) => t.hasPixels)!)); }
    catch (e) { setBin(null); setErr((e as Error).message); }
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
      // Reduzir com suavizacao: pular pixels gerava chuviscos nas letras.
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, pix.width, pix.height);
      try {
        const png = ctx.getImageData(0, 0, pix.width, pix.height);
        if (pix.height === 64 && !keepColors) {
          // Modo mascara: o jogo pinta com a cor do uniforme; gravar so forma e brilho.
          importLettersMask(bin.data, bin, pix, png);
        } else if (pix.height === 64) {
          // Manter as cores reais do PNG em todas as paletas.
          importPngWithPalette(bin.data, pix, palTex, png);
          const imported = getPalette(bin.data, palTex);
          bin.textures.forEach(texture => {
            imported.forEach((color, i) => setPaletteColor(bin.data, texture, i, [...color] as RGBA));
          });
        } else if (pal === 2) {
          // Experimento: em atlas completo, isolar os numeros pequenos antes
          // de reutilizar a rotina manual comprovada.
          const source = document.createElement("canvas");
          source.width = img.naturalWidth;
          source.height = img.naturalHeight;
          const sourceCtx = source.getContext("2d")!;
          sourceCtx.drawImage(img, 0, 0);
          const sourceData = sourceCtx.getImageData(0, 0, source.width, source.height);
          const w = source.width, h = source.height;
          let leftCount = 0, rightCount = 0;
          for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
            if (sourceData.data[(y * w + x) * 4 + 3]! < 128) continue;
            if (x < w * 0.55) leftCount++;
            if (x >= w * 0.65) rightCount++;
          }
          // Se o arquivo for somente do short, preservar o fluxo antigo.
          // Exigir proporcao de atlas conhecida; nao aplicar recorte a PNGs
          // de dimensoes inesperadas, que podem usar outro layout.
          const standardAtlas = w === pix.width * 2 && h === pix.height * 2;
          if (standardAtlas && leftCount > 100 && rightCount > 30) {
            // Localizar uma coluna de separacao com pouca tinta entre os grupos.
            let split = Math.round(w * 0.625), lowest = Infinity;
            for (let x = Math.round(w * 0.57); x <= Math.round(w * 0.68); x++) {
              let ink = 0;
              for (let y = 0; y < h; y++) {
                if (sourceData.data[(y * w + x) * 4 + 3]! >= 128) ink++;
              }
              if (ink < lowest) { lowest = ink; split = x; }
            }
            // Manter o atlas em suas coordenadas originais: apenas tornar
            // transparente a area da camisa, como no PNG manual do short.
            const isolated = document.createElement("canvas");
            isolated.width = w; isolated.height = h;
            const isolatedCtx = isolated.getContext("2d")!;
            isolatedCtx.drawImage(img, 0, 0);
            isolatedCtx.clearRect(0, 0, split, h);
            const reduced = document.createElement("canvas");
            reduced.width = pix.width; reduced.height = pix.height;
            const reducedCtx = reduced.getContext("2d")!;
            reducedCtx.imageSmoothingEnabled = false;
            reducedCtx.drawImage(isolated, 0, 0, pix.width, pix.height);
            importShortColorOnly(bin.data, pix, palTex,
              reducedCtx.getImageData(0, 0, pix.width, pix.height));
          } else {
            importShortColorOnly(bin.data, pix, palTex, png);
          }
        }
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
            <button onClick={exportPng} className="rounded-md bg-secondary py-3 text-sm font-semibold hover:bg-accent">Exportar PNG</button>
            <label className="cursor-pointer rounded-md bg-secondary py-3 text-center text-sm font-semibold hover:bg-accent">
              Importar PNG
              <input type="file" accept="image/png" className="hidden" onChange={(e) => importPng(e.target.files?.[0])} />
            </label>
            <button onClick={save} className="col-span-2 rounded-md bg-primary py-3 font-display text-2xl tracking-wide text-primary-foreground hover:opacity-90">
              Salvar .BIN
            </button>
          </section>
          {pix.height === 64 && (
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={keepColors} onChange={(e) => setKeepColors(e.target.checked)} />
              Manter as cores do PNG (desmarque para usar a cor do uniforme)
            </label>
          )}
          <p className="mt-3 text-xs text-muted-foreground">Dica: exporte o PNG, edite num app de desenho mantendo o tamanho, e importe de volta.</p>
        </>
      )}
    </main>
  );
}
