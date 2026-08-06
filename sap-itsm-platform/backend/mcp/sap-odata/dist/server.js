"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SAPODataMCPServer = void 0;
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const tool_definitions_1 = require("./tool-definitions");
const handlers_1 = require("./handlers");
class SAPODataMCPServer {
    server;
    handlers;
    constructor() {
        this.server = new index_js_1.Server({
            name: "sap-odata-mcp-server",
            version: "0.1.0",
        });
        this.handlers = new handlers_1.SAPODataHandlers();
        this.setupToolHandlers();
        this.setupErrorHandling();
    }
    setupErrorHandling() {
        this.server.onerror = (error) => console.error("[MCP Error]", error);
        process.on("SIGINT", async () => {
            await this.handlers.handleDisconnect();
            await this.server.close();
            process.exit(0);
        });
    }
    setupToolHandlers() {
        this.server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => {
            return {
                tools: tool_definitions_1.toolDefinitions,
            };
        });
        this.server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            try {
                switch (name) {
                    case "sap_get_services":
                        return await this.handlers.handleGetServices();
                    case "sap_get_service_metadata":
                        return await this.handlers.handleGetServiceMetadata(args);
                    case "sap_query_entity_set":
                        return await this.handlers.handleQueryEntitySet(args);
                    case "sap_get_entity":
                        return await this.handlers.handleGetEntity(args);
                    case "sap_connection_status":
                        return await this.handlers.handleConnectionStatus();
                    case "sap_disconnect":
                        return await this.handlers.handleDisconnect();
                    case "sap_create_entity":
                        return await this.handlers.handleCreateEntity(args);
                    case "sap_update_entity":
                        return await this.handlers.handleUpdateEntity(args);
                    default:
                        throw new types_js_1.McpError(types_js_1.ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
                }
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                throw new types_js_1.McpError(types_js_1.ErrorCode.InternalError, errorMessage);
            }
        });
    }
    async run() {
        const transport = new stdio_js_1.StdioServerTransport();
        await this.server.connect(transport);
        console.error("SAP OData MCP server running on stdio");
    }
}
exports.SAPODataMCPServer = SAPODataMCPServer;
//# sourceMappingURL=server.js.map