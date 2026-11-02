import { createModel } from "vosk-browser";

const statusEl = document.getElementById("status");
const captionEl = document.getElementById("captionBar");
const micBtn = document.getElementById("micBtn");
const fonteLibrasEl = document.getElementById("vlibras-fonte");
const stageEl = document.getElementById("stage");
const toggleCaptionBtn = document.getElementById("toggleCaptionBtn");
const toggleVlibrasBtn = document.getElementById("toggleVlibrasBtn");
const videoLeft = document.querySelector("#eyeLeft video");
const videoRight = document.querySelector("#eyeRight video");

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

// ---------------------------------------------------------------
// 1.1) Ativar/desativar Legenda e VLibras (independentes)
// ---------------------------------------------------------------
const PREF_CAPTION_KEY = "libras-vr:captionOn";
const PREF_VLIBRAS_KEY = "libras-vr:vlibrasOn";

function lerPreferencia(chave, padrao) {
  const valor = localStorage.getItem(chave);
  return valor === null ? padrao : valor === "true";
}

let legendaAtiva = lerPreferencia(PREF_CAPTION_KEY, true);
let vlibrasAtivo = lerPreferencia(PREF_VLIBRAS_KEY, true);

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

// Registra o service worker para o app (câmera, VLibras, interface e, após
// o primeiro carregamento, o próprio modelo de voz) continuar abrindo e
// funcionando mesmo sem internet.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("[SW] Não foi possível registrar o service worker:", err);
    });
  });
}

// ---------------------------------------------------------------
// 2) VLibras (widget oficial, hospedado dentro do próprio projeto)
// ---------------------------------------------------------------
// O widget oficial traduz quando a pessoa SELECIONA um texto e clica nele.
// Aqui fazemos isso por código, toda vez que a fala é reconhecida:
//   1) escreve a frase num elemento invisível (#vlibras-fonte);
//   2) seleciona esse texto (window.getSelection);
//   3) dispara um clique nele, que o widget interpreta como "traduzir".
//
// O widget fica em public/vlibras-app (cópia da pasta "app" do VLibras). Assim
// o avatar roda no mesmo endereço do projeto e a gente consegue copiar a
// imagem dele para as duas telas do modo VR (um site de outro endereço não
// deixaria). A tradução e o dicionário de sinais continuam vindo do governo,
// por isso o avatar ainda precisa de internet para sinalizar.
const VLIBRAS_PATH = "/vlibras-app";
// Velocidade do avatar: 1 = normal, 1.5 = rápido, 2 = bem rápido (intérprete
// experiente), 2.5 = máximo. Se ficar difícil de acompanhar, diminua.
window.VLIBRAS_VELOCIDADE = 2;
const ESPERA_BOAS_VINDAS_MS = 800; // pequena folga depois que o avatar carrega
const ESPERA_MAXIMA_AVATAR_MS = 20000; // se o aviso de "terminei" nunca chegar, segue em frente
const LIMITE_CARREGAR_MS = 40000; // se o avatar nunca avisar que carregou

let avatarCarregado = false;
let prontoEm = null; // quando o avatar ficou pronto para traduzir
let avatarTocando = false; // o avatar está sinalizando (ou carregando) agora
let avatarTocandoDesde = 0;
let enviadoEm = 0; // quando mandamos a última frase
let fila = []; // frases que chegaram enquanto o avatar ainda sinalizava
let ultimaFrase = "";
let ultimaFraseEm = 0;

function iniciarWidgetVlibras() {
  if (!window.VLibras || !window.VLibras.Widget) {
    console.warn("[VLibras] Widget não carregou (arquivos do vlibras-app ausentes?).");
    statusEl.textContent = "VLibras indisponível agora. A legenda continua.";
    return;
  }
  new window.VLibras.Widget(VLIBRAS_PATH);
  document.body.classList.add("avatar-espelhado"); // mostra já a caixa "Carregando…"
  garantirWidgetAberto();
  espelharAvatarNasTelas();
  limitarFpsDoAvatar();

  // Plano B: se o avatar nunca avisar que carregou, liberamos o envio mesmo assim.
  setTimeout(() => {
    if (!prontoEm) {
      console.warn("[VLibras] O avatar não avisou que carregou; liberando o envio mesmo assim.");
      avatarCarregado = true;
      marcarPronto();
    }
  }, LIMITE_CARREGAR_MS);
}

// Abre o painel do widget sozinho (sem clicar no ícone azul). Na primeira vez
// o painel ainda não existe e o pedido de abrir se perde, por isso repetimos
// a cada segundo até o painel (#vlibras-app-root) ficar ativo.
function garantirWidgetAberto() {
  let tentativas = 0;
  const timer = setInterval(() => {
    tentativas++;
    const raiz = document.getElementById("vlibras-app-root");
    if (raiz && raiz.dataset.active === "true") {
      clearInterval(timer);
      console.log("[VLibras] Painel do widget aberto.");
      return;
    }
    if (raiz) raiz.dataset.active = "true";
    else window.VLibrasWidget?.open?.();
    if (tentativas >= 240) {
      clearInterval(timer);
      console.warn("[VLibras] Não consegui abrir o painel do widget.");
    }
  }, 250);
}

function mostrarMensagemAvatar(texto) {
  document.querySelectorAll(".avatar-msg").forEach((el) => (el.textContent = texto));
}
mostrarMensagemAvatar("Carregando VLibras…");

// O avatar roda na mesma thread da página, e no celular ele "rouba" tanto
// processamento que o áudio do microfone atrasa (comandos demorando 10 s).
// Aqui limitamos os quadros por segundo dele: poucos quando está parado e
// normais só quando está sinalizando.
const FPS_AVATAR_PARADO = 8;
const FPS_AVATAR_SINALIZANDO = 60; // sinalizando: sem limite, para o movimento ficar fluido

