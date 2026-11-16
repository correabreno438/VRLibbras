// =====================================================================
// DICIONÁRIOS EDITÁVEIS DO LibrAR
// Este é o único arquivo que você precisa mexer para ensinar nomes e
// corrigir palavras. Depois de salvar, o app atualiza sozinho.
// =====================================================================

// 1) NOMES PRÓPRIOS
// O reconhecedor de voz escreve tudo em minúsculas, e o avatar de Libras só
// soletra (datilologia) palavras que ele reconhece como nome. Os nomes desta
// lista são enviados com letra maiúscula.
// Escreva em minúsculas, sem se preocupar com acentos. Acrescente os nomes
// de alunos, professores, da escola e da cidade.
export const NOMES_PROPRIOS = [
  "breno",
  // --- nomes comuns no Brasil (pode apagar ou acrescentar) ---
  "ana", "maria", "joao", "jose", "pedro", "paulo", "lucas", "marcos", "carlos", "luiz", "luis",
  "rafael", "bruno", "felipe", "andre", "diego", "thiago", "tiago", "gustavo", "rodrigo", "daniel",
  "gabriel", "matheus", "mateus", "vinicius", "leonardo", "eduardo", "fernando", "ricardo", "roberto",
  "julia", "juliana", "fernanda", "amanda", "camila", "beatriz", "larissa", "leticia", "mariana",
  "patricia", "aline", "carla", "bruna", "vanessa", "sandra", "paula", "rita", "sara", "isabela",
  "gabriela", "raquel", "renata", "tatiane", "luciana", "adriana", "cristina", "viviane", "simone",
];

// 2) CORREÇÕES
// Para palavras que o reconhecedor erra sempre do mesmo jeito.
// Formato: "como o app escreve errado": "como deveria ser",
// sempre em minúsculas. Exemplo:
//   "ao professor": "o professor",
export const CORRECOES = {
};
