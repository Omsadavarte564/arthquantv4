import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { compile, optimize } from '@tailwindcss/node';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distAssetsDir = path.join(rootDir, 'dist', 'assets');

async function verifyAndProtectCss() {
  console.log('[CSS Guard] Checking production CSS build in dist/assets...');

  if (!fs.existsSync(distAssetsDir)) {
    console.error('[CSS Guard] ERROR: dist/assets directory not found!');
    process.exit(1);
  }

  const files = fs.readdirSync(distAssetsDir);
  const cssFile = files.find(f => f.startsWith('index-') && f.endsWith('.css'));

  if (!cssFile) {
    console.error('[CSS Guard] ERROR: No index-*.css found in dist/assets!');
    process.exit(1);
  }

  const cssPath = path.join(distAssetsDir, cssFile);
  let cssContent = fs.readFileSync(cssPath, 'utf-8');
  const initialSize = Buffer.byteLength(cssContent, 'utf-8');

  console.log(`[CSS Guard] Found ${cssFile} (${initialSize} bytes).`);

  // An unstyled fallback is typically ~4.8 KB to 5.4 KB.
  // A complete Tailwind v4 bundle with all app classes is ~39 KB.
  const isTooSmall = initialSize < 30000;
  const isMissingClasses = !cssContent.includes('.flex') || !cssContent.includes('.grid') || !cssContent.includes('dark\\:bg');

  if (isTooSmall || isMissingClasses) {
    console.warn(`[CSS Guard] WARNING: CSS file is incomplete (${initialSize} bytes). Auto-healing CSS bundle...`);

    // Scan candidate classes from all source files
    const candidates = new Set();
    function scan(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && !['node_modules', 'dist', '.git', '.vscode'].includes(entry.name)) {
          scan(full);
        } else if (entry.isFile() && /\.(tsx|ts|jsx|js|html)$/.test(entry.name)) {
          const text = fs.readFileSync(full, 'utf-8');
          const tokens = text.match(/[a-zA-Z0-9_\-\/\[\]#:%.><+*&!]+(?:\([^)]*\))?/g) || [];
          for (const t of tokens) candidates.add(t);
        }
      }
    }
    scan(rootDir);

    const indexCssPath = path.join(rootDir, 'src', 'index.css');
    const sourceCss = fs.readFileSync(indexCssPath, 'utf-8');
    const compiler = await compile(sourceCss, { base: rootDir, onDependency: () => {} });
    const rawCompiled = compiler.build(Array.from(candidates));
    const optimized = optimize(rawCompiled, { minify: true }).code;

    fs.writeFileSync(cssPath, optimized, 'utf-8');
    const newSize = Buffer.byteLength(optimized, 'utf-8');
    console.log(`[CSS Guard] SUCCESS: Healed ${cssFile} -> ${newSize} bytes (All Tailwind classes generated).`);
  } else {
    console.log(`[CSS Guard] PASS: ${cssFile} is healthy (${initialSize} bytes) with full Tailwind styling.`);
  }
}

verifyAndProtectCss().catch((err) => {
  console.error('[CSS Guard] Uncaught error during verification:', err);
  process.exit(1);
});
