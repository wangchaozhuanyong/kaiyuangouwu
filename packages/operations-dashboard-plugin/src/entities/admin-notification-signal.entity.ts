import { DeepPartial } from '@vendure/common/lib/shared-types';
import { VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';
@Entity('admin_notification_signal')
@Index('IDX_admin_notification_signal_key', ['key'], { unique: true })
@Index('IDX_admin_notification_signal_expiry', ['expiresAt'])
@Index('IDX_admin_notification_signal_identity', ['identityHash', 'expiresAt'])
export class AdminNotificationSignal extends VendureEntity {
    constructor(input?: DeepPartial<AdminNotificationSignal>) {
        super(input);
    }
    @Column({ type: 'varchar', length: 64 }) key: string;
    @Column({ type: 'varchar', length: 64 }) identityHash: string;
    @Column({ type: 'int', default: 0 }) count: number;
    @Column({ type: Date }) expiresAt: Date;
}
