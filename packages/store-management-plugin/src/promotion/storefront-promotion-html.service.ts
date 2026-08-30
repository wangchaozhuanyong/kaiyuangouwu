import { Injectable } from '@nestjs/common';
import { UserInputError } from '@vendure/core';
import { load } from 'cheerio';
import MarkdownIt from 'markdown-it';

import { StorefrontPromotionContentType } from '../types';

import { DEFAULT_PROMOTION_TEMPLATE, DEFAULT_PROMOTION_TEMPLATE_VERSION } from './default-promotion-template';
import { normalizePromotionEntryDestination } from './promotion-entry-destination';
import { PROMOTION_VISUAL_SCRIPT } from './promotion-visual-script';

export const MAX_PROMOTION_SOURCE_BYTES = 60_000;

export interface StorefrontPromotionBindings {
    'store.name': string;
    'store.description': string;
    'store.logoUrl': string;
    'store.heroImageUrl': string;
    'store.shareImageUrl'?: string;
    'store.shareTitle'?: string;
    'store.shareDescription'?: string;
    'store.currentYear': string;
    'store.language': string;
}

const PROMOTION_IMAGE_BINDINGS: ReadonlyArray<keyof StorefrontPromotionBindings> = [
    'store.logoUrl',
    'store.heroImageUrl',
    'store.shareImageUrl',
];

interface RenderPromotionInput {
    contentType: StorefrontPromotionContentType;
    source: string;
    bindings: StorefrontPromotionBindings;
    entryTicket: string;
    canonicalUrl?: string | null;
}

const MARKDOWN_SHELL = `<!doctype html>
<html lang="{{store.language}}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{store.name}}</title>
    <style>
        :root { color-scheme: light dark; --bg: #f4f7f6; --panel: #e4ebe8; --text: #18201d; --muted: #53605b; --accent: #276b58; --button: #f7fbf9; }
        * { box-sizing: border-box; }
        body {
            min-width: 320px; min-height: 100dvh; margin: 0;
            background: var(--bg); color: var(--text);
            font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .markdown-shell { width: min(100% - 36px, 820px); margin: 0 auto; padding: clamp(24px, 6vw, 72px) 0; }
        .markdown-brand { display: flex; align-items: center; gap: 12px; margin-bottom: clamp(42px, 8vw, 92px); }
        .markdown-brand img { width: 44px; height: 44px; border-radius: 14px; object-fit: contain; background: var(--panel); }
        .markdown-content { font-size: clamp(16px, 2vw, 19px); line-height: 1.72; }
        .markdown-content h1 { max-width: 14ch; margin: 0 0 28px; font-size: clamp(42px, 8vw, 78px); letter-spacing: -0.055em; line-height: 1; text-wrap: balance; }
        .markdown-content h2 { margin-top: 2em; font-size: clamp(28px, 4vw, 42px); letter-spacing: -0.035em; }
        .markdown-content img { display: block; max-width: 100%; height: auto; border-radius: 16px; }
        .markdown-content a { color: var(--accent); }
        .markdown-entry { margin-top: 42px; }
        .markdown-entry button {
            min-height: 54px; padding: 0 28px; border: 0; border-radius: 16px;
            background: var(--accent); color: var(--button); font: inherit; font-weight: 720; cursor: pointer;
        }
        .markdown-entry button:focus-visible { outline: 3px solid var(--accent); outline-offset: 4px; }
        @media (max-width: 600px) { .markdown-entry button { width: 100%; } }
        @media (prefers-color-scheme: dark) { :root { --bg: #111714; --panel: #202925; --text: #edf3f0; --muted: #abb8b2; --accent: #79bda7; --button: #10221c; } }
    </style>
</head>
<body>
    <main class="markdown-shell">
        <header class="markdown-brand">
            <img data-bind-src="store.logoUrl" data-hide-if-empty alt="{{store.name}}">
            <strong data-bind-text="store.name"></strong>
        </header>
        <article class="markdown-content">{{promotion.markdown}}</article>
        <form class="markdown-entry" data-store-entry><button type="submit">{{promo.enterService}}</button></form>
    </main>
</body>
</html>`;

const FALLBACK_ENTRY_FORM = `<form data-store-entry style="position:fixed;right:18px;bottom:18px;z-index:2147483647">
</form>`;

