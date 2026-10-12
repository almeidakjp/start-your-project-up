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
      ctx.imageSmoothingEnabled = false;
      try {
        // Detectar a faixa dos numeros grandes pela primeira linha, onde
        // os pequenos dos PNGs PES PC nao aparecem.
        const source = document.createElement("canvas");
        source.width = img.naturalWidth; source.height = img.naturalHeight;
        const sourceCtx = source.getContext("2d")!;
        sourceCtx.drawImage(img, 0, 0);
        const rgba = sourceCtx.getImageData(0, 0, source.width, source.height);
        const w = source.width, h = source.height;
        // Procurar uma faixa vertical realmente vazia entre os dois conjuntos.
        // Os numeros pequenos tambem podem ocupar a primeira linha; por isso
        // analisar apenas a linha superior causava falsos negativos.
        const column = new Uint32Array(w);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (rgba.data[(y * w + x) * 4 + 3] >= 128) column[x]++;
          }
        }
        let split = w;
        let hasShort = false;
        // A separacao correta e a PRIMEIRA faixa vazia depois dos
        // numeros grandes, nao a maior faixa (que pode ficar entre 01 e 56).
        const minX = Math.floor(w * 0.54), maxX = Math.floor(w * 0.72);
        for (let x = minX; x < maxX;) {
          if (column[x] !== 0) { x++; continue; }
          const first = x;
          while (x < maxX && column[x] === 0) x++;
          if (x - first < 2) continue;
          let leftCount = 0, rightCount = 0;
          for (let i = 0; i < w; i++) {
            if (i < first) leftCount += column[i];
            else if (i >= x) rightCount += column[i];
          }
          if (leftCount > 100 && rightCount > Math.max(20, w * h * 0.0003)) {
            split = x;
            hasShort = true;
            break;
          }
        }
        // Reduzir o atlas INTEIRO, mantendo as coordenadas originais.
        // Ex.: camisa x=8..315 em 512px vira x=4..157 em 256px.
        // Remover somente a area do short da textura compartilhada.
        ctx.clearRect(0, 0, pix.width, pix.height);
        ctx.drawImage(img, 0, 0, w, h, 0, 0, pix.width, pix.height);
        if (hasShort) {
          const shortStart = Math.ceil(split * pix.width / w);
          ctx.clearRect(shortStart, 0, pix.width - shortStart, pix.height);
        }
        const png = ctx.getImageData(0, 0, pix.width, pix.height);
        const makeShortPng = () => {
          const shortCanvas = document.createElement("canvas");
          shortCanvas.width = pix.width; shortCanvas.height = pix.height;
          const shortCtx = shortCanvas.getContext("2d")!;
          shortCtx.imageSmoothingEnabled = false;
          shortCtx.drawImage(img, split, 0, w - split, h,
            Math.floor(pix.width / 2), 0, Math.ceil(pix.width / 2), pix.height);
          return shortCtx.getImageData(0, 0, pix.width, pix.height);
        };
        if (pal === 2 && !hasShort) {
          // PNG separado na Paleta 3: preservar a importacao manual de cores.
          importShortColorOnly(bin.data, pix, palTex, hasShort ? makeShortPng() : png);
        } else {
          // PNG completo: importar sempre o desenho compartilhado, mesmo que
          // a Paleta 3 esteja selecionada na interface.
          importPngWithPalette(bin.data, pix, bin.textures[0], png);
          const imported = getPalette(bin.data, bin.textures[0]);
          bin.textures.forEach(texture => {
            imported.forEach((color, i) =>
              setPaletteColor(bin.data, texture, i, [...color] as RGBA)
            );
          });
          if (hasShort && bin.textures[2]) {
            importShortColorOnly(bin.data, pix, bin.textures[2], makeShortPng());
          }
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
          <p className="mt-3 text-xs text-muted-foreground">Dica: exporte o PNG, edite num app de desenho mantendo o tamanho, e importe de volta.</p>
        </>
      )}
    </main>
  );
}
