/**
 * Shared option parsing for the github-automation CLI scripts.
 *
 * These scripts used to each carry their own `flag()` one-liner, which confused
 * "the option is absent" with "the option has no value": `--timeout-min` with no
 * number yielded Number(undefined) === NaN, `--scopes` with no value sent
 * `scope=undefined` to GitHub, and in ci-watch-all.js the missing option even
 * shifted the positional arguments. Parsing lives here so it is one tested
 * implementation instead of five copies.
 */

/** True when `a` looks like an option rather than a value. */
const isOption = (a) => typeof a === 'string' && a.startsWith('--');

/**
 * Split argv into { options, positionals }.
 *
 * `flags` lists the boolean options; every other `--name` takes the next
 * argument as its value. A missing value, or a value that is itself an option,
 * throws — silently substituting `undefined` is what caused the bugs above.
 */
export function parseOptions(argv, flags = []) {
  const options = new Map();
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!isOption(a)) {
      positionals.push(a);
      continue;
    }
    if (flags.includes(a)) {
      options.set(a, true);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || isOption(value)) {
      throw new Error(`missing value for ${a}`);
    }
    options.set(a, value);
    i += 1;
  }
  return { options, positionals };
}

/**
 * Read a whole-number option. `fallback` is used only when the option is absent.
 * Throws for a value that is not a finite number, so callers never compute a
 * deadline out of NaN.
 */
export function numberOption(options, name, fallback, { min = 0 } = {}) {
  if (!options.has(name)) return fallback;
  const raw = options.get(name);
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min) {
    throw new Error(`${name} must be a number >= ${min} (got "${raw}")`);
  }
  return value;
}
