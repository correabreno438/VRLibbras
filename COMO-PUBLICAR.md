# Publicar o LibrAR no Vercel

## 1) No projeto (uma vez)
1. Extraia este zip na pasta do projeto, aceitando substituir `index.html` e `src/modulos/pwa.js`.
2. Apague a pasta `.github/workflows` se ela existir (era para o GitHub Pages).
3. No `package.json`, troque a linha do build por:
   `"build": "vite build && node scripts/gerar-lista-offline.mjs",`
4. Teste: `npm run build` deve terminar com a linha `[offline] ... arquivos ... MB listados`.
5. Envie ao GitHub (commit e push).

## 2) No Vercel (uma vez)
1. Entre em vercel.com com sua conta do GitHub.
2. **Add New > Project** e escolha o repositório.
3. Deixe como está: Framework **Vite**, build `npm run build`, saída `dist` (o `vercel.json` já define isso).
4. Clique em **Deploy**. O endereço sai no formato `nome-do-projeto.vercel.app`.

Depois disso, cada push ao GitHub publica uma versão nova sozinho.

## 3) Instalar no celular
1. Abra o endereço no Chrome, com Wi-Fi.
2. Aceite câmera, microfone e sensores.
3. Aguarde a mensagem "Pronto! O LibrAR já funciona sem internet." (a primeira vez baixa cerca de 100 MB).
4. Menu do Chrome (três pontos) > **Instalar app**.

## Atualizar arquivos que não mudam de nome
Se trocar algo da pasta `vlibras-app` ou o modelo de voz sem mudar o nome do arquivo,
aumente o número de `VERSAO` em `public/sw.js` (de "1" para "2"). Os celulares baixam tudo de novo.
