import { parametrosUrl, vibrar } from "./util.js";
import { calibrando } from "./calibracao.js";
import { menuAberto } from "./controle-cabeca.js";

// Tutorial da primeira abertura (feito só com a mira) e modo "só câmera".
const TUTORIAL_CHAVE = "libras-vr:tutorial-feito";
export const TEXTOS_TUTORIAL = {
  1: "Mova a cabeça: o ponto branco é a mira e acompanha você.",
  2: "Leve a mira ao canto esquerdo para abrir as opções.",
  3: "Segure a mira sobre uma opção até o anel encher.",
  4: "Muito bem! Volte a mira ao centro para fechar.",
  5: "Pronto! Dica: olhe ao canto inferior direito por 2 s para ver só a câmera.",
};
export let tutorialPasso = 0; // 0 = fora do tutorial
let tutorialAcionou = false;
let tutorialInicio = 0;
let tutorialFim = 0;
let tutorialJaIniciado = false;
let sensorOkEm = 0;
let calibradoUmaVez = false;
let calibrandoAntes = false;
function tutorialFeito() {
  try {
    return localStorage.getItem(TUTORIAL_CHAVE) === "1";
  } catch (e) {
    return false;
  }
}
function marcarTutorialFeito() {
  try {
    localStorage.setItem(TUTORIAL_CHAVE, "1");
  } catch (e) {}
}
// Toque na tela (ajudante) encerra o tutorial.
window.addEventListener("pointerdown", () => {
  if (tutorialPasso && performance.now() - tutorialInicio > 1500) {
    tutorialPasso = 0;
    marcarTutorialFeito();
  }
});
// Avisa o tutorial que uma opção foi acionada.
export function tutorialItemAcionado() {
  tutorialAcionou = true;
}
export function atualizarTutorial(agora, mx, my) {
  if (!sensorOkEm) sensorOkEm = agora;
  if (calibrandoAntes && !calibrando) calibradoUmaVez = true;
  calibrandoAntes = calibrando;
  if (!tutorialPasso && !tutorialJaIniciado && !calibrando && (parametrosUrl.has("tutorial") || !tutorialFeito()) && (calibradoUmaVez || agora - sensorOkEm > 20000)) {
    tutorialJaIniciado = true;
    tutorialPasso = 1;
    tutorialAcionou = false;
    tutorialInicio = agora;
    vibrar(20);
  }
  if (!tutorialPasso) return;
  if (agora - tutorialInicio > 180000) {
    tutorialPasso = 0;
    return;
  }
  if (tutorialPasso === 1 && Math.hypot(mx - 50, my - 50) > 18) {
    tutorialPasso = 2;
    vibrar(20);
  } else if (tutorialPasso === 2 && menuAberto) {
    tutorialPasso = 3;
    tutorialAcionou = false;
  } else if (tutorialPasso === 3) {
    if (!menuAberto) tutorialPasso = 2;
    else if (tutorialAcionou) tutorialPasso = 4;
  } else if (tutorialPasso === 4 && !menuAberto) {
    tutorialPasso = 5;
    tutorialFim = agora;
    marcarTutorialFeito();
  } else if (tutorialPasso === 5 && agora - tutorialFim > 6000) {
    tutorialPasso = 0;
  }
}
