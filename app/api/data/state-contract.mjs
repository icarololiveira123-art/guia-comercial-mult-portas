import {
  dalcomadKitFillings,
  dalcomadKitRequadros,
  isEligibleDalcomadKitItem,
  isKnownDalcomadKitCombination,
  normalizeDalcomadKitSelection,
  parseDalcomadKitPrice,
} from "../../lib/dalcomad-kit.mjs";

export const GUIDE_STATE_VERSION = 4;

const MAX_COLLECTION = 240;
const SKILL_IDS = ["acolhimento", "diagnostico", "precisao", "valor", "proximoPasso"];
const TOTAL_TRAINING_SCENARIOS = 16;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value, maxLength = 240) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanNumber(value, max = 1_000_000) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(max, number)) : 0;
}

function cleanInteger(value, max = 1_000_000) {
  return Math.round(cleanNumber(value, max));
}

function cleanStringArray(value, maxItems = MAX_COLLECTION, maxLength = 120) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanString(item, maxLength)).filter(Boolean))].slice(-maxItems);
}

function normalizeMetrics(value) {
  const source = isRecord(value) ? value : {};
  const quotes = cleanInteger(source.quotes);
  const officialQuotes = Math.min(cleanInteger(source.officialQuotes), quotes);
  return {
    leads: cleanInteger(source.leads),
    quotes,
    officialQuotes,
    incompleteQuotes: Math.min(cleanInteger(source.incompleteQuotes), Math.max(0, quotes - officialQuotes)),
    followups: Math.min(cleanInteger(source.followups), quotes),
    closed: Math.min(cleanInteger(source.closed), quotes),
    ticket: cleanNumber(source.ticket, 100_000_000),
  };
}

function normalizeSkillScores(value) {
  const source = isRecord(value) ? value : {};
  return Object.fromEntries(SKILL_IDS.map((skill) => [skill, cleanInteger(source[skill], 10)]));
}

function normalizeScenarioStats(value) {
  if (!isRecord(value)) return {};
  const result = {};
  for (const [scenarioId, raw] of Object.entries(value).slice(0, 80)) {
    const id = cleanString(scenarioId, 80);
    if (!id || ["__proto__", "prototype", "constructor"].includes(id) || !isRecord(raw)) continue;
    result[id] = {
      attempts: cleanInteger(raw.attempts, 10_000),
      best: cleanInteger(raw.best, 10),
      lastScore: cleanInteger(raw.lastScore, 10),
      lastPracticedAt: cleanString(raw.lastPracticedAt, 40) || null,
    };
  }
  return result;
}

function normalizeTraining(value) {
  const source = isRecord(value) ? value : {};
  const scoreHistory = Array.isArray(source.scoreHistory)
    ? source.scoreHistory.map((score) => cleanInteger(score, 10)).slice(-120)
    : [];
  const skillHistory = Array.isArray(source.skillHistory)
    ? source.skillHistory.filter(isRecord).map(normalizeSkillScores).slice(-120)
    : [];
  const bestFromHistory = scoreHistory.length ? Math.max(...scoreHistory) : 0;
  return {
    rounds: cleanInteger(source.rounds ?? source.sessions, 100_000),
    best: Math.max(cleanInteger(source.best, 10), bestFromHistory),
    scenarios: cleanStringArray(source.scenarios, 80, 80),
    scoreHistory,
    skillHistory,
    scenarioStats: normalizeScenarioStats(source.scenarioStats),
    lastPracticedAt: cleanString(source.lastPracticedAt, 40) || null,
  };
}

function normalizeFollowUps(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).slice(-MAX_COLLECTION).map((item, index) => ({
    id: cleanString(item.id, 80) || `registro-${index + 1}`,
    client: cleanString(item.client, 160),
    status: cleanString(item.status, 80) || "Aguardando retorno",
    next: cleanString(item.next, 240),
    priority: ["Alta", "Média", "Baixa"].includes(item.priority) ? item.priority : "Média",
    done: item.done === true,
  })).filter((item) => item.client || item.next);
}

function normalizeMessages(value) {
  const source = isRecord(value) ? value : {};
  const proof = isRecord(source.proof) ? source.proof : {};
  const provider = isRecord(source.provider) ? source.provider : {};
  const fair = isRecord(source.fair) ? source.fair : {};
  const fairEmojiMode = ["mixed", "none", "light", "balanced", "expressive"].includes(fair.emojiMode)
    ? fair.emojiMode
    : fair.includeEmojis === false ? "none" : "mixed";
  return {
    audience: source.audience === "Prestador" ? "Prestador" : "Cliente",
    name: cleanString(source.name, 120),
    line: cleanString(source.line, 160),
    environment: cleanString(source.environment, 160),
    objective: cleanString(source.objective, 240),
    question: cleanString(source.question, 240),
    channel: ["WhatsApp", "Áudio"].includes(source.channel) ? source.channel : "WhatsApp",
    tone: ["Consultivo", "Direto", "Próximo"].includes(source.tone) ? source.tone : "Consultivo",
    proof: {
      company: proof.company !== false,
      quality: proof.quality !== false,
      guarantee: proof.guarantee !== false,
    },
    provider: {
      profile: provider.profile === "Empresa" ? "Empresa" : "Prestador de Serviço",
      name: cleanString(provider.name, 120),
      type: cleanString(provider.type, 160),
      region: cleanString(provider.region, 160),
      objective: cleanString(provider.objective, 240),
      question: cleanString(provider.question, 240),
    },
    fair: {
      profileId: ["neutral", "quote", "store-visit", "reengagement", "construction", "price", "returning"].includes(fair.profileId) ? fair.profileId : "neutral",
      clientName: cleanString(fair.clientName, 120),
      consultantName: cleanString(fair.consultantName, 120),
      interest: cleanString(fair.interest, 160),
      channel: fair.channel === "Áudio" ? "Áudio" : "WhatsApp",
      tone: ["welcoming", "direct", "persuasive"].includes(fair.tone) ? fair.tone : "welcoming",
      eventDate: cleanString(fair.eventDate, 80) || "sábado, 29/08",
      eventTime: cleanString(fair.eventTime, 80) || "das 9h às 17h",
      city: cleanString(fair.city, 120) || "Araraquara",
      discount: cleanString(fair.discount, 80) || "até 60% OFF",
      emojiMode: fairEmojiMode,
      includeEmojis: fairEmojiMode !== "none",
    },
  };
}

