import { Injectable } from '@nestjs/common';
import type { ImagePromptSpec, ImageReferenceMode } from '../types';

import bundleJson from './prompt-rules.bundle';

interface PromptRuleBundle {
    bundleVersion: number;
    sourceHash: string;
    routing: {
        rules: Array<{ modelCode: string; when: string[]; reasonZh: string; reasonEn: string }>;
    };
    useCases: Array<{
        code: string;
        defaults: { composition: string; lighting: string; style: string };
        defaultsZh?: { composition: string; lighting: string; style: string };
        avoid: string[];
        avoidZh?: string[];
    }>;
}

let activeBundle: PromptRuleBundle = bundleJson;

export type PromptOutputLanguage = 'en' | 'zh';

const legacyChineseFallback = {
    composition: '主体清晰、构图协调，并具有明确的视觉层级',
    lighting: '符合场景且自然协调的光线',
    style: '高质量、可信且符合请求的视觉风格',
    avoid: ['结构畸变', '不必要的文字', '视觉杂乱'],
};

const renderCopy = {
    en: {
        subject: 'Subject',
        scene: 'Scene',
        composition: 'Composition',
        lighting: 'Lighting',
        camera: 'Camera',
        style: 'Style',
        colors: 'Colors',
        materials: 'Materials',
        exactText: 'Render this text exactly',
        preserve: 'Preserve',
        avoid: 'Avoid',
        fieldSeparator: ': ',
        listSeparator: ', ',
        itemSeparator: '; ',
    },
    zh: {
        subject: '主体',
        scene: '场景',
        composition: '构图',
        lighting: '光线',
        camera: '镜头',
        style: '风格',
        colors: '色彩',
        materials: '材质',
        exactText: '需精确呈现的文字',
        preserve: '保留',
        avoid: '避免',
        fieldSeparator: '：',
        listSeparator: '，',
        itemSeparator: '；',
    },
} as const;

@Injectable()
export class PromptRulesService {
    get sourceHash(): string {
        return activeBundle.sourceHash;
    }

    get serializableBundle(): Record<string, any> {
        return activeBundle;
    }

    activateBundle(value: unknown): void {
        if (!isRuleBundle(value)) throw new Error('提示词 Skill bundle 格式无效');
        activeBundle = value;
    }

    fallbackSpec(
        prompt: string,
        referenceMode: ImageReferenceMode = 'NONE',
        language: PromptOutputLanguage = detectPromptLanguage(prompt),
    ): ImagePromptSpec {
        const useCase = classifyUseCase(prompt, referenceMode);
        const profile = activeBundle.useCases.find(item => item.code === useCase) ?? activeBundle.useCases[0];
        const defaults = language === 'zh' ? (profile.defaultsZh ?? legacyChineseFallback) : profile.defaults;
        const avoid = language === 'zh' ? (profile.avoidZh ?? legacyChineseFallback.avoid) : profile.avoid;
        const exactText = [...prompt.matchAll(/[“"「『](.*?)[”"」』]/gu)]
            .map(match => match[1])
            .filter(Boolean);
        return {
            useCase,
            subject: prompt.trim(),
            scene: '',
            composition: defaults.composition,
            lighting: defaults.lighting,
            camera: '',
            style: defaults.style,
            colors: [],
            materials: [],
            exactText,
            preserve:
                referenceMode === 'NONE'
                    ? []
                    : [
                          language === 'zh'
                              ? '用户明确要求保留的参考图主体与细节'
                              : 'the reference subject and details the user explicitly requested to preserve',
                      ],
            avoid: [
                ...avoid,
                ...(language === 'zh'
                    ? ['多余手指', '畸形人体结构', '未要求的文字']
                    : ['extra fingers', 'distorted anatomy', 'unrequested text']),
            ],
            referenceMode,
        };
    }

    validateSpec(value: unknown): ImagePromptSpec | undefined {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return;
        const item = value as Record<string, unknown>;
        const textFields = ['useCase', 'subject', 'scene', 'composition', 'lighting', 'camera', 'style'];
        const listFields = ['colors', 'materials', 'exactText', 'preserve', 'avoid'];
        const allowedFields = new Set([...textFields, ...listFields, 'referenceMode']);
        if (Object.keys(item).some(key => !allowedFields.has(key))) return;
        if (textFields.some(key => typeof item[key] !== 'string')) return;
        if (
            listFields.some(
                key =>
                    !Array.isArray(item[key]) ||
                    !(item[key] as unknown[]).every(entry => typeof entry === 'string'),
            )
        )
            return;
        const textLimits: Record<string, number> = {
            useCase: 64,
            subject: 1_200,
            scene: 800,
            composition: 800,
            lighting: 500,
            camera: 500,
            style: 500,
        };
        if (textFields.some(key => (item[key] as string).length > textLimits[key])) return;
        const listLimits: Record<string, { count: number; itemLength: number }> = {
            colors: { count: 12, itemLength: 80 },
            materials: { count: 12, itemLength: 120 },
            exactText: { count: 20, itemLength: 300 },
            preserve: { count: 20, itemLength: 200 },
            avoid: { count: 30, itemLength: 160 },
        };
        if (
            listFields.some(key => {
                const list = item[key] as string[];
                const limit = listLimits[key];
                return list.length > limit.count || list.some(entry => entry.length > limit.itemLength);
            })
        )
            return;
        if (
            !['NONE', 'STYLE', 'COMPOSITION', 'IDENTITY', 'PRODUCT', 'EDIT'].includes(
                String(item.referenceMode),
            )
        )
            return;
        if (!activeBundle.useCases.some(profile => profile.code === item.useCase)) return;
        return item as unknown as ImagePromptSpec;
    }

