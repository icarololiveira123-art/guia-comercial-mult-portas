// Compare dimensions without changing any stored measurement or product code.
const numberPattern = '[0-9]+(?:[.,][0-9]+)?';
const pairPattern = new RegExp(`(${numberPattern})\\s*(mm|cm|m)?\\s*[al]?\\s*[x×]\\s*(${numberPattern})\\s*((?:mm|cm|m)(?![a-z]))?\\s*(?:[al](?![a-z]))?`, 'g');
const unitPattern = new RegExp(`(${numberPattern})\\s*(mm|cm|m)(?![a-z])`, 'g');
const dimensionQuery = /[0-9][.,][0-9]|[0-9]\s*(?:mm|cm|m)(?![a-z])|[0-9]\s*[al]?\s*[x×]\s*[0-9]/;
const measurementWords = new Set(['x', 'ax', 'lx', 'a', 'l', 'm', 'cm', 'mm', 'altura', 'largura', 'medida', 'medidas']);
const unitScale = unit => unit === 'mm' ? 3 : unit === 'cm' ? 2 : 0;

function canonicalNumber(value, scale = 0) {
  const [integer, decimal = ''] = value.replace(',', '.').split('.');
  const padded = '000' + integer;
  const cut = padded.length - scale;
  const whole = padded.slice(0, cut).replace(/^0+(?=[0-9])/, '');
  const fraction = (padded.slice(cut) + decimal).replace(/0+$/, '');
  return whole + (fraction ? '.' + fraction : '');
}

/** @param {string} value */
export function searchTokens(value) {
  let text = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  // A unit at the end of a pair applies to both dimensions: 230 × 200 cm.
  text = text.replace(pairPattern, (_match, first, firstUnit, second, secondUnit) =>
    `${canonicalNumber(first, unitScale(firstUnit || secondUnit))} ${canonicalNumber(second, unitScale(secondUnit || firstUnit))}`);
  text = text.replace(unitPattern, (_match, number, unit) => canonicalNumber(number, unitScale(unit)));
  return (text.match(/[0-9]+(?:[.,][0-9]+)?|[a-z]+/g) ?? []).map(token =>
    /^[0-9]/.test(token) ? 'n:' + canonicalNumber(token) : 'w:' + token);
}

/** @param {string} source @param {string} query @param {string} dimensions */
export function matchesSearch(source, query, dimensions = source) {
  if (!query.trim()) return true;
  const sourceTokens = searchTokens(source);
  const queryTokens = searchTokens(query);
  const hasNumber = queryTokens.some(token => token.startsWith('n:'));
  const needed = queryTokens.filter(token => !(hasNumber && measurementWords.has(token.slice(2))));
  if (!needed.length) return false;
  const numbers = dimensionQuery.test(query.toLowerCase()) ? searchTokens(dimensions) : sourceTokens;
  return needed.every(token => token.startsWith('n:')
    ? numbers.filter(candidate => candidate === token).length >= needed.filter(candidate => candidate === token).length
    : sourceTokens.some(candidate => candidate.startsWith('w:') && candidate.includes(token.slice(2))));
}

function matchesPhone(contact, query) {
  const text = query.trim();
  const digits = text.replace(/[^0-9]/g, '');
  if (!/^\+?[0-9\s().-]+$/.test(text) || digits.length < 4 || (text.includes('.') && digits.length < 8)) return false;
  const national = value => /^55[0-9]{10,11}$/.test(value) ? value.slice(2) : value;
  return national(contact.replace(/[^0-9]/g, '')).includes(national(digits));
}

/** Search one item at a time so different products cannot supply half a measurement each.
 * @param {{clientName: string, contact?: string, notes?: string, items?: Array<{description?: string, height?: string, width?: string, measurements?: string, details?: string}>}} request
 * @param {string} query
 */
export function quoteMatchesSearch(request, query) {
  if (matchesPhone(request.contact ?? '', query)) return true;
  const common = [request.clientName, request.contact, request.notes].filter(Boolean).join(' ');
  const items = request.items?.length ? request.items : [{}];
  return items.some(item => {
    const dimensions = [item.height, item.width, item.measurements].filter(Boolean).join(' ');
    return matchesSearch([common, item.description, dimensions, item.details].filter(Boolean).join(' '), query, dimensions);
  });
}

/** @param {{title: string, family: string, code?: string, spec: string, bestFor?: string, pitch?: string, checks?: string[]}} item @param {string} query */
export function catalogMatchesSearch(item, query) {
  return matchesSearch([item.title, item.family, item.code, item.spec, item.bestFor, item.pitch, ...(item.checks ?? [])].filter(Boolean).join(' '), query);
}