function normalizeFactory(value) {
  const legacy = isRecord(value) ? value : {};
  const items = Array.isArray(value) ? value : Array.isArray(legacy.items) ? legacy.items : [];
  const legacyColor = cleanString(legacy.color, 180);
  const legacyFinish = cleanString(legacy.finish, 180);
  return items.filter(isRecord).flatMap((item, index) => {
    const id = cleanString(item.id, 80) || `item-${index + 1}`;
    if (id.startsWith("sample-") || !isEligibleDalcomadKitItem(item)) return [];
    const selection = normalizeDalcomadKitSelection(item, { color: legacyColor, finish: legacyFinish });
    if (!isKnownDalcomadKitCombination(selection)) return [];
    const requadroValue = cleanString(item.requadro, 180).toLocaleUpperCase("pt-BR");
    const fillingValue = cleanString(item.filling, 180).toLocaleUpperCase("pt-BR");
    const withoutLock = parseDalcomadKitPrice(item.priceWithoutLock);
    const withLock = parseDalcomadKitPrice(item.priceWithLock);
    const normalized = {
      id: cleanString(item.id, 80) || `item-${index + 1}`,
      manufacturer: "DALCOMAD",
      description: "KIT PORTA",
      opening: "ABRIR",
      leafMeasure: cleanString(item.leafMeasure, 180),
      requadro: requadroValue === "A CONFIRMAR" ? "A confirmar" : dalcomadKitRequadros.includes(requadroValue) ? requadroValue : "",
      color: selection.color,
      line: selection.line,
      finish: selection.finish,
      filling: fillingValue === "A CONFIRMAR" ? "A confirmar" : dalcomadKitFillings.includes(fillingValue) ? fillingValue : "",
      priceWithoutLock: withoutLock === null || withoutLock === "" ? "" : String(withoutLock),
      priceWithLock: withLock === null || withLock === "" ? "" : String(withLock),
    };
    const hasTechnicalContent = [
      normalized.leafMeasure,
      normalized.requadro,
      normalized.color,
      normalized.line,
      normalized.finish,
      normalized.filling,
      normalized.priceWithoutLock,
      normalized.priceWithLock,
    ].some(Boolean);
    return hasTechnicalContent ? [normalized] : [];
  }).slice(-MAX_COLLECTION);
}

function normalizeDrawerChecks(value) {
  if (!isRecord(value)) return {};
  const result = {};
  for (const [itemId, checks] of Object.entries(value).slice(0, MAX_COLLECTION)) {
    const id = cleanString(itemId, 80);
    if (!id || ["__proto__", "prototype", "constructor"].includes(id)) continue;
    result[id] = cleanStringArray(checks, 40, 180);
  }
  return result;
}

export function normalizeEmployeeState(value) {
  const source = isRecord(value) ? value : {};
  return {
    schemaVersion: GUIDE_STATE_VERSION,
    sales: cleanStringArray(source.sales, 120, 80),
    timing: cleanStringArray(source.timing, 120, 80),
    followups: normalizeFollowUps(source.followups),
    checks: cleanStringArray(source.checks, 120, 80),
    metrics: normalizeMetrics(source.metrics),
    training: normalizeTraining(source.training),
    messages: normalizeMessages(source.messages),
    factory: normalizeFactory(source.factory),
    drawerChecks: normalizeDrawerChecks(source.drawerChecks),
  };
}

export function summarizeEmployeeState(value) {
  const state = normalizeEmployeeState(value);
  const scores = state.training.scoreHistory;
  const averageScore = scores.length ? scores.reduce((total, score) => total + score, 0) / scores.length : 0;
  const scenarioCoverage = Math.min(state.training.scenarios.length / TOTAL_TRAINING_SCENARIOS, 1);
  const consistency = Math.min(state.training.rounds / 12, 1);
  const learningIndex = scores.length ? Math.round((averageScore / 10) * 60 + scenarioCoverage * 25 + consistency * 15) : 0;
  const skillAverages = Object.fromEntries(SKILL_IDS.map((skill) => {
    const total = state.training.skillHistory.reduce((sum, entry) => sum + cleanInteger(entry[skill], 10), 0);
    return [skill, state.training.skillHistory.length ? Math.round(total / state.training.skillHistory.length) : 0];
  }));
  const weakestSkill = state.training.skillHistory.length
    ? SKILL_IDS.reduce((weakest, skill) => skillAverages[skill] < skillAverages[weakest] ? skill : weakest, SKILL_IDS[0])
    : null;

  return {
    learningIndex,
    averageScore: Number(averageScore.toFixed(1)),
    rounds: state.training.rounds,
    bestScore: state.training.best,
    scenariosPracticed: state.training.scenarios.length,
    weakestSkill,
    lastPracticedAt: state.training.lastPracticedAt,
    quotes: state.metrics.quotes,
    closed: state.metrics.closed,
    pendingFollowUps: state.followups.filter((item) => !item.done).length,
    preparedFactoryItems: state.factory.length,
  };
}
