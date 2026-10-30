import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const r = await p.attendanceLog.deleteMany({
  where: { employeeId: '92ae49a3-ad6d-4a43-8bef-01373d79c154', workDate: { gte: new Date('2026-10-29') } },
});
console.log('logs de hoy borrados:', r.count);
await p.$disconnect();
