import { defineConfig } from 'vite';

// In development the page comes from Vite and everything else from the game server.
const gameServer = 'http://localhost:8080';

export default defineConfig({
  build: { target: 'esnext' },
  server: {
    host: true,
    proxy: {
      '/ws': { target: gameServer, ws: true },
      '/regions': gameServer,
      // xfwd tells the server who is really asking: only the host may make areas.
      '/api': { target: gameServer, xfwd: true },
    },
  },
});
