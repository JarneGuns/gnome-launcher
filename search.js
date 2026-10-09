// Pure search and ranking logic. No GNOME imports, so it can be tested with
// `gjs -m tests/search.test.js`.
//
// An app is a plain object:
//   {id, name, genericName, keywords: [], executable, usage}
// where `usage` is a number (higher = used more often).

// Match levels, best first. Lower is better.
const EXACT = 1;
const PREFIX = 2;
const WORD_PREFIX = 3;
const SUBSTRING = 4;
const SECONDARY = 5;
const FUZZY = 6;

const WORD_SPLIT = /[\s\-_.:/()]+/;

function words(text) {
    return text.split(WORD_SPLIT).filter(w => w.length > 0);
}

// Damerau-Levenshtein distance (optimal string alignment variant).
export function editDistance(a, b) {
    const d = [];
    for (let i = 0; i <= a.length; i++) {
        d[i] = [i];
        for (let j = 1; j <= b.length; j++)
            d[i][j] = i === 0 ? j : 0;
    }
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(
                d[i - 1][j] + 1,
                d[i][j - 1] + 1,
                d[i - 1][j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
                d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
    }
    return d[a.length][b.length];
}

// Returns the number of gaps when `query` is a subsequence of `text`,
// or -1 when it is not.
function subsequenceGaps(query, text) {
    let gaps = 0;
    let last = -1;
    let pos = 0;
    for (const ch of query) {
        const found = text.indexOf(ch, pos);
        if (found < 0)
            return -1;
        if (last >= 0 && found !== last + 1)
            gaps++;
        last = found;
        pos = found + 1;
    }
    return gaps;
}

// Fuzzy cost of `query` against `name`, or Infinity when there is no match.
// A subsequence match costs < 1, a typo match costs its edit distance.
function fuzzyCost(query, name) {
    if (query.length < 3)
        return Infinity;

    const gaps = subsequenceGaps(query, name);
    if (gaps >= 0)
        return gaps / query.length;

    const maxTypos = query.length <= 5 ? 1 : 2;
    let best = Infinity;
    for (const target of [name, ...words(name)]) {
        for (let len = query.length - 1; len <= query.length + 1; len++) {
            if (len < 1 || len > target.length)
                continue;
            best = Math.min(best, editDistance(query, target.slice(0, len)));
        }
    }
    return best <= maxTypos ? best : Infinity;
}

// Returns the match level (1-5) of `app` for `query`, or 0 for no match.
function matchLevel(query, app) {
    const name = app.name.toLowerCase();
    if (name === query)
        return EXACT;
    if (name.startsWith(query))
        return PREFIX;
    if (words(name).some(w => w.startsWith(query)))
        return WORD_PREFIX;
    if (name.includes(query))
        return SUBSTRING;

    const secondary = [app.genericName, app.executable, ...(app.keywords ?? [])]
        .filter(Boolean)
        .map(s => s.toLowerCase());
    if (secondary.some(s => s.includes(query)))
        return SECONDARY;

    return 0;
}

function compareTieBreak(a, b) {
    return (b.app.usage ?? 0) - (a.app.usage ?? 0) ||
        a.app.name.length - b.app.name.length ||
        a.app.name.localeCompare(b.app.name);
}

// Ranks `apps` for `query`. Returns the matching apps, best first.
// With an empty query all apps are returned, sorted by usage.
export function rankApps(apps, query, {fuzzy = true} = {}) {
    query = query.trim().toLowerCase();

    if (query === '') {
        return apps
            .map(app => ({app}))
            .sort((a, b) =>
                (b.app.usage ?? 0) - (a.app.usage ?? 0) ||
                a.app.name.localeCompare(b.app.name))
            .map(r => r.app);
    }

    let results = [];
    for (const app of apps) {
        const level = matchLevel(query, app);
        if (level)
            results.push({app, level, cost: 0});
    }

    // Fuzzy matching is only a fallback when nothing else matched.
    if (results.length === 0 && fuzzy) {
        for (const app of apps) {
            const cost = fuzzyCost(query, app.name.toLowerCase());
            if (cost !== Infinity)
                results.push({app, level: FUZZY, cost});
        }
    }

    results.sort((a, b) =>
        a.level - b.level ||
        a.cost - b.cost ||
        compareTieBreak(a, b));

    return results.map(r => r.app);
}
