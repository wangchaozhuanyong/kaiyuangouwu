import type { ImagePromptSpec, ImageReferenceMode } from '../types';
import { Injectable } from '@nestjs/common';

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
        avoid: string[];
    }>;
}

let activeBundle: PromptRuleBundle = bundleJson;

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

    fallbackSpec(prompt: string, referenceMode: ImageReferenceMode = 'NONE'): ImagePromptSpec {
        const useCase = classifyUseCase(prompt, referenceMode);
        const profile = activeBundle.useCases.find(item => item.code === useCase) ?? activeBundle.useCases[0];
        const exactText = [...prompt.matchAll(/[“"「『](.*?)[”"」』]/gu)]
            .map(match => match[1])
            .filter(Boolean);
        return {
            useCase,
            subject: prompt.trim(),
            scene: '',
            composition: profile.defaults.composition,
            lighting: profile.defaults.lighting,
            camera: '',
            style: profile.defaults.style,
            colors: [],
            materials: [],
            exactText,
            preserve: referenceMode === 'NONE' ? [] : ['用户明确要求保留的参考图主体与细节'],
            avoid: [...profile.avoid, 'extra fingers', 'distorted anatomy', 'unrequested text'],
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

    render(spec: ImagePromptSpec): string {
        const lines = [
            `Subject: ${spec.subject}`,
            spec.scene && `Scene: ${spec.scene}`,
            `Composition: ${spec.composition}`,
            `Lighting: ${spec.lighting}`,
            spec.camera && `Camera: ${spec.camera}`,
            `Style: ${spec.style}`,
            spec.colors.length && `Colors: ${spec.colors.join(', ')}`,
            spec.materials.length && `Materials: ${spec.materials.join(', ')}`,
            spec.exactText.length &&
                `Render this text exactly: ${spec.exactText.map(text => JSON.stringify(text)).join(', ')}`,
            spec.preserve.length && `Preserve: ${spec.preserve.join('; ')}`,
            spec.avoid.length && `Avoid: ${spec.avoid.join('; ')}`,
        ].filter(Boolean);
        return lines.join('\n').slice(0, 8_000);
    }
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
