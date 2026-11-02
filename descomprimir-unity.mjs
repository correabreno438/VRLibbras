// Descomprime os arquivos do avatar do VLibras (.unityweb, formato Brotli).
// Assim o celular não gasta tempo descomprimindo na hora de abrir.
//
// Como usar (na pasta do projeto, onde fica o package.json):
//   node descomprimir-unity.mjs
//
// É seguro rodar mais de uma vez: arquivos já descomprimidos são ignorados.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const pasta = path.join(aqui, "public", "vlibras-app", "unity");

if (!fs.existsSync(pasta)) {
  console.error("Pasta não encontrada: " + pasta);
  console.error("Coloque este arquivo na raiz do projeto (ao lado do package.json) e extraia o vlibras-app.zip dentro de public/.");
  process.exit(1);
}

for (const nome of fs.readdirSync(pasta).filter((n) => n.endsWith(".unityweb"))) {
  const caminho = path.join(pasta, nome);
  const dados = fs.readFileSync(caminho);
  let saida;
  try {
    saida = zlib.brotliDecompressSync(dados);
  } catch {
    console.log("já descomprimido (ignorado): " + nome);
    continue;
  }
  fs.writeFileSync(caminho, saida);
  console.log("descomprimido: " + nome + " (" + (dados.length / 1e6).toFixed(1) + " MB -> " + (saida.length / 1e6).toFixed(1) + " MB)");
}
console.log("Pronto. Recarregue a página.");
