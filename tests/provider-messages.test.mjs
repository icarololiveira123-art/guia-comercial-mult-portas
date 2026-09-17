import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildProviderMessage,
  providerCompanyMessageExamples,
  providerMessageExamples,
} from "../app/lib/provider-message.mjs";
import { GUIDE_STATE_VERSION, normalizeEmployeeState } from "../app/api/data/state-contract.mjs";

test("monta uma apresentação completa para o prestador", () => {
  const message = buildProviderMessage({
    profile: "Prestador de Serviço",
    contactName: "Carlos",
    senderName: "Marina",
    providerType: "Empreiteiro ou construtor",
    region: "Araraquara e região",
    objective: "apoiar as obras que você atende com portas e esquadrias",
    question: "posso te enviar uma apresentação curta do nosso trabalho",
    channel: "WhatsApp",
    tone: "Consultivo",
  });

  for (const expected of ["Carlos", "Marina", "empreiteiro ou construtor", "Araraquara e região", "41 anos", "85 cidades", "posso te enviar uma apresentação curta do nosso trabalho?"]) {
    assert.match(message, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
  assert.doesNotMatch(message, /undefined|\[object Object\]/);
});

test("separa a apresentação formal de empresas da abordagem próxima para prestadores de serviço", () => {
  const company = buildProviderMessage({
    profile: "Empresa",
    contactName: "Construtora Horizonte",
    senderName: "Marina",
    providerType: "Construção civil e empreendimentos",
    region: "Araraquara e região",
    objective: "apresentar a Mult Portas e avaliar uma possível parceria",
    question: "com quem posso conversar sobre compras e especificações para as obras?",
    tone: "Próximo",
  });
  const serviceProvider = buildProviderMessage({
    profile: "Prestador de Serviço",
    contactName: "Carlos",
    senderName: "Marina",
    providerType: "Prestador de Serviço",
    region: "Araraquara e região",
    objective: "me apresentar e abrir uma possível parceria",
    question: "você atende obras em Araraquara ou cidades da região?",
    tone: "Próximo",
  });

  assert.match(company, /^Olá, Construtora Horizonte, tudo bem\?/);
  assert.match(company, /falo pela Mult Portas|valia a pena nos apresentarmos|A ideia é/i);
  assert.doesNotMatch(company, /\ba gente\b|Tudo certo/i);
  assert.match(serviceProvider, /^Oi, Carlos! Tudo bem\?/);
  assert.match(serviceProvider, /\ba gente\b|valia a pena/i);
  assert.match(serviceProvider, /prestador de serviço/);
  assert.doesNotMatch(serviceProvider, new RegExp("pedre" + "iro", "i"));
  assert.doesNotMatch(company, /sinergia|objetivo deste contato|identifiquei que|para direcionarmos/i);
  assert.doesNotMatch(serviceProvider, /sinergia|objetivo deste contato|identifiquei que|para direcionarmos/i);
});

test("gera mensagens utilizáveis em todos os canais e tons", () => {
  for (const profile of ["Empresa", "Prestador de Serviço"]) {
    for (const channel of ["WhatsApp", "Áudio"]) {
      for (const tone of ["Consultivo", "Direto", "Próximo"]) {
        const message = buildProviderMessage({ profile, channel, tone });
        assert.ok(message.length > 80 && message.length < 900, `${profile}/${channel}/${tone} deve ser concisa`);
        assert.match(message, /Mult Portas/);
        assert.match(message, /\?$/);
        assert.doesNotMatch(message, /undefined|\[object Object\]/);
      }
    }
  }
  assert.equal(providerMessageExamples.length, 4);
  assert.equal(providerCompanyMessageExamples.length, 4);
  assert.ok(providerMessageExamples.every((example) => example.message.includes("Mult Portas")));
  assert.ok(providerMessageExamples.some((example) => example.tag.includes("Prestador de Serviço")));
  assert.ok(providerCompanyMessageExamples.every((example) => example.message.includes("Mult Portas")));
  for (const example of [...providerMessageExamples, ...providerCompanyMessageExamples]) {
    assert.ok(example.message.length < 600, `${example.id} deve caber em um primeiro contato de WhatsApp`);
    assert.doesNotMatch(example.message, /sinergia|objetivo deste contato|identifiquei que|para direcionarmos/i);
    assert.doesNotMatch(`${example.tag} ${example.title} ${example.message}`, new RegExp("pedre" + "iro", "i"));
  }
});

test("persiste o planejador de prestadores sem misturar os dados do cliente", () => {
  const state = normalizeEmployeeState({
    messages: {
      audience: "Prestador",
      name: "Cliente preservado",
      provider: {
        profile: "Empresa",
        name: "Carlos",
        type: "Instalação de portas e esquadrias",
        region: "Matão",
        objective: "manter contato para futuras indicações",
        question: "posso enviar nosso portfólio?",
      },
    },
  });

  assert.equal(state.schemaVersion, GUIDE_STATE_VERSION);
  assert.equal(state.messages.audience, "Prestador");
  assert.equal(state.messages.name, "Cliente preservado");
  assert.deepEqual(state.messages.provider, {
    profile: "Empresa",
    name: "Carlos",
    type: "Instalação de portas e esquadrias",
    region: "Matão",
    objective: "manter contato para futuras indicações",
    question: "posso enviar nosso portfólio?",
  });

  const legacy = normalizeEmployeeState({ messages: { name: "João" } });
  assert.equal(legacy.messages.audience, "Cliente");
  assert.equal(legacy.messages.name, "João");
  assert.deepEqual(legacy.messages.provider, { profile: "Prestador de Serviço", name: "", type: "", region: "", objective: "", question: "" });
});

test("expõe o modo separado de prestadores com seleção acessível", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const moduleSource = await readFile(new URL("../app/lib/provider-message.mjs", import.meta.url), "utf8");

  assert.match(page, /Prestador \/ parceiro/);
  assert.match(page, /aria-pressed=\{messageAudience === "Prestador"\}/);
  assert.match(page, /aria-pressed=\{providerProfile === "Empresa"\}/);
  assert.match(page, /aria-pressed=\{providerProfile === "Prestador de Serviço"\}/);
  assert.match(page, />Empresas</);
  assert.match(page, />Prestador de Serviço</);
  assert.match(page, /providerMessageExamples/);
  assert.doesNotMatch(`${page}\n${moduleSource}`, new RegExp("pedre" + "iro", "i"));
  assert.doesNotMatch(moduleSource, /GPT|OpenAI/i);
});
