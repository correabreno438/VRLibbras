import { statusEl, videoLeft, videoRight } from "./elementos.js";

// ---------------------------------------------------------------
// 1) Câmera do celular (passthrough)
// ---------------------------------------------------------------
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    videoLeft.srcObject = stream;
    videoRight.srcObject = stream;
    statusEl.textContent = "Câmera ativa.";
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Não foi possível acessar a câmera: " + err.message;
  }
}

startCamera();
