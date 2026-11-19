import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  server: {
    allowedHosts: [".manus.computer", "localhost", "127.0.0.1"],
  },
  build: {
    rollupOptions: {
      input: {
        storefront: resolve(process.cwd(), "index.html"),
        admin: resolve(process.cwd(), "admin.html"),
        product: resolve(process.cwd(), "product.html"),
      },
    },
  },
});