function limitarFpsDoAvatar() {
  setInterval(() => {
    try {
      const win = acharIframeDoAvatar()?.contentWindow;
      if (!win || !win.requestAnimationFrame || win.requestAnimationFrame.__limitado) return;
      const original = win.requestAnimationFrame.bind(win);
      let ultimo = 0;
      const limitado = (cb) =>
        original((t) => {
          const fps = prontoEm && !avatarOcupado() ? FPS_AVATAR_PARADO : FPS_AVATAR_SINALIZANDO;
          const agora = performance.now();
          if (agora - ultimo < 1000 / fps - 4) {
            win.requestAnimationFrame(cb); // pula este quadro
            return;
          }
          ultimo = agora;
          cb(t);
          try {
            copiarQuadroDoAvatar(win);
          } catch {
            // ignora falhas pontuais na cópia
          }
        });
      limitado.__limitado = true;
      win.requestAnimationFrame = limitado;
      console.log("[VLibras] Limite de quadros do avatar ativado.");
    } catch (err) {
      // ainda não dá para acessar o avatar; tenta de novo
    }
  }, 500);
}

// O avatar (iframe do Unity) manda avisos para a página quando carrega.
window.addEventListener("message", (evento) => {
  const dados = evento.data;
  if (!dados || dados.type !== "unity_event") return;

  if (dados.event === "on_load_player") {
    console.log("[VLibras] Avatar carregado.");
    avatarCarregado = true;
    // Ele faz uma animação de boas-vindas ao carregar; esperamos ela acabar
    // (aviso finish_welcome) ou um tempo limite.
    setTimeout(marcarPronto, ESPERA_BOAS_VINDAS_MS);
  } else if (dados.event === "finish_welcome" && String(dados.data) === "True") {
    marcarPronto();
  } else if (dados.event === "update_progress") {
    const pct = Math.round(Number(dados.data) * 100);
    if (!avatarCarregado && !Number.isNaN(pct)) mostrarMensagemAvatar("Carregando VLibras… " + pct + "%");
  } else if (dados.event === "on_error") {
    mostrarMensagemAvatar("VLibras não funciona neste navegador");
  } else if (dados.event === "on_playing_state_change") {
    // data = [tocando, pausado, animandoIntervalo, carregando, repetivel]
    const [tocando, , , carregando] = (dados.data || []).map((v) => v === "True");
    avatarTocando = tocando || carregando;
    if (avatarTocando) avatarTocandoDesde = Date.now();
    else liberarFila();
  }
});

function marcarPronto() {
  if (prontoEm || !avatarCarregado) return;
  prontoEm = Date.now();
  document.body.classList.add("avatar-pronto");
  console.log("[VLibras] Pronto para traduzir.");
  liberarFila();
}

// ---- Espelha o avatar nas duas telas (modo VR) -----------------------
function acharIframeDoAvatar() {
  const pilha = [document];
  while (pilha.length) {
    const no = pilha.pop();
    const iframe = no.querySelector?.('iframe[src*="/unity/index.html"]');
    if (iframe) return iframe;
    no.querySelectorAll?.("*").forEach((el) => {
      if (el.shadowRoot) pilha.push(el.shadowRoot);
    });
  }
  return null;
}

// Copia a imagem do avatar para as duas telas. A cópia é feita logo depois
// que o avatar desenha cada quadro (dentro do gancho de quadros abaixo), que é
// o único momento em que o celular garante que a imagem ainda está lá; copiar
// em outra hora costuma dar tela branca.
const destinosAvatar = Array.from(document.querySelectorAll(".avatar-canvas"));
let canvasAvatar = null;
let ultimaCopiaEm = 0;
let copiasFeitas = 0;
let tamanhoOrigem = "?";
let pixelsAvatar = -1;
let segundosSemImagem = 0;

// Lê os pixels direto do WebGL (readPixels) em vez de drawImage: em alguns
// celulares o drawImage de um canvas WebGL sai vazio, mas a leitura direta
// funciona. O fundo do avatar fica transparente.
const quadroTemp = document.createElement("canvas");
let proporcaoAtual = "";
let glAvatar = null;
let bufPixels = null;
let imagemTemp = null;
let infoLeitura = "?";

// ---- Recorte do avatar: só o boneco, colado no canto ------------------
// O avatar vem num quadro largo, com o boneco no meio e muita área vazia ao
// redor. Guardamos o espaço que o boneco já ocupou (cresce quando ele abre os
// braços) e mostramos só essa região, para ele ficar bem no canto da tela.
let caixaAvatar = null;
function registrarCaixaDoAvatar(x0, y0, x1) {
  if (!caixaAvatar) caixaAvatar = { x0, y0, x1 };
  else {
    caixaAvatar.x0 = Math.min(caixaAvatar.x0, x0);
    caixaAvatar.y0 = Math.min(caixaAvatar.y0, y0);
    caixaAvatar.x1 = Math.max(caixaAvatar.x1, x1);
  }
}

function recorteDoAvatar(w, h) {
  if (!caixaAvatar) return { sx: 0, sy: 0, sw: w, sh: h };
  const largura = caixaAvatar.x1 - caixaAvatar.x0;
  const folgaLados = Math.round(largura * 0.3); // espaço para os braços se abrirem
  const sx = Math.max(0, caixaAvatar.x0 - folgaLados);
  const sx1 = Math.min(w, caixaAvatar.x1 + folgaLados);
  const sy = Math.max(0, caixaAvatar.y0 - Math.round(h * 0.03));
  return { sx, sy, sw: Math.max(1, sx1 - sx), sh: Math.max(1, h - sy) };
}

