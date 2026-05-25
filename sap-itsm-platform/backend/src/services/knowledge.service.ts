import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';

export async function generateKnowledge(tenantId: string) {
  try {
    // 1. Fetch Agents and Specializations
    const agents = await prisma.agent.findMany({
      where: { user: { tenantId } },
      include: {
        user: { select: { firstName: true, lastName: true } },
        specializations: {
          include: { sapModule: { select: { name: true, code: true } } }
        }
      }
    });

    const agentSummary = agents.map(a => ({
      name: `${a.user.firstName} ${a.user.lastName}`,
      level: a.level,
      status: a.status,
      modules: a.specializations.map(s => s.sapModule.code)
    }));

    // 2. Fetch SAP Modules
    const modules = await prisma.sAPModuleMaster.findMany({
      where: { tenantId, isActive: true },
      include: { subModules: { where: { isActive: true } } }
    });

    const moduleSummary = modules.map(m => ({
      code: m.code,
      name: m.name,
      subModules: m.subModules.map(sm => sm.code)
    }));

    // 3. Fetch Record Stats (Last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recordStats = await prisma.iTSMRecord.groupBy({
      by: ['recordType', 'status'],
      where: { tenantId, createdAt: { gte: thirtyDaysAgo } },
      _count: true
    });

    // 4. Fetch CMDB Summary
    const cmdbStats = await prisma.configurationItem.groupBy({
      by: ['ciType'],
      where: { tenantId, status: 'ACTIVE' },
      _count: true
    });

    // 5. Fetch Customers
    const customers = await prisma.customer.findMany({
      where: { tenantId, status: 'ACTIVE' },
      select: { companyName: true, industry: true }
    });

    // Compile into Knowledge Base
    const knowledgeBase = {
      updatedAt: new Date().toISOString(),
      agents: agentSummary,
      sapModules: moduleSummary,
      recentStats: recordStats,
      activeCMDB: cmdbStats,
      customers: customers.map(c => c.companyName)
    };

    // Store in Tenant settings
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    const settings = (tenant?.settings as any) || {};
    settings.aiKnowledge = knowledgeBase;

    await prisma.tenant.update({
      where: { id: tenantId },
      data: { settings }
    });

    return knowledgeBase;
  } catch (error: any) {
    console.error('Error generating AI knowledge:', error);
    throw new AppError('Failed to generate AI knowledge base: ' + error.message, 500);
  }
}

export async function getKnowledge(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true }
  });

  return (tenant?.settings as any)?.aiKnowledge || null;
}
