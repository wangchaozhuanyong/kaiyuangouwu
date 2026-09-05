import { DeepPartial, EntityId, ID, Session, User, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

@Entity('admin_two_factor_credential')
export class AdminTwoFactorCredential extends VendureEntity {
    constructor(input?: DeepPartial<AdminTwoFactorCredential>) {
        super(input);
    }

    @Index('IDX_admin_2fa_credential_user', { unique: true })
    @EntityId()
    userId: ID;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'userId' })
    user: User;

    @Column({ type: Date, nullable: true })
    enabledAt: Date | null;

    @Column({ type: 'text', nullable: true })
    encryptedSecret: string | null;

    @Column({ type: 'text', nullable: true })
    pendingSecret: string | null;

    @Column({ type: Date, nullable: true })
    pendingExpiresAt: Date | null;

    @Column({ type: 'simple-json' })
    recoveryHashes: string[];

    @Column({ default: -1 })
    lastUsedStep: number;

    @Column({ default: 0 })
    revision: number;

    @Column({ type: 'varchar', length: 64 })
    authVersion: string;
}

@Entity('admin_two_factor_challenge')
export class AdminTwoFactorChallenge extends VendureEntity {
    constructor(input?: DeepPartial<AdminTwoFactorChallenge>) {
        super(input);
    }

    @Index('IDX_admin_2fa_challenge_token', { unique: true })
    @Column({ type: 'varchar', length: 64 })
    tokenHash: string;

    @EntityId()
    userId: ID;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'userId' })
    user: User;

    @Column({ type: 'varchar', length: 64 })
    authVersion: string;

    @Column({ type: 'varchar', length: 64 })
    passwordFingerprint: string;

    @Index('IDX_admin_2fa_challenge_expires')
    @Column({ type: Date })
    expiresAt: Date;

    @Column({ type: Date, nullable: true })
    consumedAt: Date | null;

    @Column({ default: 0 })
    attempts: number;

    @Column({ default: false })
    rememberMe: boolean;
}

@Entity('admin_two_factor_session')
export class AdminTwoFactorSession extends VendureEntity {
    constructor(input?: DeepPartial<AdminTwoFactorSession>) {
        super(input);
    }

    @Index('IDX_admin_2fa_session_id', { unique: true })
    @EntityId()
    sessionId: ID;

    @ManyToOne(() => Session, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'sessionId' })
    session: Session;

    @EntityId()
    userId: ID;

    @Column({ type: 'varchar', length: 64 })
    authVersion: string;

    @Column({ type: 'varchar', length: 64 })
    passwordFingerprint: string;
}

@Entity('admin_two_factor_rate_limit')
export class AdminTwoFactorRateLimit extends VendureEntity {
    constructor(input?: DeepPartial<AdminTwoFactorRateLimit>) {
        super(input);
    }

    @Index('IDX_admin_2fa_rate_bucket', { unique: true })
    @Column({ type: 'varchar', length: 64 })
    bucket: string;

    @Index('IDX_admin_2fa_rate_expires')
    @Column({ type: Date })
    expiresAt: Date;

    @Column({ default: 0 })
    attempts: number;
}