function lerQuadroWebGL(win) {
  // O contexto é guardado por unity/index.html em window.__glAvatar. Não
  // pedimos um contexto novo aqui: isso quebraria o avatar.
  glAvatar = win.__glAvatar || null;
  const gl = glAvatar;
  if (!gl) {
    infoLeitura = "sem gl";
    return null;
  }
  const w = gl.drawingBufferWidth;
  const h = gl.drawingBufferHeight;
  if (!w || !h) return null;
  if (!bufPixels || bufPixels.length !== w * h * 4) {
    bufPixels = new Uint8Array(w * h * 4);
    quadroTemp.width = w;
    quadroTemp.height = h;
    imagemTemp = new ImageData(w, h);
  }
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, bufPixels);

  const src = bufPixels;
  const dst = imagemTemp.data;
  let alfaMax = 0;
  let corMax = 0;
  for (let i = 0; i < src.length; i += 28) {
    if (src[i + 3] > alfaMax) alfaMax = src[i + 3];
    const m = Math.max(src[i], src[i + 1], src[i + 2]);
    if (m > corMax) corMax = m;
  }
  const semAlfa = alfaMax === 0;
  const atributos = gl.getContextAttributes() || {};
  const premultiplicado = atributos.premultipliedAlpha !== false;
  infoLeitura = "alfa " + alfaMax + " cor " + corMax + (premultiplicado ? " pm" : " reta");

  let caixaX0 = w;
  let caixaX1 = -1;
  let caixaY0 = h;
  let pontos = 0;
  for (let y = 0; y < h; y++) {
    const s = (h - 1 - y) * w * 4; // readPixels vem de cabeça para baixo
    const d = y * w * 4;
    for (let x = 0; x < w * 4; x += 4) {
      let r = src[s + x];
      let g = src[s + x + 1];
      let b = src[s + x + 2];
      const a = src[s + x + 3];
      let alfaSaida = a;
      if (semAlfa) {
        // O WebGL não entregou transparência: o preto vira branco opaco.
        alfaSaida = 255;
        if (r === 0 && g === 0 && b === 0) r = g = b = 255;
      } else if (premultiplicado && a > 0 && a < 255) {
        // ImageData espera cor "reta" (sem multiplicar pela transparência).
        r = Math.min(255, (r * 255) / a);
        g = Math.min(255, (g * 255) / a);
        b = Math.min(255, (b * 255) / a);
      }
      dst[d + x] = r;
      dst[d + x + 1] = g;
      dst[d + x + 2] = b;
      dst[d + x + 3] = alfaSaida;

      // Onde está o boneco (pixels que não são transparentes).
      if (alfaSaida > 40 && !semAlfa) {
        const px = x >> 2;
        if (px < caixaX0) caixaX0 = px;
        if (px > caixaX1) caixaX1 = px;
        if (y < caixaY0) caixaY0 = y;
        pontos++;
      }
    }
  }
  if (pontos > 300) registrarCaixaDoAvatar(caixaX0, caixaY0, caixaX1);
  quadroTemp.getContext("2d").putImageData(imagemTemp, 0, 0);
  return quadroTemp;
}

function copiarQuadroDoAvatar(win) {
  // Sinalizando: ~30 cópias/s (fluido). Parado: ~7 cópias/s (poupa o celular).
  if (performance.now() - ultimaCopiaEm < (avatarOcupado() ? 30 : 140)) return;
  if (!canvasAvatar || !canvasAvatar.isConnected) canvasAvatar = win.document.querySelector("canvas");
  const origem = canvasAvatar;
  if (!avatarCarregado || !origem || !origem.width || !origem.height) return;

  let fonte = null;
  try {
    fonte = lerQuadroWebGL(win);
  } catch (err) {
    infoLeitura = "erro " + err.message;
  }
  if (!fonte) fonte = origem; // plano B: drawImage

  const { sx, sy, sw, sh } = recorteDoAvatar(fonte.width, fonte.height);
  const largura = Math.min(sw, 360);
  const altura = Math.max(1, Math.round((sh * largura) / sw));
  destinosAvatar.forEach((destino) => {
    if (destino.width !== largura || destino.height !== altura) {
      destino.width = largura;
      destino.height = altura;
    }
    const ctx = destino.getContext("2d");
    ctx.clearRect(0, 0, largura, altura);
    ctx.drawImage(fonte, sx, sy, sw, sh, 0, 0, largura, altura);
  });
  const proporcao = (sw / sh).toFixed(3);
  if (proporcao !== proporcaoAtual) {
    proporcaoAtual = proporcao;
    document.documentElement.style.setProperty("--ar", proporcao);
  }
  ultimaCopiaEm = performance.now();
  copiasFeitas++;
  tamanhoOrigem = origem.width + "x" + origem.height;
}

// Conta quantos pontos da cópia não são brancos/transparentes. Se o avatar
// carregou mas a cópia continua só branca, o celular não está entregando a
// imagem; então mostramos o painel original do VLibras (modo direto), que
// aparece de qualquer jeito, em vez de ficar sem avatar.
function contarPixelsDoAvatar() {
  const c = destinosAvatar[0];
  if (!c || !c.width || !c.height) return -1;
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 16) {
    if (d[i + 3] > 40 && (d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235)) n++;
  }
  return n;
}

let segundosComImagem = 0;
setInterval(() => {
  if (!prontoEm || Date.now() - prontoEm < 4000) return;
  try {
    pixelsAvatar = contarPixelsDoAvatar();
  } catch {
    pixelsAvatar = -1;
  }
  const direto = document.body.classList.contains("avatar-direto");
  if (pixelsAvatar >= 20) {
    segundosSemImagem = 0;
    segundosComImagem++;
    // A cópia voltou a funcionar: sai do modo direto.
    if (direto && segundosComImagem >= 3) {
      document.body.classList.remove("avatar-direto");
      console.log("[VLibras] Cópia do avatar funcionando; saindo do modo direto.");
    }
  } else {
    segundosComImagem = 0;
    segundosSemImagem++;
    if (!direto && segundosSemImagem >= 4) {
      document.body.classList.add("avatar-direto");
      console.warn("[VLibras] A cópia do avatar ficou em branco; usando o painel original.");
    }
  }
}, 1000);

function espelharAvatarNasTelas() {
  // Plano B: se o gancho não estiver copiando, copia por tempo.
  setInterval(() => {
    if (performance.now() - ultimaCopiaEm < 700) return;
    try {
      const win = acharIframeDoAvatar()?.contentWindow;
      if (win) copiarQuadroDoAvatar(win);
    } catch {
      // avatar ainda não está acessível
    }
  }, 250);
}

// ---- Seleciona o texto sozinho e manda traduzir ----------------------
function selecionarEClicar(texto) {
  fonteLibrasEl.textContent = texto;

  const selecao = window.getSelection();
  selecao.removeAllRanges();
  const faixa = document.createRange();
  faixa.selectNodeContents(fonteLibrasEl);
  selecao.addRange(faixa);

  fonteLibrasEl.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
  );
  console.log("[VLibras] Texto selecionado e enviado ao widget:", texto);
}

