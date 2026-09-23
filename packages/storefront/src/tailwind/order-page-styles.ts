/* eslint-disable max-len -- Tailwind utility maps are atomic strings consumed by the extractor. */
/**
 * Tailwind utility maps for the remaining large commerce pages.
 *
 * Semantic keys stay in the DOM as stable state/descendant hooks; their visual rules are
 * emitted as Tailwind arbitrary utilities so page-specific declarations can leave styles.css.
 */
type PageStyleMap = Readonly<Record<string, string>>;

export function pageClassName(styles: PageStyleMap, className?: string | false | null): string | undefined {
    if (!className) return undefined;
    return className
        .split(/\s+/)
        .filter(Boolean)
        .flatMap(token => [token, styles[token] ?? ''])
        .filter(Boolean)
        .join(' ');
}

export const orderPageStyles: PageStyleMap = {
    'order-btn':
        '[min-height:44px] [padding:0_12px] [border-radius:var(--skin-control-radius)] [font-size:12.5px] [font-weight:600] [display:inline-flex] [align-items:center] [justify-content:center] [cursor:pointer] [transition:background-color_160ms_ease,color_160ms_ease] [white-space:nowrap] [&.secondary-btn]:[border:0] [&.secondary-btn]:[background:var(--control-surface)] [&.secondary-btn]:[color:var(--text)] [&.secondary-btn:hover]:[background:var(--soft)] [&.secondary-btn:hover]:[border-color:var(--muted)] [&.primary-btn]:[border:1px_solid_transparent] [&.primary-btn]:[background:var(--accent)] [&.primary-btn]:[color:var(--accent-foreground)] [&.primary-btn]:[font-weight:var(--font-weight-semibold)]  [&.primary-btn:hover]:[background:var(--accent-hover)]',
    'order-cancel-actions':
        '[&_.danger-action]:[border-color:rgba(192,_57,_43,_0.34)] [&_.danger-action]:[color:#a93226] [margin-top:16px] [display:grid] [grid-template-columns:repeat(2,_minmax(0,_1fr))] [gap:10px] [&_button]:[min-height:46px] [&_button]:[padding:0_14px] [&_button]:[border:1px_solid_var(--line)] [&_button]:[border-radius:7px] [&_button]:[background:white] [&_button]:[font-weight:var(--font-weight-semibold)]',
    'order-cancel-sheet':
        '[&>form]:[padding:18px_14px_calc(18px_+_var(--safe-bottom))] [&_p]:[margin:0_0_16px] [&_p]:[color:var(--muted)] [&_p]:[line-height:1.6] [&_label]:[display:block] [&_label>span]:[display:block] [&_label>span]:[margin-bottom:7px] [&_label>span]:[font-weight:var(--font-weight-medium)] [&_textarea]:[width:100%] [&_textarea]:[min-height:108px] [&_textarea]:[padding:11px_12px] [&_textarea]:[resize:vertical] [&_textarea]:[border:1px_solid_var(--line)] [&_textarea]:[border-radius:7px] [&_textarea]:[background:white] [&_textarea]:[color:var(--text)] [&_textarea]:[font:inherit] [&_form>small]:[margin-top:5px] [&_form>small]:[color:var(--muted)] [&_form>small]:[display:block] [&_form>small]:[text-align:right]',
    'order-card':
        '[background:var(--surface)] [border-radius:var(--skin-card-radius)] [padding:14px_14px_12px] [box-shadow:var(--skin-card-shadow)] [border:0] [display:flex] [flex-direction:column] [gap:2px]',
    'order-card-buttons':
        '[display:flex] [align-items:center] [justify-content:flex-end] [gap:8px] [flex-shrink:0]',
    'order-card-footer':
        '[display:flex] [flex-wrap:wrap] [align-items:center] [justify-content:space-between] [gap:8px] [padding-top:10px] [border-top:1px_solid_var(--skin-divider)]',
    'order-card-header':
        '[min-height:28px] [display:flex] [align-items:center] [justify-content:space-between] [gap:8px] [padding-bottom:10px] [border-bottom:1px_solid_var(--skin-divider)]',
    'order-card-product':
        '[width:100%] [min-height:100px] [padding:12px_0] [border:0] [background:transparent] [display:grid] [grid-template-columns:76px_minmax(0,_1fr)] [align-items:start] [gap:12px] [text-align:left] [cursor:pointer] [transition:opacity_160ms_ease] [&:hover]:[opacity:0.9] [&:active]:[opacity:0.72] [&:focus-visible]:[outline:2px_solid_color-mix(in_srgb,_var(--accent)_45%,_white)] [&:focus-visible]:[outline-offset:3px] [&>img]:[width:76px] [&>img]:[height:76px] [&>img]:[border-radius:var(--skin-media-radius)] [&>img]:[background:var(--product-media-bg)] [&>img]:[object-fit:contain] [&>img]:[border:0] [&>.responsive-picture]:[width:76px] [&>.responsive-picture]:[height:76px] [&>.responsive-picture]:[border-radius:var(--skin-media-radius)] [&>.responsive-picture]:[overflow:hidden] [&>.responsive-picture>img]:[width:76px] [&>.responsive-picture>img]:[height:76px] [&>.responsive-picture>img]:[border-radius:var(--skin-media-radius)] [&>.responsive-picture>img]:[background:var(--product-media-bg)] [&>.responsive-picture>img]:[object-fit:contain] [&>.responsive-picture>img]:[border:0] [&>.image-placeholder]:[width:76px] [&>.image-placeholder]:[height:76px] [&>.image-placeholder]:[border-radius:var(--skin-media-radius)] [&>.image-placeholder]:[background:var(--product-media-bg)] [&>.image-placeholder]:[object-fit:contain] [&>.image-placeholder]:[border:0]',
    'order-card-store-btn':
        '[min-width:0] [min-height:28px] [padding:0] [border:0] [background:transparent] [display:inline-flex] [align-items:center] [gap:6px] [cursor:pointer] [&_strong]:[font-size:15px] [&_strong]:[font-weight:var(--font-weight-bold)] [&_strong]:[color:var(--text)] [&_strong]:[overflow:hidden] [&_strong]:[white-space:nowrap] [&_strong]:[text-overflow:ellipsis] [&_svg:last-child]:[width:15px] [&_svg:last-child]:[height:15px] [&_svg:last-child]:[color:var(--muted)]',
    'order-card-store-icon': '[width:17px] [height:17px] [color:var(--accent)] [flex-shrink:0]',
    'order-detail-actions':
        'page-action-bar [width:min(100%,_var(--app-width))] [min-height:calc(var(--order-detail-action-bar-height)_+_var(--safe-bottom))] [padding:9px_10px_calc(9px_+_var(--safe-bottom))] [position:fixed] [z-index:22] [right:0] [bottom:0] [left:50%] [border-top:1px_solid_var(--line)] [background:rgba(255,_255,_255,_0.98)] [display:flex] [align-items:center] [justify-content:flex-end] [gap:6px] [transform:translateX(-50%)] [&_button]:[min-width:0] [&_button]:[height:48px] [&_button]:[padding:0_7px] [&_button]:[border:1px_solid_var(--line)] [&_button]:[border-radius:9px] [&_button]:[background:var(--surface)] [&_button]:[display:inline-flex] [&_button]:[align-items:center] [&_button]:[justify-content:center] [&_button]:[gap:4px] [&_button]:[font-size:13px] [&_button]:[font-weight:600] [&_button]:[white-space:nowrap] [&_button_svg]:[width:16px] [&_button_svg]:[height:16px] [&_button_svg]:[flex:none] [&_.order-secondary-action]:[flex:1_1_0] [&_.order-secondary-action]:[color:var(--text)] [&_.primary-action]:[flex:1.18_1_0] [&_.primary-action]:[border-color:var(--accent)] [&_.primary-action]:[background:var(--accent)] [&_.primary-action]:[color:white] [&_.danger-action]:[flex:1_1_0] [&_.danger-action]:[border-color:rgba(192,_57,_43,_0.34)] [&_.danger-action]:[color:#a93226] max-[370px]:[gap:4px] max-[370px]:[&_button]:[padding:0_4px] max-[370px]:[&_button]:[font-size:12px] lg:[right:auto] lg:[bottom:24px] lg:[left:50%] lg:[border:1px_solid_var(--line)] lg:[border-radius:10px] lg:[box-shadow:0_16px_45px_rgba(31,_43,_38,_0.12)] lg:[transform:translateX(-50%)]',
    'order-secondary-action': '',
    'order-detail-products':
        '[margin-top:9px] [padding:0_14px] [background:var(--surface)] [&>header]:[min-height:46px] [&>header]:[border-bottom:1px_solid_var(--line)] [&>header]:[display:flex] [&>header]:[align-items:center] [&>header]:[justify-content:space-between] [&>header_strong]:[font-weight:var(--font-weight-semibold)] [&>header_span]:[color:var(--muted)] [&_article]:[min-height:92px] [&_article]:[padding:10px_0] [&_article]:[border-bottom:1px_solid_var(--line)] [&_article]:[display:grid] [&_article]:[grid-template-columns:72px_minmax(0,_1fr)_auto] [&_article]:[align-items:start] [&_article]:[gap:9px] [&_article:last-child]:[border-bottom:0] [&_article>img]:[width:72px] [&_article>img]:[height:72px] [&_article>img]:[border-radius:7px] [&_article>img]:[background:var(--product-media-bg)] [&_article>img]:[object-fit:contain] [&_article>.responsive-picture>img]:[width:72px] [&_article>.responsive-picture>img]:[height:72px] [&_article>.responsive-picture]:[border-radius:7px] [&_article>.responsive-picture>img]:[border-radius:7px] [&_article>.responsive-picture>img]:[background:var(--product-media-bg)] [&_article>.responsive-picture>img]:[object-fit:contain] [&_article>.image-placeholder]:[width:72px] [&_article>.image-placeholder]:[height:72px] [&_article>.image-placeholder]:[border-radius:7px] [&_article>.image-placeholder]:[background:var(--product-media-bg)] [&_article>.image-placeholder]:[object-fit:contain] [&_article>div_strong]:[display:block] [&_article>div_small]:[display:block] [&_article>div_em]:[display:block] [&_article>span_b]:[display:block] [&_article>span_small]:[display:block] [&_article>div_strong]:[overflow:hidden] [&_article>div_strong]:[font-weight:600] [&_article>div_strong]:[white-space:nowrap] [&_article>div_strong]:[text-overflow:ellipsis] [&_article_small]:[margin-top:4px] [&_article_small]:[color:var(--muted)] [&_article_em]:[margin-top:6px] [&_article_em]:[color:var(--success)] [&_article_em]:[font-size:13px] [&_article_em]:[font-style:normal] [&_article>span]:[text-align:right] lg:[width:100%] lg:[max-width:none] lg:[margin-right:auto] lg:[margin-left:auto] lg:[margin-top:20px] lg:[border:1px_solid_var(--line)] lg:[border-radius:var(--skin-card-radius)]',
    'order-detail-layout': '[display:contents]',
    'order-detail-record': '[display:contents]',
    'order-detail-summary':
        '[margin-top:9px] [padding:0_14px] [background:var(--surface)] [padding:11px_14px] lg:[width:100%] lg:[max-width:none] lg:[margin-right:auto] lg:[margin-left:auto] lg:[margin-top:20px] lg:[border:1px_solid_var(--line)] lg:[border-radius:var(--skin-card-radius)]',
    'order-information':
        '[margin-top:9px] [padding:0_14px] [background:var(--surface)] [padding:7px_14px] [&>div]:[min-height:40px] [&>div]:[display:flex] [&>div]:[align-items:center] [&>div]:[justify-content:space-between] [&>div]:[gap:12px] [&_span]:[color:var(--muted)] [&_b]:[overflow:hidden] [&_b]:[font-weight:500] [&_b]:[white-space:nowrap] [&_b]:[text-overflow:ellipsis] lg:[width:100%] lg:[max-width:none] lg:[margin-right:auto] lg:[margin-left:auto] lg:[margin-top:20px] lg:[border:1px_solid_var(--line)] lg:[border-radius:var(--skin-card-radius)]',
    'order-list':
        '[padding:12px_12px_32px] [display:flex] [flex-direction:column] [gap:12px] lg:[width:100%] lg:[max-width:none] lg:[margin-right:auto] lg:[margin-left:auto] lg:[padding-top:24px] lg:[display:grid] lg:[grid-template-columns:repeat(2,_minmax(0,_1fr))] lg:[gap:20px]',
    'order-load-more': '[width:100%] [margin-top:4px]',
    'order-logistics':
        '[min-height:68px] [margin-top:9px] [padding:10px_14px] [background:var(--surface)] [display:grid] [grid-template-columns:28px_minmax(0,_1fr)] [align-items:center] [gap:9px] [&>svg:first-child]:[color:var(--success)] [&_strong]:[display:block] [&_small]:[display:block] [&_small]:[margin-top:4px] [&_small]:[color:var(--muted)] lg:[width:100%] lg:[max-width:none] lg:[margin-right:auto] lg:[margin-left:auto] lg:[margin-top:20px] lg:[border:1px_solid_var(--line)] lg:[border-radius:var(--skin-card-radius)]',
    'order-logistics-content': '[min-width:0]',
    'order-logistics-heading':
        '[display:flex] [flex-wrap:wrap] [align-items:center] [justify-content:space-between] [gap:8px] [margin-bottom:4px]',
    'order-logistics-item':
        '[margin-top:9px] [padding-top:9px] [border-top:1px_solid_var(--line)] [display:grid] [grid-template-columns:minmax(0,_1fr)_auto] [gap:3px_10px] [&_span]:[min-width:0] [&_span]:[overflow-wrap:anywhere] [&_b]:[min-width:0] [&_b]:[overflow-wrap:anywhere] [&_em]:[min-width:0] [&_em]:[overflow-wrap:anywhere] [&_span]:[font-style:normal] [&_span]:[font-weight:600] [&_b]:[font-style:normal] [&_b]:[font-weight:600] [&_small]:[margin:0] [&_small]:[text-align:right] [&_b]:[grid-column:1_/_-1] [&_em]:[grid-column:1_/_-1] [&_em]:[color:var(--muted)] [&_em]:[font-size:13px] [&_em]:[font-style:normal]',
    'order-product-bottom':
        '[min-width:0] [display:flex] [align-items:flex-end] [justify-content:space-between] [gap:8px]',
    'order-product-content':
        '[height:76px] [min-width:0] [display:flex] [flex-direction:column] [justify-content:space-between] [gap:3px]',
    'order-product-heading':
        '[min-width:0] [display:grid] [grid-template-columns:minmax(0,_1fr)_auto] [align-items:baseline] [gap:8px]',
    'order-product-price':
        '[font-size:14px] [font-weight:var(--font-weight-bold)] [color:var(--text)] [white-space:nowrap]',
    'order-product-qty':
        '[font-size:11px] [line-height:18px] [color:var(--muted)] [font-variant-numeric:tabular-nums] [flex-shrink:0]',
    'order-product-spec':
        '[min-width:0] [font-size:11.5px] [line-height:1.35] [color:var(--muted)] [overflow:hidden] [white-space:nowrap] [text-overflow:ellipsis]',
    'order-product-tag':
        '[font-size:11px] [line-height:1.35] [font-weight:500] [color:var(--accent-ink)] [white-space:nowrap] [&.is-service]:[color:var(--success)]',
    'order-product-tags': '[min-width:0] [display:flex] [align-items:center] [gap:6px] [overflow:hidden]',
    'order-product-title':
        '[min-width:0] [font-size:14px] [font-weight:var(--font-weight-semibold)] [color:var(--text)] [line-height:1.35] [overflow:hidden] [white-space:nowrap] [text-overflow:ellipsis]',
    'order-state-badge':
        '[font-size:12px] [font-weight:600] [line-height:1.35] [padding:2.5px_8px] [border-radius:6px] [background:#f1f5f9] [color:#475569] [border:1px_solid_#e2e8f0] [.order-card.is-pending_&]:[background:#fffbeb] [.order-card.is-pending_&]:[color:#b45309] [.order-card.is-pending_&]:[border-color:#fde68a] [.order-card.is-shipping_&]:[background:#eff6ff] [.order-card.is-shipping_&]:[color:#1d4ed8] [.order-card.is-shipping_&]:[border-color:#bfdbfe] [.order-card.is-shipped_&]:[background:#eef2ff] [.order-card.is-shipped_&]:[color:#4338ca] [.order-card.is-shipped_&]:[border-color:#c7d2fe] [.order-card.is-delivered_&]:[background:#ecfdf5] [.order-card.is-delivered_&]:[color:#047857] [.order-card.is-delivered_&]:[border-color:#a7f3d0] [.order-card.is-cancelled_&]:[background:#f8fafc] [.order-card.is-cancelled_&]:[color:#64748b] [.order-card.is-cancelled_&]:[border-color:#e2e8f0]',
    'order-status':
        '[padding:22px_14px_19px] [background:var(--surface)] [color:var(--text)] [&_strong]:[display:block] [&_span]:[display:block] [&_small]:[display:block] [&_strong]:[font-size:20px] [&_strong]:[font-weight:var(--font-weight-semibold)] [&_span]:[margin-top:5px] [&_small]:[margin-top:8px] [&_small]:[color:var(--muted)] lg:[width:100%] lg:[max-width:none] lg:[margin-right:auto] lg:[margin-left:auto] lg:[margin-top:24px] lg:[border-radius:var(--skin-card-radius)]',
    'order-total-amount': '[font-size:15px] [font-weight:800] [color:var(--text)]',
    'order-total-count': '[color:var(--muted)] [font-size:12px]',
    'order-total-label': '[color:var(--text)] [font-size:12px] [font-weight:500]',
    'order-total-summary':
        '[&_b]:[font-family:var(--font-numeric)] [&_b]:[font-variant-numeric:tabular-nums] [&_b]:[letter-spacing:-0.02em] [display:flex] [align-items:baseline] [gap:4px] [font-size:12px] [color:var(--muted)] [min-width:0] [flex-wrap:wrap]',
    'orders-page':
        '[--page-surface:var(--paper)] lg:[&>.empty-state]:[width:100%] lg:[&>.empty-state]:[max-width:none] lg:[&>.empty-state]:[margin:24px_auto_0]',
};
