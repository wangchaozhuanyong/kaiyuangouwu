import { Administrator, DeepPartial, EntityId, ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

@Entity({ name: 'store_administrator_access' })
@Index('IDX_store_administrator_access_administrator', ['administratorId'], { unique: true })
@Index('IDX_store_administrator_access_user', ['userId'], { unique: true })
export class StoreAdministratorAccess extends VendureEntity {
    constructor(input?: DeepPartial<StoreAdministratorAccess>) {
        super(input);
    }

    @ManyToOne(() => Administrator, { onDelete: 'CASCADE', nullable: false })
    @JoinColumn({
        name: 'administratorId',
        foreignKeyConstraintName: 'FK_store_administrator_access_administrator',
    })
    administrator: Administrator;

    @EntityId()
    administratorId: ID;

    @EntityId()
    userId: ID;

    @Column('boolean', { default: true })
    mustChangePassword: boolean;
}