const PROMOTION_ZH_COPY = {
    metaTitle: 'Damatong | AI 数字服务',
    metaDescription: 'AI API 中转、AI 服务订阅、调用额度与人工支持，一个入口更快找到。',
    skipToContent: '跳到主要内容',
    brandType: 'AI 数字服务',
    navigation: '页面导航',
    navServices: '服务能力',
    navScenarios: '适合谁',
    navProcess: '服务流程',
    navFaq: '常见问题',
    headerViewServices: '查看服务',
    viewServices: '查看可用服务',
    enterService: '进入服务中心',
    heroEyebrow: 'Damatong · AI 服务入口',
    heroLead: '连接需要的',
    heroHighlight: 'AI 服务',
    heroTail: '',
    heroTailLead: '连接需要的',
    heroTailEnd: 'AI 服务',
    heroDescription:
        '面向个人、创作者、开发者与小团队，提供清晰易懂的 AI 数字服务入口。减少筛选和使用成本，让用户更简单地找到适合自己的工具与服务。',
    carouselRole: '轮播',
    slideRole: '轮播页',
    heroCarouselAria: 'Damatong AI 服务推荐',
    carouselNavigation: '切换推荐服务',
    pauseCarousel: '暂停轮播',
    resumeCarousel: '继续轮播',
    heroSlideOneAria: '第 1 项，共 3 项：AI API 中转低至 0.1 倍起',
    heroSlideOneEyebrow: 'Damatong · AI API 中转',
    heroSlideOneTitleLead: 'AI API 中转',
    heroSlideOneTitleAccent: '低至 0.1 倍起',
    heroSlideOneDescription: '覆盖多种模型与通道，不同模型、通道与当前价格以服务中心为准。',
    heroSlideOneControl: 'AI API',
    heroSlideTwoAria: '第 2 项，共 3 项：AI 服务订阅，更轻的长期使用成本',
    heroSlideTwoEyebrow: 'Damatong · AI 服务订阅',
    heroSlideTwoTitleLead: 'AI 服务订阅',
    heroSlideTwoTitleAccent: '更轻的长期使用成本',
    heroSlideTwoDescription: '按当前需求查看可用订阅方向，减少筛选和长期使用成本。',
    heroSlideTwoControl: 'AI 订阅',
    heroSlideThreeAria: '第 3 项，共 3 项：人工服务支持，从选择到使用都有人跟进',
    heroSlideThreeEyebrow: 'Damatong · 一站式服务',
    heroSlideThreeTitleLead: '人工服务支持',
    heroSlideThreeTitleAccent: '从选择到使用，都有人跟进',
    heroSlideThreeDescription: '遇到选择与使用问题时，可以获得清晰、及时的人工协助。',
    heroSlideThreeControl: '人工支持',
    learnService: '了解服务方式',
    entryNote: '具体可用内容、当前价格与支持范围以服务中心页面为准。',
    trustClear: '清晰说明',
    trustScenarios: '多场景覆盖',
    trustSupport: '人工服务支持',
    networkAria: 'Damatong 位于中心，连接助手、编程、创作与 API 四类 AI 服务',
    networkAssistant: '助手',
    networkAssistantDescription: '日常协作与信息处理',
    networkCoding: '编程',
    networkCodingDescription: '开发调用与模型接入',
    networkCreative: '创作',
    networkCreativeDescription: '创作与内容生产',
    networkApi: 'API',
    networkApiDescription: '灵活连接 AI 能力',
    valuesTitle: '从需求出发，少走几步。',
    valuesIntro: '先从你正在做的事开始，再选择合适的 AI 服务。',
    valueDiscoverLabel: '发现',
    valueDiscoverTitle: 'AI API 中转更轻成本',
    valueDiscoverDescription: '部分通道低至 0.1 倍起，不同模型、通道与当前价格以服务中心为准。',
    valueUnderstandLabel: '理解',
    valueUnderstandTitle: '主流 AI 服务订阅',
    valueUnderstandDescription: '按当前需求查看可用订阅方向，减少长期使用成本。',
    valueSupportLabel: '支持',
    valueSupportTitle: '有人跟进使用问题',
    valueSupportDescription: '从选择到使用，遇到问题时可以获得人工服务支持。',
    servicesLabel: '服务能力',
    servicesTitle: '一个入口，连接订阅、API 与额度。',
    servicesIntro: '从日常订阅到开发调用，Damatong 按真实需求组织服务，让你更快找到适合的方向。',
    capabilitySubscriptionTitle: 'AI 服务订阅',
    capabilitySubscriptionMark: 'AI',
    capabilitySubscriptionDescription: '适合希望以更轻成本使用主流 AI 服务的个人、创作者与小团队。',
    capabilityApiTitle: 'AI API 中转',
    capabilityApiMark: 'API',
    capabilityApiDescription: '提供多种模型调用通道，适合开发接入和持续调用场景。',
    capabilityTokenTitle: 'AI 调用额度',
    capabilityTokenMark: '额度',
    capabilityTokenDescription: '适合持续调用 AI 能力的项目，用于安排更灵活的使用方式。',
    capabilityToolsTitle: 'AI 效率工具',
    capabilityToolsMark: '工具',
    capabilityToolsDescription: '面向图片生成、验证和日常协作，补足具体工作环节。',
    scenariosTitle: '不一样的工作方式，都有合适起点。',
    scenariosIntro: '无论你是第一次接触 AI，还是已经把 AI 放进日常流程，都可以从自己的任务出发开始了解。',
    scenarioPersonalTitle: '个人创业',
    scenarioPersonalDescription: '用 AI 处理信息、拆解任务和推进日常运营，让一个人也能更高效地完成工作。',
    scenarioCreatorTitle: '内容创作',
    scenarioCreatorDescription: '围绕灵感、图片、文案与内容生产，建立更顺手的创作辅助流程。',
    scenarioDeveloperTitle: '开发接入',
    scenarioDeveloperDescription: '需要模型调用、API 接入或更稳定的 AI 能力连接方式。',
    scenarioTeamTitle: '团队使用',
    scenarioTeamDescription: '希望为协作成员找到易理解、可执行、有人支持的 AI 服务方案。',
    processTitle: '从需求出发，四步找到合适服务。',
    processIntro: '你不需要一次看懂所有技术细节。按场景浏览，先确认方向，再进入具体服务。',
    processStepOneTitle: '说清你要做什么',
    processStepOneDescription: '先判断你是日常使用、内容创作、开发调用还是团队协作。',
    processStepTwoTitle: '选合适的方向',
    processStepTwoDescription: '查看对应的服务能力、适用场景和使用方式。',
    processStepThreeTitle: '进入服务中心',
    processStepThreeDescription: '打开完整服务内容，继续确认具体选项与当前信息。',
    processStepFourTitle: '需要时获得支持',
    processStepFourDescription: '使用过程中遇到问题，可以通过人工服务获得帮助。',
    trustLabel: '服务保障',
    trustTitle: '信息清楚，选择更安心。',
    trustIntro: '从服务方向到使用支持，Damatong 把关键说明放在你需要做决定的地方。',
    trustOneTitle: '说明先讲清楚',
    trustOneDescription: '服务中心会说明适用对象、服务方向和使用方式，具体可用内容以当前页面为准。',
    trustTwoTitle: '覆盖多种工作场景',
    trustTwoDescription: '服务按个人、创作、开发和团队任务组织，方便从当前工作场景开始选择。',
    trustThreeTitle: '遇到问题有人回应',
    trustThreeDescription: '遇到服务选择或使用问题时，可以通过客服中心提交问题并获得人工协助。',
    faqTitle: '开始之前，先确认这些。',
    faqIntro: '如果还没想好从哪一类服务开始，可以先看这里。',
    faqOneQuestion: 'Damatong 主要提供什么？',
    faqOneAnswer:
        'Damatong 聚合 AI 服务订阅、AI API 中转、AI 调用额度和 AI 效率工具，帮助不同使用场景找到清楚的服务入口。',
    faqTwoQuestion: '我应该从哪一类服务开始？',
    faqTwoAnswer:
        '如果你希望直接使用 AI 服务，可以先了解订阅方向；如果你需要开发调用或团队接入，可以先了解 AI API 中转与调用额度。',
    faqThreeQuestion: '个人和小团队都适合吗？',
    faqThreeAnswer:
        '适合。页面按个人使用、内容创作、开发调用和小团队协作等场景整理服务，你可以从最接近当前任务的一项开始。',
    faqFourQuestion: '具体服务详情在哪里查看？',
    faqFourAnswer: '点击页面中的“查看可用服务”，进入 Damatong 服务中心查看当前可用内容、服务说明和支持信息。',
    faqFiveQuestion: '可以直接在这里完成购买或交易吗？',
    faqFiveAnswer: '推广页只用于介绍服务方向，具体服务详情、价格与后续操作请进入 Damatong 服务中心查看。',
    finalLabel: 'Damatong / 服务中心',
    finalTitle: '用更轻的成本，连接需要的 AI 服务。',
    finalIntro: '进入服务中心，查看当前可用的 AI 服务订阅、API 中转、调用额度与人工支持。',
    finalSignalAria: 'Damatong 服务中心提供的信息',
    finalDiscoverLabel: '发现',
    finalDiscoverDescription: '按场景浏览',
    finalChooseLabel: '选择',
    finalChooseDescription: '按能力选择',
    finalSupportLabel: '支持',
    finalSupportDescription: '需要时获得支持',
    mobileEntryAria: '进入服务中心',
    mobileEntry: '进入服务中心',
    footerType: 'Damatong · AI 数字服务',
    footerNavigation: '规则与支持',
    privacy: '隐私政策',
    terms: '使用条款',
    support: '客服中心',
} as const;

