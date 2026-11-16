import { statusEl } from "./elementos.js";

// Endereço de um arquivo do app, relativo à página atual. Assim funciona na raiz
// (localhost) e também em subpasta (ex.: usuario.github.io/nome-do-repo/).
export function urlDoApp(caminho) {
  return new URL(caminho, document.baseURI).href;
}

// Aviso visível (na pílula de status) para falhas que o usuário precisa saber.
let avisoTimer = null;
export function avisarErro(mensagem, ms = 8000) {
  console.warn("[Aviso]", mensagem);
  statusEl.textContent = mensagem;
  statusEl.classList.add("erro");
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => statusEl.classList.remove("erro"), ms);
}
export function lerNumeroLocal(chave, padrao) {
  try {
    const v = parseFloat(localStorage.getItem(chave));
    return Number.isFinite(v) ? v : padrao;
  } catch (e) {
    return padrao;
  }
} // depois de acionar, só aciona de novo após tirar a mira da opção

export function normalizar180(graus) {
  return ((((graus + 180) % 360) + 360) % 360) - 180;
}

export function vibrar(ms) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

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
export const parametrosUrl = new URLSearchParams(location.search);
