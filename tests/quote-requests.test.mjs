import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQuoteRequestSummary, formatQuoteDate, isQuoteId, QUOTE_ITEM_LIMIT,
  QUOTE_PAGE_SIZE, normalizeQuoteDimension, quoteToday, validQuoteDate, validateQuoteFields,
} from "../app/lib/quote-requests.mjs";

function fields(overrides = {}) {
  return { clientName: "Cliente", contact: "", requestedOn: "2026-10-16", notes: "", sent: false,
    items: [{ id: crypto.randomUUID(), description: "Porta integrada 2 folhas", measurements: "2,30 A × 2,00 L",
      quantity: 1, details: "Preto | VD Temp" }], ...overrides };
}

test("quote fields preserve free measurements, item details and newlines while trimming only surrounding space", () => {
  const input = fields({ clientName: "  Cliente da obra  ", contact: "  (16) 00000-0000  ", notes: "\r\nConfirmar vão\r\nCor preta\r\n" });
  input.items[0].measurements = "  2,30Ax2,00L / conferir vão  ";
  input.items[0].details = "  Preto | Vidro temperado\r\nDuas folhas  ";
  const before = structuredClone(input);
  const result = validateQuoteFields(input);
  assert.equal(result.clientName, "Cliente da obra");
  assert.equal(result.contact, "(16) 00000-0000");
  assert.equal(result.notes, "Confirmar vão\nCor preta");
  assert.equal(result.items[0].measurements, "2,30Ax2,00L / conferir vão");
  assert.equal(result.items[0].details, "Preto | Vidro temperado\nDuas folhas");
  assert.deepEqual(input, before);
  assert.notEqual(result.items[0], input.items[0]);
  const safe = validateQuoteFields({ ...input, userId: 99, revision: 999, createdAt: "1900-01-01", sessionToken: "untrusted" });
  for (const key of ["userId", "revision", "createdAt", "sessionToken"]) assert.equal(Object.hasOwn(safe, key), false);
});

test("quote totals accept optional values, zero and exact bounded integer cents without coercion", () => {
  assert.equal(validateQuoteFields(fields()).amountCents, null);
  for (const amountCents of [null, 0, 1, 125050, 10_000_000_000]) {
    assert.equal(validateQuoteFields(fields({ amountCents })).amountCents, amountCents);
  }
  for (const amountCents of [-1, 0.5, 10_000_000_001, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, "125050", "1.250,50", false, {}, []]) {
    assert.throws(() => validateQuoteFields(fields({ amountCents })), undefined, String(amountCents));
  }
});

test("quote validation rejects impossible dates, repeated IDs, missing clients and malformed quantities or text", () => {
  const valid = fields();
  assert.equal(QUOTE_ITEM_LIMIT, 100);
  assert.equal(QUOTE_PAGE_SIZE, 25);
  assert.equal(isQuoteId(valid.items[0].id), true);
  assert.equal(isQuoteId("not-a-request"), false);
  for (const input of [null, [], 1, "text"]) assert.throws(() => validateQuoteFields(input));
  for (const override of [
    { clientName: " " }, { clientName: "x".repeat(121) }, { contact: "x".repeat(121) }, { notes: "x".repeat(8001) },
    { requestedOn: "2026-02-30" }, { requestedOn: "16/10/2026" }, { requestedOn: "2026-10-16T00:00:00Z" },
    { sent: undefined }, { sent: 0 }, { items: [] }, { items: Array.from({ length: 101 }, () => ({ ...valid.items[0], id: crypto.randomUUID() })) },
    { items: [valid.items[0], valid.items[0]] },
  ]) assert.throws(() => validateQuoteFields({ ...valid, ...override }));
  for (const item of [
    { id: "invalid" }, { description: " " }, { description: "x".repeat(501) }, { measurements: "x".repeat(241) },
    { details: "x".repeat(801) }, { quantity: 0 }, { quantity: -1 }, { quantity: 1.2 }, { quantity: "1" }, { quantity: 10001 },
    { description: "Porta\u0000invalida" },
  ]) assert.throws(() => validateQuoteFields({ ...valid, items: [{ ...valid.items[0], ...item }] }));
  assert.equal(validateQuoteFields({ ...valid, items: [{ ...valid.items[0], quantity: 10000 }] }).items[0].quantity, 10000);
});

