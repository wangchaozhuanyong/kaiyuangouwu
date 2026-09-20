import { DeepPartial } from '@vendure/common/lib/shared-types';
import { VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

import { type DepartmentCode } from '../department-notification-router';

export type IncidentActionStatus = 'OPEN' | 'COMPLETED';

@Entity({ name: 'admin_incident_action' })
@Index('IDX_admin_incident_action_incident_status', ['incidentId', 'status'])
@Index('IDX_admin_incident_action_due', ['status', 'dueAt'])
export class AdminIncidentAction extends VendureEntity {
    constructor(input?: DeepPartial<AdminIncidentAction>) {
        super(input);
    }

    @Column('int')
    incidentId: number;

    @Column({ type: 'varchar', length: 500 })
    title: string;

    @Column({ type: 'varchar', length: 32 })
    ownerDepartmentCode: DepartmentCode;

    @Column({ type: Date })
    dueAt: Date;

    @Column({ type: 'varchar', length: 16, default: 'OPEN' })
    status: IncidentActionStatus;

    @Column({ type: Date, nullable: true })
    completedAt: Date | null;

    @Column({ type: 'varchar', length: 128, nullable: true })
    completedByUserId: string | null;

    @Column({ type: 'varchar', length: 1000, nullable: true })
    completionNote: string | null;

    @Column({ type: Date, nullable: true })
    escalatedAt: Date | null;
}
