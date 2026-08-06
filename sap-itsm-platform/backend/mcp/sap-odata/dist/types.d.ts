import { z } from "zod";
export declare const SAPODataConfigSchema: z.ZodObject<{
    baseUrl: z.ZodString;
    username: z.ZodString;
    password: z.ZodString;
    client: z.ZodOptional<z.ZodString>;
    timeout: z.ZodDefault<z.ZodNumber>;
    validateSSL: z.ZodDefault<z.ZodBoolean>;
    enableCSRF: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    baseUrl: string;
    username: string;
    password: string;
    timeout: number;
    validateSSL: boolean;
    enableCSRF: boolean;
    client?: string | undefined;
}, {
    baseUrl: string;
    username: string;
    password: string;
    client?: string | undefined;
    timeout?: number | undefined;
    validateSSL?: boolean | undefined;
    enableCSRF?: boolean | undefined;
}>;
export type SAPODataConfig = z.infer<typeof SAPODataConfigSchema>;
export interface ODataQueryOptions {
    select?: string[];
    filter?: string;
    orderby?: string;
    top?: number;
    skip?: number;
    expand?: string[];
}
export interface ODataService {
    name: string;
    title: string;
    version?: string;
    url?: string;
}
export interface ODataEntity {
    name: string;
    properties: ODataProperty[];
}
export interface ODataProperty {
    name: string;
    type: string;
    nullable: boolean;
}
export interface ODataFunction {
    name: string;
    returnType?: string;
}
export interface ODataMetadata {
    entities: ODataEntity[];
    functions: ODataFunction[];
    raw?: any;
}
export interface ODataServiceList {
    services: ODataService[];
    source?: 'gateway_catalog' | 'common_services_test' | 'none_found' | string;
    catalogUrl?: string;
    message?: string;
    raw?: any;
}
export interface ConnectionInfo {
    connected: boolean;
    baseUrl: string;
    username: string;
    client?: string;
    timeout: number;
    enableCSRF: boolean;
    hasCSRFToken: boolean;
}
//# sourceMappingURL=types.d.ts.map