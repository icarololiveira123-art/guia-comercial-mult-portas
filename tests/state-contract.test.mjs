import assert from "node:assert/strict";
import test from "node:test";
import { GUIDE_STATE_VERSION, normalizeEmployeeState, summarizeEmployeeState } from "../app/api/data/state-contract.mjs";
import { MAX_QUOTE_AMOUNT_CENTS, formatQuoteAmount, normalizeQuoteAmountCents, parseQuoteAmount, quoteAmountInput } from "../app/lib/quote-amount.mjs";

test("a new employee state is complete, versioned and fully zeroed", () => {
  const state = normalizeEmployeeState(null);
  assert.equal(state.schemaVersion, GUIDE_STATE_VERSION);
  assert.deepEqual(state.metrics, {
    leads: 0,
    quotes: 0,
    officialQuotes: 0,
    incompleteQuotes: 0,
    followups: 0,
    closed: 0,
    ticket: 0,
  });
  assert.deepEqual(state.followups, []);
  assert.deepEqual(state.factory, []);
  assert.deepEqual(state.training.scoreHistory, []);
  assert.equal(summarizeEmployeeState(state).learningIndex, 0);
});

test("employee state is bounded and ignores unknown or unsafe fields", () => {
  const state = normalizeEmployeeState({
    secret: "must-not-survive",
    metrics: { quotes: -4, closed: "3", ticket: Number.POSITIVE_INFINITY },
    followups: [{ id: "one", client: " Cliente ", next: " Retornar ", priority: "Urgente", done: false, password: "x" }],
    training: {
      scoreHistory: [-3, 6.4, 99],
      skillHistory: [{ acolhimento: 20, diagnostico: -2 }],
      scenarioStats: { "__proto__": { attempts: 50 }, safe: { attempts: 2, best: 9, lastScore: 8 } },
    },
    factory: [{ manufacturer: "OUTRA", description: " Porta " }],
    drawerChecks: { "__proto__": ["x"], item: ["medida"] },
  });

  assert.equal("secret" in state, false);
  assert.equal(state.metrics.quotes, 0);
  assert.equal(state.metrics.closed, 0);
  assert.equal(state.metrics.ticket, 0);
  assert.deepEqual(state.training.scoreHistory, [0, 6, 10]);
  assert.equal(state.training.skillHistory[0].acolhimento, 10);
  assert.equal(state.training.skillHistory[0].diagnostico, 0);
  assert.equal(Object.hasOwn(state.training.scenarioStats, "__proto__"), false);
  assert.equal(Object.hasOwn(state.drawerChecks, "__proto__"), false);
  assert.deepEqual(state.factory, []);
  assert.deepEqual(state.followups[0], {
    id: "one",
    client: "Cliente",
    status: "Aguardando retorno",
    next: "Retornar",
    amountCents: null,
    priority: "Média",
    done: false,
  });
});

test("quote values accept Brazilian currency and preserve exact cents", () => {
  const examples = [
    ["", null], ["  ", null], ["0", 0], ["0,00", 0], ["0,01", 1], ["0.29", 29],
    ["1250", 125000], ["1250,5", 125050], ["1.250,50", 125050], ["R$ 1.250,50", 125050],
    ["  R$\u00a099.999,99  ", 9999999], ["1.250", 125000], ["1250.50", 125050],
    ["100.000.000,00", MAX_QUOTE_AMOUNT_CENTS],
  ];
  for (const [input, amountCents] of examples) {
    assert.deepEqual(parseQuoteAmount(input), { valid: true, amountCents }, input);
  }
  assert.equal(formatQuoteAmount(125050), "R$ 1.250,50");
  assert.equal(formatQuoteAmount(0), "R$ 0,00");
  assert.equal(formatQuoteAmount(null), "Não informado");
  assert.equal(quoteAmountInput(125050), "1250,50");
  for (const amount of [null, 0, 1, 29, 125050, 9999999, MAX_QUOTE_AMOUNT_CENTS]) {
    assert.deepEqual(parseQuoteAmount(quoteAmountInput(amount)), { valid: true, amountCents: amount });
  }
});

test("quote values reject malformed, negative, over-limit and fractional-cent inputs", () => {
  for (const input of [null, 10, "R$", "-1", "-0", "+20", "1e3", "Infinity", "1,234", "12.34,56", "1,250.50", "1 2", "10 reais", "100.000.000,01", "1,", "9".repeat(41)]) {
    assert.deepEqual(parseQuoteAmount(input), { valid: false, amountCents: null }, String(input));
  }
  for (const value of [undefined, null, "125050", -1, 0.5, Infinity, NaN, MAX_QUOTE_AMOUNT_CENTS + 1]) {
    assert.equal(normalizeQuoteAmountCents(value), null);
  }
});

