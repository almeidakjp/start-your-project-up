// PNG indexado (tipo 3): leitura dos indices sem conversao pelo canvas.
// Suporta PNG nao entrelacado de 1, 2, 4 ou 8 bits por pixel.
export type IndexedPng = { width: number; height: number; indices: Uint8Array; palette: [number, number, number, number][] };
export async function readIndexedPng(file: File): Promise<IndexedPng | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sig = [137,80,78,71,13,10,26,10];
  if (sig.some((v,i) => bytes[i] !== v)) return null;
  const view = new DataView(bytes.buffer);
  let pos = 8, width = 0, height = 0, depth = 0, type = 0, interlace = 0;
  let rgb: Uint8Array | null = null, alpha: Uint8Array | null = null;
  const chunks: Uint8Array[] = [];
  while (pos + 12 <= bytes.length) {
    const len = view.getUint32(pos); pos += 4;
    const name = String.fromCharCode(...bytes.slice(pos,pos+4)); pos += 4;
    if (pos + len + 4 > bytes.length) throw new Error("PNG truncado");
    const chunk = bytes.slice(pos,pos+len); pos += len + 4;
    if (name === "IHDR") {
      const dv = new DataView(chunk.buffer);
      width = dv.getUint32(0); height = dv.getUint32(4);
      depth = chunk[8]!; type = chunk[9]!; interlace = chunk[12]!;
    } else if (name === "PLTE") rgb = chunk;
    else if (name === "tRNS") alpha = chunk;
    else if (name === "IDAT") chunks.push(chunk);
    else if (name === "IEND") break;
  }
  if (type !== 3 || interlace !== 0 || ![1,2,4,8].includes(depth)) return null;
  if (!rgb || rgb.length % 3 || rgb.length > 768 || !chunks.length) throw new Error("PNG indexado invalido");
  const compressed = new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));
  let at=0; for(const c of chunks){compressed.set(c,at);at+=c.length;}
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate"));
  const raw = new Uint8Array(await new Response(stream).arrayBuffer());
  const stride = Math.ceil(width*depth/8), rowBytes = stride+1;
  if (raw.length !== rowBytes*height) throw new Error("Tamanho dos pixels PNG incorreto");
  const indices = new Uint8Array(width*height);
  let prev = new Uint8Array(stride);
  for(let y=0;y<height;y++){
    const offset=y*rowBytes, filter=raw[offset]!;
    const cur=new Uint8Array(stride);
    for(let x=0;x<stride;x++){
      const a=x ? cur[x-1]! : 0, b=prev[x]!, c=x ? prev[x-1]! : 0;
      let pred=0;
      if(filter===1)pred=a;
      else if(filter===2)pred=b;
      else if(filter===3)pred=Math.floor((a+b)/2);
      else if(filter===4){
        const p=a+b-c, pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);
        pred=pa<=pb&&pa<=pc?a:pb<=pc?b:c;
      } else if(filter!==0) throw new Error("Filtro PNG desconhecido");
      cur[x]=(raw[offset+1+x]!+pred)&255;
    }
    for(let x=0;x<width;x++){
      const bit=x*depth, v=cur[bit>>3]!;
      indices[y*width+x]=(v>>(8-depth-(bit&7)))&((1<<depth)-1);
    }
    prev=cur;
  }
  const palette: [number,number,number,number][]=[];
  for(let i=0;i<rgb.length/3;i++) palette.push([rgb[i*3]!,rgb[i*3+1]!,rgb[i*3+2]!,alpha?.[i]??255]);
  return {width,height,indices,palette};
}
