# API del área privada

Referencia de la API HTTP que utiliza el portal web y que consume la app móvil
(React Native). Todas las rutas viven bajo `/api/` y responden JSON, salvo la
descarga de PDF.

- URL base de producción: la misma que el portal, por ejemplo `https://piso.example.com`.
- Cuerpo de las peticiones: `Content-Type: application/json` (excepto la subida de PDF).
- Errores: código HTTP 4xx/5xx y cuerpo `{ "error": "Mensaje en castellano listo para mostrar" }`.
- Importes: siempre en céntimos (`amountCents`). Fechas `dueDate` en formato `YYYY-MM-DD`;
  `createdAt` y `expiresAt` en ISO 8601 UTC.
- Identificadores numéricos (`id`, `tenantId`) como enteros.

## Autenticación

Existen dos mecanismos que comparten la misma tabla de sesiones:

| Cliente | Mecanismo | Inicio de sesión | Caducidad |
| --- | --- | --- | --- |
| Portal web | Cookie `HttpOnly` `SameSite=Strict` | `POST /api/login` | `SESSION_DAYS` (7 días) |
| App móvil | `Authorization: Bearer <token>` | `POST /api/auth/token` | `API_TOKEN_DAYS` (30 días) |

La app móvil debe usar siempre el token Bearer. Guárdalo en almacenamiento
seguro (`expo-secure-store`, Keychain, Keystore), nunca en `AsyncStorage`.

Las peticiones con cabecera `Authorization` quedan exentas de la comprobación
de origen (CSRF) porque el token se adjunta de forma explícita. Las peticiones
con cookie que modifican datos deben tener un `Origin` igual al del servidor o
incluido en `CORS_ORIGINS`.

### `POST /api/auth/token`

Obtiene un token Bearer. Limitado a 10 intentos por IP cada 15 minutos (`429`).

```json
{ "email": "inquilino@example.com", "password": "Secreta123" }
```

Respuesta `200`:

```json
{
  "token": "Zx…43-caracteres…",
  "tokenType": "Bearer",
  "expiresAt": "2026-10-09T10:00:00.000Z",
  "user": { "id": 3, "email": "inquilino@example.com", "name": "Ana", "role": "tenant" }
}
```

Errores: `401` credenciales incorrectas o cuenta desactivada, `429` demasiados intentos.

### `POST /api/auth/refresh`

Requiere Bearer. Emite un token nuevo con caducidad completa y revoca el
actual. Misma respuesta que `/api/auth/token`. Conviene llamarlo al abrir la app
cuando falten pocos días para `expiresAt`.

### `POST /api/logout`

Revoca la sesión actual (cookie o Bearer). Responde `{ "ok": true }`.

### `GET /api/me`

Devuelve el usuario autenticado: `{ "user": { id, email, name, role } }`.
`role` es `admin` o `tenant`. Un `401` indica que el token ha caducado o ha
sido revocado (por ejemplo, al desactivar la cuenta, cambiar la contraseña o
enviar un email de bienvenida): la app debe volver a la pantalla de acceso.

## Área privada (cualquier usuario autenticado)

### `GET /api/wifi`

```json
{
  "wifi": {
    "recommendedSsid": "MOVISTAR_PLUS_3050",
    "secondarySsid": "MOVISTAR_3050",
    "password": "…",
    "security": "WPA2-PSK"
  }
}
```

`503` si el servidor no tiene configurada la clave WiFi.

### `GET /api/documents`

Listado paginado (10 por página). Un inquilino ve los documentos `shared` y los
`private` asignados a él; el administrador ve todos.

Parámetros opcionales:

| Parámetro | Valores |
| --- | --- |
| `page` | Entero ≥ 1. Si supera el total se devuelve la última página. |
| `kind` | `invoice`, `contract`, `other` |
| `status` | `information`, `pending`, `paid`, `overdue` |
| `utilityType` | `electricity`, `water`, `gas`, `other` (implica `kind=invoice`) |

Respuesta:

