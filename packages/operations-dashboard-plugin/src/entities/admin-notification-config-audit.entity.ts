import { DeepPartial } from '@vendure/common/lib/shared-types';
import { VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

export interface AdminNotificationConfigChange {
    before: unknown;
    after: unknown;
}

@Entity({ name: 'admin_notification_config_audit' })
@Index('IDX_admin_notification_config_audit_created', ['createdAt'])
export class AdminNotificationConfigAudit extends VendureEntity {
    constructor(input?: DeepPartial<AdminNotificationConfigAudit>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 32, default: 'UPDATED' })
    action: string;

    @Column({ type: 'varchar', length: 128, nullable: true })
    actorUserId: string | null;

    @Column({ type: 'simple-json' })
    changes: Record<string, AdminNotificationConfigChange>;
}