// O avatar só começa uma frase nova quando termina a anterior; assim ele não
// corta o sinal no meio nem perde palavras. As frases que chegam enquanto ele
// sinaliza esperam numa fila e vão juntas, num único texto.
function avatarOcupado() {
  const agora = Date.now();
  if (agora - enviadoEm < 1800) return true; // acabamos de mandar, ele ainda vai começar
  return avatarTocando && agora - avatarTocandoDesde < ESPERA_MAXIMA_AVATAR_MS;
}

function liberarFila() {
  if (!fila.length || !prontoEm || avatarOcupado()) return;
  const texto = fila.join(" ");
  fila = [];
  enviarAgora(texto);
}
setInterval(liberarFila, 300);

function enviarAgora(texto) {
  ultimaFrase = texto;
  ultimaFraseEm = Date.now();
  enviadoEm = Date.now();
  selecionarEClicar(texto);
}

function enviarParaWidget(texto) {
  if (!vlibrasAtivo) return;
  if (!window.VLibras || !window.VLibras.Widget) return;

  // Evita traduzir duas vezes a mesma frase.
  const agora = Date.now();
  if (texto === ultimaFrase && agora - ultimaFraseEm < 4000) return;

  // Avatar ainda carregando ou sinalizando: entra na fila.
  if (!prontoEm || avatarOcupado()) {
    fila.push(texto);
    return;
  }
  enviarAgora(texto);
}

function traduzirParaLibras(texto) {
  if (!texto || !texto.trim()) return;
  enviarParaWidget(texto.trim());
}

iniciarWidgetVlibras();

// ---------------------------------------------------------------
// 3) Reconhecimento de voz OFFLINE (Vosk, roda via WebAssembly) da fala do professor
// ---------------------------------------------------------------
// Troca a Web Speech API (que precisa mandar o áudio pro Google) pelo
// Vosk, que roda local no navegador e funciona com ou sem internet.
//
// IMPORTANTE — passos manuais que você precisa fazer uma vez só:
// 1) `npm install vosk-browser`
// 2) Baixar o modelo em português pequeno (ex.: "vosk-model-small-pt-0.3")
//    em https://alphacephei.com/vosk/models
// 3) Colocar o arquivo .tar.gz dentro de `public/assets/vosk/`, mantendo
//    o nome igual ao de MODELO_URL abaixo (ou ajuste o caminho).
const MODELO_URL = "/assets/vosk/vosk-model-small-pt-0.3.tar.gz";
const TAXA_AMOSTRAGEM = 16000; // Vosk espera áudio em 16kHz mono

let modelo = null;
let reconhecedor = null;
let modeloVozPronto = false;
let isListening = false;

let audioContext = null;
let microfoneStream = null;
let processorNode = null;
let sourceNode = null;

let silenceTimer = null;
let ultimoParcial = "";
// Tempo de silêncio antes de "fechar" uma frase parcial e mandar pra
// legenda/VLibras. Reduzido para a legenda aparecer mais rápido, mantendo
// uma folga curta para não cortar o meio de uma frase.
const TEMPO_SILENCIO_MS = 1500;

// ---- Legenda: mostra as últimas frases + o que está sendo falado agora ----
// Antes cada parcial substituía a anterior e palavras já ditas sumiam. Agora
// as frases finalizadas ficam na tela (até uma pausa longa) e a parcial vem
// logo depois delas.
const LEGENDA_MAX_CARACTERES = 140;
const LEGENDA_LIMPAR_APOS_MS = 5000;
let legendaFixa = ""; // frases já finalizadas
let parcialJaEnviado = "";
let timerLimparLegenda = null;

function cortarNoInicio(texto) {
  if (texto.length <= LEGENDA_MAX_CARACTERES) return texto;
  const corte = texto.slice(texto.length - LEGENDA_MAX_CARACTERES);
  const espaco = corte.indexOf(" ");
  return "… " + (espaco >= 0 ? corte.slice(espaco + 1) : corte);
}

function mostrarLegenda(parcial) {
  clearTimeout(timerLimparLegenda);
  if (!legendaAtiva) return;
  captionEl.textContent = cortarNoInicio((legendaFixa + " " + (parcial || "")).trim());
}

function fixarNaLegenda(frase) {
  legendaFixa = cortarNoInicio((legendaFixa + " " + frase).trim());
  mostrarLegenda("");
  clearTimeout(timerLimparLegenda);
  timerLimparLegenda = setTimeout(() => {
    legendaFixa = "";
    if (transcricaoAtiva) captionEl.textContent = "";
  }, LEGENDA_LIMPAR_APOS_MS);
}

// Volume (RMS) de um bloco de áudio: usado para só enviar ao Vosk quando há voz.
function calcularNivel(amostras) {
  let soma = 0;
  for (let i = 0; i < amostras.length; i++) soma += amostras[i] * amostras[i];
  return Math.sqrt(soma / amostras.length);
}

// Estado do "microfone" (transcrição da fala do professor): começa DESATIVADO.
// Só depois de ligar o Microfone no menu (olhando para baixo) o que for falado
// vira legenda e sinais do VLibras.
let transcricaoAtiva = false;
let timerAviso = null;

const DICA_INICIAL = "Olhe para baixo para abrir o menu";

function avisar(mensagem, voltarPara) {
  statusEl.textContent = mensagem;
  clearTimeout(timerAviso);
  timerAviso = setTimeout(() => {
    statusEl.textContent = voltarPara ?? (transcricaoAtiva ? "Ouvindo..." : DICA_INICIAL);
  }, 3000);
}

function definirTranscricao(ativa) {
  transcricaoAtiva = ativa;
  micBtn.classList.toggle("listening", ativa);
  clearTimeout(silenceTimer);
  clearTimeout(timerLimparLegenda);
  ultimoParcial = "";
  legendaFixa = "";
  parcialJaEnviado = "";
  if (ativa) {
    captionEl.textContent = "";
    avisar("Microfone ativado. Pode falar.");
  } else {
    captionEl.textContent = DICA_INICIAL;
    avisar("Microfone desativado.");
  }
}