type PromotionCopyKey = keyof typeof PROMOTION_ZH_COPY;

const PROMOTION_EN_COPY: Record<PromotionCopyKey, string> = {
    metaTitle: 'Damatong | AI Digital Services',
    metaDescription:
        'AI API routing, AI service subscriptions, usage credits, and human support through one clear entry point.',
    skipToContent: 'Skip to main content',
    brandType: 'AI digital services',
    navigation: 'Page navigation',
    navServices: 'Services',
    navScenarios: 'For you',
    navProcess: 'How it works',
    navFaq: 'FAQ',
    headerViewServices: 'View services',
    viewServices: 'View available services',
    enterService: 'Enter service center',
    heroEyebrow: 'DAMATONG · AI SERVICE ENTRY',
    heroLead: 'Connect the',
    heroHighlight: 'AI services',
    heroTail: 'you need',
    heroTailLead: 'Connect the',
    heroTailEnd: 'AI services you need',
    heroDescription:
        'For individuals, creators, developers, and small teams, Damatong provides a clear entry point to AI digital services. ' +
        'Spend less time comparing tools and more time choosing what fits your work.',
    carouselRole: 'carousel',
    slideRole: 'slide',
    heroCarouselAria: 'Damatong AI service highlights',
    carouselNavigation: 'Choose a featured service',
    pauseCarousel: 'Pause carousel',
    resumeCarousel: 'Resume carousel',
    heroSlideOneAria: 'Slide 1 of 3: Selected AI API routes from 0.1 times',
    heroSlideOneEyebrow: 'Damatong · AI API ROUTING',
    heroSlideOneTitleLead: 'AI API routing',
    heroSlideOneTitleAccent: 'from 0.1×',
    heroSlideOneDescription:
        'Connect to multiple models and routes. Current rates vary by model and route; check the service center for details.',
    heroSlideOneControl: 'AI API',
    heroSlideTwoAria: 'Slide 2 of 3: AI service subscriptions with lighter long-term costs',
    heroSlideTwoEyebrow: 'Damatong · AI SUBSCRIPTIONS',
    heroSlideTwoTitleLead: 'AI service subscriptions',
    heroSlideTwoTitleAccent: 'Lighter long-term costs',
    heroSlideTwoDescription:
        'Review currently available subscription directions with less searching and lower ongoing costs.',
    heroSlideTwoControl: 'Subscriptions',
    heroSlideThreeAria: 'Slide 3 of 3: Human support from choosing a service through using it',
    heroSlideThreeEyebrow: 'Damatong · ONE SERVICE ENTRY',
    heroSlideThreeTitleLead: 'Human service support',
    heroSlideThreeTitleAccent: 'Help from choosing to using',
    heroSlideThreeDescription:
        'Get clear, timely human help when questions come up while choosing or using a service.',
    heroSlideThreeControl: 'Support',
    learnService: 'How it works',
    entryNote: 'Available services, current prices, and support scope are confirmed in the service center.',
    trustClear: 'Clear guidance',
    trustScenarios: 'Many use cases',
    trustSupport: 'Human support',
    networkAria: 'Damatong at the center, connecting Assistant, Coding, Creative, and API services',
    networkAssistant: 'Assistant',
    networkAssistantDescription: 'Everyday work and information',
    networkCoding: 'Coding',
    networkCodingDescription: 'Development and model access',
    networkCreative: 'Creative',
    networkCreativeDescription: 'Content and creative work',
    networkApi: 'API',
    networkApiDescription: 'Flexible AI connections',
    valuesTitle: 'Start with the task. Take fewer steps.',
    valuesIntro: 'Begin with what you are trying to do, then choose the right AI service.',
    valueDiscoverLabel: 'DISCOVER',
    valueDiscoverTitle: 'Lighter AI API routing costs',
    valueDiscoverDescription:
        'Selected routes start from 0.1×. Rates vary by model and route, so check current details in the service center.',
    valueUnderstandLabel: 'UNDERSTAND',
    valueUnderstandTitle: 'Mainstream AI subscriptions',
    valueUnderstandDescription:
        'Review currently available subscription directions with lower ongoing costs.',
    valueSupportLabel: 'SUPPORT',
    valueSupportTitle: 'Get help when you need it',
    valueSupportDescription: 'Human support is available from choosing a direction through getting started.',
    servicesLabel: 'SERVICE CAPABILITIES',
    servicesTitle: 'One entry point for subscriptions, API, and credits.',
    servicesIntro:
        'From everyday subscriptions to developer calls, Damatong organizes services around real needs so you can find the right direction sooner.',
    capabilitySubscriptionTitle: 'AI service subscriptions',
    capabilitySubscriptionMark: 'AI',
    capabilitySubscriptionDescription:
        'For individuals, creators, and small teams that want mainstream AI services at a lighter cost.',
    capabilityApiTitle: 'AI API routing',
    capabilityApiMark: 'API',
    capabilityApiDescription: 'Multiple model routes for developer integration and ongoing AI calls.',
    capabilityTokenTitle: 'AI usage credits',
    capabilityTokenMark: 'CREDIT',
    capabilityTokenDescription:
        'For projects that use AI continuously and need a more flexible way to plan access.',
    capabilityToolsTitle: 'AI productivity tools',
    capabilityToolsMark: 'TOOL',
    capabilityToolsDescription:
        'For image generation, verification, and everyday collaboration across your workflow.',
    scenariosTitle: 'Different ways of working start from different needs.',
    scenariosIntro:
        'Whether you are new to AI or already use it every day, start by looking at the task in front of you.',
    scenarioPersonalTitle: 'Entrepreneurship',
    scenarioPersonalDescription:
        'Use AI to organize information, break down tasks, and move everyday operations forward.',
    scenarioCreatorTitle: 'Content creation',
    scenarioCreatorDescription:
        'Build a smoother creative workflow around ideas, images, copy, and content production.',
    scenarioDeveloperTitle: 'Developer integration',
    scenarioDeveloperDescription:
        'Connect models through API access or a more stable way to add AI capabilities.',
    scenarioTeamTitle: 'Team workflows',
    scenarioTeamDescription:
        'Give collaborators a clear, practical way to discover and use AI services with support.',
    processTitle: 'Start with your need. Find the right service in four steps.',
    processIntro:
        'You do not need to understand every technical detail at once. Browse by use case, confirm the direction, then continue.',
    processStepOneTitle: 'Describe what you need to do',
    processStepOneDescription:
        'Start by identifying everyday use, content creation, development, or team collaboration.',
    processStepTwoTitle: 'Choose a direction',
    processStepTwoDescription: 'Review the relevant capability, use cases, and way of working.',
    processStepThreeTitle: 'Enter the service center',
    processStepThreeDescription:
        'Open the full service information and confirm the options currently available.',
    processStepFourTitle: 'Get support when needed',
    processStepFourDescription: 'If you have questions while getting started, human support is available.',
    trustLabel: 'SERVICE SUPPORT',
    trustTitle: 'Clear information makes decisions easier.',
    trustIntro:
        'From service direction to getting started, Damatong puts the details you need where decisions happen.',
    trustOneTitle: 'The basics are clear first',
    trustOneDescription:
        'The service center explains who each direction suits, how it works, and what is currently available.',
    trustTwoTitle: 'Coverage across workflows',
    trustTwoDescription:
        'Services are organized around individual, creative, developer, and team tasks so you can start from your current workflow.',
    trustThreeTitle: 'Someone can help when needed',
    trustThreeDescription:
        'You can contact the support center for human help with service selection or usage questions.',
    faqTitle: 'Before you start, check these answers.',
    faqIntro: 'If you are not sure where to begin, these answers can help.',
    faqOneQuestion: 'What does Damatong provide?',
    faqOneAnswer:
        'Damatong brings together AI service subscriptions, AI API routing, AI usage credits, and AI productivity tools ' +
        'so different use cases have a clear starting point.',
    faqTwoQuestion: 'Which service should I start with?',
    faqTwoAnswer:
        'If you want direct AI service access, start with subscriptions. If you need development access or ' +
        'team integration, explore AI API routing and AI usage credits.',
    faqThreeQuestion: 'Is it suitable for individuals and small teams?',
    faqThreeAnswer:
        'Yes. Services are organized around individual use, content creation, development, and team collaboration so you can start with the closest match.',
    faqFourQuestion: 'Where can I see the full service details?',
    faqFourAnswer:
        'Select “View available services” to enter the Damatong service center and see current options, service details, and support information.',
    faqFiveQuestion: 'Can I complete a purchase or transaction here?',
    faqFiveAnswer:
        'This promotion page introduces service directions. Enter the Damatong service center for specific details, pricing, and next steps.',
    finalLabel: 'DAMATONG / SERVICE CENTER',
    finalTitle: 'Connect to the AI services you need at a lighter cost.',
    finalIntro:
        'Enter the service center to review available AI subscriptions, API routing, usage credits, and human support.',
    finalSignalAria: 'Information provided by the Damatong service center',
    finalDiscoverLabel: 'DISCOVER',
    finalDiscoverDescription: 'Browse by use case',
    finalChooseLabel: 'CHOOSE',
    finalChooseDescription: 'Choose by capability',
    finalSupportLabel: 'SUPPORT',
    finalSupportDescription: 'Get help when needed',
    mobileEntryAria: 'Enter the service center',
    mobileEntry: 'Enter service center',
    footerType: 'Damatong · AI digital services',
    footerNavigation: 'Rules and support',
    privacy: 'Privacy policy',
    terms: 'Terms of use',
    support: 'Support center',
};

