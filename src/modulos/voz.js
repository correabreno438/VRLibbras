import { createModel } from "vosk-browser";
import { captionEl, micBtn, statusEl } from "./elementos.js";
import { urlDoApp } from "./util.js";
import { legendaAtiva, vlibrasAtivo } from "./preferencias.js";
import { aplicarCorrecoes, NUM_CENTENAS, NUM_DEZENAS, NUM_MULT, NUM_UNIDADES, semAcento } from "./texto.js";
import { prontoEm, traduzirParaLibras } from "./vlibras.js";
import { copiasFeitas, infoLeitura, pixelsAvatar, tamanhoOrigem } from "./avatar-espelho.js";
import { textoSensor } from "./controle-cabeca.js";

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
const MODELO_URL = urlDoApp("assets/vosk/vosk-model-small-pt-0.3.tar.gz");
const TAXA_AMOSTRAGEM = 16000; // Vosk espera áudio em 16kHz mono

let modelo = null;
let reconhecedor = null;
export let modeloVozPronto = false;
let isListening = false;

export let audioContext = null;
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

// Envio antecipado ao avatar: em vez de esperar a pessoa terminar a frase, o avatar
// recebe as palavras já "firmes" (iguais em dois parciais seguidos) em pedaços.
// Assim ele começa a sinalizar enquanto a pessoa ainda fala.
const MIN_PALAVRAS_ANTECIPADAS = 3; // só manda pedaços com pelo menos 3 palavras novas
let parcialAnterior = "";
const NAO_TERMINAR_EM = new Set(["e", "de", "do", "da", "dos", "das", "o", "a", "os", "as", "um", "uma", "uns", "umas",
  "que", "em", "no", "na", "nos", "nas", "para", "pra", "com", "por", "mais", "mil", "milhao", "milhoes", "virgula", "ou", "se", "como"]);
function palavraFragil(palavra) {
  const p = semAcento(palavra);
  return NAO_TERMINAR_EM.has(p) || p in NUM_UNIDADES || p in NUM_DEZENAS || p in NUM_CENTENAS || p in NUM_MULT;
}
function enviarAntecipado(texto) {
  const atuais = texto.split(" ");
  const antes = parcialAnterior ? parcialAnterior.split(" ") : [];
  parcialAnterior = texto;
  let firmes = 0;
  while (firmes < atuais.length && firmes < antes.length && atuais[firmes] === antes[firmes]) firmes++;
  // Se o Vosk reescreveu o que já foi enviado, espera ele se acertar.
  if (parcialJaEnviado && !(texto + " ").startsWith(parcialJaEnviado + " ")) return;
  const jaEnviadas = parcialJaEnviado ? parcialJaEnviado.split(" ").length : 0;
  let ate = firmes - 1; // a última palavra firme ainda pode mudar: fica de fora
  while (ate > jaEnviadas && palavraFragil(atuais[ate - 1])) ate--;
  if (ate - jaEnviadas < MIN_PALAVRAS_ANTECIPADAS) return;
  const trecho = atuais.slice(jaEnviadas, ate).join(" ");
  parcialJaEnviado = atuais.slice(0, ate).join(" ");
  traduzirParaLibras(trecho);
}
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
export let transcricaoAtiva = false;
let timerAviso = null;

const DICA_INICIAL = "Leve a mira ao canto esquerdo para abrir as opções";

export function avisar(mensagem, voltarPara) {
  statusEl.textContent = mensagem;
  clearTimeout(timerAviso);
  timerAviso = setTimeout(() => {
    statusEl.textContent = voltarPara ?? (transcricaoAtiva ? "Ouvindo..." : DICA_INICIAL);
  }, 3000);
}

