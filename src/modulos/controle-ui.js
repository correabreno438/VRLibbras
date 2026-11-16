import { definirLegenda, definirVlibras, legendaAtiva, vlibrasAtivo } from "./preferencias.js";
import { definirTranscricao, transcricaoAtiva } from "./voz.js";

export const itensOlhar = [
  {
    icone: "🎤",
    rotulo: "Microfone",
    ligado: () => transcricaoAtiva,
    acionar: () => definirTranscricao(!transcricaoAtiva),
  },
  {
    icone: "💬",
    rotulo: "Legenda",
    ligado: () => legendaAtiva,
    acionar: () => definirLegenda(!legendaAtiva),
  },
  {
    icone: "🧏",
    rotulo: "VLibras",
    ligado: () => vlibrasAtivo,
    acionar: () => definirVlibras(!vlibrasAtivo),
  },
];

// O estilo fica aqui dentro (e não no index.html) para aparecer mesmo que o
// index.html esteja numa versão mais antiga.
const estiloOlhar = document.createElement("style");
estiloOlhar.id = "estilo-olhar";
estiloOlhar.textContent = `
  .olhar-camada { position: absolute; inset: 0; pointer-events: none; z-index: 15; }
  .olhar-lista {
    position: absolute; left: 0; top: 50%; transform: translateY(-50%);
    display: flex; flex-direction: column; gap: 10px;
    opacity: 0; visibility: hidden; transition: opacity 0.15s;
  }
  .olhar-camada.aberto .olhar-lista { opacity: 1; visibility: visible; }
  .olhar-item {
    display: flex; align-items: center; gap: 6px; color: #fff;
    font-family: system-ui, sans-serif; transition: transform 0.15s; transform-origin: left center;
  }
  .olhar-item.foco { transform: scale(1.12); }
  .olhar-anel {
    --p: 0;
    width: 40px; height: 40px; flex: none; border-radius: 50%; padding: 3px; box-sizing: border-box;
    background: conic-gradient(#FFD60A calc(var(--p) * 1%), rgba(255,255,255,0.3) 0);
  }
  .olhar-disco {
    width: 100%; height: 100%; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    background: rgba(20,20,26,0.85); font-size: 17px; line-height: 1;
  }
  .olhar-item.on .olhar-disco { background: rgba(20,120,100,0.95); }
  .olhar-item.flash .olhar-anel { animation: olhar-flash 0.6s ease-out; }
  @keyframes olhar-flash {
    0% { box-shadow: 0 0 0 0 rgba(255,214,10,0.95); }
    100% { box-shadow: 0 0 0 16px rgba(255,214,10,0); }
  }
  .olhar-dica {
    position: absolute; left: 14%; right: 14%; top: 14%; text-align: center; opacity: 0; transition: opacity 0.25s;
    color: #fff; font: 700 12px/1.25 system-ui, sans-serif; padding: 6px 10px; border-radius: 10px;
    background: rgba(0,0,0,0.65); text-shadow: 0 1px 3px #000;
  }
  .olhar-dica.visivel { opacity: 1; }
  body.so-camera .eye-legenda, body.so-camera .avatar-box { display: none !important; }
  .olhar-mira {
    position: absolute; left: 50%; top: 50%; width: 10px; height: 10px;
    margin: -5px 0 0 -5px; border-radius: 50%; box-sizing: border-box;
    background: rgba(255,255,255,0.9); border: 2px solid rgba(0,0,0,0.6);
  }
`;
document.head.appendChild(estiloOlhar);

export const camadasOlhar = Array.from(document.querySelectorAll(".eye")).map((olho) => {
  const camada = document.createElement("div");
  camada.className = "olhar-camada";
  camada.innerHTML =
    '<div class="olhar-lista">' +
    itensOlhar
      .map(
        (item) =>
          '<div class="olhar-item" title="' + item.rotulo + '" aria-label="' + item.rotulo + '"><div class="olhar-anel"><div class="olhar-disco">' + item.icone + "</div></div></div>"
      )
      .join("") +
    '</div><div class="olhar-dica"></div><div class="olhar-mira"></div>';
  olho.appendChild(camada);
  return {
    camada,
    itens: Array.from(camada.querySelectorAll(".olhar-item")),
    discos: Array.from(camada.querySelectorAll(".olhar-anel")),
    mira: camada.querySelector(".olhar-mira"),
    dica: camada.querySelector(".olhar-dica"),
  };
});
