import { formatQuoteAmount, MAX_QUOTE_AMOUNT_CENTS, normalizeQuoteAmountCents, QUOTE_AMOUNT_ERROR } from './quote-amount.mjs';

export const QUOTE_ITEM_LIMIT = 100;
export const QUOTE_PAGE_SIZE = 25;
export const QUOTE_TIME_ZONE = 'America/Sao_Paulo';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isQuoteId(value) { return typeof value === 'string' && uuidPattern.test(value); }
export function quoteToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: QUOTE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function validQuoteDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T12:00:00Z`))
    && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}
function text(value, max, label, required = false) {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label}: informe um texto com até ${max} caracteres.`);
  const result = value.replace(/\r\n?/g, '\n').trim();
  if (required && !result) throw new Error(`Preencha ${label.toLocaleLowerCase('pt-BR')}.`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) throw new Error(`${label} contém caracteres inválidos.`);
  return result;
}
/** @param {string} value */
export function normalizeQuoteDimension(value) {
  const clean = value.trim();
  const numeric = /^(\d+(?:[.,]\d+)?)\s*m?$/i.exec(clean);
  return numeric ? `${numeric[1]} m` : clean;
}

function dimension(value, label) {
  return text(normalizeQuoteDimension(text(value ?? '', 80, label)), 80, label);
}
/** @typedef {{ id: string, description: string, height?: string, width?: string, measurements: string, quantity: number, details: string, unitAmountCents?: number | null }} QuoteRequestItem */
/** @typedef {{ clientName: string, contact: string, requestedOn: string, notes: string, sent: boolean, amountCents: number | null, pricingMode?: 'items', legacyAmountCents?: number | null, items: QuoteRequestItem[] }} QuoteRequestFields */
/** @typedef {QuoteRequestFields & { id: string, createdAt: string, updatedAt: string, revision: number, sentAt: string | null, archivedAt: string | null }} QuoteRequestRecord */
/** @typedef {{ revision: number, action: string, changedAt: string, snapshot: QuoteRequestRecord }} QuoteRequestVersion */
/** @param {QuoteRequestItem[]} items */
export function calculateQuotePricing(items) {
  let total = 0;
  let pricedItems = 0;
  for (const [index, item] of items.entries()) {
    const unitAmountCents = normalizeQuoteAmountCents(item.unitAmountCents);
    if (item.unitAmountCents != null && unitAmountCents === null) throw new Error(`Valor do item ${index + 1}: ${QUOTE_AMOUNT_ERROR}`);
    if (unitAmountCents === null) continue;
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 10_000) throw new Error(`Confira a quantidade do item ${index + 1}.`);
    const subtotal = unitAmountCents * item.quantity;
    if (!Number.isSafeInteger(subtotal) || subtotal > MAX_QUOTE_AMOUNT_CENTS || total + subtotal > MAX_QUOTE_AMOUNT_CENTS) throw new Error('A soma dos itens deve ser de até R$ 100.000.000,00. Confira os valores e as quantidades.');
    total += subtotal;
    pricedItems += 1;
  }
  return { amountCents: pricedItems ? total : null, pricedItems, unpricedItems: items.length - pricedItems };
}
/** @param {unknown} value @returns {QuoteRequestFields} */
export function validateQuoteFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('O pedido precisa conter os dados do cliente e os itens.');
  const clientName = text(value.clientName, 120, 'Nome do cliente', true);
  const contact = text(value.contact ?? '', 120, 'Contato');
  const notes = text(value.notes ?? '', 8_000, 'Observações');
  const amountCents = normalizeQuoteAmountCents(value.amountCents);
  if (value.amountCents != null && amountCents === null) throw new Error(QUOTE_AMOUNT_ERROR);
  if (!validQuoteDate(value.requestedOn)) throw new Error('Informe uma data de solicitação válida.');
  if (typeof value.sent !== 'boolean') throw new Error('Informe se o orçamento foi enviado ao cliente.');
  if (!Array.isArray(value.items) || !value.items.length || value.items.length > QUOTE_ITEM_LIMIT) throw new Error(`Adicione de 1 a ${QUOTE_ITEM_LIMIT} itens ao pedido.`);
  if (value.pricingMode !== undefined && value.pricingMode !== 'items') throw new Error('O formato dos valores do pedido é inválido.');
  const itemPricing = value.pricingMode === 'items' || value.items.some(item => item && Object.hasOwn(item, 'unitAmountCents'));
  const seen = new Set();
  const items = value.items.map((item, index) => {
    if (!item || !isQuoteId(item.id) || seen.has(item.id)) throw new Error('Um dos itens está inválido ou repetido.');
    seen.add(item.id);
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 10_000) throw new Error(`Confira a quantidade do item ${index + 1}.`);
    return { id: item.id, description: text(item.description, 500, `Item ${index + 1}`, true),
      height: dimension(item.height, `Altura do item ${index + 1}`),
      width: dimension(item.width, `Largura do item ${index + 1}`),
      measurements: text(item.measurements ?? '', 240, `Medidas do item ${index + 1}`), quantity: item.quantity,
      details: text(item.details ?? '', 800, `Detalhes do item ${index + 1}`),
      ...(itemPricing ? { unitAmountCents: item.unitAmountCents ?? null } : {}) };
  });
  if (itemPricing) {
    const pricing = calculateQuotePricing(items);
    const legacyAmountCents = normalizeQuoteAmountCents(value.legacyAmountCents);
    if (value.legacyAmountCents != null && legacyAmountCents === null) throw new Error(QUOTE_AMOUNT_ERROR);
    return { clientName, contact, requestedOn: value.requestedOn, notes, sent: value.sent, pricingMode: 'items', legacyAmountCents, amountCents: pricing.amountCents, items };
  }
  return { clientName, contact, requestedOn: value.requestedOn, notes, sent: value.sent, amountCents, items };
}
/** @param {QuoteRequestRecord} request */
export function buildQuoteRequestSummary(request) {
  return [`Cliente: ${request.clientName}`, `Solicitado em: ${formatQuoteDate(request.requestedOn)}`,
    ...request.items.map(item => `${item.quantity} × ${[item.description, item.height ? `Altura: ${normalizeQuoteDimension(item.height)}` : '', item.width ? `Largura: ${normalizeQuoteDimension(item.width)}` : '', item.measurements, item.details,
      ...(item.unitAmountCents != null ? [`Valor unitário: ${formatQuoteAmount(item.unitAmountCents)}`, `Subtotal: ${formatQuoteAmount(calculateQuotePricing([item]).amountCents)}`] : [])].filter(Boolean).join(' | ')}`),
    ...(request.amountCents != null ? [`${request.pricingMode === 'items' && request.items.some(item => item.unitAmountCents == null) ? 'Subtotal dos itens preenchidos (parcial)' : 'Valor total'}: ${formatQuoteAmount(request.amountCents)}`] : []),
    ...(request.legacyAmountCents != null ? [`Total anterior, sem divisão por item (referência): ${formatQuoteAmount(request.legacyAmountCents)}`] : []),
    ...(request.notes ? [`Observações: ${request.notes}`] : [])].join('\n');
}
export function formatQuoteDate(value, withTime = false) {
  if (!value) return '—';
  const isDate = validQuoteDate(value);
  const date = new Date(isDate ? `${value}T12:00:00Z` : value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: isDate ? 'UTC' : QUOTE_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', ...(withTime && !isDate ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(date);
}
