export const MAX_QUOTE_AMOUNT_CENTS = 10_000_000_000;
export const QUOTE_AMOUNT_ERROR = "Use um valor de 0 a 100.000.000,00, com até duas casas decimais. Ex.: 1.250,50.";

const currencyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** @param {unknown} value */
export function normalizeQuoteAmountCents(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_QUOTE_AMOUNT_CENTS
    ? value
    : null;
}

/** Convert user input to integer cents without floating-point rounding.
 * @param {unknown} value
 * @returns {{ valid: boolean, amountCents: number | null }}
 */
export function parseQuoteAmount(value) {
  if (typeof value !== "string" || value.length > 40) return { valid: false, amountCents: null };
  const text = value.trim().replace(/^R\$\s*/i, "");
  if (!text) return { valid: value.trim() === "", amountCents: null };

  let whole;
  let fraction = "";
  if (text.includes(",")) {
    if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}$/.test(text)) return { valid: false, amountCents: null };
    [whole, fraction] = text.replaceAll(".", "").split(",");
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(text)) {
    whole = text.replaceAll(".", "");
  } else {
    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return { valid: false, amountCents: null };
    [whole, fraction = ""] = text.split(".");
  }

  const amountCents = normalizeQuoteAmountCents(Number(whole) * 100 + Number(fraction.padEnd(2, "0")));
  return { valid: amountCents !== null, amountCents };
}

/** @param {unknown} value */
export function formatQuoteAmount(value) {
  const cents = normalizeQuoteAmountCents(value);
  return cents === null ? "Não informado" : currencyFormatter.format(cents / 100).replaceAll("\u00a0", " ");
}

/** @param {unknown} value */
export function quoteAmountInput(value) {
  const cents = normalizeQuoteAmountCents(value);
  return cents === null ? "" : String(Math.floor(cents / 100)) + "," + String(cents % 100).padStart(2, "0");
}
