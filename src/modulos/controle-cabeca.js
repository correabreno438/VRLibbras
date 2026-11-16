import { avisarErro, normalizar180, vibrar } from "./util.js";
import { avisar } from "./voz.js";
import { OLHAR } from "./controle-config.js";
import { TEXTOS_TUTORIAL, atualizarTutorial, tutorialItemAcionado, tutorialPasso } from "./tutorial.js";
import { atualizarSoCamera } from "./modo-camera.js";
import { atualizarCalibracao } from "./calibracao.js";
import { camadasOlhar, itensOlhar } from "./controle-ui.js";

let olharYawBruto = 0;
let olharPitchBruto = 0;
export let olharYaw = 0;
export let olharPitch = 0;
export let olharSensorOk = false;
export let textoSensor = "";

let centroYaw = 0; // para onde a pessoa olha "em frente"
let centroPitch = 0;
export let menuAberto = false;
let noCantoDesde = 0;
let abertoEm = 0;
let itemOlhado = -1;
let chaveOlhar = "";
let yawAnteriorMira = 0;
let pitchAnteriorMira = 0;
let quadroAnteriorMira = 0;
let paradoMiraDesde = 0;
let miraXAnterior = -1;
let miraYAnterior = -1;
let olhandoDesde = 0;
let travadoAteSair = false;

// Converte os ângulos do sensor em: para onde a pessoa olha (vertical e giro).
// Vale em qualquer posição do celular.
window.addEventListener("deviceorientation", (e) => {
  if (e.alpha == null || e.beta == null || e.gamma == null) return;
  const r = Math.PI / 180;
  const a = e.alpha * r;
  const b = e.beta * r;
  const g = e.gamma * r;
  const x = -Math.sin(g) * Math.cos(a) - Math.sin(b) * Math.cos(g) * Math.sin(a);
  const y = -Math.sin(g) * Math.sin(a) + Math.sin(b) * Math.cos(g) * Math.cos(a);
  const z = -Math.cos(b) * Math.cos(g);
  olharPitchBruto = (Math.asin(Math.max(-1, Math.min(1, z))) * 180) / Math.PI;
  olharYawBruto = (Math.atan2(x, y) * 180) / Math.PI;
  if (!olharSensorOk) {
    olharSensorOk = true;
    olharYaw = centroYaw = olharYawBruto;
    olharPitch = centroPitch = olharPitchBruto;
  }
});

// No iPhone o sensor precisa de permissão (no Android não).
window.addEventListener(
  "pointerdown",
  () => {
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
      DeviceOrientationEvent.requestPermission()
        .then((r) => {
          if (r !== "granted") avisarErro("Sensor de movimento negado: o controle com a cabeça não vai funcionar. Permita nas configurações do navegador.");
        })
        .catch(() => avisarErro("Não foi possível ativar o sensor de movimento."));
    }
  },
  { once: true }
);

function acionarItem(i) {
  tutorialItemAcionado();
  itensOlhar[i].acionar();
  vibrar(90);
  const ligado = itensOlhar[i].ligado();
  avisar(itensOlhar[i].mensagem ? itensOlhar[i].mensagem() : itensOlhar[i].rotulo + (ligado ? " ligado" : " desligado"));
  camadasOlhar.forEach(({ itens }) => {
    const el = itens[i];
    el.classList.remove("flash");
    void el.offsetWidth; // reinicia a animação
    el.classList.add("flash");
  });
}

// Qual opção está sob a mira? Usa a posição real dos ícones na tela.
function itemSobAMira(mx, my) {
  const { camada, discos } = camadasOlhar[0];
  const caixa = camada.getBoundingClientRect();
  if (!caixa.width) return -1;
  const px = caixa.left + (mx / 100) * caixa.width;
  const py = caixa.top + (my / 100) * caixa.height;
  for (let i = 0; i < discos.length; i++) {
    const r = discos[i].getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    // área sensível um pouco maior que o ícone (e que se estende para o texto)
    if (Math.abs(px - cx) < r.width * 1.1 && Math.abs(py - cy) < r.height * 0.75) return i;
  }
  return -1;
}

