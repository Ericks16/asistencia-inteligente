# 1. Arquitectura del Sistema — Control de Asistencia Inteligente

> Stack seleccionado (decisiones de liderazgo técnico):
> - **Móvil**: React Native (Expo) + TypeScript — un solo lenguaje en todo el stack, acceso nativo a cámara/GPS vía `expo-camera` y `expo-location`.
> - **Web Admin**: Next.js 14 (App Router) + TypeScript + Tailwind.
> - **Backend**: NestJS (Node.js + TypeScript).
> - **Base de datos**: PostgreSQL 16 + Prisma ORM + **pgvector** (incrustaciones faciales).
> - **Visión por computador / IA**: AWS Rekognition (Face Detect + CompareFaces + Face Liveness) con fallback local FaceNet.
> - **Almacenamiento**: S3 + SSE-KMS. **Seguridad**: JWT, TLS 1.3, AES-256-GCM (envelope encryption con KMS).

---

## 1.1 Diagrama de bloques de alto nivel

```mermaid
flowchart TB
    subgraph Mobile["📱 App Móvil (React Native / Expo)"]
        CAM["Cámara frontal\n(buffer directo)"]
        GPS["GPS alta precisión\n+ anti-spoofing"]
        LIV["Liveness SDK\n(challenge-response)"]
        ATTEST["Device Attestation\n(SafetyNet / DeviceCheck)"]
        CAM & GPS & LIV & ATTEST --> CLIENT["Cliente de API\n(tokens + HMAC de foto)"]
    end

    subgraph Edge["🌐 Edge / CDN / WAF"]
        WAF["WAF + Rate Limiting"]
        LB["API Gateway / Load Balancer"]
    end

    subgraph Backend["🖥️ Backend (NestJS)"]
        AUTH["Auth Service\n(login-cedula, JWT, RBAC)"]
        ATTD["Attendance Service\n(check-in/out, group)"]
        FACE["Face Recognition Service\n(Rekognition + pgvector)"]
        CALC["Time Calculation Engine\n(horas + horas extras)"]
        RPT["Reports Service\n(mensual)"]
        AUDIT["Audit Service\n(logs inmutables)"]
    end

    subgraph Data["🗄️ Datos"]
        PG[("PostgreSQL\n(Prisma + pgvector)")]
        S3[("S3 + SSE-KMS\nfotos cifradas")]
        QUEUE[("Cola (SQS/Redis)\nprocesamiento facial")]
    end

    subgraph Ext["🔌 Servicios externos"]
        REK["AWS Rekognition"]
        KMS["AWS KMS"]
    end

    MOBILE_ADMIN["🖥️ Web Admin (Next.js)"] --> WAF

    CLIENT -->|HTTPS/TLS 1.3| WAF
    MOBILE_ADMIN --> WAF
    WAF --> LB --> Backend

    AUTH --> PG
    ATTD --> FACE
    ATTD --> CALC
    ATTD --> S3
    FACE --> REK
    FACE --> PG
    FACE --> QUEUE
    RPT --> PG
    RPT --> S3
    AUDIT --> PG
    KMS --> S3
    KMS --> PG
```

---

## 1.2 Flujo de datos seguro — captura individual (check-in)

```mermaid
sequenceDiagram
    autonumber
    participant M as 📱 App Móvil
    participant API as 🖥️ NestJS API
    participant REK as 🤖 AWS Rekognition
    participant PG as 🗄️ PostgreSQL
    participant S3 as ☁️ S3 (KMS)

    Note over M: 1. Solicita permisos runtime<br/>(cámara + GPS alta precisión)
    M->>API: POST /auth/login-cedula {cedula, pin}
    API->>PG: valida cedula + hash pin (bcrypt/argon2)
    API-->>M: {accessToken, refreshToken, nonce}

    Note over M: 2. Captura directa del buffer de cámara<br/>+ timestamp nativo + GPS + nonce firmado
    M->>M: genera HMAC-SHA256(foto + nonce + deviceId)
    M->>API: POST /attendance/check-in<br/>(multipart: foto, gps, livenessToken, attestation)

    API->>API: verifica nonce + HMAC + device attestation
    API->>REK: Face Liveness (anti-spoofing)
    REK-->>API: {livenessScore}
    API->>REK: Face Detect + embedding (CompareFaces)
    REK-->>API: {matchScore, faceId}

    API->>S3: cifra foto AES-256-GCM y guarda
    API->>PG: INSERT attendance_logs (estado según scores)
    API->>API: calcula horas / horas extras / atraso
    API-->>M: {estado, horaServidor, matchScore, hashFoto}
```

