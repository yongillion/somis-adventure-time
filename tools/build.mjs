// Release build: bundles the ES modules into one script so the game also runs
// straight from disk (file://) and loads faster on phones.
//   npm install && npm run build   -> dist/ (index.html, game.js, css/, icon.svg, manifest)
import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'css'), { recursive: true });

const res = await esbuild.build({
  entryPoints: [path.join(ROOT, 'js/main.js')],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  minify: true,
  keepNames: true,
  legalComments: 'none',
  outfile: path.join(OUT, 'game.js'),
  metafile: true,
  logLevel: 'warning',
});
const bytes = Object.values(res.metafile.outputs).reduce((a, o) => a + o.bytes, 0);

// index.html: same page, classic script instead of the module entry
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
// the root page picks bundle vs. modules at runtime; dist/ always uses the bundle next to it
const before = html;
html = html.replace(/<script>\s*\/\/ Players get[\s\S]*?<\/script>/, '<script src="game.js"></script>');
if (html === before) throw new Error('build: could not find the loader <script> in index.html');
fs.writeFileSync(path.join(OUT, 'index.html'), html);
fs.copyFileSync(path.join(ROOT, 'css/style.css'), path.join(OUT, 'css/style.css'));
for (const f of ['icon.svg', 'manifest.webmanifest']) fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
fs.writeFileSync(path.join(OUT, '.nojekyll'), ''); // GitHub Pages: serve files as-is
console.log(`dist/game.js ${(bytes / 1024).toFixed(0)} KB`);
