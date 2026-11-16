import { normalizar180, vibrar } from "./util.js";
import { avisar } from "./voz.js";
import { olharPitch, olharYaw } from "./controle-cabeca.js";

// Calibração do "em frente": com a cabeça parada olhando para frente, o centro é refeito.
export let calibrando = false;
let calibrarRefYaw = 0;
let calibrarRefPitch = 0;
let calibrarParadoDesde = 0;
let calibrarInicio = 0;
let calibrarAvisoEm = 0;
export function iniciarCalibracao() {
  calibrando = true;
  calibrarRefYaw = olharYaw;
  calibrarRefPitch = olharPitch;
  calibrarParadoDesde = performance.now();
  calibrarInicio = calibrarParadoDesde;
  calibrarAvisoEm = 0;
}

// Chamada a cada quadro. Devolve true enquanto a calibração está ativa
// (nesse caso o centro acompanha a cabeça, e a mira fica no meio).
export function atualizarCalibracao(agora, yaw, pitch) {
  if (!calibrando) return false;
  if (Math.abs(normalizar180(yaw - calibrarRefYaw)) > 2 || Math.abs(pitch - calibrarRefPitch) > 2) {
    calibrarRefYaw = yaw;
    calibrarRefPitch = pitch;
    calibrarParadoDesde = agora;
  } else if (agora - calibrarParadoDesde > 1500) {
    calibrando = false;
    vibrar([40, 70, 40]);
    avisar("Centro ajustado.");
  }
  if (calibrando && agora - calibrarInicio > 30000) {
    calibrando = false;
    avisar("Calibração cancelada. Tente de novo.");
  }
  if (calibrando && agora - calibrarAvisoEm > 3000) {
    calibrarAvisoEm = agora;
    avisar("Olhe para frente e fique parado um instante.");
  }
  return true;
}