function definirLegenda(ativa) {
  legendaAtiva = ativa;
  aplicarEstadoLegenda();
  avisar(ativa ? "Legenda ativada." : "Legenda desativada.");
}

function definirVlibras(ativo) {
  vlibrasAtivo = ativo;
  aplicarEstadoVlibras();
  avisar(ativo ? "VLibras ativado." : "VLibras desativado.");
}

async function carregarModeloVoz() {
  try {
    statusEl.textContent = "Carregando modelo de voz (só demora na 1ª vez)...";
    modelo = await createModel(MODELO_URL);

    reconhecedor = new modelo.KaldiRecognizer(TAXA_AMOSTRAGEM);
    reconhecedor.setWords(false);

    reconhecedor.on("partialresult", (mensagem) => {
      blocosRespondidos++;
      const texto = mensagem.result.partial;
      if (!texto) return;
      if (!transcricaoAtiva) return;

      mostrarLegenda(texto);
      ultimoParcial = texto;

      // Normalmente o VLibras recebe a frase quando o Vosk a finaliza (evento
      // "result"). Este timer só cobre falas longas sem pausa.
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        if (ultimoParcial) {
          parcialJaEnviado = ultimoParcial;
          traduzirParaLibras(ultimoParcial);
          ultimoParcial = "";
        }
      }, TEMPO_SILENCIO_MS);
    });

    reconhecedor.on("result", (mensagem) => {
      blocosRespondidos++;
      const texto = mensagem.result.text;
      clearTimeout(silenceTimer);
      ultimoParcial = "";
      if (!texto) return;
      if (!transcricaoAtiva) return;

      // Se já mandamos o começo da frase, manda só o que faltou.
      let paraEnviar = texto;
      if (parcialJaEnviado && texto.startsWith(parcialJaEnviado)) {
        paraEnviar = texto.slice(parcialJaEnviado.length).trim();
      }
      parcialJaEnviado = "";

      fixarNaLegenda(texto);
      if (paraEnviar) traduzirParaLibras(paraEnviar);
    });

    modeloVozPronto = true;
    console.log("[Vosk] Modelo carregado.");
    // O microfone já fica pronto; o áudio só é analisado depois que a pessoa
    // liga o Microfone no menu.
    iniciarEscuta();
  } catch (err) {
    console.error("[Vosk] Falha ao carregar o modelo:", err);
    statusEl.textContent = navigator.onLine
      ? "Não foi possível carregar o modelo de voz: " + err.message
      : "Sem internet e o modelo de voz ainda não está salvo neste dispositivo.";
  }
}

// O avatar tem prioridade: o modelo de voz só começa a carregar depois que o
// avatar ficar pronto (ou após 20 s), para os dois não disputarem o celular.
{
  const inicio = Date.now();
  const esperar = setInterval(() => {
    const semAvatar = !window.VLibras || !window.VLibras.Widget;
    if (prontoEm || semAvatar || Date.now() - inicio > 20000) {
      clearInterval(esperar);
      carregarModeloVoz();
    }
  }, 200);
}

// ---- Envio de áudio ao Vosk, com controle de atraso ---------------------
// Cada bloco enviado gera exatamente uma resposta do Vosk. Se o celular não
// dá conta, as respostas atrasam e o atraso só cresce (comandos levando 10 s).
// Por isso contamos enviados x respondidos e, se acumular fila, descartamos
// áudio novo em vez de deixar a fila crescer.
const FILA_MAXIMA_BLOCOS = 3;
let blocosEnviados = 0;
let blocosRespondidos = 0;
let blocosDescartados = 0;
let taxaReal = 0;

function reamostrarPara16k(amostras, taxa) {
  const razao = taxa / TAXA_AMOSTRAGEM;
  const total = Math.floor(amostras.length / razao);
  const saida = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const ini = Math.floor(i * razao);
    const fim = Math.max(ini + 1, Math.min(amostras.length, Math.floor((i + 1) * razao)));
    let soma = 0;
    for (let j = ini; j < fim; j++) soma += amostras[j];
    saida[i] = soma / (fim - ini);
  }
  return saida;
}

function enviarAoVosk(amostras) {
  if (blocosEnviados - blocosRespondidos > FILA_MAXIMA_BLOCOS) {
    blocosDescartados++;
    return;
  }
  // Se o celular não aceitou 16 kHz, convertemos aqui. Sem isso o Vosk recria
  // o reconhecedor a cada bloco, o que é lentíssimo.
  const dados = taxaReal === TAXA_AMOSTRAGEM ? amostras : reamostrarPara16k(amostras, taxaReal);
  reconhecedor.acceptWaveformFloat(dados, TAXA_AMOSTRAGEM);
  blocosEnviados++;
}

const diagEl = document.getElementById("diag");
// A linha de diagnóstico só aparece com ?debug no endereço (ex.: https://IP:5173/?debug)
diagEl.style.display = location.search.includes("debug") ? "block" : "none";
setInterval(() => {
  const voz = isListening
    ? "áudio " + taxaReal + " Hz · fila " + (blocosEnviados - blocosRespondidos) + " · perdidos " + blocosDescartados
    : "";
  const avatar =
    "avatar " + tamanhoOrigem + " · cópias " + copiasFeitas + " · pontos " + pixelsAvatar +
    " · gl[" + infoLeitura + "]" +
    (document.body.classList.contains("avatar-direto") ? " · MODO DIRETO" : "");
  diagEl.textContent = voz + "\n" + avatar + "\n" + textoSensor;
}, 500);

