import { vibrar } from "./util.js";
import { avisar } from "./voz.js";
import { calibrando } from "./calibracao.js";
import { menuAberto } from "./controle-cabeca.js";

// Modo "só câmera": mira no canto inferior direito por 2 s esconde legenda e avatar; repetir volta tudo.
export let soCamera = false;
let cantoCameraDesde = 0;
let travaCamera = false;
function alternarSoCamera() {
  soCamera = !soCamera;
  document.body.classList.toggle("so-camera", soCamera);
  vibrar([60, 40, 60]);
  avisar(soCamera ? "Só câmera. Olhe ao canto inferior direito por 2 s para voltar." : "Legenda e avatar de volta.");
}
export function atualizarSoCamera(agora, mx, my) {
  const noCanto = mx > 80 && my > 80;
  if (!menuAberto && !calibrando && noCanto) {
    if (!cantoCameraDesde) cantoCameraDesde = agora;
    if (!travaCamera && agora - cantoCameraDesde > 2000) {
      travaCamera = true;
      alternarSoCamera();
    }
  } else {
    cantoCameraDesde = 0;
    if (!noCanto) travaCamera = false;
  }
}
