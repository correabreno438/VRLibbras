import { statusEl } from "./elementos.js";
import { modeloVozPronto } from "./voz.js";

// ---------------------------------------------------------------
// 1.2) Status online/offline
// ---------------------------------------------------------------
// Com o Vosk, a voz roda local (WASM) e funciona igual online ou offline.
// Este aviso serve só para avisar que a 1ª vez que o modelo carrega,
// se ainda não estiver em cache, precisa baixar os arquivos do modelo.
function atualizarStatusConexao() {
  if (!navigator.onLine) {
    statusEl.classList.add("offline");
    statusEl.textContent = modeloVozPronto
      ? "Sem internet, mas o app continua funcionando normalmente."
      : "Sem internet: se o modelo de voz ainda não foi baixado antes, pode não carregar agora.";
  } else {
    statusEl.classList.remove("offline");
  }
}

window.addEventListener("online", atualizarStatusConexao);
window.addEventListener("offline", atualizarStatusConexao);
