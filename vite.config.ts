import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, type Plugin } from 'vite';
import { compile, optimize } from '@tailwindcss/node';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Universal Tailwind v4 Vite Plugin
 * Bypasses Windows Node 24 native oxide / WASI path resolution limitations
 * by scanning candidate tokens using standard Node.js filesystem APIs.
 */
function tailwindUniversalPlugin(): Plugin {
  return {
    name: 'vite-plugin-tailwind-universal',
    enforce: 'pre',
    async transform(code: string, id: string) {
      if (id.endsWith('index.css') || id.includes('src/index.css')) {
        const rootDir = __dirname;
        const candidates = new Set<string>();

        function scanDir(dir: string) {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory() && !['node_modules', 'dist', '.git', '.vscode', 'test-dist'].includes(entry.name)) {
              scanDir(full);
            } else if (entry.isFile() && /\.(tsx|ts|jsx|js|html)$/.test(entry.name)) {
              const text = fs.readFileSync(full, 'utf-8');
              const tokens = text.match(/[a-zA-Z0-9_\-\/\[\]#:%.><+*&!]+(?:\([^)]*\))?/g) || [];
              for (const t of tokens) candidates.add(t);
            }
          }
        }
        scanDir(rootDir);

        const compiler = await compile(code, {
          base: rootDir,
          onDependency: () => {},
        });

        const built = compiler.build(Array.from(candidates));
        const isProd = process.env.NODE_ENV === 'production';
        const result = optimize(built, { minify: isProd });
        return {
          code: result.code,
          map: null,
        };
      }
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [
      tailwindUniversalPlugin(),
      react(),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(import.meta.dirname, 'dist');
          const srcAssets = path.resolve(import.meta.dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, { recursive: true, force: true });
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
