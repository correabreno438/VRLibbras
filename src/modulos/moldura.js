import { estado } from "./estado.js";
import { parametrosUrl } from "./util.js";

const quadroAltura = Number(parametrosUrl.get("quadro") ?? 92);
// Zoom da câmera e separação entre as duas imagens (para o encaixe nas lentes).
const lerNumeroSalvo = (nome, chave, padrao) => {
  if (parametrosUrl.has(nome)) {
    const v = Number(parametrosUrl.get(nome));
    if (Number.isFinite(v)) return v;
  }
  try {
    const salvo = localStorage.getItem(chave);
    if (salvo !== null && Number.isFinite(Number(salvo))) return Number(salvo);
  } catch (e) {}
  return padrao;
};
estado.ajusteZoom = lerNumeroSalvo("zoom", "libras-vr:zoom", 1.3);
estado.ajusteDesloc = lerNumeroSalvo("desloc", "libras-vr:desloc", 0);
estado.ajusteSeparacao = lerNumeroSalvo("separacao", "libras-vr:separacao", 1.5);
const quadroForma = Number(parametrosUrl.get("forma") ?? 1.08);
const avatarLado = parametrosUrl.get("avatar") === "esq" ? "esq" : "dir";
const legendaModo = ["cima", "baixo"].includes(parametrosUrl.get("legenda")) ? parametrosUrl.get("legenda") : "auto";
const legendaCima = legendaModo === "cima";
const legendaLinhas = Math.max(2, Math.min(8, Number(parametrosUrl.get("linhas")) || 4));
const avatarTam = Number(parametrosUrl.get("avatartam") ?? 42);
const avatarMargem = Number(parametrosUrl.get("avatarmargem") ?? 3);
const curvaBordas = Number(parametrosUrl.get("curva") ?? 4) / 100;
const margemUi = Number(parametrosUrl.get("margem") ?? 7);
if (parametrosUrl.has("debug")) document.body.classList.add("debug");

// Forma da moldura: cantos suaves e lados levemente abaulados.
const c0 = 0.05;
const cb = curvaBordas;
const caminhoMoldura =
  "M" + c0 + "," + c0 +
  " Q0.5," + -cb + " " + (1 - c0) + "," + c0 +
  " Q" + (1 + cb) + ",0.5 " + (1 - c0) + "," + (1 - c0) +
  " Q0.5," + (1 + cb) + " " + c0 + "," + (1 - c0) +
  " Q" + -cb + ",0.5 " + c0 + "," + c0 + " Z";
const svgMoldura = document.createElementNS("http://www.w3.org/2000/svg", "svg");
svgMoldura.setAttribute("width", "0");
svgMoldura.setAttribute("height", "0");
svgMoldura.style.position = "absolute";
svgMoldura.innerHTML =
  '<defs><clipPath id="forma-moldura" clipPathUnits="objectBoundingBox"><path d="' + caminhoMoldura + '"/></clipPath></defs>';
document.body.appendChild(svgMoldura);

