import { PluginCommonModule, VendurePlugin } from '@vendure/core';

import { adminNotificationApiExtensions } from './admin-notification-api';
import { AdminNotificationConfigService } from './admin-notification-config.service';
import { AdminNotificationEventSubscriber } from './admin-notification-event-subscriber';
import { AdminNotificationHealthController } from './admin-notification-health.controller';
import { AdminNotificationResolver } from './admin-notification.resolver';
import { AdminNotificationService } from './admin-notification.service';
import { reconcileAdminNotificationsTask } from './admin-notification.tasks';
import { AdminNotificationConfigAudit } from './entities/admin-notification-config-audit.entity';
import { AdminNotificationConfig } from './entities/admin-notification-config.entity';
import { AdminNotificationDelivery } from './entities/admin-notification-delivery.entity';
import { AdminNotificationRuntime } from './entities/admin-notification-runtime.entity';
import { SystemDependencyWatchdog } from './system-dependency-watchdog.service';
import { TelegramClient } from './telegram-client';
import { TelegramNotificationWorkerService } from './telegram-notification-worker.service';

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [
        AdminNotificationConfig,
        AdminNotificationConfigAudit,
        AdminNotificationDelivery,
        AdminNotificationRuntime,
    ],
    controllers: [AdminNotificationHealthController],
    providers: [
        TelegramClient,
        AdminNotificationConfigService,
        TelegramNotificationWorkerService,
        AdminNotificationService,
        AdminNotificationEventSubscriber,
        SystemDependencyWatchdog,
    ],
    configuration: config => {
        config.schedulerOptions.tasks.push(reconcileAdminNotificationsTask);
        return config;
    },
    adminApiExtensions: {
        schema: adminNotificationApiExtensions,
        resolvers: [AdminNotificationResolver],
    },
    dashboard: '../src/dashboard/index.tsx',
    compatibility: '^3.7.0',
})
export class OperationsDashboardPlugin {}
