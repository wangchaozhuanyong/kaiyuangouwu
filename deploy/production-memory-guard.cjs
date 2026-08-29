#!/usr/bin/env node

'use strict';

const fs = require('node:fs');

const DEFAULT_MINIMUM_AVAILABLE_MIB = 384;
const DEFAULT_MINIMUM_AVAILABLE_PERCENT = 12.5;

function parseMeminfo(contents) {
    const values = new Map();
    for (const line of contents.split('\n')) {
        const match = /^(?<name>[A-Za-z_()]+):\s+(?<value>\d+)\s+kB$/u.exec(line.trim());
        if (match?.groups) values.set(match.groups.name, Number(match.groups.value));
    }

    const totalKib = values.get('MemTotal');
    const availableKib = values.get('MemAvailable');
    if (!Number.isFinite(totalKib) || !Number.isFinite(availableKib) || totalKib <= 0) {
        throw new Error('/proc/meminfo is missing MemTotal or MemAvailable');
    }

    return {
        totalKib,
        availableKib,
        swapFreeKib: values.get('SwapFree') ?? 0,
    };
}

function evaluateMemory(
    memory,
    minimumAvailableMib = DEFAULT_MINIMUM_AVAILABLE_MIB,
    minimumAvailablePercent = DEFAULT_MINIMUM_AVAILABLE_PERCENT,
) {
    const absoluteMinimumKib = minimumAvailableMib * 1024;
    const proportionalMinimumKib = Math.ceil(memory.totalKib * (minimumAvailablePercent / 100));
    const requiredAvailableKib = Math.max(absoluteMinimumKib, proportionalMinimumKib);

    return {
        ...memory,
        requiredAvailableKib,
        availablePercent: (memory.availableKib / memory.totalKib) * 100,
        safe: memory.availableKib >= requiredAvailableKib,
    };
}

function parseArguments(arguments_) {
    const options = { stage: 'unknown', check: false };
    for (let index = 0; index < arguments_.length; index += 1) {
        const argument = arguments_[index];
        if (argument === '--stage') {
            options.stage = arguments_[index + 1] ?? '';
            index += 1;
        } else if (argument === '--check') {
            options.check = true;
        } else if (argument === '--report') {
            options.check = false;
        } else {
            throw new Error(`Unknown argument: ${argument}`);
        }
    }
    if (!/^[a-z0-9-]+$/u.test(options.stage)) {
        throw new Error('Memory report stage must use lowercase letters, digits, or hyphens');
    }
    return options;
}

function formatMib(kib) {
    return (kib / 1024).toFixed(1);
}

function main(arguments_ = process.argv.slice(2), meminfoPath = '/proc/meminfo') {
    const options = parseArguments(arguments_);
    const memory = evaluateMemory(parseMeminfo(fs.readFileSync(meminfoPath, 'utf8')));
    const line = [
        'PRODUCTION_MEMORY',
        `stage=${options.stage}`,
        `total_mib=${formatMib(memory.totalKib)}`,
        `available_mib=${formatMib(memory.availableKib)}`,
        `available_percent=${memory.availablePercent.toFixed(1)}`,
        `swap_free_mib=${formatMib(memory.swapFreeKib)}`,
        `required_available_mib=${formatMib(memory.requiredAvailableKib)}`,
        `status=${memory.safe ? 'safe' : 'low'}`,
    ].join(' ');
    process.stdout.write(`${line}\n`);

    if (options.check && !memory.safe) {
        throw new Error(
            `Insufficient available memory before ${options.stage}: ` +
                `${formatMib(memory.availableKib)} MiB available, ` +
                `${formatMib(memory.requiredAvailableKib)} MiB required`,
        );
    }
    return memory;
}

module.exports = {
    DEFAULT_MINIMUM_AVAILABLE_MIB,
    DEFAULT_MINIMUM_AVAILABLE_PERCENT,
    evaluateMemory,
    main,
    parseArguments,
    parseMeminfo,
};

if (require.main === module) {
    try {
        main();
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}
