import { DeepPartial } from '@vendure/common/lib/shared-types';
import { VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

export type IncidentEvidenceEventType =
    | 'CREATED'
    | 'OCCURRED'
    | 'ACKNOWLEDGED'
    | 'ESCALATED'
    | 'RECOVERY_OBSERVED'
    | 'RECOVERY_VALIDATED'
    | 'REVIEW_SUBMITTED'
    | 'ACTION_COMPLETED'
    | 'CLOSED';

@Entity({ name: 'admin_incident_evidence' })
@Index('IDX_admin_incident_evidence_incident_created', ['incidentId', 'createdAt'])
@Index('IDX_admin_incident_evidence_event_id', ['eventId'], { unique: true })
@Index('IDX_admin_incident_evidence_hash', ['evidenceHash'], { unique: true })
export class AdminIncidentEvidence extends VendureEntity {
    constructor(input?: DeepPartial<AdminIncidentEvidence>) {
        super(input);
    }

    @Column('int')
    incidentId: number;

    @Column({ type: 'varchar', length: 36 })
    eventId: string;

    @Column({ type: 'varchar', length: 32 })
    eventType: IncidentEvidenceEventType;

    @Column({ type: 'varchar', length: 16 })
    actorType: 'SYSTEM' | 'ADMIN';

    @Column({ type: 'varchar', length: 128, nullable: true })
    actorUserId: string | null;

    @Column({ type: 'varchar', length: 500 })
    summary: string;

    @Column({ type: 'simple-json' })
    evidence: Record<string, unknown>;

    @Column({ type: Date })
    occurredAt: Date;

    @Column({ type: 'varchar', length: 64 })
    evidenceHash: string;
}
