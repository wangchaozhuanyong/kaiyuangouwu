import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { AfterSalesActorType, AfterSalesState } from '../after-sales.constants';
import { AfterSalesRequest } from './after-sales-request.entity';

@Entity({ name: 'after_sales_event' })
@Index('IDX_after_sales_event_request_created', ['requestId', 'createdAt'])
export class AfterSalesEvent extends VendureEntity {
    constructor(input?: DeepPartial<AfterSalesEvent>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 24 })
    state: AfterSalesState;

    @Column({ type: 'varchar', length: 16 })
    actorType: AfterSalesActorType;

    @Column({ type: 'varchar', length: 255 })
    actorLabel: string;

    @Column({ type: 'varchar', length: 64, nullable: true })
    actorId: string | null;

    @Column({ type: 'text' })
    note: string;

    @ManyToOne(() => AfterSalesRequest, request => request.events, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'requestId', foreignKeyConstraintName: 'FK_after_sales_event_request' })
    request: AfterSalesRequest;

    @EntityId()
    requestId: ID;
}
