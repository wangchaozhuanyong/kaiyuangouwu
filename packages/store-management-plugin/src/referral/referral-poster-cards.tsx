import { Badge, Button, Switch } from '@vendure/dashboard';
import { ReferralPosterTemplateRecord } from '../dashboard/referral.graphql';

export const SYSTEM_POSTER_TEMPLATES = [
    {
        id: 'BRAND_MINIMAL',
        nameZh: '云桥简约',
        nameEn: 'CloudBridge minimal',
        desc: '经典白蓝极简科技版式，通用度最高，适合各类数字化产品。',
        gradient: 'linear-gradient(135deg, #1d4ed8, #60a5fa)',
    },
    {
        id: 'BENEFIT_RED_GOLD',
        nameZh: '冰川蓝光',
        nameEn: 'Glacier blue',
        desc: '冷光科技冰川蓝渐变，视觉聚焦，适合 SaaS 与 AI 服务。',
        gradient: 'linear-gradient(135deg, #0284c7, #38bdf8)',
    },
    {
        id: 'PRODUCT_STORY',
        nameZh: '青空流线',
        nameEn: 'Skyline flow',
        desc: '青空流线清新风格，视觉轻盈舒适，适合生活化与创作工具。',
        gradient: 'linear-gradient(135deg, #0369a1, #06b6d4)',
    },
    {
        id: 'PREMIUM_DARK',
        nameZh: '深海科技',
        nameEn: 'Deep-sea tech',
        desc: '深邃极客暗黑风，对比度鲜明，适合高阶开发者与 AI 工具。',
        gradient: 'linear-gradient(135deg, #020b1d, #0f2b5c)',
    },
    {
        id: 'CLOUD_BRIDGE_ORBIT',
        nameZh: '云桥轨道',
        nameEn: 'CloudBridge orbit',
        desc: '紫蓝科技轨道渐变，未来感与营销冲击力强。',
        gradient: 'linear-gradient(135deg, #4338ca, #7c3aed)',
    },
] as const;

export function SystemPosterTemplatesSection({
    enabledDefaultTemplates,
    defaultTemplate,
    disabled,
    onToggleDefaultTemplate,
    onMakeDefault,
}: {
    enabledDefaultTemplates: string[];
    defaultTemplate: string;
    disabled: boolean;
    onToggleDefaultTemplate: (id: string, enabled: boolean) => void;
    onMakeDefault: (id: string) => void;
}) {
    return (
        <div>
            <div>
                <h3 className="m-0 text-base font-semibold">系统预置海报模板</h3>
                <p className="mb-0 mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                    系统内置 5 款全屏移动端海报模板（1080×1920）。您可以通过“在客户端显示”开关控制是否在客户端展示，只有开启的模板会出现在买家前台列表中。
                </p>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {SYSTEM_POSTER_TEMPLATES.map(sys => {
                    const isEnabled = enabledDefaultTemplates.includes(sys.id);
                    const isDefault = defaultTemplate === sys.id;
                    return (
                        <article
                            key={sys.id}
                            className="flex flex-col justify-between overflow-hidden rounded-xl border bg-card"
                        >
                            <div>
                                <div
                                    className="relative aspect-[16/9] w-full overflow-hidden p-4 text-white flex flex-col justify-between"
                                    style={{ background: sys.gradient }}
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold uppercase tracking-wider opacity-90">
                                            预置海报
                                        </span>
                                        {isDefault && (
                                            <Badge className="bg-white/90 text-slate-900 hover:bg-white text-[11px]">
                                                当前默认
                                            </Badge>
                                        )}
                                    </div>
                                    <div>
                                        <div className="text-base font-bold drop-shadow-sm">{sys.nameZh}</div>
                                        <div className="text-xs opacity-80">{sys.nameEn}</div>
                                    </div>
                                </div>
                                <div className="p-4 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <strong className="text-sm font-semibold">{sys.nameZh}</strong>
                                        <Badge variant={isEnabled ? 'secondary' : 'outline'}>
                                            {isEnabled ? '已启用显示' : '已隐藏'}
                                        </Badge>
                                    </div>
                                    <p className="m-0 text-xs leading-relaxed text-muted-foreground">
                                        {sys.desc}
                                    </p>
                                </div>
                            </div>
                            <div className="p-4 pt-0 space-y-3">
                                <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2">
                                    <span className="text-xs font-medium">在客户端显示</span>
                                    <Switch
                                        checked={isEnabled}
                                        disabled={disabled}
                                        onCheckedChange={checked => onToggleDefaultTemplate(sys.id, checked)}
                                    />
                                </div>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="w-full"
                                    disabled={disabled || !isEnabled || isDefault}
                                    onClick={() => onMakeDefault(sys.id)}
                                >
                                    {isDefault ? '当前为默认海报' : '设为默认海报'}
                                </Button>
                            </div>
                        </article>
                    );
                })}
            </div>
        </div>
    );
}

