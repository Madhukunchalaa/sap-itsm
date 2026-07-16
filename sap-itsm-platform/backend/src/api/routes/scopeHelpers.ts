import { prisma } from '../../config/database';

/**
 * Resolve a User → Agent record.
 */
export async function resolveAgent(userId: string) {
  return prisma.agent.findUnique({ where: { userId } });
}

/**
 * Resolve the list of customer IDs a Project Manager manages.
 * Each Customer can have multiple Project Managers assigned via CustomerProjectManager.
 * PM sees all customers where their agent ID is in the CustomerProjectManager table.
 */
export async function resolveManagedCustomerIds(agentId: string, tenantId: string): Promise<string[]> {
  const pmRecords = await prisma.customerProjectManager.findMany({
    where: { agentId, customer: { tenantId } },
    select: { customerId: true },
  });
  return pmRecords.map(pm => pm.customerId);
}
