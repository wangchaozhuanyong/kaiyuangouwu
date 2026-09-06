import type { StorefrontVisualPresetId } from '../../../../storefront-content-plugin/src/visual-presets';
import baseStyles from '../../../../storefront/src/styles.css?inline';
import desktopStyles from '../../../../storefront/src/styles/desktop-layout.css?inline';
import presetStyles from '../../../../storefront/src/styles/visual-presets.css?inline';

function escapeHtml(value: string): string {
    return value.replace(
        /[&<>"']/g,
        character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
    );
}

/** Uses the client's actual styles in an isolated, script-free sample document. */
export function storefrontVisualPreviewDocument(
    presetId: StorefrontVisualPresetId,
    storeName: string,
): string {
    return `<!doctype html><html lang="zh-CN" data-storefront-preset="${presetId}"><head>
        <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
        <style>${baseStyles}\n${desktopStyles}\n${presetStyles}</style>
        <style>
            body{padding:24px;min-height:100vh}.preview-shell{max-width:1060px;margin:auto;display:grid;gap:24px}
            .preview-brand{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding-bottom:16px}
            .preview-brand b{font-size:20px}.preview-brand small{color:var(--muted)}
            .preview-hero{padding:36px 28px;background:#203346;border-radius:var(--radius-md);color:#fffdf8}
            .preview-hero .hero-rich-title{color:#fffdf8;margin:12px 0;font-size:clamp(28px,4vw,42px)}
            .preview-hero p{line-height:1.8;color:#ede5d6;max-width:34em}
            .preview-hero button{margin-top:18px;padding:12px 20px;border:0}
            .preview-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
            .preview-card{padding:20px;border:1px solid var(--line);background:var(--paper);border-radius:var(--radius-md)}
            .preview-card h2{font-size:18px;margin:0 0 16px}.preview-card p{font-size:14px;color:var(--muted)}
            .preview-card input{width:100%;padding:12px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--paper);margin-bottom:12px}
            .preview-card .primary-btn{background:var(--accent);color:white;border:0;padding:12px 18px;border-radius:var(--radius-sm)}
            .preview-line{display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--line);font-size:14px}
            .preview-note{font-size:12px;line-height:1.6;color:var(--muted)}
            @media(max-width:600px){body{padding:16px}.preview-grid{grid-template-columns:1fr}.preview-hero{padding:28px 22px}}
        </style></head><body><main class="preview-shell">
        <header class="preview-brand"><b>${escapeHtml(storeName)}</b><small>皮肤示例</small></header>
        <section class="hero preview-hero"><span>日常好物 · 用心甄选</span><h1 class="hero-rich-title">让每一天，更有品质</h1><p>以清晰的内容和舒适的阅读体验，呈现你的店铺。</p><button class="hero-rich-cta-btn" type="button">浏览好物</button></section>
        <header class="section-header"><h2>从浏览到结算，风格一致</h2></header>
        <div class="preview-grid">
            <section class="preview-card auth-card"><h2>欢迎回来</h2><input aria-label="邮箱" placeholder="请输入邮箱" readonly><input aria-label="密码" placeholder="请输入密码" readonly><button type="button" class="primary-btn">登录账户</button><p>商品名称、价格与表单保持常规字体。</p></section>
            <section class="preview-card checkout-card"><h2>确认订单</h2><div class="preview-line"><span>商品金额</span><b>以订单为准</b></div><div class="preview-line"><span>配送方式</span><span>商家配送</span></div><p>按钮、边框和选中状态使用同一套配色。</p><button type="button" class="primary-btn">确认订单</button></section>
        </div><p class="preview-note">此处为组件效果示例，使用客户端同一套样式。实际商品、轮播图片和页面布局继续由店铺装修内容决定。</p>
        </main></body></html>`;
}
