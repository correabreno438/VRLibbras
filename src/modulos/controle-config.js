import { estado } from "./estado.js";
import { lerNumeroLocal } from "./util.js";

// ---------------------------------------------------------------
// 5) Controle pela cabeça com mira (sem tocar no celular, sem falar)
// ---------------------------------------------------------------
// Uma mira (pontinho) acompanha o movimento da cabeça.
//   1) Leve a mira até a BORDA ESQUERDA da imagem: as opções aparecem ali,
//      em coluna, pequenas.
//   2) Leve a mira para CIMA de uma opção e fique olhando: um anel enche e,
//      quando fecha, a opção liga ou desliga.
//   3) Volte a mira para o CENTRO: as opções somem.
// Usa o giroscópio do celular (funciona offline).
export const OLHAR = {
  graus_horizontal: 24, // giro da cabeça que leva a mira do centro até a borda
  graus_vertical: 20, // subida/descida da cabeça que leva a mira do centro até a borda
  abrirAbaixoDeX: 14, // % da largura: mira abaixo disso (borda esquerda) abre as opções
  fecharAcimaDeX: 36, // % da largura: mira passando disso (voltou ao centro) fecha as opções
  abrirSegurarMs: 250, // tempo com a mira na borda para abrir (evita abrir sem querer)
  tempoParaAcionarMs: 1200, // tempo com a mira sobre a opção até ligar/desligar
  esperaAposAbrirMs: 600, // logo que abre, não aciona nada por este tempo
  margemMira: 6, // % de folga: a mira para nesta distância da borda da imagem
  recentrar: 0.002, // quão rápido o "centro" acompanha a postura da cabeça (0 = nunca)
};

// Sensibilidade e tempo de espera ajustáveis por pessoa (painel ?ajuste), salvos no celular.
const OLHAR_BASE = { h: OLHAR.graus_horizontal, v: OLHAR.graus_vertical };
estado.ajusteSens = lerNumeroLocal("libras-vr:sens", 1); // 1 = padrão; maior = a mira anda mais com o mesmo giro
estado.ajusteTempo = lerNumeroLocal("libras-vr:tempo", OLHAR.tempoParaAcionarMs); // ms com a mira sobre a opção
export function aplicarOlhar() {
  OLHAR.graus_horizontal = OLHAR_BASE.h / estado.ajusteSens;
  OLHAR.graus_vertical = OLHAR_BASE.v / estado.ajusteSens;
  OLHAR.tempoParaAcionarMs = estado.ajusteTempo;
}
aplicarOlhar();
