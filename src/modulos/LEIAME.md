# Módulos do LibrAR

Cada arquivo cuida de uma parte do sistema. A ordem abaixo é a ordem em que
`src/main.js` inicia cada um.

| Módulo | O que faz |
| --- | --- |
| `elementos.js` | Pega na página os elementos usados pelo resto (status, legenda, botões, vídeos) |
| `util.js` | Funções pequenas: endereço de arquivos do app, aviso de erro, vibração, leitura de números salvos, parâmetros da URL |
| `camera.js` | Liga a câmera traseira e mostra nos dois olhos |
| `preferencias.js` | Liga e desliga Legenda e VLibras e guarda a escolha no celular |
| `conexao.js` | Mostra se está online ou offline |
| `texto.js` | Prepara o texto antes do avatar: números por extenso, decimais, nomes próprios e correções |
| `nomes.js` | **Dicionários editáveis**: nomes próprios e correções de palavras |
| `vlibras.js` | Widget oficial do VLibras, fila de frases e envio ao avatar |
| `avatar-espelho.js` | Copia a imagem do avatar para as duas telas, sem fundo, recortada |
| `voz.js` | Reconhecimento de voz offline (Vosk), microfone, legenda e envio antecipado ao avatar |
| `controle-config.js` | Ajustes do controle com a cabeça (sensibilidade e tempo de espera) |
| `tutorial.js` | Tutorial da primeira abertura, feito com a mira |
| `modo-camera.js` | Modo "só câmera" (esconde legenda e avatar) |
| `calibracao.js` | Calibração do "olhar em frente" |
| `controle-ui.js` | Desenho da lista de opções e da mira |
| `controle-cabeca.js` | Sensor de movimento, mira e lógica de abrir/acionar opções |
| `moldura.js` | Moldura preta estilo óculos VR e configurações de layout |
| `tela-vr.js` | Legenda e avisos em cada olho, tela cheia, bloqueio de orientação |
| `ajuste.js` | Painel de calibração (só com `?ajuste` no endereço) |
| `pwa.js` | Registro do service worker (modo offline e instalação) |
| `ciclo-de-vida.js` | O que fazer ao sair e voltar para o app (pausar áudio, tela acesa, calibrar) |
| `estado.js` | Valores de ajuste que mais de um módulo precisa alterar |

## Como ensinar nomes ao sistema

Abra `nomes.js`, acrescente o nome em minúsculas na lista `NOMES_PROPRIOS`
e salve. O app atualiza sozinho.
