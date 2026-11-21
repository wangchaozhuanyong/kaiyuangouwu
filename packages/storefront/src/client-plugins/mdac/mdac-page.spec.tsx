// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { DesktopLayoutContext } from '../../desktop-layout';
import { storefrontQueryKeys } from '../../query-client';

import { type MdacFlight, type MdacFlightLookup, type MdacFlightResult } from './flight-lookup';
import { type MdacFlightService } from './flight-picker';
import { MdacPage } from './mdac-page';
import {
    AIR_TRAVEL,
    disableDraftSaving,
    draftSavingPreference,
    emptyDraft,
    PassportReadError,
    readDraft,
    STORAGE_KEY,
} from './model';
import { readPassport } from './ocr';

vi.mock('./ocr', () => ({ readPassport: vi.fn() }));
vi.mock('../../storefront-ui/page-shell', () => ({
    Subpage: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SubpageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Sheet: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div>,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
    localStorage.clear();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});
afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
});
function button(name: string) {
    const match = [...host.querySelectorAll('button')].find(item => item.textContent === name);
    assert.ok(match, 'Missing button: ' + name);
    return match;
}

function inputOfType(type: 'checkbox' | 'file') {
    const input = host.querySelector<HTMLInputElement>(`[type=${type}]`);
    assert.ok(input, 'Missing input: ' + type);
    return input;
}

let queryClient: QueryClient;
beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
const render = (language: 'zh' | 'en' = 'zh', desktop = false, flightService?: MdacFlightService) =>
    act(() =>
        root.render(
            <QueryClientProvider client={queryClient}>
                <DesktopLayoutContext.Provider value={desktop}>
                    <MdacPage language={language} onBack={() => undefined} flightService={flightService} />
                </DesktopLayoutContext.Provider>
            </QueryClientProvider>,
        ),
    );

const sampleTraveler = {
    name: 'SAMPLE TRAVELER',
    passNo: 'E00000001',
    nationality: 'CHN',
    pob: 'CHN',
    dob: '1990-01-01',
    sex: '1',
    passExpDte: '2034-01-01',
};
const sampleHotel = {
    id: 'sample',
    name: 'Sample Hotel',
    address: '99 Sample Avenue',
    state: '14',
    city: 'KUALA LUMPUR',
    postcode: '50450',
};
const directoryKey = ['mdac-hotel-directory', 1];

