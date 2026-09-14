import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    // host: true permite abrir el juego desde el telefono en la misma red LAN
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2022',
  },
});
