import { UserInputError, VendureEntity } from '@vendure/core';
import { FindOptionsWhere, IsNull, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

/** Patch only owned fields; reject a concurrent change to those same fields.
 * Metadata writers must also use narrow UPDATEs, never save a previously read entity.
 */
export async function updateIcloudRecord<T extends VendureEntity>(
    repo: Repository<T>,
    original: T,
    patch: QueryDeepPartialEntity<T>,
    guards: Array<keyof T> = Object.keys(patch) as Array<keyof T>,
    conflict: 'throw' | 'skip' = 'throw',
): Promise<boolean> {
    if (!Object.keys(patch).length) return true;
    const where = Object.fromEntries([
        ['id', original.id],
        ...guards.map(key => [key, original[key] == null ? IsNull() : original[key]]),
    ]) as FindOptionsWhere<T>;
    const result = await repo.update(where, patch);
    if (result.affected !== 1) {
        if (conflict === 'skip') return false;
        throw new UserInputError('邮箱记录已发生变化或已删除，请刷新后重试');
    }
    return true;
}
