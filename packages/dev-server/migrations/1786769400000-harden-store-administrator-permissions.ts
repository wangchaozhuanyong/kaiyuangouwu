import { Permission } from '@vendure/common/lib/generated-types';
import { Role } from '@vendure/core';
import { Like, MigrationInterface, QueryRunner } from 'typeorm';

const catalogWideWritePermissions: Permission[] = [
    Permission.CreateCatalog,
    Permission.UpdateCatalog,
    Permission.DeleteCatalog,
];

const scopedCatalogWritePermissions: Permission[] = [
    Permission.CreateProduct,
    Permission.ReadProduct,
    Permission.UpdateProduct,
    Permission.DeleteProduct,
    Permission.CreateCollection,
    Permission.ReadCollection,
    Permission.UpdateCollection,
    Permission.DeleteCollection,
    Permission.CreateFacet,
    Permission.ReadFacet,
    Permission.UpdateFacet,
    Permission.DeleteFacet,
    Permission.CreateAsset,
    Permission.ReadAsset,
    Permission.UpdateAsset,
    Permission.DeleteAsset,
];

const permissionsAddedByMigration: Permission[] = scopedCatalogWritePermissions.filter(
    permission => permission !== Permission.CreateAsset && permission !== Permission.ReadAsset,
);

export class HardenStoreAdministratorPermissions1786769400000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const repository = queryRunner.manager.getRepository(Role);
        const roles = await repository.find({ where: { code: Like('%-store-admin') } });
        for (const role of roles) {
            role.permissions = [
                ...new Set([
                    ...role.permissions.filter(permission => !catalogWideWritePermissions.includes(permission)),
                    ...scopedCatalogWritePermissions,
                ]),
            ];
        }
        if (roles.length > 0) {
            await repository.save(roles);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const repository = queryRunner.manager.getRepository(Role);
        const roles = await repository.find({ where: { code: Like('%-store-admin') } });
        for (const role of roles) {
            role.permissions = [
                ...new Set([
                    ...role.permissions.filter(permission => !permissionsAddedByMigration.includes(permission)),
                    Permission.CreateCatalog,
                    Permission.UpdateCatalog,
                    Permission.DeleteCatalog,
                ]),
            ];
        }
        if (roles.length > 0) {
            await repository.save(roles);
        }
    }
}
