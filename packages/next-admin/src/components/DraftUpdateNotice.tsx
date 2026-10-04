import { AdminButton } from './AdminControls';

export function DraftUpdateNotice({ onReload }: { onReload: () => void }) {
    return (
        <div className="admin-page-status" data-failed role="status">
            <span>服务端数据已有更新，当前未保存草稿已保留。重新读取后再保存。</span>
            <AdminButton
                type="button"
                className="ml-auto shrink-0 text-blue-600"
                onClick={() => {
                    if (window.confirm('重新读取会放弃当前未保存的修改，确定继续吗？')) onReload();
                }}
            >
                放弃草稿并重新读取
            </AdminButton>
        </div>
    );
}
