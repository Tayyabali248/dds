// Bundles the shared TypeScript source into dist/chrome and dist/firefox.
// Only the manifest differs per target - everything else (background.js,
// content.js, popup.js/html/css) is the exact same output copied into both.
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'extension', 'src');
const DIST = path.join(ROOT, 'extension', 'dist');

const watch = process.argv.includes('--watch');

const entryPoints = {
  background: path.join(SRC, 'background', 'service-worker.ts'),
  content: path.join(SRC, 'content', 'content-script.ts'),
  popup: path.join(SRC, 'popup', 'popup.ts'),
};

const targets = [
  { name: 'chrome', manifest: 'manifest.chrome.json' },
  { name: 'firefox', manifest: 'manifest.firefox.json' },
];

function ensureCleanDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function copyStaticFiles(targetDir) {
  fs.copyFileSync(path.join(SRC, 'popup', 'popup.html'), path.join(targetDir, 'popup.html'));
  fs.copyFileSync(path.join(SRC, 'popup', 'popup.css'), path.join(targetDir, 'popup.css'));
}

function copyManifest(targetDir, manifestFile) {
  fs.copyFileSync(path.join(ROOT, 'extension', manifestFile), path.join(targetDir, 'manifest.json'));
}

async function buildOnce() {
  for (const target of targets) ensureCleanDir(path.join(DIST, target.name));

  const result = await esbuild.build({
    entryPoints,
    bundle: true,
    format: 'iife',
    target: 'es2020',
    outdir: path.join(DIST, '.bundle'),
    sourcemap: true,
    logLevel: 'info',
  });

  for (const target of targets) {
    const targetDir = path.join(DIST, target.name);
    for (const name of Object.keys(entryPoints)) {
      const fileName = `${name}.js`;
      fs.copyFileSync(path.join(DIST, '.bundle', fileName), path.join(targetDir, fileName));
      const mapFile = `${fileName}.map`;
      if (fs.existsSync(path.join(DIST, '.bundle', mapFile))) {
        fs.copyFileSync(path.join(DIST, '.bundle', mapFile), path.join(targetDir, mapFile));
      }
    }
    copyStaticFiles(targetDir);
    copyManifest(targetDir, target.manifest);
  }

  fs.rmSync(path.join(DIST, '.bundle'), { recursive: true, force: true });
  console.log('\nBuilt extension/dist/chrome and extension/dist/firefox');
  return result;
}

async function buildWatch() {
  for (const target of targets) ensureCleanDir(path.join(DIST, target.name));

  const ctx = await esbuild.context({
    entryPoints,
    bundle: true,
    format: 'iife',
    target: 'es2020',
    outdir: path.join(DIST, '.bundle'),
    sourcemap: true,
    logLevel: 'info',
    plugins: [
      {
        name: 'copy-to-targets',
        setup(build) {
          build.onEnd(() => {
            for (const target of targets) {
              const targetDir = path.join(DIST, target.name);
              for (const name of Object.keys(entryPoints)) {
                const fileName = `${name}.js`;
                const src = path.join(DIST, '.bundle', fileName);
                if (fs.existsSync(src)) fs.copyFileSync(src, path.join(targetDir, fileName));
              }
              copyStaticFiles(targetDir);
              copyManifest(targetDir, target.manifest);
            }
            console.log('Rebuilt.');
          });
        },
      },
    ],
  });

  await ctx.watch();
  console.log('Watching for changes... (Ctrl+C to stop)');
}

(watch ? buildWatch() : buildOnce()).catch((err) => {
  console.error(err);
  process.exit(1);
});