const PROMOTION_COPY = { zh: PROMOTION_ZH_COPY, en: PROMOTION_EN_COPY } as const;

const PROMOTION_ACCESSIBILITY_STYLE = `<style data-storefront-promotion-accessibility>
    :where(a[href], button, [tabindex]:not([tabindex="-1"])):focus-visible {
        outline: 3px solid var(--promo-focus-color, #91e6c4);
        outline-offset: 3px;
    }
</style>`;

@Injectable()
export class StorefrontPromotionHtmlService {
    private readonly markdown = new MarkdownIt({ html: false, linkify: true, typographer: false });

    get defaultTemplate(): string {
        return DEFAULT_PROMOTION_TEMPLATE;
    }

    get defaultTemplateVersion(): number {
        return DEFAULT_PROMOTION_TEMPLATE_VERSION;
    }

    validateSource(contentType: StorefrontPromotionContentType, source: string): string {
        if (contentType !== 'HTML' && contentType !== 'MARKDOWN') {
            throw new UserInputError('推广页格式无效');
        }
        const normalized = source.trim();
        if (!normalized) {
            throw new UserInputError('推广页内容不能为空');
        }
        if (Buffer.byteLength(normalized, 'utf8') > MAX_PROMOTION_SOURCE_BYTES) {
            throw new UserInputError('推广页源码不能超过 60 KB');
        }
        return normalized;
    }