export function CustomPosterTemplateCard({
    template,
    defaultTemplate,
    disabled,
    onEdit,
    onMakeDefault,
    onDelete,
    onToggleEnabled,
}: {
    template: ReferralPosterTemplateRecord;
    defaultTemplate: string;
    disabled: boolean;
    onEdit: () => void;
    onMakeDefault: () => void;
    onDelete: () => void;
    onToggleEnabled: (checked: boolean) => void;
}) {
    return (
        <article className="overflow-hidden rounded-xl border bg-card">
            <div className="relative aspect-[9/16] overflow-hidden bg-slate-900">
                {template.posterBackgroundAsset ? (
                    <img
                        src={template.posterBackgroundAsset.preview}
                        alt=""
                        className="size-full object-cover"
                    />
                ) : (
                    <div className="grid size-full place-items-center bg-[linear-gradient(145deg,#172554,#7c3aed,#db2777)] text-sm font-semibold text-white/80">
                        待上传竖版背景
                    </div>
                )}
                <div className="absolute inset-0 bg-black/25" />
                <div className="absolute inset-x-5 top-5 text-white">
                    <small className="font-bold">{template.titleZh}</small>
                    <strong className="mt-3 block text-xl leading-tight">
                        {template.headlineZh}
                    </strong>
                </div>
                <div className="absolute inset-x-5 top-[38%] space-y-2">
                    {[
                        template.featureOneTitleZh,
                        template.featureTwoTitleZh,
                        template.featureThreeTitleZh,
                    ].map(title => (
                        <div
                            key={title}
                            className="rounded-lg bg-white/95 px-3 py-2 text-xs font-bold text-slate-800 shadow"
                        >
                            {title}
                        </div>
                    ))}
                </div>
                <div className="absolute inset-x-5 bottom-[15%] rounded-lg bg-white/95 p-3 text-center text-xs font-bold text-slate-800 shadow">
                    {template.qrTitleZh || '二维码信息区'}
                </div>
                <div className="absolute inset-x-5 bottom-5 rounded-lg border border-white/25 bg-black/30 px-3 py-2 text-[11px] text-white backdrop-blur">
                    {template.serviceTextZh || '店铺服务说明'}
                </div>
            </div>
            <div className="space-y-3 p-4">
                <div className="flex items-center justify-between gap-2">
                    <strong className="truncate">{template.name}</strong>
                    <div className="flex gap-1">
                        <Badge variant={template.enabled ? 'secondary' : 'outline'}>
                            {template.enabled ? '已启用' : '已停用'}
                        </Badge>
                        {defaultTemplate === template.id && <Badge>默认</Badge>}
                    </div>
                </div>
                <p className="m-0 text-xs text-muted-foreground">
                    移动端 1080×1920 · 横版 1200×630 · 排序 {template.position}
                </p>
                <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2">
                    <span className="text-xs font-medium">在客户端显示</span>
                    <Switch
                        checked={template.enabled}
                        disabled={disabled}
                        onCheckedChange={onToggleEnabled}
                    />
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={disabled}
                        onClick={onEdit}
                    >
                        编辑
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={disabled || !template.enabled || defaultTemplate === template.id}
                        onClick={onMakeDefault}
                    >
                        {defaultTemplate === template.id ? '当前默认' : '设为默认'}
                    </Button>
                </div>
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={disabled}
                    onClick={onDelete}
                >
                    删除模板
                </Button>
            </div>
        </article>
    );
}
