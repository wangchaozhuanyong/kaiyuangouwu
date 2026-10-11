import { Upload } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { AdminButton } from '../../../components/AdminControls';
import { PageSkeleton } from '../../../components/AdminPageWorkspace';
import { CatalogImportDialogFrame } from './CatalogImportDialogFrame';

import { useAdminPermissions } from '../../../hooks/use-admin-permissions';

const CatalogImportDialog = lazy(() =>
    import('./CatalogImportDialog').then(module => ({ default: module.CatalogImportDialog })),
);

export function CatalogImportAction() {
    const [open, setOpen] = useState(false);
    const { permissions } = useAdminPermissions();
    const isSuperAdmin = permissions.includes('SuperAdmin');
    const canRead = isSuperAdmin || permissions.includes('ReadCatalogImport');
    const canCreate = isSuperAdmin || permissions.includes('CreateCatalogImport');

    if (!canRead || !canCreate) return null;
    return (
        <>
            <AdminButton
                type="button"
                onClick={() => setOpen(true)}
                className="flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-3.5 py-2 text-xs font-bold text-blue-700 shadow-sm transition-colors hover:bg-blue-50 focus:outline-none focus:ring-4 focus:ring-blue-100"
            >
                <Upload className="h-4 w-4" />
                批量导入
            </AdminButton>
            {open && (
                <Suspense
                    fallback={
                        <CatalogImportDialogFrame onClose={() => setOpen(false)}>
                            <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
                                <PageSkeleton label="正在加载商品导入工作区" />
                            </main>
                        </CatalogImportDialogFrame>
                    }
                >
                    <CatalogImportDialog open={open} onClose={() => setOpen(false)} />
                </Suspense>
            )}
        </>
    );
}
