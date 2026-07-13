# Maria Berdiales 10 - Segundo B

La pagina se ha extraido del bundle original y su maquetacion se organiza con
Tailwind CSS.

## Editar y previsualizar

1. Instala las dependencias una vez con `npm install`.
2. Edita `index.html` y `assets/styles.css`.
3. Ejecuta `npm run dev`.
4. Abre <http://localhost:4173>.

`assets/styles.css` contiene los tokens del tema y los componentes reutilizables
creados con Tailwind. El HTML queda reservado para contenido y estructura, sin
estilos inline. Durante el desarrollo, Tailwind recompila `assets/tailwind.css`
automaticamente. La configuracion del tema y de las redes WiFi esta en
`assets/app.js`; las bibliotecas de terceros estan en `assets/vendor/`.

## Generar el fichero unico

```sh
npm run build
```

El comando compila primero el CSS de Tailwind y escribe el resultado final en
`dist/index.html`. Este fichero incluye estilos, fuentes, imagen y scripts, por
lo que puede publicarse o abrirse por separado.
Si ya estaba abierto en el navegador durante una recompilacion, recarga la
pagina para que vuelva a leer el fichero generado.

El script `scripts/extract-bundle.mjs` documenta la conversion desde el formato
antiguo y se puede reutilizar pasando las rutas de entrada y salida:

```sh
node scripts/extract-bundle.mjs bundle-antiguo.html index.html
```
