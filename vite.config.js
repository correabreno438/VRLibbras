import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig({
  base: "./", // caminhos relativos: funciona na raiz e em subpasta (GitHub Pages)
  plugins: [basicSsl()],
  server: {
    https: true,
    host: true, // deixa acessível pelo IP da rede, não só localhost
  },
});