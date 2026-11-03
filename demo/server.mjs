// ============================================================================
// Demo local del API — Control de Asistencia Inteligente
// Servidor sin dependencias (solo Node core). Implementa el MISMO contrato de
// la OpenAPI para probar de inmediato los endpoints y el motor de cálculo.
//
// Ejecutar:  node demo/server.mjs   →  http://localhost:3000
// ============================================================================
import http from 'node:http';
import crypto from 'node:crypto';
import https from 'node:https';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  computeDaily,
  computeMonthly,
  DEFAULT_SHIFT,
  pairStamps,
} from '../backend/src/attendance/time-calculator.ts';

const PORT = Number(process.env.PORT ?? 3000);
const HTTPS_PORT = Number(process.env.HTTPS_PORT ?? 3443);
const HOST = process.env.HOST ?? '0.0.0.0';
const TZ = 'America/Guayaquil';
const SECRET = 'demo-secret-local';
const PUBLIC_DIR = fileURLToPath(new URL('../backend/public/', import.meta.url));
const CERT_PATH = path.join(PUBLIC_DIR, '..', 'certs', 'server.pfx');

// ---------------------------------------------------------------------------
// "Base de datos" en memoria
// ---------------------------------------------------------------------------
const users = [];

/** @type {any[]} */
const logs = [];
let seq = 1;
const nonces = new Set();

// ---------------------------------------------------------------------------
// Helpers HTTP
// ---------------------------------------------------------------------------
function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj, null, 2));
}
async function servePublic(res, filename, contentType) {
  try {
    const content = await readFile(path.join(PUBLIC_DIR, filename));
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => {
      try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); }
    });
  });
}

