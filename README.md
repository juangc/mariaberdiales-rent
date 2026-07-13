# María Berdiales 10 — Segundo B

Guía de la vivienda y portal privado para compartir contratos y facturas con
los inquilinos. La interfaz utiliza Tailwind CSS y el servidor usa Node y
SQLite.

## Funcionalidad privada

- Cuenta individual para cada inquilino.
- Facturas compartidas con todos los inquilinos activos.
- Contratos privados asignados a una única persona.
- Seguimiento del estado, importe y suministro de cada factura: luz, agua, gas
  u otros.
- Panel de administración para crear usuarios y publicar, editar o eliminar documentos.
- PDF almacenados fuera del directorio público y de Git.

## Desarrollo local

Se requiere Node 24 o posterior para utilizar el módulo SQLite integrado sin
los avisos experimentales de Node 22.

```sh
npm install
cp .env.example .env
npm run dev
```

Antes de iniciar, edita `.env` y completa `ADMIN_EMAIL` y `ADMIN_PASSWORD`. La
contraseña debe ser una frase de paso de al menos 15 caracteres. El servidor
carga automáticamente este archivo; sus valores no se incluyen en Git.

La guía estará en <http://localhost:3000> y el portal privado en
<http://localhost:3000/portal>. Tailwind recompila los estilos automáticamente.

Para previsualizar únicamente la guía estática puede usarse `npm run dev:static`.

`assets/styles.css` contiene los tokens del tema y los componentes reutilizables
creados con Tailwind. `assets/app.js` configura la guía y `assets/portal.js`
gestiona la interfaz privada. El servidor y la API están en `server/`.

## Despliegue en un VPS

El despliegue incluye la aplicación y Caddy como proxy HTTPS. Antes de iniciarlo:

```sh
cp .env.example .env
mkdir -p secrets
cp secrets/admin_password.example secrets/admin_password.txt
chmod 600 .env secrets/admin_password.txt
```

Edita `.env` con el dominio y correo reales. Sustituye el contenido de
`secrets/admin_password.txt` por una frase de paso única de al menos 15
caracteres. Después ejecuta:

```sh
docker compose up -d --build
docker compose logs -f app
```

El dominio debe apuntar a la IP del VPS y los puertos 80 y 443 deben estar
abiertos. Caddy obtiene y renueva automáticamente el certificado HTTPS.

Los volúmenes `app_data` y `documents` contienen respectivamente SQLite y los
PDF. Deben incluirse en las copias de seguridad del VPS. Los secretos, la base
de datos y los documentos están excluidos del repositorio.

## Generar la guía autocontenida

```sh
npm run build
```

El resultado se escribe en `dist/index.html`. Este fichero conserva la guía
autocontenida, pero no contiene el portal, la base de datos ni ningún documento
privado.

## Estructura de datos

- `data/app.sqlite`: usuarios, sesiones y metadatos; no versionado.
- `private-storage/`: PDF con nombres internos aleatorios; no versionado.
- Las contraseñas se almacenan mediante `scrypt` con una sal aleatoria.
- Las sesiones utilizan cookies `HttpOnly`, `Secure` y `SameSite=Strict` en
  producción.

El script `scripts/extract-bundle.mjs` conserva la utilidad de conversión del
formato antiguo:

```sh
node scripts/extract-bundle.mjs bundle-antiguo.html index.html
```
