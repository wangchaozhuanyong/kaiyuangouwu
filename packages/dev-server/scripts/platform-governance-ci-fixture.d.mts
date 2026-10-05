import type { MysqlConnectionOptions } from 'typeorm/driver/mysql/MysqlConnectionOptions.js';

export declare function ciFixtureOptions(env?: NodeJS.ProcessEnv): {
    host: '127.0.0.1';
    port: number;
    user: 'root';
    password: string;
};
export declare function createCiGovernanceDatabase(): Promise<MysqlConnectionOptions>;