    render(input: RenderPromotionInput): string {
        const source =
            input.contentType === 'MARKDOWN'
                ? MARKDOWN_SHELL.replace('{{promotion.markdown}}', this.markdown.render(input.source))
                : input.source;
        const withTokens = this.replaceTokens(source, input.bindings);
        const $ = load(withTokens, { xml: false });
        const trustedImageUrls = new Set(
            PROMOTION_IMAGE_BINDINGS.map(key => input.bindings[key]).filter((value): value is string =>
                Boolean(value),
            ),
        );

        this.sanitizeDocument($, trustedImageUrls);
        this.applyBindings($, input.bindings);
        this.normalizeImages($, trustedImageUrls);
        this.normalizeEntryForm($, input.entryTicket, this.getPromotionCopy(input.bindings).enterService);
        this.normalizeHead($, input.bindings, input.canonicalUrl);
        this.appendTrustedVisualScript($);

        const document = $.html().replace(/^<!doctype html>\s*/iu, '');
        return `<!doctype html>\n${document}`;
    }

    private sanitizeDocument($: ReturnType<typeof load>, trustedImageUrls: ReadonlySet<string>): void {
        $('script, iframe, object, embed, base, noscript, template, svg, math').remove();
        $('link[rel="stylesheet"], link[rel="preload"], link[rel="modulepreload"]').remove();
        $('meta[http-equiv]').each((_index, element) => {
            const value = ($(element).attr('http-equiv') ?? '').toLowerCase();
            if (value === 'refresh' || value === 'content-security-policy') {
                $(element).remove();
            }
        });

        $('*').each((_index, element) => {
            const node = $(element);
            const attributes =
                'attribs' in element
                    ? (element.attribs as Record<string, string>)
                    : ({} as Record<string, string>);
            for (const [name, value] of Object.entries(attributes)) {
                const normalizedName = name.toLowerCase();
                if (
                    normalizedName.startsWith('on') ||
                    normalizedName === 'srcdoc' ||
                    normalizedName === 'formaction'
                ) {
                    node.removeAttr(name);
                    continue;
                }
                if (normalizedName === 'style') {
                    node.attr(name, this.sanitizeCss(value, trustedImageUrls));
                    continue;
                }
                if (['href', 'src', 'poster', 'background', 'action'].includes(normalizedName)) {
                    if (!this.isSafeUrl(value, normalizedName === 'src' || normalizedName === 'poster')) {
                        node.removeAttr(name);
                    }
                }
            }
        });

        $('style').each((_index, element) => {
            $(element).text(this.sanitizeCss($(element).html() ?? '', trustedImageUrls));
        });
        $('input, textarea, select').remove();

        $('form').each((_index, element) => {
            const form = $(element);
            if (form.attr('data-store-entry') !== undefined) {
                return;
            }
            form.replaceWith(form.contents());
        });
    }

