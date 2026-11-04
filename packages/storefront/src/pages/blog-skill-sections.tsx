import {
    BookOpen,
    ClipboardList,
    CornerDownRight,
    ListChecks,
    MessageSquareText,
    Play,
    ShieldCheck,
    Users,
} from 'lucide-react';

import { type blogBodySections } from '../../../storefront-content-plugin/src/shared/news-blog';

type Section = ReturnType<typeof blogBodySections>[number];

const moduleTypes = {
    解决什么问题: 'overview',
    它能做什么: 'overview',
    适合谁: 'overview',
    能完成哪些任务: 'tasks',
    使用示例: 'example',
    典型用法: 'example',
    如何开始: 'start',
    条件与限制: 'limits',
    依赖与限制: 'limits',
} as const;
const icons = {
    overview: BookOpen,
    tasks: ListChecks,
    example: MessageSquareText,
    start: Play,
    limits: ShieldCheck,
    text: BookOpen,
};

function SkillSectionContent({ section, kind }: { section: Section; kind: keyof typeof icons }) {
    const lines = section.paragraphs;
    if (kind === 'tasks' && lines.length && lines.every((line, i) => line.startsWith(`${i + 1}. `))) {
        return (
            <ol className="skill-task-list" role="list">
                {lines.map((line, i) => (
                    <li key={i}>
                        <span className="skill-task-index type-label" aria-hidden="true">
                            {String(i + 1).padStart(2, '0')}
                        </span>
                        <span className="skill-copy">{line.slice(line.indexOf(' ') + 1)}</span>
                    </li>
                ))}
            </ol>
        );
    }
    if (kind === 'example') {
        const input = lines.findIndex(line => line.startsWith('输入需求：'));
        if (input >= 0 && lines[input + 1]?.startsWith('预期输出：')) {
            return (
                <>
                    {lines.slice(0, input).map((line, i) => (
                        <p className="type-helper blog-muted" key={i}>
                            {line}
                        </p>
                    ))}
                    <dl className="skill-example-pair">
                        <div data-icon-tone="security">
                            <dt className="type-label">
                                <ClipboardList aria-hidden="true" />
                                输入需求
                            </dt>
                            <dd className="skill-copy">{lines[input].slice('输入需求：'.length)}</dd>
                        </div>
                        <div data-icon-tone="mail">
                            <dt className="type-label">
                                <CornerDownRight aria-hidden="true" />
                                预期输出
                            </dt>
                            <dd className="skill-copy">{lines[input + 1].slice('预期输出：'.length)}</dd>
                        </div>
                    </dl>
                    {lines.slice(input + 2).map((line, i) => (
                        <p className="skill-copy" key={i}>
                            {line}
                        </p>
                    ))}
                </>
            );
        }
    }
    return lines.map((line, i) =>
        kind === 'overview' && line.startsWith('适合：') ? (
            <p className="skill-audience type-body" key={i}>
                <Users aria-hidden="true" />
                <strong>适合谁</strong>
                <span>{line.slice('适合：'.length)}</span>
            </p>
        ) : (
            <p className="skill-copy" key={i}>
                {line}
            </p>
        ),
    );
}

export function BlogSkillSections({ sections }: { sections: Section[] }) {
    return (
        <div className="skill-modules">
            {sections.map(section => {
                const kind = Object.hasOwn(moduleTypes, section.title)
                    ? moduleTypes[section.title as keyof typeof moduleTypes]
                    : 'text';
                const Icon = icons[kind];
                return (
                    <section key={section.id} id={section.id} className="skill-module" data-kind={kind}>
                        {section.title && (
                            <h2 className="type-section">
                                <Icon aria-hidden="true" />
                                {section.title}
                            </h2>
                        )}
                        <SkillSectionContent section={section} kind={kind} />
                    </section>
                );
            })}
        </div>
    );
}
