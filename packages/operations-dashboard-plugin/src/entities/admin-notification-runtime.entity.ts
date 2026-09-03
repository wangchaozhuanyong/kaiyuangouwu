import { DeepPartial } from '@vendure/common/lib/shared-types';
import { VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity({ name: 'admin_notification_runtime' })
@Index('IDX_admin_notification_runtime_key', ['key'], { unique: true })
export class AdminNotificationRuntime extends VendureEntity {
    constructor(input?: DeepPartial<AdminNotificationRuntime>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 48, default: 'telegram-worker' })
    key: string;

    @Column({ type: 'varchar', length: 16, default: 'STOPPED' })
    state: string;

    @Column({ type: 'varchar', length: 160, nullable: true })
    workerId: string | null;

    @Column({ type: Date, nullable: true })
    heartbeatAt: Date | null;

    @Column({ type: Date, nullable: true })
    lastSuccessAt: Date | null;

    @Column({ type: Date, nullable: true })
    lastErrorAt: Date | null;

    @Column({ type: 'varchar', length: 500, nullable: true })
    lastError: string | null;

    @Column('int', { default: 0 })
    processed: number;

    @Column('int', { default: 0 })
    failures: number;
}
