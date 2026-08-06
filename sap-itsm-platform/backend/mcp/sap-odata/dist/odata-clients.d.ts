import { SAPODataConfig, ODataQueryOptions, ODataServiceList, ODataMetadata, ConnectionInfo } from "./types";
export declare class SAPODataClient {
    private httpClient;
    private config;
    private connected;
    private csrfToken;
    private cookies;
    constructor(config: SAPODataConfig);
    private setupInterceptors;
    connect(): Promise<void>;
    private fetchCSRFToken;
    disconnect(): Promise<void>;
    isConnected(): Promise<boolean>;
    getServices(): Promise<ODataServiceList>;
    getServiceMetadata(serviceName: string): Promise<ODataMetadata>;
    queryEntitySet(serviceName: string, entitySet: string, options?: ODataQueryOptions): Promise<any>;
    getEntity(serviceName: string, entitySet: string, keyValues: Record<string, any>): Promise<any>;
    createEntity(serviceName: string, entitySet: string, data: any): Promise<any>;
    updateEntity(serviceName: string, entitySet: string, keyValues: Record<string, any>, data: any): Promise<any>;
    deleteEntity(serviceName: string, entitySet: string, keyValues: Record<string, any>): Promise<void>;
    callFunction(serviceName: string, functionName: string, parameters?: Record<string, any>): Promise<any>;
    private ensureConnected;
    private extractServices;
    private extractMetadata;
    private getErrorMessage;
    getConnectionInfo(): ConnectionInfo;
}
//# sourceMappingURL=odata-clients.d.ts.map