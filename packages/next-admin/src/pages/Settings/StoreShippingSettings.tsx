import { useMemo, useState } from 'react';
import { AdminButton } from '../../components/AdminControls';
import { addCustomFieldsToDocument } from '../../custom-fields/custom-field-utils';
import { useCustomFieldDefinitions } from '../../custom-fields/custom-fields-context';
import type { StoreManagementResult } from '../../graphql/management.graphql';
import { useAdminQuery } from '../../hooks/use-admin-query';
import { toUserFacingError } from '../../utils/user-facing-error';
import { PaymentShippingManager } from './PaymentShippingManager';
import { ErrorState, Message, SettingsContentSkeleton } from './settings-ui';
import { STORE_SHIPPING_SETTINGS_QUERY } from './shipping-manager-utils';

/** Store shipping has its own reads and writes; tax, legal and payment settings are not loaded or submitted. */
export function StoreShippingSettings() {
    const fields = useCustomFieldDefinitions('ShippingMethod');
    const document = useMemo(
        () => addCustomFieldsToDocument(STORE_SHIPPING_SETTINGS_QUERY, 'ShippingMethod', fields),
        [fields],
    );
    const query = useAdminQuery<StoreManagementResult>(document, {
        variables: { shippingMethodOptions: { take: 100 } },
    });
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');
    const [dismissedReadError, setDismissedReadError] = useState<unknown>();
    if (!query.data)
        return query.error ? (
            <ErrorState
                message={toUserFacingError(query.error, '本店配送设置读取失败')}
                onRetry={() => void query.refetch()}
            />
        ) : (
            <SettingsContentSkeleton label="正在读取本店配送设置" sections={1} />
        );
    return (
        <div className="space-y-4">
            {notice && (
                <Message kind="success" onClose={() => setNotice('')}>
                    {notice}
                </Message>
            )}
            {error && (
                <Message kind="error" onClose={() => setError('')}>
                    {error}
                </Message>
            )}
            {query.error && query.error !== dismissedReadError && (
                <Message kind="error" onClose={() => setDismissedReadError(query.error)}>
                    读取最新配送列表失败，已保留当前内容。
                    <AdminButton type="button" onClick={() => void query.refetch()}>
                        重试读取
                    </AdminButton>
                </Message>
            )}
            <PaymentShippingManager
                section="shipping"
                data={query.data}
                paymentMethodCustomFields={[]}
                shippingMethodCustomFields={fields}
                onError={setError}
                onChanged={async message => {
                    setNotice(message);
                    setError('');
                    await query.refetch();
                }}
            />
        </div>
    );
}
