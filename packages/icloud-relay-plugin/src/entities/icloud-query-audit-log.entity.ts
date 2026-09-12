import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

import { IcloudAuditResult } from '../types';

@Entity({ name: 'icloud_query_audit_log' })
@Index('IDX_icloud_audit_code_time', ['queryCode', 'queriedAt'])
@Index('IDX_icloud_audit_ip_time', ['ipAddress', 'queriedAt'])
export class IcloudQueryAuditLog extends VendureEntity {
    constructor(input?: DeepPartial<IcloudQueryAuditLog>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 64 })
    queryCode: string;

    @Column({ type: 'varchar', length: 32, nullable: true })
    targetType: string | null;

    @Column({ type: 'varchar', length: 64, nullable: true })
    targetId: string | null;

    @Column({ type: 'varchar', length: 64 })
    ipAddress: string;

    @Column({ type: 'text', nullable: true })
    userAgent: string | null;

    @Column({
        type: 'varchar',
        length: 32,
        default: IcloudAuditResult.SUCCESS,
    })
    result: IcloudAuditResult;

    @Column({ type: Date })
    queriedAt: Date;
}
