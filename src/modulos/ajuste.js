import { estado } from "./estado.js";
import { parametrosUrl } from "./util.js";
import { aplicarOlhar } from "./controle-config.js";

// ---- Painel de ajuste (só com ?ajuste no endereço) ----------------------
function aplicarAjustes() {
  document.documentElement.style.setProperty("--zoom", String(estado.ajusteZoom));
  document.documentElement.style.setProperty("--sep", estado.ajusteSeparacao + "%");
  document.documentElement.style.setProperty("--desl", estado.ajusteDesloc + "%");
  try {
    localStorage.setItem("libras-vr:desloc", String(estado.ajusteDesloc));
    localStorage.setItem("libras-vr:zoom", String(estado.ajusteZoom));
    localStorage.setItem("libras-vr:separacao", String(estado.ajusteSeparacao));
    localStorage.setItem("libras-vr:sens", String(estado.ajusteSens));
    localStorage.setItem("libras-vr:tempo", String(estado.ajusteTempo));
  } catch (e) {}
  const rotulo = document.getElementById("ajuste-valores");
  if (rotulo) rotulo.textContent = "zoom " + estado.ajusteZoom.toFixed(2) + " · separação " + estado.ajusteSeparacao.toFixed(1) + "% · deslocar " + estado.ajusteDesloc.toFixed(1) + "% · sensibilidade " + estado.ajusteSens.toFixed(1) + " · espera " + (estado.ajusteTempo / 1000).toFixed(1) + "s";
}
if (parametrosUrl.has("ajuste")) {
  const painel = document.createElement("div");
  painel.id = "painel-ajuste";
  painel.innerHTML =
    '<button data-a="sep-">⟵ ⟶ afastar</button><button data-a="sep+">⟶ ⟵ aproximar</button>' +
    '<button data-a="desl-">◀ deslocar</button><button data-a="desl+">deslocar ▶</button>' +
    '<button data-a="zoom-">zoom −</button><button data-a="zoom+">zoom +</button>' +
    '<button data-a="sens-">mira − sensível</button><button data-a="sens+">mira + sensível</button>' +
    '<button data-a="tempo-">espera −</button><button data-a="tempo+">espera +</button>' +
    '<span id="ajuste-valores"></span>';
  document.body.appendChild(painel);
  painel.addEventListener("click", (e) => {
    const a = e.target.dataset && e.target.dataset.a;
    if (!a) return;
    if (a === "sep+") estado.ajusteSeparacao = Math.round((estado.ajusteSeparacao + 0.5) * 10) / 10;
    if (a === "sep-") estado.ajusteSeparacao = Math.round((estado.ajusteSeparacao - 0.5) * 10) / 10;
    if (a === "desl+") estado.ajusteDesloc = Math.round((estado.ajusteDesloc + 0.5) * 10) / 10;
    if (a === "desl-") estado.ajusteDesloc = Math.round((estado.ajusteDesloc - 0.5) * 10) / 10;
    if (a === "zoom+") estado.ajusteZoom = Math.round((estado.ajusteZoom + 0.05) * 100) / 100;
    if (a === "zoom-") estado.ajusteZoom = Math.max(1, Math.round((estado.ajusteZoom - 0.05) * 100) / 100);
    if (a === "sens+") estado.ajusteSens = Math.min(2, Math.round((estado.ajusteSens + 0.1) * 10) / 10);
    if (a === "sens-") estado.ajusteSens = Math.max(0.6, Math.round((estado.ajusteSens - 0.1) * 10) / 10);
    if (a === "tempo+") estado.ajusteTempo = Math.min(3000, estado.ajusteTempo + 200);
    if (a === "tempo-") estado.ajusteTempo = Math.max(600, estado.ajusteTempo - 200);
    aplicarOlhar();
    aplicarAjustes();
  });
  aplicarAjustes();
}