test("quote dates use Brasilia's day boundary and summaries keep the client's requested date and exact item dimensions", () => {
  assert.equal(quoteToday(new Date("2026-10-17T02:59:59.999Z")), "2026-10-16");
  assert.equal(quoteToday(new Date("2026-10-17T03:00:00.000Z")), "2026-10-17");
  assert.equal(quoteToday(new Date("2027-01-01T02:59:59Z")), "2026-12-31");
  for (const date of ["2026-10-16", "2028-02-29"]) assert.equal(validQuoteDate(date), true);
  for (const date of ["2026-02-29", "2026-02-30", "2026-13-01", "2026-1-1", "16/10/2026", ""]) assert.equal(validQuoteDate(date), false);
  assert.equal(formatQuoteDate("2026-10-16"), "16/10/2026");
  assert.equal(formatQuoteDate("2026-10-17T02:30:00Z", true), "16/10/2026, 23:30");
  assert.equal(formatQuoteDate("invalid"), "—");
  const request = fields({ notes: "Confirmar a cor", items: [
    { id: crypto.randomUUID(), description: "Porta integrada 2 folhas", measurements: "2,30Ax2,00L", quantity: 1, details: "Preto | VD Temp" },
    { id: crypto.randomUUID(), description: "Porta integrada 2 folhas", measurements: "2,30Ax2,50L", quantity: 2, details: "Preto | VD Temp" },
  ] });
  const summary = buildQuoteRequestSummary(request);
  assert.match(summary, /^Cliente: Cliente\nSolicitado em: 16\/10\/2026\n/);
  assert.match(summary, /1 × Porta integrada 2 folhas \| 2,30Ax2,00L \| Preto \| VD Temp/);
  assert.match(summary, /2 × Porta integrada 2 folhas \| 2,30Ax2,50L \| Preto \| VD Temp/);
  assert.match(summary, /Observações: Confirmar a cor/);
  assert.doesNotMatch(summary, /Valor total:/);
  assert.match(buildQuoteRequestSummary({ ...request, amountCents: 125050 }), /Valor total: R\$\s*1\.250,50/);
  assert.match(buildQuoteRequestSummary({ ...request, amountCents: 0 }), /Valor total: R\$\s*0,00/);
  assert.doesNotMatch(buildQuoteRequestSummary({ ...request, amountCents: null }), /Valor total:/);
});

test("height, width and free measurements are independently optional and preserve the supplied units", () => {
  const base = fields();
  for (const dimensions of [{}, { height: "" }, { width: "" }, { height: null, width: null, measurements: null },
    { height: "2,30 m" }, { width: "230 cm" }, { measurements: "Conferir o vão" },
    { height: " 2,30 m ", width: " 2000 mm ", measurements: " Medida livre do cliente " }]) {
    const result = validateQuoteFields({ ...base, items: [{ ...base.items[0], measurements: "", ...dimensions }] });
    assert.equal(result.items[0].height, (dimensions.height ?? "").trim());
    assert.equal(result.items[0].width, (dimensions.width ?? "").trim());
    assert.equal(result.items[0].measurements, (dimensions.measurements ?? "").trim());
  }
  for (const key of ["height", "width"]) {
    for (const value of [12, {}, [], "x".repeat(81), "2\u0000m"]) {
      assert.throws(() => validateQuoteFields({ ...base, items: [{ ...base.items[0], [key]: value }] }));
    }
  }
  const record = validateQuoteFields({ ...base, items: [{ ...base.items[0], height: "2,30 m", width: "2,00 m", measurements: "Vão a confirmar" }] });
  assert.match(buildQuoteRequestSummary(record), /Altura: 2,30 m \| Largura: 2,00 m \| Vão a confirmar/);
  const blank = validateQuoteFields({ ...base, items: [{ ...base.items[0], measurements: "" }] });
  assert.doesNotMatch(buildQuoteRequestSummary(blank), /Altura:|Largura:/);
});


test("dimensions add meters automatically to numbers while preserving blanks and explicit units", () => {
  for (const [input, expected] of [["", ""], ["  ", ""], ["2", "2 m"], ["2,30", "2,30 m"],
    ["2.30", "2.30 m"], [" 2,30m ", "2,30 m"], ["2,30 m", "2,30 m"],
    ["230 cm", "230 cm"], ["2000 mm", "2000 mm"], ["A confirmar", "A confirmar"]]) {
    assert.equal(normalizeQuoteDimension(input), expected);
    assert.equal(normalizeQuoteDimension(expected), expected);
  }
  const base = fields();
  const record = validateQuoteFields({ ...base, items: [{ ...base.items[0], height: "2,30", width: "2.00" }] });
  assert.match(buildQuoteRequestSummary({ ...record, items: [{ ...record.items[0], height: "2,30", width: "230 cm" }] }), /Altura: 2,30 m \| Largura: 230 cm/);
  assert.equal(record.items[0].height, "2,30 m");
  assert.equal(record.items[0].width, "2.00 m");
  assert.match(buildQuoteRequestSummary(record), /Altura: 2,30 m \| Largura: 2.00 m/);
  assert.throws(() => validateQuoteFields({ ...base, items: [{ ...base.items[0], height: "2".repeat(80) }] }));
});
