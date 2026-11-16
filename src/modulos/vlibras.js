import { fonteLibrasEl, statusEl } from "./elementos.js";
import { urlDoApp } from "./util.js";
import { vlibrasAtivo } from "./preferencias.js";
import { decimaisParaDigitos, marcarNomesProprios, numerosParaDigitos } from "./texto.js";
import { acharIframeDoAvatar, copiarQuadroDoAvatar, espelharAvatarNasTelas } from "./avatar-espelho.js";
import { soCamera } from "./modo-camera.js";

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
const VLIBRAS_PATH = urlDoApp("vlibras-app");
// Velocidade do avatar: 1 = normal, 1.5 = rápido, 2 = bem rápido (intérprete
// experiente), 2.5 = máximo. Se ficar difícil de acompanhar, diminua.
window.VLIBRAS_VELOCIDADE = (() => {
  const v = Number(new URLSearchParams(location.search).get("velocidade"));
  return Number.isFinite(v) && v > 0 ? v : 2; // 1 = normal, 2 = mais rápido; ?velocidade=1.5
})();
const ESPERA_BOAS_VINDAS_MS = 800; // pequena folga depois que o avatar carrega
const ESPERA_MAXIMA_AVATAR_MS = 20000; // se o aviso de "terminei" nunca chegar, segue em frente
const LIMITE_CARREGAR_MS = 40000; // se o avatar nunca avisar que carregou

export let avatarCarregado = false;
export let prontoEm = null; // quando o avatar ficou pronto para traduzir
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
          // Avatar escondido ou app em segundo plano: quase parado, poupa bateria.
          const fps = document.hidden || !vlibrasAtivo || soCamera ? 2 : prontoEm && !avatarOcupado() ? FPS_AVATAR_PARADO : FPS_AVATAR_SINALIZANDO;
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
export function avatarOcupado() {
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

export function traduzirParaLibras(texto) {
  if (!texto || !texto.trim()) return;
  const paraEnviar = marcarNomesProprios(decimaisParaDigitos(numerosParaDigitos(texto.trim())));
  window.__ultimoTextoLibras = paraEnviar;
  enviarParaWidget(paraEnviar);
}

iniciarWidgetVlibras();
