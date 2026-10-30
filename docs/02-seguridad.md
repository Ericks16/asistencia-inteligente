# 2. Estrategia de Seguridad

> Objetivo: impedir **manipulación de fotos**, **suplantación de identidad** y **falsificación de GPS**, además de proteger datos biométricos (los más sensibles del sistema).

---

## 2.1 Anti-manipulación de fotos

| # | Control | Implementación |
|---|---|---|
| 1 | **Captura directa del buffer** | `expo-camera` en modo `onPictureTaken` sin pasar por la galería. La app **no implementa** `ImagePicker` para asistencia. |
| 2 | **Metadatos nativos** | Se adjunta `timestamp` nativo del SO + `deviceId` + `sensorData`. El backend lo compara con su reloj. |
| 3 | **Nonce anti-replay** | El backend emite un `nonce` de un solo uso en el login; la app firma `HMAC-SHA256(foto + nonce + deviceId)` con un secreto derivado del token. Una foto reutilizada falla la verificación. |
| 4 | **Hash del lado servidor** | El servidor calcula `SHA-256` (y `MD5` legacy si se requiere) sobre los bytes originales y lo guarda en `attendance_logs.photo_hash`. Cualquier edición posterior cambia el hash. |
| 5 | **Sello de agua digital** | Se incrusta un watermark criptográfico invisible (DCT) con `nonce + timestamp + employeeId`; se valida en backend. |
| 6 | **Cifrado en tránsito y reposo** | TLS 1.3 en tránsito; AES-256-GCM en reposo con envelope encryption (clave de datos cifrada por AWS KMS). |
| 7 | **Prueba de vida (Liveness)** | AWS Rekognition **Face Liveness** o challenge-response (parpadeo/giro de cabeza) detecta pantallas e impresiones. |

## 2.2 Anti-suplantación de identidad

| # | Control | Implementación |
|---|---|---|
| 1 | **2FA implícito por cédula + PIN** | Login por cédula + PIN/contraseña (Argon2id). |
| 2 | **JWT corta vida + refresh rotativo** | Access token 15 min; refresh token rotativo con detección de reuso. |
| 3 | **Device binding / attestation** | Android **Play Integrity / SafetyNet** e iOS **DeviceCheck** vinculan el dispositivo al usuario; un login desde dispositivo no registrado exige verificación. |
| 4 | **Umbral estricto ≥ 95 %** | La comparación facial exige coincidencia ≥ 95 %; bajo ese umbral → `REJECTED` y alerta de auditoría. |
| 5 | **Liveness obligatorio** | Sin liveness positivo, el check-in se marca `PENDING` y no cuenta como válido. |
| 6 | **RBAC estricto** | Empleado: solo lectura de su historial. Admin: correcciones, usuarios, auditoría. Guards `@Roles()` en NestJS. |

## 2.3 Anti-falsificación de GPS

| # | Control | Implementación |
|---|---|---|
| 1 | **Detección de mock location** | Android: `isFromMockProvider()`, lista de apps mock permitidas (`LocationManager`). iOS: `location.isSimulatedBySoftware`. |
| 2 | **Proveedor y precisión** | Se exige `GPS/FUSED` con `accuracy ≤ 20 m`; proveedores "mock"/"network-only" se rechazan o marcan sospechosos. |
| 3 | **Plausibilidad de movimiento** | Se compara contra el último registro: velocidad implícita (desplazamiento/Δt) y saltos imposibles (> 500 km/h) → fraude. |
| 4 | **Geofencing** | La asistencia solo es válida dentro del polígono de la empresa/obra (radio configurable). |
| 5 | **Cruce con IP** | La IP del request se geolocaliza y se compara con el GPS; divergencias grandes disparan alerta. |
| 6 | **Timestamp del servidor autoritativo** | La hora que cuenta es la del servidor (`attendance_logs.server_timestamp`), no la del dispositivo. |
| 7 | **No-root / no-jailbreak** | Detección básica de root/jailbreak como señal de riesgo (no bloqueante, sí auditada). |

## 2.4 Protección de datos biométricos

- **Envelope encryption**: la foto y el embedding se cifran con una *data key* AES-256-GCM; la *data key* se cifra con AWS KMS y se rota.
- **Separación de datos**: en la BD solo se guarda `face_embedding.vector` (irreversible a la imagen) y `photo_ref` (S3); la imagen nunca se guarda en la BD.
- **Acceso mínimo**: solo el `FaceRecognitionService` puede leer embeddings; los reportes enlazan a la foto con **URLs firmadas de corta duración** (S3 presigned).
- **Retención y borrado**: política de retención + borrado físico (purga de S3 + embeddings) al desvincular un empleado.
- **Auditoría inmutable**: cada lectura/escritura sensible queda en `audit_logs` con hash encadenado (append-only).

## 2.5 Defensa en profundidad

```
Cliente  →  WAF + Rate Limit  →  API Gateway  →  JWT/RBAC  →  Validación DTO (class-validator)
        →  Anti-replay (nonce)  →  Liveness  →  Match ≥95%  →  AES-256-GCM  →  Audit Log
```

1. WAF con reglas de rate limiting por IP/token y bloqueo de escaneos.
2. Validación estricta de entrada (`class-validator` + `class-transformer`).
3. Cifrado en todas las capas (tránsito, reposo, campo).
4. Registro de auditoría con hash encadenado (append-only, inmutable).
5. Rotación de secretos y claves; secretos en un *secrets manager*, nunca en el código.
