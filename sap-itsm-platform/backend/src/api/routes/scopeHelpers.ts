import { prisma } from '../../config/database';

/**
 * Resolve a User → Agent record.
 */
export async function resolveAgent(userId: string) {
  return prisma.agent.findUnique({ where: { userId } });
}

/**
 * Resolve the list of customer IDs a Project Manager manages.
 * Each Customer has a projectManagerAgentId field — the PM assigned to that company.
 * PM sees all customers where Customer.projectManagerAgentId = their agent ID.
 */
export async function resolveManagedCustomerIds(agentId: string, tenantId: string): Promise<string[]> {
  const customers = await prisma.customer.findMany({
    where: { projectManagerAgentId: agentId, tenantId },
    select: { id: true },
  });
  return customers.map(c => c.id);
}
