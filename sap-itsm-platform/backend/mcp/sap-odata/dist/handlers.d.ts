import { ODataServiceList } from "./types";
export declare class SAPODataHandlers {
    private sapClient;
    handleConnect(args: any): Promise<{
        content: {
            type: string;
            text: string;
        }[];
    }>;
    handleGetServices(): Promise<{
        content: {
            type: string;
            text: string;
        }[];
        _rawData: ODataServiceList;
    }>;
    handleGetServiceMetadata(args: any): Promise<{
        content: {
            type: string;
            text: string;
        }[];
        _rawData: import("./types").ODataMetadata;
    }>;
    handleQueryEntitySet(args: any): Promise<{
        content: {
            type: string;
            text: string;
        }[];
        _rawData: any;
    }>;
    handleGetEntity(args: any): Promise<{
        content: {
            type: string;
            text: string;
        }[];
        _rawData: any;
    }>;
    handleCreateEntity(args: any): Promise<{
        content: {
            type: string;
            text: string;
        }[];
        _rawData: any;
    }>;
    handleUpdateEntity(args: any): Promise<{
        content: {
            type: string;
            text: string;
        }[];
        _rawData: any;
    }>;
    handleDeleteEntity(args: any): Promise<{
        content: {
            type: string;
            text: string;
        }[];
    }>;
    handleCallFunction(args: any): Promise<{
        content: {
            type: string;
            text: string;
        }[];
        _rawData: any;
    }>;
    handleConnectionStatus(): Promise<{
        content: {
            type: string;
            text: string;
        }[];
    }>;
    handleDisconnect(): Promise<{
        content: {
            type: string;
            text: string;
        }[];
    }>;
    private ensureConnected;
}
//# sourceMappingURL=handlers.d.ts.map