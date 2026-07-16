# María Berdiales 10 — Segundo B

Guía de la vivienda y portal privado para compartir contratos y facturas con
los inquilinos. La interfaz utiliza Tailwind CSS y el servidor usa Node,
Prisma ORM y MySQL.

## Funcionalidad privada

- Cuenta individual para cada inquilino.
- Alta y edición de inquilinos con confirmación de contraseña y un mínimo de
  8 caracteres que incluya mayúsculas, minúsculas y números.
- Activación, desactivación y eliminación de cuentas desde Administración.
- Facturas compartidas con todos los inquilinos activos.
- Contratos privados asignados a una única persona.
- Seguimiento del estado, importe y suministro de cada factura: luz, agua, gas
  u otros.
- Listado paginado desde el servidor, con 10 documentos por página y filtros
  combinables.
- Panel de administración para crear usuarios y publicar, editar o eliminar documentos.
- PDF almacenados fuera del directorio público y de Git.
- Credenciales WiFi disponibles únicamente tras iniciar sesión, con contraseña
  enmascarada, copia directa y QR generado después de la autenticación.

## Desarrollo local

Se requiere Node 20.19 o posterior y una instancia MySQL 8.

```sh
npm install
cp .env.example .env
npm run dev
```

Antes de iniciar, edita `.env`, completa las variables `MYSQL_*`,
`ADMIN_EMAIL`, `ADMIN_PASSWORD` y `WIFI_PASSWORD`, y crea la base y el usuario MySQL indicados.
La contraseña del administrador debe ser una frase de paso de al menos 15
caracteres. Aplica primero el esquema con `npm run db:deploy`; el servidor carga
`.env` y sus valores no se incluyen en Git.

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
cp secrets/wifi_password.example secrets/wifi_password.txt
cp secrets/mysql_password.example secrets/mysql_password.txt
cp secrets/mysql_root_password.example secrets/mysql_root_password.txt
chmod 600 .env secrets/*.txt
```

Edita `.env` con el dominio y correo reales. Sustituye el contenido de
los cuatro archivos de `secrets/` por contraseñas únicas. La contraseña del
administrador debe tener al menos 15 caracteres. Después ejecuta:

```sh
docker compose up -d --build
docker compose logs -f app
```

El dominio debe apuntar a la IP del VPS y los puertos 80 y 443 deben estar
abiertos. Caddy obtiene y renueva automáticamente el certificado HTTPS.

Los volúmenes `mysql_data` y `documents` contienen respectivamente MySQL y los
PDF. Deben incluirse en las copias de seguridad del VPS. Los secretos, la base
de datos y los documentos están excluidos del repositorio.

## Despliegue en Plesk con Git y Node.js

El servidor necesita **Node.js 20.19 o posterior** y una base de datos MySQL.
En Plesk deben estar instaladas las extensiones **Git** y **Node.js Toolkit**.

1. Crea el dominio o subdominio y abre **Sitios web y dominios > Git**.
2. Añade el repositorio remoto, selecciona la rama de producción y despliega
   el proyecto, por ejemplo, en `httpdocs/app`.
3. En **Sitios web y dominios > Node.js**, configura:

   - Versión de Node.js: `20.19`, `22.12` o posterior.
   - Modo de aplicación: `Production`.
   - Raíz de la aplicación: `httpdocs/app` o el directorio elegido en Git.
   - Raíz del documento: `httpdocs/app/public`.
   - Archivo de inicio: `_passenger.cjs`.
   - Gestor de paquetes: `npm`.

4. Añade estas variables desde **Variables de entorno personalizadas**:

   ```text
   ADMIN_EMAIL=propietario@example.com
   ADMIN_NAME=Administrador
   ADMIN_PASSWORD=una-frase-de-paso-unica-de-al-menos-15-caracteres
   WIFI_RECOMMENDED_SSID=MOVISTAR_PLUS_3050
   WIFI_SECONDARY_SSID=MOVISTAR_3050
   WIFI_PASSWORD=clave-real-de-la-red-wifi
   MYSQL_HOST=localhost
   MYSQL_PORT=3306
   MYSQL_DATABASE=nombre_de_la_base_en_plesk
   MYSQL_USER=usuario_de_la_base_en_plesk
   MYSQL_PASSWORD=contraseña_de_la_base_en_plesk
   STORAGE_DIR=/ruta/persistente/privada/documents
   SESSION_DAYS=7
   MAX_PDF_BYTES=12582912
   ```

   Crea primero la base y el usuario desde **Bases de datos** en Plesk.
   `STORAGE_DIR` debe apuntar a un directorio escribible por el usuario de la
   suscripción y situado fuera del directorio que Git reemplaza en cada
   despliegue. No definas `PORT`: Plesk lo proporciona a la aplicación.

5. Pulsa **NPM Install** y ejecuta `npm run db:deploy` para aplicar las
   migraciones versionadas de Prisma. Después pulsa **Habilitar Node.js** o
   **Reiniciar aplicación**. El servidor crea el primer administrador en el
   primer arranque. Comprueba `/api/health` y activa el certificado Let's Encrypt.

   Si estás migrando una instalación SQLite existente, ejecuta primero el
   procedimiento de migración siguiente y reinicia la aplicación solo cuando
   la importación haya terminado.

Para futuras publicaciones: haz commit y push, ejecuta **Pull Updates** y
**Deploy** en Git si usas despliegue manual, y finalmente **Restart App** en
Node.js. Con despliegue automático, Plesk puede recibir los cambios mediante el
webhook mostrado en la configuración del repositorio.

## Migración desde SQLite a MySQL

El migrador conserva los identificadores, usuarios, hashes de contraseña,
sesiones y documentos. No modifica el SQLite original y solo permite importar
en tablas MySQL vacías.

1. Haz una copia de seguridad de `data/app.sqlite` y del directorio de PDF.
2. Crea una base MySQL vacía y configura las variables `MYSQL_*`.
3. Para este único paso, selecciona Node.js 24 y ejecuta:

   ```sh
   npm install
   npm run migrate:sqlite -- /ruta/absoluta/app.sqlite
   ```

4. Arranca la aplicación y verifica el acceso del administrador, los usuarios
   y la descarga de varios documentos.
5. Conserva el SQLite hasta confirmar el funcionamiento y las copias de
   seguridad de MySQL.

La aplicación funciona con Node.js 20.19 o posterior. El migrador requiere Node.js
22.5 o posterior porque lee el archivo antiguo mediante `node:sqlite`; se
recomienda Node.js 24 para evitar avisos experimentales.

### Base MySQL creada antes de incorporar Prisma

Si la base ya contiene las tablas y datos importados por la versión anterior,
no vuelvas a ejecutar el migrador SQLite ni la migración inicial. Registra esa
migración como aplicada una única vez:

```sh
npm run db:baseline
npm run db:deploy
```

A partir de ahí, las siguientes versiones se despliegan siempre con
`npm run db:deploy`. No uses `prisma migrate dev` en producción.

## Generar la guía autocontenida

```sh
npm run build
```

El resultado se escribe en `dist/index.html`. Este fichero conserva la guía
autocontenida, pero no contiene el portal, la base de datos, ningún documento
privado ni las credenciales o el QR de la red WiFi.

## Estructura de datos

- MySQL gestionado mediante `prisma/schema.prisma`: usuarios, sesiones y metadatos.
- `private-storage/`: PDF con nombres internos aleatorios; no versionado.
- La clave WiFi se recibe desde `WIFI_PASSWORD` o `WIFI_PASSWORD_FILE` y solo
  se entrega mediante `/api/wifi` a usuarios con una sesión válida.
- Las contraseñas se almacenan mediante `scrypt` con una sal aleatoria.
- Las sesiones utilizan cookies `HttpOnly`, `Secure` y `SameSite=Strict` en
  producción.
