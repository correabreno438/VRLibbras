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
window.VLIBRAS_VELOCIDADE = (() => {
  const v = Number(new URLSearchParams(location.search).get("velocidade"));
  return Number.isFinite(v) && v > 0 ? v : 2; // 1 = normal, 2 = mais rápido; ?velocidade=1.5
})();
const ESPERA_BOAS_VINDAS_MS = 800; // pequena folga depois que o avatar carrega
const ESPERA_MAXIMA_AVATAR_MS = 20000; // se o aviso de "terminei" nunca chegar, segue em frente
const LIMITE_CARREGAR_MS = 40000; // se o avatar nunca avisar que carregou

let avatarCarregado = false;
let prontoEm = null; // quando o avatar ficou pronto para traduzir
let avatarTocando = false; // o avatar está sinalizando (ou carregando) agora
let avatarTocandoDesde = 0;
let avatarParouEm = 0;
let textoFallbackSinal = ""; // frase enviada ao avatar (usada se não der para ler a glosa dele)
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
    else {
      avatarParouEm = Date.now();
      liberarFila();
    }
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

// O avatar escreve a palavra que está sinalizando em letras pequenas logo acima
// da cabeça. Aqui apagamos esse texto da cópia: ele é um grupo de pixels
// pequeno e separado da cabeça por um espacinho vazio. Quem mostra o texto
// agora é o nosso, nas pernas. Devolve a linha onde a cabeça começa.
function apagarRotuloAcimaDaCabeca(dst32, rw, rh, y0) {
  const limite = Math.min(rh - 1, y0 + Math.floor(rh * 0.3));
  const alturaMax = Math.floor(rh * 0.1);
  const vazioMin = Math.max(2, Math.round(rh * 0.006));
  const linha = (y) => {
    let n = 0;
    let mn = rw;
    let mx = -1;
    const d = y * rw;
    for (let x = 0; x < rw; x++) {
      if (dst32[d + x] >>> 24 > 40) {
        n++;
        if (x < mn) mn = x;
        if (x > mx) mx = x;
      }
    }
    return { n, mn, mx };
  };
  // 1ª faixa: do topo até o primeiro espaço vazio
  let y = y0;
  let mn1 = rw;
  let mx1 = -1;
  let fim1 = -1;
  let vazios = 0;
  for (; y <= limite; y++) {
    const l = linha(y);
    if (l.n === 0) {
      vazios++;
      if (vazios >= vazioMin) break;
      continue;
    }
    vazios = 0;
    fim1 = y;
    if (l.mn < mn1) mn1 = l.mn;
    if (l.mx > mx1) mx1 = l.mx;
    if (fim1 - y0 + 1 > alturaMax) return y0; // faixa grande demais: é o corpo, não o texto
  }
  if (fim1 < 0 || y > limite) return y0; // não há espaço vazio: nada a apagar
  if (mx1 - mn1 > rw * 0.45) return y0;
  // 2ª faixa (a cabeça): primeira linha com pixels depois do espaço
  let ini2 = -1;
  for (let k = y; k <= limite + vazioMin; k++) {
    if (k >= rh) break;
    if (linha(k).n > 0) {
      ini2 = k;
      break;
    }
  }
  if (ini2 < 0) return y0;
  let mn2 = rw;
  let mx2 = -1;
  const topo2 = Math.min(rh - 1, ini2 + Math.max(3, Math.round(rh * 0.03)));
  for (let k = ini2; k <= topo2; k++) {
    const l = linha(k);
    if (l.n === 0) continue;
    if (l.mn < mn2) mn2 = l.mn;
    if (l.mx > mx2) mx2 = l.mx;
  }
  // O texto fica centralizado em cima da cabeça.
  const centro1 = (mn1 + mx1) / 2;
  const folga = (mx2 - mn2) * 0.35;
  if (centro1 < mn2 - folga || centro1 > mx2 + folga) return y0;
  dst32.fill(0, y0 * rw, (fim1 + 1) * rw);
  return ini2;
}

let bufPixels32 = null;
let imagem32 = null;
let quadrosDesdeLeituraCompleta = 0;
const avatarTextoOriginalVisivel = new URLSearchParams(location.search).get("textoavatar") === "original";

