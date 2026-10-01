/**
 * The format × direction matrix, read from the engine's conversion registry.
 *
 * README §24 requires "every tool × every relevant format pair" as distinct
 * pages — `/word-to-pdf` *and* `/pdf-to-word`, even though both run one engine
 * op. Today 28 conversion routes exist and only two pass
 * `direction="from-pdf"`, so the from-PDF half of the matrix is almost entirely
 * unbuilt.
 *
 * The registry is TypeScript and cannot be imported under `node --test`, so the
 * entries are read from source. That is acceptable because the generator's
 * output is checked against the real build by `tests/contracts/sitemap.test.mjs`
 * and the SPCC checker — if this parse drifted, those would notice a missing
 * page rather than trusting the numbers here.
 */

/**
 * Extracts every registry entry: `{ id, label, status, directions, extensions }`.
 *
 * The parse is structural rather than a single regex: an entry begins with
 * `supported(` or `unavailable(` at two-space indent, and its arguments are read
 * until the matching close paren, so a label containing a comma or a direction
 * list spanning several lines cannot break it.
 */
export function parseFormatRegistry(source) {
  const entries = [];
  const call = /^ {2}(supported|unavailable)\(/gmu;
  for (const match of source.matchAll(call)) {
    const status = match[1];
    const start = match.index + match[0].length;
    const body = readArguments(source, start);
    const args = splitArguments(body);
    const [id, label, extensions, , directions] = args;
    entries.push({
      id: unquote(id),
      label: unquote(label),
      status,
      extensions: parseStringArray(extensions),
      directions: parseStringArray(directions),
    });
  }
  return entries;
}

/** Strips the surrounding quotes from a parsed string literal. */
function unquote(value = '') {
  const trimmed = value.trim();
  if (!/^'.*'$/u.test(trimmed)) return trimmed;
  return trimmed.slice(1, -1).replaceAll("\\'", "'");
}

/** Reads from `start` to the parenthesis that closes the call. */
function readArguments(source, start) {
  let depth = 1;
  let quote = null;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index);
    }
  }
  throw new Error('unbalanced parentheses in the format registry');
}

/** Splits an argument list on top-level commas only. */
function splitArguments(body) {
  const args = [];
  let depth = 0;
  let quote = null;
  let current = '';
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (quote) {
      current += character;
      if (character === '\\') {
        current += body[index + 1] ?? '';
        index += 1;
      } else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      current += character;
      continue;
    }
    if ('([{'.includes(character)) depth += 1;
    if (')]}'.includes(character)) depth -= 1;
    if (character === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  if (current.trim() !== '') args.push(current.trim());
  return args;
}

function parseStringArray(value = '') {
  return [...value.matchAll(/'([^']+)'/gu)].map((match) => match[1]);
}

/**
 * The directional page matrix.
 *
 * Only *supported* formats are included. An unavailable format gets no page:
 * the registry already gives it a typed `unavailableReason` that the existing
 * conversion route renders, and a prerendered landing page for an operation
 * that cannot run is a doorway page — thin content that reads as a promise the
 * product does not keep.
 */
export function buildPairMatrix(registry) {
  return registry
    .filter((entry) => entry.status === 'supported')
    .flatMap((entry) =>
      entry.directions.map((direction) => ({
        format: entry.id,
        label: entry.label,
        direction,
        slug: direction === 'to-pdf' ? `${entry.id}-to-pdf` : `pdf-to-${entry.id}`,
        title: direction === 'to-pdf' ? `${entry.label} to PDF` : `PDF to ${entry.label}`,
      })),
    );
}
