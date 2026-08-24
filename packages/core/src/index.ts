// Re-export DI runtime tokens so workspace packages always use the same
// physical NestJS instance as Vendure Core (Bun may otherwise keep duplicates).
export { ModuleRef, NestFactory } from '@nestjs/core';
export {
    AdjustmentType,
    AssetType,
    CurrencyCode,
    LanguageCode,
    Permission,
} from '@vendure/common/lib/generated-types';
export * from '@vendure/common/lib/shared-types';
export * from './api/index';
export * from './bootstrap';
export * from './cache/index';
export * from './common/index';
export * from './config/index';
export * from './connection/index';
export * from './data-import/index';
export * from './entity/index';
export * from './event-bus/index';
export * from './health-check/index';
export * from './i18n/index';
export * from './job-queue/index';
export { generateMigration, revertLastMigration, runMigrations } from './migrate';
export * from './migration-utils/index';
export * from './plugin/index';
export * from './process-context/index';
export * from './scheduler/index';
export * from './service/index';
export { VENDURE_VERSION } from './version';
export * from './worker/index';