// Lê só a região do boneco (e, de tempos em tempos, o quadro inteiro, para
// descobrir se ele cresceu). Trabalha com blocos de 32 bits e só mexe pixel a
// pixel nas bordas: bem mais leve para o celular, então a animação fica fluida.
function lerQuadroWebGL(win, regiao, completo) {
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

  const rx = completo ? 0 : regiao.sx;
  const ry = completo ? 0 : regiao.sy;
  const rw = completo ? w : regiao.sw;
  const rh = completo ? h : regiao.sh;
  const glY = h - ry - rh; // o WebGL conta de baixo para cima

  if (!bufPixels || bufPixels.length !== rw * rh * 4) {
    bufPixels = new Uint8Array(rw * rh * 4);
    bufPixels32 = new Uint32Array(bufPixels.buffer);
    imagemTemp = new ImageData(rw, rh);
    imagem32 = new Uint32Array(imagemTemp.data.buffer);
    quadroTemp.width = rw;
    quadroTemp.height = rh;
  }
  gl.readPixels(rx, glY, rw, rh, gl.RGBA, gl.UNSIGNED_BYTE, bufPixels);

  const src32 = bufPixels32;
  const dst32 = imagem32;

  // Tem transparência? (amostra de alguns pontos)
  let alfaMax = 0;
  for (let i = 0; i < src32.length; i += 7) {
    const a = src32[i] >>> 24;
    if (a > alfaMax) alfaMax = a;
  }
  const semAlfa = alfaMax === 0;
  const atributos = gl.getContextAttributes() || {};
  const premultiplicado = atributos.premultipliedAlpha !== false;
  infoLeitura = "alfa " + alfaMax + (premultiplicado ? " pm" : " reta") + (completo ? " cheio" : " recorte");

  // Vira de cabeça para baixo (o WebGL entrega o quadro invertido).
  for (let y = 0; y < rh; y++) {
    const s = (rh - 1 - y) * rw;
    dst32.set(src32.subarray(s, s + rw), y * rw);
  }

  if (semAlfa) {
    // O WebGL não entregou transparência: o preto vira branco opaco.
    for (let i = 0; i < dst32.length; i++) {
      dst32[i] = (dst32[i] & 0x00ffffff) === 0 ? 0xffffffff : (dst32[i] | 0xff000000) >>> 0;
    }
  } else {
    let caixaX0 = rw;
    let caixaX1 = -1;
    let caixaY0 = rh;
    let pontos = 0;
    for (let y = 0; y < rh; y++) {
      const d = y * rw;
      for (let x = 0; x < rw; x++) {
        const v = dst32[d + x];
        const a = v >>> 24;
        if (a === 0) continue;
        if (a < 255 && premultiplicado) {
          // ImageData espera cor "reta" (sem multiplicar pela transparência).
          const r = Math.min(255, ((v & 255) * 255) / a) | 0;
          const g = Math.min(255, (((v >>> 8) & 255) * 255) / a) | 0;
          const b = Math.min(255, (((v >>> 16) & 255) * 255) / a) | 0;
          dst32[d + x] = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
        }
        if (a > 40) {
          if (x < caixaX0) caixaX0 = x;
          if (x > caixaX1) caixaX1 = x;
          if (y < caixaY0) caixaY0 = y;
          pontos++;
        }
      }
    }
    if (pontos > 300) {
      if (!avatarTextoOriginalVisivel) caixaY0 = apagarRotuloAcimaDaCabeca(dst32, rw, rh, caixaY0);
      registrarCaixaDoAvatar(caixaX0 + rx, caixaY0 + ry, caixaX1 + rx);
    }
  }
  quadroTemp.getContext("2d").putImageData(imagemTemp, 0, 0);
  return { fonte: quadroTemp, rx, ry };
}

