/** Local editorial records for the synthetic sources in the queue tests. */
export function fixtureNewsReview(url: string) {
    const quotes: Record<string, string> = {
        'https://openai.com/news/synthetic-fixture':
            'This is synthetic source evidence for a test, not real news.',
        'https://openai.com/news/rss-fixture':
            'Synthetic official feed summary with enough concrete evidence',
        'https://openai.com/news/fixture-1': 'Only synthetic test evidence.',
        'https://openai.com/news/fixture-2': 'Only synthetic test evidence.',
    };
    if (!quotes[url]) return undefined;
    return {
        zh: {
            title: '测试公告介绍资料的适用范围',
            summary: '这份合成资料用于测试新闻编辑流程，文中没有发布实际产品。',
            body: '## 消息内容\n这份资料是为测试编辑流程专门准备的合成来源。正文记录的是测试材料自身的用途，不含对实际产品的发布、性能或价格声明。\n\n## 谁会用到\n本次记录供验证采集与编辑流程的人员使用，帮助确认两种语言的正文及来源能作为同一条记录保存。',
            seoDescription: '测试材料仅用于本地编辑流程验证。',
            tags: ['测试资料'],
        },
        en: {
            title: 'The test announcement explains the purpose of the sample',
            summary: 'This synthetic source is used to exercise the editorial workflow.',
            body: '## What the source says\nThe statement is synthetic material for a local editorial test. It does not announce a product release or a price change.',
            seoDescription: 'Synthetic material for the editorial workflow.',
            tags: ['Test material'],
        },
        facts: [{ text: '资料明确标明是测试材料。', sourceUrl: url, quote: quotes[url] }],
    };
}
