import { PageSkeleton } from './route-loading';

/** Read-only Admin design scenarios load only when the iframe asks for one. */
export function PreviewScenarioPanel({ scenario, isZh }: { scenario: string; isZh: boolean }) {
    if (scenario === 'loading') return <PageSkeleton variant="account" language={isZh ? 'zh' : 'en'} root />;
    const content =
        scenario === 'empty'
            ? {
                  title: isZh ? '暂无数据' : 'No data yet',
                  body: isZh ? '当前页面暂无可展示内容。' : 'There is nothing to display on this page.',
              }
            : scenario === 'error'
              ? {
                    title: isZh ? '加载失败' : 'Unable to load',
                    body: isZh ? '请检查网络后重试。' : 'Check your connection and try again.',
                }
              : scenario === 'disabled'
                ? {
                      title: isZh ? '功能暂不可用' : 'Feature unavailable',
                      body: isZh ? '当前操作条件尚未满足。' : 'The requirements for this action are not met.',
                  }
                : {
                      title: isZh ? '确认操作' : 'Confirm action',
                      body: isZh
                          ? '这是用于验收弹窗状态的只读预览。'
                          : 'This read-only preview verifies the dialog state.',
                  };
    return (
        <div
            className={`storefront-preview-scenario is-${scenario}`}
            role={scenario === 'dialog' ? 'dialog' : 'status'}
        >
            <div className="storefront-preview-state-card">
                <strong>{content.title}</strong>
                <p>{content.body}</p>
                <button type="button" disabled={scenario === 'disabled'}>
                    {scenario === 'error' ? (isZh ? '重试' : 'Try again') : isZh ? '知道了' : 'Got it'}
                </button>
            </div>
        </div>
    );
}
