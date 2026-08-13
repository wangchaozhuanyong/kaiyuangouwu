import { MigrationInterface, QueryRunner } from 'typeorm';

export class LocalizeDefaultActors1786516200000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            UPDATE "seller"
            SET "name" = '默认商家'
            WHERE "name" = 'Default Seller'
        `);
        await queryRunner.query(`
            UPDATE "administrator"
            SET "firstName" = '超级管理员', "lastName" = ''
            WHERE "emailAddress" = 'superadmin'
              AND "firstName" IN ('Super', '超级管理员 / Super Admin')
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            UPDATE "seller"
            SET "name" = 'Default Seller'
            WHERE "name" = '默认商家'
        `);
        await queryRunner.query(`
            UPDATE "administrator"
            SET "firstName" = '超级管理员 / Super Admin', "lastName" = ''
            WHERE "emailAddress" = 'superadmin'
              AND "firstName" = '超级管理员'
        `);
    }
}
