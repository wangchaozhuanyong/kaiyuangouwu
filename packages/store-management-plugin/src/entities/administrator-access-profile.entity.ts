import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Administrator, Channel, EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

export type AdministratorAccessScope = 'PLATFORM' | 'STORE';
export type AdministratorAccessAuthority = 'OWNER' | 'ADMIN' | 'MANAGER' | 'STAFF';
export type AdministratorAccessStatus = 'ACTIVE' | 'SUSPENDED';

@Entity({ name: 'administrator_access_profile' })
@Index('IDX_administrator_access_profile_administrator', ['administratorId'], { unique: true })
@Index('IDX_administrator_access_profile_user', ['userId'], { unique: true })
@Index('IDX_administrator_access_profile_channel', ['channelId'])
@Index('IDX_administrator_access_profile_owner_slot', ['platformOwnerSlot'], { unique: true })
@Index('IDX_administrator_access_profile_store_primary_slot', ['storePrimarySlot'], { unique: true })
export class AdministratorAccessProfile extends VendureEntity {
    constructor(input?: DeepPartial<AdministratorAccessProfile>) {
        super(input);
    }

    @ManyToOne(() => Administrator, { onDelete: 'CASCADE', nullable: false })
    @JoinColumn({
        name: 'administratorId',
        foreignKeyConstraintName: 'FK_administrator_access_profile_administrator',
    })
    administrator: Administrator;

    @EntityId()
    administratorId: ID;

    @EntityId()
    userId: ID;

    @Column({ type: 'varchar', length: 16 })
    scope: AdministratorAccessScope;

    @Column({ type: 'varchar', length: 16 })
    authority: AdministratorAccessAuthority;

    @Column({ type: 'varchar', length: 16, default: 'ACTIVE' })
    status: AdministratorAccessStatus;

    @ManyToOne(() => Channel, { onDelete: 'RESTRICT', nullable: true })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_administrator_access_profile_channel' })
    channel: Channel | null;

    @EntityId({ nullable: true })
    channelId: ID | null;

    @EntityId({ nullable: true })
    createdByAdministratorId: ID | null;

    @Column({ type: 'boolean', default: true })
    mustChangePassword: boolean;

    @Column({ type: 'varchar', length: 32, nullable: true })
    platformOwnerSlot: string | null;

    @Column({ type: 'varchar', length: 128, nullable: true })
    storePrimarySlot: string | null;
}
