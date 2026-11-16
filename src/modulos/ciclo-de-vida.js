import { audioContext } from "./voz.js";
import { iniciarCalibracao } from "./calibracao.js";
import { olharSensorOk } from "./controle-cabeca.js";

// App em segundo plano (tela bloqueada, outra aba): pausa o áudio e, ao voltar,
// retoma o áudio e pede de novo para a tela não apagar (o navegador solta isso ao esconder).
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (audioContext && audioContext.state === "running") audioContext.suspend().catch(() => {});
  } else {
    if (audioContext && audioContext.state === "suspended") audioContext.resume().catch(() => {});
    if (navigator.wakeLock) navigator.wakeLock.request("screen").catch(() => {});
    if (olharSensorOk) iniciarCalibracao(); // a postura pode ter mudado
  }
});
