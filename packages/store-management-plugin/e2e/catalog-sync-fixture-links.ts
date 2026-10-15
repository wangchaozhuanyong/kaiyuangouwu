import { Collection, ID, TransactionalConnection } from '@vendure/core';

export function requireSyntheticFixture<T>(value: T | null | undefined): T {
    if (value == null) throw new Error('Required synthetic fixture was not created');
    return value;
}

/** The real collection Worker may already have applied the same synthetic membership. */
export async function addSyntheticCollectionMembers(
    connection: TransactionalConnection,
    collectionId: ID,
    variantIds: ID[],
) {
    if (!variantIds.length) return;
    const relation = requireSyntheticFixture(
        connection.rawConnection
            .getMetadata(Collection)
            .relations.find(item => item.propertyName === 'productVariants'),
    );
    await connection.rawConnection
        .createQueryBuilder()
        .insert()
        .into(requireSyntheticFixture(relation.junctionEntityMetadata).tablePath)
        .values(
            variantIds.map(id => ({
                [relation.joinColumns[0].databaseName]: collectionId,
                [relation.inverseJoinColumns[0].databaseName]: id,
            })),
        )
        .orIgnore()
        .execute();
}
