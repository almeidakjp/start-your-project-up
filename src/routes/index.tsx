import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Kit Editor PES 2014 PSP" },
      { name: "description", content: "Crie e edite uniformes para PES 2014 PSP direto no celular e exporte em PNG." },
      { property: "og:title", content: "Kit Editor PES 2014 PSP" },
      { property: "og:description", content: "Crie uniformes para PES 2014 PSP e exporte em PNG." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

type Pattern = "liso" | "listras" | "faixa" | "diagonal" | "metade" | "aros";
type Kit = {
  id: string; team: string; base: string; second: string; detail: string;
  pattern: Pattern; name: string; number: string; numColor: string; badge?: string;
};

const W = 512, H = 256;
const defaultKit = (): Kit => ({
  id: crypto.randomUUID(), team: "Meu Time", base: "#ffffff", second: "#1a7f37",
  detail: "#111111", pattern: "listras", name: "SILVA", number: "10", numColor: "#111111",
});

function drawPattern(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, k: Kit) {
  c.fillStyle = k.base; c.fillRect(x, y, w, h);
  c.fillStyle = k.second;
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  if (k.pattern === "listras") for (let i = 0; i < w; i += w / 8) c.fillRect(x + i, y, w / 16, h);
  if (k.pattern === "aros") for (let i = 0; i < h; i += h / 6) c.fillRect(x, y + i, w, h / 12);
  if (k.pattern === "faixa") c.fillRect(x, y + h * 0.35, w, h * 0.2);
  if (k.pattern === "metade") c.fillRect(x + w / 2, y, w / 2, h);
  if (k.pattern === "diagonal") { c.beginPath(); c.moveTo(x, y + h * 0.2); c.lineTo(x + w, y + h * 0.75); c.lineTo(x + w, y + h); c.lineTo(x, y + h * 0.45); c.fill(); }
  c.restore();
}

function render(c: CanvasRenderingContext2D, k: Kit, badge: HTMLImageElement | null) {
  c.clearRect(0, 0, W, H);
  // Camisa frente (0-256 x 0-160), costas (256-512 x 0-160), shorts e meias embaixo
  drawPattern(c, 0, 0, 256, 160, k);
  drawPattern(c, 256, 0, 256, 160, k);
  // golas
  c.fillStyle = k.detail;
  c.fillRect(96, 0, 64, 10); c.fillRect(352, 0, 64, 8);
  // shorts
  c.fillStyle = k.detail; c.fillRect(0, 160, 384, 64);
  c.fillStyle = k.second; c.fillRect(0, 160, 384, 6);
  // meias
  c.fillStyle = k.base; c.fillRect(384, 160, 128, 96);
  c.fillStyle = k.second; c.fillRect(384, 180, 128, 12);
  c.fillStyle = k.detail; c.fillRect(0, 224, 384, 32);
  // escudo
  if (badge) c.drawImage(badge, 150, 30, 36, 36);
  // número frente
  c.fillStyle = k.numColor; c.textAlign = "center";
  c.font = "bold 28px Bebas Neue, sans-serif"; c.fillText(k.number, 80, 60);
  // nome e número costas
  c.font = "bold 22px Bebas Neue, sans-serif"; c.fillText(k.name.toUpperCase(), 384, 40);
  c.font = "bold 80px Bebas Neue, sans-serif"; c.fillText(k.number, 384, 120);
  // número shorts
  c.font = "bold 22px Bebas Neue, sans-serif"; c.fillStyle = k.base; c.fillText(k.number, 60, 200);
}

const patterns: Pattern[] = ["liso", "listras", "aros", "faixa", "diagonal", "metade"];

function Index() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [kit, setKit] = useState<Kit>(defaultKit);
  const [badge, setBadge] = useState<HTMLImageElement | null>(null);
  const [saved, setSaved] = useState<Kit[]>([]);

  useEffect(() => { setSaved(JSON.parse(localStorage.getItem("kits") || "[]")); }, []);
  useEffect(() => {
    if (!kit.badge) return setBadge(null);
    const img = new Image(); img.onload = () => setBadge(img); img.src = kit.badge;
  }, [kit.badge]);
  useEffect(() => {
    const c = canvas.current?.getContext("2d");
    if (c) document.fonts.ready.then(() => render(c, kit, badge));
  }, [kit, badge]);

  const set = <K extends keyof Kit>(key: K, v: Kit[K]) => setKit((k) => ({ ...k, [key]: v }));
  const persist = (list: Kit[]) => { setSaved(list); localStorage.setItem("kits", JSON.stringify(list)); };
  const save = () => persist([kit, ...saved.filter((s) => s.id !== kit.id)]);
  const download = () => {
    const a = document.createElement("a");
    a.href = canvas.current!.toDataURL("image/png");
    a.download = `${kit.team.replace(/\s+/g, "_")}_kit.png`; a.click();
  };
  const onBadge = (f?: File) => {
    if (!f) return; const r = new FileReader();
    r.onload = () => set("badge", r.result as string); r.readAsDataURL(f);
  };

  const Color = ({ label, k }: { label: string; k: "base" | "second" | "detail" | "numColor" }) => (
    <label className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
      <input type="color" value={kit[k]} onChange={(e) => set(k, e.target.value)}
        className="h-12 w-12 cursor-pointer rounded-md border-2 border-border bg-transparent" />
      {label}
    </label>
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-5">
        <h1 className="font-display text-5xl leading-none tracking-wide text-primary">Kit Editor</h1>
        <p className="text-sm text-muted-foreground">Uniformes para PES 2014 PSP</p>
      </header>

      <div className="rounded-xl border bg-card p-3">
        <canvas ref={canvas} width={W} height={H} className="w-full rounded-md bg-muted [image-rendering:pixelated]" />
        <div className="mt-2 grid grid-cols-2 text-center text-[10px] uppercase tracking-widest text-muted-foreground">
          <span>Frente</span><span>Costas</span>
        </div>
      </div>

      <section className="mt-5 space-y-5 rounded-xl border bg-card p-4">
        <input value={kit.team} onChange={(e) => set("team", e.target.value)} placeholder="Nome do time"
          className="w-full rounded-md border bg-input/30 px-3 py-2 font-display text-2xl tracking-wide outline-none focus:ring-2 focus:ring-ring" />

        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Cores</h2>
          <div className="flex justify-between">
            <Color label="Principal" k="base" /><Color label="Secundária" k="second" />
            <Color label="Detalhe" k="detail" /><Color label="Número" k="numColor" />
          </div>
        </div>

        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Modelo</h2>
          <div className="grid grid-cols-3 gap-2">
            {patterns.map((p) => (
              <button key={p} onClick={() => set("pattern", p)}
                className={`rounded-md border py-2 text-sm font-semibold capitalize transition ${kit.pattern === p ? "border-primary bg-primary text-primary-foreground" : "bg-secondary hover:bg-accent"}`}>
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <input value={kit.name} onChange={(e) => set("name", e.target.value.slice(0, 12))} placeholder="Nome"
            className="col-span-2 rounded-md border bg-input/30 px-3 py-2 uppercase outline-none focus:ring-2 focus:ring-ring" />
          <input value={kit.number} onChange={(e) => set("number", e.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="Nº"
            inputMode="numeric" className="rounded-md border bg-input/30 px-3 py-2 text-center outline-none focus:ring-2 focus:ring-ring" />
        </div>

        <label className="flex cursor-pointer items-center justify-center rounded-md border border-dashed py-3 text-sm text-muted-foreground hover:bg-accent">
          {kit.badge ? "Trocar escudo" : "Adicionar escudo (imagem)"}
          <input type="file" accept="image/*" className="hidden" onChange={(e) => onBadge(e.target.files?.[0])} />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <button onClick={save} className="rounded-md bg-secondary py-3 font-display text-xl tracking-wide hover:bg-accent">Salvar</button>
          <button onClick={download} className="rounded-md bg-primary py-3 font-display text-xl tracking-wide text-primary-foreground hover:opacity-90">Baixar PNG</button>
        </div>
      </section>

      {saved.length > 0 && (
        <section className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-display text-2xl tracking-wide">Meus kits</h2>
            <button onClick={() => setKit(defaultKit())} className="text-sm text-primary">+ Novo</button>
          </div>
          <ul className="space-y-2">
            {saved.map((s) => (
              <li key={s.id} className="flex items-center gap-3 rounded-lg border bg-card p-3">
                <span className="h-8 w-8 rounded-full border-2" style={{ background: `linear-gradient(90deg, ${s.base} 50%, ${s.second} 50%)` }} />
                <button onClick={() => setKit(s)} className="flex-1 text-left font-semibold">{s.team}</button>
                <button onClick={() => persist(saved.filter((x) => x.id !== s.id))} className="text-sm text-destructive">Excluir</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