test("saved quote values survive normalization and old quotes keep an unset value", () => {
  const state = normalizeEmployeeState({ followups: [
    { id: "priced", client: "Cliente A", next: "Retornar", amountCents: 125050 },
    { id: "zero", client: "Cliente B", next: "Retornar", amountCents: 0 },
    { id: "legacy", client: "Cliente C", next: "Retornar" },
    { id: "invalid", client: "Cliente D", next: "Retornar", amountCents: 1.25 },
  ] });
  assert.deepEqual(state.followups.map(({ amountCents }) => amountCents), [125050, 0, null, null]);
  assert.equal(state.followups[2].client, "Cliente C");
  assert.deepEqual(normalizeEmployeeState(JSON.parse(JSON.stringify(state))).followups, state.followups);
  state.followups[0].amountCents = null;
  assert.equal(normalizeEmployeeState(state).followups[0].amountCents, null);
});

test("follow-up bounds preserve the newest entries shown first in the UI", () => {
  const followups = Array.from({ length: 241 }, (_, index) => ({
    id: index === 0 ? "newest" : `older-${index}`,
    client: `Cliente ${index}`,
    next: "Retornar",
    done: false,
  }));
  const state = normalizeEmployeeState({ followups });

  assert.equal(state.followups.length, 240);
  assert.equal(state.followups[0].id, "newest");
  assert.equal(state.followups.some((item) => item.id === "older-240"), false);
});

test("factory migration preserves legacy Dalcomad kits and enforces the fixed scope", () => {
  const state = normalizeEmployeeState({
    factory: {
      color: "BRANCO",
      finish: "PET",
      items: [{
        id: "legacy-1",
        manufacturer: "DALCOMAD",
        description: "KIT PORTA PRONTA",
        opening: "ABRIR",
        leafMeasure: "0,80 x 2,10",
        requadro: "18cm",
        line: "ECO",
        filling: "colméia",
        priceWithoutLock: 1234.5,
        priceWithLock: "R$ 1.399,90",
      }],
    },
  });

  assert.deepEqual(state.factory, [{
    id: "legacy-1",
    manufacturer: "DALCOMAD",
    description: "KIT PORTA",
    opening: "ABRIR",
    leafMeasure: "0,80 x 2,10",
    requadro: "18CM",
    color: "BRANCO DIAMANTE",
    line: "ECO",
    finish: "PET/PVC TX",
    filling: "COLMÉIA",
    priceWithoutLock: "1234.5",
    priceWithLock: "1399.9",
  }]);
});

test("factory and metrics reject contradictory or impossible values", () => {
  const state = normalizeEmployeeState({
    metrics: { quotes: 5, officialQuotes: 4, incompleteQuotes: 4, followups: 9, closed: 8 },
    factory: [
      { id: "empty", manufacturer: "DALCOMAD", description: "KIT PORTA", opening: "ABRIR" },
      { id: "invalid", manufacturer: "DALCOMAD", description: "KIT PORTA", opening: "ABRIR", line: "ECO", finish: "RENOLIT", color: "BLACK SP", priceWithoutLock: "-10" },
      { id: "wrong-scope", manufacturer: "OUTRA", description: "FOLHA DE PORTA", opening: "CORRER", leafMeasure: "0,80 x 2,10" },
    ],
  });
  assert.deepEqual(state.metrics, {
    leads: 0,
    quotes: 5,
    officialQuotes: 4,
    incompleteQuotes: 1,
    followups: 5,
    closed: 5,
    ticket: 0,
  });
  assert.equal(state.factory.length, 1);
  assert.equal(state.factory[0].line, "ECO");
  assert.equal(state.factory[0].finish, "PET/PVC TX");
  assert.equal(state.factory[0].color, "");
  assert.equal(state.factory[0].priceWithoutLock, "");
});

test("learning summary is deterministic and account-scoped", () => {
  const summary = summarizeEmployeeState({
    metrics: { quotes: 7, closed: 2 },
    followups: [{ id: "1", client: "A", next: "B", done: false }],
    training: {
      rounds: 12,
      best: 9,
      scenarios: ["a", "b", "c"],
      scoreHistory: [6, 8],
      skillHistory: [
        { acolhimento: 8, diagnostico: 4, precisao: 6, valor: 7, proximoPasso: 5 },
        { acolhimento: 9, diagnostico: 5, precisao: 7, valor: 7, proximoPasso: 6 },
      ],
    },
  });
  assert.equal(summary.averageScore, 7);
  assert.equal(summary.quotes, 7);
  assert.equal(summary.pendingFollowUps, 1);
  assert.equal(summary.weakestSkill, "diagnostico");
  assert.equal(summary.learningIndex, 62);
});
