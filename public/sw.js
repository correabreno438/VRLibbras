// Service Worker simples para permitir que o app (interface, câmera e
// avatar do VLibras) abra mesmo sem internet. O reconhecimento de voz
// continua precisando de conexão (isso é uma limitação da Web Speech API
// do navegador, não deste service worker).

const CACHE_NAME = "libras-vr-cache-v1";

// Ajuste esta lista se os caminhos reais dos arquivos forem diferentes
// no seu projeto (ex.: se usar Vite, o nome do bundle final muda).
const ARQUIVOS_PARA_CACHE = [
  "/",
  "/index.html",
  "/src/main.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // addAll falha inteiro se um arquivo não existir; por isso adicionamos
      // um a um e ignoramos falhas individuais (ex.: assets do VLibras que
      // só existem depois do primeiro carregamento).
      return Promise.all(
        ARQUIVOS_PARA_CACHE.map((url) =>
          cache.add(url).catch((err) => console.warn("[SW] Não cacheou", url, err))
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((nomes) =>
      Promise.all(
        nomes
          .filter((nome) => nome !== CACHE_NAME)
          .map((nome) => caches.delete(nome))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Só intercepta GET; e deixa passar direto chamadas de rede que não são
  // do próprio site (ex.: reconhecimento de voz usa conexões internas do
  // navegador, não fetch, então nem passa por aqui).
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((respostaCache) => {
      if (respostaCache) return respostaCache;

      return fetch(event.request)
        .then((respostaRede) => {
          // Guarda uma cópia no cache para a próxima vez que estiver offline.
          const copia = respostaRede.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
          return respostaRede;
        })
        .catch(() => {
          // Sem rede e sem cache para esse arquivo: não tem o que fazer.
          return respostaCache;
        });
    })
  );
});