async function iniciarEscuta() {
  if (!modeloVozPronto || isListening) return;

  try {
    microfoneStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: TAXA_AMOSTRAGEM,
        // Os filtros do navegador (cancelamento de eco e supressão de ruído)
        // costumam "comer" o começo e o fim das palavras e atrapalham o Vosk.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
      },
    });

    // Força 16kHz, que é o que o Vosk espera. Sem isso o navegador usa 48kHz e
    // o Vosk fica recriando o reconhecedor a cada trecho (lento e impreciso).
    audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: TAXA_AMOSTRAGEM,
    });
    sourceNode = audioContext.createMediaStreamSource(microfoneStream);
    // ScriptProcessorNode está deprecated, mas é o que o vosk-browser usa
    // hoje para receber o áudio quadro a quadro; funciona bem para o MVP.
    processorNode = audioContext.createScriptProcessor(4096, 1, 1);

    // Só manda áudio ao reconhecedor quando há voz (e um pouco depois, para ele
    // fechar a frase). Em silêncio o celular fica livre.
    const LIMIAR_VOZ = 0.006;
    const FOLGA_APOS_VOZ_MS = 1200;
    let ultimaVozEm = 0;
    let estavaEnviando = false;
    const antes = []; // últimos blocos, para não cortar o começo da fala
    taxaReal = audioContext.sampleRate;

    processorNode.onaudioprocess = (event) => {
      const amostras = event.inputBuffer.getChannelData(0);
      if (!reconhecedor) return;
      if (!transcricaoAtiva) {
        // Microfone desligado no menu: não analisa nada (poupa o celular).
        estavaEnviando = false;
        antes.length = 0;
        return;
      }
      const rms = calcularNivel(amostras);

      const agora = performance.now();
      if (rms > LIMIAR_VOZ) ultimaVozEm = agora;
      const enviando = agora - ultimaVozEm < FOLGA_APOS_VOZ_MS;

      if (enviando) {
        if (!estavaEnviando) {
          antes.forEach((b) => enviarAoVosk(b));
          antes.length = 0;
        }
        enviarAoVosk(amostras);
      } else {
        antes.push(amostras.slice());
        if (antes.length > 3) antes.shift();
      }
      estavaEnviando = enviando;
    };

    sourceNode.connect(processorNode);
    processorNode.connect(audioContext.destination);

    isListening = true;
    captionEl.textContent = transcricaoAtiva ? "" : DICA_INICIAL;
    statusEl.textContent = transcricaoAtiva ? "Ouvindo..." : DICA_INICIAL;

    // Navegadores só liberam o áudio depois de um toque/clique na página.
    if (audioContext.state === "suspended") {
      statusEl.textContent = "Toque uma vez na tela para liberar o microfone.";
    }
  } catch (err) {
    console.error("[Vosk] Falha ao iniciar microfone:", err);
    statusEl.textContent = "Erro ao iniciar microfone: " + err.message;
  }
}

// Primeiro toque/clique/tecla: libera o áudio (política dos navegadores).
function liberarAudio() {
  if (audioContext && audioContext.state === "suspended") {
    audioContext.resume().then(() => {
      statusEl.textContent = transcricaoAtiva ? "Ouvindo..." : DICA_INICIAL;
    });
  }
}
["pointerdown", "touchstart", "keydown", "click"].forEach((nome) =>
  window.addEventListener(nome, liberarAudio, { capture: true })
);

// ---------------------------------------------------------------
// 4) Botão de microfone (alternativa ao menu por movimentos de cabeça)
// ---------------------------------------------------------------
micBtn.addEventListener("click", async () => {
  if (!isListening) await iniciarEscuta();
  liberarAudio();
  definirTranscricao(!transcricaoAtiva);
});

// ---------------------------------------------------------------
// 5) Menu por movimentos de cabeça (sem tocar no celular, sem falar)
// ---------------------------------------------------------------
// Como usar:
//   1) OLHE PARA BAIXO: aparecem, no centro das duas telas, os ícones
//      Microfone, Legenda e VLibras.
//   2) VIRE ou INCLINE a cabeça para a direita ou para a esquerda: a seleção
//      (borda amarela) passa para o ícone do lado. Um movimento = um ícone;
//      volte ao centro para poder fazer outro.
//   3) OLHE PARA CIMA (acima da linha do horizonte) e segure um instante:
//      liga ou desliga a opção selecionada. Só voltar a olhar para a frente
//      NÃO aciona nada.
// Se a pessoa ficar uns 3 segundos sem se mexer, os ícones somem sozinhos.
// Usa o giroscópio do celular (funciona offline).
const OLHAR = {
  abrirAbaixoDe: -15, // graus: olhar abaixo disso abre o menu
  reabrirAcimaDe: -8, // depois de fechar, só abre de novo após a cabeça subir disso
  girarParaTrocar: 9, // graus de giro (virar a cabeça) para passar de ícone
  inclinarParaTrocar: 12, // graus de inclinação (orelha no ombro) para passar de ícone
  voltarAoCentro: 0.45, // fração do movimento: abaixo disso conta como "voltou ao centro"
  pausaEntrePassosMs: 450, // tempo mínimo entre uma troca de ícone e outra
  olharParaCimaAcima: 12, // graus ACIMA do horizonte para ligar/desligar
  segurarParaCimaMs: 300, // quanto tempo segurar olhando para cima
  rearmarAbaixoDe: 4, // depois de acionar, precisa baixar a cabeça até aqui para poder acionar de novo
  tempoMinimoAbertoMs: 500, // evita acionar logo que o menu abre
  movimentoMinimo: 3.5, // graus que contam como "se mexeu" (para o menu não sumir)
  tempoSemMovimentoMs: 2800, // sem se mexer por esse tempo, o menu some
};

const itensOlhar = [
  {
    icone: "🎤",
    rotulo: "Microfone",
    ligado: () => transcricaoAtiva,
    acionar: () => definirTranscricao(!transcricaoAtiva),
  },
  {
    icone: "💬",
    rotulo: "Legenda",
    ligado: () => legendaAtiva,
    acionar: () => definirLegenda(!legendaAtiva),
  },
  {
    icone: "🧏",
    rotulo: "VLibras",
    ligado: () => vlibrasAtivo,
    acionar: () => definirVlibras(!vlibrasAtivo),
  },
];