const estiloTela = document.createElement("style");
estiloTela.id = "estilo-tela";
estiloTela.textContent = `
  :root { --mx: ${margemUi}%; --my: ${margemUi}%; --aw: 0px; --zoom: ${estado.ajusteZoom}; --sep: ${estado.ajusteSeparacao}%; --desl: ${estado.ajusteDesloc}%; }
  html, body { width: 100%; height: 100%; background: #000; }
  #stage { height: 100vh; height: 100dvh; width: 100vw; background: #000; }
  #stage.stereo #eyeLeft, #stage.stereo #eyeRight { width: 50%; border: 0; background: #000; }

  /* A imagem de cada olho: um quadro centralizado, com preto em volta */
  .moldura {
    position: absolute; top: 50%; left: 50%;
    height: ${quadroAltura}%; aspect-ratio: ${quadroForma} / 1; max-width: 98%;
    transform: translate(-50%, -50%);
    clip-path: url(#forma-moldura); -webkit-clip-path: url(#forma-moldura);
    overflow: hidden; background: #000;
  }
  #eyeLeft .moldura { left: calc(50% + var(--sep) + var(--desl)); }
  #eyeRight .moldura { left: calc(50% - var(--sep) + var(--desl)); }
  .moldura video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transform: scale(var(--zoom)); }
  #painel-ajuste {
    flex-wrap: wrap; justify-content: center; max-width: 96vw;
    position: fixed; z-index: 9999; left: 50%; bottom: 8px; transform: translateX(-50%);
    display: flex; gap: 6px; align-items: center; padding: 6px 10px; border-radius: 12px;
    background: rgba(0,0,0,0.8); color: #fff; font: 600 12px system-ui, sans-serif;
  }
  #painel-ajuste button { padding: 6px 10px; font-size: 14px; }

  /* Botões de toque, status de canto e barra única de legenda saem de cena:
     o controle é pela cabeça e tudo aparece dentro de cada olho. */
  body:not(.debug) #micBtn, body:not(.debug) #controls, body:not(.debug) #status { display: none !important; }
  #captionBar { display: none !important; }

  /* Tudo alinhado dentro da moldura */
  .moldura .olhar-camada { inset: var(--my) var(--mx); }
  .moldura .avatar-box canvas { filter: none; }
  .moldura .avatar-box {
    height: ${avatarTam}%; max-height: none; bottom: ${avatarMargem}%;
    ${avatarLado === "esq" ? "left: " + avatarMargem + "%; right: auto;" : "right: " + avatarMargem + "%; left: auto;"}
  }

  /* Legenda: fica ao lado do avatar (embaixo). Mostra as últimas linhas inteiras;
     conforme chegam palavras novas, as linhas antigas sobem e vão sumindo aos
     poucos no alto, sem cortar palavras no meio. */
  .eye-legenda {
    position: absolute; z-index: 20; pointer-events: none;
    left: var(--mx); right: var(--mx); ${legendaCima ? "top: 4%;" : "bottom: 4%;"}
    display: flex; justify-content: center;
  }
  body.avatar-espelhado:not(.vlibras-off) .eye-legenda {
    right: calc(${avatarMargem}% + var(--aw) * 0.72);
  }
  .eye-legenda span {
    display: block; max-width: 100%; padding: 6px 10px; border-radius: 10px;
    background: rgba(0,0,0,0.6); color: #FFD60A; text-align: center;
    font: 700 clamp(11px, 1.9vw, 17px)/1.25 system-ui, sans-serif;
    text-shadow: 0 0 4px rgba(0,0,0,0.95), 0 2px 6px rgba(0,0,0,0.9);
    overflow-wrap: normal; word-break: normal; hyphens: none;
  }
  .eye-legenda b {
    display: flex; flex-direction: column-reverse; overflow: hidden; font-weight: inherit;
    max-height: calc(1.25em * ${legendaLinhas});
  }
  .eye-legenda b.cortada {
    -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 1.3em);
    mask-image: linear-gradient(to bottom, transparent 0, #000 1.3em);
  }
  .eye-legenda i { display: block; font-style: normal; }
  .eye-legenda.vazia { display: none; }
  .eye-toque {
    position: absolute; z-index: 30; left: 50%; top: 50%; transform: translate(-50%, -50%);
    padding: 8px 14px; border-radius: 12px; background: rgba(0,0,0,0.7); color: #fff;
    font: 700 13px system-ui, sans-serif; text-align: center; pointer-events: none;
  }
  body.tela-cheia .eye-toque { display: none; }

  .eye-aviso {
    position: absolute; z-index: 22; pointer-events: none;
    left: var(--mx); right: var(--mx); top: 5%;
    text-align: center; color: #fff; font: 600 11px system-ui, sans-serif;
    text-shadow: 0 1px 3px #000; transition: opacity 0.4s;
  }
  .eye-aviso.oculto { opacity: 0; }
  .eye-aviso.erro { color: #ffb4a8; }
`;
document.head.appendChild(estiloTela);
