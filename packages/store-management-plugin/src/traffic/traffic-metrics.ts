export const TRAFFIC_TIMEZONE = 'Asia/Shanghai';

export interface TrafficVisitorGroup {
    businessDate: string;
    visitorKeyHash: string;
    customerKeyHash: string | null;
    pageViewCount: number | string;
}

export interface TrafficIpGroup {
    businessDate: string;
    ipCount: number | string;
    missingIpCount: number | string;
}

export interface TrafficDay {
    businessDate: string;
    visitorCount: number | null;
    pageViewCount: number | null;
    ipCount: number | null;
}

export function trafficBusinessDate(date = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: TRAFFIC_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date);
}

export function trafficDateRange(days: number, today = trafficBusinessDate()): string[] {
    const end = new Date(`${today}T00:00:00Z`).getTime();
    return Array.from({ length: days }, (_, index) =>
        new Date(end - (days - 1 - index) * 86_400_000).toISOString().slice(0, 10),
    );
}

/** Keep anonymous views linked to a same-day login without mistaking page views for people. */
export function summarizeTraffic(
    dates: string[],
    visitorGroups: TrafficVisitorGroup[],
    ipGroups: TrafficIpGroup[],
): TrafficDay[] {
    const groupsByDate = new Map<string, TrafficVisitorGroup[]>();
    for (const group of visitorGroups) {
        const groups = groupsByDate.get(group.businessDate) ?? [];
        groups.push(group);
        groupsByDate.set(group.businessDate, groups);
    }
    const ipsByDate = new Map(ipGroups.map(group => [group.businessDate, group]));
    return dates.map(businessDate => {
        const groups = groupsByDate.get(businessDate);
        if (!groups?.length) return { businessDate, visitorCount: null, pageViewCount: null, ipCount: null };
        const identifiedDevices = new Set(
            groups.filter(group => group.customerKeyHash).map(group => group.visitorKeyHash),
        );
        const visitors = new Set<string>();
        let pageViewCount = 0;
        for (const group of groups) {
            pageViewCount += Number(group.pageViewCount);
            if (group.customerKeyHash) visitors.add(`customer:${group.customerKeyHash}`);
            else if (!identifiedDevices.has(group.visitorKeyHash))
                visitors.add(`visitor:${group.visitorKeyHash}`);
        }
        const ips = ipsByDate.get(businessDate);
        return {
            businessDate,
            visitorCount: visitors.size,
            pageViewCount,
            ipCount: ips && Number(ips.missingIpCount) === 0 ? Number(ips.ipCount) : null,
        };
    });
}
