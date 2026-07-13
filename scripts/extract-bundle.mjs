import fs from 'fs';
import path from 'path';
import url from 'url';
import zlib from 'zlib';

const { mkdir, readFile, writeFile } = fs.promises;
const { dirname, resolve } = path;
const { fileURLToPath } = url;
const { gunzipSync } = zlib;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, '..');
const inputPath = resolve(root, process.argv[2] || 'index.html');
const outputPath = resolve(root, process.argv[3] || 'index.html');

const assetNames = {
  '8afb7f1f-3aff-447c-bc30-6812119ed48c': 'assets/images/lumia-capital.jpg',
  'a2fdbd98-93e2-49be-a486-9e16c52a71be': 'assets/vendor/qrcode.js',
  '31b518eb-8a42-45b4-9ef4-42a8aa12ff5a': 'assets/vendor/dc-runtime.js',
  '62adaa4b-2cb9-4150-86a4-2a346483a922': 'assets/vendor/react.js',
  'b6c82928-897a-403e-8330-eea5865895bd': 'assets/vendor/react-dom.js',
  '82521d86-70d0-4511-9b85-d70f083629fc': 'assets/fonts/big-shoulders-display-vietnamese.woff2',
  '5084d3a8-412b-4f1b-a114-e4c5241fdff9': 'assets/fonts/big-shoulders-display-latin-ext.woff2',
  '96062c72-d40a-4469-87fe-6917c8fa2286': 'assets/fonts/big-shoulders-display-latin.woff2',
  'bdeb3af2-c5cc-4745-80b0-cb6a9e795957': 'assets/fonts/hanken-grotesk-cyrillic-ext.woff2',
  '73566d44-d7c4-4881-b007-0f6e737cbee1': 'assets/fonts/hanken-grotesk-vietnamese.woff2',
  '0e956bf6-c9f6-41d1-aa92-e4790c0bb2f5': 'assets/fonts/hanken-grotesk-latin-ext.woff2',
  '1f6423eb-418f-47c5-93aa-82e6fab56697': 'assets/fonts/hanken-grotesk-latin.woff2',
  '85ba330a-ae22-45fa-b728-c3555695669f': 'assets/fonts/space-mono-regular-vietnamese.woff2',
  'd49a5655-d469-40f8-82d6-62beb1eba3f8': 'assets/fonts/space-mono-regular-latin-ext.woff2',
  '5c77419a-a613-4d1c-b03a-9dd052c62bc1': 'assets/fonts/space-mono-regular-latin.woff2',
  '4c6fdba0-0a30-40e2-b3ae-dd1f5cba7518': 'assets/fonts/space-mono-bold-vietnamese.woff2',
  '36a9515f-f2ba-49a2-b8c7-3be999172caa': 'assets/fonts/space-mono-bold-latin-ext.woff2',
  '514d4d7f-06db-447d-89fc-b14e65a35ed9': 'assets/fonts/space-mono-bold-latin.woff2',
};

function readBundleBlock(source, type) {
  const pattern = new RegExp(
    `<script type="__bundler/${type}">\\s*([\\s\\S]*?)\\s*<\\/script>`,
  );
  const match = source.match(pattern);
  if (!match) throw new Error(`No se encontro el bloque ${type} en ${inputPath}`);
  return JSON.parse(match[1]);
}

async function main() {
  const bundle = await readFile(inputPath, 'utf8');
  const manifest = readBundleBlock(bundle, 'manifest');
  let html = readBundleBlock(bundle, 'template');

  for (const [uuid, entry] of Object.entries(manifest)) {
    const relativePath = assetNames[uuid];
    if (!relativePath) throw new Error(`Falta un nombre legible para el recurso ${uuid}`);

    let contents = Buffer.from(entry.data, 'base64');
    if (entry.compressed) contents = gunzipSync(contents);

    const assetPath = resolve(root, relativePath);
    await mkdir(dirname(assetPath), { recursive: true });
    await writeFile(assetPath, contents);
    html = html.split(uuid).join(relativePath);
  }

  const runtimeTag = '<script src="assets/vendor/dc-runtime.js"></script>';
  html = html.replace(
    runtimeTag,
    [
      '<script src="assets/vendor/react.js"></script>',
      '<script src="assets/vendor/react-dom.js"></script>',
      runtimeTag,
    ].join('\n'),
  );
  html = html.replace(/\n<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">/g, '');
  html = html.replace(/\n<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin="">/g, '');
  html = html.replace(
    '<!DOCTYPE html>',
    '<!DOCTYPE html>\n<!-- Fuente editable. Ejecuta `npm run build` para crear el bundle de distribucion. -->',
  );

  await writeFile(outputPath, html);
  console.log(`HTML extraido en ${outputPath}`);
  console.log(`${Object.keys(manifest).length} recursos escritos en assets/`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
