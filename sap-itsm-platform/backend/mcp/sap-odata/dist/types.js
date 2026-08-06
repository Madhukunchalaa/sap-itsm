"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SAPODataConfigSchema = void 0;
const zod_1 = require("zod");
// SAP OData Connection Configuration Schema
exports.SAPODataConfigSchema = zod_1.z.object({
    baseUrl: zod_1.z.string().describe("SAP OData service base URL (e.g., https://sap-host:8000/sap/opu/odata/sap/)"),
    username: zod_1.z.string().describe("SAP username"),
    password: zod_1.z.string().describe("SAP password"),
    client: zod_1.z.string().optional().describe("SAP client number (if required)"),
    // Optional HTTP configuration
    timeout: zod_1.z.number().default(30000).describe("Request timeout in milliseconds"),
    validateSSL: zod_1.z.boolean().default(true).describe("Validate SSL certificates"),
    // CSRF token handling
    enableCSRF: zod_1.z.boolean().default(true).describe("Enable CSRF token handling"),
});
//# sourceMappingURL=types.js.map