// Roda depois do "vite build": lista todos os arquivos da pasta dist em
// dist/lista-offline.json. O service worker usa essa lista para baixar o app
// inteiro (modelo de voz, avatar etc.) e assim funcionar sem internet.
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const RAIZ = "dist";
const IGNORAR = new Set(["sw.js", "lista-offline.json", "index.html"]);

function listar(pasta) {
  let saida = [];
  for (const nome of readdirSync(pasta)) {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) saida = saida.concat(listar(caminho));
    else saida.push(caminho);
  }
  return saida;
}

const arquivos = listar(RAIZ)
  .map((c) => ({ c, rel: relative(RAIZ, c).split(sep).join("/") }))
  .filter(({ rel }) => !IGNORAR.has(rel) && !rel.endsWith(".map"));

const bytes = arquivos.reduce((s, { c }) => s + statSync(c).size, 0);
const lista = arquivos.map(({ rel }) => rel.split("/").map(encodeURIComponent).join("/"));
writeFileSync(join(RAIZ, "lista-offline.json"), JSON.stringify({ gerado: new Date().toISOString(), arquivos: lista }));
console.log(`[offline] ${lista.length} arquivos, ${(bytes / 1024 / 1024).toFixed(1)} MB listados em dist/lista-offline.json`);