it('keeps the traveler selected from More visible and removes that traveler when requested', () => {
    const draft = emptyDraft();
    draft.travelers = Array.from({ length: 6 }, (_, index) => ({
        ...sampleTraveler,
        passNo: 'E0000000' + (index + 1),
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    render('zh', true);

    const visibleTravelers = () => [...host.querySelectorAll('.mdac-traveler-choice')];
    const more = host.querySelector<HTMLSelectElement>('.mdac-traveler-overflow select');
    assert.ok(more);
    expect(visibleTravelers()).toHaveLength(3);
    expect([...more.options].map(option => option.value)).toEqual(['', '3', '4', '5']);

    act(() => {
        more.value = '5';
        more.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(visibleTravelers()[2].querySelector<HTMLInputElement>('input')?.checked).toBe(true);
    expect(visibleTravelers()[2].textContent).toContain('旅客 6');
    expect(host.querySelector<HTMLInputElement>('[data-field="passNo"] input')?.value).toBe('E00000006');
    expect([...more.options].map(option => option.value)).toEqual(['', '2', '3', '4']);
    expect(readDraft()).toEqual(draft);

    act(() => button('移除此旅客').click());
    expect(readDraft()?.travelers).toEqual(draft.travelers.slice(0, 5));
    expect(visibleTravelers()[0].querySelector<HTMLInputElement>('input')?.checked).toBe(true);
});

function lodgingValue(key: string) {
    return host.querySelector<HTMLInputElement | HTMLSelectElement>(
        `[data-field="${key}"] input, [data-field="${key}"] select`,
    )?.value;
}

function replaceInput(input: HTMLInputElement | null, value: string) {
    assert.ok(input);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

function tripDraft(travelMode = '2') {
    const draft = emptyDraft();
    draft.travelers[0] = { ...sampleTraveler };
    Object.assign(draft.shared, {
        email: 'sample@example.com',
        mobile: '1234567890',
        arrDt: '2026-11-22',
        depDt: '2026-11-26',
        vesselNm: 'MH123',
        trvlMode: travelMode,
        accommodationAddress1: sampleHotel.address,
        accommodationState: sampleHotel.state,
        accommodationCity: sampleHotel.city,
        accommodationPostcode: sampleHotel.postcode,
    });
    vi.setSystemTime(new Date('2026-11-21T03:00:00Z'));
    return draft;
}

it('reviews and edits the selected passport when travelers share the same name', () => {
    const draft = tripDraft();
    draft.travelers.push({ ...sampleTraveler, passNo: 'E00000002' });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    render('zh', true);
    const next = () => act(() => button('下一步').click());
    next();
    next();

    const tabs = host.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs).toHaveLength(2);
    act(() => tabs[1].click());
    const passport = () =>
        host.querySelector('[role="tabpanel"] [data-review-field="passNo"] dd')?.textContent;
    expect(passport()).toBe('E00000002');
    act(() => button('修改旅客资料').click());
    expect(document.activeElement).toBe(host.querySelector('[data-field="name"] input'));
    const number = host.querySelector<HTMLInputElement>('[data-field="passNo"] input');
    act(() => replaceInput(number, 'E00000003'));
    next();
    next();
    expect(passport()).toBe('E00000003');
    expect(readDraft()?.travelers[0].passNo).toBe('E00000001');
});

it('keeps an air traveler on the trip step when flight verification is not configured', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tripDraft(AIR_TRAVEL)));
    render();
    act(() => button('下一步').click());
    act(() => button('下一步').click());
    expect(host.querySelector('h1')?.textContent).toBe('行程与联系');
    expect(host.querySelector('.mdac-message, [role="alert"]')?.textContent).toMatch(/航班.*核验|核验.*航班/);
});

const sampleFlight: MdacFlight = {
    flightNumber: 'MH123',
    operatingFlightNumber: null,
    departureAirport: 'SIN',
    arrivalAirport: 'KUL',
    scheduledArrivalDate: '2026-11-22',
    scheduledArrivalTime: '12:00',
    effectiveArrivalDate: '2026-11-22',
    effectiveArrivalTime: '12:00',
    status: 'SCHEDULED',
};

function openAirTrip(result: MdacFlightResult, flightNumber = sampleFlight.flightNumber) {
    const draft = tripDraft(AIR_TRAVEL);
    draft.shared.vesselNm = flightNumber;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    const lookup = vi.fn<MdacFlightLookup>().mockResolvedValue(result);
    render('zh', true, { marketKey: 'flight-fixture', lookup });
    act(() => button('下一步').click());
    act(() => replaceInput(host.querySelector<HTMLInputElement>('.mdac-flight-picker input[list]'), 'KUL'));
    return lookup;
}

async function searchAirTrip(flightNumber = sampleFlight.flightNumber) {
    act(() => button('查找航班').click());
    const key = storefrontQueryKeys.mdacFlights('flight-fixture', 'zh', {
        arrivalDate: sampleFlight.effectiveArrivalDate,
        arrivalAirport: 'KUL',
        flightNumber,
    });
    await act(async () => {
        await vi.waitFor(() => expect(queryClient.getQueryState(key)?.status).toBe('success'));
    });
}

function selectFlightResult() {
    const result = host.querySelector<HTMLButtonElement>('.mdac-flight-results button');
    assert.ok(result);
    expect(result.textContent).toContain(sampleFlight.flightNumber);
    act(() => result.click());
}

it('requires a flight identifier in ticket format before advancing an air trip', () => {
    const lookup = openAirTrip({ status: 'MATCHED', flights: [sampleFlight] }, 'INVALID');
    expect(button('查找航班').disabled).toBe(true);
    act(() => button('下一步').click());
    expect(host.querySelector('h1')?.textContent).toBe('行程与联系');
    expect(host.querySelector('.mdac-message, [role="alert"]')?.textContent).toContain('航班号');
    expect(lookup).not.toHaveBeenCalled();
});

it('rejects an unverified flight and advances only after a matching result is selected', async () => {
    const lookup = openAirTrip({ status: 'MATCHED', flights: [sampleFlight] });
    await searchAirTrip();
    expect(lookup).toHaveBeenCalledWith(
        { arrivalDate: sampleFlight.effectiveArrivalDate, arrivalAirport: 'KUL', flightNumber: 'MH123' },
        expect.any(AbortSignal),
    );
    act(() => button('下一步').click());
    expect(host.querySelector('h1')?.textContent).toBe('行程与联系');
    selectFlightResult();
    act(() => button('下一步').click());
    expect(host.querySelector('h1')?.textContent).toBe('核对资料');
    expect(host.textContent).toContain('已核验抵达航班');
});

it('keeps an air trip with no matching result on the trip step', async () => {
    openAirTrip({ status: 'NO_MATCH', flights: [] }, 'MH321');
    await searchAirTrip('MH321');
    expect(host.querySelector('.mdac-flight-picker [role="status"]')?.textContent).toContain('未找到该航班');
    act(() => button('下一步').click());
    expect(host.querySelector('h1')?.textContent).toBe('行程与联系');
});

it.each([
    { status: 'CANCELLED' },
    { effectiveArrivalDate: '2026-11-23' },
    { arrivalAirport: 'PEN' },
    { flightNumber: 'MH321' },
] satisfies Array<Partial<MdacFlight>>)('rejects an unusable flight result with %o', async invalid => {
    openAirTrip({ status: 'MATCHED', flights: [{ ...sampleFlight, ...invalid }] });
    await searchAirTrip();
    const result = host.querySelector<HTMLButtonElement>('.mdac-flight-results button:not(:disabled)');
    expect(result).toBeNull();
    expect(host.querySelector('.mdac-flight-confirmed')).toBeNull();
    act(() => button('下一步').click());
    expect(host.querySelector('h1')?.textContent).toBe('行程与联系');
});

it.each([
    ['[data-field="arrDt"] input', '2026-11-23'],
    ['.mdac-flight-picker input[list]', 'PEN'],
    ['[data-field="vesselNm"] input', 'MH321'],
])('invalidates a selected flight when %s changes', async (selector, value) => {
    openAirTrip({ status: 'MATCHED', flights: [sampleFlight] });
    await searchAirTrip();
    selectFlightResult();
    expect(host.querySelector('.mdac-flight-confirmed')).not.toBeNull();
    act(() => replaceInput(host.querySelector<HTMLInputElement>(selector), value));
    expect(host.querySelector('.mdac-flight-confirmed')).toBeNull();
    act(() => button('下一步').click());
    expect(host.querySelector('h1')?.textContent).toBe('行程与联系');
});

it.each(['2', '3'])('allows non-air travel mode %s to reach review without a flight lookup', travelMode => {
    const draft = tripDraft(travelMode);
    draft.shared.vesselNm = 'LAND TRANSPORT';
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    render();
    act(() => button('下一步').click());
    act(() => button('下一步').click());
    expect(host.querySelector('h1')?.textContent).toBe('核对资料');
    expect(readDraft()?.shared.vesselNm).toBe('LAND TRANSPORT');
});

it('updates the calculated departure date from an older draft and after reopening a new draft', () => {
    const draft = tripDraft();
    Object.assign(draft.shared, { arrDt: '2026-10-02', depDt: '2026-10-31' });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    const arrival = () => host.querySelector<HTMLInputElement>('[data-field="arrDt"] input');
    const departure = () => host.querySelector<HTMLInputElement>('[data-field="depDt"] input');

    render();
    act(() => button('下一步').click());
    act(() => replaceInput(arrival(), '2026-12-20'));
    expect(departure()?.value).toBe('2027-01-18');
    expect(readDraft()).toMatchObject({ departureSource: 'suggested' });

    act(() => root.unmount());
    root = createRoot(host);
    render();
    act(() => button('下一步').click());
    act(() => replaceInput(arrival(), '2026-12-21'));
    expect(departure()?.value).toBe('2027-01-19');
    expect(readDraft()?.shared.depDt).toBe('2027-01-19');
});

it('fills the missing departure date for a restored arrival date', () => {
    const draft = tripDraft();
    delete draft.shared.depDt;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    render();
    act(() => button('下一步').click());
    expect(host.querySelector<HTMLInputElement>('[data-field="depDt"] input')?.value).toBe('2026-12-21');
    expect(readDraft()).toEqual(draft);
});

it('preserves a departure entered manually even when it equals the old suggestion', () => {
    const draft = tripDraft();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    const departure = () => host.querySelector<HTMLInputElement>('[data-field="depDt"] input');
    render();
    act(() => button('下一步').click());
    act(() => replaceInput(departure(), '2026-12-21'));
    expect(readDraft()).toMatchObject({ departureSource: 'manual' });

    act(() => root.unmount());
    root = createRoot(host);
    render();
    act(() => button('下一步').click());
    act(() => replaceInput(host.querySelector('[data-field="arrDt"] input'), '2026-11-23'));
    expect(departure()?.value).toBe('2026-12-21');
    expect(host.querySelector('[data-field="depDt"] [role="status"]')?.textContent).toContain('请重新核对');
});

it.each([
    ['arrDt', '2026-11-20', '2026-11-22', '抵达日期已过'],
    ['depDt', '2026-11-21', '2026-11-26', '离境日期不能早于抵达日期'],
])('keeps an invalid %s on the trip step and advances after correction', (key, invalid, correct, text) => {
    const draft = tripDraft();
    draft.shared[key] = invalid;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    render();
    act(() => button('下一步').click());
    act(() => button('下一步').click());
    expect(host.querySelector('h1')?.textContent).toBe('行程与联系');
    const input = host.querySelector<HTMLInputElement>(`[data-field="${key}"] input`);
    expect(document.activeElement).toBe(input);
    expect(input?.getAttribute('aria-invalid')).toBe('true');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(text);

    act(() => replaceInput(input, correct));
    expect(input?.hasAttribute('aria-invalid')).toBe(false);
    act(() => button('下一步').click());
    expect(host.querySelector('h1')?.textContent).toBe('核对资料');
});

it('checks a missing passport field for another traveler before leaving the first step', () => {
    const draft = tripDraft();
    draft.travelers.push({ ...sampleTraveler, name: 'SECOND TRAVELER', passNo: '' });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    render();
    act(() => button('下一步').click());
    expect(host.querySelector('h1')?.textContent).toBe('护照资料');
    const input = host.querySelector<HTMLInputElement>('[data-field="passNo"] input');
    expect(input?.value).toBe('');
    expect(document.activeElement).toBe(input);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('旅客 2 的护照号码');
    act(() => replaceInput(input, 'E00000002'));
    act(() => button('下一步').click());
    expect(host.querySelector('h1')?.textContent).toBe('行程与联系');
    expect(readDraft()?.travelers[0].passNo).toBe(sampleTraveler.passNo);
    expect(readDraft()?.travelers[1].passNo).toBe('E00000002');
});

it('keeps a passport expiry conflict on the trip step and opens the specific passport field on request', () => {
    const draft = tripDraft();
    draft.travelers[0].passExpDte = draft.shared.arrDt;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    render();
    act(() => button('下一步').click());
    act(() => button('下一步').click());
    expect(host.querySelector('h1')?.textContent).toBe('行程与联系');
    expect(document.activeElement).toBe(host.querySelector('[data-field="arrDt"] input'));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('护照到期日必须晚于抵达日期');
    act(() => button('修改旅客 1 的护照到期日').click());
    expect(host.querySelector('h1')?.textContent).toBe('护照资料');
    const expiry = host.querySelector<HTMLInputElement>('[data-field="passExpDte"] input');
    expect(document.activeElement).toBe(expiry);
    act(() => replaceInput(expiry, sampleTraveler.passExpDte));
    act(() => button('下一步').click());
    act(() => button('下一步').click());
    expect(host.querySelector('h1')?.textContent).toBe('核对资料');
});

it('fills a hotel when an existing draft has blank lodging fields and keeps the suggestion when returning', async () => {
    const draft = emptyDraft();
    draft.travelers[0] = sampleTraveler;
    Object.assign(draft.shared, {
        accommodationAddress1: '',
        accommodationAddress2: ' ',
        accommodationState: '',
        accommodationCity: '',
        accommodationPostcode: '',
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    queryClient.setQueryData(directoryKey, [sampleHotel]);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json([sampleHotel]));
    const selectRandom = vi.spyOn(Math, 'random').mockReturnValue(0);

    render();
    await act(() => Promise.resolve(button('下一步').click()));
    expect(lodgingValue('accommodationAddress1')).toBe(sampleHotel.address);
    expect(lodgingValue('accommodationState')).toBe(sampleHotel.state);
    expect(lodgingValue('accommodationCity')).toBe(sampleHotel.city);
    expect(lodgingValue('accommodationPostcode')).toBe(sampleHotel.postcode);
    expect(readDraft()).toEqual(draft);

    selectRandom.mockClear();
    act(() => button('上一步').click());
    act(() => button('下一步').click());
    expect(lodgingValue('accommodationAddress1')).toBe(sampleHotel.address);
    expect(selectRandom).not.toHaveBeenCalled();
});

it('fills the default while a search is open and replaces all fields with the selected hotel', async () => {
    const draft = emptyDraft();
    draft.travelers[0] = sampleTraveler;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    const bookedHotel = {
        id: 'booked',
        name: 'Taman Connaught Hotel',
        address: '17 Jalan Menara Gading',
        address2: 'Lobby A',
        state: '10',
        city: 'CHERAS',
        postcode: '56000',
    };
    let deliver!: (response: Response) => void;
    const fetchDirectory = vi.spyOn(globalThis, 'fetch').mockImplementation(
        () =>
            new Promise(resolve => {
                deliver = resolve;
            }),
    );
    vi.spyOn(Math, 'random').mockReturnValue(0);

    render('en');
    act(() => button('Next').click());
    expect(fetchDirectory).toHaveBeenCalledWith('/mdac/hotels.json', expect.anything());
    act(() => replaceInput(host.querySelector('[type=search]'), '56000, ConnAUG'));
    expect(lodgingValue('accommodationAddress1')).toBe('');
    await act(async () => {
        deliver(Response.json([sampleHotel, bookedHotel]));
        await vi.waitFor(() => expect(queryClient.getQueryState(directoryKey)?.status).toBe('success'));
    });
    expect(lodgingValue('accommodationAddress1')).toBe(sampleHotel.address);
    expect(readDraft()).toEqual(draft);

    const result = host.querySelector<HTMLButtonElement>('.mdac-hotel-results button');
    assert.ok(result);
    expect(result.textContent).toContain(bookedHotel.name);
    act(() => result.click());
    expect(lodgingValue('accommodationAddress1')).toBe(bookedHotel.address);
    expect(lodgingValue('accommodationAddress2')).toBe(bookedHotel.address2);
    expect(lodgingValue('accommodationState')).toBe(bookedHotel.state);
    expect(lodgingValue('accommodationCity')).toBe(bookedHotel.city);
    expect(lodgingValue('accommodationPostcode')).toBe(bookedHotel.postcode);
    expect(readDraft()?.shared.accommodationAddress1).toBe(bookedHotel.address);
});

it('leaves manual lodging edits in control even when the automatic address is cleared', async () => {
    const draft = emptyDraft();
    draft.travelers[0] = sampleTraveler;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    queryClient.setQueryData(directoryKey, [sampleHotel]);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json([sampleHotel]));
    render();
    await act(() => Promise.resolve(button('下一步').click()));
    const address = host.querySelector<HTMLInputElement>('[data-field="accommodationAddress1"] input');
    assert.ok(address);
    expect(address.value).toBe(sampleHotel.address);
    // JSDOM matches :autofill on empty inputs, unlike a manual edit in Chromium.
    vi.spyOn(address, 'matches').mockReturnValue(false);

    act(() => replaceInput(address, ''));
    expect(address.value).toBe('');
    expect(lodgingValue('accommodationPostcode')).toBe('');
    act(() => replaceInput(address, 'A real reservation'));
    expect(address.value).toBe('A real reservation');
    expect(readDraft()?.shared.accommodationAddress1).toBe('A real reservation');
    expect(readDraft()?.shared.accommodationPostcode).toBeUndefined();
});

it.each(['restore', 'change stay'] as const)(
    'suggests a complete hotel and preserves an old draft on %s',
    async action => {
        const draft = emptyDraft();
        draft.travelers[0] = sampleTraveler;
        draft.shared.accommodationAddress1 = 'Old draft address';
        draft.shared.accommodationState = '';
        localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
        queryClient.setQueryData(directoryKey, [sampleHotel]);
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json([sampleHotel]));

        render();
        await act(() => Promise.resolve(button('下一步').click()));
        expect(lodgingValue('accommodationAddress1')).toBe(sampleHotel.address);
        expect(lodgingValue('accommodationState')).toBe(sampleHotel.state);
        expect(lodgingValue('accommodationCity')).toBe(sampleHotel.city);
        expect(lodgingValue('accommodationPostcode')).toBe(sampleHotel.postcode);
        expect(readDraft()).toEqual(draft);

        if (action === 'restore') {
            act(() => button('使用原草稿地址').click());
        } else {
            const stay = host.querySelector<HTMLButtonElement>(
                '[data-field="accommodationStay"] button[aria-haspopup="dialog"]',
            );
            assert.ok(stay);
            act(() => stay.click());
            act(() => button('亲友住所').click());
            expect(readDraft()?.shared.accommodationStay).toBe('02');
        }
        expect(lodgingValue('accommodationAddress1')).toBe(draft.shared.accommodationAddress1);
        expect(readDraft()?.shared.accommodationAddress2).toBe('');
        act(() => root.unmount());
        root = createRoot(host);
        render();
        act(() => button('下一步').click());
        expect(lodgingValue('accommodationAddress1')).toBe(draft.shared.accommodationAddress1);
    },
);

it('saves on first edit, drops only the stored copy on opt-out, and remembers the choice after remount', () => {
    localStorage.setItem('other', 'retained');
    render();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    act(() => button('添加旅客').click());
    expect(readDraft()?.travelers).toHaveLength(2);
    act(() => button('草稿设置').click());
    expect(inputOfType('checkbox').checked).toBe(true);
    act(() => inputOfType('checkbox').click());
    expect(readDraft()).toBeNull();
    expect(host.querySelectorAll('.mdac-travelers option')).toHaveLength(2);
    act(() => root.unmount());
    root = createRoot(host);
    render();
    act(() => button('草稿设置').click());
    expect(inputOfType('checkbox').checked).toBe(false);
    expect(host.querySelectorAll('.mdac-travelers option')).toHaveLength(1);
    act(() => inputOfType('checkbox').click());
    expect(readDraft()?.travelers).toHaveLength(1);
    act(() => button('清除本机资料').click());
    expect(readDraft()).toBeNull();
    expect(draftSavingPreference()).toBe(false);
    expect(localStorage.getItem('other')).toBe('retained');
});

it('preserves edits but stops automatic writes after another tab changes the draft', () => {
    const draft = emptyDraft();
    draft.travelers[0].name = 'TEST NAME';
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    render();
    act(() => {
        localStorage.removeItem(STORAGE_KEY);
        window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
    });
    act(() => button('添加旅客').click());
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(host.querySelector('select')?.textContent).toContain('TEST NAME');
});

it('cancels recognition on clear and does not restore a late result or store the image', async () => {
    let complete!: (value: Record<string, string>) => void;
    vi.mocked(readPassport).mockImplementation(
        () =>
            new Promise(resolve => {
                complete = resolve;
            }),
    );
    render();
    const input = inputOfType('file');
    Object.defineProperty(input, 'files', {
        value: [new File(['synthetic'], 'test.png', { type: 'image/png' })],
    });
    await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await vi.dynamicImportSettled();
    });
    expect(button('识别中…').disabled).toBe(true);
    render('en');
    expect(button('Reading…').disabled).toBe(true);
    act(() => button('Draft settings').click());
    act(() => button('Clear local details').click());
    expect(vi.mocked(readPassport).mock.calls[0][1].aborted).toBe(true);
    await act(() => {
        complete({ name: 'LATE RESULT' });
        return Promise.resolve();
    });
    expect(host.textContent).not.toContain('LATE RESULT');
    expect(readDraft()).toBeNull();
});

