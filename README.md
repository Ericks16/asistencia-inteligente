# Sistema de Control de Asistencia Inteligente

Arquitectura completa, modelos de datos, APIs y código base de un sistema de
asistencia **móvil + web** con reconocimiento facial individual y grupal,
geolocalización anti-fraude y cálculo automático de horas extras.

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Móvil | React Native (Expo) + TypeScript (`expo-camera`, `expo-location`) |
| Web Admin | Next.js 14 + TypeScript + Tailwind |
| Backend | NestJS (Node.js + TypeScript) |
| Base de datos | PostgreSQL 16 + Prisma + **pgvector** |
| Visión por computador | AWS Rekognition (Face Detect / CompareFaces / Face Liveness) + fallback FaceNet |
| Almacenamiento | S3 + SSE-KMS (fotos cifradas) |
| Seguridad | JWT, TLS 1.3, AES-256-GCM (envelope encryption), HMAC anti-replay |

## Estructura del repositorio

```
asistencia-inteligente/
├── docs/
│   ├── 01-arquitectura.md      # Diagramas de bloques + flujo de datos seguro
│   └── 02-seguridad.md         # Estrategia anti-manipulación / anti-suplantación / anti-GPS
├── openapi/
│   └── openapi.yaml            # Especificación OpenAPI 3.1 (endpoints REST)
└── backend/
    ├── prisma/schema.prisma    # Esquema completo de base de datos
    ├── package.json
    ├── tsconfig.json
    ├── .env.example
    └── src/
        ├── main.ts / app.module.ts
        ├── prisma/             # PrismaService
        ├── common/             # guards (JWT/Roles), decorators, interfaces
        ├── auth/               # login-cedula, refresh, logout (JWT + Argon2id)
        ├── attendance/         # check-in/out individual y grupal
        │   ├── time-calculator.ts   # Motor de horas y horas extras (con tests)
        │   ├── face-recognition.service.ts
        │   ├── gps-validator.ts     # Anti-spoofing GPS + geofence
        │   └── crypto.util.ts       # AES-256-GCM + HMAC + SHA-256
        ├── reports/            # Reporte mensual consolidado
        ├── admin/              # Corrección de asistencias (solo ADMIN)
        └── audit/              # Auditoría append-only (hash encadenado)
```

## Reglas de negocio (jornada)

- Entrada oficial **08:00**, salida **17:00**, almuerzo **1 h** (12:00–13:00, sin marcar).
- Horas ordinarias efectivas: **8 h** (480 min).
- Entrada antes de 08:00 → **Horas Extra de Entrada**.
- Salida después de 17:00 → **Horas Extra de Salida**.
- Entrada después de 08:00 → **Atraso** (con tolerancia configurable de 5 min).
- Salida antes de 17:00 → **Salida temprana** (descuento de ordinarias).

### Ejemplo (caso borde)

Entra **07:15** y sale **18:30**:

| Concepto | Cálculo | Resultado |
|---|---|---|
| Extra de entrada | 08:00 − 07:15 | **45 min** |
| Extra de salida | 18:30 − 17:00 | **90 min** |
| Total extras | 45 + 90 | **135 min** |
| Ordinarias | 480 min | **480 min** |
| Total trabajado | 480 + 135 | **615 min** (10 h 15 min) |

## Quickstart (backend)

```bash
cd backend
pnpm install            # o npm install
cp .env.example .env    # configurar DATABASE_URL, JWT_SECRET, credenciales AWS
docker compose up -d    # PostgreSQL + pgvector local
pnpm prisma:generate
pnpm prisma:push       # prototipo local sin migraciones versionadas
pnpm prisma:seed
pnpm start:dev
```

Probar el motor de cálculo:

```bash
pnpm test:time
# ✔ Caso borde: entra 07:15 y sale 18:30 ... extra=135m ordinarias=480m total=615m
# ✔ Todos los casos pasaron
```

## Probar desde un teléfono en la red local

Conecta el teléfono y el computador a la misma red Wi-Fi. Abre PowerShell
como administrador y permite los puertos de la red:

```powershell
.\backend\scripts\allow-lan.ps1
```

Inicia el demo desde la raíz del proyecto:

