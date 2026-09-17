import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  FAIR_VARIATION_COUNT,
  buildFairMessage,
  fairClientProfiles,
  fairEmojiModes,
  fairInterestOptions,
  fairToneOptions,
  fairVariationRecipe,
  nextFairVariation,
} from "../app/lib/fair-message.mjs";
import { normalizeEmployeeState } from "../app/api/data/state-contract.mjs";

test("monta um convite personalizado e pronto para WhatsApp", () => {
  const message = buildFairMessage({
    profileId: "quote",
    clientName: "Carlos",
    consultantName: "Ícaro",
    interest: "Porta de alumínio",
    channel: "WhatsApp",
    tone: "welcoming",
    eventDate: "sábado, 29/08",
    eventTime: "das 9h às 17h",
    city: "Araraquara",
    discount: "até 60% OFF",
    includeEmojis: true,
  });

  for (const expected of ["Carlos", "Ícaro", "porta de alumínio", "sábado, 29/08", "das 9h às 17h", "Araraquara", "até 60% OFF", "portas e janelas de aço, alumínio e madeira"]) {
    assert.match(message, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
  assert.match(message, /orçamento que preparamos/i);
  assert.match(message, /\p{Extended_Pictographic}/u);
  assert.match(message, /\?$/);
});

test("gera convite neutro sem depender dos campos opcionais", () => {
  const message = buildFairMessage({
    clientName: "   ",
    consultantName: null,
    interest: undefined,
    channel: "WhatsApp",
  });

  assert.match(message, /^Oi! Tudo bem\?/);
  assert.match(message, /equipe da Mult Portas/);
  assert.match(message, /convite da Mult Portas/);
  assert.doesNotMatch(message, /undefined|null|nan|\[nome\]|\[produto\]|\[consultor\]/i);
  assert.doesNotMatch(message, / {2,}/);
  assert.match(message, /\?$/);
});

test("mantém as 6.048 combinações de perfil, tom, canal e variação completas e cordiais", () => {
  assert.equal(fairClientProfiles.length, 7);
  assert.equal(fairToneOptions.length, 3);
  assert.equal(FAIR_VARIATION_COUNT, 144);
  assert.ok(fairInterestOptions.length >= 5);

  for (const profile of fairClientProfiles) {
    for (const tone of fairToneOptions) {
      for (const channel of ["WhatsApp", "Áudio"]) {
        for (let variation = 0; variation < FAIR_VARIATION_COUNT; variation += 1) {
          const message = buildFairMessage({
            profileId: profile.id,
            tone: tone.id,
            channel,
            clientName: "Cliente",
            consultantName: "Consultor",
            interest: "porta de madeira",
            variation,
          });
          assert.ok(message.length > 260 && message.length < 1200, `${profile.id}/${tone.id}/${channel}/${variation} deve ter tamanho utilizável`);
          assert.match(message, /Feirão SUPER PROMO MULT PORTAS/);
          assert.match(message, /Araraquara/);
          assert.match(message, /60%/);
          assert.match(message, /\?$/);
          assert.doesNotMatch(message, /undefined|null|nan|placeholder|\[object Object\]|menor preço|última chance|você sumiu|garantido/i);
          assert.doesNotMatch(message, /\bTODO\b/);
          assert.doesNotMatch(message, / {2,}|\?\?|!!|\.\.|\{\{|\}\}|<%|%>/);
          if (channel === "Áudio") {
            assert.doesNotMatch(message, /\p{Extended_Pictographic}/u);
            assert.doesNotMatch(message, /\n/);
            assert.match(message, /sábado, dia 29 de agosto/);
            assert.match(message, /60% de desconto/);
          }
        }
      }
    }
  }
});

test("as 144 versões são realmente diferentes em cada perfil, tom e canal", () => {
  for (const profile of fairClientProfiles) {
    for (const tone of fairToneOptions) {
      for (const channel of ["WhatsApp", "Áudio"]) {
        const messages = Array.from({ length: FAIR_VARIATION_COUNT }, (_, variation) => buildFairMessage({
          profileId: profile.id,
          tone: tone.id,
          channel,
          clientName: "Marina",
          consultantName: "João D’Ávila",
          interest: "porta pivotante",
          variation,
        }).normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR"));
        assert.equal(new Set(messages).size, FAIR_VARIATION_COUNT, `${profile.id}/${tone.id}/${channel} deve oferecer 144 textos distintos`);
      }
    }
  }
});

test("cada receita muda pelo menos três dimensões editoriais e mantém o corpo único", () => {
  const recipes = Array.from({ length: FAIR_VARIATION_COUNT }, (_, variation) => fairVariationRecipe(variation));
  const bodyRecipes = recipes.map((recipe) => [recipe.context, recipe.event, recipe.benefit, recipe.structure].join("/"));
  assert.equal(new Set(bodyRecipes).size, FAIR_VARIATION_COUNT);

  for (let first = 0; first < recipes.length; first += 1) {
    for (let second = first + 1; second < recipes.length; second += 1) {
      const firstValues = Object.values(recipes[first]);
      const secondValues = Object.values(recipes[second]);
      const distance = firstValues.filter((value, index) => value !== secondValues[index]).length;
      assert.ok(distance >= 3, `receitas ${first} e ${second} devem mudar pelo menos três dimensões`);
    }
  }
});

test("controla nenhum, poucos, equilibrados ou mais emojis sem mudar o texto", () => {
  assert.deepEqual(fairEmojiModes.map((mode) => mode.id), ["mixed", "none", "light", "balanced", "expressive"]);
  const countEmojis = (message) => [...message.matchAll(/\p{Extended_Pictographic}/gu)].length;
  const stripEmojis = (message) => message.replace(/\p{Extended_Pictographic}/gu, "").replace(/\s+/g, " ").trim();
  const expectedCounts = new Map([["none", 0], ["light", 1], ["balanced", 2], ["expressive", 4]]);

  for (let variation = 0; variation < FAIR_VARIATION_COUNT; variation += 1) {
    const inputs = {
      profileId: "store-visit",
      tone: "welcoming",
      channel: "WhatsApp",
      clientName: "Marina",
      consultantName: "Ícaro",
      interest: "porta de madeira",
      variation,
    };
    const plain = buildFairMessage({ ...inputs, emojiMode: "none" });
    for (const [emojiMode, expectedCount] of expectedCounts) {
      const message = buildFairMessage({ ...inputs, emojiMode });
      const emojis = [...message.matchAll(/\p{Extended_Pictographic}/gu)].map((match) => match[0]);
      assert.equal(emojis.length, expectedCount, `${emojiMode}/${variation} deve respeitar a quantidade de emojis`);
      assert.equal(new Set(emojis).size, emojis.length, `${emojiMode}/${variation} não deve repetir emoji`);
      assert.equal(stripEmojis(message), stripEmojis(plain), `${emojiMode}/${variation} não pode alterar a redação`);
    }
    const audio = buildFairMessage({ ...inputs, channel: "Áudio", emojiMode: "expressive" });
    assert.equal(countEmojis(audio), 0);
  }

  const mixedCounts = new Set(Array.from({ length: FAIR_VARIATION_COUNT }, (_, variation) => countEmojis(buildFairMessage({
    profileId: "neutral",
    channel: "WhatsApp",
    emojiMode: "mixed",
    variation,
  }))));
  assert.deepEqual([...mixedCounts].sort((a, b) => a - b), [0, 1, 2, 4]);
});

test("preserva todos os dados reais em cada versão sem inventar outra condição", () => {
  for (const channel of ["WhatsApp", "Áudio"]) {
    for (let variation = 0; variation < FAIR_VARIATION_COUNT; variation += 1) {
      const message = buildFairMessage({
        profileId: "construction",
        tone: "persuasive",
        channel,
        clientName: "Ana Clara",
        consultantName: "João D’Ávila",
        interest: "porta de alumínio branco",
        eventName: "Feirão Portas Abertas",
        eventDate: "31/08/2026",
        eventTime: "das 19h30 às 21h",
        city: "São José dos Campos",
        discount: "até 17% OFF",
        variation,
      });

      for (const fact of ["Ana Clara", "João D’Ávila", "porta de alumínio branco", "Feirão Portas Abertas", "das 19h30 às 21h", "São José dos Campos", "17%"] ) {
        assert.match(message, new RegExp(fact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
      }
      assert.deepEqual([...message.matchAll(/\d+(?:[.,]\d+)?%/g)].map((match) => match[0]), ["17%"]);
      assert.match(message, channel === "Áudio" ? /dia 31 de agosto de 2026/ : /31\/08\/2026/);
      assert.match(message, channel === "Áudio" ? /17% de desconto/ : /até 17% OFF/);
      assert.doesNotMatch(message, /60%|50%|últimas unidades|só hoje|garantia de preço|estoque garantido/i);
      assert.match(message, /\?$/);
    }
  }
});

test("o sorteio sempre avança para outra versão válida, mesmo com o mesmo número aleatório", () => {
  for (let current = 0; current < FAIR_VARIATION_COUNT; current += 1) {
    for (const randomValue of [0, 0, 1, 22, 23, 999_999, Number.NaN, Number.POSITIVE_INFINITY]) {
      const next = nextFairVariation(current, randomValue);
      assert.ok(Number.isInteger(next));
      assert.ok(next >= 0 && next < FAIR_VARIATION_COUNT);
      assert.notEqual(next, current);
    }
  }

  let current = 0;
  const visited = new Set([current]);
  for (let index = 1; index < FAIR_VARIATION_COUNT; index += 1) {
    current = nextFairVariation(current, 0);
    visited.add(current);
  }
  assert.equal(visited.size, FAIR_VARIATION_COUNT);
});

test("adapta a abertura ao contexto sem cobrar ou inventar histórico", () => {
  const expectedByProfile = new Map([
    ["neutral", /convite da Mult Portas/i],
    ["quote", /orçamento que preparamos/i],
    ["store-visit", /receber você na Mult Portas/i],
    ["reengagement", /rotina corre/i],
    ["construction", /obra ou reforma/i],
    ["price", /valor faz diferença/i],
    ["returning", /tempo que a gente não se fala/i],
  ]);

  for (const [profileId, expected] of expectedByProfile) {
    const message = buildFairMessage({ profileId, channel: "WhatsApp", tone: "welcoming" });
    assert.match(message, expected);
    assert.doesNotMatch(message, /não respondeu|estou aguardando|perdeu|acabando|garantido/i);
  }
});

test("salva e normaliza a personalização do Feirão por funcionário", () => {
  const state = normalizeEmployeeState({
    messages: {
      fair: {
        profileId: "price",
        clientName: "  Carlos  ",
        consultantName: "  Ícaro  ",
        interest: "  porta de alumínio  ",
        channel: "Áudio",
        tone: "persuasive",
        eventDate: "  domingo, 30/08  ",
        eventTime: "  das 10h às 16h  ",
        city: "  Matão  ",
        discount: "  até 50% OFF  ",
        includeEmojis: false,
      },
    },
  });

  assert.deepEqual(state.messages.fair, {
    profileId: "price",
    clientName: "Carlos",
    consultantName: "Ícaro",
    interest: "porta de alumínio",
    channel: "Áudio",
    tone: "persuasive",
    eventDate: "domingo, 30/08",
    eventTime: "das 10h às 16h",
    city: "Matão",
    discount: "até 50% OFF",
    emojiMode: "none",
    includeEmojis: false,
  });

  const legacy = normalizeEmployeeState({ messages: {} });
  assert.deepEqual(legacy.messages.fair, {
    profileId: "neutral",
    clientName: "",
    consultantName: "",
    interest: "",
    channel: "WhatsApp",
    tone: "welcoming",
    eventDate: "sábado, 29/08",
    eventTime: "das 9h às 17h",
    city: "Araraquara",
    discount: "até 60% OFF",
    emojiMode: "mixed",
    includeEmojis: true,
  });
});

test("expõe uma aba acessível com personalização, prévia e modelos prontos", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(page, /id: "fair", label: "Convite Feirão"/);
  assert.match(page, /section === "fair"/);
  assert.match(page, /aria-pressed=\{fairProfileId === profile\.id\}/);
  assert.match(page, /Nome do cliente \(opcional\)/);
  assert.match(page, /Interesse ou produto \(opcional\)/);
  assert.match(page, /WhatsApp/);
  assert.match(page, /Áudio/);
  assert.match(page, /Sete convites prontos/);
  assert.match(page, /Gerar outra versão/);
  assert.match(page, /EMOJIS NA MENSAGEM/);
  assert.match(page, /fairEmojiModes\.map/);
  assert.match(page, /aria-label="Quantidade de emojis"/);
  assert.match(page, /function randomizeFairMessage\(\)/);
  assert.match(page, /window\.crypto\.getRandomValues/);
  assert.match(page, /nextFairVariation\(current, randomValues\[0\]\)/);
  assert.match(page, /variation: fairVariation/);
  assert.match(page, /copyMessage\(fairMessage/);
  assert.match(css, /\.fair-layout/);
  assert.match(css, /\.fair-randomizer/);
  assert.match(css, /\.fair-randomize-button/);
  assert.match(css, /\.fair-emoji-options/);
  assert.match(css, /\.fair-template-grid/);
});
