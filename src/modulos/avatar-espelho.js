import { avatarCarregado, avatarOcupado, prontoEm } from "./vlibras.js";
import { blocosEnviados, blocosRespondidos } from "./voz.js";

// ---- Espelha o avatar nas duas telas (modo VR) -----------------------
export function acharIframeDoAvatar() {
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
export let copiasFeitas = 0;
export let tamanhoOrigem = "?";
export let pixelsAvatar = -1;
let segundosSemImagem = 0;

// Lê os pixels direto do WebGL (readPixels) em vez de drawImage: em alguns
// celulares o drawImage de um canvas WebGL sai vazio, mas a leitura direta
// funciona. O fundo do avatar fica transparente.
const quadroTemp = document.createElement("canvas");
let proporcaoAtual = "";
let glAvatar = null;
let bufPixels = null;
let imagemTemp = null;
export let infoLeitura = "?";

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

export function copiarQuadroDoAvatar(win) {
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

export function espelharAvatarNasTelas() {
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