    recommendation(spec: ImagePromptSpec): { modelCode: string; reasonZh: string; reasonEn: string } {
        const tags = new Set<string>();
        const searchable = [spec.subject, spec.scene, spec.composition, spec.style].join(' ');
        if (spec.referenceMode === 'IDENTITY') tags.add('identity-preservation');
        if (spec.referenceMode === 'EDIT') tags.add('high-fidelity-edit');
        if (spec.referenceMode === 'PRODUCT') tags.add('product-cutout');
        if (
            /(透明背景|抠图|去背景|transparent\s+background|product\s+cutout|remove\s+(?:the\s+)?background)/iu.test(
                searchable,
            )
        ) {
            tags.add('transparent-background');
        }
        if (spec.exactText.length) tags.add('exact-text');
        if (spec.useCase === 'ecommerce-poster') tags.add('poster');
        if (/(信息图|infographic|data\s+visuali[sz]ation)/iu.test(searchable)) tags.add('infographic');
        if (/(复杂版式|多栏布局|complex\s+layout)/iu.test(searchable)) tags.add('complex-layout');
        if (spec.useCase === 'illustration') tags.add('illustration');
        if (spec.useCase === 'product-photo') tags.add('product-scene');
        tags.add('general');
        return (
            activeBundle.routing.rules.find(rule => rule.when.some(tag => tags.has(tag))) ??
            activeBundle.routing.rules[activeBundle.routing.rules.length - 1]
        );
    }

    render(
        spec: ImagePromptSpec,
        language: PromptOutputLanguage = detectPromptLanguage(spec.subject),
    ): string {
        const copy = renderCopy[language];
        const lines = [
            `${copy.subject}${copy.fieldSeparator}${spec.subject}`,
            spec.scene && `${copy.scene}${copy.fieldSeparator}${spec.scene}`,
            `${copy.composition}${copy.fieldSeparator}${spec.composition}`,
            `${copy.lighting}${copy.fieldSeparator}${spec.lighting}`,
            spec.camera && `${copy.camera}${copy.fieldSeparator}${spec.camera}`,
            `${copy.style}${copy.fieldSeparator}${spec.style}`,
            spec.colors.length &&
                `${copy.colors}${copy.fieldSeparator}${spec.colors.join(copy.listSeparator)}`,
            spec.materials.length &&
                `${copy.materials}${copy.fieldSeparator}${spec.materials.join(copy.listSeparator)}`,
            spec.exactText.length &&
                `${copy.exactText}${copy.fieldSeparator}${spec.exactText
                    .map(text => JSON.stringify(text))
                    .join(copy.listSeparator)}`,
            spec.preserve.length &&
                `${copy.preserve}${copy.fieldSeparator}${spec.preserve.join(copy.itemSeparator)}`,
            spec.avoid.length && `${copy.avoid}${copy.fieldSeparator}${spec.avoid.join(copy.itemSeparator)}`,
        ].filter(Boolean);
        return lines.join('\n').slice(0, 8_000);
    }
}

export function promptLanguageFromLanguageCode(languageCode?: string | null): PromptOutputLanguage {
    return /^zh(?:_|-|$)/iu.test(languageCode?.trim() ?? '') ? 'zh' : 'en';
}

export function detectPromptLanguage(
    prompt: string,
    fallback: PromptOutputLanguage = 'en',
): PromptOutputLanguage {
    const textWithoutExactRequestedText = prompt
        .replace(/[“"「『](.*?)[”"」』]/gu, ' ')
        .replace(/https?:\/\/\S+/giu, ' ');
    if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(textWithoutExactRequestedText)) {
        return 'en';
    }
    const hanCount = textWithoutExactRequestedText.match(/\p{Script=Han}/gu)?.length ?? 0;
    const latinWordCount =
        textWithoutExactRequestedText.match(/\p{Script=Latin}+(?:['’-]\p{Script=Latin}+)*/gu)?.length ?? 0;
    if (hanCount === 0 && latinWordCount === 0) return fallback;
    return hanCount > latinWordCount ? 'zh' : 'en';
}

function isRuleBundle(value: unknown): value is PromptRuleBundle {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const candidate = value as Partial<PromptRuleBundle>;
    return (
        Number.isInteger(candidate.bundleVersion) &&
        typeof candidate.sourceHash === 'string' &&
        /^[a-f0-9]{64}$/u.test(candidate.sourceHash) &&
        Array.isArray(candidate.useCases) &&
        candidate.useCases.length > 0 &&
        Array.isArray(candidate.routing?.rules) &&
        candidate.routing.rules.length > 0
    );
}

function classifyUseCase(prompt: string, referenceMode: ImageReferenceMode): string {
    if (referenceMode !== 'NONE') return 'reference-edit';
    if (/(海报|poster|banner|横幅|文字|标题|信息图|infographic)/iu.test(prompt)) return 'ecommerce-poster';
    if (/(室内|客厅|卧室|厨房|柜|装修|interior|room)/iu.test(prompt)) return 'interior-design';
    if (/(人像|肖像|portrait|写真|模特)/iu.test(prompt)) return 'portrait';
    if (/(插画|illustration|卡通|漫画|anime)/iu.test(prompt)) return 'illustration';
    return 'product-photo';
}
