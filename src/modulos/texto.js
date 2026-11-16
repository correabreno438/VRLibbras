import { CORRECOES, NOMES_PROPRIOS } from "./nomes.js";

// O Vosk escreve números por extenso ("dois mil e vinte e seis"). O VLibras
// sinaliza melhor números escritos em dígitos ("2026"), então convertemos.
export const NUM_UNIDADES = { zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
  dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19 };
export const NUM_DEZENAS = { vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90 };
export const NUM_CENTENAS = { cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300, quatrocentos: 400, quatrocentas: 400,
  quinhentos: 500, quinhentas: 500, seiscentos: 600, seiscentas: 600, setecentos: 700, setecentas: 700, oitocentos: 800, oitocentas: 800,
  novecentos: 900, novecentas: 900 };
export const NUM_MULT = { mil: 1000, milhao: 1e6, milhoes: 1e6, bilhao: 1e9, bilhoes: 1e9 };

export function semAcento(p) {
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

export function numerosParaDigitos(texto) {
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
const GATILHOS_NOME = ["chamo", "chama", "chamado", "chamada"]; // até 3 palavras seguintes
const GATILHOS_TITULO = ["professor", "professora", "doutor", "doutora", "seu", "dona", "senhor", "senhora", "colega", "amigo", "amiga"]; // 1 palavra
const NAO_NOME = new Set(["e", "o", "a", "os", "as", "de", "do", "da", "dos", "das", "um", "uma", "que", "eu", "voce", "ele", "ela", "nao", "sim", "aqui", "hoje", "hora", "horas", "meu", "minha", "nome", "bom", "boa", "dia", "tarde", "noite", "tenho", "sou", "moro", "trabalho", "estou", "vou", "vim", "disse", "falou", "esta", "foi", "vai", "tem", "mais", "mas", "para", "com", "na", "no", "em"]);

function capitalizar(p) {
  return p.charAt(0).toUpperCase() + p.slice(1);
}

export function marcarNomesProprios(texto) {
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

export function decimaisParaDigitos(texto) {
  // "3 vírgula 5" -> "3,5"
  return texto.replace(/(\d+)\s+v[ií]rgula\s+(\d+)/gi, "$1,$2");
}

// Troca palavras que o reconhecedor erra sempre igual (lista CORRECOES, em nomes.js).
const chavesCorrecao = Object.keys(CORRECOES).sort((a, b) => b.length - a.length);
const regexCorrecoes = chavesCorrecao.length
  ? new RegExp("(^|\\s)(" + chavesCorrecao.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")(?=\\s|$)", "gi")
  : null;
export function aplicarCorrecoes(texto) {
  if (!regexCorrecoes || !texto) return texto;
  return texto.replace(regexCorrecoes, (_, inicio, achado) => inicio + CORRECOES[achado.toLowerCase()]);
}