// Token "JWT-like" firmado con HMAC.
function signToken(user) {
  const payload = Buffer.from(JSON.stringify({ sub: user.id, cedula: user.cedula, role: user.role })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function verifyToken(req) {
  const h = req.headers.authorization ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return null;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  if (!payload || sig !== expected) return null;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return null; }
}

function dailyFor(employeeId) {
  const dayLogs = logs.filter((l) => l.employeeId === employeeId && l.status !== 'REJECTED');
  const stamps = dayLogs.map((l) => ({ type: l.type, at: new Date(l.serverTimestamp) }));
  const { entry, exit } = pairStamps(stamps, TZ);
  return computeDaily(entry?.at ?? null, exit?.at ?? null, DEFAULT_SHIFT, TZ);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
const requestHandler = async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method;

  try {
    // ---- Landing ---------------------------------------------------------
    if (method === 'GET' && path === '/') {
      if (await servePublic(res, 'index.html', 'text/html; charset=utf-8')) return;
      return send(res, 500, { message: 'No se encontró la interfaz pública' });
    }

    if (method === 'GET' && path === '/logo.jpg') {
      if (await servePublic(res, 'logo.jpg', 'image/jpeg')) return;
      return send(res, 404, { message: 'Logo no encontrado' });
    }

    if (method === 'GET' && path === '/mascota.png') {
      if (await servePublic(res, 'mascota.png', 'image/png')) return;
      return send(res, 404, { message: 'Mascota no encontrada' });
    }

    if (method === 'GET' && path === '/api/v1/health') {
      send(res, 200, { status: 'ok', database: 'memory' });
      return;
    }

    if (method === 'GET' && path === '/health') {
      const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Asistencia Inteligente — Demo API</title>
<style>body{font-family:system-ui,sans-serif;max-width:860px;margin:40px auto;padding:0 20px;color:#1f2937}
code{background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:13px}pre{background:#0f172a;color:#e2e8f0;padding:14px;border-radius:8px;overflow-x:auto}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #e5e7eb;padding:8px;text-align:left}th{background:#f9fafb}h2{margin-top:32px}</style></head>
<body><h1>✅ API de Asistencia Inteligente (demo local)</h1>
<p>Servidor activo en <code>http://localhost:${PORT}</code>. Mismo contrato que la OpenAPI; persiste en memoria.</p>
<h2>Credenciales de prueba</h2>
<p>No hay credenciales demo. Use el backend conectado a la base de datos configurada.</p>
<h2>Prueba rápida (PowerShell)</h2>
<pre># 1) Login
\$t = (Invoke-RestMethod -Method Post -Uri http://localhost:${PORT}/api/v1/auth/login-cedula -ContentType 'application/json' -Body '{"cedula":"1712345678","secret":"1234"}').accessToken

# 2) Marcar entrada a las 07:15
Invoke-RestMethod -Method Post -Uri http://localhost:${PORT}/api/v1/attendance/check-in -Headers @{Authorization="Bearer \$t"} -ContentType 'application/json' -Body '{"serverTimestamp":"2026-10-29T07:15:00-05:00"}'

# 3) Marcar salida a las 18:30
Invoke-RestMethod -Method Post -Uri http://localhost:${PORT}/api/v1/attendance/check-out -Headers @{Authorization="Bearer \$t"} -ContentType 'application/json' -Body '{"serverTimestamp":"2026-10-29T18:30:00-05:00"}'

# 4) Reporte mensual
Invoke-RestMethod -Uri "http://localhost:${PORT}/api/v1/reports/monthly/u-001?year=2026&month=10" -Headers @{Authorization="Bearer \$t"}</pre>
<h2>Endpoints</h2>
<table><tr><th>Método</th><th>Ruta</th></tr>
<tr><td>POST</td><td>/api/v1/auth/login-cedula</td></tr>
<tr><td>POST</td><td>/api/v1/attendance/check-in</td></tr>
<tr><td>POST</td><td>/api/v1/attendance/check-out</td></tr>
<tr><td>POST</td><td>/api/v1/attendance/check-in-group</td></tr>
<tr><td>GET</td><td>/api/v1/reports/monthly/:employeeId?year=&amp;month=</td></tr>
<tr><td>PATCH</td><td>/api/v1/admin/attendance/:id</td></tr>
</table></body></html>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    // ---- Auth ------------------------------------------------------------
    if (method === 'POST' && path === '/api/v1/auth/login-cedula') {
      const { cedula, secret } = await readBody(req);
      const user = users.find((u) => u.cedula === cedula && u.pin === secret);
      if (!user) return send(res, 401, { message: 'Cédula o PIN incorrectos' });
      const nonce = crypto.randomBytes(16).toString('hex');
      nonces.add(nonce);
      return send(res, 200, {
        accessToken: signToken(user),
        refreshToken: crypto.randomBytes(24).toString('base64url'),
        nonce,
        user: { id: user.id, cedula: user.cedula, role: user.role, name: user.name },
      });
    }

    // ---- Attendance (requiere token) -------------------------------------
    const auth = verifyToken(req);
    if (!auth) return send(res, 401, { message: 'Token requerido (Authorization: Bearer ...)' });

    if (method === 'POST' && (path === '/api/v1/attendance/check-in' || path === '/api/v1/attendance/check-out')) {
      const type = path.endsWith('check-out') ? 'CHECK_OUT' : 'CHECK_IN';
      const body = await readBody(req);
      const serverTimestamp = body.serverTimestamp ? new Date(body.serverTimestamp) : new Date();
      if (Number.isNaN(serverTimestamp.getTime())) return send(res, 400, { message: 'serverTimestamp inválido' });

      const log = {
        id: `log-${seq++}`,
        employeeId: auth.sub,
        type,
        serverTimestamp,
        status: 'VALID',
        source: 'INDIVIDUAL',
        faceMatchScore: 0.98,
        gpsLat: body.gps?.latitude ?? -0.1807,
        gpsLng: body.gps?.longitude ?? -78.4678,
      };
      logs.push(log);

      return send(res, 201, {
        id: log.id,
        status: 'VALID',
        serverTimestamp,
        faceMatchScore: 0.98,
        photoHash: crypto.createHash('sha256').update(log.id).digest('hex'),
        computed: dailyFor(auth.sub),
      });
    }

    if (method === 'POST' && path === '/api/v1/attendance/check-in-group') {
      const identified = [];
      return send(res, 202, {
        sessionId: `g-${seq++}`,
        status: 'COMPLETED',
        totalFacesDetected: 0,
        identified,
        unidentifiedCount: 0,
      });
    }

    if (method === 'GET' && path.startsWith('/api/v1/reports/monthly/')) {
      const employeeId = path.split('/').pop();
      const year = Number(url.searchParams.get('year'));
      const month = Number(url.searchParams.get('month'));
      // RBAC: empleado solo su propio reporte.
      if (auth.role === 'EMPLOYEE' && auth.sub !== employeeId) {
        return send(res, 403, { message: 'Solo puede consultar su propio reporte' });
      }

      const monthLogs = logs.filter((l) => l.employeeId === employeeId && l.status !== 'REJECTED');
      const stampsByDate = {};
      for (const l of monthLogs) {
        const d = l.serverTimestamp;
        // Filtrar por año/mes en la zona local.
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (year && (d.getFullYear() !== year)) continue;
        if (month && (d.getMonth() + 1 !== month)) continue;
        (stampsByDate[key] ??= []).push({ type: l.type, at: new Date(l.serverTimestamp) });
      }
      const computed = computeMonthly(stampsByDate, DEFAULT_SHIFT, TZ);
      const employee = users.find((u) => u.id === employeeId) ?? { id: employeeId, name: 'Desconocido' };

      const detail = computed.days.map((day) => {
        const dayLogs = monthLogs.filter((l) => {
          const d = l.serverTimestamp;
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          return key === day.date;
        });
        const withGps = dayLogs[0];
        return {
          date: day.date,
          entryTime: day.entryTime,
          exitTime: day.exitTime,
          overtimeMinutes: day.overtimeMinutes,
          ordinaryMinutes: day.ordinaryMinutes,
          status: day.status,
          photoUrl: null,
          gps: withGps ? { latitude: withGps.gpsLat, longitude: withGps.gpsLng } : null,
        };
      });

      return send(res, 200, {
        employeeId,
        name: employee.name,
        year,
        month,
        daysWorked: computed.daysWorked,
        absences: computed.absences,
        lateArrivalsCount: computed.lateArrivalsCount,
        totalOrdinaryMinutes: computed.totalOrdinaryMinutes,
        totalOvertimeMinutes: computed.totalOvertimeMinutes,
        totalOrdinaryHours: (computed.totalOrdinaryMinutes / 60).toFixed(2),
        totalOvertimeHours: (computed.totalOvertimeMinutes / 60).toFixed(2),
        detail,
      });
    }

    if (method === 'PATCH' && path.startsWith('/api/v1/admin/attendance/')) {
      if (auth.role !== 'ADMIN') return send(res, 403, { message: 'Solo ADMIN puede corregir asistencias' });
      const id = path.split('/').pop();
      const body = await readBody(req);
      if (!body.reason) return send(res, 400, { message: 'El motivo es obligatorio' });
      const log = logs.find((l) => l.id === id);
      if (!log) return send(res, 404, { message: 'Registro no encontrado' });
      const oldValue = { serverTimestamp: log.serverTimestamp, status: log.status };
      if (body.serverTimestamp) log.serverTimestamp = new Date(body.serverTimestamp);
      if (body.status) log.status = body.status;
      if (body.type) log.type = body.type;
      return send(res, 200, { id: log.id, ...log, correction: { reason: body.reason, oldValue, newValue: { serverTimestamp: log.serverTimestamp, status: log.status } } });
    }

    return send(res, 404, { message: `Ruta no encontrada: ${method} ${path}` });
  } catch (err) {
    return send(res, 500, { message: err.message });
  }
};

const httpServer = http.createServer(requestHandler);
httpServer.listen(PORT, HOST, () => {
  console.log(`\n✅ Demo API Asistencia Inteligente → http://localhost:${PORT}`);
  console.log(`   Red local HTTP → http://<IP-DE-ESTE-PC>:${PORT}`);
});

try {
  const pfx = await readFile(CERT_PATH);
  const httpsServer = https.createServer({
    pfx,
    passphrase: process.env.PFX_PASSPHRASE ?? 'asistencia123',
  }, requestHandler);
  httpsServer.listen(HTTPS_PORT, HOST, () => {
    console.log(`   Red local HTTPS → https://<IP-DE-ESTE-PC>:${HTTPS_PORT}`);
    console.log('   Acepta el certificado autofirmado en el teléfono para usar cámara y GPS.');
  });
} catch (error) {
  console.error(`HTTPS no disponible: no se pudo cargar ${CERT_PATH}: ${error.message}`);
}
