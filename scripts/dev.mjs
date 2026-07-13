import { spawn } from 'child_process';
import path from 'path';
import url from 'url';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const executable = path.resolve(root, 'node_modules/.bin/tailwind');

const tailwind = spawn(executable, [
  '-c', './tailwind.config.cjs',
  '-i', './assets/styles.css',
  '-o', './assets/tailwind.css',
  '--watch',
], { cwd: root, stdio: 'inherit' });

const server = spawn(process.execPath, ['scripts/serve.mjs'], {
  cwd: root,
  stdio: 'inherit',
});

function stop() {
  tailwind.kill('SIGTERM');
  server.kill('SIGTERM');
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

for (const child of [tailwind, server]) {
  child.on('exit', (code) => {
    if (code && code !== 0) process.exitCode = code;
  });
}
