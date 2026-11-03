import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const keepNames = new Set([
  'ERICK SEBASTIAN ERAZO RODRIGUEZ',
  'ERIKA SANTILLAN',
]);

function normalize(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

async function main() {
  const users = await prisma.user.findMany({ include: { profile: true } });
  const keep = users.filter((user) => {
    const name = user.profile
      ? `${user.profile.firstName} ${user.profile.lastName}`
      : '';
    return keepNames.has(normalize(name));
  });

  if (keep.length !== keepNames.size) {
    const found = keep.map((user) => user.profile
      ? `${user.profile.firstName} ${user.profile.lastName}`
      : user.cedula);
    throw new Error(
      `Limpieza cancelada: se esperaban ${keepNames.size} administradores y se encontraron ${keep.length}. Encontrados: ${found.join(', ') || 'ninguno'}`,
    );
  }

  const keepIds = keep.map((user) => user.id);
  const result = await prisma.$transaction(async (tx) => {
    const matches = await tx.groupAttendanceMatch.deleteMany();
    const adjustments = await tx.attendanceAdjustment.deleteMany();
    const overtime = await tx.overtimeRecord.deleteMany();
    const logs = await tx.attendanceLog.deleteMany();
    const sessions = await tx.groupAttendanceSession.deleteMany();
    const reports = await tx.monthlyReport.deleteMany();
    const audit = await tx.auditLog.deleteMany();
    const tokens = await tx.refreshToken.deleteMany();
    const devices = await tx.device.deleteMany();
    const embeddings = await tx.faceEmbedding.deleteMany();
    const deletedUsers = await tx.user.deleteMany({
      where: { id: { notIn: keepIds } },
    });
    await tx.user.updateMany({
      where: { id: { in: keepIds } },
      data: { role: 'ADMIN', status: 'ACTIVE' },
    });

    return {
      matches: matches.count,
      adjustments: adjustments.count,
      overtime: overtime.count,
      logs: logs.count,
      sessions: sessions.count,
      reports: reports.count,
      audit: audit.count,
      tokens: tokens.count,
      devices: devices.count,
      embeddings: embeddings.count,
      deletedUsers: deletedUsers.count,
    };
  });

  console.log('Limpieza completada. Se conservaron:', keep.map((user) => user.profile
    ? `${user.profile.firstName} ${user.profile.lastName}`
    : user.cedula).join(', '));
  console.table(result);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
