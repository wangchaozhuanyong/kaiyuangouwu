/** Pure summaries; missing measurements stay null instead of becoming a pass or zero. */
export function summarizeReport(report) {
    const samples = report.samples ?? [];
    const geometryMeasured = report.mode === 'geometry' || samples.some(frame => frame.geometry);
    let cls = 0;
    let session = 0;
    let sessionStart = 0;
    let previous = -Infinity;
    for (const entry of (report.shifts ?? []).filter(item => !item.hadRecentInput)) {
        if (entry.at - previous > 1000 || entry.at - sessionStart > 5000) {
            session = 0;
            sessionStart = entry.at;
        }
        session += entry.value;
        previous = entry.at;
        cls = Math.max(cls, session);
    }
    const round = value => Math.round(value * 10000) / 10000;
    const geometry = Object.fromEntries(
        Object.keys(samples.find(frame => frame.geometry)?.geometry ?? {}).map(name => {
            const boxes = samples.flatMap(frame => {
                const rect = frame.geometry?.[name];
                return rect ? [[rect[0], rect[1] + frame.scrollY, rect[2], rect[3]]] : [];
            });
            return [
                name,
                boxes.length
                    ? {
                          count: boxes.length,
                          documentRectRanges: [0, 1, 2, 3].map(index => [
                              round(Math.min(...boxes.map(box => box[index]))),
                              round(Math.max(...boxes.map(box => box[index]))),
                          ]),
                      }
                    : null,
            ];
        }),
    );
    const animations = new Map();
    for (const frame of samples)
        for (const animation of frame.reveals ?? []) {
            const before = animations.get(animation.id);
            animations.set(animation.id, {
                ...animation,
                firstAt: before?.firstAt ?? frame.at,
                lastAt: frame.at,
            });
        }
    const firstHome = samples.find(frame => frame.geometry?.home);
    const imageCandidates = (report.imageHistory ?? []).map(image => {
        const reads = (report.resources ?? []).filter(
            resource => resource.path === image.candidate && ['img', 'link'].includes(resource.initiator),
        );
        const request = reads[0];
        return {
            ...image,
            request: request ?? null,
            completedRequestCount: reads.length,
            requestBeforeViewportMs:
                request && image.firstViewportAt != null
                    ? round(image.firstViewportAt - request.startAt)
                    : null,
            viewportToDrawableMs:
                image.firstViewportAt != null && image.firstDrawableAt != null
                    ? round(Math.max(0, image.firstDrawableAt - image.firstViewportAt))
                    : null,
            requestCaveat: 'ResourceTiming contains completed reads; absent entry is not proof of no request',
            actualPixels: 'unmeasured; consult CUA screenshot sequence',
        };
    });
    const ys = samples.map(frame => frame.scrollY);
    const replaced = key =>
        samples.some(frame => typeof frame[key] === 'boolean')
            ? samples.some(frame => frame[key] === false)
            : null;
    const nativeOwned =
        report.appOwnedAtDocumentTime ??
        report.events?.find(event => event.type === 'storefront:app-owned')?.at ??
        null;
    const firstOwned = nativeOwned ?? samples.find(frame => frame.appOwned)?.at ?? null;
    const fcp = report.paints?.find(paint => paint.name === 'first-contentful-paint')?.at ?? null;
    const longTasksSupported = report.observerSupport?.longtask !== false;
    // Include the ownership task itself and its immediate 100ms handover tail.
    const startupWindowEnd = nativeOwned === null ? null : nativeOwned + 100;
    const startupLongTasks =
        startupWindowEnd === null
            ? null
            : (report.longTasks ?? []).filter(task => task.at <= startupWindowEnd);
    const steadyLongTasks =
        startupWindowEnd === null
            ? null
            : (report.longTasks ?? []).filter(task => task.at > startupWindowEnd);
    return {
        mode: report.mode ?? 'geometry',
        artifactId: report.artifactId ?? null,
        toolsetSha256: report.toolsetSha256 ?? null,
        compression: report.compression ?? 'unrecorded',
        comparability:
            report.artifactId && report.toolsetSha256
                ? 'compare only matching toolset, mode, transport and scenario'
                : 'diagnostic-only: artifact or tool version was not recorded',
        case: report.case,
        width: report.viewport?.width,
        navigationType: report.navigationType,
        samples: samples.length,
        captureDurationMs: report.captureDurationMs ?? null,
        sampleStarted: report.sampleStarted ?? null,
        reducedMotion: report.reducedMotion,
        evidence: report.evidence,
        cls: report.observerSupport?.['layout-shift'] === false ? null : round(cls),
        observerSupport: report.observerSupport ?? null,
        firstContent: samples.find(frame => frame.contentPresent || frame.geometry?.home)?.at ?? null,
        firstContentMeaning: 'sampled DOM presence, not paint; performance mode interval is 500ms',
        fcp,
        firstOwned,
        firstOwnedSource: nativeOwned === null ? 'sampled DOM attribute or unmeasured' : 'app-owned event',
        visibleUnownedGapMs:
            fcp !== null && nativeOwned !== null ? Math.max(0, round(nativeOwned - fcp)) : null,
        startupWindowEnd,
        startupWindowMeaning: 'long tasks starting at or before app-owned event + 100ms; same document clock',
        startupMaxLongTask:
            longTasksSupported && startupLongTasks
                ? Math.max(0, ...startupLongTasks.map(task => task.duration))
                : null,
        steadyLongTasks: longTasksSupported ? steadyLongTasks : null,
        rootReplaced: replaced('rootSame'),
        headerReplaced: geometryMeasured ? replaced('headerSame') : null,
        heroReplaced: geometryMeasured ? replaced('heroSame') : null,
        titleReplaced: geometryMeasured ? replaced('titleSame') : null,
        couponPresentAtFirstHomeFrame: firstHome?.couponPresent ?? null,
        couponAppearedAfterFirstHomeFrame: firstHome
            ? firstHome.couponPresent === false &&
              samples.some(frame => frame.geometry?.home && frame.couponPresent)
            : null,
        couponPlaceholderFrames: geometryMeasured
            ? samples.filter(frame => frame.couponPlaceholderCount > 0).length
            : null,
        scrollRange: ys.length ? [Math.min(...ys), Math.max(...ys)] : null,
        initialScrollY: report.initialScrollY ?? null,
        previousDeparture: report.previousDeparture ?? null,
        scrollEnd: samples.at(-1)?.scrollY ?? null,
        geometryMeasured,
        geometry,
        imageCandidates,
        inputs: report.inputs ?? [],
        markers: report.markers ?? [],
        animations: [...animations.values()],
        events: report.events ?? [],
        errors: report.errors ?? [],
        longTasks: report.longTasks ?? [],
        resources: report.resources ?? [],
        lcp: report.largestPaints?.at(-1)?.at ?? null,
    };
}
