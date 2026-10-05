import type { Connection } from 'mysql2/promise';

export interface MysqlLabDescriptor {
    format: 1;
    purpose: 'vendure-owned-synthetic-migration-lab-v1';
    endpoint: string;
    runId: string;
    directory: string;
    image: string;
    networkId: string;
    containerId: string;
    transport: 'owned-container-stdio';
    serverUuid: string;
}

export interface MysqlCaseManifest {
    format: 1;
    scope: MysqlLabDescriptor['purpose'];
    runId: string;
    serverUuid: string;
    caseId: string;
    database: string;
    blueprintSha256: string;
    schemaSha256: string;
    sourceSha256: string;
    afterSha256: string;
    operations: unknown[];
    productionReady: false;
}

export type MysqlBlueprint = Record<
    string,
    {
        columns: Array<{ name: string; type: string }>;
        primary: string[];
        unique: string[][];
        rows: Array<Record<string, unknown>>;
    }
>;

export declare const labRoot: string;
export declare const CONTROL: 'rehearsal_control';
export declare function atomicJson(filename: string, value: unknown): Promise<void>;
export declare function verifyLab(filename: string): Promise<MysqlLabDescriptor>;
export declare function createLab(options?: { subnet?: string }): Promise<string>;
export declare function stopLab(filename: string): Promise<void>;
export declare function mysqlBlueprint(): Promise<MysqlBlueprint>;
export declare function mysqlInventory(
    connection: Connection,
    lock?: boolean,
): Promise<Record<string, { schema: string; rows: Array<Record<string, unknown>> }>>;
export declare function createCase(labFile: string): Promise<string>;
export declare function connectCase(filename: string): Promise<{
    connection: Connection;
    manifest: MysqlCaseManifest;
    blueprint: MysqlBlueprint;
}>;