    private applyBindings($: ReturnType<typeof load>, bindings: StorefrontPromotionBindings): void {
        $('[data-bind-empty]').each((_index, element) => {
            const node = $(element);
            const key = node.attr('data-bind-empty') as keyof StorefrontPromotionBindings | undefined;
            if (key && bindings[key]) node.remove();
        });
        $('[data-bind-visible]').each((_index, element) => {
            const node = $(element);
            const key = node.attr('data-bind-visible') as keyof StorefrontPromotionBindings | undefined;
            if (!key || !bindings[key]) node.remove();
        });
        $('[data-bind-text]').each((_index, element) => {
            const node = $(element);
            const key = node.attr('data-bind-text') as keyof StorefrontPromotionBindings | undefined;
            const value = key ? bindings[key] : undefined;
            if (value == null) return;
            if (!value && node.attr('data-hide-if-empty') !== undefined) {
                node.remove();
            } else {
                node.text(value);
            }
        });
        $('[data-bind-src]').each((_index, element) => {
            const node = $(element);
            const key = node.attr('data-bind-src') as keyof StorefrontPromotionBindings | undefined;
            const value = key ? bindings[key] : undefined;
            if (!value && node.attr('data-hide-if-empty') !== undefined) {
                node.remove();
            } else if (value && this.isSafeUrl(value, true)) {
                node.attr('src', value);
            }
        });
        $('[data-bind-background]').each((_index, element) => {
            const node = $(element);
            const key = node.attr('data-bind-background') as keyof StorefrontPromotionBindings | undefined;
            const value = key ? bindings[key] : undefined;
            if (!value && node.attr('data-hide-if-empty') !== undefined) {
                node.remove();
            } else if (value && this.isSafeUrl(value, true)) {
                const current = this.sanitizeCss(node.attr('style') ?? '');
                node.attr('style', `${current};background-image:url("${value.replace(/["\\]/g, '')}")`);
            }
        });
        $('[data-bind-entry-product]').each((_index, element) => {
            const node = $(element);
            const key = node.attr('data-bind-entry-product') as keyof StorefrontPromotionBindings | undefined;
            const productId = key ? bindings[key] : '';
            node.attr('data-store-entry-target', normalizePromotionEntryDestination(`product:${productId}`));
            node.removeAttr('data-bind-entry-product');
        });
    }

