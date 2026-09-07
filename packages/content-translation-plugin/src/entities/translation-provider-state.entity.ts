import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Shared by API preview requests and every worker using this provider. Contains no credentials. */
@Entity({ name: 'content_translation_provider_state' })
export class TranslationProviderState {
    @PrimaryColumn('varchar', { length: 128 }) provider: string;
    @Column('int', { default: 0 }) attempts: number;
    @Column('boolean', { default: false }) blocked: boolean;
    @Column({ type: Date, nullable: true }) nextAttemptAt: Date | null;
    @Column({ type: Date, nullable: true }) leaseUntil: Date | null;
    @Column('varchar', { length: 36, nullable: true }) leaseToken: string | null;
    @Column('varchar', { length: 32, nullable: true }) lastErrorCode: string | null;
    @Column('int', { default: 0 }) notificationVersion: number;
    @Column('int', { default: 0 }) scanOffset: number;
    @Column('int', { default: 0 }) scanChannelIndex: number;
    @Column('boolean', { default: false }) scanComplete: boolean;
}
