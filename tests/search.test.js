// Run with: gjs -m tests/search.test.js
import System from 'system';
import {rankApps, editDistance} from '../search.js';

const apps = [
    {id: 'firmware.desktop', name: 'Firmware Manager', genericName: 'Firmware Updater', keywords: ['fwupd'], executable: 'gnome-firmware', usage: 0},
    {id: 'firefox.desktop', name: 'Firefox', genericName: 'Web Browser', keywords: ['internet', 'www'], executable: 'firefox', usage: 0},
    {id: 'code.desktop', name: 'Visual Studio Code', genericName: 'Text Editor', keywords: ['vscode'], executable: 'code', usage: 5},
    {id: 'studio.desktop', name: 'Android Studio', genericName: 'IDE', keywords: [], executable: 'studio.sh', usage: 1},
    {id: 'discord.desktop', name: 'Discord', genericName: 'Internet Messenger', keywords: [], executable: 'Discord', usage: 10},
    {id: 'files.desktop', name: 'Files', genericName: 'File Manager', keywords: ['folder', 'explorer'], executable: 'nautilus', usage: 3},
    {id: 'term.desktop', name: 'Terminal', genericName: 'Terminal Emulator', keywords: ['shell', 'console'], executable: 'ptyxis', usage: 8},
];

let failures = 0;
let count = 0;

function test(name, fn) {
    count++;
    try {
        fn();
        print(`ok   ${name}`);
    } catch (e) {
        failures++;
        print(`FAIL ${name}: ${e.message}`);
    }
}

function assertEqual(actual, expected) {
    if (actual !== expected)
        throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const top = (query, opts) => rankApps(apps, query, opts)[0]?.name;
const names = (query, opts) => rankApps(apps, query, opts).map(a => a.name);

const before = (list, a, b) => list.includes(a) && (!list.includes(b) || list.indexOf(a) < list.indexOf(b));

test('"fi" and "fire" rank Firefox above Firmware Manager', () => {
    assertEqual(before(names('fi'), 'Firefox', 'Firmware Manager'), true);
    assertEqual(before(names('fire'), 'Firefox', 'Firmware Manager'), true);
});

test('"fi" puts Firefox first when usage is equal', () => {
    const noFiles = apps.filter(a => a.name !== 'Files');
    assertEqual(rankApps(noFiles, 'fi')[0].name, 'Firefox');
});

test('"fi" puts a more used Files above Firefox', () => {
    assertEqual(top('fi'), 'Files');
});

test('"fire" puts Firefox first', () => {
    assertEqual(top('fire'), 'Firefox');
});

test('usage breaks ties between equal levels before name length', () => {
    // Both are prefix matches for "fi"; higher usage wins over the shorter name.
    const used = apps
        .filter(a => a.name !== 'Files')
        .map(a => a.name === 'Firmware Manager' ? {...a, usage: 1} : a);
    assertEqual(rankApps(used, 'fi')[0].name, 'Firmware Manager');
});

test('"frefox" finds Firefox (fuzzy subsequence)', () => {
    assertEqual(top('frefox'), 'Firefox');
});

test('"fierfox" finds Firefox (transposition typo)', () => {
    assertEqual(top('fierfox'), 'Firefox');
});

test('fuzzy off: "frefox" finds nothing', () => {
    assertEqual(names('frefox', {fuzzy: false}).length, 0);
});

test('"code" finds Visual Studio Code', () => {
    assertEqual(top('code'), 'Visual Studio Code');
});

test('"studio" ranks Android Studio by word prefix', () => {
    // Both match on a word; Visual Studio Code has higher usage.
    const result = names('studio');
    assertEqual(result.includes('Android Studio'), true);
});

test('exact name beats prefix', () => {
    assertEqual(top('files'), 'Files');
});

test('keyword match is found ("shell" -> Terminal)', () => {
    assertEqual(top('shell'), 'Terminal');
});

test('name match beats keyword match ("term")', () => {
    assertEqual(top('term'), 'Terminal');
});

test('case insensitive', () => {
    assertEqual(top('FIRE'), 'Firefox');
});

test('empty query returns all apps sorted by usage', () => {
    const result = names('');
    assertEqual(result.length, apps.length);
    assertEqual(result[0], 'Discord');
    assertEqual(result[1], 'Terminal');
});

test('no match returns empty list', () => {
    assertEqual(names('zzzzqqq').length, 0);
});

test('editDistance basics', () => {
    assertEqual(editDistance('kitten', 'sitting'), 3);
    assertEqual(editDistance('ab', 'ba'), 1);
    assertEqual(editDistance('', 'abc'), 3);
});

print(`\n${count - failures}/${count} passed`);
if (failures > 0)
    System.exit(1);
