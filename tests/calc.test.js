// Run with: gjs -m tests/calc.test.js
import System from 'system';
import {calculate} from '../calc.js';

const cases = [
    ['12*7', '84'],
    ['1+2*3', '7'],
    ['(1+2)*3', '9'],
    ['10/4', '2.5'],
    ['10,5+1', '11.5'],
    ['2^10', '1024'],
    ['2^3^2', '512'],
    ['-2^2', '-4'],
    ['-3+5', '2'],
    ['7%3', '1'],
    ['= 2 * (3 + 4)', '14'],
    ['0.1+0.2', '0.3'],
    ['.5*2', '1'],
    // Not calculations:
    ['12', null],
    ['-3', null],
    ['firefox', null],
    ['12+', null],
    ['(1+2', null],
    ['1/0', null],
    ['', null],
    ['+', null],
    ['1..2+1', null],
];

let failures = 0;
for (const [input, expected] of cases) {
    const actual = calculate(input);
    if (actual === expected) {
        print(`ok   ${JSON.stringify(input)} -> ${actual}`);
    } else {
        failures++;
        print(`FAIL ${JSON.stringify(input)}: expected ${expected}, got ${actual}`);
    }
}

print(`\n${cases.length - failures}/${cases.length} passed`);
if (failures > 0)
    System.exit(1);
