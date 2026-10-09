// Pure calculator for the launcher. No GNOME imports, so it can be tested with
// `gjs -m tests/calc.test.js`.
//
// Supports + - * / % ^, parentheses, unary minus and both "." and "," as
// decimal separator. No eval().

// Returns the result as a string, or null when `query` is not a calculation.
export function calculate(query) {
    let expr = query.trim();
    if (expr.startsWith('='))
        expr = expr.slice(1);

    if (!/^[\d\s.,+\-*/%^()]+$/.test(expr) || !/\d/.test(expr))
        return null;
    // A lone number like "12" or "-3" is not a calculation.
    if (!/[+\-*/%^]/.test(expr.trim().replace(/^-/, '')))
        return null;

    const tokens = expr.replace(/,/g, '.').match(/\d*\.?\d+|\d+\.|[+\-*/%^()]/g);
    let pos = 0;

    const peek = () => tokens[pos];
    const next = () => tokens[pos++];

    function primary() {
        const token = next();
        if (token === '(') {
            const value = sum();
            if (next() !== ')')
                throw new Error('missing )');
            return value;
        }
        const value = Number(token);
        if (token === undefined || Number.isNaN(value))
            throw new Error('expected number');
        return value;
    }

    // "^" is right-associative and binds tighter than unary minus: -2^2 = -4.
    function power() {
        const base = primary();
        if (peek() === '^') {
            next();
            return base ** unary();
        }
        return base;
    }

    function unary() {
        if (peek() === '-') {
            next();
            return -unary();
        }
        if (peek() === '+') {
            next();
            return unary();
        }
        return power();
    }

    function product() {
        let value = unary();
        while (['*', '/', '%'].includes(peek())) {
            const op = next();
            const rhs = unary();
            if (op === '*')
                value *= rhs;
            else if (op === '/')
                value /= rhs;
            else
                value %= rhs;
        }
        return value;
    }

    function sum() {
        let value = product();
        while (['+', '-'].includes(peek())) {
            const op = next();
            const rhs = product();
            value = op === '+' ? value + rhs : value - rhs;
        }
        return value;
    }

    try {
        const value = sum();
        if (pos !== tokens.length || !Number.isFinite(value))
            return null;
        return String(Number(value.toPrecision(12)));
    } catch {
        return null;
    }
}
