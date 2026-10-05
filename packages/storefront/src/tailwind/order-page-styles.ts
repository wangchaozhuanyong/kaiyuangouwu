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
        '[min-height:44px] [padding:0_12px] [border-radius:var(--skin-control-radius)] type-meta weight-semibold [display:inline-flex] [align-items:center] [justify-content:center] [cursor:pointer] [transition:background-color_160ms_ease,color_160ms_ease] [white-space:nowrap]',
    'order-cancel-actions':
        '[&_.danger-action]:[border-color:var(--danger)] [&_.danger-action]:[color:var(--danger)] [margin-top:16px] [display:grid] [grid-template-columns:repeat(2,_minmax(0,_1fr))] [gap:10px] [&_button]:[min-height:46px] [&_button]:[padding:0_14px] [&_button]:[border:1px_solid_var(--line)] [&_button]:[border-radius:var(--skin-control-radius)] [&_button]:[background:var(--surface)] [&_button]:[color:var(--text)] [&_button]:[font-size:var(--type-label-size)] [&_button]:weight-semibold',
    'order-cancel-sheet':
        '[&>form]:[padding:18px_14px_calc(18px_+_var(--safe-bottom))] [&_p]:[margin:0_0_16px] [&_p]:[color:var(--muted)] [&_p]:[line-height:var(--line-height-relaxed)] [&_label]:[display:block] [&_label>span]:[display:block] [&_label>span]:[margin-bottom:7px] [&_label>span]:weight-medium [&_textarea]:[width:100%] [&_textarea]:[min-height:108px] [&_textarea]:[padding:11px_12px] [&_textarea]:[resize:vertical] [&_textarea]:[border:1px_solid_var(--line)] [&_textarea]:[border-radius:var(--skin-control-radius)] [&_textarea]:[background:var(--surface)] [&_textarea]:[color:var(--text)] [&_textarea]:[font:inherit] [&_form>small]:[margin-top:5px] [&_form>small]:[color:var(--muted)] [&_form>small]:[display:block] [&_form>small]:[text-align:right]',
    'order-card':
        '[background:var(--surface)] [border-radius:var(--skin-card-radius)] [padding:14px_14px_12px] [box-shadow:var(--skin-card-shadow)] [border:var(--skin-card-outline,0)] [display:flex] [flex-direction:column] [gap:2px]',
    'order-card-buttons':
        '[display:flex] [align-items:center] [justify-content:flex-end] [gap:8px] [flex-shrink:0]',
    'order-card-footer':
        '[display:grid] [grid-template-columns:minmax(0,_1fr)_auto] [align-items:center] [gap:8px] [padding-top:10px] [border-top:0]',
    'order-card-header':
        '[min-height:28px] [display:flex] [align-items:center] [justify-content:space-between] [gap:8px] [padding-bottom:10px] [border-bottom:0]',
    'order-card-product':
        '[width:100%] [min-height:100px] [padding:12px_0] [border:0] [background:transparent] [display:grid] [grid-template-columns:76px_minmax(0,_1fr)] [align-items:start] [gap:12px] [text-align:left] [cursor:pointer] [transition:opacity_160ms_ease] [&:hover]:[opacity:0.9] [&:active]:[opacity:0.72] [&:focus-visible]:[outline:2px_solid_color-mix(in_srgb,_var(--accent)_45%,_white)] [&:focus-visible]:[outline-offset:3px] [&>img]:[width:76px] [&>img]:[height:76px] [&>img]:[border-radius:var(--skin-media-radius)] [&>img]:[background:var(--product-media-bg)] [&>img]:[object-fit:contain] [&>img]:[border:0] [&>.responsive-picture]:[width:76px] [&>.responsive-picture]:[height:76px] [&>.responsive-picture]:[border-radius:var(--skin-media-radius)] [&>.responsive-picture]:[overflow:hidden] [&>.responsive-picture>img]:[width:76px] [&>.responsive-picture>img]:[height:76px] [&>.responsive-picture>img]:[border-radius:var(--skin-media-radius)] [&>.responsive-picture>img]:[background:var(--product-media-bg)] [&>.responsive-picture>img]:[object-fit:contain] [&>.responsive-picture>img]:[border:0] [&>.image-placeholder]:[width:76px] [&>.image-placeholder]:[height:76px] [&>.image-placeholder]:[border-radius:var(--skin-media-radius)] [&>.image-placeholder]:[background:var(--product-media-bg)] [&>.image-placeholder]:[object-fit:contain] [&>.image-placeholder]:[border:0]',
    'order-card-store-btn':
        '[min-width:0] [min-height:28px] [padding:0] [border:0] [background:transparent] [display:inline-flex] [align-items:center] [gap:6px] [cursor:pointer] [&_strong]:type-body [&_strong]:weight-bold [&_strong]:[color:var(--text)] [&_strong]:[overflow:hidden] [&_strong]:[white-space:nowrap] [&_strong]:[text-overflow:ellipsis] [&_svg:last-child]:[width:15px] [&_svg:last-child]:[height:15px] [&_svg:last-child]:[color:var(--muted)]',
    'order-card-store-icon': '[width:17px] [height:17px] [color:var(--accent)] [flex-shrink:0]',
    'order-detail-actions':
        'page-action-bar [width:min(100%,_var(--app-width))] [min-height:calc(var(--order-detail-action-bar-height)_+_var(--safe-bottom))] [padding:9px_10px_calc(9px_+_var(--safe-bottom))] [position:fixed] [z-index:22] [right:0] [bottom:0] [left:50%] [border-top:0] [background:var(--surface)] [display:flex] [align-items:center] [justify-content:flex-end] [gap:6px] [transform:translateX(-50%)] [&_button]:[min-width:0] [&_button]:[height:48px] [&_button]:[padding:0_7px] [&_button]:[border:1px_solid_var(--line)] [&_button]:[border-radius:var(--skin-control-radius)] [&_button]:[background:var(--surface)] [&_button]:[display:inline-flex] [&_button]:[align-items:center] [&_button]:[justify-content:center] [&_button]:[gap:4px] [&_button]:type-label [&_button]:weight-semibold [&_button]:[white-space:nowrap] [&_button_svg]:[width:16px] [&_button_svg]:[height:16px] [&_button_svg]:[flex:none] [&_.order-secondary-action]:[flex:1_1_0] [&_.order-secondary-action]:[color:var(--accent-ink)] [&_.primary-action]:[flex:1.18_1_0] [&_.primary-action]:[border-color:var(--accent)] [&_.primary-action]:[background:var(--accent)] [&_.primary-action]:[color:white] [&_.danger-action]:[flex:1_1_0] [&_.danger-action]:[border-color:var(--danger)] [&_.danger-action]:[color:var(--danger)] max-[370px]:[gap:4px] max-[370px]:[&_button]:[padding:0_4px] max-[370px]:[&_button]:type-label lg:[right:auto] lg:[bottom:24px] lg:[left:50%] lg:[border:1px_solid_var(--line)] lg:[border-radius:10px] lg:[box-shadow:0_16px_45px_rgba(31,_43,_38,_0.12)] lg:[transform:translateX(-50%)]',
    'order-secondary-action': '',
    'order-detail-products':
        '[margin-top:9px] [padding:0_14px] [background:var(--surface)] [&>header]:[min-height:46px] [&>header]:[border-bottom:0] [&>header]:[display:flex] [&>header]:[align-items:center] [&>header]:[justify-content:space-between] [&>header_strong]:weight-semibold [&>header_span]:[color:var(--muted)] [&_article]:[min-height:92px] [&_article]:[padding:10px_0] [&_article]:[border-bottom:0] [&_article]:[display:grid] [&_article]:[grid-template-columns:72px_minmax(0,_1fr)_auto] [&_article]:[align-items:start] [&_article]:[gap:9px] [&_article:last-child]:[border-bottom:0] [&_article>img]:[width:72px] [&_article>img]:[height:72px] [&_article>img]:[border-radius:7px] [&_article>img]:[background:var(--product-media-bg)] [&_article>img]:[object-fit:contain] [&_article>.responsive-picture>img]:[width:72px] [&_article>.responsive-picture>img]:[height:72px] [&_article>.responsive-picture]:[border-radius:7px] [&_article>.responsive-picture>img]:[border-radius:7px] [&_article>.responsive-picture>img]:[background:var(--product-media-bg)] [&_article>.responsive-picture>img]:[object-fit:contain] [&_article>.image-placeholder]:[width:72px] [&_article>.image-placeholder]:[height:72px] [&_article>.image-placeholder]:[border-radius:7px] [&_article>.image-placeholder]:[background:var(--product-media-bg)] [&_article>.image-placeholder]:[object-fit:contain] [&_article>div_strong]:[display:block] [&_article>div_small]:[display:block] [&_article>div_em]:[display:block] [&_article>span_b]:[display:block] [&_article>span_small]:[display:block] [&_article>div_strong]:[overflow:hidden] [&_article>div_strong]:weight-semibold [&_article>div_strong]:[white-space:nowrap] [&_article>div_strong]:[text-overflow:ellipsis] [&_article_small]:[margin-top:4px] [&_article_small]:[color:var(--muted)] [&_article_em]:[margin-top:6px] [&_article_em]:[color:var(--success)] [&_article_em]:type-helper [&_article_em]:[font-style:normal] [&_article>span]:[text-align:right] lg:[width:100%] lg:[max-width:none] lg:[margin-right:auto] lg:[margin-left:auto] lg:[margin-top:20px] lg:[border:var(--skin-card-outline,1px_solid_var(--line))] lg:[border-radius:var(--skin-card-radius)] [border:var(--skin-card-outline,0)]',
    'order-detail-layout': '[display:contents]',
    'order-detail-record': '[display:contents]',
    'order-detail-summary':
        '[margin-top:9px] [padding:0_14px] [background:var(--surface)] [padding:11px_14px] lg:[width:100%] lg:[max-width:none] lg:[margin-right:auto] lg:[margin-left:auto] lg:[margin-top:20px] lg:[border:var(--skin-card-outline,1px_solid_var(--line))] lg:[border-radius:var(--skin-card-radius)] [border:var(--skin-card-outline,0)]',
    'order-information':
        '[margin-top:9px] [padding:0_14px] [background:var(--surface)] [padding:7px_14px] [&>div]:[min-height:40px] [&>div]:[display:flex] [&>div]:[align-items:center] [&>div]:[justify-content:space-between] [&>div]:[gap:12px] [&_span]:[color:var(--muted)] [&_b]:[overflow:hidden] [&_b]:weight-medium [&_b]:[white-space:nowrap] [&_b]:[text-overflow:ellipsis] lg:[width:100%] lg:[max-width:none] lg:[margin-right:auto] lg:[margin-left:auto] lg:[margin-top:20px] lg:[border:var(--skin-card-outline,1px_solid_var(--line))] lg:[border-radius:var(--skin-card-radius)] [border:var(--skin-card-outline,0)]',
    'order-list':
        '[padding:12px_var(--page-section-inset,_var(--experience-page-gutter-mobile))_32px] [display:flex] [flex-direction:column] [gap:12px] lg:[width:100%] lg:[max-width:none] lg:[margin-right:auto] lg:[margin-left:auto] lg:[padding-top:24px] lg:[display:grid] lg:[grid-template-columns:repeat(2,_minmax(0,_1fr))] lg:[gap:20px]',
    'order-load-more': '[width:100%] [margin-top:4px]',
    'order-logistics':
        '[min-height:68px] [margin-top:9px] [padding:10px_14px] [background:var(--surface)] [display:grid] [grid-template-columns:28px_minmax(0,_1fr)] [align-items:center] [gap:9px] [&>svg:first-child]:[color:var(--success)] [&_strong]:[display:block] [&_small]:[display:block] [&_small]:[margin-top:4px] [&_small]:[color:var(--muted)] lg:[width:100%] lg:[max-width:none] lg:[margin-right:auto] lg:[margin-left:auto] lg:[margin-top:20px] lg:[border:var(--skin-card-outline,1px_solid_var(--line))] lg:[border-radius:var(--skin-card-radius)] [border:var(--skin-card-outline,0)]',
    'order-logistics-content': '[min-width:0]',
    'order-logistics-heading':
        '[display:flex] [flex-wrap:wrap] [align-items:center] [justify-content:space-between] [gap:8px] [margin-bottom:4px]',
    'order-logistics-item':
        '[margin-top:9px] [padding-top:9px] [border-top:0] [display:grid] [grid-template-columns:minmax(0,_1fr)_auto] [gap:3px_10px] [&_span]:[min-width:0] [&_span]:[overflow-wrap:anywhere] [&_b]:[min-width:0] [&_b]:[overflow-wrap:anywhere] [&_em]:[min-width:0] [&_em]:[overflow-wrap:anywhere] [&_span]:[font-style:normal] [&_span]:weight-semibold [&_b]:[font-style:normal] [&_b]:weight-semibold [&_small]:[margin:0] [&_small]:[text-align:right] [&_b]:[grid-column:1_/_-1] [&_em]:[grid-column:1_/_-1] [&_em]:[color:var(--muted)] [&_em]:type-helper [&_em]:[font-style:normal]',
    'order-product-bottom':
        '[min-width:0] [display:flex] [align-items:flex-end] [justify-content:space-between] [gap:8px]',
    'order-product-content':
        '[height:76px] [min-width:0] [display:flex] [flex-direction:column] [justify-content:space-between] [gap:3px]',
    'order-product-heading':
        '[min-width:0] [display:grid] [grid-template-columns:minmax(0,_1fr)_auto] [align-items:baseline] [gap:8px]',
    'order-product-price': 'type-body weight-bold [color:var(--text)] [white-space:nowrap]',
    'order-product-qty':
        'type-meta  [color:var(--muted)] [font-variant-numeric:tabular-nums] [flex-shrink:0]',
    'order-product-spec':
        '[min-width:0] type-meta  [color:var(--muted)] [overflow:hidden] [white-space:nowrap] [text-overflow:ellipsis]',
    'order-product-tag':
        'type-meta  weight-medium [color:var(--accent-ink)] [white-space:nowrap] [&.is-service]:[color:var(--success)]',
    'order-product-tags': '[min-width:0] [display:flex] [align-items:center] [gap:6px] [overflow:hidden]',
    'order-product-title':
        '[min-width:0] type-body weight-semibold [color:var(--text)]  [overflow:hidden] [white-space:nowrap] [text-overflow:ellipsis]',
    'order-state-badge':
        'type-meta weight-semibold  [padding:2.5px_0] [background:transparent] [color:var(--muted)] [border:0] [.order-card.is-pending_&]:[color:var(--warning)] [.order-card.is-shipping_&]:[color:var(--accent-ink)] [.order-card.is-shipped_&]:[color:var(--accent-ink)] [.order-card.is-delivered_&]:[color:var(--success)] [.order-card.is-cancelled_&]:[color:var(--muted)]',
    'order-status':
        '[padding:22px_14px_19px] [background:var(--surface)] [color:var(--text)] [&_strong]:[display:block] [&_span]:[display:block] [&_small]:[display:block] [&_strong]:type-metric [&_strong]:weight-semibold [&_span]:[margin-top:5px] [&_small]:[margin-top:8px] [&_small]:[color:var(--muted)] lg:[width:100%] lg:[max-width:none] lg:[margin-right:auto] lg:[margin-left:auto] lg:[margin-top:24px] lg:[border-radius:var(--skin-card-radius)] [border:var(--skin-card-outline,0)]',
    'order-total-amount': 'type-body weight-bold [color:var(--text)]',
    'order-total-count': '[color:var(--muted)] type-meta',
    'order-total-label': '[color:var(--text)] type-meta weight-medium',
    'order-total-summary':
        '[&_b]:[font-family:var(--font-numeric)] [&_b]:[font-variant-numeric:tabular-nums] [&_b]:[letter-spacing:var(--tracking-normal)] [display:flex] [align-items:baseline] [gap:4px] type-meta [color:var(--muted)] [min-width:0] [flex-wrap:wrap]',
    'orders-page': '[--page-surface:var(--paper)]',
};
