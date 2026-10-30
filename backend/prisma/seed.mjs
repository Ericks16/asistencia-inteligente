import { PrismaClient } from '@prisma/client';
import { randomBytes, scryptSync } from 'node:crypto';

const prisma = new PrismaClient();

function hashSecret(secret) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(secret, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

const iso = (day, hhmm) => new Date(`2026-10-${String(day).padStart(2, '0')}T${hhmm}:00-05:00`);

async function main() {
  const pin = hashSecret('1234');

  const admin = await prisma.user.upsert({
    where: { cedula: '0000000001' },
    update: {},
    create: {
      cedula: '0000000001', pinHash: pin, role: 'ADMIN', mustChangePin: false,
      profile: { create: { firstName: 'Administrador', lastName: 'General' } },
    },
  });

  const maria = await prisma.user.upsert({
    where: { cedula: '1712345678' },
    update: {},
    create: {
      cedula: '1712345678', pinHash: pin, role: 'EMPLOYEE', mustChangePin: false,
      profile: { create: { firstName: 'María', lastName: 'Pérez' } },
    },
  });

  const juan = await prisma.user.upsert({
    where: { cedula: '1798765432' },
    update: {},
    create: {
      cedula: '1798765432', pinHash: pin, role: 'EMPLOYEE', mustChangePin: false,
      profile: { create: { firstName: 'Juan', lastName: 'Gómez' } },
    },
  });

  const existing = await prisma.attendanceLog.count({ where: { employeeId: maria.id } });
  if (existing === 0) {
    const days = [['27', '08:02', '17:05'], ['28', '07:15', '18:30'], ['29', '08:30', '17:00']];
    for (const [day, entry, exit] of days) {
      await prisma.attendanceLog.createMany({
        data: [
          { employeeId: maria.id, type: 'CHECK_IN', status: 'VALID', source: 'INDIVIDUAL', serverTimestamp: iso(day, entry), workDate: iso(day, entry), gpsLat: -0.1807, gpsLng: -78.4678, faceMatchScore: 0.98 },
          { employeeId: maria.id, type: 'CHECK_OUT', status: 'VALID', source: 'INDIVIDUAL', serverTimestamp: iso(day, exit), workDate: iso(day, exit), gpsLat: -0.1807, gpsLng: -78.4678, faceMatchScore: 0.98 },
        ],
      });
    }
  }

  console.log('Seed OK');
  console.log('admin  id =', admin.id, '(cedula 0000000001)');
  console.log('maria  id =', maria.id, '(cedula 1712345678)');
  console.log('juan   id =', juan.id, '(cedula 1798765432)');
}

main().finally(() => prisma.$disconnect());
