async function start() {
  await import('./server/app.mjs');
}

start().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
