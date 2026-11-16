import { captionEl, toggleCaptionBtn, toggleVlibrasBtn } from "./elementos.js";
import { avisar } from "./voz.js";

// ---------------------------------------------------------------
// 1.1) Ativar/desativar Legenda e VLibras (independentes)
// ---------------------------------------------------------------
const PREF_CAPTION_KEY = "libras-vr:captionOn";
const PREF_VLIBRAS_KEY = "libras-vr:vlibrasOn";

function lerPreferencia(chave, padrao) {
  const valor = localStorage.getItem(chave);
  return valor === null ? padrao : valor === "true";
}

export let legendaAtiva = lerPreferencia(PREF_CAPTION_KEY, true);
export let vlibrasAtivo = lerPreferencia(PREF_VLIBRAS_KEY, true);

function aplicarEstadoLegenda() {
  captionEl.classList.toggle("hidden", !legendaAtiva);
  toggleCaptionBtn.classList.toggle("toggle-off", !legendaAtiva);
  toggleCaptionBtn.textContent = legendaAtiva ? "💬 Legenda" : "💬 Legenda (off)";
  localStorage.setItem(PREF_CAPTION_KEY, String(legendaAtiva));
}

function aplicarEstadoVlibras() {
  // O widget do governo cria o avatar (#vlibras-app-root) e o botão azul
  // (#vlibras-access-wrapper); a regra .vlibras-off no CSS esconde os dois.
  document.body.classList.toggle("vlibras-off", !vlibrasAtivo);
  toggleVlibrasBtn.classList.toggle("toggle-off", !vlibrasAtivo);
  toggleVlibrasBtn.textContent = vlibrasAtivo ? "🧏 VLibras" : "🧏 VLibras (off)";
  localStorage.setItem(PREF_VLIBRAS_KEY, String(vlibrasAtivo));
}

toggleCaptionBtn.addEventListener("click", () => {
  legendaAtiva = !legendaAtiva;
  aplicarEstadoLegenda();
});

toggleVlibrasBtn.addEventListener("click", () => {
  vlibrasAtivo = !vlibrasAtivo;
  aplicarEstadoVlibras();
});

aplicarEstadoLegenda();
aplicarEstadoVlibras();

export function definirLegenda(ativa) {
  legendaAtiva = ativa;
  aplicarEstadoLegenda();
  avisar(ativa ? "Legenda ativada." : "Legenda desativada.");
}

export function definirVlibras(ativo) {
  vlibrasAtivo = ativo;
  aplicarEstadoVlibras();
  avisar(ativo ? "VLibras ativado." : "VLibras desativado.");
}