function atualizarOlhar(agora) {
  requestAnimationFrame(atualizarOlhar);
  if (!olharSensorOk) {
    textoSensor = "sensor de movimento: sem dados (toque na tela ou veja as permissões do navegador)";
    return;
  }

  // Suaviza o tremor da cabeça.
  olharYaw += normalizar180(olharYawBruto - olharYaw) * 0.3;
  olharPitch += (olharPitchBruto - olharPitch) * 0.3;

  // Posição da mira (% do olho): sai do centro conforme a cabeça se afasta do "em frente".
  // A mira é "elástica": nunca sai da imagem visível. Se a cabeça passa do
  // limite, a mira fica parada na borda e o "em frente" é puxado junto, então
  // para voltar basta mexer a cabeça de volta (sem precisar desfazer o excesso).
  // Calibrando: o centro acompanha a cabeça (a mira fica no meio) até ela ficar parada.
  if (atualizarCalibracao(agora, olharYaw, olharPitch)) {
    centroYaw = olharYaw;
    centroPitch = olharPitch;
  }
  const limiteX = ((50 - OLHAR.margemMira) / 50) * OLHAR.graus_horizontal;
  const limiteY = ((50 - OLHAR.margemMira) / 50) * OLHAR.graus_vertical;
  let dYaw = normalizar180(olharYaw - centroYaw);
  let dPitch = olharPitch - centroPitch;
  if (Math.abs(dYaw) > limiteX) {
    const preso = Math.sign(dYaw) * limiteX;
    centroYaw += dYaw - preso;
    dYaw = preso;
  }
  if (Math.abs(dPitch) > limiteY) {
    const preso = Math.sign(dPitch) * limiteY;
    centroPitch += dPitch - preso;
    dPitch = preso;
  }
  // Virar a cabeça para a esquerda leva a mira para a esquerda (e para cima, para cima).
  const mx = 50 + (dYaw / OLHAR.graus_horizontal) * 50;
  const my = 50 - (dPitch / OLHAR.graus_vertical) * 50;

  // ---- Abrir / fechar as opções
  if (!menuAberto) {
    if (mx < OLHAR.abrirAbaixoDeX) {
      if (!noCantoDesde) noCantoDesde = agora;
      if (agora - noCantoDesde > OLHAR.abrirSegurarMs) {
        menuAberto = true;
        abertoEm = agora;
        itemOlhado = -1;
        travadoAteSair = false;
        vibrar(25);
      }
    } else {
      noCantoDesde = 0;
    }
  } else if (mx > OLHAR.fecharAcimaDeX) {
    menuAberto = false;
    noCantoDesde = 0;
    itemOlhado = -1;
  }

  atualizarTutorial(agora, mx, my);
  atualizarSoCamera(agora, mx, my);

  // ---- Ligar/desligar: mira sobre a opção, esperando o anel encher
  let alvo = -1;
  let progresso = 0;
  if (menuAberto) {
    alvo = itemSobAMira(mx, my);
    if (alvo !== itemOlhado) {
      itemOlhado = alvo;
      olhandoDesde = agora;
      if (alvo === -1) travadoAteSair = false;
    }
    if (alvo !== -1 && !travadoAteSair && agora - abertoEm > OLHAR.esperaAposAbrirMs) {
      progresso = Math.min(1, (agora - olhandoDesde) / OLHAR.tempoParaAcionarMs);
      if (progresso >= 1) {
        acionarItem(alvo);
        travadoAteSair = true;
        progresso = 0;
      }
    }
  }

  // Cabeça parada com a mira perto do meio: o centro vai para onde a pessoa está
  // olhando, e a mira volta para o meio da imagem.
  const velocidadeCabeca = Math.hypot(normalizar180(olharYaw - yawAnteriorMira), olharPitch - pitchAnteriorMira) / Math.max(0.001, (agora - quadroAnteriorMira) / 1000);
  yawAnteriorMira = olharYaw;
  pitchAnteriorMira = olharPitch;
  quadroAnteriorMira = agora;
  if (velocidadeCabeca < 10) {
    if (!paradoMiraDesde) paradoMiraDesde = agora;
  } else paradoMiraDesde = 0;
  if (!menuAberto && paradoMiraDesde && agora - paradoMiraDesde > 500 && Math.abs(mx - 50) < 28 && Math.abs(my - 50) < 28) {
    centroYaw += dYaw * 0.05;
    centroPitch += dPitch * 0.05;
  }

  // O "em frente" acompanha devagar a postura da cabeça, mas só com as opções
  // fechadas (assim a mira não escapa enquanto a pessoa olha para o canto).
  if (!menuAberto && OLHAR.recentrar > 0) {
    centroYaw += normalizar180(olharYaw - centroYaw) * OLHAR.recentrar;
    centroPitch += (olharPitch - centroPitch) * OLHAR.recentrar;
  }

  const textoDica = tutorialPasso ? TEXTOS_TUTORIAL[tutorialPasso] : "";
  const chave = [tutorialPasso, menuAberto ? 1 : 0, alvo, Math.round(progresso * 50), itensOlhar.map((i) => (i.ligado() ? 1 : 0)).join("")].join("|");
  const miraMudou = Math.abs(mx - miraXAnterior) > 0.15 || Math.abs(my - miraYAnterior) > 0.15;
  if (miraMudou) {
    miraXAnterior = mx;
    miraYAnterior = my;
  }
  if (miraMudou || chave !== chaveOlhar) {
    chaveOlhar = chave;
    camadasOlhar.forEach(({ camada, itens, discos, mira, dica }) => {
      camada.classList.toggle("aberto", menuAberto);
      if (dica.textContent !== textoDica) dica.textContent = textoDica;
      dica.classList.toggle("visivel", !!textoDica);
      mira.style.left = mx.toFixed(1) + "%";
      mira.style.top = my.toFixed(1) + "%";
      itens.forEach((el, i) => {
        const ligado = itensOlhar[i].ligado();
        el.classList.toggle("foco", i === alvo);
        el.classList.toggle("on", ligado);
        discos[i].style.setProperty("--p", i === alvo ? (progresso * 100).toFixed(0) : 0);
      });
    });
  }

  textoSensor =
    "cabeça: vertical " + olharPitch.toFixed(0) + "° · giro " + dYaw.toFixed(0) + "° · mira " + mx.toFixed(0) + "%," +
    my.toFixed(0) + "% · opções " + (menuAberto ? "ABERTAS" : "fechadas") + " · olhando: " + (alvo === -1 ? "nada" : itensOlhar[alvo].rotulo);
}
requestAnimationFrame(atualizarOlhar);

// Se em 4 s nenhum movimento de cabeça chegou, o sensor está bloqueado ou não existe.
setTimeout(() => {
  if (typeof olharSensorOk !== "undefined" && !olharSensorOk) {
    avisarErro("Sem sinal do sensor de movimento: o controle com a cabeça não vai funcionar neste aparelho.", 12000);
  }
}, 4000);
