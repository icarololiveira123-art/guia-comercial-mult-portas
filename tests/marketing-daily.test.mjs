import assert from "node:assert/strict";
import test from "node:test";
import { normalizeEmployeeState } from "../app/api/data/state-contract.mjs";
import {
  buildMarketingReport, emptyMarketingDay, formatMarketingDate, getMarketingDay,
  marketingCounters, marketingDateKey, MARKETING_HISTORY_LIMIT, MAX_MARKETING_COUNT,
  normalizeMarketingCount, normalizeMarketingDaily, resetMarketingDay, setMarketingCount,
} from "../app/lib/marketing-daily.mjs";

test("the daily report turns over at midnight in Brasilia, independently of device timezone", () => {
  assert.equal(marketingDateKey(new Date("2026-10-10T02:59:59.999Z")), "2026-10-09");
  assert.equal(marketingDateKey(new Date("2026-10-10T03:00:00.000Z")), "2026-10-10");
  assert.equal(marketingDateKey(new Date("2026-12-31T23:45:00-03:00")), "2026-12-31");
  assert.equal(marketingDateKey(new Date("2027-01-01T00:00:00-03:00")), "2027-01-01");
  assert.equal(formatMarketingDate("2026-10-09"), "09/10/2026");
  assert.equal(formatMarketingDate("2026-02-30"), "");
});

test("a new day starts at zero while yesterday's report stays unchanged", () => {
  const yesterday = setMarketingCount({ days: [] }, "2026-10-09", "Ícaro", "newContacts", 2);
  const before = JSON.stringify(yesterday);
  const today = getMarketingDay(yesterday, "2026-10-10", "Ícaro");
  assert.deepEqual(today, emptyMarketingDay("2026-10-10", "Ícaro"));
  assert.equal(JSON.stringify(yesterday), before);
  const updated = setMarketingCount(yesterday, "2026-10-10", "Ícaro", "phone", 1);
  assert.equal(updated.days[0].phone, 1);
  assert.equal(updated.days[1].newContacts, 2);
  assert.equal(updated.days[1].date, "2026-10-09");
});

test("all five counters are independent, editable, bounded integers", () => {
  let state = { days: [] };
  for (let index = 0; index < marketingCounters.length; index++) {
    state = setMarketingCount(state, "2026-10-09", "Ícaro", marketingCounters[index].id, index + 1);
  }
  assert.deepEqual(marketingCounters.map(({ id }) => state.days[0][id]), [1, 2, 3, 4, 5]);
  state = setMarketingCount(state, "2026-10-09", "Ícaro", "phone", "18");
  state = setMarketingCount(state, "2026-10-09", "Ícaro", "newContacts", -2);
  assert.deepEqual(marketingCounters.map(({ id }) => state.days[0][id]), [0, 2, 3, 18, 5]);
  for (const value of [-1, "", "x", NaN, Infinity, null, [], {}]) assert.equal(normalizeMarketingCount(value), 0);
  assert.equal(normalizeMarketingCount(3.9), 3);
  assert.equal(normalizeMarketingCount(MAX_MARKETING_COUNT + 10), MAX_MARKETING_COUNT);
});

test("resetting today never clears other dates or the rest of the employee workspace", () => {
  let state = setMarketingCount({ days: [] }, "2026-10-08", "Ícaro", "newContacts", 8);
  state = setMarketingCount(state, "2026-10-09", "Ícaro", "phone", 4);
  const reset = resetMarketingDay(state, "2026-10-09", "Ícaro");
  const workspace = normalizeEmployeeState({
    marketingDaily: reset, sales: ["qualify"], metrics: { leads: 6 },
    followups: [{ id: "original", client: "Cliente exemplo", next: "Confirmar medidas", amountCents: 125050 }],
  });
  assert.deepEqual(workspace.marketingDaily.days[0], emptyMarketingDay("2026-10-09", "Ícaro"));
  assert.equal(workspace.marketingDaily.days[1].newContacts, 8);
  assert.equal(workspace.followups[0].amountCents, 125050);
  assert.deepEqual(workspace.sales, ["qualify"]);
  assert.equal(workspace.metrics.leads, 6);
  assert.equal(state.days[0].phone, 4);
});

test("the copyable summary follows the team's list, including all zero counts", () => {
  let state = setMarketingCount({ days: [] }, "2026-10-09", "Ícaro", "newContacts", 2);
  state = setMarketingCount(state, "2026-10-09", "Ícaro", "interacting", 2);
  assert.equal(buildMarketingReport(state.days[0]), [
    "Vendedor: Ícaro", "PLATAFORMA", "Contatos novos total: 2", "Contatos interagindo: 2",
    "Contatos não interagindo: 0", "Contatos via fone: 0", "Atendimentos presenciais: 0",
  ].join("\n"));
});

test("daily history survives state normalization, rejects invalid dates and retains the newest 366 entries", () => {
  assert.deepEqual(normalizeEmployeeState(null).marketingDaily, { days: [] });
  const days = Array.from({ length: MARKETING_HISTORY_LIMIT + 4 }, (_, index) => {
    const date = new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10);
    return { ...emptyMarketingDay(date, "  Vendedor\nExemplo  "), phone: index };
  });
  const input = { days: [
    null, { date: "2026-02-30", phone: 50 }, { date: "__proto__", phone: 50 },
    ...days, { ...days[0], phone: 999 },
  ], unknown: "discard" };
  const normalized = normalizeMarketingDaily(input);
  assert.equal(normalized.days.length, MARKETING_HISTORY_LIMIT);
  assert.equal(normalized.days[0].phone, MARKETING_HISTORY_LIMIT + 3);
  assert.equal(normalized.days[0].seller, "Vendedor Exemplo");
  assert.equal(normalized.days.some(({ date }) => date === "2026-02-30"), false);
  assert.equal(normalized.days.some(({ date }) => date === "2025-01-01"), false);
  const saved = normalizeEmployeeState({ marketingDaily: normalized });
  assert.deepEqual(saved.marketingDaily, normalized);
  assert.deepEqual(normalizeEmployeeState(JSON.parse(JSON.stringify(saved))).marketingDaily, normalized);
  assert.deepEqual(normalizeMarketingDaily({ days: "damaged" }), { days: [] });
  assert.throws(() => emptyMarketingDay("2026-02-30", "Ícaro"));
});