### Pasos clave del flujo (numerados)

1. **Permisos en runtime** — la app pide cámara y ubicación "mientras se usa", nunca implícitos.
2. **Autenticación por cédula** — se valida `cédula + PIN/contraseña`; se emiten JWT de corta vida + refresh token rotativo.
3. **Captura anti-fraude** — la foto sale **directamente del buffer de la cámara** (no hay selector de galería); se captura `timestamp nativo` y se firma un `nonce` emitido por el servidor (anti-replay).
4. **Geolocalización** — se envía lat/long, precisión, proveedor (GPS/fused) y señales anti-mock.
5. **Liveness** — se valida que la imagen sea de una persona viva (no pantalla/impresión) con AWS Rekognition Face Liveness o challenge-response local.
6. **Reconocimiento** — se extrae el embedding facial y se compara contra el embedding de referencia cifrado (pgvector/Rekognition), umbral **≥ 95 %**.
7. **Persistencia cifrada** — la foto se cifra AES-256-GCM (clave KMS) y se guarda en S3; en BD solo se guarda la **referencia + hash**, nunca la imagen en claro.
8. **Cálculo** — el motor de tiempos consolida entrada/salida y genera horas ordinarias, extras y atraso.
9. **Respuesta** — se devuelve `horaServidor` (autoritativa), score y hash, dejando registro inmutable en `audit_logs`.

---

## 1.3 Flujo de asistencia grupal (múltiples rostros)

```mermaid
sequenceDiagram
    autonumber
    participant M as 📱 App (foto grupal)
    participant API as NestJS API
    participant REK as AWS Rekognition
    participant PG as PostgreSQL (pgvector)
    participant Q as Cola (SQS)

    M->>API: POST /attendance/check-in-group (foto + gps)
    API->>API: verifica HMAC + nonce + anti-spoofing GPS
    API->>REK: DetectFaces (todas las caras + bounding boxes)
    REK-->>API: N caras + boxes
    API->>Q: encolar embedding por cada cara
    loop por cada rostro detectado
        API->>REK: FaceEmbedding / CompareFaces
        API->>PG: buscar empleado con similitud >= 95%
        PG-->>API: candidatos (vector search)
    end
    API->>PG: registrar attendance_logs (source=GROUP) para cada match
    API-->>M: {identificados: [...], noIdentificados: [...]}
```

**Reglas del módulo grupal:**
- La foto grupal es **una sola imagen**; `DetectFaces` extrae todas las caras y sus `bounding boxes`.
- Cada cara genera un embedding que se compara contra toda la plantilla de empleados activos.
- Solo se registran automáticamente las coincidencias **≥ 95 %**; el resto se lista como "no identificado".
- Cada match genera un `attendance_log` individual enlazado a la misma `group_attendance_session`.
- Se notifica en pantalla la lista de personas identificadas (con avatar y nombre) y las no identificadas.

---

## 1.4 Componentes del backend (NestJS)

| Módulo | Responsabilidad | Endpoints clave |
|---|---|---|
| `AuthModule` | Login por cédula, refresh, RBAC | `POST /auth/login-cedula`, `POST /auth/refresh` |
| `AttendanceModule` | Check-in/out individual y grupal, validación facial/GPS | `POST /attendance/check-in`, `POST /attendance/check-in-group`, `POST /attendance/check-out` |
| `FaceRecognitionService` | Abstracción sobre Rekognition / FaceNet + pgvector | (interno) |
| `ReportsModule` | Reporte mensual consolidado | `GET /reports/monthly/:employeeId` |
| `AdminModule` | Corrección de asistencias, gestión usuarios, auditoría | `PATCH /admin/attendance/:id`, `GET /admin/audit-logs` |
| `AuditModule` | Registro inmutable de acciones | (interno, escribe `audit_logs`) |
| `TimeCalculationEngine` | Cálculo de horas ordinarias/extras/atraso | (interno, ver `time-calculator.ts`) |

---

## 1.5 Decisiones de escalabilidad

- **Cola (SQS/Redis BullMQ)** para el procesamiento facial pesado: el check-in responde rápido y el match se confirma asíncronamente.
- **pgvector + índice HNSW** para búsqueda de similitud coseno en `O(log n)` cuando hay miles de empleados.
- **Jobs nocturnos (cron)** para el motor de cálculo mensual y cierre consolidado.
- **Read replicas** para reportes y dashboard, escrituras solo en el primario.
- **Caché Redis** para tokens no revocables, rate limits y sesiones activas.
