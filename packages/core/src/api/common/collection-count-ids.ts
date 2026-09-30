import { ID } from '@vendure/common/lib/shared-types';

import { Collection } from '../../entity/collection/collection.entity';

/** Include loaded descendants when prefetching counts for a collection tree. */
export function collectionCountIds(collections: readonly Collection[]): ID[] {
    const ids = new Set<ID>();
    const visit = (collection: Collection) => {
        ids.add(collection.id);
        collection.children?.forEach(visit);
    };
    collections.forEach(visit);
    return [...ids];
}
