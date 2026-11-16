import { captionEl, statusEl } from "./elementos.js";
import { iniciarCalibracao } from "./calibracao.js";
import { olharSensorOk } from "./controle-cabeca.js";

const olhosUi = Array.from(document.querySelectorAll(".eye")).map((olho) => {
  const legenda = document.createElement("div");
  legenda.className = "eye-legenda vazia";
  legenda.innerHTML = "<span><b><i></i></b></span>";
  const aviso = document.createElement("div");
  aviso.className = "eye-aviso";
  const toque = document.createElement("div");
  toque.className = "eye-toque";
  toque.textContent = "Toque na tela uma vez\npara tela cheia";
  toque.style.whiteSpace = "pre-line";
  olho.appendChild(legenda);
  olho.appendChild(aviso);
  olho.appendChild(toque);

  // Coloca tudo (câmera, avatar, menu, legenda) dentro da moldura.
  const moldura = document.createElement("div");
  moldura.className = "moldura";
  while (olho.firstChild) moldura.appendChild(olho.firstChild);
  olho.appendChild(moldura);
  return { legenda, aviso };
});

// Copia a legenda para os dois olhos.
function espelharLegenda() {
  const texto = (captionEl.textContent || "").trim();
  const visivel = texto && !captionEl.classList.contains("hidden");
  olhosUi.forEach(({ legenda }) => {
    legenda.querySelector("i").textContent = texto;
    legenda.classList.toggle("vazia", !visivel);
  });
  // Se o texto passa do número de linhas, as de cima vão sumindo aos poucos.
  olhosUi.forEach(({ legenda }) => {
    const janela = legenda.querySelector("b");
    janela.classList.toggle("cortada", janela.scrollHeight > janela.clientHeight + 1);
  });
}
new MutationObserver(espelharLegenda).observe(captionEl, {
  childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["class"],
});
espelharLegenda();

// Mensagens de status (câmera, erros...) aparecem em cada olho e somem sozinhas.
let tempoAviso = 0;
function espelharStatus() {
  const texto = (statusEl.textContent || "").trim();
  olhosUi.forEach(({ aviso }) => {
    aviso.textContent = texto;
    aviso.classList.toggle("erro", statusEl.classList.contains("erro"));
    aviso.classList.remove("oculto");
  });
  clearTimeout(tempoAviso);
  tempoAviso = setTimeout(() => olhosUi.forEach(({ aviso }) => aviso.classList.add("oculto")), 4000);
}
new MutationObserver(espelharStatus).observe(statusEl, { childList: true, characterData: true, subtree: true });
espelharStatus();

// A legenda desvia do avatar: reserva a largura que ele ocupa.
const primeiroAvatar = document.querySelector(".avatar-box");
if (primeiroAvatar && "ResizeObserver" in window) {
  new ResizeObserver(() => {
    const largura = primeiroAvatar.offsetWidth;
    document.documentElement.style.setProperty("--aw", largura ? largura + 8 + "px" : "0px");
  }).observe(primeiroAvatar);
}

// Tamanho dos ícones do menu acompanha o tamanho da imagem (no celular a tela
// tem menos pixels CSS que no computador).
function ajustarEscala() {
  const m = document.querySelector(".moldura");
  if (!m) return;
  const e = Math.max(0.45, Math.min(1.2, m.clientHeight / 600));
  document.documentElement.style.setProperty("--e", e.toFixed(3));
}
ajustarEscala();
window.addEventListener("resize", ajustarEscala);

// Tela cheia (como o F11 do computador). O Chrome do Android só aceita depois de
// um TOQUE COMPLETO (soltar o dedo), por isso usamos "click" e tentamos de novo
// a cada toque até funcionar.
async function entrarTelaCheia() {
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    }
  } catch (e) {
    console.warn("[Tela cheia] recusada (tente tocar de novo):", e && e.message);
  }
  try {
    if (document.fullscreenElement && screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock("landscape");
    }
  } catch (e) {
    console.warn("[Orientação] não foi possível travar na horizontal:", e && e.message);
  }
  try {
    if (navigator.wakeLock) await navigator.wakeLock.request("screen");
  } catch (e) {
    console.warn("[Tela] não foi possível manter a tela acesa:", e && e.message);
  }
}
document.addEventListener("fullscreenchange", () => {
  document.body.classList.toggle("tela-cheia", !!document.fullscreenElement);
  if (document.fullscreenElement && olharSensorOk) iniciarCalibracao(); // acabou de colocar no suporte
  ajustarEscala();
});
window.addEventListener("click", entrarTelaCheia);
window.addEventListener("touchend", entrarTelaCheia);