```powershell
node demo/server.mjs
```

En el teléfono abre `https://192.168.100.119:3443` (reemplaza la IP por la
IPv4 del computador). El certificado local es autofirmado: acepta la
advertencia de seguridad en el navegador. En Android, si el navegador no
permite continuar, ejecuta como administrador:

```powershell
.\backend\scripts\generar-certificado-android.ps1
```

Copia `backend/certs/asistencia-lan-ca.cer` al teléfono y ve a **Ajustes >
Seguridad > Más ajustes de seguridad > Instalar desde almacenamiento**.
Selecciona **certificado de CA** e instala el archivo. Después abre de nuevo
`https://192.168.100.119:3443`. Debe usarse HTTPS para que el navegador
permita cámara y geolocalización por IP.

## Persistencia y retención para Vercel

Para producción configura `PHOTO_STORAGE_PROVIDER=s3`. El backend cifra cada
foto con AES-256-GCM antes de subirla al bucket S3-compatible y guarda en
PostgreSQL únicamente la referencia, el hash y los metadatos de la marca.
Supabase Storage puede usarse proporcionando su endpoint S3 y credenciales.

Variables mínimas:

```env
DATABASE_URL="postgresql://..."
PHOTO_STORAGE_PROVIDER="s3"
AWS_REGION="us-east-1"
AWS_S3_BUCKET="asistencia-fotos"
AWS_ACCESS_KEY_ID="..."
AWS_SECRET_ACCESS_KEY="..."
PHOTO_ENCRYPTION_KEY="..." # Base64 de 32 bytes
PHOTO_RETENTION_DAYS="45"
CRON_SECRET="..."
```

La ruta `POST /api/v1/retention/purge` elimina diariamente los registros,
horas extra, sesiones grupales y fotos con más de 45 días. `vercel.json`
programa la ejecución diaria a las 03:00 UTC. Vercel Cron envía
`Authorization: Bearer $CRON_SECRET`.

## Endpoints principales

| Método | Ruta | Descripción | Rol |
|---|---|---|---|
| POST | `/api/v1/auth/login-cedula` | Login por cédula + PIN/contraseña | Público |
| POST | `/api/v1/auth/refresh` | Renovar tokens (rotación) | Público |
| POST | `/api/v1/attendance/check-in` | Entrada individual (foto + GPS + liveness) | Empleado |
| POST | `/api/v1/attendance/check-out` | Salida individual | Empleado |
| POST | `/api/v1/attendance/check-in-group` | Asistencia grupal (múltiples rostros) | Empleado/Admin |
| GET | `/api/v1/attendance/history/:employeeId` | Historial personal | Empleado (propio) / Admin |
| GET | `/api/v1/reports/monthly/:employeeId` | Reporte mensual consolidado | Empleado (propio) / Admin |
| PATCH | `/api/v1/admin/attendance/:id` | Corrección de asistencia | **Solo Admin** |
| GET | `/api/v1/admin/audit-logs` | Consulta de auditoría | **Solo Admin** |
| GET | `/api/v1/admin/reports/monthly` | Reportes de todos | **Solo Admin** |

Especificación completa en [`openapi/openapi.yaml`](openapi/openapi.yaml).

## Notas de producción (siguientes pasos)

- Añadir límites de tamaño y validación MIME en el módulo de subida.
- Configurar `PHOTO_STORAGE_PROVIDER=s3` y `PHOTO_ENCRYPTION_KEY` en producción.
- Reemplazar el bucle de comparación grupal por búsqueda HNSW en `pgvector` o
  `SearchFacesByImage` de Rekognition para miles de empleados.
- Añadir cola (SQS/BullMQ) para procesar el match facial de forma asíncrona.
- Vercel Cron ya ejecuta la limpieza de retención en `/api/v1/retention/purge`;
  el cierre mensual (`MonthlyReport`) puede programarse como tarea separada.
- Móvil: `expo-camera` en modo frontal sin selector de galería; `expo-location`
  con `accuracy: high`; SDK de liveness de AWS; HMAC del buffer de foto.
- Web admin: pantallas de dashboard, gestión de usuarios/horarios, correcciones
  y exportación de reportes (XLSX/PDF).
