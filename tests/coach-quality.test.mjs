import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { customerReplyFallback, guidedCustomerReply, isCustomerReplySafe, sanitizeCustomerReply } from "../app/api/coach/customer-policy.mjs";

test("customer simulator rejects seller and coach role leakage", () => {
  const unsafeReplies = [
    "Certo. Para eu não te mandar opção demais, você está buscando praticidade, economia de espaço ou um acabamento específico?",
    "Como treinador, sugiro que você faça uma pergunta de diagnóstico.",
    "Posso verificar a condição e montar uma proposta para você.",
    "Vendedor: primeiro separo o que está incluso no kit.",
    "Você acertou o acolhimento, mas precisa melhorar o próximo passo.",
  ];
  for (const reply of unsafeReplies) {
    const cleaned = sanitizeCustomerReply(reply, { id: "catalog-request" });
    assert.notEqual(cleaned, reply);
    assert.equal(isCustomerReplySafe(cleaned), true);
  }
});

test("customer simulator preserves concise, natural customer messages", () => {
  const replies = [
    "É para a entrada da casa e eu gosto de linhas mais retas. Vocês têm algo assim?",
    "Ainda não tenho a medida exata. Posso mandar uma foto primeiro?",
    "Estou comparando duas opções e queria entender o que muda no acabamento.",
  ];
  for (const reply of replies) assert.equal(sanitizeCustomerReply(reply, {}), reply);
});

test("every deterministic fallback remains in the customer role", () => {
  for (const id of ["price-first", "measure-gap", "price-objection", "timeline", "complex-decision", "pix-discount", "photo-only", "space-choice", "catalog-request", "volume-work", "wood-aluminum", "silent-customer", "after-sales", "installation-question", "finish-choice", "wet-area", "unknown"]) {
    assert.equal(isCustomerReplySafe(customerReplyFallback({ id })), true);
  }
  assert.equal(typeof customerReplyFallback({ id: "__proto__" }), "string");
});

test("generative coach uses current configurable model and privacy controls", async () => {
  const source = await readFile(new URL("../app/api/coach/route.ts", import.meta.url), "utf8");
  assert.match(source, /OPENAI_MODEL\?\.trim\(\) \|\| "gpt-5\.6-terra"/);
  assert.match(source, /store: false/);
  assert.match(source, /safety_identifier/);
  assert.match(source, /prompt_cache_key: "mult-portas-coach-v3"/);
  assert.match(source, /COACH_REQUESTS_PER_WINDOW/);
  assert.match(source, /Retry-After/);
  assert.match(source, /CUSTOMER_ROLE_CONTRACT/);
  assert.match(source, /sanitizeCustomerReply/);
});

test("guided mode emits only curated customer-role scenario messages", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /import \{ guidedCustomerReply \}/);
  assert.match(source, /customerReply: guidedCustomerReply\(scenario, progressionSignals\)/);
  assert.match(source, /history\.filter\(\(message\) => message\.role === "seller"\)/);
  assert.doesNotMatch(source, /customerReply: sanitizeGuidedCustomerReply/);
});

test("guided customer progression depends on answer quality, not turn count", () => {
  const scenario = { id: "catalog-request", customerReplies: ["Primeira dúvida.", "Segunda dúvida.", "Terceira dúvida."] };
  assert.equal(guidedCustomerReply(scenario, {}), "Primeira dúvida.");
  assert.equal(guidedCustomerReply(scenario, { hasQuestion: true, hasEnvironment: true }), "Segunda dúvida.");
  assert.equal(guidedCustomerReply(scenario, { hasQuestion: true, hasEnvironment: true, hasBenefit: true, hasNextMove: true }), "Terceira dúvida.");
  assert.equal(guidedCustomerReply(scenario, { hasQuestion: true, hasEnvironment: true, hasBenefit: true, hasNextMove: true, hasPressure: true }), "Primeira dúvida.");
});

test("all curated scenario replies stay natural and in the customer role", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const blocks = [...source.matchAll(/customerReplies:\s*\[([\s\S]*?)\]/g)].map((match) => match[1]);
  assert.equal(blocks.length, 16);
  const replies = blocks.flatMap((block) => [...block.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => JSON.parse(`"${match[1]}"`)));
  assert.equal(replies.length, 48);
  for (const reply of replies) {
    assert.equal(isCustomerReplySafe(reply), true, reply);
    assert.ok(reply.length <= 320, reply);
  }
});
