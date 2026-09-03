import { DeepPartial } from '@vendure/common/lib/shared-types';
import { VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

import { type DepartmentCode, type NotificationSeverity } from '../department-notification-router';

export type NotificationDeliveryStatus = 'PENDING' | 'CLAIMED' | 'RETRY' | 'SENT' | 'DEAD' | 'SKIPPED';
export type NotificationEventState = 'INFO' | 'FIRING' | 'RESOLVED';
export type NotificationMode = 'ONE_OFF' | 'INCIDENT';
export type NotificationDeliveryAction = 'SEND' | 'EDIT';

@Entity({ name: 'admin_notification_outbox' })
@Index('IDX_admin_notification_dedup', ['dedupKey'], { unique: true })
@Index('IDX_admin_notification_active_fingerprint', ['activeFingerprint'], { unique: true })
@Index('IDX_admin_notification_delivery_claim', ['deliveryStatus', 'availableAt', 'priority'])
@Index('IDX_admin_notification_claimed_at', ['claimedAt'])
@Index('IDX_admin_notification_source', ['sourceType', 'sourceId'])
@Index('IDX_admin_notification_owner_status_created', ['ownerDepartmentCode', 'deliveryStatus', 'createdAt'])
@Index('IDX_admin_notification_sla', ['actionRequired', 'slaDueAt'])
export class AdminNotificationDelivery extends VendureEntity {
    constructor(input?: DeepPartial<AdminNotificationDelivery>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 100 })
    eventType: string;

    @Column({ type: 'varchar', length: 32 })
    category: string;

    @Column({ type: 'varchar', length: 32 })
    ownerDepartmentCode: DepartmentCode;

    @Column({ type: 'simple-json' })
    collaboratorDepartmentCodes: DepartmentCode[];

    @Column({ type: 'varchar', length: 32, nullable: true })
    escalationDepartmentCode: DepartmentCode | null;

    @Column('boolean', { default: false })
    actionRequired: boolean;

    @Column({ type: Date, nullable: true })
    slaDueAt: Date | null;

    @Column({ type: 'varchar', length: 500 })
    actionHint: string;

    @Column({ type: 'varchar', length: 2 })
    severity: NotificationSeverity;

    @Column({ type: 'varchar', length: 16 })
    mode: NotificationMode;

    @Column({ type: 'varchar', length: 16 })
    eventState: NotificationEventState;

    @Column({ type: 'varchar', length: 64, nullable: true })
    sourceType: string | null;

    @Column({ type: 'varchar', length: 128, nullable: true })
    sourceId: string | null;

    @Column({ type: 'varchar', length: 255, nullable: true })
    dedupKey: string | null;

    @Column({ type: 'varchar', length: 255, nullable: true })
    fingerprint: string | null;

    @Column({ type: 'varchar', length: 255, nullable: true })
    activeFingerprint: string | null;

    @Column({ type: 'varchar', length: 300 })
    title: string;

    @Column({ type: 'simple-json' })
    payload: Record<string, unknown>;

    @Column('int', { default: 1 })
    occurrenceCount: number;

    @Column({ type: Date })
    firstOccurredAt: Date;

    @Column({ type: Date })
    lastOccurredAt: Date;

    @Column({ type: Date, nullable: true })
    resolvedAt: Date | null;

    @Column({ type: Date, nullable: true })
    escalatedAt: Date | null;

    @Column('int', { default: 50 })
    priority: number;

    @Column('boolean', { default: false })
    silent: boolean;

    @Column({ type: 'varchar', length: 16, default: 'SEND' })
    deliveryAction: NotificationDeliveryAction;

    @Column({ type: 'varchar', length: 16, default: 'PENDING' })
    deliveryStatus: NotificationDeliveryStatus;

    @Column({ type: Date })
    availableAt: Date;

    @Column('int', { default: 0 })
    attempts: number;

    @Column('int', { default: 6 })
    maxAttempts: number;

    @Column({ type: Date, nullable: true })
    claimedAt: Date | null;

    @Column({ type: 'varchar', length: 160, nullable: true })
    claimedBy: string | null;

    @Column({ type: 'varchar', length: 64, nullable: true })
    telegramMessageId: string | null;

    @Column({ type: 'varchar', length: 120, nullable: true })
    queueJobId: string | null;

    @Column({ type: 'varchar', length: 64, nullable: true })
    lastErrorCode: string | null;

    @Column({ type: 'varchar', length: 1024, nullable: true })
    lastError: string | null;

    @Column({ type: Date, nullable: true })
    sentAt: Date | null;
}
