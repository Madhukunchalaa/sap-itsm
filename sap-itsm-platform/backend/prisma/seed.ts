import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// ══════════════════════════════════════════════════════════════
// CONFIGURABLE VARIABLES — update these before running in prod
// ══════════════════════════════════════════════════════════════

const CONFIG = {
  // ── Tenant ────────────────────────────────────────────────
  tenant: {
    name: 'Intraedge',
    slug: 'intraedge',
    timezone: 'America/New_York',
    country: 'US',
  },

  // ── Passwords (all accounts use the same password) ────────
  defaultPassword: 'Admin@123456',

  // ── Super Admin ───────────────────────────────────────────
  superAdmin: {
    email: 'superadmin@itsm.local',
    firstName: 'Super',
    lastName: 'Admin',
  },

  // ── Company Admin ─────────────────────────────────────────
  companyAdmin: {
    email: 'admin@intraedge.com',
    firstName: 'John',
    lastName: 'Admin',
  },

  // ── Agents ────────────────────────────────────────────────
  agents: [
    {
      email: 'agent1@intraedge.com',
      firstName: 'Alice',
      lastName: 'Agent',
      specialization: 'SAP Basis',
      level: 'L2' as const,
      timezone: 'America/New_York',
      maxConcurrent: 8,
    },
    {
      email: 'agent2@intraedge.com',
      firstName: 'Bob',
      lastName: 'Support',
      specialization: 'SAP ABAP',
      level: 'L3' as const,
      timezone: 'America/Chicago',
      maxConcurrent: 5,
    },
  ],

  // ── Project Manager ───────────────────────────────────────
  projectManager: {
    email: 'pm@intraedge.com',
    firstName: 'Carol',
    lastName: 'PM',
    specialization: 'Project Management',
    level: 'L3' as const,
    timezone: 'America/New_York',
  },

  // ── End User ──────────────────────────────────────────────
  endUser: {
    email: 'user@intraedge.com',
    firstName: 'Dave',
    lastName: 'User',
  },

  // ── Customer ──────────────────────────────────────────────
  customer: {
    companyName: 'Beta Industries',
    industry: 'Manufacturing',
    country: 'US',
    timezone: 'America/New_York',
  },

  // ── Support Type ──────────────────────────────────────────
  supportType: {
    name: 'Gold Support',
    code: 'GOLD',
    workDays: [1, 2, 3, 4, 5],
    afterHoursCoverage: 'ON_CALL' as const,
    weekendCoverage: 'ON_CALL' as const,
    holidayCoverage: 'NONE' as const,
  },

  // ── SLA Policy ────────────────────────────────────────────
  slaPolicy: {
    name: 'Default SLA Policy',
    code: 'DEFAULT',
    priorities: {
      P1: { response: 15,  resolution: 240  },
      P2: { response: 60,  resolution: 480  },
      P3: { response: 240, resolution: 1440 },
      P4: { response: 480, resolution: 2880 },
    },
  },

  // ── Shift ─────────────────────────────────────────────────
  shift: {
    name: 'Business Hours - EST',
    startTime: '08:00',
    endTime: '18:00',
    timezone: 'America/New_York',
    breakMinutes: 60,
  },

  // ── Contract ──────────────────────────────────────────────
  contract: {
    contractNumber: 'CON-2024-001',
    startDate: new Date('2024-01-01'),
    endDate: new Date('2025-12-31'),
    autoRenewal: true,
    billingAmount: 50000,
    currency: 'USD',
  },

  // ── CMDB ──────────────────────────────────────────────────
  cmdbItem: {
    ciType: 'SYSTEM' as const,
    name: 'SAP ERP Production',
    environment: 'PROD' as const,
    sid: 'PRD',
    hostname: 'sap-prod.intraedge.internal',
    version: 'S/4HANA 2023',
  },

  // ── Holiday Calendar ──────────────────────────────────────
  holidayCalendar: {
    name: 'US Federal Holidays 2024',
    country: 'US',
    year: 2024,
    dates: [
      { date: new Date('2024-01-01'), name: "New Year's Day",    supportType: 'EMERGENCY_ONLY' as const },
      { date: new Date('2024-07-04'), name: 'Independence Day',  supportType: 'EMERGENCY_ONLY' as const },
      { date: new Date('2024-11-28'), name: 'Thanksgiving Day',  supportType: 'NONE' as const },
      { date: new Date('2024-12-25'), name: 'Christmas Day',     supportType: 'EMERGENCY_ONLY' as const },
    ],
  },
};

// ══════════════════════════════════════════════════════════════
// SEED LOGIC — do not edit below unless adding new tables
// ══════════════════════════════════════════════════════════════

