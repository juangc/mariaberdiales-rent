import fs from 'fs';
import path from 'path';
import url from 'url';

const { readFile, mkdir, writeFile } = fs.promises;
const { dirname, extname, resolve } = path;
const { fileURLToPath } = url;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, '..');
const sourcePath = resolve(root, 'index.html');
const outputPath = resolve(root, 'dist/index.html');

const mimeTypes = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

function replaceFirstLiteral(contents, search, replacement) {
  const index = contents.indexOf(search);
  if (index === -1) throw new Error(`No se encontro en index.html: ${search}`);
  return contents.slice(0, index) + replacement + contents.slice(index + search.length);
}

function countScriptBlocks(contents) {
  const openingTag = /<script(?:\s|>)/gi;
  const closingTag = /<\/script\s*>/gi;
  let count = 0;
  let cursor = 0;

  while (true) {
    openingTag.lastIndex = cursor;
    const opening = openingTag.exec(contents);
    if (!opening) return count;

    closingTag.lastIndex = openingTag.lastIndex;
    const closing = closingTag.exec(contents);
    if (!closing) throw new Error('Hay una etiqueta <script> sin cerrar');

    count += 1;
    cursor = closingTag.lastIndex;
  }
}

async function main() {
  let html = await readFile(sourcePath, 'utf8');
  const expectedScriptBlocks = countScriptBlocks(html);

  // Tailwind se compila antes de este script y su resultado se inserta aqui.
  const stylesheetPattern = /<link\s+rel="stylesheet"\s+href="(assets\/[^"]+\.css(?:\?[^"]*)?)"\s*>/g;
  const stylesheetResources = [...html.matchAll(stylesheetPattern)].map((match) => match[1]);
  for (const resourcePath of stylesheetResources) {
    const relativePath = resourcePath.split('?')[0];
    const stylesheetDirectory = path.posix.dirname(relativePath);
    const source = (await readFile(resolve(root, relativePath), 'utf8')).replace(
      /url\((["']?)(?!data:|https?:|\/)([^)"']+)\1\)/g,
      (_, quote, assetPath) => `url(${quote}${path.posix.join(stylesheetDirectory, assetPath)}${quote})`,
    );
    html = replaceFirstLiteral(
      html,
      `<link rel="stylesheet" href="${resourcePath}">`,
      `<style>${source}</style>`,
    );
  }

  // Los scripts locales se insertan en el mismo orden en el que aparecen.
  const scriptPattern = /<script\s+src="(assets\/[^"]+\.js(?:\?[^"]*)?)"\s*><\/script>/g;
  const scriptResources = [...html.matchAll(scriptPattern)].map((match) => match[1]);
  for (const resourcePath of scriptResources) {
    const relativePath = resourcePath.split('?')[0];
    const source = await readFile(resolve(root, relativePath), 'utf8');
    const dataUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
    html = replaceFirstLiteral(
      html,
      `<script src="${resourcePath}"></script>`,
      `<script src="${dataUrl}"></script>`,
    );
  }

  // Las fuentes e imagenes se convierten en data URI para mantener un unico fichero.
  const assetPattern = /assets\/[A-Za-z0-9_./-]+\.(?:jpe?g|png|svg|webp|woff2)/g;
  const assetPaths = [...new Set(html.match(assetPattern) || [])];
  for (const relativePath of assetPaths) {
    const mime = mimeTypes[extname(relativePath).toLowerCase()];
    if (!mime) throw new Error(`Tipo MIME desconocido para ${relativePath}`);
    const contents = await readFile(resolve(root, relativePath));
    html = html
      .split(relativePath)
      .join(`data:${mime};base64,${contents.toString('base64')}`);
  }

  html = html.replace(
    '<!-- Fuente editable. Ejecuta `npm run build` para crear el bundle de distribucion. -->',
    '<!-- Generado automaticamente desde index.html con `npm run build`. -->',
  );

  const unresolvedAssets = html.match(/(?:src|href)="assets\//g) || [];
  const generatedScriptBlocks = countScriptBlocks(html);
  if (unresolvedAssets.length) {
    throw new Error(`El bundle conserva ${unresolvedAssets.length} recursos locales sin embeber`);
  }
  if (generatedScriptBlocks !== expectedScriptBlocks) {
    throw new Error(
      `El HTML fuente tiene ${expectedScriptBlocks} scripts y el bundle generado ${generatedScriptBlocks}`,
    );
  }

  await mkdir(resolve(root, 'dist'), { recursive: true });
  await writeFile(outputPath, html);
  console.log(`Bundle creado en ${outputPath}`);
  console.log(`${stylesheetResources.length} estilos, ${scriptResources.length} scripts y ${assetPaths.length} recursos embebidos`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
