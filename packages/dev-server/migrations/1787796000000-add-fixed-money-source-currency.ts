import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddFixedMoneySourceCurrency1787796000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await this.addCurrencyColumn(queryRunner, 'customer_coupon');
        await this.addCurrencyColumn(queryRunner, 'referral_program_config');
        await this.backfillPromotionCurrencies(queryRunner);
        await this.backfillShippingCurrencies(queryRunner);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const tableName of ['referral_program_config', 'customer_coupon']) {
            const table = await queryRunner.getTable(tableName);
            if (table?.findColumnByName('currencyCode')) {
                await queryRunner.dropColumn(tableName, 'currencyCode');
            }
        }
    }

    private async addCurrencyColumn(queryRunner: QueryRunner, tableName: string): Promise<void> {
        const table = await queryRunner.getTable(tableName);
        if (!table || table.findColumnByName('currencyCode')) return;
        await queryRunner.addColumn(
            tableName,
            new TableColumn({
                name: 'currencyCode',
                type: 'varchar',
                length: '3',
                isNullable: false,
                default: "'CNY'",
            }),
        );
        const escape = (identifier: string) => queryRunner.connection.driver.escape(identifier);
        const targetTable = escape(tableName);
        await queryRunner.query(
            [
                `UPDATE ${targetTable} SET ${escape('currencyCode')} = COALESCE(`,
                `(SELECT ${escape('defaultCurrencyCode')} FROM ${escape('channel')}`,
                `WHERE ${escape('channel')}.${escape('id')} = ${targetTable}.${escape('channelId')}), 'CNY')`,
            ].join(' '),
        );
    }

    private async backfillPromotionCurrencies(queryRunner: QueryRunner): Promise<void> {
        if (
            !(await queryRunner.hasTable('promotion')) ||
            !(await queryRunner.hasTable('promotion_channels_channel'))
        ) {
            return;
        }
        const escape = (identifier: string) => queryRunner.connection.driver.escape(identifier);
        const hasCouponConfigs = await queryRunner.hasTable('store_coupon_campaign_config');
        const couponJoin = hasCouponConfigs
            ? ` LEFT JOIN ${escape('store_coupon_campaign_config')} cfg ON cfg.${escape('promotionId')} = p.${escape('id')}`
            : '';
        const couponSelect = hasCouponConfigs
            ? `, cfg.${escape('id')} AS couponConfigId`
            : ', NULL AS couponConfigId';
        const promotionQuery = [
            `SELECT p.${escape('id')} AS id, p.${escape('conditions')} AS conditions,`,
            `p.${escape('actions')} AS actions, c.${escape('defaultCurrencyCode')} AS currencyCode${couponSelect}`,
            `FROM ${escape('promotion')} p`,
            `JOIN ${escape('promotion_channels_channel')} pc ON pc.${escape('promotionId')} = p.${escape('id')}`,
            `JOIN ${escape('channel')} c ON c.${escape('id')} = pc.${escape('channelId')}${couponJoin}`,
        ].join(' ');
        const rows = (await queryRunner.query(promotionQuery)) as Array<{
            id: string | number;
            conditions: unknown;
            actions: unknown;
            currencyCode: string;
            couponConfigId: string | number | null;
        }>;
        for (const row of rows) {
            const conditions = jsonOperations(row.conditions);
            const actions = jsonOperations(row.actions);
            let changed = false;
            for (const condition of conditions) {
                if (row.couponConfigId == null || condition.code !== 'minimum_order_amount') continue;
                condition.code = 'store_currency_minimum_order_amount';
                addOperationArgument(condition, 'currencyCode', row.currencyCode);
                changed = true;
            }
            for (const action of actions) {
                if (row.couponConfigId != null && action.code === 'order_fixed_discount') {
                    action.code = 'store_currency_order_fixed_discount';
                    addOperationArgument(action, 'currencyCode', row.currencyCode);
                    changed = true;
                }
                if (action.code === 'store_flash_sale_price') {
                    const argument = action.args.find(candidate => candidate.name === 'variantRules');
                    if (!argument) continue;
                    try {
                        const rules = JSON.parse(argument.value) as Array<Record<string, unknown>>;
                        if (!Array.isArray(rules)) continue;
                        for (const rule of rules) {
                            if (rule.salePrice != null && !rule.currencyCode)
                                rule.currencyCode = row.currencyCode;
                        }
                        argument.value = JSON.stringify(rules);
                        changed = true;
                    } catch {
                        // Keep malformed legacy rules untouched so application validation can report them.
                    }
                }
            }
            if (changed) {
                await this.updateJsonFields(queryRunner, 'promotion', row.id, {
                    conditions: JSON.stringify(conditions),
                    actions: JSON.stringify(actions),
                });
            }
        }
    }

    private async backfillShippingCurrencies(queryRunner: QueryRunner): Promise<void> {
        if (
            !(await queryRunner.hasTable('shipping_method')) ||
            !(await queryRunner.hasTable('shipping_method_channels_channel'))
        ) {
            return;
        }
        const escape = (identifier: string) => queryRunner.connection.driver.escape(identifier);
        const shippingQuery = [
            `SELECT sm.${escape('id')} AS id, sm.${escape('calculator')} AS calculator,`,
            `c.${escape('defaultCurrencyCode')} AS currencyCode FROM ${escape('shipping_method')} sm`,
            `JOIN ${escape('shipping_method_channels_channel')} sc`,
            `ON sc.${escape('shippingMethodId')} = sm.${escape('id')}`,
            `JOIN ${escape('channel')} c ON c.${escape('id')} = sc.${escape('channelId')}`,
        ].join(' ');
        const rows = (await queryRunner.query(shippingQuery)) as Array<{
            id: string | number;
            calculator: unknown;
            currencyCode: string;
        }>;
        for (const row of rows) {
            const calculator = jsonOperation(row.calculator);
            if (!calculator || calculator.code !== 'physical-subtotal-shipping-calculator') continue;
            if (!addOperationArgument(calculator, 'currencyCode', row.currencyCode)) continue;
            await this.updateJsonFields(queryRunner, 'shipping_method', row.id, {
                calculator: JSON.stringify(calculator),
            });
        }
    }

    private async updateJsonFields(
        queryRunner: QueryRunner,
        tableName: string,
        id: string | number,
        fields: Record<string, string>,
    ): Promise<void> {
        const driver = queryRunner.connection.driver;
        const escape = (identifier: string) => driver.escape(identifier);
        const entries = Object.entries(fields);
        const assignments = entries.map(
            ([name], index) => `${escape(name)} = ${driver.createParameter(name, index)}`,
        );
        const idParameter = driver.createParameter('id', entries.length);
        await queryRunner.query(
            `UPDATE ${escape(tableName)} SET ${assignments.join(', ')} WHERE ${escape('id')} = ${idParameter}`,
            [...entries.map(([, value]) => value), id],
        );
    }
}

interface StoredOperation {
    code: string;
    args: Array<{ name: string; value: string }>;
}

function jsonOperations(value: unknown): StoredOperation[] {
    const parsed = typeof value === 'string' ? safelyParse(value) : value;
    return Array.isArray(parsed) ? (parsed as StoredOperation[]) : [];
}

function jsonOperation(value: unknown): StoredOperation | null {
    const parsed = typeof value === 'string' ? safelyParse(value) : value;
    return parsed && typeof parsed === 'object' ? (parsed as StoredOperation) : null;
}

function safelyParse(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function addOperationArgument(operation: StoredOperation, name: string, value: string): boolean {
    operation.args ??= [];
    if (operation.args.some(argument => argument.name === name)) return false;
    operation.args.push({ name, value });
    return true;
}