function copiarQuadroDoAvatar(win) {
  // Sinalizando: ~30 cópias/s, constantes (mais suave que 60 irregulares). Parado: ~7 cópias/s (poupa o celular).
  // Se o reconhecimento de voz estiver atrasado, o avatar copia menos quadros para
  // dar prioridade à legenda (assim nenhuma fala é perdida).
  const vozAtrasada = blocosEnviados - blocosRespondidos > 3;
  if (performance.now() - ultimaCopiaEm < (avatarOcupado() ? (vozAtrasada ? 50 : 30) : 140)) return;
  if (!canvasAvatar || !canvasAvatar.isConnected) canvasAvatar = win.document.querySelector("canvas");
  const origem = canvasAvatar;
  if (!avatarCarregado || !origem || !origem.width || !origem.height) return;

  const gl = win.__glAvatar;
  const W = gl ? gl.drawingBufferWidth : origem.width;
  const H = gl ? gl.drawingBufferHeight : origem.height;
  const regiao = recorteDoAvatar(W, H);
  // Ler o quadro inteiro custa caro: só de vez em quando, e bem mais raramente
// enquanto ele sinaliza (era isso que causava os "engasgos").
const completo = !caixaAvatar || ++quadrosDesdeLeituraCompleta >= (avatarOcupado() ? 400 : 45);
  if (completo) quadrosDesdeLeituraCompleta = 0;

  let fonte = origem;
  let sx = regiao.sx;
  let sy = regiao.sy;
  try {
    const leitura = lerQuadroWebGL(win, regiao, completo);
    if (leitura) {
      fonte = leitura.fonte;
      sx = regiao.sx - leitura.rx;
      sy = regiao.sy - leitura.ry;
    }
  } catch (err) {
    infoLeitura = "erro " + err.message;
  }
  const sw = regiao.sw;
  const sh = regiao.sh;

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
  textoFallbackSinal = texto.toUpperCase();
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

// O Vosk escreve números por extenso ("dois mil e vinte e seis"). O VLibras
// sinaliza melhor números escritos em dígitos ("2026"), então convertemos.
const NUM_UNIDADES = { zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
  dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19 };
const NUM_DEZENAS = { vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90 };
const NUM_CENTENAS = { cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300, quatrocentos: 400, quatrocentas: 400,
  quinhentos: 500, quinhentas: 500, seiscentos: 600, seiscentas: 600, setecentos: 700, setecentas: 700, oitocentos: 800, oitocentas: 800,
  novecentos: 900, novecentas: 900 };
const NUM_MULT = { mil: 1000, milhao: 1e6, milhoes: 1e6, bilhao: 1e9, bilhoes: 1e9 };

function semAcento(p) {
  return p.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
// Classe do número: 1 unidade, 2 dezena/teen, 3 centena, 4 mil, 5 milhão+
function infoNumero(palavra) {
  const p = semAcento(palavra);
  if (p in NUM_UNIDADES) return { v: NUM_UNIDADES[p], c: NUM_UNIDADES[p] >= 10 ? 2 : 1, p };
  if (p in NUM_DEZENAS) return { v: NUM_DEZENAS[p], c: 2, p };
  if (p in NUM_CENTENAS) return { v: NUM_CENTENAS[p], c: 3, p };
  if (p in NUM_MULT) return { v: NUM_MULT[p], c: NUM_MULT[p] === 1000 ? 4 : 5, p, mult: true };
  return null;
}

function numerosParaDigitos(texto) {
  const palavras = texto.split(/\s+/).filter(Boolean);
  const saida = [];
  let i = 0;
  while (i < palavras.length) {
    const inicio = infoNumero(palavras[i]);
    if (!inicio) {
      saida.push(palavras[i]);
      i++;
      continue;
    }
    // Junta as palavras seguintes que continuam o mesmo número.
    const grupo = [inicio];
    let j = i + 1;
    while (j < palavras.length) {
      const anterior = grupo[grupo.length - 1];
      let k = j;
      const comE = semAcento(palavras[k]) === "e";
      if (comE) k++;
      const prox = k < palavras.length ? infoNumero(palavras[k]) : null;
      if (!prox) break;
      const continua = prox.mult ? anterior.c < prox.c : prox.c < anterior.c && !(prox.c === 1 && anterior.c === 2 && anterior.v < 20);
      if (!continua) break;
      grupo.push(prox);
      j = k + 1;
    }
    // "um"/"uma" sozinho é artigo, não número.
    if (grupo.length === 1 && (grupo[0].p === "um" || grupo[0].p === "uma")) {
      saida.push(palavras[i]);
    } else {
      let total = 0;
      let atual = 0;
      grupo.forEach((n) => {
        if (n.mult) {
          total += (atual || 1) * n.v;
          atual = 0;
        } else atual += n.v;
      });
      saida.push(String(total + atual));
    }
    i = j;
  }
  return saida.join(" ");
}

// Nomes próprios: o Vosk escreve tudo em minúsculas e o VLibras só soletra
// (datilologia) palavras que reconhece como nome. Aqui marcamos os nomes com
// letra maiúscula: (1) os que a pessoa escreve nesta lista e (2) as palavras
// que vêm depois de "meu nome é", "me chamo", "professor", etc.
// Exemplo: const NOMES_PROPRIOS = ["breno", "maria", "joão"];
const NOMES_PROPRIOS = [];
const GATILHOS_NOME = ["chamo", "chama", "chamado", "chamada"]; // até 3 palavras seguintes
const GATILHOS_TITULO = ["professor", "professora", "doutor", "doutora", "seu", "dona", "senhor", "senhora", "colega", "amigo", "amiga"]; // 1 palavra
const NAO_NOME = new Set(["e", "o", "a", "os", "as", "de", "do", "da", "dos", "das", "um", "uma", "que", "eu", "voce", "ele", "ela", "nao", "sim", "aqui", "hoje", "hora", "horas", "meu", "minha", "nome", "bom", "boa", "dia", "tarde", "noite", "tenho", "sou", "moro", "trabalho", "estou", "vou", "vim", "disse", "falou", "esta", "foi", "vai", "tem", "mais", "mas", "para", "com", "na", "no", "em"]);

function capitalizar(p) {
  return p.charAt(0).toUpperCase() + p.slice(1);
}

function marcarNomesProprios(texto) {
  const palavras = texto.split(/\s+/).filter(Boolean);
  const lista = new Set(NOMES_PROPRIOS.map(semAcento));
  for (let i = 0; i < palavras.length; i++) {
    const p = semAcento(palavras[i]);
    if (lista.has(p)) palavras[i] = capitalizar(palavras[i]);
    // "meu nome é X Y" / "me chamo X Y" / "professor X" / "chama X"
    const ehNomeGatilho = p === "nome" && i + 1 < palavras.length && semAcento(palavras[i + 1]) === "e";
    const gatilho = ehNomeGatilho ? i + 1 : GATILHOS_NOME.includes(p) || GATILHOS_TITULO.includes(p) ? i : -1;
    const maximo = GATILHOS_TITULO.includes(p) ? 1 : 3;
    if (gatilho >= 0) {
      let marcados = 0;
      for (let j = gatilho + 1; j < palavras.length && marcados < maximo; j++) {
        const q = semAcento(palavras[j]);
        if (NAO_NOME.has(q) || /^\d/.test(q) || infoNumero(q)) break;
        palavras[j] = capitalizar(palavras[j]);
        marcados++;
      }
    }
  }
  return palavras.join(" ");
}

function decimaisParaDigitos(texto) {
  // "3 vírgula 5" -> "3,5"
  return texto.replace(/(\d+)\s+v[ií]rgula\s+(\d+)/gi, "$1,$2");
}

function traduzirParaLibras(texto) {
  if (!texto || !texto.trim()) return;
  const paraEnviar = marcarNomesProprios(decimaisParaDigitos(numerosParaDigitos(texto.trim())));
  window.__ultimoTextoLibras = paraEnviar;
  enviarParaWidget(paraEnviar);
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
const LEGENDA_MAX_CARACTERES = 320; // o que cabe na tela é decidido pelo layout (linhas); isto só limita a memória
const LEGENDA_LIMPAR_APOS_MS = 5000; // mínimo; fica mais tempo em frases longas
const LEGENDA_MS_POR_CARACTERE = 70;
let legendaFixa = ""; // frases já finalizadas
let parcialJaEnviado = "";
let legendaParcialFixada = ""; // parcial que já foi para a legenda fixa (evita repetir)
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
  const tempoNaTela = Math.min(12000, Math.max(LEGENDA_LIMPAR_APOS_MS, 1500 + legendaFixa.length * LEGENDA_MS_POR_CARACTERE));
  timerLimparLegenda = setTimeout(() => {
    legendaFixa = "";
    if (transcricaoAtiva) captionEl.textContent = "";
  }, tempoNaTela);
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

const DICA_INICIAL = "Olhe para a esquerda para abrir as opções";

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
          fixarNaLegenda(ultimoParcial); // a fala fica na legenda mesmo que o Vosk não a finalize
          traduzirParaLibras(ultimoParcial);
          ultimoParcial = "";
          legendaParcialFixada = parcialJaEnviado;
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

      if (legendaParcialFixada) {
        // O começo desta frase já está na legenda: acrescenta só o que faltou.
        const resto = texto.startsWith(legendaParcialFixada) ? texto.slice(legendaParcialFixada.length).trim() : texto;
        legendaParcialFixada = "";
        if (resto) fixarNaLegenda(resto);
      } else {
        fixarNaLegenda(texto);
      }
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
const FILA_MAXIMA_BLOCOS = 40; // até ~10 s de áudio esperando; só acima disso descarta (antes perdia falas)
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
    const LIMIAR_VOZ = 0.004; // mais sensível: pega falas baixas e o começo das palavras
    const FOLGA_APOS_VOZ_MS = 1500;
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
        if (antes.length > 4) antes.shift();
      }
      // Acabou de falar: pede ao Vosk para fechar a frase agora, assim as
      // últimas palavras não ficam presas esperando mais áudio.
      if (estavaEnviando && !enviando && typeof reconhecedor.retrieveFinalResult === "function") {
        try {
          reconhecedor.retrieveFinalResult();
          blocosEnviados++; // essa chamada também gera uma resposta
        } catch (e) {}
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
// Funciona como a tecla TAB de um teclado:
//   1) OLHE PARA A ESQUERDA: as opções aparecem no lado esquerdo.
//   2) OLHE PARA CIMA ou PARA BAIXO: a seleção (borda amarela) passa para a
//      opção de cima / de baixo. Cada movimento troca uma opção (e dá a volta:
//      depois da última vem a primeira). Volte a cabeça ao centro para trocar de novo.
//   3) OLHE PARA A DIREITA: liga ou desliga a opção selecionada.
// Se a pessoa ficar uns 3 segundos sem se mexer, as opções somem sozinhas.
// Usa o giroscópio do celular (funciona offline).
const OLHAR = {
  abrirGiroEsquerda: 12, // graus virando para a ESQUERDA para abrir as opções
  abrirSegurarMs: 250, // tempo mantendo o olhar à esquerda para abrir (evita abrir sem querer)
  trocarInclinacao: 8, // graus para CIMA/BAIXO para passar para a opção seguinte
  segurarTrocaMs: 180, // tempo mantendo o olhar para cima/baixo para a troca valer
  pausaEntreTrocasMs: 700, // tempo mínimo entre uma troca e outra (aumente se estiver rápido demais)
  voltarAoCentroVertical: 6, // graus: abaixo disso conta como "voltou ao centro"
  voltarAoCentroGiro: 6,
  voltarAoCentroMs: 200, // tempo no centro para liberar a próxima troca (evita contar a "volta")
  liberarSozinhoMs: 1500, // se a cabeça já está abaixo do limite, libera a próxima troca depois deste tempo
  ajusteInicialMs: 600, // logo que o menu abre, o centro acompanha a cabeça (descobre sua postura de descanso)
  selecionarGiroDireita: 10, // graus virando para a DIREITA para ligar/desligar
  segurarDireitaMs: 150, // tempo mantendo o olhar à direita
  tempoMinimoAbertoMs: 600, // logo depois de abrir, não aciona nada
  movimentoMinimo: 3, // graus que contam como "se mexeu" (para as opções não sumirem)
  tempoSemMovimentoMs: 3000, // sem se mexer por esse tempo, as opções somem
  recentrar: 0.002, // quão rápido o "em frente" acompanha a postura da cabeça (0 = nunca)
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

// O estilo fica aqui dentro (e não no index.html) para aparecer mesmo que o
// index.html esteja numa versão mais antiga.
const estiloOlhar = document.createElement("style");
estiloOlhar.id = "estilo-olhar";
estiloOlhar.textContent = `
  .olhar-camada { position: absolute; inset: 0; pointer-events: none; z-index: 15; }
  .olhar-lista {
    position: absolute; left: 0; top: 50%; transform: translateY(-50%);
    display: flex; flex-direction: column; gap: 10px;
    opacity: 0; visibility: hidden; transition: opacity 0.2s;
  }
  .olhar-camada.aberto .olhar-lista { opacity: 1; visibility: visible; }
  .olhar-item {
    display: flex; align-items: center; gap: 6px; color: #fff;
    font-family: system-ui, sans-serif; transition: transform 0.18s; transform-origin: left center;
  }
  .olhar-item.sel { transform: scale(1.12); }
  .olhar-anel {
    width: 40px; height: 40px; flex: none; border-radius: 50%; padding: 3px; box-sizing: border-box;
    background: rgba(255,255,255,0.3); transition: background 0.18s;
  }
  .olhar-item.sel .olhar-anel { background: #FFD60A; }
  .olhar-disco {
    width: 100%; height: 100%; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    background: rgba(20,20,26,0.85); font-size: 17px; line-height: 1;
  }
  .olhar-item.on .olhar-disco { background: rgba(20,120,100,0.95); }
  .olhar-texto { display: flex; flex-direction: column; line-height: 1.15; text-shadow: 0 1px 3px #000; }
  .olhar-rotulo { font-size: 10px; font-weight: 700; }
  .olhar-estado { font-size: 9px; font-weight: 600; opacity: 0.9; }
  .olhar-ajuda {
    margin-top: 2px; font: 600 8px/1.3 system-ui, sans-serif; color: #fff; opacity: 0.85;
    text-shadow: 0 1px 3px #000; white-space: nowrap;
  }
  .olhar-item.flash .olhar-anel { animation: olhar-flash 0.6s ease-out; }
  @keyframes olhar-flash {
    0% { box-shadow: 0 0 0 0 rgba(255,214,10,0.95); }
    100% { box-shadow: 0 0 0 16px rgba(255,214,10,0); }
  }
`;
document.head.appendChild(estiloOlhar);

const camadasOlhar = Array.from(document.querySelectorAll(".eye")).map((olho) => {
  const camada = document.createElement("div");
  camada.className = "olhar-camada";
  camada.innerHTML =
    '<div class="olhar-lista">' +
    itensOlhar
      .map(
        (item) =>
          '<div class="olhar-item"><div class="olhar-anel"><div class="olhar-disco">' + item.icone + "</div></div>" +
          '<div class="olhar-texto"><span class="olhar-rotulo">' + item.rotulo + '</span><span class="olhar-estado"></span></div></div>'
      )
      .join("") +
    '<div class="olhar-ajuda">▲▼ trocar · ▶ ligar/desligar</div></div>';
  olho.appendChild(camada);
  return { camada, itens: Array.from(camada.querySelectorAll(".olhar-item")) };
});

let olharYawBruto = 0;
let olharPitchBruto = 0;
let olharYaw = 0;
let olharPitch = 0;
let olharSensorOk = false;
let textoSensor = "";

let centroYaw = 0; // para onde a pessoa olha "em frente"
let centroPitch = 0;
let menuAberto = false;
let podeAbrirMenu = true;
let aEsquerdaDesde = 0;
let itemSelecionado = -1; // -1 = nenhuma opção selecionada ainda
let abertoEm = 0;
let ultimoMovimentoEm = 0;
let marcaYaw = 0;
let marcaPitch = 0;
let refYaw = 0; // posição de referência com as opções abertas
let refPitch = 0;
let armadoVertical = true;
let ultimaTrocaEm = 0;
let armadoDireita = true;
let aDireitaDesde = 0;
let chaveOlhar = "";
let vertDesde = 0;
let neutroVertDesde = 0;
let neutroGiroDesde = 0;
let ultimoAcionamentoEm = 0;
let yawAnterior = 0;
let pitchAnterior = 0;
let quadroAnteriorEm = 0;
let paradoDesde = 0; // desde quando a cabeça está quase parada

function normalizar180(graus) {
  return ((((graus + 180) % 360) + 360) % 360) - 180;
}

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
      DeviceOrientationEvent.requestPermission().catch(() => {});
    }
  },
  { once: true }
);

function vibrar(ms) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

function desenharMenuOlhar() {
  const chave = [menuAberto ? 1 : 0, itemSelecionado, itensOlhar.map((i) => (i.ligado() ? 1 : 0)).join("")].join("|");
  if (chave === chaveOlhar) return;
  chaveOlhar = chave;
  camadasOlhar.forEach(({ camada, itens }) => {
    camada.classList.toggle("aberto", menuAberto);
    itens.forEach((el, i) => {
      const ligado = itensOlhar[i].ligado();
      el.classList.toggle("sel", menuAberto && i === itemSelecionado);
      el.classList.toggle("on", ligado);
      const estado = ligado ? "ligado" : "desligado";
      const rotulo = el.querySelector(".olhar-estado");
      if (rotulo.textContent !== estado) rotulo.textContent = estado;
    });
  });
}

function abrirMenuOlhar(agora) {
  menuAberto = true;
  itemSelecionado = -1;
  abertoEm = agora;
  ultimoMovimentoEm = agora;
  refYaw = marcaYaw = olharYaw;
  refPitch = marcaPitch = olharPitch;
  armadoVertical = true;
  armadoDireita = true;
  aDireitaDesde = 0;
  ultimaTrocaEm = agora - OLHAR.pausaEntreTrocasMs + 400; // a 1ª troca vale logo (após ~0,4 s)
  vibrar(25);
  desenharMenuOlhar();
}

function fecharMenuOlhar() {
  menuAberto = false;
  podeAbrirMenu = false; // só abre de novo depois que a cabeça voltar ao centro
  aEsquerdaDesde = 0;
  desenharMenuOlhar();
}

function acionarItemSelecionado() {
  const i = itemSelecionado;
  itensOlhar[i].acionar();
  vibrar(90);
  const ligado = itensOlhar[i].ligado();
  avisar(itensOlhar[i].rotulo + (ligado ? " ligado" : " desligado"));
  desenharMenuOlhar();
  camadasOlhar.forEach(({ itens }) => {
    const el = itens[i];
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

  // A cabeça está parada? (usado para o "centro" acompanhar onde a pessoa descansa)
  const dtQuadro = Math.max(1, agora - quadroAnteriorEm) / 1000;
  const velocidade = Math.hypot(normalizar180(olharYaw - yawAnterior), olharPitch - pitchAnterior) / dtQuadro;
  yawAnterior = olharYaw;
  pitchAnterior = olharPitch;
  quadroAnteriorEm = agora;
  if (velocidade < 10) {
    if (!paradoDesde) paradoDesde = agora;
  } else paradoDesde = 0;
  const parado = paradoDesde && agora - paradoDesde > 350;

  if (!menuAberto) {
    // Giro e inclinação em relação ao "em frente". Negativo = esquerda.
    const dYaw = normalizar180(olharYaw - centroYaw);
    const dPitch = olharPitch - centroPitch;
    textoSensor = "cabeça: giro " + dYaw.toFixed(0) + "° (abre abaixo de -" + OLHAR.abrirGiroEsquerda + "°) · vertical " + dPitch.toFixed(0) + "° · menu fechado";

    if (!podeAbrirMenu) {
      if (Math.abs(dYaw) < OLHAR.abrirGiroEsquerda * 0.5) podeAbrirMenu = true;
    } else if (dYaw < -OLHAR.abrirGiroEsquerda) {
      if (!aEsquerdaDesde) aEsquerdaDesde = agora;
      if (agora - aEsquerdaDesde > OLHAR.abrirSegurarMs) abrirMenuOlhar(agora);
    } else {
      aEsquerdaDesde = 0;
    }
    // O "em frente" acompanha devagar a postura (corrige o desvio do sensor).
    if (OLHAR.recentrar > 0 && Math.abs(dYaw) < OLHAR.abrirGiroEsquerda * 0.6) {
      centroYaw += dYaw * OLHAR.recentrar;
      centroPitch += dPitch * OLHAR.recentrar;
    }
    // Parado por um tempo: o centro vai para onde a pessoa está descansando.
    if (parado && Math.abs(dYaw) < OLHAR.abrirGiroEsquerda * 0.8) {
      centroYaw += dYaw * 0.06;
      centroPitch += dPitch * 0.06;
    }
    return;
  }

  // ---- Menu aberto. Tudo é medido a partir da posição em que ele abriu.
  const dYaw = normalizar180(olharYaw - refYaw);
  const dPitch = olharPitch - refPitch;
  textoSensor =
    "cabeça: giro " + dYaw.toFixed(0) + "° (liga/desliga acima de +" + OLHAR.selecionarGiroDireita + "°) · vertical " +
    dPitch.toFixed(0) + "° (troca além de ±" + OLHAR.trocarInclinacao + "°) · opção " + (itemSelecionado + 1) + "/" + itensOlhar.length;

  // Se mexeu o bastante, reinicia a contagem para o menu sumir.
  const deslocamento = Math.hypot(normalizar180(olharYaw - marcaYaw), olharPitch - marcaPitch);
  if (deslocamento > OLHAR.movimentoMinimo) {
    marcaYaw = olharYaw;
    marcaPitch = olharPitch;
    ultimoMovimentoEm = agora;
  }

  // Logo depois de abrir, o centro acompanha a cabeça: assim ele fica na postura em
  // que a pessoa realmente descansa (e não onde ela estava no instante em que abriu).
  // Depois disso, só uma correção bem lenta do desvio do sensor.
  if (agora - abertoEm < OLHAR.ajusteInicialMs) {
    // (só acompanha movimentos lentos de ajuste; um gesto rápido continua valendo)
    // e só pequenos desvios (até ~6°) são absorvidos, devagar.
    if (velocidade < 8 && Math.abs(dPitch) < OLHAR.trocarInclinacao * 0.75 && Math.abs(dYaw) < OLHAR.selecionarGiroDireita * 0.75) {
      refYaw += dYaw * 0.05;
      refPitch += dPitch * 0.05;
    }
  } else if (Math.abs(dPitch) < OLHAR.trocarInclinacao * 0.5 && Math.abs(dYaw) < OLHAR.selecionarGiroDireita * 0.5) {
    refYaw += dYaw * 0.01;
    refPitch += dPitch * 0.01;
  }

  // ---- TAB: para cima = opção anterior, para baixo = próxima (dá a volta).
  // Depois de uma troca, só vale outra quando a cabeça ficar um instante parada
  // no centro; assim o movimento de VOLTAR ao centro não conta como troca.
  if (armadoVertical) {
    if (Math.abs(dPitch) > OLHAR.trocarInclinacao && agora - ultimaTrocaEm > OLHAR.pausaEntreTrocasMs) {
      if (!vertDesde) vertDesde = agora;
      if (agora - vertDesde > OLHAR.segurarTrocaMs) {
        const n = itensOlhar.length;
        if (itemSelecionado < 0) itemSelecionado = dPitch > 0 ? n - 1 : 0;
        else itemSelecionado = (itemSelecionado + (dPitch > 0 ? -1 : 1) + n) % n;
        armadoVertical = false;
        neutroVertDesde = 0;
        vertDesde = 0;
        ultimaTrocaEm = agora;
        ultimoMovimentoEm = agora;
        vibrar(20);
      }
    } else {
      vertDesde = 0;
    }
  } else if (Math.abs(dPitch) < OLHAR.voltarAoCentroVertical) {
    if (!neutroVertDesde) neutroVertDesde = agora;
    if (agora - neutroVertDesde > OLHAR.voltarAoCentroMs) armadoVertical = true;
  } else {
    neutroVertDesde = 0;
    // Segurança: se a cabeça já está abaixo do limite de troca por um bom tempo, libera.
    if (Math.abs(dPitch) < OLHAR.trocarInclinacao && agora - ultimaTrocaEm > OLHAR.liberarSozinhoMs) armadoVertical = true;
  }

  // ---- Direita: liga/desligar a opção selecionada.
  if (dYaw > OLHAR.selecionarGiroDireita) {
    neutroGiroDesde = 0;
    if (!aDireitaDesde) aDireitaDesde = agora;
    if (armadoDireita && agora - aDireitaDesde > OLHAR.segurarDireitaMs && agora - abertoEm > OLHAR.tempoMinimoAbertoMs && agora - ultimoAcionamentoEm > OLHAR.pausaEntreTrocasMs) {
      if (itemSelecionado >= 0) {
        acionarItemSelecionado();
        armadoDireita = false;
        ultimoAcionamentoEm = agora;
        ultimoMovimentoEm = agora;
      } else {
        // Sem opção escolhida, virar para a direita é só voltar: fecha o menu.
        fecharMenuOlhar();
        return;
      }
    }
  } else {
    aDireitaDesde = 0;
    if (!armadoDireita) {
      if (dYaw < OLHAR.voltarAoCentroGiro) {
        if (!neutroGiroDesde) neutroGiroDesde = agora;
        if (agora - neutroGiroDesde > OLHAR.voltarAoCentroMs) armadoDireita = true;
      } else {
        neutroGiroDesde = 0;
        if (agora - ultimoAcionamentoEm > OLHAR.liberarSozinhoMs) armadoDireita = true;
      }
    }
  }

  if (agora - ultimoMovimentoEm > OLHAR.tempoSemMovimentoMs) {
    fecharMenuOlhar();
    return;
  }
  desenharMenuOlhar();
}
requestAnimationFrame(atualizarOlhar);

// ---------------------------------------------------------------
// 6) Moldura preta ao redor da imagem (estilo óculos VR) e interface alinhada
// ---------------------------------------------------------------
// Cada olho mostra a câmera dentro de uma "almofada" arredondada, com borda
// preta ao redor, como nos aplicativos de realidade virtual. Ícones, legenda e
// avatar ficam todos DENTRO dessa moldura, com a mesma margem.
// Ajustes pela URL (em %):
//   ?zoom=1.15      aumento da imagem da câmera (1 = sem aumento)
//   ?separacao=1.5  aproxima as duas imagens do centro, em % (negativo afasta)
//   ?ajuste         mostra botões para regular zoom e separação (fica salvo no celular)
//   ?velocidade=2   velocidade do avatar (1 = normal)
//   ?quadro=92   altura da imagem em relação à tela (menor = borda preta maior)
//   ?forma=1.08  proporção largura/altura da imagem (maior = mais larga)
//   ?curva=4     quanto as bordas "estufam" (0 = retângulo reto)
//   ?margem=7    espaço entre a moldura e os ícones/legenda
//   ?avatar=dir  lado do avatar: dir (canto direito) ou esq (canto esquerdo)
//   ?legenda=baixo  posição da legenda: baixo (ao lado do avatar) ou cima
//   ?linhas=4       quantas linhas da legenda aparecem de uma vez
//   ?avatartam=42 altura do avatar em % da imagem
//   ?avatarmargem=3 distância do avatar até a borda da imagem (%)
const parametrosUrl = new URLSearchParams(location.search);
const quadroAltura = Number(parametrosUrl.get("quadro") ?? 92);
// Zoom da câmera e separação entre as duas imagens (para o encaixe nas lentes).
const lerNumeroSalvo = (nome, chave, padrao) => {
  if (parametrosUrl.has(nome)) {
    const v = Number(parametrosUrl.get(nome));
    if (Number.isFinite(v)) return v;
  }
  try {
    const salvo = localStorage.getItem(chave);
    if (salvo !== null && Number.isFinite(Number(salvo))) return Number(salvo);
  } catch (e) {}
  return padrao;
};
let ajusteZoom = lerNumeroSalvo("zoom", "libras-vr:zoom", 1.3);
let ajusteDesloc = lerNumeroSalvo("desloc", "libras-vr:desloc", 0);
let ajusteSeparacao = lerNumeroSalvo("separacao", "libras-vr:separacao", 1.5);
const quadroForma = Number(parametrosUrl.get("forma") ?? 1.08);
const avatarLado = parametrosUrl.get("avatar") === "esq" ? "esq" : "dir";
const legendaModo = ["cima", "baixo"].includes(parametrosUrl.get("legenda")) ? parametrosUrl.get("legenda") : "auto";
const legendaCima = legendaModo === "cima";
const legendaLinhas = Math.max(2, Math.min(8, Number(parametrosUrl.get("linhas")) || 4));
const avatarTam = Number(parametrosUrl.get("avatartam") ?? 42);
const avatarMargem = Number(parametrosUrl.get("avatarmargem") ?? 3);
const curvaBordas = Number(parametrosUrl.get("curva") ?? 4) / 100;
const margemUi = Number(parametrosUrl.get("margem") ?? 7);
if (parametrosUrl.has("debug")) document.body.classList.add("debug");

// Forma da moldura: cantos suaves e lados levemente abaulados.
const c0 = 0.05;
const cb = curvaBordas;
const caminhoMoldura =
  "M" + c0 + "," + c0 +
  " Q0.5," + -cb + " " + (1 - c0) + "," + c0 +
  " Q" + (1 + cb) + ",0.5 " + (1 - c0) + "," + (1 - c0) +
  " Q0.5," + (1 + cb) + " " + c0 + "," + (1 - c0) +
  " Q" + -cb + ",0.5 " + c0 + "," + c0 + " Z";
const svgMoldura = document.createElementNS("http://www.w3.org/2000/svg", "svg");
svgMoldura.setAttribute("width", "0");
svgMoldura.setAttribute("height", "0");
svgMoldura.style.position = "absolute";
svgMoldura.innerHTML =
  '<defs><clipPath id="forma-moldura" clipPathUnits="objectBoundingBox"><path d="' + caminhoMoldura + '"/></clipPath></defs>';
document.body.appendChild(svgMoldura);

const estiloTela = document.createElement("style");
estiloTela.id = "estilo-tela";
estiloTela.textContent = `
  :root { --mx: ${margemUi}%; --my: ${margemUi}%; --aw: 0px; --zoom: ${ajusteZoom}; --sep: ${ajusteSeparacao}%; --desl: ${ajusteDesloc}%; }
  html, body { width: 100%; height: 100%; background: #000; }
  #stage { height: 100vh; height: 100dvh; width: 100vw; background: #000; }
  #stage.stereo #eyeLeft, #stage.stereo #eyeRight { width: 50%; border: 0; background: #000; }

  /* A imagem de cada olho: um quadro centralizado, com preto em volta */
  .moldura {
    position: absolute; top: 50%; left: 50%;
    height: ${quadroAltura}%; aspect-ratio: ${quadroForma} / 1; max-width: 98%;
    transform: translate(-50%, -50%);
    clip-path: url(#forma-moldura); -webkit-clip-path: url(#forma-moldura);
    overflow: hidden; background: #000;
  }
  #eyeLeft .moldura { left: calc(50% + var(--sep) + var(--desl)); }
  #eyeRight .moldura { left: calc(50% - var(--sep) + var(--desl)); }
  .moldura video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transform: scale(var(--zoom)); }
  #painel-ajuste {
    flex-wrap: wrap; justify-content: center; max-width: 96vw;
    position: fixed; z-index: 9999; left: 50%; bottom: 8px; transform: translateX(-50%);
    display: flex; gap: 6px; align-items: center; padding: 6px 10px; border-radius: 12px;
    background: rgba(0,0,0,0.8); color: #fff; font: 600 12px system-ui, sans-serif;
  }
  #painel-ajuste button { padding: 6px 10px; font-size: 14px; }

  /* Botões de toque, status de canto e barra única de legenda saem de cena:
     o controle é pela cabeça e tudo aparece dentro de cada olho. */
  body:not(.debug) #micBtn, body:not(.debug) #controls, body:not(.debug) #status { display: none !important; }
  #captionBar { display: none !important; }

  /* Tudo alinhado dentro da moldura */
  .moldura .olhar-camada { inset: var(--my) var(--mx); }
  .moldura .avatar-box canvas { filter: none; }
  .moldura .avatar-box {
    height: ${avatarTam}%; max-height: none; bottom: ${avatarMargem}%;
    ${avatarLado === "esq" ? "left: " + avatarMargem + "%; right: auto;" : "right: " + avatarMargem + "%; left: auto;"}
  }

  /* Legenda: fica ao lado do avatar (embaixo). Mostra as últimas linhas inteiras;
     conforme chegam palavras novas, as linhas antigas sobem e vão sumindo aos
     poucos no alto, sem cortar palavras no meio. */
  .eye-legenda {
    position: absolute; z-index: 20; pointer-events: none;
    left: var(--mx); right: var(--mx); ${legendaCima ? "top: 4%;" : "bottom: 4%;"}
    display: flex; justify-content: center;
  }
  body.avatar-espelhado:not(.vlibras-off) .eye-legenda {
    right: calc(${avatarMargem}% + var(--aw) * 0.72);
  }
  .eye-legenda span {
    display: block; max-width: 100%; padding: 6px 10px; border-radius: 10px;
    background: rgba(0,0,0,0.6); color: #FFD60A; text-align: center;
    font: 700 clamp(11px, 1.9vw, 17px)/1.25 system-ui, sans-serif;
    text-shadow: 0 0 4px rgba(0,0,0,0.95), 0 2px 6px rgba(0,0,0,0.9);
    overflow-wrap: normal; word-break: normal; hyphens: none;
  }
  .eye-legenda b {
    display: flex; flex-direction: column-reverse; overflow: hidden; font-weight: inherit;
    max-height: calc(1.25em * ${legendaLinhas});
  }
  .eye-legenda b.cortada {
    -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 1.3em);
    mask-image: linear-gradient(to bottom, transparent 0, #000 1.3em);
  }
  .eye-legenda i { display: block; font-style: normal; }
  .eye-legenda.vazia { display: none; }
  .eye-toque {
    position: absolute; z-index: 30; left: 50%; top: 50%; transform: translate(-50%, -50%);
    padding: 8px 14px; border-radius: 12px; background: rgba(0,0,0,0.7); color: #fff;
    font: 700 13px system-ui, sans-serif; text-align: center; pointer-events: none;
  }
  body.tela-cheia .eye-toque { display: none; }

  .eye-aviso {
    position: absolute; z-index: 22; pointer-events: none;
    left: var(--mx); right: var(--mx); top: 5%;
    text-align: center; color: #fff; font: 600 11px system-ui, sans-serif;
    text-shadow: 0 1px 3px #000; transition: opacity 0.4s;
  }
  .eye-aviso.oculto { opacity: 0; }
`;
document.head.appendChild(estiloTela);

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
  } catch (e) {}
  try {
    if (document.fullscreenElement && screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock("landscape");
    }
  } catch (e) {}
  try {
    if (navigator.wakeLock) await navigator.wakeLock.request("screen");
  } catch (e) {}
}
document.addEventListener("fullscreenchange", () => {
  document.body.classList.toggle("tela-cheia", !!document.fullscreenElement);
  ajustarEscala();
});
window.addEventListener("click", entrarTelaCheia);
window.addEventListener("touchend", entrarTelaCheia);

// ---- Painel de ajuste (só com ?ajuste no endereço) ----------------------
function aplicarAjustes() {
  document.documentElement.style.setProperty("--zoom", String(ajusteZoom));
  document.documentElement.style.setProperty("--sep", ajusteSeparacao + "%");
  document.documentElement.style.setProperty("--desl", ajusteDesloc + "%");
  try {
    localStorage.setItem("libras-vr:desloc", String(ajusteDesloc));
    localStorage.setItem("libras-vr:zoom", String(ajusteZoom));
    localStorage.setItem("libras-vr:separacao", String(ajusteSeparacao));
  } catch (e) {}
  const rotulo = document.getElementById("ajuste-valores");
  if (rotulo) rotulo.textContent = "zoom " + ajusteZoom.toFixed(2) + " · separação " + ajusteSeparacao.toFixed(1) + "% · deslocar " + ajusteDesloc.toFixed(1) + "%";
}
if (parametrosUrl.has("ajuste")) {
  const painel = document.createElement("div");
  painel.id = "painel-ajuste";
  painel.innerHTML =
    '<button data-a="sep-">⟵ ⟶ afastar</button><button data-a="sep+">⟶ ⟵ aproximar</button>' +
    '<button data-a="desl-">◀ deslocar</button><button data-a="desl+">deslocar ▶</button>' +
    '<button data-a="zoom-">zoom −</button><button data-a="zoom+">zoom +</button>' +
    '<span id="ajuste-valores"></span>';
  document.body.appendChild(painel);
  painel.addEventListener("click", (e) => {
    const a = e.target.dataset && e.target.dataset.a;
    if (!a) return;
    if (a === "sep+") ajusteSeparacao = Math.round((ajusteSeparacao + 0.5) * 10) / 10;
    if (a === "sep-") ajusteSeparacao = Math.round((ajusteSeparacao - 0.5) * 10) / 10;
    if (a === "desl+") ajusteDesloc = Math.round((ajusteDesloc + 0.5) * 10) / 10;
    if (a === "desl-") ajusteDesloc = Math.round((ajusteDesloc - 0.5) * 10) / 10;
    if (a === "zoom+") ajusteZoom = Math.round((ajusteZoom + 0.05) * 100) / 100;
    if (a === "zoom-") ajusteZoom = Math.max(1, Math.round((ajusteZoom - 0.05) * 100) / 100);
    aplicarAjustes();
  });
  aplicarAjustes();
}