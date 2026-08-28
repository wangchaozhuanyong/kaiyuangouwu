import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, StockLocation, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, VersionColumn } from 'typeorm';

import { CatalogImportState } from '../types';

import { CatalogImportRow } from './catalog-import-row.entity';

@Entity({ name: 'catalog_import_job' })
@Index('IDX_catalog_import_job_context_hash', ['channelId', 'stockLocationId', 'currencyCode', 'fileHash'])
@Index('IDX_catalog_import_job_state_created', ['state', 'createdAt'])
export class CatalogImportJob extends VendureEntity {
    constructor(input?: DeepPartial<CatalogImportJob>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_catalog_import_job_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => StockLocation, { nullable: false, onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'stockLocationId', foreignKeyConstraintName: 'FK_catalog_import_job_stock_location' })
    stockLocation: StockLocation;

    @EntityId()
    stockLocationId: ID;

    @Column({ type: 'varchar', length: 3 })
    currencyCode: CurrencyCode;

    @Column({ type: 'varchar', length: 255 })
    originalFilename: string;

    @Column({ type: 'varchar', length: 120 })
    mimeType: string;

    @Column('int')
    byteSize: number;

    @Column({ type: 'varchar', length: 64 })
    fileHash: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    sheetName: string | null;

    @Column({ type: 'simple-json', nullable: true })
    detectedHeaders: string[] | null;

    @Column({ type: 'simple-json', nullable: true })
    fieldMapping: Record<string, string> | null;

    @Column({ type: 'varchar', length: 24, default: 'PREVIEW_READY' })
    state: CatalogImportState;

    @Column({ type: 'varchar', length: 64, nullable: true })
    actorId: string | null;

    @Column('int', { default: 0 })
    totalRows: number;

    @Column('int', { default: 0 })
    createdCount: number;

    @Column('int', { default: 0 })
    updatedCount: number;

    @Column('int', { default: 0 })
    skippedCount: number;

    @Column('int', { default: 0 })
    conflictCount: number;

    @Column('int', { default: 0 })
    warningCount: number;

    @Column('int', { default: 0 })
    errorCount: number;

    @Column('int', { default: 0 })
    progress: number;

    @Column({ type: 'varchar', length: 500, nullable: true })
    errorMessage: string | null;

    @Column({ type: Date, nullable: true })
    startedAt: Date | null;

    @Column({ type: Date, nullable: true })
    completedAt: Date | null;

    @Column({ type: Date, nullable: true })
    rolledBackAt: Date | null;

    @OneToMany(() => CatalogImportRow, row => row.job)
    rows: CatalogImportRow[];

    @VersionColumn()
    version: number;
}
