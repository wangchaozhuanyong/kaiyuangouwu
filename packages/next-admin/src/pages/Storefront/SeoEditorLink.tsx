import { useNavigate } from 'react-router-dom';
import { AdminButton } from '../../components/AdminControls';
import { useAdminCapabilities } from '../../hooks/use-admin-capabilities';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { requestAppNavigation } from '../../hooks/use-unsaved-changes-warning';

/** The shared editor retains native entity permissions and the active Channel. */
export function SeoEditorLink({
    targetType,
    targetId,
    name,
}: {
    targetType: 'PRODUCT' | 'COLLECTION';
    targetId: string;
    name?: string;
}) {
    const navigate = useNavigate();
    const { canUseCapability } = useAdminCapabilities();
    const { hasAnyPermission } = useAdminPermissions();
    const capability = targetType === 'PRODUCT' ? '/catalog/products/seo' : '/catalog/collections/seo';
    if (
        !targetId ||
        !canUseCapability(capability) ||
        !hasAnyPermission(
            targetType === 'PRODUCT' ? ['ReadProduct', 'ReadCatalog'] : ['ReadCollection', 'ReadCatalog'],
        )
    )
        return null;
    const target = `/catalog/${targetType === 'PRODUCT' ? 'products' : 'collections'}/${encodeURIComponent(targetId)}/seo?languageCode=zh_Hans`;
    return (
        <AdminButton
            type="button"
            className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium disabled:opacity-50 shrink-0 text-slate-600"
            aria-label={`搜索优化${name ? `：${name}` : ''}`}
            onClick={() => {
                if (requestAppNavigation(target)) navigate(target);
            }}
        >
            搜索优化
        </AdminButton>
    );
}
