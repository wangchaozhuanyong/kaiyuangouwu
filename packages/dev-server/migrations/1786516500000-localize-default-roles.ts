import { MigrationInterface, QueryRunner } from 'typeorm';

export class LocalizeDefaultRoles1786516500000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            UPDATE "role"
            SET "description" = '超级管理员'
            WHERE "code" = '__super_admin_role__'
        `);
        await queryRunner.query(`
            UPDATE "role"
            SET "description" = '客户'
            WHERE "code" = '__customer_role__'
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            UPDATE "role"
            SET "description" = '超级管理员 / Super Admin'
            WHERE "code" = '__super_admin_role__'
        `);
        await queryRunner.query(`
            UPDATE "role"
            SET "description" = '客户 / Customer'
            WHERE "code" = '__customer_role__'
        `);
    }
}
