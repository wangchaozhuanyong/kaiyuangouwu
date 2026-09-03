import { DeepPartial } from '@vendure/common/lib/shared-types';
import { VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

import { type DepartmentRouteOverride, type NotificationSeverity } from '../department-notification-router';

@Entity({ name: 'admin_notification_config' })
@Index('IDX_admin_notification_config_key', ['key'], { unique: true })
export class AdminNotificationConfig extends VendureEntity {
    constructor(input?: DeepPartial<AdminNotificationConfig>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 48, default: 'telegram-internal' })
    key: string;

    @Column('boolean', { default: false })
    enabled: boolean;

    @Column({ type: 'varchar', length: 64, nullable: true })
    chatId: string | null;

    @Column({ type: 'varchar', length: 500, nullable: true })
    adminBaseUrl: string | null;

    @Column({ type: 'varchar', length: 64, default: 'Asia/Kuala_Lumpur' })
    timezone: string;

    @Column({ type: 'varchar', length: 2, default: 'P3' })
    minSeverity: NotificationSeverity;

    @Column('boolean', { default: true })
    sendResolved: boolean;

    @Column('boolean', { default: true })
    p2Silent: boolean;

    @Column('boolean', { default: true })
    p3Silent: boolean;

    @Column('boolean', { default: true })
    notifyOrderEvents: boolean;

    @Column('boolean', { default: true })
    notifyPaymentEvents: boolean;

    @Column('boolean', { default: true })
    notifyFulfillmentEvents: boolean;

    @Column('boolean', { default: true })
    notifyRefundEvents: boolean;

    @Column('boolean', { default: true })
    notifyInventoryEvents: boolean;

    @Column('int', { default: 2 })
    inventoryLowThreshold: number;

    @Column('int', { default: 60 })
    p1EscalationMinutes: number;

    @Column('int', { default: 30 })
    p0RepeatMinutes: number;

    @Column('int', { default: 120 })
    p1RepeatMinutes: number;

    @Column({ type: 'simple-json', nullable: true })
    departmentMentions: Record<string, string> | null;

    @Column({ type: 'simple-json', nullable: true })
    routeOverrides: DepartmentRouteOverride[] | null;

    @Column({ type: 'varchar', length: 120, nullable: true })
    botUsername: string | null;

    @Column({ type: Date, nullable: true })
    lastConnectionAt: Date | null;

    @Column({ type: 'varchar', length: 500, nullable: true })
    lastConnectionError: string | null;
}