    private normalizeEntryForm($: ReturnType<typeof load>, entryTicket: string, entryLabel: string): void {
        let forms = $('form[data-store-entry]');
        if (forms.length === 0) {
            $('body').append(FALLBACK_ENTRY_FORM);
            forms = $('form[data-store-entry]');
        }
        forms.each((_index, element) => {
            const form = $(element);
            const destination = normalizePromotionEntryDestination(form.attr('data-store-entry-target'));
            form.attr('method', 'post');
            form.attr('action', '/promo/enter');
            form.removeAttr('target');
            if (form.find('input[name="ticket"]').length === 0) {
                form.prepend(`<input type="hidden" name="ticket" value="${this.escapeHtml(entryTicket)}">`);
            }
            if (destination !== 'home') {
                form.prepend(
                    `<input type="hidden" name="destination" value="${this.escapeHtml(destination)}">`,
                );
            }
            if (form.find('button[type="submit"], input[type="submit"]').length === 0) {
                form.append(`<button type="submit">${this.escapeHtml(entryLabel)}</button>`);
            }
        });
    }

    private normalizeImages($: ReturnType<typeof load>, trustedImageUrls: ReadonlySet<string>): void {
        $('img').each((_index, element) => {
            const image = $(element);
            const source = image.attr('src');
            if (!source) return;
            const safeSource = this.storefrontImageUrl(source, trustedImageUrls.has(source));
            if (!safeSource) {
                image.remove();
                return;
            }
            image.attr('src', safeSource);
            image.removeAttr('srcset');
        });
    }

    private normalizeHead(
        $: ReturnType<typeof load>,
        bindings: StorefrontPromotionBindings,
        canonicalUrl?: string | null,
    ): void {
        $('html').attr('lang', bindings['store.language'] || 'en');
        if ($('head').length === 0) {
            $('html').prepend('<head></head>');
        }
        if ($('meta[charset]').length === 0) {
            $('head').prepend('<meta charset="utf-8">');
        }
        $('meta[name="viewport"]').remove();
        $('head').append('<meta name="viewport" content="width=device-width, initial-scale=1">');
        $('style[data-storefront-promotion-accessibility]').remove();
        $('head').append(PROMOTION_ACCESSIBILITY_STYLE);
        $('meta[name="robots"]').remove();
        $('head').append('<meta name="robots" content="index,nofollow,max-image-preview:large">');
        if ($('title').length === 0) {
            $('head').append(`<title>${this.escapeHtml(bindings['store.name'])}</title>`);
        }
        const logoUrl = this.storefrontImageUrl(bindings['store.logoUrl'], true);
        if (logoUrl) {
            $('link[rel~="icon"], link[rel="apple-touch-icon"]').remove();
            const escapedLogoUrl = this.escapeHtml(logoUrl);
            $('head').append(`<link rel="icon" href="${escapedLogoUrl}">`);
            $('head').append(`<link rel="apple-touch-icon" href="${escapedLogoUrl}">`);
        }
        const shareImageUrl = this.storefrontImageUrl(bindings['store.shareImageUrl'] ?? '', true);
        if (shareImageUrl) {
            $('meta[property="og:image"], meta[name="twitter:image"]').remove();
            const escapedShareImageUrl = this.escapeHtml(shareImageUrl);
            $('head').append(`<meta property="og:image" content="${escapedShareImageUrl}">`);
            $('head').append(`<meta name="twitter:image" content="${escapedShareImageUrl}">`);
        }
        const shareTitle = bindings['store.shareTitle']?.trim();
        if (shareTitle) {
            $('meta[property="og:title"], meta[name="twitter:title"]').remove();
            const escapedShareTitle = this.escapeHtml(shareTitle);
            $('head').append(`<meta property="og:title" content="${escapedShareTitle}">`);
            $('head').append(`<meta name="twitter:title" content="${escapedShareTitle}">`);
        }
        const shareDescription = bindings['store.shareDescription']?.trim();
        if (shareDescription) {
            $('meta[property="og:description"], meta[name="twitter:description"]').remove();
            const escapedShareDescription = this.escapeHtml(shareDescription);
            $('head').append(`<meta property="og:description" content="${escapedShareDescription}">`);
            $('head').append(`<meta name="twitter:description" content="${escapedShareDescription}">`);
        }
        $('link[rel="canonical"]').remove();
        if (canonicalUrl && this.isSafeUrl(canonicalUrl, false)) {
            $('head').append(`<link rel="canonical" href="${this.escapeHtml(canonicalUrl)}">`);
        }
    }

