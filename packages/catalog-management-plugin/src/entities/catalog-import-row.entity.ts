import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { CatalogImportAction, CatalogImportResolution, NormalizedCatalogRow } from '../types';

import { CatalogImportJob } from './catalog-import-job.entity';

@Entity({ name: 'catalog_import_row' })
@Index('IDX_catalog_import_row_job_number', ['jobId', 'rowNumber'], { unique: true })
@Index('IDX_catalog_import_row_job_action', ['jobId', 'action'])
export class CatalogImportRow extends VendureEntity {
    constructor(input?: DeepPartial<CatalogImportRow>) {
        super(input);
    }

    @ManyToOne(() => CatalogImportJob, job => job.rows, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'jobId', foreignKeyConstraintName: 'FK_catalog_import_row_job' })
    job: CatalogImportJob;

    @EntityId()
    jobId: ID;

    @Column('int')
    rowNumber: number;

    @Column({ type: 'varchar', length: 64 })
    productKey: string;

    @Column({ type: 'varchar', length: 64 })
    sourceKey: string;

    @Column({ type: 'varchar', length: 64 })
    rowFingerprint: string;

    @Column({ type: 'varchar', length: 24 })
    action: CatalogImportAction;

    @Column({ type: 'varchar', length: 24, nullable: true })
    resolution: CatalogImportResolution | null;

    @EntityId({ nullable: true })
    targetProductId: ID | null;

    @EntityId({ nullable: true })
    targetVariantId: ID | null;

    @Column({ type: Date, nullable: true })
    expectedProductUpdatedAt: Date | null;

    @Column({ type: Date, nullable: true })
    expectedVariantUpdatedAt: Date | null;

    @Column({ type: 'simple-json' })
    normalizedData: NormalizedCatalogRow;

    @Column({ type: 'simple-json', nullable: true })
    beforeSnapshot: Record<string, unknown> | null;

    @Column({ type: 'simple-json', nullable: true })
    plannedChanges: Record<string, unknown> | null;

    @Column({ type: 'simple-json', nullable: true })
    appliedSnapshot: Record<string, unknown> | null;

    @Column({ type: 'varchar', length: 500, nullable: true })
    message: string | null;

    @Column({ type: Date, nullable: true })
    appliedAt: Date | null;
}