// O estilo do menu fica aqui dentro (e não no index.html) para o menu aparecer
// mesmo que o index.html esteja numa versão mais antiga.
const estiloOlhar = document.createElement("style");
estiloOlhar.id = "estilo-olhar";
estiloOlhar.textContent = `
  .olhar-camada { position: absolute; inset: 0; pointer-events: none; z-index: 15; }
  .olhar-dica {
    position: absolute; bottom: 6px; left: 50%; transform: translateX(-50%);
    color: rgba(255,255,255,0.75); font: 600 11px system-ui, sans-serif;
    text-shadow: 0 1px 3px #000; white-space: nowrap; transition: opacity 0.2s;
  }
  .olhar-camada.aberto .olhar-dica { opacity: 0; }
  .olhar-menu {
    position: absolute; left: 50%; top: 50%; transform: translate(-50%, -58%);
    display: flex; gap: 16px; align-items: flex-start;
    opacity: 0; visibility: hidden; transition: opacity 0.2s;
  }
  .olhar-camada.aberto .olhar-menu { opacity: 1; visibility: visible; }
  .olhar-item {
    width: 76px; display: flex; flex-direction: column; align-items: center;
    transition: transform 0.15s; color: #fff; font-family: system-ui, sans-serif;
  }
  .olhar-item.sel { transform: scale(1.2); }
  .olhar-disco {
    width: 76px; height: 76px; border-radius: 50%;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: rgba(20,20,26,0.8); border: 3px solid rgba(255,255,255,0.3);
  }
  .olhar-item.on .olhar-disco { background: rgba(20,120,100,0.9); }
  .olhar-item.sel .olhar-disco { border-color: #FFD60A; }
  .olhar-icone { font-size: 26px; line-height: 1; }
  .olhar-rotulo { font-size: 9px; font-weight: 700; margin-top: 2px; }
  .olhar-estado { margin-top: 7px; font-size: 11px; font-weight: 700; text-shadow: 0 1px 3px #000; }
  .olhar-item.flash .olhar-disco { animation: olhar-flash 0.6s ease-out; }
  @keyframes olhar-flash {
    0% { box-shadow: 0 0 0 0 rgba(255,214,10,0.95); }
    100% { box-shadow: 0 0 0 26px rgba(255,214,10,0); }
  }
  .olhar-ajuda {
    position: absolute; left: 50%; top: calc(50% + 84px); transform: translateX(-50%);
    color: #fff; font: 600 10px system-ui, sans-serif; white-space: nowrap;
    text-shadow: 0 1px 3px #000; opacity: 0; transition: opacity 0.2s;
  }
  .olhar-camada.aberto .olhar-ajuda { opacity: 0.9; }
  /* Barra "olhe para cima": enche conforme a cabeça sobe; ao encher, aciona */
  .olhar-subir {
    position: absolute; left: 50%; top: 10px; transform: translateX(-50%);
    width: 150px; opacity: 0; transition: opacity 0.2s; text-align: center;
    color: #fff; font: 700 10px system-ui, sans-serif; text-shadow: 0 1px 3px #000;
  }
  .olhar-camada.aberto .olhar-subir { opacity: 1; }
  .olhar-subir-trilho { height: 6px; margin-top: 3px; border-radius: 3px; background: rgba(255,255,255,0.25); overflow: hidden; }
  .olhar-subir-fill { height: 100%; width: 0%; background: #FFD60A; }
`;
document.head.appendChild(estiloOlhar);

const camadasOlhar = Array.from(document.querySelectorAll(".eye")).map((olho) => {
  const camada = document.createElement("div");
  camada.className = "olhar-camada";
  const itensHtml = itensOlhar
    .map(
      (item) =>
        '<div class="olhar-item"><div class="olhar-disco"><span class="olhar-icone">' +
        item.icone +
        '</span><span class="olhar-rotulo">' +
        item.rotulo +
        '</span></div><span class="olhar-estado"></span></div>'
    )
    .join("");
  camada.innerHTML =
    '<div class="olhar-dica">▾ olhe para baixo: menu</div>' +
    '<div class="olhar-subir">▲ olhe para cima para ligar/desligar<div class="olhar-subir-trilho"><div class="olhar-subir-fill"></div></div></div>' +
    '<div class="olhar-menu">' + itensHtml + "</div>" +
    '<div class="olhar-ajuda">◀ vire ou incline a cabeça ▶</div>';
  olho.appendChild(camada);
  return {
    camada,
    itens: Array.from(camada.querySelectorAll(".olhar-item")),
    barra: camada.querySelector(".olhar-subir-fill"),
  };
});

let olharYawBruto = 0;
let olharPitchBruto = 0;
let olharRollBruto = 0;
let olharYaw = 0;
let olharPitch = 0;
let olharRoll = 0;
let olharSensorOk = false;
let textoSensor = "";

let menuAberto = false;
let podeAbrirMenu = true;
let itemSelecionado = 1;
let abertoEm = 0;
let ultimoMovimentoEm = 0;
let marcaYaw = 0;
let marcaPitch = 0;
let marcaRoll = 0;
let centroYaw = 0;
let centroRoll = 0;
let armadoLateral = true;
let ultimoPassoEm = 0;
let armadoCima = true;
let acimaDesde = 0;

function normalizar180(graus) {
  return ((((graus + 180) % 360) + 360) % 360) - 180;
}

// Converte os ângulos do sensor em: para onde a pessoa olha (vertical e giro)
// e o quanto ela inclina a cabeça (orelha no ombro). Vale em qualquer posição
// do celular.
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

  // Inclinação: onde fica o "para cima" do mundo no plano da tela. O eixo do
  // celular que aponta mais para cima diz como ele está segurado (em pé ou
  // deitado, de um lado ou de outro).
  const ux = -Math.cos(b) * Math.sin(g);
  const uy = Math.sin(b);
  const uz = Math.cos(b) * Math.cos(g);
  if (Math.abs(uz) < 0.85) {
    let sx;
    let sy;
    if (Math.abs(ux) > Math.abs(uy)) {
      if (ux > 0) {
        sx = -uy;
        sy = ux;
      } else {
        sx = uy;
        sy = -ux;
      }
    } else if (uy > 0) {
      sx = ux;
      sy = uy;
    } else {
      sx = -ux;
      sy = -uy;
    }
    olharRollBruto = (Math.atan2(-sx, sy) * 180) / Math.PI; // positivo = inclinou para a direita
  }

  if (!olharSensorOk) {
    olharSensorOk = true;
    olharYaw = olharYawBruto;
    olharPitch = olharPitchBruto;
    olharRoll = olharRollBruto;
  }
});

