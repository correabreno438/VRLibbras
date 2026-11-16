import { avisar } from "./voz.js";
import { parametrosUrl } from "./util.js";

// ---------------------------------------------------------------
// 7) PWA: funcionar sem internet e poder ser instalado na tela inicial
// ---------------------------------------------------------------
// O service worker (public/sw.js) guarda o app, o modelo de voz e o avatar no
// celular. Só funciona em endereço HTTPS válido (ex.: Vercel) ou em localhost;
// no servidor de desenvolvimento com certificado próprio o navegador recusa e o
// app segue funcionando normalmente, só sem o modo offline.
if ("serviceWorker" in navigator && window.isSecureContext && !parametrosUrl.has("semsw")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((e) => console.log("[PWA] sem service worker:", e && e.message));
  });
  // Pede ao navegador para não apagar os arquivos guardados (modelo de voz e avatar são grandes).
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // Mensagens do service worker sobre o download para uso offline.
  navigator.serviceWorker.addEventListener("message", (ev) => {
    const m = ev.data;
    if (!m || !m.tipo) return;
    if (m.tipo === "progresso" && m.total) {
      avisar("Baixando para usar sem internet: " + Math.min(100, Math.round((m.feitos / m.total) * 100)) + "%");
    } else if (m.tipo === "pronto" && m.novos > 0) {
      avisar("Pronto! O LibrAR já funciona sem internet.");
    } else if (m.tipo === "incompleto") {
      console.log("[PWA] download offline incompleto, tentando de novo na próxima abertura");
    }
  });

  // Pouco depois de abrir (e com internet), baixa tudo para o modo offline.
  // No 4G/dados móveis ou com economia de dados, espera o Wi-Fi.
  window.addEventListener("load", () => {
    setTimeout(async () => {
      if (!navigator.onLine) return;
      const con = navigator.connection;
      if (con && (con.saveData || con.type === "cellular")) {
        console.log("[PWA] dados móveis: o download offline espera o Wi-Fi");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.ready;
        if (reg.active) reg.active.postMessage({ tipo: "baixar-tudo" });
      } catch (e) {}
    }, 4000);
  });
}