export function definirTranscricao(ativa) {
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

async function carregarModeloVoz() {
  try {
    statusEl.textContent = "Carregando modelo de voz (só demora na 1ª vez)...";
    modelo = await createModel(MODELO_URL);

    reconhecedor = new modelo.KaldiRecognizer(TAXA_AMOSTRAGEM);
    reconhecedor.setWords(false);

    reconhecedor.on("partialresult", (mensagem) => {
      blocosRespondidos++;
      const texto = aplicarCorrecoes(mensagem.result.partial);
      if (!texto) return;
      if (!transcricaoAtiva) return;

      mostrarLegenda(texto);
      ultimoParcial = texto;
      if (vlibrasAtivo) enviarAntecipado(texto);

      // Normalmente o VLibras recebe a frase quando o Vosk a finaliza (evento
      // "result"). Este timer só cobre falas longas sem pausa.
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        if (ultimoParcial) {
          const todo = ultimoParcial;
          const resto = parcialJaEnviado && (todo + " ").startsWith(parcialJaEnviado + " ") ? todo.slice(parcialJaEnviado.length).trim() : todo;
          parcialJaEnviado = todo;
          fixarNaLegenda(todo); // a fala fica na legenda mesmo que o Vosk não a finalize
          if (resto) traduzirParaLibras(resto);
          ultimoParcial = "";
          parcialAnterior = "";
          legendaParcialFixada = todo;
        }
      }, TEMPO_SILENCIO_MS);
    });

    reconhecedor.on("result", (mensagem) => {
      blocosRespondidos++;
      const texto = aplicarCorrecoes(mensagem.result.text);
      clearTimeout(silenceTimer);
      ultimoParcial = "";
      parcialAnterior = "";
      if (!texto) return;
      if (!transcricaoAtiva) return;

      // Se já mandamos o começo da frase, manda só o que faltou.
      let paraEnviar = texto;
      if (parcialJaEnviado && (texto + " ").startsWith(parcialJaEnviado + " ")) {
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
export let blocosEnviados = 0;
export let blocosRespondidos = 0;
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
    // Só manda áudio ao reconhecedor quando há voz (e um pouco depois, para ele
    // fechar a frase). Em silêncio o celular fica livre.
    const LIMIAR_VOZ = 0.004; // mais sensível: pega falas baixas e o começo das palavras
    const FOLGA_APOS_VOZ_MS = 1500;
    let ultimaVozEm = 0;
    let estavaEnviando = false;
    const antes = []; // últimos blocos, para não cortar o começo da fala
    taxaReal = audioContext.sampleRate;

    const tratarBloco = (amostras) => {
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
        if (antes.length > 8) antes.shift();
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

    // AudioWorklet roda fora da thread principal (não trava a animação do avatar).
    // Se o navegador não tiver, cai no ScriptProcessor, que é mais antigo mas funciona.
    let usouWorklet = false;
    if (audioContext.audioWorklet && typeof AudioWorkletNode !== "undefined") {
      try {
        const codigo = `
          class Captura extends AudioWorkletProcessor {
            constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
            process(entradas) {
              const c = entradas[0] && entradas[0][0];
              if (!c) return true;
              for (let i = 0; i < c.length; i++) {
                this.buf[this.n++] = c[i];
                if (this.n === this.buf.length) {
                  this.port.postMessage(this.buf);
                  this.buf = new Float32Array(2048);
                  this.n = 0;
                }
              }
              return true;
            }
          }
          registerProcessor("captura-voz", Captura);`;
        const urlCodigo = URL.createObjectURL(new Blob([codigo], { type: "application/javascript" }));
        await audioContext.audioWorklet.addModule(urlCodigo);
        URL.revokeObjectURL(urlCodigo);
        processorNode = new AudioWorkletNode(audioContext, "captura-voz", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
        processorNode.port.onmessage = (ev) => tratarBloco(ev.data);
        const mudo = audioContext.createGain();
        mudo.gain.value = 0; // sem eco: o áudio não sai pelo alto-falante
        sourceNode.connect(processorNode);
        processorNode.connect(mudo);
        mudo.connect(audioContext.destination);
        usouWorklet = true;
      } catch (e) {
        console.warn("[Áudio] AudioWorklet indisponível, usando ScriptProcessor:", e && e.message);
      }
    }
    if (!usouWorklet) {
      processorNode = audioContext.createScriptProcessor(4096, 1, 1);
      processorNode.onaudioprocess = (event) => tratarBloco(event.inputBuffer.getChannelData(0));
      sourceNode.connect(processorNode);
      processorNode.connect(audioContext.destination);
    }

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
