import path from 'path';
import { logger } from '../config/logger';

// The SAP OData MCP server lives at backend/mcp/sap-odata (a self-contained
// copy of the already-validated lnmission/mcp-server, run as a child process
// over stdio — same pattern lnmission/server.js used when this was tested
// against a real S/4HANA 2022 system).
const MCP_ENTRY = path.join(__dirname, '..', '..', 'mcp', 'sap-odata', 'dist', 'index.js');

// Read-only tools only — ticket analysis never writes to SAP. Human review
// is required before any SAP change (see sap-ticket-ai-agent-design.md).
const READ_ONLY_TOOLS = new Set([
  'sap_get_services',
  'sap_get_service_metadata',
  'sap_query_entity_set',
  'sap_get_entity',
  'sap_connection_status',
]);

export function isReadOnlySapTool(name: string): boolean {
  return READ_ONLY_TOOLS.has(name);
}

let clientPromise: Promise<any> | null = null;

async function connect(): Promise<any> {
  // @modelcontextprotocol/sdk ships ESM-only — dynamic import works from
  // this CommonJS backend, a static import/require would not.
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [MCP_ENTRY],
    env: {
      ...process.env,
      SAP_ODATA_BASE_URL: process.env.SAP_ODATA_BASE_URL || '',
      SAP_USERNAME: process.env.SAP_USERNAME || '',
      SAP_PASSWORD: process.env.SAP_PASSWORD || '',
      SAP_CLIENT: process.env.SAP_CLIENT || '',
      SAP_VALIDATE_SSL: process.env.SAP_VALIDATE_SSL || 'false',
      SAP_ENABLE_CSRF: 'false',
    } as Record<string, string>,
  });

  const client = new Client({ name: 'sap-itsm-analysis', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  logger.info('[SapMcp] Connected to SAP OData MCP server');
  return client;
}

// Lazy singleton connection, shared across analysis calls. Reconnects on
// next call if the previous connection attempt failed.
export function getSapMcpClient(): Promise<any> {
  if (!clientPromise) {
    clientPromise = connect().catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

export async function listSapTools() {
  const client = await getSapMcpClient();
  const res = await client.listTools();
  return res.tools as { name: string; description?: string; inputSchema: any }[];
}

export async function callSapTool(name: string, args: any) {
  if (!isReadOnlySapTool(name)) {
    throw new Error(`SAP tool "${name}" is not permitted during ticket analysis (read-only tools only)`);
  }
  const client = await getSapMcpClient();
  const result = await client.callTool({ name, arguments: args || {} });
  return result;
}