it('fills verified fields without saving them and preserves them when a later scan fails', async () => {
    disableDraftSaving();
    vi.mocked(readPassport)
        .mockReset()
        .mockResolvedValueOnce({
            name: 'SYNTHETIC TRAVELER',
            passNo: 'E12345678',
            nationality: 'CHN',
            dob: '1990-01-01',
            sex: '1',
            passExpDte: '2030-01-01',
        })
        .mockRejectedValueOnce(new PassportReadError('recognition'));
    render();
    const input = inputOfType('file');
    Object.defineProperty(input, 'files', {
        value: [new File(['synthetic'], 'test.png', { type: 'image/png' })],
    });
    const upload = () =>
        act(async () => {
            input.dispatchEvent(new Event('change', { bubbles: true }));
            await vi.dynamicImportSettled();
        });
    await upload();
    const filled = () =>
        [
            ...host.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
                '.mdac-fields input, .mdac-fields select',
            ),
        ].map(field => field.value);
    const values = filled();
    expect(values.filter(Boolean)).toHaveLength(6);
    expect(values).toContain('SYNTHETIC TRAVELER');
    expect(host.querySelector('[role=status]')?.textContent).toContain('识别完成');
    expect(readDraft()).toBeNull();
    await upload();
    expect(filled()).toEqual(values);
    expect(host.querySelector('[role=status]')?.textContent).toContain('未能完整识别');
    expect(readDraft()).toBeNull();
});

it('selects the detected birth country while leaving guest data out of storage', async () => {
    disableDraftSaving();
    vi.mocked(readPassport).mockReset().mockResolvedValueOnce({
        name: 'SYNTHETIC TRAVELER',
        passNo: 'E12345678',
        nationality: 'CHN',
        dob: '1990-01-01',
        sex: '1',
        passExpDte: '2030-01-01',
        pob: 'USA',
    });
    render();
    const input = inputOfType('file');
    Object.defineProperty(input, 'files', {
        value: [new File(['synthetic'], 'test.png', { type: 'image/png' })],
    });
    await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await vi.dynamicImportSettled();
    });
    const selects = host.querySelectorAll<HTMLSelectElement>('.mdac-fields select');
    expect(selects[0].value).toBe('CHN');
    expect(selects[1].value).toBe('USA');
    expect(host.querySelector('[role=status]')?.textContent).toContain('已根据护照出生地点匹配');
    expect(readDraft()).toBeNull();
});
