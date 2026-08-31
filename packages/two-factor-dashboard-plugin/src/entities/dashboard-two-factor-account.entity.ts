import { Administrator, DeepPartial, EntityId, ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

@Entity({ name: 'dashboard_two_factor_account' })
@Index('IDX_dashboard_two_factor_owner_created', ['administratorId', 'createdAt'])
@Index('IDX_dashboard_two_factor_owner_fingerprint', ['administratorId', 'fingerprint'], {
    unique: true,
})
export class DashboardTwoFactorAccount extends VendureEntity {
    constructor(input?: DeepPartial<DashboardTwoFactorAccount>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 80 })
    projectName: string;

    @Column({ type: 'text' })
    encryptedSecret: string;

    @Column({ type: 'varchar', length: 64 })
    fingerprint: string;

    @Column({ type: Date, nullable: true })
    lastUsedAt: Date | null;

    @ManyToOne(() => Administrator, { onDelete: 'CASCADE', nullable: false })
    @JoinColumn({
        name: 'administratorId',
        foreignKeyConstraintName: 'FK_dashboard_two_factor_administrator',
    })
    administrator: Administrator;

    @EntityId()
    administratorId: ID;
}
