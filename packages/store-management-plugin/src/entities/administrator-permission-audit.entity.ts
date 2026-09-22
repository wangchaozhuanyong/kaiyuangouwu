import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity({ name: 'administrator_permission_audit' })
@Index('IDX_administrator_permission_audit_created', ['createdAt'])
@Index('IDX_administrator_permission_audit_channel', ['channelId', 'createdAt'])
export class AdministratorPermissionAudit extends VendureEntity {
    constructor(input?: DeepPartial<AdministratorPermissionAudit>) {
        super(input);
    }

    @EntityId({ nullable: true })
    actorAdministratorId: ID | null;

    @EntityId({ nullable: true })
    targetAdministratorId: ID | null;

    @EntityId({ nullable: true })
    targetRoleId: ID | null;

    @EntityId({ nullable: true })
    channelId: ID | null;

    @Column({ type: 'varchar', length: 64 })
    action: string;

    @Column({ type: 'varchar', length: 16 })
    result: 'SUCCESS' | 'FAILED';

    @Column({ type: 'simple-json', nullable: true })
    beforeSummary: Record<string, unknown> | null;

    @Column({ type: 'simple-json', nullable: true })
    afterSummary: Record<string, unknown> | null;

    @Column({ type: 'varchar', length: 500, nullable: true })
    failureReason: string | null;
}
