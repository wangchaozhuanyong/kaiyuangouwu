export type DataTableSortDirection = 'ASC' | 'DESC';

/**
 * 后台数据表的统一默认排序。
 *
 * 记录型列表以最新数据优先，并使用 id 作为相同时间下的稳定第二排序键。
 * 层级、人工编排和下拉查找使用显式的业务顺序，不得被“最新在上”覆盖。
 */
export const dataTableSortPolicy = {
    newestCreated: { createdAt: 'DESC', id: 'DESC' },
    newestUpdated: { updatedAt: 'DESC', id: 'DESC' },
    newestOrderPlaced: { orderPlacedAt: 'DESC', id: 'DESC' },
    manualPosition: { position: 'ASC', id: 'ASC' },
    alphabeticalName: { name: 'ASC', id: 'ASC' },
    alphabeticalCode: { code: 'ASC', id: 'ASC' },
} as const satisfies Record<string, Readonly<Record<string, DataTableSortDirection>>>;
