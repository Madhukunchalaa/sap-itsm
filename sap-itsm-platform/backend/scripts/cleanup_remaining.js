const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: { db: { url: 'postgresql://postgres:YaUaooNTJoIDDmVbZABkwDeytcOBSguy@tramway.proxy.rlwy.net:31692/railway' } }
});

async function main() {
  console.log('🗑️  Full cleanup starting...');

  // Records & related
  await prisma.sLAPauseHistory.deleteMany({});
  await prisma.sLATracking.deleteMany({});
  await prisma.timeEntry.deleteMany({});
  await prisma.comment.deleteMany({});
  await prisma.emailLog.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.iTSMRecord.deleteMany({});
  console.log('✅ Records cleared');

  // Contracts & shifts
  await prisma.contractShift.deleteMany({});
  await prisma.contract.deleteMany({});
  console.log('✅ Contracts cleared');

  // Agents & customers
  await prisma.agentSpecialization.deleteMany({});
  await prisma.customerAgent.deleteMany({});
  await prisma.customer.updateMany({ data: { projectManagerAgentId: null } });
  await prisma.agent.deleteMany({});
  await prisma.customer.deleteMany({});
  console.log('✅ Agents & customers cleared');

  // Non-admin users
  await prisma.refreshToken.deleteMany({ where: { user: { role: { not: 'SUPER_ADMIN' } } } });
  await prisma.notificationPreference.deleteMany({ where: { user: { role: { not: 'SUPER_ADMIN' } } } });
  await prisma.user.deleteMany({ where: { role: { not: 'SUPER_ADMIN' } } });
  console.log('✅ Non-admin users cleared');

  // Tenant-level data (shifts, SLA, support types, CMDB, calendars)
  await prisma.contractHolidayCalendar.deleteMany({});
  await prisma.holidayDate.deleteMany({});
  await prisma.holidayCalendar.deleteMany({});
  await prisma.shift.deleteMany({});
  await prisma.sLAPolicyMaster.deleteMany({});
  await prisma.supportTypeMaster.deleteMany({});
  await prisma.configurationItem.deleteMany({});
  await prisma.assignmentRule.deleteMany({});
  await prisma.notificationRule.deleteMany({});
  await prisma.emailTemplate.deleteMany({});
  console.log('✅ Tenant config data cleared');

  // Orphan tenants (keep super admin tenant)
  const superAdmin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
  if (superAdmin) {
    await prisma.tenant.deleteMany({ where: { id: { not: superAdmin.tenantId } } });
    console.log('✅ Orphan tenants removed, kept:', superAdmin.tenantId);
  }

  // Final count
  const counts = {
    records: await prisma.iTSMRecord.count(),
    users: await prisma.user.count(),
    customers: await prisma.customer.count(),
    agents: await prisma.agent.count(),
    tenants: await prisma.tenant.count(),
  };
  console.log('\n✅ Database state:', counts);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('❌ Error:', e.message);
  await prisma.$disconnect();
});
