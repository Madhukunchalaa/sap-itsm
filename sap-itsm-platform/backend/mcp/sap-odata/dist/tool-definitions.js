"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toolDefinitions = void 0;
exports.toolDefinitions = [
    {
        name: "sap_get_services",
        description: "Get list of available OData services",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "sap_get_service_metadata",
        description: "Get metadata for a specific OData service",
        inputSchema: {
            type: "object",
            properties: {
                serviceName: { type: "string", description: "Name of the OData service" },
            },
            required: ["serviceName"],
        },
    },
    {
        name: "sap_query_entity_set",
        description: "Query an OData entity set with filtering, sorting, and pagination",
        inputSchema: {
            type: "object",
            properties: {
                serviceName: { type: "string", description: "Name of the OData service" },
                entitySet: { type: "string", description: "Name of the entity set" },
                select: {
                    type: "array",
                    items: { type: "string" },
                    description: "Fields to select"
                },
                filter: { type: "string", description: "OData filter expression" },
                orderby: { type: "string", description: "OData orderby expression" },
                top: { type: "number", description: "Number of records to return" },
                skip: { type: "number", description: "Number of records to skip" },
                expand: {
                    type: "array",
                    items: { type: "string" },
                    description: "Navigation properties to expand"
                },
            },
            required: ["serviceName", "entitySet"],
        },
    },
    {
        name: "sap_get_entity",
        description: "Get a specific entity by its key values",
        inputSchema: {
            type: "object",
            properties: {
                serviceName: { type: "string", description: "Name of the OData service" },
                entitySet: { type: "string", description: "Name of the entity set" },
                keyValues: {
                    type: "object",
                    description: "Key-value pairs for entity keys",
                    additionalProperties: true
                },
            },
            required: ["serviceName", "entitySet", "keyValues"],
        },
    },
    {
        name: "sap_connection_status",
        description: "Check SAP OData connection status and get connection info",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "sap_disconnect",
        description: "Disconnect from SAP OData service",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "sap_create_entity",
        description: "Create a new record in SAP OData. Use this ONLY when the user explicitly asks to create something new.",
        inputSchema: {
            type: "object",
            properties: {
                serviceName: { type: "string", description: "Name of the OData service" },
                entitySet: { type: "string", description: "Name of the entity set to create in" },
                data: { type: "object", description: "The JSON payload for the new record", additionalProperties: true },
            },
            required: ["serviceName", "entitySet", "data"],
        },
    },
    {
        name: "sap_update_entity",
        description: "Update an existing record in SAP OData. Use this ONLY when the user explicitly asks to update or modify something.",
        inputSchema: {
            type: "object",
            properties: {
                serviceName: { type: "string", description: "Name of the OData service" },
                entitySet: { type: "string", description: "Name of the entity set" },
                keyValues: { type: "object", description: "Primary key fields of the record to update", additionalProperties: true },
                data: { type: "object", description: "The JSON payload with fields to update", additionalProperties: true },
            },
            required: ["serviceName", "entitySet", "keyValues", "data"],
        },
    },
];
//# sourceMappingURL=tool-definitions.js.map