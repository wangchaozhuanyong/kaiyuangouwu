import type { ImageAdminModelRecord } from './image-generation.graphql';

type ImageProtocol = ImageAdminModelRecord['protocol'];
type ImageProtocolFamily = 'CODEX' | 'GEMINI';

export interface ImageProtocolOption {
    value: ImageProtocol;
    family: ImageProtocolFamily;
    recommended: boolean;
    label: string;
    description: string;
}

export const imageProtocolOptions: readonly ImageProtocolOption[] = [
    {
        value: 'OPENAI_RESPONSES_IMAGE',
        family: 'CODEX',
        recommended: true,
        label: 'Codex 订阅号中转（推荐）',
        description:
            '适用模型：gpt-image-1、gpt-image-1.5、gpt-image-2。你现在的 Codex 订阅号中转选这个；中转站必须支持 /responses 图片工具，还需配置一个可调用的文本编排模型（例如 gpt-5.4-mini）。图片质量固定为 Medium。',
    },
    {
        value: 'OPENAI_IMAGES',
        family: 'CODEX',
        recommended: false,
        label: 'Codex 官方 API / 按量中转（高级）',
        description:
            '适用模型：gpt-image-1、gpt-image-1.5、gpt-image-2。只有使用官方 API Key，或中转站明确支持 /images/generations 和 /images/edits 时才选；普通订阅号中转不要选。',
    },
    {
        value: 'OPENAI_COMPATIBLE_CHAT',
        family: 'CODEX',
        recommended: false,
        label: 'Codex 聊天生图兼容中转（高级）',
        description:
            '没有通用的固定模型。只有中转站文档明确给出“可返回图片的聊天模型 ID”，并要求调用 /chat/completions 时才选；普通 GPT/Codex 文本模型不能当生图模型使用。',
    },
    {
        value: 'GEMINI_NATIVE_STREAM',
        family: 'GEMINI',
        recommended: true,
        label: 'Gemini 订阅号中转（推荐）',
        description:
            '适用模型：gemini-3.1-flash-image。你现在的 Gemini 订阅号中转选这个；中转站需要支持 streamGenerateContent。流式返回更适合生图，不容易因等待时间过长而超时。',
    },
    {
        value: 'GEMINI_NATIVE',
        family: 'GEMINI',
        recommended: false,
        label: 'Gemini 普通接口（高级，可能超时）',
        description:
            '适用模型：gemini-3.1-flash-image。中转站明确要求使用 generateContent 时才选；它会等待整张图生成后一次返回，生图较慢时可能遇到网关超时。',
    },
    {
        value: 'GEMINI_INTERACTIONS',
        family: 'GEMINI',
        recommended: false,
        label: 'Gemini 特殊兼容接口（高级）',
        description:
            '适用模型：gemini-3.1-flash-image（前提是中转站完成了映射）。只有中转站文档明确提供 /interactions 图片接口时才选；这不是 Google 原生 Gemini 接口。',
    },
] as const;

export function imageProtocolOptionsForModel(
    model: Pick<ImageAdminModelRecord, 'code' | 'officialModelId' | 'providerModelId' | 'protocol'>,
): readonly ImageProtocolOption[] {
    const family = imageProtocolFamily(model);
    const matching = imageProtocolOptions.filter(option => option.family === family);
    if (matching.some(option => option.value === model.protocol)) return matching;
    const current = imageProtocolOptions.find(option => option.value === model.protocol);
    return current ? [current, ...matching] : matching;
}

export function imageProtocolOption(protocol: ImageProtocol): ImageProtocolOption {
    return imageProtocolOptions.find(option => option.value === protocol) ?? imageProtocolOptions[0];
}

function imageProtocolFamily(
    model: Pick<ImageAdminModelRecord, 'code' | 'officialModelId' | 'providerModelId'>,
): ImageProtocolFamily {
    const identifiers = [model.code, model.officialModelId, model.providerModelId]
        .map(value => value.replace(/^models\//iu, '').toLowerCase())
        .join(' ');
    return /(?:^|[\s_-])(?:gemini|imagen)/u.test(identifiers) ? 'GEMINI' : 'CODEX';
}
