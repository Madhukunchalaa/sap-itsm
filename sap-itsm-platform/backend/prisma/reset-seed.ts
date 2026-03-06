/**
 * reset-seed.ts
 * 
 * Wipes all operational data, creates Intraedge tenant
 * and Admin@intraedge.com as Super Admin.
 * 
 * Run via: RESET_AND_RESEED=true (triggers from startup.ts)
 * Or manually: npx ts-node prisma/reset-seed.ts
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🧹 Starting clean reset...');

  // ── 1. Delete in dependency order ─────────────────────────
  console.log('   Deleting SLA tracking & pause history...');
  await prisma.sLAPauseHistory.deleteMany({});
  await prisma.sLATracking.deleteMany({});

  console.log('   Deleting time entries & comments...');
  await prisma.timeEntry.deleteMany({});
  await prisma.comment.deleteMany({});

  console.log('   Deleting email logs...');
  await prisma.emailLog.deleteMany({});

  console.log('   Deleting ITSM records...');
  await prisma.iTSMRecord.deleteMany({});

  console.log('   Deleting audit logs...');
  await prisma.auditLog.deleteMany({});

  console.log('   Deleting CMDB items...');
  await prisma.configurationItem.deleteMany({});

  console.log('   Deleting contract-holiday links...');
  await prisma.contractHolidayCalendar.deleteMany({});

  console.log('   Deleting contract-shift links...');
  await prisma.contractShift.deleteMany({});

  console.log('   Deleting contracts...');
  await prisma.contract.deleteMany({});

  console.log('   Deleting contract type masters...');
  await prisma.contractTypeMaster.deleteMany({});

  console.log('   Deleting customers...');
  await prisma.customer.deleteMany({});

  console.log('   Deleting agents...');
  await prisma.agent.deleteMany({});

  console.log('   Deleting refresh tokens...');
  await prisma.refreshToken.deleteMany({});

  console.log('   Deleting users...');
  await prisma.user.deleteMany({});

  console.log('   Deleting holiday dates & calendars...');
  await prisma.holidayDate.deleteMany({});
  await prisma.holidayCalendar.deleteMany({});

  console.log('   Deleting shifts...');
  await prisma.shift.deleteMany({});

  console.log('   Deleting tenants...');
  await prisma.tenant.deleteMany({});

  console.log('✅ All data cleared.\n');

  // ── 2. Create Intraedge tenant ─────────────────────────────
  console.log('🏢 Creating Intraedge tenant...');
  const tenant = await prisma.tenant.create({
    data: {
      name:     'Intraedge',
      slug:     'intraedge',
      timezone: 'Asia/Kolkata',
      country:  'IN',
      status:   'ACTIVE',
      settings: { maxUsers: 500, features: ['sla', 'email', 'cmdb', 'shifts', 'holidays'] },
    },
  });
  console.log(`✅ Tenant created: ${tenant.name} (${tenant.id})`);

  // ── 3. Create Super Admin ─────────────────────────────────
  console.log('👤 Creating Super Admin: admin@intraedge.com ...');
  const passwordHash = await bcrypt.hash('Admin@123456', 12);

  const superAdmin = await prisma.user.create({
    data: {
      tenantId:     tenant.id,
      email:        'admin@intraedge.com',
      passwordHash,
      firstName:    'System',
      lastName:     'Administrator',
      role:         'SUPER_ADMIN',
      status:       'ACTIVE',
    },
  });
  console.log(`✅ Super Admin created: ${superAdmin.email}`);

  console.log('\n🎉 Reset complete!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Tenant : Intraedge');
  console.log('  Email  : admin@intraedge.com');
  console.log('  Password: Admin@123456');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main()
  .catch(e => { console.error('❌ Reset failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