async function main() {
  console.log('🌱 Seeding SAP ITSM Platform...');

  const pw = await bcrypt.hash(CONFIG.defaultPassword, 12);

  // ── Tenant ────────────────────────────────────────────────
  const tenant = await prisma.tenant.upsert({
    where: { slug: CONFIG.tenant.slug },
    update: {},
    create: {
      name: CONFIG.tenant.name,
      slug: CONFIG.tenant.slug,
      timezone: CONFIG.tenant.timezone,
      country: CONFIG.tenant.country,
      status: 'ACTIVE',
      settings: { maxUsers: 100, features: ['sla', 'email', 'cmdb'] },
    },
  });
  console.log('✅ Tenant:', tenant.name);

  // ── Users ─────────────────────────────────────────────────
  await prisma.user.upsert({
    where: { email: CONFIG.superAdmin.email },
    update: {},
    create: {
      tenantId: tenant.id,
      email: CONFIG.superAdmin.email,
      passwordHash: pw,
      firstName: CONFIG.superAdmin.firstName,
      lastName: CONFIG.superAdmin.lastName,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    },
  });

  const companyAdmin = await prisma.user.upsert({
    where: { email: CONFIG.companyAdmin.email },
    update: {},
    create: {
      tenantId: tenant.id,
      email: CONFIG.companyAdmin.email,
      passwordHash: pw,
      firstName: CONFIG.companyAdmin.firstName,
      lastName: CONFIG.companyAdmin.lastName,
      role: 'COMPANY_ADMIN',
      status: 'ACTIVE',
    },
  });

  const agentUsers = await Promise.all(
    CONFIG.agents.map(a =>
      prisma.user.upsert({
        where: { email: a.email },
        update: {},
        create: {
          tenantId: tenant.id,
          email: a.email,
          passwordHash: pw,
          firstName: a.firstName,
          lastName: a.lastName,
          role: 'AGENT',
          status: 'ACTIVE',
        },
      })
    )
  );

  const pmUser = await prisma.user.upsert({
    where: { email: CONFIG.projectManager.email },
    update: {},
    create: {
      tenantId: tenant.id,
      email: CONFIG.projectManager.email,
      passwordHash: pw,
      firstName: CONFIG.projectManager.firstName,
      lastName: CONFIG.projectManager.lastName,
      role: 'PROJECT_MANAGER',
      status: 'ACTIVE',
    },
  });

  const endUser = await prisma.user.upsert({
    where: { email: CONFIG.endUser.email },
    update: {},
    create: {
      tenantId: tenant.id,
      email: CONFIG.endUser.email,
      passwordHash: pw,
      firstName: CONFIG.endUser.firstName,
      lastName: CONFIG.endUser.lastName,
      role: 'USER',
      status: 'ACTIVE',
    },
  });

  console.log('✅ Users created (password:', CONFIG.defaultPassword + ')');

  // ── Agents ────────────────────────────────────────────────
  const agentRecords = await Promise.all(
    CONFIG.agents.map((a, i) =>
      prisma.agent.upsert({
        where: { userId: agentUsers[i].id },
        update: {},
        create: {
          userId: agentUsers[i].id,
          specialization: a.specialization,
          level: a.level,
          timezone: a.timezone,
          maxConcurrent: a.maxConcurrent,
          status: 'AVAILABLE',
        },
      })
    )
  );

  const pmAgent = await prisma.agent.upsert({
    where: { userId: pmUser.id },
    update: {},
    create: {
      userId: pmUser.id,
      specialization: CONFIG.projectManager.specialization,
      level: CONFIG.projectManager.level,
      timezone: CONFIG.projectManager.timezone,
      maxConcurrent: 0,
      status: 'AVAILABLE',
    },
  });

  console.log('✅ Agents created');

  // ── Support Type Master ───────────────────────────────────
  const supportType = await prisma.supportTypeMaster.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: CONFIG.supportType.code } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: CONFIG.supportType.name,
      code: CONFIG.supportType.code,
      workDays: CONFIG.supportType.workDays,
      afterHoursCoverage: CONFIG.supportType.afterHoursCoverage,
      weekendCoverage: CONFIG.supportType.weekendCoverage,
      holidayCoverage: CONFIG.supportType.holidayCoverage,
    },
  });

  // ── SLA Policy Master ─────────────────────────────────────
  const slaPolicy = await prisma.sLAPolicyMaster.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: CONFIG.slaPolicy.code } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: CONFIG.slaPolicy.name,
      code: CONFIG.slaPolicy.code,
      priorities: CONFIG.slaPolicy.priorities,
    },
  });

  // ── Shift ─────────────────────────────────────────────────
  const existingShift = await prisma.shift.findFirst({
    where: { tenantId: tenant.id, name: CONFIG.shift.name },
  });
  const shift = existingShift ?? await prisma.shift.create({
    data: {
      tenantId: tenant.id,
      name: CONFIG.shift.name,
      startTime: CONFIG.shift.startTime,
      endTime: CONFIG.shift.endTime,
      timezone: CONFIG.shift.timezone,
      breakMinutes: CONFIG.shift.breakMinutes,
    },
  });
  console.log('✅ Shift ready');

  // ── Customer ──────────────────────────────────────────────
  let customer = await prisma.customer.findFirst({
    where: { tenantId: tenant.id, companyName: CONFIG.customer.companyName },
  });
  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        tenantId: tenant.id,
        companyName: CONFIG.customer.companyName,
        industry: CONFIG.customer.industry,
        country: CONFIG.customer.country,
        timezone: CONFIG.customer.timezone,
        status: 'ACTIVE',
        adminUserId: companyAdmin.id,
        projectManagerAgentId: pmAgent.id,
      },
    });
  }
  console.log('✅ Customer:', customer.companyName);

  // ── Link users to customer ────────────────────────────────
  await prisma.user.update({ where: { id: companyAdmin.id }, data: { customerId: customer.id } });
  await prisma.user.update({ where: { id: endUser.id },      data: { customerId: customer.id } });

  // ── CustomerAgent assignments ─────────────────────────────
  await prisma.customerAgent.createMany({
    data: [
      { customerId: customer.id, agentId: pmAgent.id },
      ...agentRecords.map(a => ({ customerId: customer.id, agentId: a.id })),
    ],
    skipDuplicates: true,
  });
  console.log('✅ Agents linked to customer');

  // ── Contract ──────────────────────────────────────────────
  const existingContract = await prisma.contract.findFirst({
    where: { customerId: customer.id, contractNumber: CONFIG.contract.contractNumber },
  });
  if (!existingContract) {
    await prisma.contract.create({
      data: {
        customerId: customer.id,
        contractNumber: CONFIG.contract.contractNumber,
        supportTypeMasterId: supportType.id,
        slaPolicyMasterId: slaPolicy.id,
        startDate: CONFIG.contract.startDate,
        endDate: CONFIG.contract.endDate,
        autoRenewal: CONFIG.contract.autoRenewal,
        billingAmount: CONFIG.contract.billingAmount,
        currency: CONFIG.contract.currency,
        shifts: { create: { shiftId: shift.id } },
      },
    });
  }
  console.log('✅ Contract ready');

  // ── CMDB ──────────────────────────────────────────────────
  const existingCI = await prisma.configurationItem.findFirst({
    where: { tenantId: tenant.id, name: CONFIG.cmdbItem.name },
  });
  if (!existingCI) {
    await prisma.configurationItem.create({
      data: {
        tenantId: tenant.id,
        ciType: CONFIG.cmdbItem.ciType,
        name: CONFIG.cmdbItem.name,
        environment: CONFIG.cmdbItem.environment,
        sid: CONFIG.cmdbItem.sid,
        hostname: CONFIG.cmdbItem.hostname,
        version: CONFIG.cmdbItem.version,
        status: 'ACTIVE',
      },
    });
  }
  console.log('✅ CMDB item ready');

  // ── Holiday Calendar ──────────────────────────────────────
  const existingCal = await prisma.holidayCalendar.findFirst({
    where: { tenantId: tenant.id, name: CONFIG.holidayCalendar.name },
  });
  if (!existingCal) {
    await prisma.holidayCalendar.create({
      data: {
        tenantId: tenant.id,
        name: CONFIG.holidayCalendar.name,
        country: CONFIG.holidayCalendar.country,
        year: CONFIG.holidayCalendar.year,
        dates: { create: CONFIG.holidayCalendar.dates },
      },
    });
  }
  console.log('✅ Holiday calendar ready');

  console.log('\n🎉 Seed complete!');
  console.log('─────────────────────────────────────');
  console.log('Login credentials (password:', CONFIG.defaultPassword + ')');
  console.log('  Super Admin:    ', CONFIG.superAdmin.email);
  console.log('  Company Admin:  ', CONFIG.companyAdmin.email);
  console.log('  Project Manager:', CONFIG.projectManager.email);
  console.log('  End User:       ', CONFIG.endUser.email);
  CONFIG.agents.forEach(a => console.log('  Agent:          ', a.email));
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    prisma.$disconnect();
    throw e;
  });
