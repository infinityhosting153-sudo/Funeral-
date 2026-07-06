import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
    plugins: [react(), tailwindcss()],
    build: {
        rollupOptions: {
            output: {
                manualChunks: {
                    react: ['react', 'react-dom', 'react-router-dom'],
                    firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
                    charts: ['recharts'],
                    forms: ['react-hook-form', 'zod', '@hookform/resolvers/zod'],
                    export: ['jspdf', 'xlsx'],
                    query: ['@tanstack/react-query'],
                    icons: ['lucide-react'],
                },
            },
        },
    },
});
