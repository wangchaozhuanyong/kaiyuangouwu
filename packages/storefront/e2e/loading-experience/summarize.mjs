/** Summarize already captured CUA frame traces; does not start or control a browser. */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
for (const label of process.argv.slice(2)) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/u.test(label)) throw new Error('Invalid evidence label');
    const directory = path.join(project, 'docs/local-validation/soft-loading-release-20261028', label);
    const reports = [];
    for (const file of (await readdir(directory)).filter(name => /^\d.*\.json$/u.test(name)).sort()) {
        const report = JSON.parse(await readFile(path.join(directory, file), 'utf8'));
        const { samples } = report;
        const animations = new Map();
        for (const frame of samples)
            for (const animation of frame.reveals) {
                const previous = animations.get(animation.id);
                animations.set(animation.id, {
                    id: animation.id,
                    target: animation.target,
                    duration: animation.duration ?? null,
                    delay: animation.delay ?? null,
                    firstAt: previous?.firstAt ?? frame.at,
                    lastAt: frame.at,
                    maxCurrentTime: Math.max(previous?.maxCurrentTime ?? 0, animation.time),
                });
            }
        let cls = 0;
        let session = 0;
        let sessionStart = 0;
        let previousShift = -Infinity;
        for (const shift of report.shifts.filter(item => !item.hadRecentInput)) {
            if (shift.at - previousShift > 1000 || shift.at - sessionStart > 5000) {
                session = 0;
                sessionStart = shift.at;
            }
            session += shift.value;
            previousShift = shift.at;
            cls = Math.max(cls, session);
        }
        const round = n => Math.round(n * 10000) / 10000;
        const geometry = Object.fromEntries(
            Object.keys(samples[0]?.geometry ?? {}).map(name => {
                const boxes = samples
                    .filter(frame => frame.geometry[name])
                    .map(frame => {
                        const [x, y, width, height] = frame.geometry[name];
                        return [x, y + frame.scrollY, width, height];
                    });
                return [
                    name,
                    boxes.length
                        ? {
                              count: boxes.length,
                              documentRectRanges: [0, 1, 2, 3].map(i => [
                                  round(Math.min(...boxes.map(b => b[i]))),
                                  round(Math.max(...boxes.map(b => b[i]))),
                              ]),
                          }
                        : null,
                ];
            }),
        );
        reports.push({
            file,
            case: report.case,
            width: report.viewport.width,
            navigationType: report.navigationType,
            samples: samples.length,
            reducedMotion: report.reducedMotion,
            cls: round(cls),
            firstContent: samples.find(frame => frame.geometry.home)?.at ?? null,
            firstOwned: samples.find(frame => frame.appOwned)?.at ?? null,
            titles: [...new Set(samples.map(frame => frame.title).filter(Boolean))],
            rootReplaced: samples.some(frame => frame.rootSame === false),
            heroReplaced: samples.some(frame => frame.heroSame === false),
            titleReplaced: samples.some(frame => frame.titleSame === false),
            bootFrames: samples.filter(frame => frame.bootVisible).length,
            feedbackFrames: samples.filter(frame => frame.queryFeedback).length,
            feedbackMeasured: samples.some(frame => Object.hasOwn(frame, 'queryFeedback')),
            couponFrames: samples.filter(frame => frame.geometry.coupon).length,
            couponPendingFrames: samples.filter(frame => frame.couponPending === 'true').length,
            scrollRange: [
                Math.min(...samples.map(frame => frame.scrollY)),
                Math.max(...samples.map(frame => frame.scrollY)),
            ],
            scrollEnd: samples.at(-1)?.scrollY,
            events: report.events,
            animations: [...animations.values()],
            couponPresentAtFirstHomeFrame: samples.find(frame => frame.geometry.home)?.couponPresent ?? null,
            couponAppearedAfterFirstHomeFrame:
                samples.find(frame => frame.geometry.home)?.couponPresent === false &&
                samples.some(frame => frame.geometry.home && frame.couponPresent),
            couponPlaceholderFrames: samples.filter(frame => frame.couponPlaceholderCount > 0).length,
            couponNodeReplaced: samples.some(frame => frame.couponSame === false),
            featuredMaxFrameStep: round(
                Math.max(
                    0,
                    ...samples.slice(1).flatMap((frame, index) => {
                        const before = samples[index];
                        if (!frame.geometry.featured || !before.geometry.featured) return [];
                        return [
                            Math.abs(
                                frame.geometry.featured[1] +
                                    frame.scrollY -
                                    before.geometry.featured[1] -
                                    before.scrollY,
                            ),
                        ];
                    }),
                ),
            ),
            finalFeaturedGap: (() => {
                const finalGeometry = samples.at(-1)?.geometry;
                return finalGeometry?.quick && finalGeometry?.featured
                    ? round(finalGeometry.featured[1] - finalGeometry.quick[1] - finalGeometry.quick[3])
                    : null;
            })(),
            errors: report.errors,
            longTasks: report.longTasks,
            geometry,
        });
    }
    await writeFile(path.join(directory, 'summary.json'), JSON.stringify(reports, null, 2));
    process.stdout.write(
        JSON.stringify(
            { label, reports: reports.map(({ geometry, longTasks, ...report }) => report) },
            null,
            2,
        ) + '\n',
    );
}