// No iPhone o sensor precisa de permissão (no Android não).
window.addEventListener(
  "pointerdown",
  () => {
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
      DeviceOrientationEvent.requestPermission().catch(() => {});
    }
  },
  { once: true }
);

function vibrar(ms) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

function desenharMenuOlhar() {
  const progresso = menuAberto
    ? Math.max(0, Math.min(1, (olharPitch + 5) / (OLHAR.olharParaCimaAcima + 5)))
    : 0;
  camadasOlhar.forEach(({ camada, itens, barra }) => {
    camada.classList.toggle("aberto", menuAberto);
    barra.style.width = (armadoCima ? progresso * 100 : 0).toFixed(0) + "%";
    itens.forEach((el, i) => {
      const ligado = itensOlhar[i].ligado();
      el.classList.toggle("sel", menuAberto && i === itemSelecionado);
      el.classList.toggle("on", ligado);
      el.querySelector(".olhar-estado").textContent = ligado ? "ligado" : "desligado";
    });
  });
}

function abrirMenuOlhar(agora) {
  menuAberto = true;
  itemSelecionado = 1; // começa no do meio (Legenda)
  abertoEm = agora;
  ultimoMovimentoEm = agora;
  marcaYaw = olharYaw;
  marcaPitch = olharPitch;
  marcaRoll = olharRoll;
  centroYaw = olharYaw;
  centroRoll = olharRoll;
  armadoLateral = true;
  ultimoPassoEm = agora;
  armadoCima = olharPitch < OLHAR.rearmarAbaixoDe;
  acimaDesde = 0;
  vibrar(25);
  avisar("Menu aberto: vire a cabeça e olhe para cima");
  desenharMenuOlhar();
}

function fecharMenuOlhar() {
  menuAberto = false;
  podeAbrirMenu = false; // só abre de novo depois que a cabeça subir
  desenharMenuOlhar();
}

function acionarItemSelecionado() {
  itensOlhar[itemSelecionado].acionar();
  vibrar(90);
  desenharMenuOlhar();
  camadasOlhar.forEach(({ itens }) => {
    const el = itens[itemSelecionado];
    el.classList.remove("flash");
    void el.offsetWidth; // reinicia a animação
    el.classList.add("flash");
  });
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
  olharRoll += normalizar180(olharRollBruto - olharRoll) * 0.3;
  textoSensor =
    "cabeça: vertical " + olharPitch.toFixed(0) + "° (abre abaixo de " + OLHAR.abrirAbaixoDe + "°, aciona acima de +" +
    OLHAR.olharParaCimaAcima + "°) · giro " + normalizar180(olharYaw - centroYaw).toFixed(0) + "° · inclinação " +
    normalizar180(olharRoll - centroRoll).toFixed(0) + "° · menu " + (menuAberto ? "ABERTO" : "fechado");

  if (!menuAberto) {
    if (!podeAbrirMenu) {
      if (olharPitch > OLHAR.reabrirAcimaDe) podeAbrirMenu = true;
      return;
    }
    if (olharPitch < OLHAR.abrirAbaixoDe) abrirMenuOlhar(agora);
    return;
  }

  // Se mexeu o bastante, reinicia a contagem para o menu sumir.
  const deslocamento = Math.hypot(
    normalizar180(olharYaw - marcaYaw),
    olharPitch - marcaPitch,
    normalizar180(olharRoll - marcaRoll)
  );
  if (deslocamento > OLHAR.movimentoMinimo) {
    marcaYaw = olharYaw;
    marcaPitch = olharPitch;
    marcaRoll = olharRoll;
    ultimoMovimentoEm = agora;
  }

  // ---- Trocar de ícone: virar OU inclinar a cabeça. Um movimento troca um
  // ícone; só troca de novo depois de voltar ao centro (assim a volta ao
  // centro não desfaz a troca).
  if (Math.abs(olharPitch) < 70) {
    const giro = normalizar180(olharYaw - centroYaw) / OLHAR.girarParaTrocar;
    const inclinacao = normalizar180(olharRoll - centroRoll) / OLHAR.inclinarParaTrocar;
    const movimento = Math.abs(giro) > Math.abs(inclinacao) ? giro : inclinacao;

    if (armadoLateral) {
      if (Math.abs(movimento) > 1 && agora - ultimoPassoEm > OLHAR.pausaEntrePassosMs) {
        const proximo = Math.max(0, Math.min(itensOlhar.length - 1, itemSelecionado + (movimento > 0 ? 1 : -1)));
        if (proximo !== itemSelecionado) {
          itemSelecionado = proximo;
          vibrar(20);
        }
        armadoLateral = false;
        ultimoPassoEm = agora;
        ultimoMovimentoEm = agora;
      }
    } else if (Math.abs(movimento) < OLHAR.voltarAoCentro) {
      armadoLateral = true;
    }

    // Parado perto do centro: o "centro" acompanha devagar a posição da cabeça
    // (corrige o desvio do sensor e a mudança de postura).
    if (Math.abs(movimento) < OLHAR.voltarAoCentro) {
      centroYaw += normalizar180(olharYaw - centroYaw) * 0.05;
      centroRoll += normalizar180(olharRoll - centroRoll) * 0.05;
    }
  }

  // ---- Ligar/desligar: olhar para CIMA do horizonte e segurar um instante.
  if (olharPitch > OLHAR.olharParaCimaAcima) {
    if (!acimaDesde) acimaDesde = agora;
    if (armadoCima && agora - acimaDesde > OLHAR.segurarParaCimaMs && agora - abertoEm > OLHAR.tempoMinimoAbertoMs) {
      acionarItemSelecionado();
      armadoCima = false;
      ultimoMovimentoEm = agora;
    }
  } else {
    acimaDesde = 0;
  }
  if (!armadoCima && olharPitch < OLHAR.rearmarAbaixoDe) armadoCima = true;

  if (agora - ultimoMovimentoEm > OLHAR.tempoSemMovimentoMs) {
    fecharMenuOlhar();
    return;
  }
  desenharMenuOlhar();
}
requestAnimationFrame(atualizarOlhar);