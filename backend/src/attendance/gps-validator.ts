import { BadRequestException } from '@nestjs/common';
import { GpsDto } from './dto/check-in.dto';

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Distancia haversine en metros entre dos puntos. */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Validador anti-spoofing de GPS.
 * Combina: proveedor mock, precisión, geofence y plausibilidad de movimiento.
 */
export function validateGps(
  gps: GpsDto,
  opts: {
    maxAccuracyM: number;
    geofenceCenter?: GeoPoint;
    geofenceRadiusM: number;
    lastKnown?: GeoPoint & { at: Date };
  },
): { valid: boolean; insideGeofence: boolean; reasons: string[] } {
  const reasons: string[] = [];
  let insideGeofence = true;

  // 1) Mock location explícito (Fake GPS).
  if (gps.isMock || gps.provider === 'mock') {
    reasons.push('Ubicación simulada (mock location) detectada');
  }

  // 2) Precisión exigida.
  if (gps.accuracyM > opts.maxAccuracyM) {
    reasons.push(`Precisión GPS insuficiente (${gps.accuracyM}m > ${opts.maxAccuracyM}m)`);
  }

  // 3) Geofence de la empresa.
  if (opts.geofenceCenter) {
    const dist = haversineMeters({ lat: gps.latitude, lng: gps.longitude }, opts.geofenceCenter);
    if (dist > opts.geofenceRadiusM) {
      insideGeofence = false;
      reasons.push(`Fuera del geofence (${Math.round(dist)}m > ${opts.geofenceRadiusM}m)`);
    }
  }

  // 4) Plausibilidad de movimiento (salto imposible entre marcas).
  if (opts.lastKnown) {
    const dist = haversineMeters({ lat: gps.latitude, lng: gps.longitude }, opts.lastKnown);
    const dtH = (Date.now() - opts.lastKnown.at.getTime()) / 3_600_000;
    if (dtH > 0) {
      const speedKmh = dist / 1000 / dtH;
      if (speedKmh > 500) {
        reasons.push(`Movimiento implausible (${Math.round(speedKmh)} km/h)`);
      }
    }
  }

  return { valid: reasons.length === 0, insideGeofence, reasons };
}

export function assertGpsValid(result: { valid: boolean; reasons: string[] }) {
  if (!result.valid) {
    throw new BadRequestException({
      message: 'Ubicación no válida',
      reasons: result.reasons,
    });
  }
}