    private appendTrustedVisualScript($: ReturnType<typeof load>): void {
        if ($('[data-promo-motion]').length === 0) return;
        $('script[data-storefront-promotion-visual]').remove();
        const script = $('<script data-storefront-promotion-visual></script>');
        script.text(PROMOTION_VISUAL_SCRIPT);
        $('body').append(script);
    }

    private replaceTokens(source: string, bindings: StorefrontPromotionBindings): string {
        const copy = this.getPromotionCopy(bindings);
        return source.replace(
            /{{\s*(store\.(?:name|description|logoUrl|heroImageUrl|shareImageUrl|shareTitle|shareDescription|currentYear|language)|promo\.[a-zA-Z0-9]+)\s*}}/g,
            (match, key: string) => {
                if (key.startsWith('promo.')) {
                    const copyKey = key.slice('promo.'.length) as PromotionCopyKey;
                    const value = copy[copyKey];
                    return value === undefined ? match : this.escapeHtml(value);
                }
                return this.escapeHtml(bindings[key as keyof StorefrontPromotionBindings] ?? '');
            },
        );
    }

    private getPromotionCopy(
        bindings: StorefrontPromotionBindings,
    ): Readonly<Record<PromotionCopyKey, string>> {
        const language = String(bindings['store.language']).toLowerCase().startsWith('en') ? 'en' : 'zh';
        return PROMOTION_COPY[language];
    }

    private sanitizeCss(value: string, trustedImageUrls: ReadonlySet<string> = new Set()): string {
        return value
            .replace(/@import\s+[^;]+;?/gi, '')
            .replace(/expression\s*\([^)]*\)/gi, '')
            .replace(/(?:javascript|vbscript)\s*:/gi, '')
            .replace(/data\s*:\s*text\/html/gi, '')
            .replace(/(?:behavior|-moz-binding)\s*:[^;}]+[;}]?/gi, '')
            .replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi, (_match, _quote: string, source: string) => {
                const safeSource = this.storefrontImageUrl(source, trustedImageUrls.has(source));
                return safeSource ? `url("${safeSource.replace(/["\\]/g, '')}")` : 'none';
            });
    }

    private storefrontImageUrl(value: string, allowAbsoluteAsset = false): string | null {
        const normalized = value.trim();
        if (!normalized) return null;
        if (/^(?:https?:)?\/\//i.test(normalized)) {
            if (!allowAbsoluteAsset) return null;
            try {
                const absoluteUrl = new URL(normalized);
                if (!absoluteUrl.pathname.includes('/assets/')) return null;
            } catch {
                return null;
            }
        }
        let url: URL;
        try {
            url = new URL(normalized, 'https://storefront.invalid');
        } catch {
            return null;
        }
        if (url.pathname.includes('/assets/')) {
            if (url.pathname.toLowerCase().endsWith('.svg')) {
                const isAbsoluteSvg = /^[a-z][a-z\d+.-]*:/i.test(normalized) || normalized.startsWith('//');
                return isAbsoluteSvg ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
            }
            if (!url.searchParams.has('preset')) {
                url.searchParams.set('preset', 'storefront-original-preview');
            }
            url.searchParams.set('format', 'webp');
            url.searchParams.set('q', '75');
            const isAbsoluteAsset = /^[a-z][a-z\d+.-]*:/i.test(normalized) || normalized.startsWith('//');
            return isAbsoluteAsset ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
        }
        if (!/^(?:https?:)?\/\//i.test(normalized) && /\.(?:svg|webp)$/i.test(url.pathname)) {
            return `${url.pathname}${url.search}${url.hash}`;
        }
        return null;
    }

    private isSafeUrl(value: string, allowDataImage: boolean): boolean {
        const normalized = value
            .trim()
            .replace(/[\u0000-\u001f\u007f\s]+/g, '')
            .toLowerCase();
        if (
            !normalized ||
            normalized.startsWith('#') ||
            normalized.startsWith('/') ||
            normalized.startsWith('./') ||
            normalized.startsWith('../')
        ) {
            return true;
        }
        if (allowDataImage && /^data:image\/(?:png|gif|jpe?g|webp);base64,/.test(normalized)) {
            return true;
        }
        return (
            normalized.startsWith('https://') ||
            normalized.startsWith('http://') ||
            normalized.startsWith('mailto:') ||
            normalized.startsWith('tel:')
        );
    }

    private escapeHtml(value: string): string {
        return value.replace(/[&<>"']/g, character => {
            const entities: Record<string, string> = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;',
            };
            return entities[character];
        });
    }
}
