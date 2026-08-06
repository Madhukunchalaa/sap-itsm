"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SAPODataHandlers = void 0;
const odata_clients_1 = require("./odata-clients");
const types_1 = require("./types");
class SAPODataHandlers {
    sapClient = null;
    async handleConnect(args) {
        try {
            // Close existing connection if any
            if (this.sapClient) {
                await this.sapClient.disconnect();
            }
            const configArgs = {
                baseUrl: args.baseUrl || process.env.SAP_ODATA_BASE_URL,
                username: args.username || process.env.SAP_USERNAME,
                password: args.password || process.env.SAP_PASSWORD,
                client: args.client || process.env.SAP_CLIENT,
                timeout: args.timeout || (process.env.SAP_TIMEOUT ? parseInt(process.env.SAP_TIMEOUT) : 30000),
                validateSSL: args.validateSSL !== undefined ? args.validateSSL : (process.env.SAP_VALIDATE_SSL !== 'false'),
                enableCSRF: args.enableCSRF !== undefined ? args.enableCSRF : (process.env.SAP_ENABLE_CSRF !== 'false')
            };
            const config = types_1.SAPODataConfigSchema.parse(configArgs);
            this.sapClient = new odata_clients_1.SAPODataClient(config);
            await this.sapClient.connect();
            return {
                content: [
                    {
                        type: "text",
                        text: `Successfully connected to SAP OData service:\n- Base URL: ${config.baseUrl}\n- Username: ${config.username}\n- Client: ${config.client || 'Not specified'}\n- CSRF Enabled: ${config.enableCSRF}\n\nNote: The base URL may return 404 when accessed directly. This is normal for SAP OData services - you need to specify a service name. Use 'Get list of available OData services' to discover available services.`,
                    },
                ],
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            // Provide helpful error messages for common issues
            if (errorMessage.includes('404')) {
                throw new Error(`Connection test returned 404. This might be expected for SAP OData base URLs. The issue could be:
1. The base URL is incomplete (needs a service name)
2. OData services are not activated at this path
3. Different URL structure is needed

Try running the discovery tool to find the correct URL: npm run discover:services`);
            }
            throw new Error(`Failed to connect to SAP OData service: ${errorMessage}`);
        }
    }
    async handleGetServices() {
        await this.ensureConnected();
        try {
            const result = await this.sapClient.getServices();
            // Type assertion to ensure we have the full interface
            const serviceResult = result;
            let responseText = `SAP OData Service Discovery Results:\n\n`;
            if (serviceResult.services && serviceResult.services.length > 0) {
                responseText += `✅ Found ${serviceResult.services.length} services`;
                if (serviceResult.source) {
                    responseText += ` (via ${serviceResult.source})`;
                }
                responseText += `:\n\n`;
                serviceResult.services.forEach((service, index) => {
                    responseText += `${index + 1}. ${service.name}\n`;
                    if (service.title && service.title !== service.name) {
                        responseText += `   Title: ${service.title}\n`;
                    }
                    if (service.url) {
                        responseText += `   URL: ${service.url}\n`;
                    }
                    if (service.version) {
                        responseText += `   Version: ${service.version}\n`;
                    }
                    responseText += `\n`;
                });
                responseText += `💡 To use these services:\n`;
                responseText += `1. Get metadata: "Get metadata for service ${serviceResult.services[0].name}"\n`;
                responseText += `2. Query data: "Query [EntitySet] from ${serviceResult.services[0].name}"\n`;
            }
            else {
                responseText += `❌ No OData services found.\n\n`;
                responseText += `This could mean:\n`;
                responseText += `1. No services are activated on this SAP system\n`;
                responseText += `2. The catalog service is not accessible\n`;
                responseText += `3. Different authorization is needed\n\n`;
                responseText += `💡 Try these steps:\n`;
                responseText += `1. Contact SAP administrator to verify OData service activation\n`;
                responseText += `2. Check SAP GUI: Transaction /IWFND/MAINT_SERVICE\n`;
                responseText += `3. Run local discovery: npm run discover:services\n`;
                if (serviceResult.message) {
                    responseText += `\nNote: ${serviceResult.message}`;
                }
            }
            return {
                content: [
                    {
                        type: "text",
                        text: responseText,
                    },
                ],
                _rawData: result,
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to get OData services: ${errorMessage}`);
        }
    }
    async handleGetServiceMetadata(args) {
        await this.ensureConnected();
        try {
            const result = await this.sapClient.getServiceMetadata(args.serviceName);
            let responseText = `SAP OData Service Metadata for ${args.serviceName}:\n\n`;
            if (result.entities && result.entities.length > 0) {
                responseText += `Entity Types (${result.entities.length}):\n`;
                result.entities.forEach((entity) => {
                    responseText += `\n- ${entity.name}:\n`;
                    if (entity.properties && entity.properties.length > 0) {
                        entity.properties.forEach((prop) => {
                            responseText += `  • ${prop.name}: ${prop.type}${prop.nullable ? '' : ' (required)'}\n`;
                        });
                    }
                });
            }
            if (result.functions && result.functions.length > 0) {
                responseText += `\n\nFunction Imports (${result.functions.length}):\n`;
                result.functions.forEach((func) => {
                    responseText += `\n- ${func.name}`;
                    if (func.returnType) {
                        responseText += ` → ${func.returnType}`;
                    }
                    responseText += `\n`;
                });
            }
            return {
                content: [
                    {
                        type: "text",
                        text: responseText,
                    },
                ],
                _rawData: result,
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to get service metadata: ${errorMessage}`);
        }
    }
    async handleQueryEntitySet(args) {
        await this.ensureConnected();
        try {
            const result = await this.sapClient.queryEntitySet(args.serviceName, args.entitySet, {
                select: args.select,
                filter: args.filter,
                orderby: args.orderby,
                top: args.top,
                skip: args.skip,
                expand: args.expand,
            });
            let responseText = `SAP OData Query Results for ${args.serviceName}/${args.entitySet}:\n\n`;
            if (result.d && result.d.results) {
                const records = result.d.results;
                responseText += `Records found: ${records.length}\n\n`;
                if (records.length > 0) {
                    responseText += `Sample data (first ${Math.min(3, records.length)} records):\n`;
                    responseText += JSON.stringify(records.slice(0, 3), null, 2);
                    if (records.length > 3) {
                        responseText += `\n\n... and ${records.length - 3} more records`;
                    }
                }
            }
            else if (result.value) {
                // OData v4 format
                const records = result.value;
                responseText += `Records found: ${records.length}\n\n`;
                if (records.length > 0) {
                    responseText += `Sample data (first ${Math.min(3, records.length)} records):\n`;
                    responseText += JSON.stringify(records.slice(0, 3), null, 2);
                    if (records.length > 3) {
                        responseText += `\n\n... and ${records.length - 3} more records`;
                    }
                }
            }
            else {
                responseText += "No data found matching the criteria.";
            }
            // Include query parameters used
            const queryParams = [];
            if (args.select)
                queryParams.push(`$select: ${args.select.join(', ')}`);
            if (args.filter)
                queryParams.push(`$filter: ${args.filter}`);
            if (args.orderby)
                queryParams.push(`$orderby: ${args.orderby}`);
            if (args.top)
                queryParams.push(`$top: ${args.top}`);
            if (args.skip)
                queryParams.push(`$skip: ${args.skip}`);
            if (args.expand)
                queryParams.push(`$expand: ${args.expand.join(', ')}`);
            if (queryParams.length > 0) {
                responseText += `\n\nQuery parameters used:\n${queryParams.join('\n')}`;
            }
            return {
                content: [
                    {
                        type: "text",
                        text: responseText,
                    },
                ],
                _rawData: result,
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to query entity set ${args.entitySet}: ${errorMessage}`);
        }
    }
    async handleGetEntity(args) {
        await this.ensureConnected();
        try {
            const result = await this.sapClient.getEntity(args.serviceName, args.entitySet, args.keyValues);
            let responseText = `SAP OData Entity from ${args.serviceName}/${args.entitySet}:\n\n`;
            responseText += `Key values: ${JSON.stringify(args.keyValues, null, 2)}\n\n`;
            responseText += `Entity data:\n${JSON.stringify(result.d || result, null, 2)}`;
            return {
                content: [
                    {
                        type: "text",
                        text: responseText,
                    },
                ],
                _rawData: result,
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to get entity: ${errorMessage}`);
        }
    }
    async handleCreateEntity(args) {
        await this.ensureConnected();
        if (!(await this.sapClient.isConnected())) {
            throw new Error("SAP OData connection lost. Please reconnect using sap_connect.");
        }
        try {
            const result = await this.sapClient.createEntity(args.serviceName, args.entitySet, args.data);
            let responseText = `SAP OData Entity Created in ${args.serviceName}/${args.entitySet}:\n\n`;
            responseText += `Input data:\n${JSON.stringify(args.data, null, 2)}\n\n`;
            responseText += `Created entity:\n${JSON.stringify(result.d || result, null, 2)}`;
            return {
                content: [
                    {
                        type: "text",
                        text: responseText,
                    },
                ],
                _rawData: result,
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to create entity: ${errorMessage}`);
        }
    }
    async handleUpdateEntity(args) {
        await this.ensureConnected();
        if (!(await this.sapClient.isConnected())) {
            throw new Error("SAP OData connection lost. Please reconnect using sap_connect.");
        }
        try {
            const result = await this.sapClient.updateEntity(args.serviceName, args.entitySet, args.keyValues, args.data);
            let responseText = `SAP OData Entity Updated in ${args.serviceName}/${args.entitySet}:\n\n`;
            responseText += `Key values: ${JSON.stringify(args.keyValues, null, 2)}\n\n`;
            responseText += `Update data: ${JSON.stringify(args.data, null, 2)}\n\n`;
            responseText += `Update successful`;
            if (result && Object.keys(result).length > 0) {
                responseText += `\n\nResponse: ${JSON.stringify(result, null, 2)}`;
            }
            return {
                content: [
                    {
                        type: "text",
                        text: responseText,
                    },
                ],
                _rawData: result,
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to update entity: ${errorMessage}`);
        }
    }
    async handleDeleteEntity(args) {
        await this.ensureConnected();
        if (!(await this.sapClient.isConnected())) {
            throw new Error("SAP OData connection lost. Please reconnect using sap_connect.");
        }
        try {
            await this.sapClient.deleteEntity(args.serviceName, args.entitySet, args.keyValues);
            let responseText = `SAP OData Entity Deleted from ${args.serviceName}/${args.entitySet}:\n\n`;
            responseText += `Key values: ${JSON.stringify(args.keyValues, null, 2)}\n\n`;
            responseText += `Entity successfully deleted`;
            return {
                content: [
                    {
                        type: "text",
                        text: responseText,
                    },
                ],
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to delete entity: ${errorMessage}`);
        }
    }
    async handleCallFunction(args) {
        await this.ensureConnected();
        if (!(await this.sapClient.isConnected())) {
            throw new Error("SAP OData connection lost. Please reconnect using sap_connect.");
        }
        try {
            const result = await this.sapClient.callFunction(args.serviceName, args.functionName, args.parameters || {});
            let responseText = `SAP OData Function Result for ${args.serviceName}/${args.functionName}:\n\n`;
            if (args.parameters && Object.keys(args.parameters).length > 0) {
                responseText += `Parameters: ${JSON.stringify(args.parameters, null, 2)}\n\n`;
            }
            responseText += `Result:\n${JSON.stringify(result, null, 2)}`;
            return {
                content: [
                    {
                        type: "text",
                        text: responseText,
                    },
                ],
                _rawData: result,
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to call function ${args.functionName}: ${errorMessage}`);
        }
    }
    async handleConnectionStatus() {
        if (!this.sapClient) {
            return {
                content: [
                    {
                        type: "text",
                        text: "No SAP OData connection established. Use sap_connect to connect to an SAP OData service.",
                    },
                ],
            };
        }
        try {
            const isConnected = await this.sapClient.isConnected();
            const connectionInfo = this.sapClient.getConnectionInfo();
            let statusText = `SAP OData Connection Status:\n\n`;
            statusText += `Status: ${isConnected ? '✅ Connected' : '❌ Disconnected'}\n`;
            if (connectionInfo) {
                statusText += `Base URL: ${connectionInfo.baseUrl}\n`;
                statusText += `Username: ${connectionInfo.username}\n`;
                statusText += `Client: ${connectionInfo.client || 'Not specified'}\n`;
                statusText += `Timeout: ${connectionInfo.timeout}ms\n`;
                statusText += `CSRF Enabled: ${connectionInfo.enableCSRF}\n`;
                statusText += `CSRF Token: ${connectionInfo.hasCSRFToken ? 'Available' : 'Not available'}\n`;
            }
            if (!isConnected) {
                statusText += `\nNote: Connection appears to be lost. Use sap_connect to reconnect.`;
            }
            return {
                content: [
                    {
                        type: "text",
                        text: statusText,
                    },
                ],
            };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error checking connection status: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
            };
        }
    }
    async handleDisconnect() {
        if (this.sapClient) {
            try {
                await this.sapClient.disconnect();
                this.sapClient = null;
                return {
                    content: [
                        {
                            type: "text",
                            text: "Successfully disconnected from SAP OData service",
                        },
                    ],
                };
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.sapClient = null; // Force cleanup even if disconnect fails
                return {
                    content: [
                        {
                            type: "text",
                            text: `Warning during disconnect: ${errorMessage}\nConnection has been cleared.`,
                        },
                    ],
                };
            }
        }
        else {
            return {
                content: [
                    {
                        type: "text",
                        text: "No active SAP OData connection to disconnect",
                    },
                ],
            };
        }
    }
    async ensureConnected() {
        if (!this.sapClient) {
            console.log("Auto-connecting using .env credentials...");
            await this.handleConnect({});
        } else {
            // Also reconnect if the existing session has dropped
            const connected = await this.sapClient.isConnected().catch(() => false);
            if (!connected) {
                console.log("SAP session dropped, auto-reconnecting...");
                await this.handleConnect({});
            }
        }
    }
}
exports.SAPODataHandlers = SAPODataHandlers;
//# sourceMappingURL=handlers.js.map