```json
{
  "documents": [
    {
      "id": 12,
      "kind": "invoice",
      "utilityType": "electricity",
      "title": "Luz julio",
      "period": "Julio 2026",
      "amountCents": 5432,
      "dueDate": "2026-08-15",
      "status": "pending",
      "visibility": "shared",
      "tenantId": null,
      "tenantName": null,
      "originalName": "factura-luz-julio.pdf",
      "sizeBytes": 183422,
      "createdAt": "2026-08-01T09:12:00.000Z",
      "fileUrl": "/api/documents/12/file"
    }
  ],
  "attentionDocuments": [ … hasta 6 facturas pendientes o vencidas … ],
  "pagination": { "page": 1, "pageSize": 10, "total": 23, "totalPages": 3 },
  "summary": { "documentCount": 23, "pendingInvoiceCount": 2, "pendingAmountCents": 9876 }
}
```

### `GET /api/documents/:id/file`

Devuelve el PDF (`application/pdf`, `Content-Disposition: inline`). Hay dos
formas de autorizar la descarga:

1. Cabecera `Authorization: Bearer …` (por ejemplo con `expo-file-system`
   `downloadAsync`, que admite cabeceras).
2. Parámetro `?access=<token firmado>` obtenido con el endpoint siguiente, para
   abrir el PDF en un visor nativo, `WebView` o `Linking.openURL` donde no se
   pueden añadir cabeceras.

### `POST /api/documents/:id/link`

Genera un enlace de descarga firmado, de un solo documento y de corta duración
(`DOWNLOAD_LINK_SECONDS`, 5 minutos por defecto). Requiere acceso al documento.

```json
{ "url": "https://piso.example.com/api/documents/12/file?access=12.3.1757400000.k3…", "expiresAt": "2026-09-09T10:05:00.000Z" }
```

Pide un enlace nuevo cada vez que el usuario vaya a abrir el documento; no lo
guardes.

## Administración (solo `role=admin`)

Las mismas rutas que usa el panel web; devuelven `403` a un inquilino.

| Método y ruta | Descripción |
| --- | --- |
| `GET /api/admin/users` | Lista de usuarios con `documentCount`. |
| `POST /api/admin/users` | Alta de inquilino: `{ email, name, phone, password, passwordConfirmation }`. `phone` en formato internacional (`+34…`). `409` si el correo existe. |
| `PATCH /api/admin/users/:id` | Edita `name`, `email`, `phone`, `active` y/o `password` + `passwordConfirmation`. Desactivar o cambiar contraseña revoca sus sesiones. |
| `POST /api/admin/users/:id/welcome` | Genera contraseña temporal, revoca sesiones y envía el email de bienvenida. |
| `DELETE /api/admin/users/:id` | Elimina al inquilino y sus documentos privados. |
| `POST /api/admin/documents?…` | Sube un PDF. Metadatos en la query string (`kind`, `utilityType`, `title`, `period`, `amountCents`, `dueDate`, `status`, `visibility`, `tenantId`); cuerpo binario con `Content-Type: application/pdf` y cabecera `X-File-Name` con el nombre codificado con `encodeURIComponent`. Máximo `MAX_PDF_BYTES` (12 MB). |
| `PATCH /api/admin/documents/:id` | Edita los metadatos anteriores en JSON. |
| `DELETE /api/admin/documents/:id` | Elimina el documento y su PDF. |

Reglas: los documentos `private` deben tener `tenantId` y los `shared` no; solo
las facturas admiten `utilityType`; `status` por defecto es `pending` en
facturas e `information` en el resto.

## Otros

- `GET /api/health`: `{ "ok": true }` si la base de datos responde.
- CORS: solo se emiten cabeceras `Access-Control-*` para los orígenes de
  `CORS_ORIGINS`. Las apps nativas de iOS y Android no necesitan CORS; añade el
  origen únicamente para Expo Web o herramientas de desarrollo en navegador.

## Ejemplo mínimo en React Native

```ts
const BASE_URL = 'https://piso.example.com';

async function api<T>(path: string, token?: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error ?? 'No se ha podido completar la operación.');
  return payload as T;
}

const { token } = await api<{ token: string }>('/api/auth/token', undefined, {
  method: 'POST',
  body: JSON.stringify({ email, password }),
});
const { documents } = await api<{ documents: Document[] }>('/api/documents?kind=invoice', token);
const { url } = await api<{ url: string }>(`/api/documents/${documents[0].id}/link`, token, { method: 'POST' });
await Linking.openURL(url);
```
