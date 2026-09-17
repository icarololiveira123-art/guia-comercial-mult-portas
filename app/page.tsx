"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthScreen } from "./auth-screen";
import { guidedCustomerReply } from "./api/coach/customer-policy.mjs";
import {
  availableDalcomadKitValues,
  dalcomadKitColors,
  dalcomadKitCombinations,
  dalcomadKitFillings,
  dalcomadKitFinishes,
  dalcomadKitLines,
  dalcomadKitRequadros,
  getDalcomadKitSwatch,
  isEligibleDalcomadKitItem,
  isKnownDalcomadKitCombination,
  normalizeDalcomadKitSelection,
  parseDalcomadKitPrice,
} from "./lib/dalcomad-kit.mjs";
import { downloadWorkbook } from "./lib/xlsx-export.mjs";
import {
  FAIR_VARIATION_COUNT,
  buildFairMessage,
  fairClientProfiles,
  fairEmojiModes,
  fairInterestOptions,
  fairToneOptions,
  nextFairVariation,
} from "./lib/fair-message.mjs";
import {
  buildProviderMessage,
  providerCompanyGoalOptions,
  providerCompanyMessageExamples,
  providerCompanyQuestionOptions,
  providerCompanyTypeOptions,
  providerGoalOptions,
  providerMessageExamples,
  providerQuestionOptions,
  providerTypeOptions,
} from "./lib/provider-message.mjs";

type Section = "overview" | "script" | "seller" | "training" | "timing" | "messages" | "fair" | "factory" | "catalog" | "control" | "management";
type BrandId = "dalcomad" | "destak" | "casmavi" | "aluan" | "brimak" | "brasil" | "crv" | "lucasa" | "riobras";
type Priority = "Alta" | "Média" | "Baixa";
type TrainingLevel = "Básico" | "Intermediário" | "Avançado";
type TrainingFilter = "Todos" | TrainingLevel;
type QuickMessageChannel = "WhatsApp" | "Áudio";
type QuickMessageTone = "Consultivo" | "Direto" | "Próximo";
type QuickMessageAudience = "Cliente" | "Prestador";
type ProviderPresentationProfile = "Empresa" | "Prestador de Serviço";
type FairProfileId = "neutral" | "quote" | "store-visit" | "reengagement" | "construction" | "price" | "returning";
type FairTone = "welcoming" | "direct" | "persuasive";
type FairEmojiMode = "mixed" | "none" | "light" | "balanced" | "expressive";
type SaveStatus = "idle" | "saving" | "saved" | "offline" | "error" | "conflict";
type ToastKind = "success" | "error" | "info";

type EmployeeUser = {
  id: number;
  username: string;
  displayName: string;
  branch: "Araraquara" | "São Carlos";
};

type AuthMode = "login" | "register";

type AuthFormState = {
  displayName: string;
  username: string;
  branch: EmployeeUser["branch"];
  password: string;
  confirmPassword: string;
};

type ProfileFormState = {
  displayName: string;
  username: string;
  branch: EmployeeUser["branch"];
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

type PersistedGuideState = {
  schemaVersion?: unknown;
  sales?: unknown;
  timing?: unknown;
  followups?: unknown;
  checks?: unknown;
  metrics?: unknown;
  training?: unknown;
  messages?: unknown;
  factory?: unknown;
  drawerChecks?: unknown;
};

type EmployeeMetrics = {
  leads: number;
  quotes: number;
  officialQuotes: number;
  incompleteQuotes: number;
  followups: number;
  closed: number;
  ticket: number;
};

type TrainingStats = {
  rounds: number;
  best: number;
  scenarios: string[];
  scoreHistory: number[];
  skillHistory: TrainingSkillScores[];
  scenarioStats: Record<string, {
    attempts: number;
    best: number;
    lastScore: number;
    lastPracticedAt: string | null;
  }>;
  lastPracticedAt: string | null;
};

type TrainingMessage = {
  role: "customer" | "seller";
  text: string;
  audioUrl?: string;
};

type SpeechRecognitionAlternativeLike = { transcript: string };
type SpeechRecognitionResultLike = {
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternativeLike;
};
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type TrainingSkillId = "acolhimento" | "diagnostico" | "precisao" | "valor" | "proximoPasso";
type TrainingSkillScores = Record<TrainingSkillId, number>;

type TrainingFeedback = {
  mode: "contextual" | "guiado";
  score: number;
  phase: string;
  skillScores: TrainingSkillScores;
  summary: string;
  strengths: string[];
  improvements: string[];
  nextMove: string;
  coachQuestion: string;
  retryGuide: string;
  customerReply: string;
  coachNote: string;
  customerMood: string;
  customerNeed: string;
};

type TrainingScenario = {
  id: string;
  level: TrainingLevel;
  tag: string;
  title: string;
  context: string;
  objective: string;
  opening: string;
  customerReplies: string[];
  signals: string[];
  avoid: string[];
};

const trainingSkillMeta: { id: TrainingSkillId; label: string; hint: string }[] = [
  { id: "acolhimento", label: "Acolhimento", hint: "escuta, respeito e segurança" },
  { id: "diagnostico", label: "Diagnóstico", hint: "perguntas que destravam o cenário" },
  { id: "precisao", label: "Precisão", hint: "medida, composição e confirmação" },
  { id: "valor", label: "Valor", hint: "benefício antes do desconto" },
  { id: "proximoPasso", label: "Próximo passo", hint: "ação clara e combinada" },
];

function clampTrainingScore(value: number, fallback = 0) {
  const safeValue = Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(10, Math.round(safeValue)));
}

function isTrainingRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function uniformSkillScores(score: number): TrainingSkillScores {
  const safeScore = clampTrainingScore(score);
  return { acolhimento: safeScore, diagnostico: safeScore, precisao: safeScore, valor: safeScore, proximoPasso: safeScore };
}

function normalizeSkillScores(value: unknown, fallback = 0): TrainingSkillScores {
  const source = isTrainingRecord(value) ? value : {};
  return {
    acolhimento: clampTrainingScore(Number(source.acolhimento), fallback),
    diagnostico: clampTrainingScore(Number(source.diagnostico), fallback),
    precisao: clampTrainingScore(Number(source.precisao), fallback),
    valor: clampTrainingScore(Number(source.valor), fallback),
    proximoPasso: clampTrainingScore(Number(source.proximoPasso), fallback),
  };
}

function averageSkillScores(history: TrainingSkillScores[]): TrainingSkillScores {
  if (!history.length) return uniformSkillScores(0);
  const totals = history.reduce((current, item) => ({
    acolhimento: current.acolhimento + item.acolhimento,
    diagnostico: current.diagnostico + item.diagnostico,
    precisao: current.precisao + item.precisao,
    valor: current.valor + item.valor,
    proximoPasso: current.proximoPasso + item.proximoPasso,
  }), uniformSkillScores(0));
  return {
    acolhimento: clampTrainingScore(totals.acolhimento / history.length),
    diagnostico: clampTrainingScore(totals.diagnostico / history.length),
    precisao: clampTrainingScore(totals.precisao / history.length),
    valor: clampTrainingScore(totals.valor / history.length),
    proximoPasso: clampTrainingScore(totals.proximoPasso / history.length),
  };
}

function emptyTrainingStats(): TrainingStats {
  return {
    rounds: 0,
    best: 0,
    scenarios: [],
    scoreHistory: [],
    skillHistory: [],
    scenarioStats: {},
    lastPracticedAt: null,
  };
}

function normalizeScenarioStats(value: unknown): TrainingStats["scenarioStats"] {
  if (!isTrainingRecord(value)) return {};
  const result: TrainingStats["scenarioStats"] = {};
  for (const [scenarioId, raw] of Object.entries(value).slice(0, 80)) {
    if (!isTrainingRecord(raw) || ["__proto__", "prototype", "constructor"].includes(scenarioId)) continue;
    result[scenarioId.slice(0, 80)] = {
      attempts: Math.max(0, Math.round(Number(raw.attempts) || 0)),
      best: clampTrainingScore(Number(raw.best)),
      lastScore: clampTrainingScore(Number(raw.lastScore)),
      lastPracticedAt: typeof raw.lastPracticedAt === "string" ? raw.lastPracticedAt.slice(0, 40) : null,
    };
  }
  return result;
}
type CatalogItem = {
  id: string;
  brand: BrandId;
  family: string;
  title: string;
  code?: string;
  spec: string;
  bestFor: string;
  pitch: string;
  checks: string[];
  source: "Catálogo enviado" | "Catálogo + site oficial" | "Guia tático + site oficial" | "Site oficial (catálogo não anexado)";
  documentHref?: string;
};

type CatalogDocument = {
  title: string;
  description: string;
  href: string;
  pages: number;
};

type LocalFollowUp = {
  id: string;
  client: string;
  status: string;
  next: string;
  priority: Priority;
  done: boolean;
};

type FactoryRequestItem = {
  id: string;
  manufacturer: string;
  description: string;
  opening: string;
  leafMeasure: string;
  requadro: string;
  color: string;
  line: string;
  finish: string;
  filling: string;
  priceWithoutLock: string;
  priceWithLock: string;
};

type FactoryField = Exclude<keyof FactoryRequestItem, "id">;
type FactoryWizardField = Exclude<FactoryField, "manufacturer" | "description" | "opening">;

const factoryHeaders = [
  "Fabricante",
  "Descrição",
  "Abertura",
  "Medida do kit",
  "Requadro",
  "Cor",
  "Linha",
  "Acabamento",
  "Preench.",
  "VALOR S/ FECH",
  "VALOR C/ FECH CR.",
];

const factoryListOptions: Record<string, readonly string[]> = {
  manufacturers: ["DALCOMAD"],
  descriptions: ["KIT PORTA"],
  openings: ["ABRIR"],
  requadros: dalcomadKitRequadros,
  colors: dalcomadKitColors,
  lines: dalcomadKitLines,
  finishes: dalcomadKitFinishes,
  fillings: dalcomadKitFillings,
  values: [],
};

const factoryWizardSteps: { key: FactoryWizardField; label: string; title: string; hint: string; placeholder: string; listId?: string; optional?: boolean }[] = [
  { key: "leafMeasure", label: "Medida", title: "Qual é a medida do kit?", hint: "Informe a medida usada na requisição Dalcomad, por exemplo: 0,70 x 2,10.", placeholder: "0,70 x 2,10" },
  { key: "requadro", label: "Requadro", title: "Qual requadro precisa?", hint: "Use a medida confirmada do vão ou deixe como A confirmar.", placeholder: "18CM", listId: "factory-requadros" },
  { key: "line", label: "Linha", title: "Qual linha do kit?", hint: "A linha define o acabamento e filtra as cores vistas nas amostras Dalcomad.", placeholder: "ECO", listId: "factory-lines" },
  { key: "finish", label: "Acabamento", title: "Qual acabamento do kit?", hint: "Cada linha usa o acabamento correspondente mostrado na amostra.", placeholder: "PET/PVC TX", listId: "factory-finishes" },
  { key: "color", label: "Cor", title: "Qual cor foi escolhida?", hint: "Escolha somente uma cor disponível para a linha e o acabamento selecionados.", placeholder: "CINZA URBAN", listId: "factory-colors" },
  { key: "filling", label: "Preenchimento", title: "Qual preenchimento?", hint: "Informe o preenchimento do kit ou use A confirmar.", placeholder: "BOONDOOR", listId: "factory-fillings" },
  { key: "priceWithoutLock", label: "Valor sem fechadura", title: "Qual é o valor sem fechadura?", hint: "Campo opcional. Digite o valor informado pela fábrica; nenhum cálculo é feito automaticamente.", placeholder: "R$ 0,00", optional: true },
  { key: "priceWithLock", label: "Valor com fechadura", title: "Qual é o valor com fechadura CR.?", hint: "Campo opcional. Digite o valor informado pela fábrica; nenhum cálculo é feito automaticamente.", placeholder: "R$ 0,00", optional: true },
];

const factoryWizardOptions: Record<FactoryWizardField, readonly string[]> = {
  leafMeasure: [],
  requadro: factoryListOptions.requadros,
  color: factoryListOptions.colors,
  line: factoryListOptions.lines,
  finish: factoryListOptions.finishes,
  filling: factoryListOptions.fillings,
  priceWithoutLock: [],
  priceWithLock: [],
};

function blankFactoryWizard(): Record<FactoryWizardField, string> {
  return {
    leafMeasure: "",
    requadro: "",
    color: "",
    line: "",
    finish: "",
    filling: "",
    priceWithoutLock: "",
    priceWithLock: "",
  };
}

// A requisição começa sem linhas. Cada linha nasce apenas quando um kit é
// concluído no montador e enviado para a requisição Dalcomad.
const defaultFactoryItems: FactoryRequestItem[] = [];

function normalizeFactoryItem(value: unknown, index: number): FactoryRequestItem {
  const source = value && typeof value === "object" ? value as Partial<Record<FactoryField | "id", unknown>> : {};
  const text = (key: FactoryField) => typeof source[key] === "string" || typeof source[key] === "number" ? String(source[key]) : "";
  return {
    id: typeof source.id === "string" ? source.id : `factory-${index + 1}`,
    manufacturer: text("manufacturer"),
    description: text("description"),
    opening: text("opening"),
    leafMeasure: text("leafMeasure"),
    requadro: text("requadro"),
    color: text("color"),
    line: text("line"),
    finish: text("finish"),
    filling: text("filling"),
    priceWithoutLock: text("priceWithoutLock"),
    priceWithLock: text("priceWithLock"),
  };
}

function normalizeFactoryState(value: unknown): FactoryRequestItem[] {
  const objectValue = value && typeof value === "object" && !Array.isArray(value)
    ? value as { items?: unknown; color?: unknown; finish?: unknown }
    : null;
  const rawItems = Array.isArray(value) ? value : objectValue?.items;
  const items = Array.isArray(rawItems) ? rawItems.map((item, index) => normalizeFactoryItem(item, index)) : [];
  const legacyColor = typeof objectValue?.color === "string" ? objectValue.color.trim() : "";
  const legacyFinish = typeof objectValue?.finish === "string" ? objectValue.finish.trim() : "";
  return items
    // Remove as linhas de demonstração e os espaços vazios da versão antiga.
    // Somente os kits Dalcomad enviados continuam disponíveis para exportação.
    .filter((item) => !item.id.startsWith("sample-") && isEligibleDalcomadKitItem(item) && hasFactoryContent(item))
    .map((item) => {
      const selection = normalizeDalcomadKitSelection(item, { color: legacyColor, finish: legacyFinish });
      const normalizedRequadro = item.requadro.trim().toLocaleUpperCase("pt-BR");
      const normalizedFilling = item.filling.trim().toLocaleUpperCase("pt-BR");
      const withoutLock = parseDalcomadKitPrice(item.priceWithoutLock);
      const withLock = parseDalcomadKitPrice(item.priceWithLock);
      return {
        ...item,
        manufacturer: "DALCOMAD",
        description: "KIT PORTA",
        opening: "ABRIR",
        requadro: normalizedRequadro === "A CONFIRMAR" ? "A confirmar" : dalcomadKitRequadros.includes(normalizedRequadro) ? normalizedRequadro : "",
        color: selection.color,
        line: selection.line,
        finish: selection.finish,
        filling: normalizedFilling === "A CONFIRMAR" ? "A confirmar" : dalcomadKitFillings.includes(normalizedFilling) ? normalizedFilling : "",
        priceWithoutLock: withoutLock === null || withoutLock === "" ? "" : String(withoutLock),
        priceWithLock: withLock === null || withLock === "" ? "" : String(withLock),
      };
    })
    .filter((item) => isKnownDalcomadKitCombination(item) && hasFactoryContent(item))
    .slice(-240);
}

function hasFactoryContent(item: FactoryRequestItem) {
  return (["leafMeasure", "requadro", "color", "line", "finish", "filling", "priceWithoutLock", "priceWithLock"] as FactoryField[])
    .some((key) => item[key].trim().length > 0);
}

const STORAGE = {
  sales: "mult-portas-guia-sales-v1",
  timing: "mult-portas-guia-timing-v1",
  followups: "mult-portas-guia-followups-v1",
  checks: "mult-portas-guia-checks-v1",
  metrics: "mult-portas-guia-metrics-v1",
  training: "mult-portas-guia-training-v1",
  messages: "mult-portas-guia-messages-v1",
  factory: "mult-portas-guia-factory-v1",
};

function scopedStorageKey(userId: number, key: string) {
  return `mult-portas-guia-user-${userId}-${key}`;
}

function safelyParseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

async function apiFetch(path: string, init: RequestInit = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const sourceSignal = init.signal;
  const abortFromSource = () => controller.abort();
  if (sourceSignal?.aborted) abortFromSource();
  else sourceSignal?.addEventListener("abort", abortFromSource, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(path, { ...init, credentials: "same-origin", signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
    sourceSignal?.removeEventListener("abort", abortFromSource);
  }
}

async function readResponseJson<T>(response: Response): Promise<T> {
  const raw = await response.text();
  if (!raw.trim()) throw new Error("O servidor não respondeu. Tente novamente.");
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error("O servidor enviou uma resposta inválida. Tente novamente.");
  }
}

function writeScopedLocalState(userId: number, key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(scopedStorageKey(userId, key), JSON.stringify(value));
  } catch {
    // Indexed server persistence remains the source of truth when browser storage is unavailable.
  }
}

function clearScopedLocalState(userId: number) {
  if (typeof window === "undefined") return;
  try {
    for (const key of Object.values(STORAGE)) localStorage.removeItem(scopedStorageKey(userId, key));
    localStorage.removeItem(scopedStorageKey(userId, "drawer-checks-v1"));
    localStorage.removeItem(scopedStorageKey(userId, "pending-state-v1"));
  } catch {
    // The server remains authoritative even if browser storage is unavailable.
  }
}

type LocalPendingState = {
  state: PersistedGuideState;
  baseRevision: string | null;
  updatedAt: string;
};

function readLocalPendingState(userId: number): LocalPendingState | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = safelyParseJson(localStorage.getItem(scopedStorageKey(userId, "pending-state-v1")));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const source = parsed as Partial<LocalPendingState>;
    if (!source.state || typeof source.state !== "object" || Array.isArray(source.state)) return null;
    return {
      state: source.state,
      baseRevision: typeof source.baseRevision === "string" ? source.baseRevision : null,
      updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : "",
    };
  } catch {
    return null;
  }
}

function writeLocalPendingState(userId: number, pending: LocalPendingState) {
  writeScopedLocalState(userId, "pending-state-v1", pending);
}

const sections: { id: Section; label: string; icon: string; description: string }[] = [
  { id: "overview", label: "Visão geral", icon: "⌂", description: "Comando do dia" },
  { id: "script", label: "Roteiro de venda", icon: "↗", description: "Do básico ao avançado" },
  { id: "seller", label: "Ser um bom vendedor", icon: "★", description: "Postura e prática" },
  { id: "training", label: "Treino prático", icon: "✦", description: "Simule conversas" },
  { id: "timing", label: "Timing", icon: "◷", description: "Quando agir" },
  { id: "messages", label: "Mensagem rápida", icon: "✎", description: "Planeje e copie" },
  { id: "fair", label: "Convite Feirão", icon: "✉", description: "Personalize e convide" },
  { id: "factory", label: "Requisição fábrica", icon: "▤", description: "Preencha e exporte" },
  { id: "catalog", label: "Catálogo rápido", icon: "▦", description: "Marcas e soluções" },
  { id: "control", label: "Controle", icon: "✓", description: "Pendências e carteira" },
  { id: "management", label: "Gestão", icon: "▥", description: "Indicadores e rotina" },
];

const salesSteps = [
  {
    id: "qualify",
    level: "01",
    title: "Qualifique sem complicar",
    subtitle: "Descubra o cenário antes de abrir o catálogo.",
    questions: [
      "É entrada, área social, quarto, banheiro ou obra em volume?",
      "O cliente precisa otimizar espaço, ganhar presença visual ou acelerar a obra?",
      "É produto, instalação ou solução completa?",
      "Quantas peças e para quando?",
    ],
    line: "Antes de indicar um modelo, vou entender o ambiente e o momento da obra para não te oferecer algo que não encaixe.",
    checkpoint: "Ambiente + objetivo + quantidade + prazo registrados.",
  },
  {
    id: "measure",
    level: "02",
    title: "Trave as medidas certas",
    subtitle: "A medida é parte da venda, não uma etapa escondida.",
    questions: [
      "Qual é a largura e a altura do vão?",
      "A parede é de alvenaria ou drywall?",
      "Qual é o sentido de abertura e há espaço para a folha?",
      "O vão já está pronto ou ainda está em obra?",
    ],
    line: "Vou confirmar o vão antes de fechar a recomendação. A referência interna é porta + 7 cm na largura e porta + 5 cm na altura, sempre validando a especificação do fabricante.",
    checkpoint: "Medidas, parede, abertura e estágio da obra conferidos.",
  },
  {
    id: "recommend",
    level: "03",
    title: "Indique uma solução",
    subtitle: "Uma recomendação principal e uma alternativa clara.",
    questions: [
      "Para entrada e área social: pivotante ou presença visual?",
      "Para ganhar espaço: correr ou solução compacta?",
      "Para quartos, banheiros ou volume: giro, veneziana ou linha prática?",
      "O cliente valoriza rapidez, estética, manutenção ou preço?",
    ],
    line: "Pelo que você me passou, eu começaria por esta solução porque ela atende o uso e evita retrabalho. Se o foco mudar, tenho esta alternativa.",
    checkpoint: "Motivo da indicação explicado em uma frase.",
  },
  {
    id: "proposal",
    level: "04",
    title: "Monte uma proposta comparável",
    subtitle: "Mostre valor, condição e o que está incluso.",
    questions: [
      "O que está incluído: folha, batente, guarnição, ferragens, vidro ou trilho?",
      "Qual é a condição à vista e qual é a condição parcelada?",
      "O preço é referência, alternativa ou venda efetiva?",
      "O que ainda depende de confirmação?",
    ],
    line: "Aqui está a opção principal, o que ela resolve e a alternativa. O que ainda depender de medida, disponibilidade ou prazo fica marcado para confirmação.",
    checkpoint: "Valores exatos, condições e campos ‘A confirmar’ separados.",
  },
  {
    id: "close",
    level: "05",
    title: "Peça o próximo passo",
    subtitle: "Fechamento é uma ação definida, não um ‘qualquer coisa me chama’.",
    questions: [
      "Vamos confirmar a medida ou reservar a opção?",
      "Você prefere avançar à vista ou parcelado?",
      "Posso deixar o retorno combinado para qual dia?",
      "Quem precisa participar da decisão?",
    ],
    line: "Para eu deixar tudo certo, combinamos agora o próximo passo: medida, decisão, pagamento ou retorno em uma data definida.",
    checkpoint: "Próxima ação, responsável e data registrados.",
  },
];

const openingRecommendations = [
  {
    id: "price-opening",
    tag: "Quando o cliente pede só preço",
    title: "Responda e faça uma pergunta",
    advice: "Não bloqueie o atendimento com um ‘depende’. Mostre disponibilidade e descubra o ambiente antes de indicar um valor.",
    message: "Oi, [nome]! Consigo te orientar sim. Essa porta seria para qual ambiente e você já tem a largura x altura do vão? Assim te passo uma opção correta, com qualidade e garantia da linha.",
  },
  {
    id: "photo-opening",
    tag: "Quando chega uma foto",
    title: "Acolha a foto sem medir por ela",
    advice: "A imagem aproxima o cliente, mas não confirma medida, parede ou abertura. Transforme a foto em uma próxima ação simples.",
    message: "Recebi a foto, [nome]. Ela já ajuda a entender o ambiente. Me envie também largura, altura, tipo de parede e lado de abertura para eu filtrar as opções certas.",
  },
  {
    id: "audio-opening",
    tag: "Quando o atendimento é por áudio",
    title: "Fale curto, claro e com direção",
    advice: "Use um áudio de 20 a 35 segundos: repita a necessidade, diga o que vai conferir e feche com uma pergunta.",
    message: "Entendi: você precisa de [linha] para [ambiente], buscando [objetivo]. Vou separar uma opção principal e uma alternativa, sempre conferindo medida, composição, qualidade e garantia. Me confirma só [pergunta-chave]?",
  },
  {
    id: "referral-opening",
    tag: "Quando é indicação ou cliente novo",
    title: "Use confiança antes de catálogo",
    advice: "A prova institucional reduz insegurança, mas deve servir para abrir a conversa — não para substituir o diagnóstico.",
    message: "Oi, [nome]! Seja bem-vindo(a) à Mult Portas. Estamos há 41 anos no mercado e atendemos 85 cidades da região. Vou entender seu ambiente para indicar uma solução de qualidade, com garantia conforme a linha.",
  },
  {
    id: "cold-opening",
    tag: "Quando o cliente está vago",
    title: "Ofereça duas portas de entrada",
    advice: "Perguntas abertas demais cansam. Dê alternativas para o cliente escolher o que pesa mais.",
    message: "Para eu começar pelo caminho certo: você está buscando mais praticidade, economia de espaço, acabamento ou o melhor custo-benefício? E qual ambiente vamos resolver primeiro?",
  },
  {
    id: "volume-opening",
    tag: "Quando é obra ou profissional",
    title: "Organize antes de negociar",
    advice: "Em volume, a melhor iniciação é uma lista comparável: ambiente, quantidade, medidas e prioridade. Depois você discute condição.",
    message: "Consigo estudar a obra com você. Me envie ambiente, quantidade, largura x altura, material desejado e prioridade. Aí separo medidas repetidas, opções de qualidade e o que ainda precisa de confirmação.",
  },
];

const timingSteps = [
  {
    id: "now",
    when: "Durante o atendimento",
    title: "Saia com o próximo passo marcado",
    why: "O cliente ainda está com o problema na cabeça e a informação está fresca.",
    action: "Resuma ambiente, medida, modelo, condição e o que falta. Combine data ou ação antes de encerrar.",
    message: "Para eu não te deixar sem retorno, vou registrar aqui: você precisa de [solução] para [ambiente], na medida [medida]. O próximo passo é [ação] até [data].",
    priority: "Alta" as Priority,
  },
  {
    id: "24h",
    when: "Até 24 horas",
    title: "Confirme recebimento e entendimento",
    why: "Evita que o orçamento fique perdido no WhatsApp ou misturado a outras cotações.",
    action: "Pergunte se recebeu e se a opção atende. Não reenvie um catálogo inteiro: destaque a recomendação.",
    message: "Oi, [nome]. Passando para confirmar se recebeu o orçamento de [solução]. A opção principal foi pensada para [benefício]. Ficou alguma dúvida sobre medida, acabamento ou condição?",
    priority: "Alta" as Priority,
  },
  {
    id: "48h",
    when: "48 a 72 horas",
    title: "Trate a objeção",
    why: "É a janela para descobrir se travou em preço, prazo, medida, estética ou decisão de outra pessoa.",
    action: "Faça uma pergunta de diagnóstico e ofereça uma comparação objetiva: principal x alternativa.",
    message: "Para eu te orientar melhor: o que está pesando mais agora — valor, prazo, modelo ou a decisão de outra pessoa? Se quiser, comparo a opção principal com uma alternativa mais adequada ao seu cenário.",
    priority: "Alta" as Priority,
  },
  {
    id: "7d",
    when: "7 dias",
    title: "Conecte com a fase da obra",
    why: "O timing da porta depende do vão, do acabamento e do cronograma, não apenas do interesse.",
    action: "Pergunte em que etapa a obra está e ajuste a prioridade sem inventar urgência ou disponibilidade.",
    message: "Oi, [nome]. Como está a etapa da obra? Se o vão já estiver pronto, posso revisar medida e solução. Se ainda não, deixamos o retorno no momento certo para evitar retrabalho.",
    priority: "Média" as Priority,
  },
  {
    id: "14d",
    when: "14 dias",
    title: "Defina um status",
    why: "Pendência sem status vira esquecimento e cobrança fora de hora.",
    action: "Classifique como aguardando retorno, não vai fechar agora, transferido, venda fechada ou encerrado — um status principal por cliente.",
    message: "[Nome], vou atualizar seu atendimento para não ficar te cobrando sem necessidade. Você prefere manter a cotação ativa, retomar em outra data ou encerrar por enquanto?",
    priority: "Média" as Priority,
  },
  {
    id: "after",
    when: "Depois da venda",
    title: "Confirme e abra a próxima oportunidade",
    why: "A venda termina quando a especificação está segura; o pós-venda protege o relacionamento.",
    action: "Confirme produto, medida, cor, quantidade, responsável e observações. Depois ofereça complemento coerente.",
    message: "Vou confirmar os detalhes finais: [produto], [medida], [cor], [quantidade] e [condição]. Se fizer sentido para a obra, também posso verificar batente, guarnição, rodapé ou complemento.",
    priority: "Baixa" as Priority,
  },
];

const trainingScenarios: TrainingScenario[] = [
  {
    id: "price-first",
    level: "Básico",
    tag: "Primeiro contato",
    title: "Cliente quer só o preço",
    context: "Um cliente chega pelo WhatsApp e tenta transformar o atendimento em uma consulta rápida de preço.",
    objective: "Abrir o cenário com poucas perguntas antes de indicar um produto ou valor.",
    opening: "Boa tarde! Quanto fica uma porta de 80? Só me passa o preço, por favor.",
    customerReplies: [
      "É para um quarto, mas ainda não medi o vão.",
      "Entendi. Também estou vendo uma opção mais barata.",
      "Posso te mandar a medida depois. O que você precisa saber primeiro?",
    ],
    signals: ["fazer uma pergunta", "descobrir ambiente", "não inventar valor", "marcar próximo passo"],
    avoid: ["chutar preço", "enviar catálogo inteiro", "responder só ‘depende’"],
  },
  {
    id: "measure-gap",
    level: "Básico",
    tag: "Medida",
    title: "O vão ainda não está confirmado",
    context: "O cliente quer comprar rápido, mas mistura medida da folha com medida do vão.",
    objective: "Explicar por que a medida precisa ser conferida e conduzir o cliente para a informação certa.",
    opening: "Tenho uma parede de 15 cm e quero uma porta de 80. Serve qualquer uma?",
    customerReplies: [
      "A parede é de alvenaria e o vão ainda está aberto.",
      "Eu achei que 80 cm já fosse a medida do espaço. Como confiro?",
      "Se eu te mandar largura e altura do vão, você consegue me orientar?",
    ],
    signals: ["separar folha e vão", "perguntar largura e altura", "confirmar parede", "usar ‘A confirmar’"],
    avoid: ["garantir encaixe", "tratar parede como vão", "prometer prazo sem validação"],
  },
  {
    id: "price-objection",
    level: "Intermediário",
    tag: "Objeção",
    title: "Cliente compara apenas preço",
    context: "O cliente recebeu uma alternativa mais barata e quer que você cubra o valor sem explicar a diferença.",
    objective: "Investigar o que está sendo comparado e defender o conjunto, não entrar em desconto automático.",
    opening: "Na outra loja ficou mais barato. Você consegue cobrir esse preço?",
    customerReplies: [
      "Lá também falaram que era uma porta completa.",
      "Eu não sei se inclui batente e guarnição, vou perguntar.",
      "Se a diferença for por causa do conjunto, pode me explicar o que muda?",
    ],
    signals: ["perguntar o que está incluso", "comparar equivalentes", "explicar benefício", "não prometer desconto"],
    avoid: ["desmerecer concorrente", "igualar sem comparar", "criar urgência falsa"],
  },
  {
    id: "timeline",
    level: "Intermediário",
    tag: "Timing",
    title: "Cliente quer garantir prazo cedo demais",
    context: "A obra ainda está no começo, mas o cliente quer uma promessa de entrega e validade de preço.",
    objective: "Conectar a compra à fase real da obra e registrar o próximo retorno sem prometer o que não foi confirmado.",
    opening: "Vou fechar só mês que vem, mas já quero garantir esse preço e que chega a tempo.",
    customerReplies: [
      "O vão ainda não está pronto, mas a obra começa nesta semana.",
      "Então qual é o melhor momento para eu confirmar?",
      "Você pode deixar anotado para me chamar quando eu estiver nessa etapa?",
    ],
    signals: ["perguntar etapa da obra", "separar referência de confirmação", "combinar data", "não prometer prazo"],
    avoid: ["garantir disponibilidade", "inventar validade", "pressionar o cliente"],
  },
  {
    id: "complex-decision",
    level: "Avançado",
    tag: "Consultivo",
    title: "Família dividida e vários vãos",
    context: "Há mais de um decisor, quatro vãos e preferências diferentes de estética e investimento.",
    objective: "Organizar critérios, propor uma lógica de comparação e sair com uma ação concreta.",
    opening: "Meu marido quer pivotante, eu prefiro algo mais simples e temos quatro vãos para resolver. Por onde começo?",
    customerReplies: [
      "A entrada é o ambiente mais importante, mas nos quartos quero praticidade.",
      "Para a entrada eu aceito investir mais; nos outros vãos preciso controlar o orçamento.",
      "Pode montar uma opção principal e uma alternativa para eu mostrar para ele?",
    ],
    signals: ["separar ambientes", "entender prioridade", "montar principal e alternativa", "combinar decisão"],
    avoid: ["indicar tudo de uma vez", "tratar todos os vãos iguais", "falar em preço sem contexto"],
  },
  {
    id: "pix-discount",
    level: "Intermediário",
    tag: "Condição",
    title: "Cliente pede desconto no Pix",
    context: "O cliente tenta negociar antes de confirmar o que está incluído e compara uma condição de pagamento com outra.",
    objective: "Entender a composição da proposta e responder com transparência, sem prometer desconto ou alterar valor por impulso.",
    opening: "Se eu pagar no Pix você consegue melhorar bastante esse valor?",
    customerReplies: [
      "Ainda não sei se o orçamento inclui batente e guarnição. O que está considerado?",
      "Eu queria comparar à vista com parcelado antes de decidir.",
      "Se a condição ficar clara, consigo conversar com meu marido hoje.",
    ],
    signals: ["entender o que está incluso", "separar condição de preço", "preservar valor exato", "combinar decisão"],
    avoid: ["inventar desconto", "prometer aprovação", "comparar condições diferentes como iguais"],
  },
  {
    id: "photo-only",
    level: "Básico",
    tag: "Diagnóstico",
    title: "Cliente manda só uma foto do vão",
    context: "A foto ajuda a visualizar o ambiente, mas ainda não confirma medidas, parede, abertura ou composição.",
    objective: "Aproveitar a foto sem tratá-la como medição e pedir os dados que realmente destravam a indicação.",
    opening: "Mandei a foto do vão. Já dá para você me passar o modelo e o preço?",
    customerReplies: [
      "Eu não tenho certeza da largura, mas posso medir com uma trena.",
      "A parede é de drywall e quero uma porta para o quarto.",
      "Quais medidas você precisa que eu te envie junto com a foto?",
    ],
    signals: ["valorizar a foto", "pedir largura e altura", "confirmar parede", "deixar o restante A confirmar"],
    avoid: ["medir pela imagem", "garantir modelo", "falar em preço sem composição"],
  },
  {
    id: "space-choice",
    level: "Intermediário",
    tag: "Solução",
    title: "Cliente não sabe entre giro e correr",
    context: "O cliente perdeu área de circulação e quer uma solução que resolva o espaço sem escolher apenas pela aparência.",
    objective: "Investigar uso, espaço disponível e necessidade de passagem antes de comparar giro, correr ou camarão.",
    opening: "Não quero perder espaço. É melhor colocar uma porta de correr ou uma camarão?",
    customerReplies: [
      "É para um banheiro e preciso de privacidade e ventilação.",
      "Tenho uma parede livre de um lado, mas não sei quanto espaço o trilho precisa.",
      "Pode me mostrar a diferença prática entre as duas opções?",
    ],
    signals: ["entender ambiente", "avaliar espaço de recolhimento", "comparar função", "confirmar medida"],
    avoid: ["indicar sem perguntar", "tratar todas as aberturas como iguais", "prometer encaixe"],
  },
  {
    id: "volume-work",
    level: "Avançado",
    tag: "Obra em volume",
    title: "Construtor quer padronizar vários vãos",
    context: "Um profissional precisa resolver várias portas e janelas, mas ainda não separou medidas repetidas, ambientes e prioridade de compra.",
    objective: "Organizar a obra em grupos comparáveis e proteger a especificação antes de buscar o melhor custo.",
    opening: "Tenho uma obra com várias portas e janelas. Se eu fechar tudo junto você consegue fazer um preço melhor?",
    customerReplies: [
      "São três quartos, dois banheiros e uma área social, mas as medidas não são todas iguais.",
      "Quero padronizar o que der e destacar apenas a entrada.",
      "Posso te mandar uma lista com quantidade, ambiente e medidas para você separar as opções?",
    ],
    signals: ["mapear quantidade e ambientes", "separar medidas repetidas", "padronizar por função", "combinar lista de conferência"],
    avoid: ["dar desconto antes de conferir", "misturar itens diferentes", "tratar a obra como um único produto"],
  },
  {
    id: "wood-aluminum",
    level: "Avançado",
    tag: "Comparação técnica",
    title: "Cliente pergunta madeira ou alumínio",
    context: "O cliente quer uma resposta definitiva, mas a escolha depende do ambiente, estética, ventilação, manutenção e composição do projeto.",
    objective: "Transformar a comparação em diagnóstico e indicar a família mais coerente sem forçar uma marca.",
    opening: "Para a minha casa, é melhor porta de madeira ou de alumínio?",
    customerReplies: [
      "É para a entrada, mas também preciso resolver as janelas e a lavanderia.",
      "Gosto da madeira na fachada, mas quero praticidade nos ambientes molhados.",
      "Você consegue montar uma lógica para eu decidir sem comparar produtos diferentes?",
    ],
    signals: ["separar ambientes", "entender prioridade", "comparar função e acabamento", "indicar sem forçar marca"],
    avoid: ["declarar um vencedor universal", "ignorar manutenção", "misturar folha, portal e esquadria"],
  },
  {
    id: "silent-customer",
    level: "Intermediário",
    tag: "Retorno",
    title: "Cliente sumiu depois do orçamento",
    context: "Depois de receber a proposta, o cliente não respondeu. O retorno precisa reabrir a conversa sem cobrança vazia ou pressão.",
    objective: "Retomar com contexto, descobrir o travamento e oferecer uma próxima ação pequena e objetiva.",
    opening: "Desculpa o sumiço. Recebi o orçamento, mas ainda não consegui decidir.",
    customerReplies: [
      "Estou comparando com outra opção e ainda não entendi a diferença.",
      "A obra atrasou e eu não quero comprar antes de confirmar o vão.",
      "Se você me ajudar a resumir a principal e a alternativa, consigo decidir melhor.",
    ],
    signals: ["acolher sem cobrança", "identificar o travamento", "resumir principal e alternativa", "marcar novo timing"],
    avoid: ["dizer só ‘estou passando’", "criar urgência falsa", "encerrar o histórico cedo demais"],
  },
  {
    id: "after-sales",
    level: "Avançado",
    tag: "Pós-venda",
    title: "Cliente relata divergência na entrega",
    context: "O cliente informa que recebeu um item diferente do esperado. Antes de apontar culpa ou prometer solução, é preciso organizar evidências.",
    objective: "Acolher, registrar produto, medida, cor, quantidade e evidências, encaminhando o caso com segurança.",
    opening: "A porta chegou, mas parece diferente do que eu tinha entendido no orçamento. Como resolvemos?",
    customerReplies: [
      "A cor parece mais escura e eu não sei se é o acabamento correto.",
      "Vou te mandar fotos, o número do orçamento e a etiqueta do produto.",
      "Enquanto você confere, posso deixar a peça sem instalar para não piorar a situação?",
    ],
    signals: ["acolher o cliente", "pedir número e evidências", "não prometer solução sem análise", "orientar próximo passo"],
    avoid: ["culpar fornecedor", "garantir troca imediata", "mandar instalar antes de conferir"],
  },
  {
    id: "catalog-request",
    level: "Básico",
    tag: "Curadoria",
    title: "Cliente pede o catálogo inteiro",
    context: "O cliente quer receber todas as opções, mas ainda não explicou ambiente, medida ou objetivo.",
    objective: "Evitar excesso de informação e transformar o pedido em uma indicação curta e útil.",
    opening: "Me manda o catálogo inteiro que eu vejo depois.",
    customerReplies: [
      "É para a entrada, mas ainda não sei se quero algo mais moderno ou clássico.",
      "Se você separar só três opções que façam sentido, eu consigo comparar melhor.",
      "Tenho uma foto da fachada e posso mandar junto com a medida do vão.",
    ],
    signals: ["acolher o pedido", "descobrir ambiente", "fazer curadoria", "combinar envio útil"],
    avoid: ["despejar o catálogo", "indicar sem contexto", "prometer que qualquer modelo serve"],
  },
  {
    id: "installation-question",
    level: "Intermediário",
    tag: "Instalação",
    title: "Cliente pergunta sobre instalação",
    context: "O cliente quer saber se o kit chega pronto e se a instalação será simples, mas ainda não confirmou parede e vão.",
    objective: "Explicar o ganho de praticidade sem prometer serviço, encaixe ou prazo sem validação.",
    opening: "Essa porta já vem pronta para instalar ou vou ter que montar tudo na obra?",
    customerReplies: [
      "É exatamente isso que eu quero: menos etapas e menos sujeira na obra.",
      "A parede é de drywall. O kit muda alguma coisa nesse caso?",
      "Se eu te mandar o vão e o lado de abertura, você confere a composição?",
    ],
    signals: ["explicar kit completo", "confirmar parede", "separar produto de instalação", "pedir vão"],
    avoid: ["garantir instalação sem avaliar", "prometer encaixe", "confundir produto com serviço"],
  },
  {
    id: "finish-choice",
    level: "Intermediário",
    tag: "Acabamento",
    title: "Cliente indeciso sobre cor",
    context: "O cliente está entre branco, cinza e acabamento amadeirado, mas ainda não conectou a escolha ao ambiente.",
    objective: "Usar o ambiente e a composição da obra para reduzir a dúvida sem impor gosto pessoal.",
    opening: "Você acha melhor branca, cinza ou madeira? Estou bem indeciso.",
    customerReplies: [
      "O piso é claro e os móveis são amadeirados, mas não quero escurecer o ambiente.",
      "Gostei do cinza, só não sei se vou enjoar depois.",
      "Pode me mostrar uma opção segura e outra mais marcante para comparar?",
    ],
    signals: ["perguntar sobre ambiente", "conectar cor e luz", "oferecer principal e alternativa", "confirmar acabamento"],
    avoid: ["escolher pelo próprio gosto", "tratar cor de catálogo como estoque", "ignorar iluminação"],
  },
  {
    id: "wet-area",
    level: "Avançado",
    tag: "Diagnóstico técnico",
    title: "Madeira em área molhada",
    context: "O cliente quer manter a estética da madeira em banheiro ou lavanderia, mas a prioridade de uso pode pedir outra solução.",
    objective: "Entender exposição, ventilação e manutenção antes de comparar madeira e alumínio.",
    opening: "Quero uma porta de madeira para a lavanderia. Pode ser a mesma dos quartos?",
    customerReplies: [
      "A lavanderia é coberta, mas pega bastante umidade e fica perto do quintal.",
      "Se o alumínio for mais seguro nesse ambiente, quero entender a diferença visual.",
      "Nos quartos eu mantenho madeira; para a lavanderia você recomenda outra família?",
    ],
    signals: ["investigar umidade", "separar ambientes", "comparar manutenção", "indicar com ressalvas"],
    avoid: ["garantir que qualquer madeira serve", "declarar um material universal", "ignorar manutenção"],
  },
];

const brandData: Record<BrandId, {
  name: string;
  short: string;
  descriptor: string;
  accent: string;
  summary: string;
  when: string[];
  guardrails: string[];
  official: string;
  catalog: string;
  documents?: CatalogDocument[];
}> = {
  dalcomad: {
    name: "Dalcomad | Kit Porta Pronta e Rodapés",
    short: "Dalcomad",
    descriptor: "Kit porta pronta, rodapés e compensados",
    accent: "#c2a16d",
    summary: "A marca central para vender praticidade: kit montado, instalação mais rápida e opções de revestimento, linhas de portas, rodapés e complementos.",
    when: ["obra com pressão de prazo", "ambientes internos", "cliente que quer menos mão de obra", "venda de porta + acabamento"],
    guardrails: ["Confirmar linha, revestimento, cor, preenchimento, sentido de abertura, medida e espessura da parede.", "Separar produto, usinagem, ferragens e instalação na proposta; o kit facilita etapas, mas não substitui a conferência do vão.", "A garantia convencional e a composição final devem ser confirmadas com a especificação vigente."],
    official: "https://dalcomad.com.br/produtos/kit-porta-pronta/",
    catalog: "Guia Tático de Vendas Dalcomad + site oficial",
  },
  destak: {
    name: "Destak / DK Esquadrias",
    short: "Destak",
    descriptor: "Kit porta pronta e portas de madeira",
    accent: "#b5c0ca",
    summary: "A marca mais forte quando o cliente quer reduzir tempo de instalação, organizar o acabamento e comprar uma solução mais completa.",
    when: ["obra com pressão de prazo", "cliente que quer praticidade", "porta de madeira com batente", "padronização em volume"],
    guardrails: ["Confirmar vão, parede, lado de abertura e fechadura.", "Não prometer estoque ou prazo só pela existência no catálogo.", "Separar porta, batente, guarnição, trilho e rodapé na proposta."],
    official: "https://dkesquadrias.com.br/kitporta/",
    catalog: "CATÁLOGO DESTAK 2024.pdf",
  },
  casmavi: {
    name: "Casmavi",
    short: "Casmavi",
    descriptor: "Portais, portas, venezianas, batentes e complementos",
    accent: "#d6a96f",
    summary: "Portfólio amplo para entrada, área social, soluções com vidro, pivotantes, correr, camarão, venezianas, janelas e peças complementares.",
    when: ["cliente busca presença visual", "entrada ou área social", "modelos com vidro, arco ou grade", "projeto com várias soluções de madeira"],
    guardrails: ["O catálogo tem muitas combinações: conferir código, medida final e composição.", "Confirmar se o item é folha, portal montado, batente ou conjunto.", "Para portas especiais e medidas fora do padrão, consultar fabricação e prazo."],
    official: "https://casmavi.com.br/",
    catalog: "CATALOGO NOVO CASMAVI 2025-2026.pdf",
  },
  aluan: {
    name: "Aluan Esquadrias de Alumínio",
    short: "Aluan",
    descriptor: "Portas, balcões, janelas, venezianas e vitrôs",
    accent: "#9aa7b4",
    summary: "Boa escolha para alumínio, iluminação e ventilação, com famílias por linha e opções com ou sem grade, móveis, pivotantes e basculantes.",
    when: ["cliente quer alumínio", "janelas e venezianas", "cozinha, lavanderia ou balcão", "vitrô, maxi-ar ou porta de giro"],
    guardrails: ["Confirmar linha, cor, número de folhas, grade e medida.", "As páginas oficiais destacam branco, preto e brilhante em famílias diferentes; não generalizar para todo item.", "Assistência técnica exige nome do produto, medidas, quantidade, cor e evidências do problema."],
    official: "https://aluanesquadrias.com.br/",
    catalog: "CATÁLOGO ALUAN 2024.pdf",
  },
  brimak: {
    name: "Brimak | Portas e Janelas",
    short: "Brimak",
    descriptor: "Alumínio, PVC e puxadores",
    accent: "#d9a91e",
    summary: "Portfólio de esquadrias de alumínio e PVC com linhas para entrada, circulação, iluminação, ventilação e aproveitamento de espaço.",
    when: ["porta ou janela de alumínio", "entrada com pivotante", "vão com solução de correr", "conforto térmico e acústico em PVC"],
    guardrails: ["Confirmar linha, tipologia, medida, número de folhas, cor, vidro e ferragens do item.", "As cores e composições mudam entre Elite, SUPER 25, L25 e PVC; não generalizar uma opção para todo o portfólio.", "O catálogo geral de 2018 é uma referência histórica: validar modelo, acabamento, estoque e prazo antes de cotar."],
    official: "https://www.brimak.com.br/",
    catalog: "5 catálogos Brimak anexados · edições 2018–2025",
    documents: [
      {
        title: "Linha Elite",
        description: "Pivotantes, janelas, venezianas, portas de correr e basculantes.",
        href: "/catalogos/brimak-linha-elite.pdf",
        pages: 22,
      },
      {
        title: "Linha SUPER 25",
        description: "Portas pivotantes, de giro, clássicas, de correr e portas-balcão.",
        href: "/catalogos/brimak-linha-super-25.pdf",
        pages: 26,
      },
      {
        title: "Linha L25",
        description: "Portas camarão, suspensas e modelos clássicos de alumínio.",
        href: "/catalogos/brimak-linha-l25.pdf",
        pages: 12,
      },
      {
        title: "Smart Solutions PVC",
        description: "Portas e janelas de PVC para diferentes sistemas de abertura.",
        href: "/catalogos/brimak-portas-janelas-pvc.pdf",
        pages: 8,
      },
      {
        title: "Catálogo geral 2018",
        description: "Referência histórica das linhas Brilhante, Branca e Preta.",
        href: "/catalogos/brimak-catalogo-2018.pdf",
        pages: 20,
      },
    ],
  },
  brasil: {
    name: "Brasil Esquadrias",
    short: "Brasil",
    descriptor: "Alumínio, aço, portas, janelas e acessórios",
    accent: "#2c88c6",
    summary: "Catálogo amplo de alumínio e aço, com linhas para portas, janelas, venezianas, vitrôs, portas balcão, alçapões e soluções complementares.",
    when: ["entrada contemporânea", "porta ou janela de alumínio", "obra que pede aço", "cliente que quer acessórios no mesmo fornecedor"],
    guardrails: ["Ler a linha e o perfil antes de comparar: Sublime, Premium, Facility e Soft têm propostas diferentes.", "Confirmar medida, lado, vidro, grade, puxador, cor e composição do conjunto.", "Catálogo e site não garantem estoque ou prazo; validar disponibilidade com a fábrica/representante."],
    official: "https://www.brasilesquadrias.com.br/",
    catalog: "CATALAGO BRASIL 2026_WEB.pdf",
  },
  crv: {
    name: "CRV Portas e Janelas",
    short: "CRV",
    descriptor: "Aço, alumínio, portas, janelas e vitrôs",
    accent: "#5d7f94",
    summary: "Portfólio organizado por linhas de alumínio e aço, com opções pivotantes, lambri, mistas, correr, balcão, janelas e vitrôs.",
    when: ["cliente quer alumínio ou aço", "porta de correr ou balcão", "entrada com pivotante/panorâmica", "janelas e vitrôs em volume"],
    guardrails: ["No catálogo, medida é largura x altura x requadro; confirmar também lado, vão livre e tipo de vidro.", "Nobre, Classic, Standard, Ideal, Inova e Aciaço têm posicionamentos diferentes; não misturar as linhas.", "Confirmar cor, grade, puxador, fechadura, trilho e se o vidro já acompanha o produto."],
    official: "https://www.crvportasejanelas.com.br/",
    catalog: "CATALAGO CRV 2025.pdf",
  },
  lucasa: {
    name: "Lucasa | Ullian",
    short: "Lucasa",
    descriptor: "Portas e janelas com foco em conforto",
    accent: "#6d809a",
    summary: "Marca do Grupo Ullian para portas e janelas, útil quando o cliente busca equilíbrio entre segurança, conforto térmico, iluminação natural e durabilidade.",
    when: ["entrada e fachada", "cozinha e sala", "dormitório", "lavanderia e banheiro"],
    guardrails: ["O catálogo não está anexado nesta versão: confirmar modelo, linha, medida, cor, vidro e disponibilidade no canal oficial.", "Estanqueidade, resistência ao vento e isolamento dependem do produto específico; não generalizar para qualquer modelo.", "Separar porta, janela, vidro, ferragem e instalação na proposta."],
    official: "https://ullian.com.br/lucasa/",
    catalog: "Catálogo oficial online — arquivo não anexado",
  },
  riobras: {
    name: "Riobras | Ullian",
    short: "Riobras",
    descriptor: "Portas e janelas com foco em custo-benefício",
    accent: "#6e9978",
    summary: "Linha da Ullian para quem prioriza custo-benefício, praticidade e otimização de espaço sem abandonar segurança, conforto e durabilidade.",
    when: ["cliente sensível a preço", "cozinha, sala e entrada", "janelas e portas", "obra com repetição de peças"],
    guardrails: ["Confirmar o modelo no catálogo oficial, pois preço e composição variam por medida e acabamento.", "Não prometer estanqueidade, conforto térmico ou resistência sem validar a especificação do item.", "Registrar medida, cor, vidro, abertura, quantidade e prazo antes de comparar com outra marca."],
    official: "https://ullian.com.br/riobras/",
    catalog: "Catálogo oficial online — arquivo não anexado",
  },
};

const studiedCatalogCount = 10;
const studiedBrandCount = Object.keys(brandData).length;

const catalogItems: CatalogItem[] = [
  {
    id: "dalcomad-kit",
    brand: "dalcomad",
    family: "Kit Porta Pronta",
    title: "Kit Porta Pronta Dalcomad",
    code: "folha + batente/forra + guarnições + vedação; composição a confirmar",
    spec: "Conjunto montado para agilizar a obra, com batente regulável, guarnições/vistas e borracha de vedação; a espuma expansiva entra na instalação conforme especificação.",
    bestFor: "Obra com prazo curto, reforma e cliente que quer reduzir etapas de montagem e acabamento.",
    pitch: "A vantagem é comprar uma solução organizada para a obra: eu confirmo o vão e a composição, e você ganha agilidade sem deixar itens escondidos no orçamento.",
    checks: ["largura, altura e espessura do vão", "alvenaria ou drywall", "linha, cor e revestimento", "usinagem, ferragens e instalação"],
    source: "Guia tático + site oficial",
  },
  {
    id: "dalcomad-master",
    brand: "dalcomad",
    family: "Linhas de portas",
    title: "Linha Master",
    code: "Renolit ou PET-PVC · base dupla de madeira/HDF",
    spec: "Linha de maior foco em acabamento e resistência, com revestimentos Renolit ou PET-PVC e base estruturada; indicada para uma apresentação mais sofisticada.",
    bestFor: "Cliente exigente, ambientes internos de destaque e projetos que valorizam acabamento e resistência à umidade.",
    pitch: "Eu apresentaria a Master quando o acabamento é parte importante da decisão: ela entrega uma leitura mais sofisticada, mas ainda precisamos confirmar cor, medida e composição.",
    checks: ["revestimento Renolit ou PET-PVC", "cor", "preenchimento interno", "medida e sentido de abertura"],
    source: "Guia tático + site oficial",
  },
  {
    id: "dalcomad-slim",
    brand: "dalcomad",
    family: "Linhas de portas",
    title: "Linha Slim",
    code: "acabamento melamínico · medidas especiais sob consulta",
    spec: "Linha de acabamento uniforme e custo-benefício, com base em HDF ou chapa dura; o catálogo de referência trabalha larguras padronizadas e dimensões especiais sob consulta.",
    bestFor: "Quartos, corredores, escritórios e obras que precisam equilibrar preço, padrão e acabamento.",
    pitch: "A Slim é uma boa comparação quando o cliente quer um acabamento organizado sem subir para a especificação mais sofisticada; vamos comparar o que está incluso.",
    checks: ["largura e altura", "acabamento melamínico", "preenchimento", "batente e guarnição"],
    source: "Guia tático + site oficial",
  },
  {
    id: "dalcomad-standard",
    brand: "dalcomad",
    family: "Linhas de portas",
    title: "Linha Standard",
    code: "lâmina natural · base de pinus de reflorestamento",
    spec: "Linha com aparência de madeira natural e foco em equilíbrio entre acabamento, material e compromisso ambiental.",
    bestFor: "Cliente que quer madeira com aparência natural para quartos, salas e ambientes internos.",
    pitch: "Quando a prioridade é sentir a madeira no ambiente, a Standard entra como uma opção natural; eu confirmo a lâmina, a cor e o conjunto antes de fechar.",
    checks: ["lâmina/cor", "medida", "ambiente interno", "batente, guarnição e ferragens"],
    source: "Guia tático + site oficial",
  },
  {
    id: "dalcomad-eco",
    brand: "dalcomad",
    family: "Linhas de portas",
    title: "Linha Eco",
    code: "opção prática para padronização e custo-benefício",
    spec: "Linha de entrada para projetos que precisam de praticidade e uniformidade; acabamento, preenchimento e medida devem ser definidos na ficha do produto.",
    bestFor: "Obras de volume, quartos e clientes que priorizam solução objetiva e orçamento controlado.",
    pitch: "Se o foco é resolver vários ambientes com uma linguagem simples, eu começaria pela Eco e compararia somente o que realmente muda entre as opções.",
    checks: ["acabamento e cor", "preenchimento", "quantidade e medidas repetidas", "itens do kit"],
    source: "Guia tático + site oficial",
  },
  {
    id: "dalcomad-complements",
    brand: "dalcomad",
    family: "Complementos",
    title: "Rodapés e compensados multilaminados",
    code: "rodapés Usual/Ultra · compensados sob especificação",
    spec: "Complementos para aumentar a coerência do acabamento e atender outras necessidades da obra, sem misturar esses itens ao valor da porta sem confirmação.",
    bestFor: "Venda complementar, acabamento da obra e clientes que querem comprar mais etapas em um só atendimento.",
    pitch: "Além da porta, posso conferir se rodapé ou outro complemento resolve uma parte da obra e evita que você precise procurar outro fornecedor.",
    checks: ["altura e acabamento do rodapé", "quantidade de barras", "espessura e aplicação do compensado", "valor separado da porta"],
    source: "Guia tático + site oficial",
  },
  {
    id: "brimak-elite",
    brand: "brimak",
    family: "Linha Elite",
    title: "Portas e janelas Linha Elite",
    code: "pivotantes · correr · venezianas · basculantes",
    spec: "Linha de alumínio com portas de entrada, janelas de 2, 3 e 4 folhas, venezianas, portas de correr e basculantes, em diferentes composições e acabamentos.",
    bestFor: "Entrada principal, dormitórios, fachadas e vãos que pedem iluminação, ventilação ou abertura de correr.",
    pitch: "A Elite reúne soluções para a fachada e para os demais vãos; eu separo a tipologia certa e confirmo medida, folhas, cor e vidro antes da cotação.",
    checks: ["modelo e sistema de abertura", "medida e número de folhas", "cor e tipo de vidro", "puxador, fechadura, persiana ou grade"],
    source: "Catálogo enviado",
    documentHref: "/catalogos/brimak-linha-elite.pdf",
  },
  {
    id: "brimak-super-25",
    brand: "brimak",
    family: "Linha SUPER 25",
    title: "Portas Linha SUPER 25",
    code: "pivotantes · giro · clássicas · correr e balcão",
    spec: "Linha de portas de alumínio com modelos pivotantes, de giro, lambril, clássicos e conjuntos de correr ou balcão com 2, 3, 4 e 6 folhas.",
    bestFor: "Entrada, sala, área de serviço, varanda, sacada e vãos maiores com necessidade de passagem e iluminação.",
    pitch: "A SUPER 25 permite comparar presença na entrada e ganho de passagem nos modelos de correr; definimos primeiro o uso do vão e depois o desenho.",
    checks: ["pivotante, giro, correr ou balcão", "medida e quantidade de folhas", "cor, vidro e lambril", "puxador, fechadura e sentido de abertura"],
    source: "Catálogo enviado",
    documentHref: "/catalogos/brimak-linha-super-25.pdf",
  },
  {
    id: "brimak-l25",
    brand: "brimak",
    family: "Linha L25",
    title: "Portas de alumínio Linha L25",
    code: "camarão · suspensas · clássicas",
    spec: "Linha de portas para uso interno e entrada, com modelos camarão, suspensos e clássicos; as soluções sem giro ajudam a aproveitar melhor a passagem.",
    bestFor: "Divisão de ambientes com pouco espaço, portas internas e entradas que pedem solução funcional e custo-benefício.",
    pitch: "Quando o giro atrapalha, camarão ou suspensa podem liberar a circulação; para a entrada, comparamos os modelos clássicos da mesma linha.",
    checks: ["camarão, suspensa ou clássica", "espaço de recolhimento e vão livre", "medida, cor e vidro", "kit de arremates e ferragens"],
    source: "Catálogo enviado",
    documentHref: "/catalogos/brimak-linha-l25.pdf",
  },
  {
    id: "brimak-pvc",
    brand: "brimak",
    family: "Smart Solutions PVC",
    title: "Portas e janelas de PVC",
    code: "pivotantes · giro · correr · janelas · maxim-ar",
    spec: "Esquadrias com perfis de PVC multicâmaras e reforços internos, incluindo portas pivotantes e de giro, sistemas de correr, janelas e maxim-ar.",
    bestFor: "Projetos que priorizam conforto térmico e acústico, áreas sujeitas à umidade e vãos com solução de correr ou maxim-ar.",
    pitch: "O PVC entra quando conforto e vedação pesam na decisão; eu confirmo a tipologia, o vidro e a instalação adequada para comparar de forma justa.",
    checks: ["sistema de abertura", "medida e reforço do vão", "tipo de vidro e persiana", "cor, ferragens e requisitos de instalação"],
    source: "Catálogo enviado",
    documentHref: "/catalogos/brimak-portas-janelas-pvc.pdf",
  },
  {
    id: "brimak-general-2018",
    brand: "brimak",
    family: "Catálogo geral",
    title: "Linhas Brilhante, Branca e Preta",
    code: "catálogo histórico de produtos · edição 2018",
    spec: "Referência de portas, janelas, venezianas, basculantes e puxadores com acabamentos anodizado brilhante e pintura eletrostática branca ou preta.",
    bestFor: "Identificar famílias e modelos antigos trazidos pelo cliente e preparar uma consulta de equivalência atual.",
    pitch: "Este material ajuda a reconhecer o produto, mas a edição é de 2018; uso como referência e confirmo a versão atual antes de prometer disponibilidade.",
    checks: ["modelo e código reconhecido", "linha e acabamento", "medida, vidro e puxador", "equivalência, disponibilidade e prazo atuais"],
    source: "Catálogo enviado",
    documentHref: "/catalogos/brimak-catalogo-2018.pdf",
  },
  {
    id: "destak-kit",
    brand: "destak",
    family: "Kit porta pronta",
    title: "Kit Porta Pronta",
    spec: "Porta de madeira com batente e guarnição regulável; soluções para alvenaria e drywall.",
    bestFor: "Prazo curto, reforma e cliente que valoriza instalação organizada.",
    pitch: "Você compra uma solução mais completa e reduz etapas de montagem e acabamento na obra.",
    checks: ["tipo de parede", "vão e sentido de abertura", "cor e acabamento", "fechadura e ferragens"],
    source: "Catálogo + site oficial",
  },
  {
    id: "destak-euromax",
    brand: "destak",
    family: "Madeira",
    title: "Linha Euromax",
    code: "lisa ou frisada · batente de aço primer preto",
    spec: "Portas de madeira lisas e frisadas, com opções de batente de aço e medidas catalogadas de 60 a 100 cm.",
    bestFor: "Obras que precisam de padronização, resistência do batente e acabamento escuro.",
    pitch: "A Euromax permite manter a linguagem de madeira e escolher entre lisa ou frisada sem complicar a especificação.",
    checks: ["medida 60/70/80/90/100", "batente preto", "modelo liso ou frisado", "disponibilidade"],
    source: "Catálogo enviado",
  },
  {
    id: "destak-construmax",
    brand: "destak",
    family: "Madeira",
    title: "Linha Construmax",
    code: "lisa ou frisada · batente de aço branco",
    spec: "Portas de madeira lisas e frisadas com batente de aço e pintura branca de acabamento.",
    bestFor: "Ambientes claros e obras que querem um conjunto mais neutro.",
    pitch: "Aqui a porta já conversa com uma obra clara e o batente branco ajuda a manter o conjunto visual mais leve.",
    checks: ["vão", "cor branca", "modelo liso ou frisado", "fechadura"],
    source: "Catálogo enviado",
  },
  {
    id: "destak-colors",
    brand: "destak",
    family: "Acabamentos",
    title: "Cores e base para pintura",
    code: "mogno · branco · angelim · cerejeira · imbuia · HDF",
    spec: "O catálogo aponta cores de madeira e HDF para pintura; o site também apresenta lisas e entalhadas em madeira.",
    bestFor: "Cliente que começa pela cor, pelo ambiente ou pela combinação com piso e móveis.",
    pitch: "Vamos escolher primeiro a linguagem do ambiente; depois travamos modelo, batente e acabamento para o orçamento ficar comparável.",
    checks: ["amostra/cor exata", "luz do ambiente", "disponibilidade", "compatibilidade com batente"],
    source: "Catálogo + site oficial",
  },
  {
    id: "destak-sliding",
    brand: "destak",
    family: "Correr e complementos",
    title: "Trilho de alumínio e rodapé MDF Ultra",
    code: "trilho · mogno, branco, angelim, cerejeira e imbuia",
    spec: "O catálogo apresenta trilho de alumínio para portas de correr e rodapé MDF Ultra com acabamento melamínico.",
    bestFor: "Otimização de espaço e venda complementar de acabamento.",
    pitch: "Se a prioridade é liberar área de circulação, a solução de correr pode ser mais coerente; já o rodapé fecha o acabamento da obra.",
    checks: ["parede livre para correr", "comprimento do trilho", "cor", "rodapé necessário"],
    source: "Catálogo enviado",
  },
  {
    id: "casmavi-portals",
    brand: "casmavi",
    family: "Portais de abrir",
    title: "Realeza, Duquesa, Alteza e Marquesa",
    code: "com ou sem grade; duplo ou abrir",
    spec: "Portais de duas folhas, com modelos com grade e variações de medida final; linhas fortes para entrada e área social.",
    bestFor: "Entrada ampla, fachada e cliente que quer impacto visual.",
    pitch: "Em uma entrada maior, o portal entrega presença e pode ser escolhido entre uma leitura mais clássica, com grade, ou mais limpa.",
    checks: ["número de folhas", "medida final", "grade", "tipo de batente/portal"],
    source: "Catálogo enviado",
  },
  {
    id: "casmavi-opening",
    brand: "casmavi",
    family: "Portas de abrir",
    title: "Americana, Barbara, Mexicana, Milênio, Tuolinho, Florida e Córdoba",
    code: "modelos catalogados em 2 folhas",
    spec: "Família de portas de abrir com opções clássicas, com trava externa, desenhos e combinações de madeira.",
    bestFor: "Entrada ou área social com abertura convencional e escolha estética.",
    pitch: "Quando o cliente não precisa de pivotante, a abertura tradicional oferece mais simplicidade; escolhemos o desenho que conversa com a fachada.",
    checks: ["sentido de abertura", "folga lateral", "modelo", "trava/fechadura"],
    source: "Catálogo enviado",
  },
  {
    id: "casmavi-pivot",
    brand: "casmavi",
    family: "Pivotantes",
    title: "Couro, Clássica, Barcelona, Mix, Egito e Detalhe",
    code: "folhas de 0,72 a 1,22 m em várias séries",
    spec: "Modelos pivotantes com opções montadas em batente caixa 14 e com pivô, além de versões para vidro e arco.",
    bestFor: "Entrada principal e área social com foco em presença, proporção e desenho.",
    pitch: "A pivotante muda a leitura da entrada; primeiro definimos proporção e abertura, depois escolhemos textura, vidro, arco ou grade.",
    checks: ["vão estrutural", "altura e largura da folha", "pivô e batente", "vidro/arco/grade"],
    source: "Catálogo enviado",
  },
  {
    id: "casmavi-glass",
    brand: "casmavi",
    family: "Pivotantes para vidro",
    title: "BBB, Barcelona, Couro longo e Mexicana para vidro",
    code: "vidro reto, arco, 3, 4, 5 ou 7 vidros",
    spec: "Variações com vidro em arco, friso metálico, grade e diferentes composições de vidros.",
    bestFor: "Cliente que quer iluminação, desenho de fachada ou integração visual.",
    pitch: "O vidro pode trazer luz e leveza; vamos decidir se o cliente quer mais transparência, mais desenho ou mais privacidade.",
    checks: ["tipo de vidro", "quantidade de vidros", "arco ou reto", "grade/friso"],
    source: "Catálogo enviado",
  },
  {
    id: "casmavi-special",
    brand: "casmavi",
    family: "Especiais",
    title: "Ripada, Suíça, Madri, Toquio, Fortaleza, Catalunha e Maceió",
    code: "linhas especiais e contemporâneas",
    spec: "Modelos de destaque do catálogo para projetos que pedem textura, friso, desenho ou composição diferenciada.",
    bestFor: "Cliente que já tem uma referência visual ou quer sair do padrão.",
    pitch: "Aqui vale vender o desenho: descubro a referência do cliente e confirmo o modelo exato antes de falar em composição e prazo.",
    checks: ["referência visual", "modelo/código", "medida especial", "prazo de fabricação"],
    source: "Catálogo enviado",
  },
  {
    id: "casmavi-sliding",
    brand: "casmavi",
    family: "Correr",
    title: "Correr quadriculada, panorâmica e BBB friso preto",
    code: "2, 3 ou 4 folhas; reto ou arco",
    spec: "Portas de correr e esquadrias com dimensões catalogadas até conjuntos amplos; opções retas e em arco.",
    bestFor: "Otimização de espaço, vãos maiores e ambientes que precisam de abertura ampla.",
    pitch: "A solução de correr economiza área de giro; no vão maior, comparamos folhas, desenho e medida final antes de fechar.",
    checks: ["comprimento do trilho", "número de folhas", "reto/arco", "medida final"],
    source: "Catálogo enviado",
  },
  {
    id: "casmavi-folding",
    brand: "casmavi",
    family: "Camarão e veneziana",
    title: "Camarão, bang-bang, holandesa e veneziana",
    code: "2 almofadas, 2/12/16 vidros e variações",
    spec: "Portas camarão e venezianas de passagem, armário, bang-bang e holandesa em diferentes composições.",
    bestFor: "Quartos, banheiros, áreas de passagem, armários e situações de pouco espaço.",
    pitch: "Quando o giro atrapalha, a camarão ou a veneziana pode entregar circulação e ventilação com uma linguagem mais leve.",
    checks: ["espaço de recolhimento", "ventilação/privacidade", "número de vidros", "batente e ferragens"],
    source: "Catálogo enviado",
  },
  {
    id: "casmavi-windows",
    brand: "casmavi",
    family: "Janelas e vitrôs",
    title: "Venezianas, vitrô de correr e maxi-ar",
    code: "2/3/4/6 folhas; reto, arco, quadriculado ou panorâmico",
    spec: "Janelas e venezianas de abrir, guilhotina e correr; vitrôs quadriculados, panorâmicos e maxi-ar.",
    bestFor: "Iluminação, ventilação, quartos, cozinhas, lavanderias e fachadas.",
    pitch: "Definimos primeiro ventilação, luz e privacidade; depois escolhemos folhas, grade, arco e tipo de abertura.",
    checks: ["abertura", "folhas", "grade", "medida e arco"],
    source: "Catálogo enviado",
  },
  {
    id: "casmavi-complements",
    brand: "casmavi",
    family: "Complementos",
    title: "Batentes, kit de correr, rodapés e guarnições",
    code: "batentes duplos, caixilho, trilho e perfis sob medida",
    spec: "O catálogo inclui batentes para vidro, arco, caixilho lateral, kit de correr, rodapés e várias guarnições.",
    bestFor: "Aumentar ticket e evitar que o cliente precise comprar partes em lugares diferentes.",
    pitch: "Antes de fechar, vou conferir se o conjunto precisa de batente, guarnição, trilho, rodapé ou complemento para ficar pronto na obra.",
    checks: ["o que acompanha", "perfil e medida", "acabamento", "itens separados"],
    source: "Catálogo enviado",
  },
  {
    id: "aluan-l30",
    brand: "aluan",
    family: "Portas Linha 30",
    title: "Premium, Palheta e Panorâmica",
    code: "Linha 30",
    spec: "Família indicada no site oficial; o catálogo visual apresenta lambril L30, premium pivotante e panorâmica de 2/3 folhas.",
    bestFor: "Cliente que quer alumínio com presença visual e opções de abertura maiores.",
    pitch: "Na Linha 30 eu começaria pela aparência e pela abertura; depois confirmo a composição e a medida disponíveis.",
    checks: ["modelo", "cor", "folhas", "medida e abertura"],
    source: "Catálogo + site oficial",
  },
  {
    id: "aluan-l25",
    brand: "aluan",
    family: "Portas Linha 25 / Master",
    title: "Lambril, friso, vidro, visor e pivotante",
    code: "preta e branca no catálogo/site",
    spec: "Lambril com puxador, friso, vidro, porta social, basculante, pivotante, vidro duplo e visor.",
    bestFor: "Portas de giro, sociais ou pivotantes em alumínio com leitura mais limpa.",
    pitch: "A Linha 25 permite comparar uma porta mais fechada, com vidro, friso ou visor sem sair da mesma família.",
    checks: ["modelo e puxador", "vidro/visor", "cor", "abertura e medida"],
    source: "Catálogo + site oficial",
  },
  {
    id: "aluan-balcony",
    brand: "aluan",
    family: "Portas balcão",
    title: "Veneziana, vitrô e quadriculada",
    code: "3 ou 6 folhas; móveis ou fixas conforme modelo",
    spec: "Portas balcão venezianas e vitrôs em composições de 3 e 6 folhas, com opções de vidro e quadriculado.",
    bestFor: "Cozinha, sala, lavanderia e vãos que pedem luz, ventilação e acesso ao exterior.",
    pitch: "Para balcão, a decisão é entre ventilação, privacidade e passagem; por isso número de folhas e grade entram cedo na conversa.",
    checks: ["3 ou 6 folhas", "veneziana/vitrô", "grade", "cor e vão"],
    source: "Catálogo + site oficial",
  },
  {
    id: "aluan-windows",
    brand: "aluan",
    family: "Janelas e venezianas",
    title: "Linha Master: 2, 3 ou 4 folhas",
    code: "com ou sem grade",
    spec: "Janelas e venezianas móveis com opções com e sem grade; o site oficial destaca branco e preto na Linha Master.",
    bestFor: "Quartos e ambientes que precisam equilibrar ventilação e privacidade.",
    pitch: "Vamos separar o que precisa abrir do que pode ficar fixo e escolher grade apenas onde ela realmente ajuda.",
    checks: ["folhas móveis", "com/sem grade", "cor", "medida do vão"],
    source: "Catálogo + site oficial",
  },
  {
    id: "aluan-maxiar",
    brand: "aluan",
    family: "Vitrô e Maxi-Ar",
    title: "Master L25: 1 ou 2 seções",
    code: "com ou sem grade",
    spec: "Vitrô maxi-ar em 1 e 2 seções, com ou sem grade; indicado para ventilação e vãos menores ou modulados.",
    bestFor: "Banheiro, cozinha, lavanderia e ambientes que precisam de ventilação controlada.",
    pitch: "O maxi-ar resolve ventilação sem exigir uma abertura de giro grande; confirmo seção, grade e medida para encaixar no ambiente.",
    checks: ["1 ou 2 seções", "com/sem grade", "cor", "posição e medida"],
    source: "Catálogo + site oficial",
  },
  {
    id: "aluan-giro",
    brand: "aluan",
    family: "Portas de giro",
    title: "Social, vestiário, palheta, basculante e fixa",
    code: "Linha 25 · preto, branco e brilhante no site",
    spec: "Portas de giro para usos distintos, incluindo social, vestiário, palheta, basculante e fixa.",
    bestFor: "Quartos, banheiros, áreas internas, vestiários e obras de volume.",
    pitch: "Aqui a prioridade é a função: passagem, ventilação, privacidade ou fixação. A estética vem depois sem perder a praticidade.",
    checks: ["uso do ambiente", "ventilação", "tipo de abertura", "cor e medida"],
    source: "Catálogo + site oficial",
  },
  {
    id: "aluan-modular",
    brand: "aluan",
    family: "Vitrô e veneziana modular",
    title: "2/4 folhas e veneziana 3/6 folhas",
    code: "com ou sem grade; preta, branca e brilhante",
    spec: "Linha Modular com vitrôs de 2 ou 4 folhas e venezianas de 3 ou 6 folhas, com ou sem grade.",
    bestFor: "Obras com repetição de vãos, orçamento objetivo e necessidade de padronização.",
    pitch: "Para volume, a modular ajuda a manter padrão, prazo de especificação e comparação de peças.",
    checks: ["quantidade", "folhas e grade", "cor", "medidas repetidas"],
    source: "Catálogo + site oficial",
  },
  {
    id: "aluan-l16",
    brand: "aluan",
    family: "Basculante e Maxi-Ar",
    title: "Linha 16",
    code: "branca, preta e brilhante no catálogo/site",
    spec: "Basculante L16 e maxi-ar em 1 ou 2 seções, com variações de acabamento mostradas no catálogo e canal oficial.",
    bestFor: "Ambientes de ventilação, obras de volume e soluções compactas.",
    pitch: "A Linha 16 é uma opção funcional quando ventilação e custo-benefício pesam mais que uma porta de destaque.",
    checks: ["basculante ou maxi-ar", "1/2 seções", "cor", "medida"],
    source: "Catálogo + site oficial",
  },
  {
    id: "aluan-abrigo",
    brand: "aluan",
    family: "Abrigo L25",
    title: "Guarnição e portinhola",
    code: "Abrigo L25",
    spec: "Família de abrigo com guarnição e portinhola, apresentada no canal oficial e no catálogo.",
    bestFor: "Áreas técnicas, abrigo e fechamento funcional.",
    pitch: "É uma solução de fechamento específico; confirmo o vão e o que precisa ficar acessível antes de cotar.",
    checks: ["uso e acesso", "medida", "guarnição", "portinhola"],
    source: "Catálogo + site oficial",
  },
  {
    id: "brasil-sublime-wood",
    brand: "brasil",
    family: "Alumínio amadeirado",
    title: "Sublime Amadeirado",
    code: "Perfil 32 · catálogo 2026 · páginas 04 a 09",
    spec: "Linha de alumínio amadeirado com portas pivotantes, lambri e ripadas; indicada para levar aparência de madeira a uma solução de alumínio.",
    bestFor: "Entrada, fachada e cliente que quer estética amadeirada com a lógica de uma esquadria de alumínio.",
    pitch: "Eu usaria a Sublime Amadeirado quando a aparência da madeira é importante, mas o projeto pede uma solução de alumínio; vamos confirmar modelo, medida e acabamento.",
    checks: ["modelo pivotante, lambri ou ripado", "perfil 32", "medida e lado", "acabamento e puxador"],
    source: "Catálogo enviado",
  },
  {
    id: "brasil-sublime-black",
    brand: "brasil",
    family: "Alumínio preto",
    title: "Sublime Black",
    code: "Perfil 32 · portas e janelas",
    spec: "Linha preta de perfil 32, com opções para portas, janelas e composições de destaque; o canal oficial também apresenta modelos ACM pivotantes e vidro miniboreal.",
    bestFor: "Projetos contemporâneos, fachada escura e cliente que quer contraste e presença visual.",
    pitch: "A Sublime Black funciona quando o preto precisa aparecer como parte do projeto; eu separo o modelo certo e confirmo vidro, puxador e medida.",
    checks: ["modelo e abertura", "vidro/privacidade", "puxador", "medida, cor e disponibilidade"],
    source: "Catálogo + site oficial",
  },
  {
    id: "brasil-premium-black",
    brand: "brasil",
    family: "Alumínio preto",
    title: "Premium Black",
    code: "Perfil 25 · catálogo 2026 · páginas 20 a 40",
    spec: "Linha de alumínio preto em perfil 25, com variedade para portas, janelas e esquadrias de maior presença.",
    bestFor: "Cliente que quer acabamento preto e variedade de modelos sem partir necessariamente para o perfil 32.",
    pitch: "A Premium Black é uma alternativa para manter a linguagem preta e comparar a solução de forma mais objetiva por modelo e perfil.",
    checks: ["perfil 25", "tipo de porta/janela", "vidro e grade", "vão e acabamento"],
    source: "Catálogo enviado",
  },
  {
    id: "brasil-facility-black",
    brand: "brasil",
    family: "Alumínio preto",
    title: "Facility Black",
    code: "Perfil 20 nas janelas · perfil 25 nas portas",
    spec: "Linha preta com perfis diferentes para janelas e portas, ajudando a montar uma solução funcional para ambientes variados.",
    bestFor: "Obra residencial que precisa padronizar portas e janelas sem tratar todos os vãos como o mesmo produto.",
    pitch: "A Facility permite organizar a obra por função: janela com um perfil, porta com outro, mantendo a leitura preta do conjunto.",
    checks: ["janela ou porta", "perfil aplicável", "folhas, grade e vidro", "medidas repetidas"],
    source: "Catálogo enviado",
  },
  {
    id: "brasil-white-lines",
    brand: "brasil",
    family: "Alumínio branco",
    title: "Sublime, Premium e Facility Brancas",
    code: "Perfis 32, 25 e 20/25 conforme linha",
    spec: "Famílias em alumínio branco para portas, janelas e composições mais neutras; o perfil muda conforme a linha e o produto.",
    bestFor: "Ambiente claro, obra tradicional e cliente que quer uma esquadria discreta e fácil de combinar.",
    pitch: "Aqui eu não escolheria só pela cor: separo Sublime, Premium ou Facility conforme o vão, a função e a composição que o cliente precisa.",
    checks: ["linha e perfil", "tipo de abertura", "vidro/grade", "medida e prazo"],
    source: "Catálogo enviado",
  },
  {
    id: "brasil-soft",
    brand: "brasil",
    family: "Alumínio branco",
    title: "Linha Soft",
    code: "Perfil 16 nas janelas · perfil 25 nas portas",
    spec: "Linha branca para portas e janelas, com perfil 16 nas janelas e perfil 25 nas portas conforme o índice do catálogo.",
    bestFor: "Projetos que precisam de uma solução mais objetiva para janelas e portas de uso cotidiano.",
    pitch: "A Soft entra bem quando a prioridade é resolver com simplicidade; ainda assim confirmo medida, abertura, vidro e o que acompanha.",
    checks: ["janela ou porta", "perfil", "folhas e abertura", "vidro e acabamento"],
    source: "Catálogo enviado",
  },
  {
    id: "brasil-steel",
    brand: "brasil",
    family: "Aço",
    title: "Inove e Evo",
    code: "Aço branco galvanizado · pintura eletrostática",
    spec: "Linhas de aço branco com pintura eletrostática, voltadas a soluções resistentes para portas e janelas.",
    bestFor: "Cliente que prioriza resistência do aço, obra funcional e orçamento que pede uma alternativa ao alumínio.",
    pitch: "Se o aço faz mais sentido pela resistência e pelo orçamento, eu comparo Inove e Evo pela composição, medida e acabamento confirmados.",
    checks: ["Inove ou Evo", "medida e abertura", "pintura/acabamento", "vidro, grade e prazo"],
    source: "Catálogo enviado",
  },
  {
    id: "brasil-steel-primer",
    brand: "brasil",
    family: "Aço",
    title: "Universal e Max",
    code: "Aço primer · conferir acabamento final",
    spec: "Linhas de aço primer apresentadas no catálogo, úteis quando a especificação exige uma base que ainda precisa ser finalizada ou confirmada.",
    bestFor: "Obra que já tem definição de pintura/acabamento e cliente que aceita uma solução em aço primer.",
    pitch: "Aqui eu confirmaria primeiro o acabamento final e a responsabilidade pela pintura; só depois compararia o valor com uma linha pronta.",
    checks: ["Universal ou Max", "acabamento primer", "pintura final", "medida e ferragens"],
    source: "Catálogo enviado",
  },
  {
    id: "brasil-complements",
    brand: "brasil",
    family: "Complementos",
    title: "Alçapão, maxi-ar, porta balcão e tela mosquiteira",
    code: "soluções complementares do catálogo/site",
    spec: "O mix inclui soluções para acesso técnico, ventilação, integração de ambientes e proteção contra insetos; cada item tem composição própria.",
    bestFor: "Aumentar ticket em obras com janelas, áreas técnicas, cozinha, lavanderia e ambientes integrados.",
    pitch: "Antes de finalizar, posso conferir se a obra precisa de algum complemento: ventilação, acesso técnico, porta balcão ou tela mosquiteira.",
    checks: ["tipo de complemento", "medida do vão", "abertura e ventilação", "itens que acompanham"],
    source: "Catálogo + site oficial",
  },
  {
    id: "crv-nobre",
    brand: "crv",
    family: "Alumínio premium",
    title: "Nobre e Nobre Black",
    code: "portas pivotantes, panorâmicas, lambri e janelas integradas",
    spec: "Linha premium de alumínio com fecho embutido na cor, requadros robustos, maior variedade de pivotantes, opções panorâmicas e puxadores modernos.",
    bestFor: "Entrada principal, fachada contemporânea e cliente que valoriza design, presença e acabamento.",
    pitch: "A Nobre é para quando a porta precisa participar da arquitetura; primeiro defino proporção e abertura, depois confirmo cor, vidro, puxador e medida.",
    checks: ["Nobre ou Nobre Black", "pivotante, lambri ou panorâmica", "vidro e fechadura", "vão livre e requadro"],
    source: "Catálogo enviado",
  },
  {
    id: "crv-classic",
    brand: "crv",
    family: "Alumínio",
    title: "Classic, Classic Plus+ e versões Black",
    code: "fecho embutido · perfis robustos · vidro com borracha EPDM",
    spec: "Famílias de alumínio que combinam acabamento superior, custo-benefício, estabilidade, deslizamento suave e opções prontas para instalar conforme o produto.",
    bestFor: "Cliente que quer alumínio com boa apresentação sem necessariamente partir para a linha premium Nobre.",
    pitch: "Na Classic eu consigo montar uma comparação equilibrada: mesma função, linhas diferentes, e o cliente entende o que muda em acabamento e composição.",
    checks: ["Classic, Plus+ ou Black", "porta/janela/balcão", "vidro, grade e folhas", "requadro e medida"],
    source: "Catálogo enviado",
  },
  {
    id: "crv-standard-aluminum",
    brand: "crv",
    family: "Alumínio",
    title: "Standard Alumínio",
    code: "social slim, lambri, mista, veneziana, janelas e vitrôs",
    spec: "Linha de alumínio com variedade para portas sociais, lambri, mistas, venezianas, janelas de correr e vitrôs maxi-ar.",
    bestFor: "Obra residencial, banheiros, quartos, cozinha e projetos com repetição de vãos.",
    pitch: "A Standard ajuda a resolver a obra por função: passagem, ventilação, iluminação ou privacidade. Depois confirmo a folha e o conjunto correto.",
    checks: ["tipo de produto", "folhas e grade", "vidro", "medida, lado e requadro"],
    source: "Catálogo enviado",
  },
  {
    id: "crv-ideal",
    brand: "crv",
    family: "Aço premium",
    title: "Ideal e Ideal Black",
    code: "aço galvanizado · visual clean · fecho embutido",
    spec: "Linha premium de aço acabado com design diferenciado, robustez, resistência, sistema de correr suave e menos elementos aparentes.",
    bestFor: "Cliente que quer resistência do aço sem abrir mão de uma aparência mais limpa e atual.",
    pitch: "A Ideal é uma forma de mostrar que aço não precisa significar acabamento pesado; vamos comparar visual, abertura e medida com o alumínio.",
    checks: ["Ideal ou Ideal Black", "pivotante, abrir ou correr", "fecho e puxador", "medida e vidro"],
    source: "Catálogo enviado",
  },
  {
    id: "crv-inova",
    brand: "crv",
    family: "Aço custo-benefício",
    title: "Inova e Inova Black",
    code: "aço acabado · fecho sobreposto · vidro instalado conforme modelo",
    spec: "Linha de aço voltada a economia aliada à qualidade, com opções para vários ambientes e segurança do aço galvanizado.",
    bestFor: "Cliente sensível a preço, obra de volume e comparação entre aço e alumínio.",
    pitch: "Se a prioridade é custo-benefício, a Inova merece entrar na comparação; eu só preciso igualar medida, vidro e composição antes de falar em preço.",
    checks: ["Inova ou Inova Black", "vidro e grade", "medida e abertura", "composição do conjunto"],
    source: "Catálogo enviado",
  },
  {
    id: "crv-aciaco",
    brand: "crv",
    family: "Aço",
    title: "Aciaço e Standard Aço",
    code: "aço branco, preto ou primer conforme a linha",
    spec: "Famílias de aço do catálogo para portas, janelas, venezianas, vitrôs, alçapões e soluções de obra; acabamento e composição variam por linha.",
    bestFor: "Obra funcional, ambientes de serviço e clientes que querem alternativas em aço por medida e orçamento.",
    pitch: "Aqui eu começo pela função do ambiente e pelo acabamento desejado; depois confiro qual família de aço realmente atende o vão.",
    checks: ["Aciaço ou Standard Aço", "branco, preto ou primer", "grade, vidro e folhas", "medida, lado e prazo"],
    source: "Catálogo enviado",
  },
  {
    id: "crv-windows",
    brand: "crv",
    family: "Janelas e vitrôs",
    title: "Correr, venezianas, integradas e maxi-ar",
    code: "2, 3, 4 ou 6 folhas conforme a família",
    spec: "O catálogo reúne janelas de correr, integradas, venezianas, vitrôs basculantes e maxi-ar, com opções de grade, vidro e folhas móveis.",
    bestFor: "Quartos, cozinha, lavanderia, banheiro, fachadas e obras com vãos repetidos.",
    pitch: "Para janela, eu não começo pelo desenho: começo por luz, ventilação e privacidade, e então escolho folhas, grade e abertura.",
    checks: ["correr, veneziana ou maxi-ar", "folhas móveis/fixas", "grade e vidro", "medida e requadro"],
    source: "Catálogo enviado",
  },
  {
    id: "lucasa-doors",
    brand: "lucasa",
    family: "Portas",
    title: "Portas Lucasa",
    code: "catálogo oficial online · modelo e acabamento a confirmar",
    spec: "Portas da marca Ullian/Lucasa para diferentes ambientes; o canal oficial organiza a escolha por necessidade e ambiente.",
    bestFor: "Entrada, sala, dormitório e cliente que busca segurança, conforto e aparência de produto acabado.",
    pitch: "Posso usar a Lucasa quando o cliente quer comparar design e conforto, mas vou confirmar o modelo exato e a composição antes de fechar.",
    checks: ["modelo e linha", "medida e abertura", "cor/vidro", "disponibilidade e prazo"],
    source: "Site oficial (catálogo não anexado)",
  },
  {
    id: "lucasa-windows",
    brand: "lucasa",
    family: "Janelas",
    title: "Janelas Lucasa",
    code: "entrada, cozinha, sala, dormitório, lavanderia e banheiro",
    spec: "Janelas organizadas por ambiente e necessidade, com apelo de iluminação natural, conforto térmico, proteção e durabilidade.",
    bestFor: "Cliente que quer melhorar luz, ventilação, segurança ou conforto em um ambiente específico.",
    pitch: "Em vez de mandar todas as opções, eu começo pelo ambiente e pelo que falta nele: luz, ventilação, privacidade ou conforto.",
    checks: ["ambiente e função", "tipo de abertura", "medida e cor", "vidro, grade e prazo"],
    source: "Site oficial (catálogo não anexado)",
  },
  {
    id: "lucasa-performance",
    brand: "lucasa",
    family: "Argumentos de valor",
    title: "Conforto, proteção e durabilidade",
    code: "pontos do canal oficial; validar no modelo escolhido",
    spec: "O site oficial destaca proteção contra chuva e vento, conforto térmico, luminosidade, resistência e durabilidade à ação do tempo.",
    bestFor: "Cliente que compara somente por preço e precisa entender desempenho e uso no ambiente.",
    pitch: "A comparação não precisa ser só pelo valor: vamos ver o que muda em proteção, conforto, luz e durabilidade no modelo específico.",
    checks: ["modelo que sustenta o argumento", "desempenho aplicável", "composição e instalação", "garantia vigente"],
    source: "Site oficial (catálogo não anexado)",
  },
  {
    id: "riobras-doors",
    brand: "riobras",
    family: "Portas",
    title: "Portas Riobras",
    code: "catálogo oficial online · custo-benefício",
    spec: "Portas da marca Ullian/Riobras pensadas para eficiência, praticidade, conforto e segurança, com modelos a confirmar pelo catálogo vigente.",
    bestFor: "Cliente que quer uma solução objetiva e está comparando custo-benefício.",
    pitch: "A Riobras entra quando o custo-benefício pesa, mas eu ainda vou igualar medida, abertura e composição para a comparação ser justa.",
    checks: ["modelo e abertura", "medida e cor", "vidro/ferragens", "prazo e disponibilidade"],
    source: "Site oficial (catálogo não anexado)",
  },
  {
    id: "riobras-windows",
    brand: "riobras",
    family: "Janelas",
    title: "Janelas Riobras",
    code: "cozinha, sala, dormitório, lavanderia e banheiro",
    spec: "Janelas para diferentes ambientes, com foco de comunicação em iluminação, conforto térmico, proteção e durabilidade.",
    bestFor: "Obra residencial ou de volume que busca uma alternativa funcional e comparável.",
    pitch: "Vou separar a opção Riobras pelo uso do ambiente e pela medida, para você comparar custo-benefício sem misturar produtos diferentes.",
    checks: ["ambiente", "tipo de abertura e folhas", "medida e cor", "grade, vidro e prazo"],
    source: "Site oficial (catálogo não anexado)",
  },
];

const statusOptions = [
  "A confirmar",
  "Aguardando medidas",
  "Aguardando decisão",
  "Aguardando retorno",
  "Negociação ativa",
  "Transferido",
  "Venda fechada",
  "Não vai fechar agora",
  "Encerrado",
];

const defaultFollowUps: LocalFollowUp[] = [];

const defaultMetrics: EmployeeMetrics = {
  leads: 0,
  quotes: 0,
  officialQuotes: 0,
  incompleteQuotes: 0,
  followups: 0,
  closed: 0,
  ticket: 0,
};

function normalizeMetricNumber(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function normalizeMetrics(value: unknown): EmployeeMetrics {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<Record<keyof EmployeeMetrics, unknown>> : {};
  const quotes = Math.round(normalizeMetricNumber(source.quotes));
  const officialQuotes = Math.min(Math.round(normalizeMetricNumber(source.officialQuotes)), quotes);
  return {
    leads: Math.round(normalizeMetricNumber(source.leads)),
    quotes,
    officialQuotes,
    incompleteQuotes: Math.min(Math.round(normalizeMetricNumber(source.incompleteQuotes)), Math.max(0, quotes - officialQuotes)),
    followups: Math.min(Math.round(normalizeMetricNumber(source.followups)), quotes),
    closed: Math.min(Math.round(normalizeMetricNumber(source.closed)), quotes),
    ticket: normalizeMetricNumber(source.ticket),
  };
}

function normalizeFollowUps(value: unknown): LocalFollowUp[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const source = item as Record<string, unknown>;
    const client = typeof source.client === "string" ? source.client.trim().slice(0, 160) : "";
    const next = typeof source.next === "string" ? source.next.trim().slice(0, 240) : "";
    if (!client || !next) return [];
    const status = typeof source.status === "string" && statusOptions.includes(source.status) ? source.status : "A confirmar";
    const priority = source.priority === "Alta" || source.priority === "Baixa" ? source.priority : "Média";
    const id = typeof source.id === "string" && source.id.trim() ? source.id.trim().slice(0, 80) : `saved-${index + 1}`;
    return [{ id, client, next, status, priority, done: source.done === true }];
  });
}
const dailyChecks = [
  { id: "open", title: "Abrir o dia", description: "Ver pendências por prioridade e revisar medidas que faltam." },
  { id: "quote", title: "Orçar com clareza", description: "Uma principal, uma alternativa e campos ‘A confirmar’ visíveis." },
  { id: "follow", title: "Fazer retornos", description: "Cobrar com motivo, timing e próxima ação definida." },
  { id: "close", title: "Fechar o dia", description: "Nenhum atendimento termina sem status, responsável e próximo passo." },
];

const quickLineOptions = [
  "Kit porta pronta",
  "Porta de madeira",
  "Porta de alumínio",
  "Porta de aço",
  "Porta de correr",
  "Janelas, venezianas e vitrôs",
  "Porta pivotante / entrada",
  "Solução para obra em volume",
];

type QuickMessageInput = {
  name: string;
  line: string;
  environment: string;
  objective: string;
  question: string;
  channel: QuickMessageChannel;
  tone: QuickMessageTone;
  includeCompany: boolean;
  includeQuality: boolean;
  includeGuarantee: boolean;
};

function buildQuickMessage(input: QuickMessageInput) {
  const name = input.name.trim();
  const line = input.line.trim() || "a solução que você está avaliando";
  const environment = input.environment.trim() || "seu ambiente";
  const objective = input.objective.trim() || "resolver essa necessidade com segurança";
  const question = input.question.trim() || "qual é o ambiente e a largura x altura do vão";
  const questionWithPunctuation = /[?!…]$/.test(question) ? question : `${question}?`;
  const greeting = name ? `Oi, ${name}!` : "Oi! Tudo bem?";
  const trust = input.includeCompany && input.includeQuality && input.includeGuarantee
    ? "A Mult Portas tem 41 anos de história, atende 85 cidades da região e trabalha com foco em qualidade e garantia conforme a linha e a especificação do produto."
    : input.includeCompany && input.includeQuality
      ? "A Mult Portas tem 41 anos de história, atende 85 cidades da região e trabalha com foco em qualidade."
      : input.includeCompany && input.includeGuarantee
        ? "A Mult Portas tem 41 anos de história, atende 85 cidades da região e trabalha com garantia conforme a linha e a especificação do produto."
        : input.includeCompany
          ? "A Mult Portas tem 41 anos de história e atende 85 cidades da região."
          : input.includeQuality && input.includeGuarantee
            ? "Trabalhamos com foco em qualidade e garantia conforme a linha e a especificação do produto."
            : input.includeQuality
              ? "Trabalhamos com foco em qualidade."
              : input.includeGuarantee
                ? "A garantia segue a linha e a especificação do produto."
                : "Vou conferir a composição correta antes de te orientar.";

  if (input.channel === "Áudio") {
    if (input.tone === "Direto") {
      return `${greeting} Sobre ${line} para ${environment}: é uma opção para ${objective}. ${trust} Me confirma uma coisa: ${questionWithPunctuation}`;
    }
    if (input.tone === "Próximo") {
      return `${greeting} Entendi que você está buscando ${line} para ${environment}, com foco em ${objective}. ${trust} Me confirma só uma coisa: ${questionWithPunctuation} Aí eu separo a melhor opção.`;
    }
    return `${greeting} Vou te explicar rapidinho: para ${environment}, a linha ${line} pode atender bem quando o objetivo é ${objective}. ${trust} Antes de te indicar um modelo, me confirma uma coisa: ${questionWithPunctuation}`;
  }

  if (input.tone === "Direto") {
    return `${greeting} Tenho ${line} para ${environment}, pensando em ${objective}. ${trust} Me confirma uma coisa: ${questionWithPunctuation}`;
  }
  if (input.tone === "Próximo") {
    return `${greeting} Vamos resolver isso juntos? Pensei em ${line} para ${environment}, buscando ${objective}. ${trust} Me confirma só uma coisa: ${questionWithPunctuation} Aí eu te mando uma opção principal e uma alternativa.`;
  }
  return `${greeting} Para ${environment}, eu começaria avaliando ${line}, porque pode atender ao objetivo de ${objective}. ${trust} Para eu não te mandar algo genérico, me confirma uma coisa: ${questionWithPunctuation}`;
}

function formatPercent(value: number) {
  const safeValue = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return `${safeValue.toFixed(0)}%`;
}

function priorityClass(priority: Priority) {
  return priority.toLowerCase().replace("é", "e");
}

function formatToday() {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" })
    .format(new Date())
    .replace(/\sde\s/g, " ")
    .replaceAll(".", "")
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function formatVoiceDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remaining = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remaining}`;
}

type CoachSignals = {
  normalized: string;
  hasQuestion: boolean;
  asksPrice: boolean;
  hasMeasure: boolean;
  hasEnvironment: boolean;
  environment: string;
  hasBenefit: boolean;
  hasNextMove: boolean;
  hasGuardrail: boolean;
  hasPressure: boolean;
  comparesPrice: boolean;
  asksIncluded: boolean;
  asksHow: boolean;
  mentionsPayment: boolean;
  mentionsTiming: boolean;
  mentionsPhoto: boolean;
  mentionsQuantity: boolean;
  asksCatalog: boolean;
  mentionsInstallation: boolean;
  mentionsEvidence: boolean;
  saysUncertain: boolean;
  hasEmpathy: boolean;
};

function normalizeCoachText(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function detectCoachSignals(sellerMessage: string): CoachSignals {
  const normalized = normalizeCoachText(sellerMessage);
  const environmentMatch = normalized.match(/(quarto|banheiro|entrada|area social|sala|cozinha|lavanderia|fachada|varanda|corredor|obra)/);
  return {
    normalized,
    hasQuestion: sellerMessage.includes("?") || /(qual|como|onde|quando|quant|medid|ambiente|obra|vao|prazo|modelo|cor|inclui|serve)/.test(normalized),
    asksPrice: /(preco|valor|custa|quanto|orcamento|cotacao|barato|desconto)/.test(normalized),
    hasMeasure: /\b\d{2,3}(?:[,.]\d+)?\s*(?:cm|centimetros?)\b/.test(normalized) || /\b\d{2,3}\s*[x×]\s*\d{2,3}\b/.test(normalized),
    hasEnvironment: Boolean(environmentMatch),
    environment: environmentMatch?.[1] ?? "ambiente",
    hasBenefit: /(pratic|instal|acabamento|solucao|batente|guarn|espaco|luz|ventil|econom|conjunto|compar|segur|manutenc)/.test(normalized),
    hasNextMove: /(posso|vamos|combin|retorn|confirm|medid|envi|proxim|agend|reserv|mandar|separar|registrar)/.test(normalized),
    hasGuardrail: /(a confirmar|confirm|valid|dispon|prazo|fabricante|medida|consultar|sem prometer)/.test(normalized),
    hasPressure: /(ultima|so hoje|garantir agora|certeza|disponivel amanha|urgente|fecha hoje)/.test(normalized),
    comparesPrice: /(mais barato|barato|outra loja|concorr|cobrir|diferenc|comparar)/.test(normalized),
    asksIncluded: /(inclui|incluso|completa|conjunto|batente|guarn|ferrag|trilho|kit)/.test(normalized),
    asksHow: /(como|serve|funciona|instal|confiro|medir|qual medida)/.test(normalized),
    mentionsPayment: /(pix|avista|parcel|cartao|condicao|pagamento)/.test(normalized),
    mentionsTiming: /(prazo|mes que vem|semana|obra|cronograma|quando|etapa|atras)/.test(normalized),
    mentionsPhoto: /(foto|imagem|catalogo|catalog|video)/.test(normalized),
    mentionsQuantity: /(quantidade|varias|varios|muitas|lista|pecas|portas|janelas|todas)/.test(normalized),
    asksCatalog: /(catalogo|modelos|opcoes|opcao|mostra|ver|foto)/.test(normalized),
    mentionsInstallation: /(instal|montar|montagem|espuma|sujeira|obra)/.test(normalized),
    mentionsEvidence: /(foto|fotos|etiqueta|numero do orcamento|nota|embalagem|evidencia)/.test(normalized),
    saysUncertain: /(nao sei|ainda nao|nao medi|depois|vou ver|vou perguntar|talvez|indecis|duvida)/.test(normalized),
    hasEmpathy: /(entendo|entendi|perfeito|certo|claro|sem problema|vamos|faz sentido|obrigad|sinto muito)/.test(normalized),
  };
}

type ReactiveTurn = {
  customerReply: string;
  customerMood: string;
  customerNeed: string;
  coachNote: string;
  nextMove: string;
};

function reactiveCustomerTurn(scenario: TrainingScenario, signals: CoachSignals, turn: number): ReactiveTurn {
  const fallback = scenario.customerReplies[(turn + (signals.hasBenefit ? 1 : 0)) % scenario.customerReplies.length];
  const finish = (customerReply: string, customerNeed: string, customerMood: string, coachNote: string, nextMove: string): ReactiveTurn => ({ customerReply, customerNeed, customerMood, coachNote, nextMove });

  switch (scenario.id) {
    case "price-first":
      if (signals.hasEnvironment && signals.hasMeasure) return finish("Perfeito, você já me deu ambiente e medida. Essa medida é do vão acabado? A parede é de alvenaria ou drywall?", "Validar se a medida é do vão e confirmar o tipo de parede.", "Mais aberto e pronto para avançar", "Você tirou a conversa do preço e trouxe dados que permitem uma indicação mais segura.", "Confirme se a medida é do vão acabado e o tipo de parede.");
      if (signals.hasEnvironment) return finish(`É para ${signals.environment}, sim. Ainda não medi o vão; você precisa da largura e da altura para me orientar?`, "Descobrir largura e altura do vão antes de abrir preço.", "Aberto, mas ainda sem informação técnica", "Você identificou o ambiente; agora o cliente percebe que a medida é o próximo desbloqueio.", "Peça largura, altura e tipo de parede.");
      if (signals.asksPrice) return finish("Consigo te orientar, mas não quero te passar o preço de um conjunto que depois não sirva. É para qual ambiente e qual é a largura x altura do vão?", "Entender ambiente e medida antes de falar em valor.", "Objetivo e sensível a preço", "A resposta do cliente mostra que o preço veio antes do diagnóstico; uma pergunta curta destrava a conversa.", "Pergunte ambiente e medida em uma única mensagem.");
      return finish("Ainda estou entendendo o que preciso. Quero algo prático, que economize espaço ou tenha um acabamento específico — o que você recomenda para esse ambiente?", "Identificar o critério de compra principal.", "Receptivo, mas ainda genérico", "O cliente ainda não revelou o critério de escolha; conduza com uma pergunta de prioridade.", "Descubra o objetivo antes de indicar modelo.");

    case "measure-gap":
      if (signals.hasMeasure && signals.hasGuardrail) return finish("Agora sim ficou mais claro. Só preciso confirmar se essa é a medida do vão acabado — e não da folha — além do tipo de parede para verificar a compatibilidade.", "Validar medida do vão, parede e especificação do fabricante.", "Cuidadoso e colaborativo", "Você tratou a medida como parte da venda e evitou garantir encaixe sem confirmação.", "Confirme vão acabado, parede e sentido de abertura.");
      if (signals.hasMeasure) return finish("Essa medida ajuda, mas é da parede, da folha ou do vão livre? Se você me mandar largura e altura do vão acabado, eu consigo seguir com mais segurança.", "Separar medida da parede, folha e vão.", "Confuso, mas disposto a conferir", "O cliente trouxe um número, mas ainda não ficou claro o que ele representa.", "Pergunte explicitamente se o número é do vão acabado.");
      if (signals.asksHow) return finish("Meça a largura em cima, no meio e embaixo e a altura dos dois lados. Me envie a menor medida, diga se é alvenaria ou drywall e informe o sentido de abertura.", "Receber um conjunto mínimo de medidas confiáveis.", "Quer fazer certo", "Você pode transformar a dúvida em um passo prático, sem prometer compatibilidade antecipada.", "Peça as cinco informações: largura, altura, parede, abertura e estágio da obra.");
      return finish("A espessura da parede ajuda a definir o batente, mas não substitui largura e altura do vão. Você consegue medir o vão livre?", "Obter largura e altura do vão livre.", "Inseguro sobre a diferença", "O cliente está confundindo parede com vão; corrija sem constranger e peça a medida certa.", "Explique folha x vão em uma frase e peça largura e altura.");

    case "price-objection":
      if (signals.asksIncluded || signals.hasBenefit) return finish("Boa, então vamos comparar o mesmo conjunto: folha, batente, guarnição, ferragens e condição de pagamento. O orçamento da outra loja inclui quais desses itens?", "Comparar propostas equivalentes antes de discutir desconto.", "Atento à diferença e disposto a comparar", "Você levou a conversa para composição e benefício, que é onde a diferença de preço pode ser entendida.", "Peça a descrição ou foto da proposta concorrente.");
      if (signals.comparesPrice) return finish("Antes de eu falar em cobrir, preciso conferir se estamos comparando o mesmo produto. O que exatamente está incluso no valor mais barato?", "Descobrir se a comparação é equivalente.", "Pressionando por preço", "O cliente pediu preço, mas ainda não trouxe a composição; não entre em desconto automático.", "Pergunte o que está incluso e qual é a condição de pagamento.");
      return finish(fallback, "Entender qual diferença o cliente está tentando comparar.", "Cauteloso e comparativo", "A melhor resposta agora é fazer a comparação ficar objetiva, não defender a Mult Portas no escuro.", "Peça modelo, composição e condição do outro orçamento.");

    case "timeline":
      if (signals.mentionsTiming && signals.hasNextMove) return finish("Perfeito. Então não vou te prometer uma data agora. Qual é a etapa prevista para o vão ficar pronto? Posso registrar um retorno próximo dessa fase.", "Conectar a decisão à etapa real da obra.", "Planejando com antecedência", "Você reconheceu o cronograma e transformou a ansiedade por prazo em um retorno concreto.", "Registre a etapa e uma data de retorno.");
      if (signals.mentionsTiming) return finish("Eu consigo deixar a cotação como referência, mas prazo, validade e disponibilidade precisam ser confirmados mais perto da compra. Quando você pretende fechar?", "Definir uma janela de decisão sem promessa antecipada.", "Ansioso com prazo", "O cliente quer uma garantia que ainda depende de confirmação; mantenha transparência e marque timing.", "Pergunte quando a compra entra no cronograma.");
      return finish("Entendi. O melhor momento é quando a medida do vão estiver definida e a compra entrar no cronograma. Em que data você imagina chegar nessa etapa?", "Encontrar a data real do próximo contato.", "Aberto, mas sem cronograma claro", "Você precisa trocar uma promessa genérica por uma data ou etapa verificável.", "Combine uma data de retorno baseada na obra.");

    case "complex-decision":
      if (signals.hasEnvironment && signals.hasBenefit) return finish("Faz sentido separar por função: investir mais na entrada e buscar praticidade nos quartos. Pode montar uma opção principal e uma alternativa para eu comparar com ele?", "Organizar soluções por ambiente e prioridade de investimento.", "Mais seguro para decidir", "Você separou critérios em vez de tratar os quatro vãos como se fossem iguais.", "Liste os ambientes e monte principal x alternativa.");
      if (signals.hasEnvironment) return finish("A entrada é o ambiente mais importante. Nos quartos eu quero praticidade; você consegue separar as indicações por função?", "Mapear ambientes e prioridade de cada um.", "Dividido, mas participativo", "O cliente entregou a prioridade; use isso para montar uma proposta mais simples.", "Confirme quais vãos são entrada, social, quartos e banheiros.");
      return finish("Vamos separar por função: qual é o vão de entrada e quais são quartos ou banheiros? Assim não precisamos escolher a mesma solução para tudo.", "Separar os vãos antes de comparar modelos.", "Indeciso entre estética e orçamento", "O cliente tem vários decisores; organizar a obra reduz a sensação de confusão.", "Peça a lista de ambientes e a prioridade de cada um.");

    case "pix-discount":
      if (signals.asksIncluded) return finish("Perfeito. Primeiro separo o que está incluso; depois te mostro à vista e parcelado com valores exatos. Você quer considerar o conjunto completo?", "Definir a composição antes de comparar pagamento.", "Negociando, mas racional", "Você não prometeu desconto e colocou preço e condição na ordem correta.", "Confirme a composição e só depois apresente as condições.");
      if (signals.mentionsPayment) return finish("Posso verificar a condição à vista, mas não vou inventar desconto. Você quer comparar o mesmo conjunto no Pix e no parcelado?", "Comparar condições de pagamento sem alterar valor por impulso.", "Focado em economia imediata", "O cliente trouxe uma condição; falta separar preço do produto e forma de pagamento.", "Confirme o conjunto e a condição que deve ser consultada.");
      return finish("Antes de falar em desconto, você quer a solução completa com batente e guarnição ou somente a folha?", "Saber o que está sendo comprado.", "Objetivo e negociador", "O cliente tentou negociar antes de definir o produto; volte uma etapa sem soar evasivo.", "Pergunte se ele precisa do conjunto completo.");

    case "photo-only":
      if (signals.hasMeasure) return finish("A foto ajuda bastante e, com a medida, já avançamos. Essa largura e altura são do vão acabado? A parede é de alvenaria ou drywall?", "Validar medidas e parede com apoio da foto.", "Colaborativo e pronto para medir", "Você aproveitou a informação visual sem tratar a imagem como medição.", "Confirme vão acabado e tipo de parede.");
      if (signals.mentionsPhoto) return finish("A foto ajuda a visualizar, mas não substitui a trena. Me envie largura, altura, tipo de parede e sentido de abertura para eu filtrar os modelos.", "Receber os dados que a foto não confirma.", "Quer rapidez, mas aceita conferir", "Você pode acolher a foto e deixar claro o limite técnico sem travar o atendimento.", "Peça largura, altura, parede e abertura.");
      return finish("Consigo olhar o ambiente, mas ainda não consigo medir pela imagem. Você tem a largura e a altura do vão?", "Obter medidas antes de falar em preço.", "Curioso e apressado", "A foto é um bom começo, mas a indicação ainda precisa de dados objetivos.", "Peça as medidas do vão.");

    case "space-choice":
      if (/banheiro/.test(signals.normalized)) return finish("Para banheiro, além de economizar espaço, precisamos considerar privacidade e ventilação. Há parede livre para recolher a folha ou ela precisa abrir dentro do vão?", "Entender função do ambiente e espaço de recolhimento.", "Buscando praticidade", "Você trouxe a decisão para o uso real; correr e camarão não são equivalentes em todo ambiente.", "Pergunte sobre parede livre, medida e privacidade.");
      if (signals.hasBenefit || /parede|trilho|recolh/.test(signals.normalized)) return finish("A parede livre é um bom sinal para uma solução de correr, mas ainda preciso saber a largura do vão e quanto espaço existe para o trilho.", "Verificar espaço de recolhimento e medida.", "Interessado em otimizar espaço", "Você conectou o modelo ao espaço disponível, sem garantir encaixe.", "Peça largura do vão e comprimento da parede livre.");
      return finish("A escolha depende do ambiente e do espaço de recolhimento. É para qual cômodo e existe parede livre ao lado do vão?", "Definir ambiente e espaço lateral.", "Em dúvida entre soluções", "Antes de comparar modelos, descubra onde a porta vai trabalhar.", "Pergunte ambiente, parede livre e medida.");

    case "volume-work":
      if (signals.mentionsQuantity || signals.hasMeasure) return finish("Perfeito. Organize a lista com ambiente, quantidade, largura x altura do vão, material e prioridade. Aí separo medidas repetidas e destaco a entrada.", "Estruturar a obra em grupos comparáveis.", "Pronto para organizar a compra", "Você transformou uma obra grande em dados que podem ser conferidos e cotados sem misturar itens.", "Peça a lista completa e separe medidas repetidas.");
      return finish("Consigo estudar uma condição de volume, mas primeiro preciso separar ambientes, quantidades e medidas repetidas. Você já tem essa lista?", "Receber a base da obra antes de discutir preço.", "Negociando em escala", "O desconto só faz sentido depois de saber o que é realmente comparável.", "Peça uma lista com ambiente, quantidade e medida.");

    case "wood-aluminum":
      if (signals.hasEnvironment) return finish("Faz sentido separar por ambiente: podemos avaliar madeira onde a estética pesa mais e alumínio onde ventilação, umidade ou manutenção forem decisivos. Quais ambientes ainda precisam de janelas?", "Mapear cada ambiente pela função, não escolher um material universal.", "Mais aberto à comparação", "Você evitou declarar um vencedor e começou a construir uma lógica de decisão.", "Separe entrada, quartos e áreas molhadas.");
      return finish("Não existe um vencedor universal. Para a entrada, estética e presença podem pesar; em lavanderia e áreas molhadas, manutenção e ventilação ganham importância. Quais ambientes você quer resolver?", "Separar a comparação por uso.", "Buscando uma resposta definitiva", "A pergunta é ampla; devolva uma comparação simples e peça os ambientes.", "Pergunte onde cada material será usado.");

    case "silent-customer":
      if (signals.comparesPrice || signals.asksIncluded) return finish("Entendi; então o que está travando é comparar o que está incluso. Se você resumir a principal e a alternativa, eu consigo decidir melhor.", "Resumir principal x alternativa e identificar a trava.", "Aberto, mas indeciso", "Você acolheu o retorno e trouxe o cliente de volta para uma decisão concreta.", "Pergunte se a dúvida é valor, prazo, modelo ou decisão de outra pessoa.");
      if (signals.mentionsTiming || signals.saysUncertain) return finish("Sem problema. A obra atrasou e eu prefiro não comprar antes de confirmar o vão. Podemos retomar quando eu estiver nessa etapa?", "Definir um novo momento sem pressionar.", "Sem urgência e com obra atrasada", "O cliente está pedindo timing, não uma nova argumentação; respeite o momento e registre o retorno.", "Combine a etapa ou data de retomada.");
      return finish("Eu recebi o orçamento, mas ainda não consegui decidir. O que você consegue resumir para me ajudar: a opção principal, uma alternativa ou o que está incluso?", "Descobrir o bloqueio da decisão.", "Receptivo, mas parado", "Um retorno útil oferece uma escolha pequena em vez de apenas cobrar resposta.", "Ofereça duas opções e uma próxima ação curta.");

    case "after-sales":
      if (signals.mentionsEvidence) return finish("Perfeito, não vou instalar ainda. Me envie o número do orçamento, a etiqueta e fotos da embalagem e da peça; vou conferir a descrição antes de te prometer qualquer solução.", "Organizar evidências e preservar o produto até a análise.", "Preocupado, mas colaborativo", "Você acolheu o problema e pediu evidências sem culpar fornecedor ou prometer troca imediata.", "Registrar número, etiqueta, fotos, cor, medida e quantidade.");
      if (/(cor|escura|acabamento)/.test(signals.normalized)) return finish("Entendi. Diferença de acabamento precisa ser conferida pela descrição, código e iluminação da peça. Você consegue me enviar o número do orçamento e fotos sem instalar?", "Conferir acabamento por documento e evidência visual.", "Inseguro com o resultado", "Acolha a percepção do cliente, mas não conclua divergência antes de comparar os registros.", "Peça orçamento, etiqueta e fotos.");
      return finish("Vamos conferir com calma. Você pode me enviar o número do orçamento, a etiqueta do produto e fotos da embalagem e da peça? Até validar, deixe o item sem instalar.", "Preservar evidências antes de encaminhar o caso.", "Preocupado e buscando solução", "O próximo passo seguro é documentar o caso e evitar uma instalação que complique a análise.", "Peça evidências e não prometa a solução antes da conferência.");

    case "catalog-request":
      if (signals.hasEnvironment || signals.asksCatalog) return finish("Posso te mandar o catálogo, mas se eu separar três opções para o seu ambiente a comparação fica bem mais fácil. É para entrada, área social, quarto ou banheiro?", "Trocar excesso de opções por curadoria por ambiente.", "Curioso e aberto a orientação", "Você pode atender o pedido sem abandonar o diagnóstico; a próxima ação é escolher o ambiente.", "Descubra ambiente e objetivo antes de enviar tudo.");
      return finish("Te envio as opções certas, mas primeiro quero evitar que você receba dezenas de modelos sem contexto. O que é mais importante: estética, praticidade, espaço ou preço?", "Identificar o critério de escolha.", "Quer explorar, mas sem direção", "Curadoria é mais útil que despejar catálogo; faça uma pergunta de prioridade.", "Pergunte qual critério pesa mais.");

    case "installation-question":
      if (signals.hasMeasure && signals.hasGuardrail) return finish("Com o vão, o tipo de parede e o lado de abertura eu consigo conferir a composição. O kit ajuda a reduzir etapas, mas produto e serviço de instalação precisam ficar separados na proposta.", "Validar composição e separar produto de serviço.", "Mais confiante e técnico", "Você explicou o ganho de praticidade sem garantir instalação ou encaixe antes da conferência.", "Peça vão, parede e abertura.");
      if (signals.mentionsInstallation || signals.asksIncluded) return finish("O kit é pensado para deixar folha, batente e guarnição mais organizados e agilizar a obra. Para confirmar o que serve no seu caso, preciso saber se a parede é alvenaria ou drywall e qual é o vão.", "Entender parede, vão e composição do kit.", "Buscando reduzir trabalho na obra", "Você pode vender economia de etapas, mas ainda precisa confirmar a especificação.", "Pergunte tipo de parede e medidas.");
      return finish("A proposta do kit é reduzir etapas de montagem e acabamento, mas não vou afirmar que qualquer conjunto serve sem conferir parede e vão. Como está a obra?", "Saber estágio da obra e especificação do vão.", "Prático e preocupado com instalação", "A resposta precisa diferenciar praticidade do produto de uma promessa de serviço.", "Pergunte parede, vão e estágio da obra.");

    case "finish-choice":
      if (signals.hasEnvironment || signals.hasBenefit) return finish("Se o piso e os móveis são claros, podemos comparar uma opção mais leve com uma amadeirada mais marcada. Você tem foto do ambiente ou prefere começar por branco, cinza e madeira como principal e alternativa?", "Conectar acabamento à luz e à composição do ambiente.", "Indeciso, mas disposto a comparar", "Você tirou a escolha do gosto pessoal e levou para uma comparação visual.", "Peça foto, iluminação e acabamento preferido.");
      if (signals.asksCatalog) return finish("Eu separo uma opção segura e outra mais marcante, mas preciso saber se o ambiente é claro, qual é o piso e se a porta conversa com móveis amadeirados.", "Entender contexto visual antes de indicar cor.", "Busca segurança estética", "Uma recomendação de cor fica mais útil quando parte do ambiente, não de preferência abstrata.", "Pergunte piso, móveis e iluminação.");
      return finish("A melhor cor depende da luz, do piso e dos móveis. O ambiente é claro ou escuro? Você quer que a porta desapareça no conjunto ou seja um destaque?", "Definir o papel visual da porta.", "Indeciso e procurando segurança", "Você pode conduzir a dúvida com duas perguntas simples e depois oferecer principal x alternativa.", "Pergunte luz e se a porta será destaque.");

    case "wet-area":
      if (signals.hasEnvironment && signals.hasBenefit) return finish("Nesse caso eu separaria: madeira para os quartos e uma solução mais adequada à umidade para a lavanderia, confirmando material e manutenção. Você quer comparar alumínio visualmente com a madeira da casa?", "Separar estética dos quartos e exigência da área molhada.", "Mais seguro e aberto à alternativa", "Você preservou a estética sem ignorar umidade e manutenção.", "Compare acabamento e manutenção por ambiente.");
      if (/(umidade|molhad|lavanderia|quintal)/.test(signals.normalized)) return finish("Como há umidade, eu não trataria a porta da lavanderia como igual à dos quartos. Vamos confirmar exposição, ventilação e manutenção antes de escolher o material.", "Avaliar exposição e manutenção antes da indicação.", "Cauteloso com durabilidade", "A dúvida técnica pede diagnóstico; não garanta que qualquer madeira serve.", "Pergunte se há chuva direta, ventilação e cobertura.");
      return finish("Pode ser diferente, porque lavanderia e quarto têm usos distintos. A área pega umidade ou chuva direta? Como é a ventilação?", "Entender o ambiente antes de comparar materiais.", "Quer padronizar, mas aceita avaliar", "Você precisa mostrar que padronização não deve ignorar a condição de uso.", "Pergunte exposição, ventilação e manutenção.");

    default:
      if (signals.asksPrice && !signals.hasEnvironment && !signals.hasMeasure) return finish("Consigo te orientar, mas preciso entender o ambiente e o vão para não te passar uma opção genérica. É para qual cômodo?", "Descobrir ambiente antes de falar em valor.", "Objetivo e sensível a preço", "A resposta reage ao preço sem inventar um número e abre uma pergunta objetiva.", "Pergunte o ambiente e depois a medida.");
      if (signals.hasMeasure && signals.hasQuestion) return finish("Essa informação ajuda. O próximo ponto é confirmar se a medida é do vão acabado, qual é a parede e qual uso o ambiente terá.", "Validar medida, parede e aplicação.", "Colaborativo e atento", "Você trouxe uma informação concreta; agora transforme-a em especificação.", "Confirme vão, parede e ambiente.");
      if (signals.hasNextMove) return finish("Perfeito, com esse próximo passo eu consigo avançar sem te deixar esperando uma resposta genérica.", "Executar a ação combinada e manter o atendimento vivo.", "Pronto para avançar", "Você deixou a conversa mais operacional; mantenha o próximo passo específico.", "Registre a ação, responsável e prazo.");
      if (!signals.hasQuestion) return finish("Entendi. Para eu te orientar de verdade, o que está pesando mais nessa escolha: medida, ambiente, acabamento, prazo ou valor?", "Identificar a necessidade real do cliente.", "Receptivo, mas ainda vago", "O cliente ainda não deu dados suficientes; uma pergunta de prioridade evita resposta automática.", "Faça uma pergunta de escolha curta.");
      return finish(fallback, "Avançar um passo no diagnóstico.", "Aberto a continuar", "A conversa está caminhando; responda ao detalhe que o cliente trouxe e faça só a próxima pergunta necessária.", `Aplique o próximo sinal: ${scenario.signals[Math.min(turn + 1, scenario.signals.length - 1)]}.`);
  }
}

function guidedCoach(scenario: TrainingScenario, sellerMessage: string, turn: number, history: TrainingMessage[] = []): TrainingFeedback {
  const signals = detectCoachSignals(sellerMessage);
  const progressionSignals = detectCoachSignals([
    ...history.filter((message) => message.role === "seller").map((message) => message.text),
    sellerMessage,
  ].join(" "));
  const skillScores: TrainingSkillScores = {
    acolhimento: 4,
    diagnostico: 4,
    precisao: 4,
    valor: 4,
    proximoPasso: 4,
  };
  if (signals.hasEmpathy) skillScores.acolhimento += 3;
  if (signals.hasQuestion) skillScores.diagnostico += 2;
  if (signals.hasEnvironment || signals.hasMeasure) skillScores.diagnostico += 1;
  if (signals.hasMeasure || signals.hasGuardrail) skillScores.precisao += 2;
  if (signals.asksIncluded || signals.hasBenefit) skillScores.valor += 2;
  if (signals.hasNextMove) skillScores.proximoPasso += 3;
  if (sellerMessage.trim().length < 28) { skillScores.diagnostico -= 1; skillScores.proximoPasso -= 1; }
  if (signals.hasPressure) { skillScores.acolhimento -= 2; skillScores.precisao -= 2; }
  if (signals.asksPrice && !signals.hasEnvironment && !signals.hasMeasure) skillScores.diagnostico -= 2;
  if (scenario.id === "price-objection" && !signals.asksIncluded && !signals.comparesPrice) skillScores.valor -= 2;
  if (turn > 0 && !signals.hasQuestion) skillScores.diagnostico -= 1;
  if (["price-objection", "silent-customer", "after-sales"].includes(scenario.id) && !signals.hasEmpathy) skillScores.acolhimento -= 2;
  if (scenario.id === "after-sales" && !signals.hasEmpathy) skillScores.precisao -= 1;
  if (scenario.id === "timeline" && !signals.mentionsTiming) skillScores.proximoPasso -= 1;
  if (signals.saysUncertain && !signals.hasGuardrail) skillScores.precisao -= 1;
  (Object.keys(skillScores) as TrainingSkillId[]).forEach((key) => { skillScores[key] = clampTrainingScore(skillScores[key], 1); });
  let score = clampTrainingScore(skillScores.acolhimento * 0.2 + skillScores.diagnostico * 0.25 + skillScores.precisao * 0.25 + skillScores.valor * 0.15 + skillScores.proximoPasso * 0.15, 1);
  if (skillScores.diagnostico < 5 || skillScores.precisao < 5) score = Math.min(score, 7);

  const reactive = reactiveCustomerTurn(scenario, signals, turn);
  const strengths: string[] = [];
  const improvements: string[] = [];
  if (signals.hasQuestion) strengths.push("Você fez uma pergunta e abriu espaço para o cliente explicar o cenário.");
  else improvements.push("Inclua uma pergunta curta de diagnóstico; sem ela, a conversa fica aberta demais.");
  if (signals.hasEnvironment) strengths.push(`Você conectou a resposta ao ambiente (${signals.environment}).`);
  else if (signals.asksPrice || scenario.id === "complex-decision") improvements.push("Descubra o ambiente antes de escolher modelo ou falar em valor.");
  if (signals.hasMeasure) strengths.push("Você trouxe medida ou pediu um dado técnico concreto.");
  else if (["measure-gap", "photo-only", "installation-question", "space-choice"].includes(scenario.id)) improvements.push("Peça largura, altura, tipo de parede e sentido de abertura antes de garantir compatibilidade.");
  if (signals.asksIncluded || signals.hasBenefit) strengths.push("Você conectou a conversa à composição ou ao benefício da solução.");
  else if (scenario.id === "price-objection" && signals.comparesPrice) improvements.push("Peça a descrição ou foto da outra proposta para confirmar se a comparação é equivalente.");
  else if (signals.comparesPrice || signals.asksPrice) improvements.push("Explique o que está incluso e o que a solução resolve antes de entrar em desconto.");
  if (signals.hasNextMove) strengths.push("Você deixou uma próxima ação clara para o cliente.");
  else improvements.push("Feche a mensagem com uma ação objetiva: pedir medida, enviar foto, comparar opções ou combinar retorno.");
  if (signals.hasEmpathy) strengths.push("Você acolheu o cliente antes de conduzir a próxima etapa.");
  else if (["price-objection", "silent-customer", "after-sales"].includes(scenario.id)) improvements.push("Comece acolhendo a situação do cliente antes de entrar na solução ou na conferência.");
  if (signals.hasGuardrail) strengths.push("Você protegeu a conversa contra promessa sem confirmação.");
  else if (signals.mentionsTiming || signals.mentionsInstallation || scenario.id === "after-sales") improvements.push("Quando faltar confirmação, use ‘A confirmar’ e diga exatamente o que será conferido.");
  if (signals.hasPressure) improvements.push("Evite urgência artificial; use apenas cronograma real, medida e disponibilidade confirmada.");
  if (!strengths.length) strengths.push("Você manteve o atendimento aberto; agora transforme a fala em uma pergunta ou ação específica.");
  if (!improvements.length) improvements.push("Mantenha a clareza e responda ao detalhe que o cliente acabou de trazer.");

  const summary = score >= 8
    ? `Boa condução: você respondeu ao cenário e levou o cliente para ${reactive.customerNeed.toLowerCase()}`
    : score >= 6
      ? `Boa base. O cliente avançou, mas ainda precisa de ${reactive.customerNeed.toLowerCase()}`
      : `A resposta ficou ampla para este momento; o cliente ainda precisa de ${reactive.customerNeed.toLowerCase()}`;

  return {
    mode: "guiado",
    score,
    phase: turn === 0 ? "Abertura e diagnóstico" : turn < 3 ? "Descoberta e condução" : "Confirmação e fechamento",
    skillScores,
    summary,
    strengths: strengths.slice(0, 3),
    improvements: improvements.slice(0, 3),
    nextMove: reactive.nextMove,
    coachQuestion: signals.hasQuestion ? "O cliente respondeu exatamente ao que você perguntou?" : "Qual pergunta única faria o cliente avançar agora?",
    retryGuide: score >= 8 ? "Repita mantendo a mesma clareza e reduza a mensagem ao essencial." : "Na próxima tentativa, priorize a competência com menor nota e termine com uma ação concreta.",
    // Only curated customer-role messages can reach the chat in guided mode.
    // Reactive branches still drive the coaching analysis, but never write the
    // customer's speech, which prevents an accidental seller-role response.
    customerReply: guidedCustomerReply(scenario, progressionSignals),
    coachNote: reactive.coachNote,
    customerMood: reactive.customerMood,
    customerNeed: reactive.customerNeed,
  };
}

type AccountRecord = EmployeeUser & {
  createdAt: string;
  dataUpdatedAt: string | null;
  summary?: AccountSummary;
};

type AccountSummary = {
  learningIndex: number;
  averageScore: number;
  rounds: number;
  bestScore: number;
  scenariosPracticed: number;
  weakestSkill: TrainingSkillId | null;
  lastPracticedAt: string | null;
  quotes: number;
  closed: number;
  pendingFollowUps: number;
  preparedFactoryItems: number;
};

const emptyAccountSummary: AccountSummary = {
  learningIndex: 0,
  averageScore: 0,
  rounds: 0,
  bestScore: 0,
  scenariosPracticed: 0,
  weakestSkill: null,
  lastPracticedAt: null,
  quotes: 0,
  closed: 0,
  pendingFollowUps: 0,
  preparedFactoryItems: 0,
};

type AccountEditorState = {
  id: number | null;
  displayName: string;
  username: string;
  branch: EmployeeUser["branch"];
  password: string;
  confirmPassword: string;
};

function blankAccountEditor(id: number | null = null): AccountEditorState {
  return {
    id,
    displayName: "",
    username: "",
    branch: "Araraquara",
    password: "",
    confirmPassword: "",
  };
}

function formatAccountDate(value: string | null) {
  if (!value) return "Ainda não usado";
  const date = new Date(value.split("|", 1)[0]);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function AccountCenter({ onLogout, externalError }: { onLogout: () => Promise<void>; externalError?: string }) {
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<AccountRecord | null>(null);
  const [selectedState, setSelectedState] = useState<PersistedGuideState | null>(null);
  const [selectedSummary, setSelectedSummary] = useState<AccountSummary>(emptyAccountSummary);
  const [accountQuery, setAccountQuery] = useState("");
  const [branchFilter, setBranchFilter] = useState<"Todas" | EmployeeUser["branch"]>("Todas");
  const [editor, setEditor] = useState<AccountEditorState | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const [editorBusy, setEditorBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const detailsRequestRef = useRef<{ id: number; controller: AbortController } | null>(null);
  const detailsRequestIdRef = useRef(0);

  async function loadAccounts() {
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch("/api/admin/users", { cache: "no-store" });
      const payload = await readResponseJson<{ users?: AccountRecord[]; error?: string }>(response);
      if (!response.ok) throw new Error(payload.error || "Não foi possível carregar as contas.");
      setAccounts(Array.isArray(payload.users) ? payload.users : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar as contas.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadAccounts(); }, 0);
    return () => {
      window.clearTimeout(timer);
      detailsRequestRef.current?.controller.abort();
    };
  }, []);

  async function openAccount(account: AccountRecord) {
    detailsRequestRef.current?.controller.abort();
    const requestId = detailsRequestIdRef.current + 1;
    detailsRequestIdRef.current = requestId;
    const controller = new AbortController();
    detailsRequestRef.current = { id: requestId, controller };
    setSelectedAccount(account);
    setSelectedState(null);
    setSelectedSummary(account.summary ?? emptyAccountSummary);
    setDetailsError("");
    setDetailsLoading(true);
    try {
      const response = await apiFetch(`/api/admin/users/${account.id}`, { cache: "no-store", signal: controller.signal });
      if (detailsRequestRef.current?.id !== requestId) return;
      const payload = await readResponseJson<{ user?: AccountRecord; state?: PersistedGuideState | null; summary?: AccountSummary; error?: string }>(response);
      if (detailsRequestRef.current?.id !== requestId) return;
      if (!response.ok || !payload.user) throw new Error(payload.error || "Não foi possível abrir os dados da conta.");
      setSelectedAccount(payload.user);
      setSelectedState(payload.state && typeof payload.state === "object" ? payload.state : null);
      setSelectedSummary(payload.summary ?? payload.user.summary ?? emptyAccountSummary);
    } catch (loadError) {
      if (controller.signal.aborted || detailsRequestRef.current?.id !== requestId) return;
      setDetailsError(loadError instanceof Error ? loadError.message : "Não foi possível abrir os dados da conta.");
    } finally {
      if (detailsRequestRef.current?.id === requestId) {
        detailsRequestRef.current = null;
        setDetailsLoading(false);
      }
    }
  }

  function closeAccountDetails() {
    detailsRequestRef.current?.controller.abort();
    detailsRequestRef.current = null;
    setDetailsLoading(false);
    setDetailsError("");
    setSelectedAccount(null);
    setSelectedState(null);
    setSelectedSummary(emptyAccountSummary);
  }

  function startCreate() {
    setError("");
    setNotice("");
    closeAccountDetails();
    setEditor(blankAccountEditor());
  }

  function startEdit(account: AccountRecord) {
    setError("");
    setNotice("");
    setEditor({ id: account.id, displayName: account.displayName, username: account.username, branch: account.branch, password: "", confirmPassword: "" });
  }

  function closeEditor() {
    if (editorBusy) return;
    setEditor(null);
  }

  async function saveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    setError("");
    setNotice("");
    if (editor.password !== editor.confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }
    if (editor.id === null && editor.password.length < 8) {
      setError("A senha deve ter pelo menos 8 caracteres.");
      return;
    }
    if (editor.id !== null && editor.password && editor.password.length < 8) {
      setError("A nova senha deve ter pelo menos 8 caracteres.");
      return;
    }

    setEditorBusy(true);
    try {
      const endpoint = editor.id === null ? "/api/admin/users" : `/api/admin/users/${editor.id}`;
      const response = await apiFetch(endpoint, {
        method: editor.id === null ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: editor.displayName, username: editor.username, branch: editor.branch, password: editor.password }),
      });
      const payload = await readResponseJson<{ user?: AccountRecord; error?: string }>(response);
      if (!response.ok || !payload.user) throw new Error(payload.error || "Não foi possível salvar o funcionário.");
      const wasNew = editor.id === null;
      setEditor(null);
      closeAccountDetails();
      await loadAccounts();
      setNotice(wasNew ? "Funcionário criado com sucesso." : "Perfil atualizado com sucesso.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar o funcionário.");
    } finally {
      setEditorBusy(false);
    }
  }

  async function deleteAccount(account: AccountRecord) {
    if (!window.confirm(`Apagar o perfil de ${account.displayName}? Os registros e o acesso dessa conta também serão removidos.`)) return;
    setError("");
    setNotice("");
    setDeletingId(account.id);
    try {
      const response = await apiFetch(`/api/admin/users/${account.id}`, { method: "DELETE" });
      const payload = await readResponseJson<{ error?: string }>(response);
      if (!response.ok) throw new Error(payload.error || "Não foi possível apagar o funcionário.");
      if (selectedAccount?.id === account.id) {
        closeAccountDetails();
      }
      if (editor?.id === account.id) setEditor(null);
      await loadAccounts();
      setNotice("Funcionário apagado com sucesso.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Não foi possível apagar o funcionário.");
    } finally {
      setDeletingId(null);
    }
  }

  const stateEntries = selectedState ? Object.entries(selectedState).filter(([, value]) => value !== undefined && value !== null) : [];
  const visibleAccounts = accounts.filter((account) => {
    const query = accountQuery.trim().toLocaleLowerCase("pt-BR");
    const matchesQuery = !query || `${account.displayName} ${account.username}`.toLocaleLowerCase("pt-BR").includes(query);
    return matchesQuery && (branchFilter === "Todas" || account.branch === branchFilter);
  });
  const trainedAccounts = accounts.filter((account) => (account.summary?.rounds ?? 0) > 0);
  const averageLearning = trainedAccounts.length
    ? Math.round(trainedAccounts.reduce((total, account) => total + (account.summary?.learningIndex ?? 0), 0) / trainedAccounts.length)
    : 0;

  return (
    <main className="account-shell">
      <section className="account-card" aria-labelledby="accounts-title">
        <header className="account-header">
          <div className="auth-brand">
            <div className="brand-mark auth-mark">MP</div>
            <div>
              <strong>MULT PORTAS</strong>
              <span>Guia comercial interno</span>
            </div>
          </div>
          <div className="account-actions">
            <button className="button primary account-new" type="button" onClick={startCreate}>Novo funcionário <span>+</span></button>
            <button
              className="button account-refresh"
              type="button"
              onClick={() => void loadAccounts()}
              disabled={loading}
              aria-busy={loading}
            >
              <span aria-hidden="true">{loading ? "…" : "↻"}</span>
              {loading ? "Atualizando…" : "Atualizar"}
            </button>
            <button className="logout-button account-logout" type="button" onClick={() => void onLogout()}>Sair</button>
          </div>
        </header>

        <div className="account-heading">
          <span className="section-kicker">GESTÃO DE FUNCIONÁRIOS</span>
          <h1 id="accounts-title">Perfis sob controle.</h1>
          <p>Crie, edite ou apague perfis e consulte os registros separados de cada funcionário.</p>
        </div>

        {(error || externalError) && <div className="auth-error" role="alert">{error || externalError}</div>}
        {notice && <div className="account-notice" role="status">✓ {notice}</div>}

        <section className="account-overview" aria-label="Resumo da equipe">
          <div><strong>{accounts.length}</strong><span>funcionários</span><small>perfis com dados separados</small></div>
          <div><strong>{accounts.filter((account) => account.dataUpdatedAt).length}</strong><span>contas utilizadas</span><small>com registros sincronizados</small></div>
          <div><strong>{trainedAccounts.length}</strong><span>em treinamento</span><small>com pelo menos uma rodada</small></div>
          <div><strong>{trainedAccounts.length ? `${averageLearning}/100` : "—"}</strong><span>aprendizado médio</span><small>somente quem já treinou</small></div>
        </section>

        <div className="account-filters">
          <label><span>Buscar funcionário</span><input value={accountQuery} onChange={(event) => setAccountQuery(event.target.value)} placeholder="Nome ou usuário" type="search" /></label>
          <label><span>Filial</span><select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value as typeof branchFilter)}><option>Todas</option><option>Araraquara</option><option>São Carlos</option></select></label>
          <span>{visibleAccounts.length} de {accounts.length} perfis</span>
        </div>

        {loading ? (
          <div className="account-empty" aria-live="polite">Carregando contas…</div>
        ) : accounts.length === 0 ? (
          <div className="account-empty">Nenhuma conta cadastrada.</div>
        ) : visibleAccounts.length === 0 ? (
          <div className="account-empty">Nenhum funcionário corresponde aos filtros.</div>
        ) : (
          <div className="account-list">
            {visibleAccounts.map((account) => (
              <article className={`account-row ${selectedAccount?.id === account.id ? "selected" : ""}`} key={account.id}>
                <div className="account-avatar">{account.displayName.slice(0, 1).toUpperCase()}</div>
                <div className="account-main">
                  <strong>{account.displayName}</strong>
                  <span>{account.username} · {account.branch}</span>
                </div>
                <div className="account-meta">
                  <small>Cadastro</small>
                  <span>{formatAccountDate(account.createdAt)}</span>
                </div>
                <div className="account-meta">
                  <small>Registros</small>
                  <span>{account.dataUpdatedAt ? formatAccountDate(account.dataUpdatedAt) : "Sem dados"}</span>
                </div>
                <div className="account-row-actions">
                  <button className="account-open" type="button" onClick={() => void openAccount(account)}>{selectedAccount?.id === account.id ? "Atualizar" : "Abrir dados"} <span>→</span></button>
                  <button className="account-edit" type="button" onClick={() => startEdit(account)}>Editar</button>
                  <button className="account-delete" type="button" onClick={() => void deleteAccount(account)} disabled={deletingId === account.id}>{deletingId === account.id ? "Apagando…" : "Apagar"}</button>
                </div>
              </article>
            ))}
          </div>
        )}

        {editor && (
          <section className="account-editor" aria-labelledby="account-editor-title">
            <div className="account-detail-head">
              <div>
                <span className="section-kicker">{editor.id === null ? "NOVO FUNCIONÁRIO" : "EDITAR PERFIL"}</span>
                <h2 id="account-editor-title">{editor.id === null ? "Criar acesso" : "Atualizar dados"}</h2>
                <p>{editor.id === null ? "O perfil já ficará pronto para entrar no guia." : "Deixe a senha em branco para mantê-la como está."}</p>
              </div>
              <button className="text-button" type="button" onClick={closeEditor} disabled={editorBusy}>Fechar <span>×</span></button>
            </div>
            <form className="account-editor-form" onSubmit={saveAccount}>
              <label><span>Nome completo</span><input value={editor.displayName} onChange={(event) => setEditor((current) => current ? { ...current, displayName: event.target.value } : current)} autoComplete="name" required /></label>
              <label><span>Usuário</span><input value={editor.username} onChange={(event) => setEditor((current) => current ? { ...current, username: event.target.value } : current)} autoComplete="username" required /></label>
              <label><span>Filial</span><select value={editor.branch} onChange={(event) => setEditor((current) => current ? { ...current, branch: event.target.value as EmployeeUser["branch"] } : current)}><option value="Araraquara">Araraquara</option><option value="São Carlos">São Carlos</option></select></label>
              <label><span>{editor.id === null ? "Senha" : "Nova senha (opcional)"}</span><input type="password" value={editor.password} onChange={(event) => setEditor((current) => current ? { ...current, password: event.target.value } : current)} placeholder={editor.id === null ? "Mínimo de 8 caracteres" : "Deixe em branco para manter"} autoComplete="new-password" minLength={editor.id === null || editor.password ? 8 : undefined} maxLength={120} required={editor.id === null} /></label>
              <label><span>Confirmar senha</span><input type="password" value={editor.confirmPassword} onChange={(event) => setEditor((current) => current ? { ...current, confirmPassword: event.target.value } : current)} placeholder="Repita a senha" autoComplete="new-password" minLength={editor.id === null || editor.password ? 8 : undefined} maxLength={120} required={editor.id === null || Boolean(editor.password)} /></label>
              <div className="account-editor-actions"><button className="button ghost account-cancel" type="button" onClick={closeEditor} disabled={editorBusy}>Cancelar</button><button className="button primary" type="submit" disabled={editorBusy}>{editorBusy ? "Salvando…" : editor.id === null ? "Criar funcionário" : "Salvar alterações"}<span>→</span></button></div>
            </form>
          </section>
        )}

        {selectedAccount && (
          <section className="account-detail" aria-live="polite">
            <div className="account-detail-head">
              <div>
                <span className="section-kicker">REGISTROS DA CONTA</span>
                <h2>{selectedAccount.displayName}</h2>
                <p>{selectedAccount.username} · {selectedAccount.branch}</p>
              </div>
              <button className="text-button" type="button" onClick={closeAccountDetails}>Fechar <span>×</span></button>
            </div>
            {detailsLoading ? (
              <div className="account-empty">Abrindo registros…</div>
            ) : detailsError ? (
              <div className="auth-error" role="alert">{detailsError}</div>
            ) : (
              <>
                <div className="account-performance-grid">
                  <article><span>Aprendizado</span><strong>{selectedSummary.learningIndex}/100</strong><small>{selectedSummary.rounds ? `${selectedSummary.rounds} rodadas · média ${selectedSummary.averageScore}/10` : "Treinamento ainda não iniciado"}</small></article>
                  <article><span>Melhor resultado</span><strong>{selectedSummary.bestScore ? `${selectedSummary.bestScore}/10` : "—"}</strong><small>{selectedSummary.scenariosPracticed} cenários praticados</small></article>
                  <article><span>Carteira informada</span><strong>{selectedSummary.quotes}</strong><small>{selectedSummary.closed} vendas fechadas</small></article>
                  <article><span>Ações abertas</span><strong>{selectedSummary.pendingFollowUps}</strong><small>{selectedSummary.preparedFactoryItems} itens preparados para fábrica</small></article>
                </div>
                {stateEntries.length === 0 ? (
                  <div className="account-empty">Esta conta ainda não possui registros salvos.</div>
                ) : (
                  <details className="account-raw-data">
                    <summary>Ver dados técnicos da conta</summary>
                    <p>Visualização para auditoria. Os registros continuam isolados e não são combinados com outros funcionários.</p>
                    <div className="account-state-grid">
                      {stateEntries.map(([key, value]) => (
                        <article key={key}>
                          <span>{key}</span>
                          <pre>{JSON.stringify(value, null, 2)}</pre>
                        </article>
                      ))}
                    </div>
                  </details>
                )}
              </>
            )}
          </section>
        )}
      </section>
    </main>
  );
}

export default function Home() {
  const [authUser, setAuthUser] = useState<EmployeeUser | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authForm, setAuthForm] = useState<AuthFormState>({
    displayName: "",
    username: "",
    branch: "Araraquara",
    password: "",
    confirmPassword: "",
  });
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileForm, setProfileForm] = useState<ProfileFormState>({
    displayName: "",
    username: "",
    branch: "Araraquara",
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [section, setSection] = useState<Section>("overview");
  const [activeSalesStep, setActiveSalesStep] = useState(0);
  const [activeTrainingScenario, setActiveTrainingScenario] = useState(0);
  const [activeTimingStep, setActiveTimingStep] = useState(0);
  const [brand, setBrand] = useState<BrandId>("dalcomad");
  const [messageAudience, setMessageAudience] = useState<QuickMessageAudience>("Cliente");
  const [messageName, setMessageName] = useState("");
  const [messageLine, setMessageLine] = useState("Kit porta pronta");
  const [messageEnvironment, setMessageEnvironment] = useState("");
  const [messageObjective, setMessageObjective] = useState("apresentar uma opção de qualidade");
  const [messageQuestion, setMessageQuestion] = useState("");
  const [messageChannel, setMessageChannel] = useState<QuickMessageChannel>("WhatsApp");
  const [messageTone, setMessageTone] = useState<QuickMessageTone>("Consultivo");
  const [messageProof, setMessageProof] = useState({ company: true, quality: true, guarantee: true });
  const [providerProfile, setProviderProfile] = useState<ProviderPresentationProfile>("Prestador de Serviço");
  const [providerName, setProviderName] = useState("");
  const [providerType, setProviderType] = useState(providerTypeOptions[0]);
  const [providerRegion, setProviderRegion] = useState("Araraquara e região");
  const [providerObjective, setProviderObjective] = useState(providerGoalOptions[0]);
  const [providerQuestion, setProviderQuestion] = useState(providerQuestionOptions[0]);
  const [fairProfileId, setFairProfileId] = useState<FairProfileId>("neutral");
  const [fairClientName, setFairClientName] = useState("");
  const [fairConsultantName, setFairConsultantName] = useState("");
  const [fairInterest, setFairInterest] = useState("");
  const [fairChannel, setFairChannel] = useState<QuickMessageChannel>("WhatsApp");
  const [fairTone, setFairTone] = useState<FairTone>("welcoming");
  const [fairEventDate, setFairEventDate] = useState("sábado, 29/08");
  const [fairEventTime, setFairEventTime] = useState("das 9h às 17h");
  const [fairCity, setFairCity] = useState("Araraquara");
  const [fairDiscount, setFairDiscount] = useState("até 60% OFF");
  const [fairEmojiMode, setFairEmojiMode] = useState<FairEmojiMode>("mixed");
  const [fairVariation, setFairVariation] = useState(0);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogFamily, setCatalogFamily] = useState("Todas");
  const [selectedCatalog, setSelectedCatalog] = useState<CatalogItem | null>(null);
  const [drawerChecks, setDrawerChecks] = useState<Record<string, string[]>>({});
  const [doneSales, setDoneSales] = useState<string[]>([]);
  const [doneTiming, setDoneTiming] = useState<string[]>([]);
  const [followUps, setFollowUps] = useState<LocalFollowUp[]>(defaultFollowUps);
  const [dailyDone, setDailyDone] = useState<string[]>([]);
  const [metrics, setMetrics] = useState(defaultMetrics);
  const [trainingMessages, setTrainingMessages] = useState<TrainingMessage[]>([]);
  const [trainingInput, setTrainingInput] = useState("");
  const [trainingFeedback, setTrainingFeedback] = useState<TrainingFeedback | null>(null);
  const [trainingBusy, setTrainingBusy] = useState(false);
  const [trainingStarted, setTrainingStarted] = useState(false);
  const [trainingInputMode, setTrainingInputMode] = useState<"voice" | "text">("voice");
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceCapturePending, setVoiceCapturePending] = useState(false);
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceInterim, setVoiceInterim] = useState("");
  const [voicePreviewUrl, setVoicePreviewUrl] = useState("");
  const [voiceStatus, setVoiceStatus] = useState("Pronto para treinar por áudio");
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [trainingLevelFilter, setTrainingLevelFilter] = useState<TrainingFilter>("Todos");
  const [trainingStats, setTrainingStats] = useState<TrainingStats>(emptyTrainingStats);
  const [factoryItems, setFactoryItems] = useState<FactoryRequestItem[]>(defaultFactoryItems);
  const [factoryWizardStep, setFactoryWizardStep] = useState(0);
  const [factoryWizardDraft, setFactoryWizardDraft] = useState<Record<FactoryWizardField, string>>(blankFactoryWizard);
  const [editingFactoryItemId, setEditingFactoryItemId] = useState<string | null>(null);
  const [newClient, setNewClient] = useState("");
  const [newNext, setNewNext] = useState("");
  const [newStatus, setNewStatus] = useState("Aguardando retorno");
  const [newPriority, setNewPriority] = useState<Priority>("Média");
  const [filterStatus, setFilterStatus] = useState("Todos");
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [dataLoadError, setDataLoadError] = useState("");
  const [dataLoadAttempt, setDataLoadAttempt] = useState(0);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [today, setToday] = useState("30 JUL 2026");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceFinalPartsRef = useRef<string[]>([]);
  const voiceUrlsRef = useRef<string[]>([]);
  const pendingStateRef = useRef<{ userId: number; state: PersistedGuideState; baseRevision: string | null } | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const flushLoopRef = useRef<Promise<boolean> | null>(null);
  const revisionRef = useRef<string | null>(null);
  const skipNextAutosaveRef = useRef(false);
  const toastTimerRef = useRef<number | null>(null);
  const trainingChatEndRef = useRef<HTMLDivElement | null>(null);
  const trainingRequestRef = useRef<{ id: number; controller: AbortController } | null>(null);
  const trainingRequestIdRef = useRef(0);
  const voiceCaptureAttemptRef = useRef(0);
  const profileDialogRef = useRef<HTMLElement | null>(null);
  const profileTriggerRef = useRef<HTMLButtonElement | null>(null);
  const profileBusyRef = useRef(false);
  const catalogDialogRef = useRef<HTMLElement | null>(null);
  const catalogTriggerRef = useRef<HTMLButtonElement | null>(null);
  const factoryIdRef = useRef(0);
  const authUserId = authUser?.id ?? null;

  const flushPendingState = useCallback(async (): Promise<boolean> => {
    if (flushLoopRef.current) return await flushLoopRef.current;
    const loop = (async (): Promise<boolean> => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }

      while (pendingStateRef.current) {
        const pending = pendingStateRef.current;
        pendingStateRef.current = null;
        // Never let a delayed save from one employee be sent while another
        // employee is the active session.
        if (!authUserId || authUserId !== pending.userId) return false;
        setSaveStatus("saving");
        try {
          const response = await apiFetch("/api/data", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state: pending.state, baseRevision: pending.baseRevision }),
          });
          const payload = await readResponseJson<{ revision?: unknown; error?: string }>(response);
          if (!response.ok) {
            const error = new Error(payload.error || "Não foi possível salvar os dados agora.") as Error & { status?: number };
            error.status = response.status;
            throw error;
          }
          const revision = typeof payload.revision === "string" ? payload.revision : null;
          revisionRef.current = revision;
          clearScopedLocalState(pending.userId);
          const queuedAfterSave = pendingStateRef.current as unknown as { userId: number; state: PersistedGuideState; baseRevision: string | null } | null;
          if (queuedAfterSave?.userId === pending.userId) {
            pendingStateRef.current = { ...queuedAfterSave, baseRevision: revision };
            writeLocalPendingState(pending.userId, {
              state: queuedAfterSave.state,
              baseRevision: revision,
              updatedAt: new Date().toISOString(),
            });
          }
          setLastSavedAt(new Date());
          setSaveStatus("saved");
        } catch (error) {
          if (authUserId === pending.userId && !pendingStateRef.current) pendingStateRef.current = pending;
          const status = (error as Error & { status?: number }).status;
          if (status === 401) {
            setAuthError("Sua sessão expirou. Entre novamente para sincronizar as alterações preservadas neste navegador.");
            setHydrated(false);
            setDataLoaded(false);
            setAuthUser(null);
          }
          setSaveStatus(status === 409 ? "conflict" : typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error");
          return false;
        }
      }
      return true;
    })();
    flushLoopRef.current = loop;
    try {
      return await loop;
    } finally {
      if (flushLoopRef.current === loop) flushLoopRef.current = null;
    }
  }, [authUserId]);

  useEffect(() => {
    const retryWhenOnline = () => { void flushPendingState(); };
    window.addEventListener("online", retryWhenOnline);
    return () => window.removeEventListener("online", retryWhenOnline);
  }, [flushPendingState]);

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => response.ok ? await readResponseJson<{ user?: EmployeeUser | null; admin?: boolean }>(response) : { user: null, admin: false })
      .then((data) => {
        if (cancelled) return;
        setIsAdmin(data.admin === true);
        setAuthUser(data.user && typeof data.user.id === "number" ? data.user : null);
        setAuthLoading(false);
      })
      .catch(() => {
        if (!cancelled) setAuthLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!authUserId) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      let state: PersistedGuideState | null = null;
      let usingLocalBackup = false;
      try {
        const response = await apiFetch("/api/data", { cache: "no-store" });
        const payload = await readResponseJson<{ state?: unknown; revision?: unknown; error?: string }>(response);
        if (!response.ok) {
          if (response.status === 401) {
            if (!cancelled) {
              setAuthError("Sua sessão expirou. Entre novamente para continuar.");
              setAuthUser(null);
            }
            return;
          }
          throw new Error(payload.error || "Não foi possível abrir seus dados.");
        }
        const serverRevision = typeof payload.revision === "string" ? payload.revision : null;
        revisionRef.current = serverRevision;
        if (payload.state && typeof payload.state === "object" && !Array.isArray(payload.state)) {
          state = payload.state as PersistedGuideState;
        }
        const localPending = readLocalPendingState(authUserId);
        if (localPending) {
          state = localPending.state;
          revisionRef.current = localPending.baseRevision;
          usingLocalBackup = true;
        } else {
          clearScopedLocalState(authUserId);
        }
      } catch (error) {
        if (!cancelled) {
          setDataLoadError(error instanceof Error && error.name === "AbortError"
            ? "O servidor demorou para responder. Seus dados locais foram preservados."
            : error instanceof Error ? error.message : "Não foi possível abrir seus dados.");
        }
        return;
      }
      if (cancelled) return;

      const savedSales = Array.isArray(state?.sales) ? state.sales : [];
      const savedTiming = Array.isArray(state?.timing) ? state.timing : [];
      const savedFollowUps = Array.isArray(state?.followups) ? state.followups : null;
      const savedChecks = Array.isArray(state?.checks) ? state.checks : [];
      const savedMetrics = state?.metrics;
      const savedTraining = state?.training;
      const savedMessages = state?.messages;
      const savedFactory = state?.factory;
      const savedDrawerChecks = state?.drawerChecks;

      setDoneSales(savedSales.filter((item): item is string => typeof item === "string"));
      setDoneTiming(savedTiming.filter((item): item is string => typeof item === "string"));
      setFollowUps(Array.isArray(savedFollowUps) ? normalizeFollowUps(savedFollowUps) : []);
      setDailyDone(savedChecks.filter((item): item is string => typeof item === "string"));
      setMetrics(savedMetrics && typeof savedMetrics === "object" ? normalizeMetrics(savedMetrics) : { ...defaultMetrics });
      if (savedTraining && typeof savedTraining === "object") {
        const training = savedTraining as { rounds?: unknown; sessions?: unknown; best?: unknown; scenarios?: unknown; scoreHistory?: unknown; skillHistory?: unknown; scenarioStats?: unknown; lastPracticedAt?: unknown };
        setTrainingStats({
          rounds: Math.max(0, Math.round(Number(training.rounds ?? training.sessions) || 0)),
          best: clampTrainingScore(Number(training.best)),
          scenarios: Array.isArray(training.scenarios) ? training.scenarios.filter((item): item is string => typeof item === "string") : [],
          scoreHistory: Array.isArray(training.scoreHistory)
            ? training.scoreHistory.filter((item): item is number => typeof item === "number" && Number.isFinite(item)).map((item) => Math.max(0, Math.min(10, Math.round(item)))).slice(-120)
            : [],
          skillHistory: Array.isArray(training.skillHistory)
            ? training.skillHistory.filter(isTrainingRecord).map((item) => normalizeSkillScores(item)).slice(-120)
            : [],
          scenarioStats: normalizeScenarioStats(training.scenarioStats),
          lastPracticedAt: typeof training.lastPracticedAt === "string" ? training.lastPracticedAt.slice(0, 40) : null,
        });
      } else setTrainingStats(emptyTrainingStats());
      setFactoryItems(savedFactory ? normalizeFactoryState(savedFactory) : []);
      if (savedDrawerChecks && typeof savedDrawerChecks === "object" && !Array.isArray(savedDrawerChecks)) {
        const normalizedChecks: Record<string, string[]> = {};
        for (const [itemId, checks] of Object.entries(savedDrawerChecks).slice(0, 240)) {
          if (Array.isArray(checks) && !["__proto__", "prototype", "constructor"].includes(itemId)) {
            normalizedChecks[itemId] = checks.filter((item): item is string => typeof item === "string").slice(0, 40);
          }
        }
        setDrawerChecks(normalizedChecks);
      } else setDrawerChecks({});
      const planner = savedMessages && typeof savedMessages === "object" && !Array.isArray(savedMessages)
        ? savedMessages as Partial<{
          name: string;
          line: string;
          environment: string;
          objective: string;
          question: string;
          channel: QuickMessageChannel;
          tone: QuickMessageTone;
          proof: { company?: boolean; quality?: boolean; guarantee?: boolean };
          audience: QuickMessageAudience;
          provider: {
            profile?: ProviderPresentationProfile;
            name?: string;
            type?: string;
            region?: string;
            objective?: string;
            question?: string;
          };
          fair: {
            profileId?: FairProfileId;
            clientName?: string;
            consultantName?: string;
            interest?: string;
            channel?: QuickMessageChannel;
            tone?: FairTone;
            eventDate?: string;
            eventTime?: string;
            city?: string;
            discount?: string;
            emojiMode?: FairEmojiMode;
            includeEmojis?: boolean;
          };
        }>
        : {};
      setMessageAudience(planner.audience === "Prestador" ? "Prestador" : "Cliente");
      setMessageName(typeof planner.name === "string" ? planner.name : "");
      setMessageLine(typeof planner.line === "string" && planner.line ? planner.line : "Kit porta pronta");
      setMessageEnvironment(typeof planner.environment === "string" ? planner.environment : "");
      setMessageObjective(typeof planner.objective === "string" && planner.objective ? planner.objective : "apresentar uma opção de qualidade");
      setMessageQuestion(typeof planner.question === "string" ? planner.question : "");
      setMessageChannel(planner.channel === "Áudio" ? "Áudio" : "WhatsApp");
      setMessageTone(planner.tone === "Direto" || planner.tone === "Próximo" ? planner.tone : "Consultivo");
      setMessageProof({
        company: planner.proof?.company !== false,
        quality: planner.proof?.quality !== false,
        guarantee: planner.proof?.guarantee !== false,
      });
      const savedProviderProfile: ProviderPresentationProfile = planner.provider?.profile === "Empresa" ? "Empresa" : "Prestador de Serviço";
      const savedProviderTypeOptions = savedProviderProfile === "Empresa" ? providerCompanyTypeOptions : providerTypeOptions;
      const savedProviderGoalOptions = savedProviderProfile === "Empresa" ? providerCompanyGoalOptions : providerGoalOptions;
      const savedProviderQuestionOptions = savedProviderProfile === "Empresa" ? providerCompanyQuestionOptions : providerQuestionOptions;
      setProviderProfile(savedProviderProfile);
      setProviderName(typeof planner.provider?.name === "string" ? planner.provider.name : "");
      setProviderType(typeof planner.provider?.type === "string" && savedProviderTypeOptions.includes(planner.provider.type) ? planner.provider.type : savedProviderTypeOptions[0]);
      setProviderRegion(typeof planner.provider?.region === "string" && planner.provider.region ? planner.provider.region : "Araraquara e região");
      setProviderObjective(typeof planner.provider?.objective === "string" && savedProviderGoalOptions.includes(planner.provider.objective) ? planner.provider.objective : savedProviderGoalOptions[0]);
      setProviderQuestion(typeof planner.provider?.question === "string" && savedProviderQuestionOptions.includes(planner.provider.question) ? planner.provider.question : savedProviderQuestionOptions[0]);
      setFairProfileId(planner.fair?.profileId && fairClientProfiles.some((profile) => profile.id === planner.fair?.profileId) ? planner.fair.profileId : "neutral");
      setFairClientName(typeof planner.fair?.clientName === "string" ? planner.fair.clientName : "");
      setFairConsultantName(typeof planner.fair?.consultantName === "string" ? planner.fair.consultantName : "");
      setFairInterest(typeof planner.fair?.interest === "string" ? planner.fair.interest : "");
      setFairChannel(planner.fair?.channel === "Áudio" ? "Áudio" : "WhatsApp");
      setFairTone(planner.fair?.tone === "direct" || planner.fair?.tone === "persuasive" ? planner.fair.tone : "welcoming");
      setFairEventDate(typeof planner.fair?.eventDate === "string" && planner.fair.eventDate ? planner.fair.eventDate : "sábado, 29/08");
      setFairEventTime(typeof planner.fair?.eventTime === "string" && planner.fair.eventTime ? planner.fair.eventTime : "das 9h às 17h");
      setFairCity(typeof planner.fair?.city === "string" && planner.fair.city ? planner.fair.city : "Araraquara");
      setFairDiscount(typeof planner.fair?.discount === "string" && planner.fair.discount ? planner.fair.discount : "até 60% OFF");
      setFairEmojiMode(fairEmojiModes.some((mode) => mode.id === planner.fair?.emojiMode)
        ? planner.fair?.emojiMode as FairEmojiMode
        : planner.fair?.includeEmojis === false ? "none" : "mixed");
      setSaveStatus(usingLocalBackup ? (navigator.onLine ? "saving" : "offline") : "saved");
      setToday(formatToday());
      skipNextAutosaveRef.current = !usingLocalBackup;
      setDataLoaded(true);
      setHydrated(true);
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [authUserId, dataLoadAttempt]);

  useEffect(() => {
    const browserWindow = window as typeof window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const hasSpeechRecognition = Boolean(browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition);
    const hasVoiceRecorder = Boolean(navigator.mediaDevices && typeof MediaRecorder !== "undefined");
    const capabilityTimer = window.setTimeout(() => {
      setSpeechSupported(hasSpeechRecognition);
      setVoiceSupported(hasVoiceRecorder);
    }, 0);

    return () => {
      window.clearTimeout(capabilityTimer);
      voiceCaptureAttemptRef.current += 1;
      trainingRequestRef.current?.controller.abort();
      speechRecognitionRef.current?.abort();
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      mediaRecorderRef.current = null;
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      window.speechSynthesis?.cancel();
      voiceUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    if (authUserId) return;
    voiceCaptureAttemptRef.current += 1;
    trainingRequestRef.current?.controller.abort();
    trainingRequestRef.current = null;
    speechRecognitionRef.current?.abort();
    speechRecognitionRef.current = null;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    mediaRecorderRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    const stateTimer = window.setTimeout(() => {
      setVoiceCapturePending(false);
      setTrainingBusy(false);
      setIsRecording(false);
    }, 0);
    return () => window.clearTimeout(stateTimer);
  }, [authUserId]);

  useEffect(() => {
    if (!isRecording) return;
    const timer = window.setInterval(() => setVoiceSeconds((current) => current + 1), 1000);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  useEffect(() => {
    if (!trainingStarted) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    trainingChatEndRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" });
  }, [trainingBusy, trainingMessages, trainingStarted]);

  useEffect(() => {
    if (!authUser || !hydrated || !dataLoaded) return;
    const state: PersistedGuideState = {
      schemaVersion: 4,
      sales: doneSales,
      timing: doneTiming,
      followups: followUps,
      checks: dailyDone,
      metrics,
      training: trainingStats,
      factory: factoryItems.map((item) => ({ ...item, manufacturer: "DALCOMAD" })),
      drawerChecks,
      messages: {
        audience: messageAudience,
        name: messageName,
        line: messageLine,
        environment: messageEnvironment,
        objective: messageObjective,
        question: messageQuestion,
        channel: messageChannel,
        tone: messageTone,
        proof: messageProof,
        provider: {
          profile: providerProfile,
          name: providerName,
          type: providerType,
          region: providerRegion,
          objective: providerObjective,
          question: providerQuestion,
        },
        fair: {
          profileId: fairProfileId,
          clientName: fairClientName,
          consultantName: fairConsultantName,
          interest: fairInterest,
          channel: fairChannel,
          tone: fairTone,
          eventDate: fairEventDate,
          eventTime: fairEventTime,
          city: fairCity,
          discount: fairDiscount,
          emojiMode: fairEmojiMode,
          includeEmojis: fairEmojiMode !== "none",
        },
      },
    };

    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false;
      return;
    }

    const localEntries: [keyof typeof STORAGE, unknown][] = [
      ["sales", state.sales],
      ["timing", state.timing],
      ["followups", state.followups],
      ["checks", state.checks],
      ["metrics", state.metrics],
      ["training", state.training],
      ["messages", state.messages],
      ["factory", state.factory],
    ];
    for (const [key, value] of localEntries) writeScopedLocalState(authUser.id, STORAGE[key], value);
    writeScopedLocalState(authUser.id, "drawer-checks-v1", drawerChecks);
    const baseRevision = pendingStateRef.current?.userId === authUser.id
      ? pendingStateRef.current.baseRevision
      : revisionRef.current;
    pendingStateRef.current = { userId: authUser.id, state, baseRevision };
    writeLocalPendingState(authUser.id, { state, baseRevision, updatedAt: new Date().toISOString() });

    const timer = window.setTimeout(() => {
      if (saveTimerRef.current === timer) saveTimerRef.current = null;
      void flushPendingState();
    }, 450);
    saveTimerRef.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (saveTimerRef.current === timer) saveTimerRef.current = null;
    };
  }, [authUser, dailyDone, dataLoaded, doneSales, doneTiming, drawerChecks, factoryItems, fairChannel, fairCity, fairClientName, fairConsultantName, fairDiscount, fairEmojiMode, fairEventDate, fairEventTime, fairInterest, fairProfileId, fairTone, flushPendingState, followUps, hydrated, messageAudience, messageChannel, messageEnvironment, messageLine, messageName, messageObjective, messageProof, messageQuestion, messageTone, metrics, providerName, providerObjective, providerProfile, providerQuestion, providerRegion, providerType, trainingStats]);

  useEffect(() => {
    if (!authUserId) return;
    const flushOnPageHide = () => {
      const pending = pendingStateRef.current;
      if (!pending || pending.userId !== authUserId) return;
      const body = JSON.stringify({ state: pending.state, baseRevision: pending.baseRevision });
      // Browser keepalive requests have a small payload ceiling. Larger states
      // remain safely queued in localStorage and retry when the guide reopens.
      if (body.length > 60_000) return;
      void fetch("/api/data", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body,
        keepalive: true,
      });
    };
    window.addEventListener("pagehide", flushOnPageHide);
    return () => window.removeEventListener("pagehide", flushOnPageHide);
  }, [authUserId]);

  useEffect(() => {
    if (!selectedCatalog) return;
    const dialog = catalogDialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1']):not([disabled])") ?? []);
    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedCatalog(null);
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleDialogKeys);
    window.requestAnimationFrame(() => focusable()[0]?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleDialogKeys);
      catalogTriggerRef.current?.focus();
    };
  }, [selectedCatalog]);

  useEffect(() => {
    profileBusyRef.current = profileBusy;
  }, [profileBusy]);

  useEffect(() => {
    if (!profileOpen) return;
    const dialog = profileDialogRef.current;
    const trigger = profileTriggerRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1']):not([disabled])") ?? []);
    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !profileBusyRef.current) {
        setProfileOpen(false);
        setProfileError("");
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleDialogKeys);
    window.requestAnimationFrame(() => focusable()[0]?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleDialogKeys);
      trigger?.focus();
    };
  }, [profileOpen]);

  const currentBrand = brandData[brand];
  const currentTrainingScenario = trainingScenarios[activeTrainingScenario];
  const visibleTrainingScenarios = useMemo(
    () => trainingLevelFilter === "Todos" ? trainingScenarios : trainingScenarios.filter((scenario) => scenario.level === trainingLevelFilter),
    [trainingLevelFilter],
  );
  const families = useMemo(() => ["Todas", ...Array.from(new Set(catalogItems.filter((item) => item.brand === brand).map((item) => item.family)))], [brand]);
  const filteredCatalog = useMemo(() => {
    const term = catalogSearch.trim().toLowerCase();
    return catalogItems.filter((item) => {
      const matchesBrand = item.brand === brand;
      const matchesFamily = catalogFamily === "Todas" || item.family === catalogFamily;
      const matchesTerm = !term || `${item.title} ${item.family} ${item.code || ""} ${item.spec}`.toLowerCase().includes(term);
      return matchesBrand && matchesFamily && matchesTerm;
    });
  }, [brand, catalogFamily, catalogSearch]);

  const activeSales = salesSteps[activeSalesStep];
  const activeTiming = timingSteps[activeTimingStep];
  const completedSales = doneSales.length;
  const completedTiming = doneTiming.length;
  const filteredFollowUps = followUps.filter((item) => filterStatus === "Todos" || item.status === filterStatus);
  const portfolioCount = Math.round(normalizeMetricNumber(metrics.quotes));
  const officialQuoteCount = Math.round(normalizeMetricNumber(metrics.officialQuotes));
  const incompleteQuoteCount = Math.round(normalizeMetricNumber(metrics.incompleteQuotes));
  const openActionCount = incompleteQuoteCount + followUps.filter((item) => !item.done).length;
  const filledFactoryItems = factoryItems.filter(hasFactoryContent);
  const activeFactoryWizardStep = factoryWizardSteps[factoryWizardStep];
  const activeFactoryWizardOptions = activeFactoryWizardStep.key === "line" || activeFactoryWizardStep.key === "finish" || activeFactoryWizardStep.key === "color"
    ? availableDalcomadKitValues(activeFactoryWizardStep.key, factoryWizardDraft)
    : factoryWizardOptions[activeFactoryWizardStep.key];
  const activeFactoryWizardUsesSelect = activeFactoryWizardStep.key === "line" || activeFactoryWizardStep.key === "finish" || activeFactoryWizardStep.key === "color";
  const factoryWizardProgress = ((factoryWizardStep + 1) / factoryWizardSteps.length) * 100;
  const metricsConversion = metrics.quotes ? (metrics.closed / metrics.quotes) * 100 : 0;
  const metricsReturn = metrics.quotes ? (metrics.followups / metrics.quotes) * 100 : 0;
  const trainingTurns = trainingMessages.filter((message) => message.role === "seller").length;
  const trainingScores = trainingStats.scoreHistory;
  const trainingAverage = trainingScores.length ? trainingScores.reduce((total, score) => total + score, 0) / trainingScores.length : 0;
  const recentTrainingScores = trainingScores.slice(-5);
  const previousTrainingScores = trainingScores.slice(-10, -5);
  const recentTrainingAverage = recentTrainingScores.length ? recentTrainingScores.reduce((total, score) => total + score, 0) / recentTrainingScores.length : 0;
  const previousTrainingAverage = previousTrainingScores.length ? previousTrainingScores.reduce((total, score) => total + score, 0) / previousTrainingScores.length : 0;
  const trainingTrend = recentTrainingScores.length > 0 && previousTrainingScores.length > 0 ? recentTrainingAverage - previousTrainingAverage : 0;
  const scenarioCoverage = trainingScenarios.length ? trainingStats.scenarios.length / trainingScenarios.length : 0;
  const trainingConsistency = Math.min(trainingStats.rounds / 12, 1);
  const learningMetric = trainingScores.length
    ? Math.round((trainingAverage / 10) * 60 + scenarioCoverage * 25 + trainingConsistency * 15)
    : 0;
  const learningStage = !trainingScores.length
    ? "Não iniciado"
    : learningMetric < 35
      ? "Fundamentos"
      : learningMetric < 60
        ? "Em desenvolvimento"
        : learningMetric < 80
          ? "Consistente"
          : "Referência";
  const averageTrainingSkills = averageSkillScores(trainingStats.skillHistory);
  const weakestTrainingSkill = trainingStats.skillHistory.length
    ? trainingSkillMeta.reduce((weakest, skill) => averageTrainingSkills[skill.id] < averageTrainingSkills[weakest.id] ? skill : weakest, trainingSkillMeta[0])
    : null;
  const masteredScenarios = Object.values(trainingStats.scenarioStats).filter((scenario) => scenario.attempts >= 2 && scenario.best >= 8).length;
  const saveStatusLabel = saveStatus === "saving"
    ? "Salvando…"
    : saveStatus === "conflict"
      ? "Outra aba alterou estes dados"
    : saveStatus === "offline"
      ? "Offline · envio pendente"
      : saveStatus === "error"
        ? "Sincronização pendente"
        : saveStatus === "saved"
          ? lastSavedAt ? `Salvo às ${lastSavedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "Dados sincronizados"
          : "Preparando dados";
  const providerTypeChoices = providerProfile === "Empresa" ? providerCompanyTypeOptions : providerTypeOptions;
  const providerGoalChoices = providerProfile === "Empresa" ? providerCompanyGoalOptions : providerGoalOptions;
  const providerQuestionChoices = providerProfile === "Empresa" ? providerCompanyQuestionOptions : providerQuestionOptions;
  const providerExampleChoices = providerProfile === "Empresa" ? providerCompanyMessageExamples : providerMessageExamples;
  const quickMessage = useMemo(() => messageAudience === "Prestador"
    ? buildProviderMessage({
      profile: providerProfile,
      contactName: providerName,
      senderName: authUser?.displayName || "",
      providerType,
      region: providerRegion,
      objective: providerObjective,
      question: providerQuestion,
      channel: messageChannel,
      tone: messageTone,
      includeCompany: messageProof.company,
      includePortfolio: messageProof.quality,
      includeSupport: messageProof.guarantee,
    })
    : buildQuickMessage({
      name: messageName,
      line: messageLine,
      environment: messageEnvironment,
      objective: messageObjective,
      question: messageQuestion,
      channel: messageChannel,
      tone: messageTone,
      includeCompany: messageProof.company,
      includeQuality: messageProof.quality,
      includeGuarantee: messageProof.guarantee,
    }), [authUser?.displayName, messageAudience, messageChannel, messageEnvironment, messageLine, messageName, messageObjective, messageProof.company, messageProof.guarantee, messageProof.quality, messageQuestion, messageTone, providerName, providerObjective, providerProfile, providerQuestion, providerRegion, providerType]);
  const messagePendingFields = useMemo(() => {
    const pending: string[] = [];
    if (messageAudience === "Prestador") {
      if (!providerType.trim()) pending.push(providerProfile === "Empresa" ? "segmento da empresa" : "atividade do prestador de serviço");
      if (!providerRegion.trim()) pending.push("cidade ou região de atendimento");
      if (!providerQuestion.trim()) pending.push("pergunta para continuar a conversa");
      pending.push(providerProfile === "Empresa" ? "responsável comercial e interesse na parceria" : "interesse na parceria e melhor canal de retorno");
      return pending;
    }
    if (!messageEnvironment.trim()) pending.push("Ambiente");
    if (!messageQuestion.trim()) pending.push("medida ou próxima pergunta");
    pending.push("modelo exato, composição e condição");
    return pending;
  }, [messageAudience, messageEnvironment, messageQuestion, providerProfile, providerQuestion, providerRegion, providerType]);
  const fairMessageInput = useMemo(() => ({
    profileId: fairProfileId,
    clientName: fairClientName,
    consultantName: fairConsultantName || authUser?.displayName || "",
    interest: fairInterest,
    channel: fairChannel,
    tone: fairTone,
    eventDate: fairEventDate,
    eventTime: fairEventTime,
    city: fairCity,
    discount: fairDiscount,
    emojiMode: fairEmojiMode,
    variation: fairVariation,
  }), [authUser?.displayName, fairChannel, fairCity, fairClientName, fairConsultantName, fairDiscount, fairEmojiMode, fairEventDate, fairEventTime, fairInterest, fairProfileId, fairTone, fairVariation]);
  const fairMessage = useMemo(() => buildFairMessage(fairMessageInput), [fairMessageInput]);
  const fairProfileMessages = useMemo(() => fairClientProfiles.map((profile) => ({
    ...profile,
    message: buildFairMessage({ ...fairMessageInput, profileId: profile.id }),
  })), [fairMessageInput]);

  function randomizeFairMessage() {
    const randomValues = new Uint32Array(1);
    window.crypto.getRandomValues(randomValues);
    window.speechSynthesis?.cancel();
    setSpeakingMessageId(null);
    setFairVariation((current) => nextFairVariation(current, randomValues[0]));
    showToast("Nova versão pronta — seus dados foram mantidos.");
  }

  function selectProviderProfile(profile: ProviderPresentationProfile) {
    setProviderProfile(profile);
    const companyProfile = profile === "Empresa";
    setProviderType(companyProfile ? providerCompanyTypeOptions[0] : providerTypeOptions[0]);
    setProviderObjective(companyProfile ? providerCompanyGoalOptions[0] : providerGoalOptions[0]);
    setProviderQuestion(companyProfile ? providerCompanyQuestionOptions[0] : providerQuestionOptions[0]);
  }

  function showToast(message: string, kind: ToastKind = "success") {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setToast({ message, kind });
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 3200);
  }

  function openProfileEditor() {
    if (!authUser) return;
    setProfileError("");
    setProfileForm({
      displayName: authUser.displayName,
      username: authUser.username,
      branch: authUser.branch,
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    });
    setProfileOpen(true);
  }

  function closeProfileEditor() {
    if (profileBusy) return;
    setProfileOpen(false);
    setProfileError("");
  }

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileError("");
    if (profileForm.newPassword !== profileForm.confirmPassword) {
      setProfileError("As novas senhas não coincidem.");
      return;
    }

    setProfileBusy(true);
    try {
      if (!(await flushPendingState())) throw new Error("Sincronize as alterações pendentes antes de atualizar o perfil.");
      const response = await apiFetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: profileForm.displayName,
          username: profileForm.username,
          branch: profileForm.branch,
          currentPassword: profileForm.currentPassword,
          newPassword: profileForm.newPassword,
        }),
      });
      const data = await readResponseJson<{ user?: EmployeeUser; error?: string }>(response);
      if (!response.ok || !data.user) throw new Error(data.error || "Não foi possível atualizar seu perfil.");
      setAuthUser(data.user);
      setProfileOpen(false);
      setProfileForm({
        displayName: "",
        username: "",
        branch: "Araraquara",
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      showToast("Perfil atualizado com sucesso");
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Não foi possível atualizar seu perfil.");
    } finally {
      setProfileBusy(false);
    }
  }

  function resetEmployeeWorkspace() {
    cancelTrainingRequest();
    cancelPendingVoiceCapture();
    if (isRecording) stopVoiceCapture();
    window.speechSynthesis?.cancel();
    if (voicePreviewUrl) discardVoiceDraft();
    setDoneSales([]);
    setDoneTiming([]);
    setFollowUps(defaultFollowUps);
    setDailyDone([]);
    setMetrics(defaultMetrics);
    setTrainingStats(emptyTrainingStats());
    setFactoryItems(defaultFactoryItems);
    setDrawerChecks({});
    setMessageName("");
    setMessageLine("Kit porta pronta");
    setMessageEnvironment("");
    setMessageObjective("apresentar uma opção de qualidade");
    setMessageQuestion("");
    setMessageChannel("WhatsApp");
    setMessageTone("Consultivo");
    setMessageProof({ company: true, quality: true, guarantee: true });
    setTrainingMessages([]);
    setTrainingFeedback(null);
    setTrainingStarted(false);
    setTrainingInputMode("voice");
    setTrainingLevelFilter("Todos");
    setTrainingInput("");
    setVoiceTranscript("");
    setVoiceInterim("");
    setVoiceSeconds(0);
    setVoiceStatus("Pronto para treinar por áudio");
    setSpeakingMessageId(null);
    setNewClient("");
    setNewNext("");
    setNewStatus("Aguardando retorno");
    setNewPriority("Média");
    setFilterStatus("Todos");
    setFactoryWizardStep(0);
    setFactoryWizardDraft(blankFactoryWizard());
    setEditingFactoryItemId(null);
    setSelectedCatalog(null);
    setCatalogSearch("");
    setCatalogFamily("Todas");
    setBrand("dalcomad");
    setActiveSalesStep(0);
    setActiveTrainingScenario(0);
    setActiveTimingStep(0);
    setSaveStatus("idle");
    setLastSavedAt(null);
    revisionRef.current = null;
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError("");
    if (authMode === "register" && authForm.password !== authForm.confirmPassword) {
      setAuthError("As senhas não coincidem.");
      return;
    }

    setAuthBusy(true);
    try {
      const endpoint = authMode === "register" ? "/api/auth/register" : "/api/auth/login";
      const body = authMode === "register"
        ? { displayName: authForm.displayName, username: authForm.username, branch: authForm.branch, password: authForm.password }
        : { username: authForm.username, password: authForm.password };
      const response = await apiFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await readResponseJson<{ user?: EmployeeUser; admin?: boolean; error?: string }>(response);
      if (!response.ok || (!data.user && data.admin !== true)) throw new Error(data.error || "Não foi possível concluir o acesso.");
      pendingStateRef.current = null;
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      setHydrated(false);
      setDataLoaded(false);
      setDataLoadError("");
      revisionRef.current = null;
      setIsAdmin(data.admin === true);
      setAuthUser(data.user ?? null);
      setAuthForm({ displayName: "", username: "", branch: "Araraquara", password: "", confirmPassword: "" });
      setSection("overview");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Não foi possível concluir o acesso.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleLogout() {
    setAuthBusy(true);
    setAuthError("");
    try {
      if (!(await flushPendingState())) {
        throw new Error("Não foi possível sincronizar suas alterações. A saída foi cancelada para preservar seus dados.");
      }
      const response = await apiFetch("/api/auth/logout", { method: "POST" });
      const data = await readResponseJson<{ ok?: boolean; error?: string }>(response);
      if (!response.ok || data.ok !== true) throw new Error(data.error || "Não foi possível encerrar a sessão.");
      pendingStateRef.current = null;
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      resetEmployeeWorkspace();
      setIsAdmin(false);
      setAuthUser(null);
      setProfileOpen(false);
      setProfileError("");
      setHydrated(false);
      setDataLoaded(false);
      setSection("overview");
      setAuthMode("login");
      setAuthError("");
      setAuthForm({ displayName: "", username: "", branch: "Araraquara", password: "", confirmPassword: "" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível sair da conta.";
      setAuthError(message);
      showToast(message, "error");
    } finally {
      setAuthBusy(false);
    }
  }

  function toggleSales(id: string) {
    setDoneSales((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function toggleTiming(id: string) {
    setDoneTiming((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function toggleDaily(id: string) {
    setDailyDone((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function copyMessage(message: string, label = "Mensagem") {
    try {
      await navigator.clipboard.writeText(message);
      showToast(`${label} copiada para a área de transferência`);
    } catch {
      showToast("Selecione e copie a mensagem manualmente", "info");
    }
  }

  function discardVoiceDraft() {
    if (voicePreviewUrl) {
      URL.revokeObjectURL(voicePreviewUrl);
      voiceUrlsRef.current = voiceUrlsRef.current.filter((url) => url !== voicePreviewUrl);
    }
    setVoicePreviewUrl("");
    setVoiceTranscript("");
    setVoiceInterim("");
    setTrainingInput("");
    setVoiceStatus("Pronto para gravar outra resposta");
  }

  async function startVoiceCapture() {
    if (!voiceSupported) {
      setTrainingInputMode("text");
      showToast("Seu navegador não liberou gravação; use o modo texto ou outro navegador", "error");
      return;
    }

    discardVoiceDraft();
    voiceFinalPartsRef.current = [];
    setVoiceSeconds(0);
    setVoiceStatus(speechSupported ? "Fale naturalmente; a transcrição aparece abaixo" : "Áudio sendo gravado; escreva a transcrição ao terminar");
    const attempt = voiceCaptureAttemptRef.current + 1;
    voiceCaptureAttemptRef.current = attempt;
    setVoiceCapturePending(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (voiceCaptureAttemptRef.current !== attempt) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      mediaStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      voiceChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) voiceChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(voiceChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (blob.size > 0) {
          const url = URL.createObjectURL(blob);
          voiceUrlsRef.current.push(url);
          setVoicePreviewUrl(url);
        }
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      };
      recorder.start();
      setVoiceCapturePending(false);
      setIsRecording(true);

      const browserWindow = window as typeof window & {
        SpeechRecognition?: SpeechRecognitionConstructor;
        webkitSpeechRecognition?: SpeechRecognitionConstructor;
      };
      const Recognition = browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition;
      if (Recognition) {
        const recognition = new Recognition();
        recognition.lang = "pt-BR";
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.onresult = (event) => {
          const finalParts = [...voiceFinalPartsRef.current];
          const interimParts: string[] = [];
          for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const result = event.results[index];
            const transcript = result[0]?.transcript?.trim();
            if (!transcript) continue;
            if (result.isFinal) finalParts.push(transcript);
            else interimParts.push(transcript);
          }
          voiceFinalPartsRef.current = finalParts;
          const finalText = finalParts.join(" ").trim();
          const interimText = interimParts.join(" ").trim();
          setVoiceTranscript(finalText);
          setVoiceInterim(interimText);
          setTrainingInput([finalText, interimText].filter(Boolean).join(" "));
          setVoiceStatus("Transcrevendo em tempo real...");
        };
        recognition.onerror = (event) => {
          if (event.error === "not-allowed" || event.error === "service-not-allowed") {
            setVoiceStatus("Permissão de voz não liberada; o áudio continua gravado e você pode digitar a transcrição.");
            showToast("Permita o microfone para transcrever sua fala", "error");
          } else if (event.error !== "aborted") {
            setVoiceStatus("A gravação continua; revise ou complete a transcrição abaixo.");
          }
        };
        recognition.onend = () => {
          speechRecognitionRef.current = null;
        };
        speechRecognitionRef.current = recognition;
        try {
          recognition.start();
        } catch {
          setVoiceStatus("Áudio gravado; revise a transcrição antes de enviar.");
        }
      }
    } catch {
      if (voiceCaptureAttemptRef.current !== attempt) return;
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      setVoiceStatus("Não foi possível acessar o microfone. Verifique a permissão do navegador.");
      showToast("Microfone não disponível neste dispositivo", "error");
    } finally {
      if (voiceCaptureAttemptRef.current === attempt) setVoiceCapturePending(false);
    }
  }

  function cancelPendingVoiceCapture() {
    voiceCaptureAttemptRef.current += 1;
    setVoiceCapturePending(false);
  }

  function stopVoiceCapture() {
    if (!isRecording) return;
    setIsRecording(false);
    speechRecognitionRef.current?.stop();
    speechRecognitionRef.current = null;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    mediaRecorderRef.current = null;
    const finalText = voiceFinalPartsRef.current.join(" ").trim();
    setVoiceInterim("");
    setVoiceTranscript(finalText);
    setTrainingInput(finalText);
    setVoiceStatus(finalText ? "Transcrição pronta — revise e envie quando estiver satisfeito." : "Áudio gravado, mas não houve transcrição. Digite sua resposta para continuar.");
  }

  function speakText(text: string, messageId: string) {
    if (!("speechSynthesis" in window)) {
      showToast("Seu navegador não oferece leitura de áudio", "info");
      return;
    }
    if (speakingMessageId === messageId) {
      window.speechSynthesis.cancel();
      setSpeakingMessageId(null);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "pt-BR";
    utterance.rate = 0.96;
    utterance.pitch = 1;
    utterance.onend = () => setSpeakingMessageId(null);
    utterance.onerror = () => setSpeakingMessageId(null);
    setSpeakingMessageId(messageId);
    window.speechSynthesis.speak(utterance);
  }

  function startTraining(index = activeTrainingScenario) {
    const scenario = trainingScenarios[index];
    cancelTrainingRequest();
    cancelPendingVoiceCapture();
    if (isRecording) stopVoiceCapture();
    if (voicePreviewUrl) discardVoiceDraft();
    setActiveTrainingScenario(index);
    setTrainingMessages([{ role: "customer", text: scenario.opening }]);
    setTrainingFeedback(null);
    setTrainingInput("");
    setTrainingInputMode("voice");
    setVoiceTranscript("");
    setVoiceInterim("");
    setVoiceStatus("Pronto para treinar por áudio");
    setTrainingStarted(true);
  }

  function selectTrainingInputMode(mode: "voice" | "text") {
    cancelPendingVoiceCapture();
    if (isRecording) stopVoiceCapture();
    setTrainingInputMode(mode);
  }

  function selectTrainingLevel(level: TrainingFilter) {
    setTrainingLevelFilter(level);
    const firstIndex = trainingScenarios.findIndex((scenario) => level === "Todos" || scenario.level === level);
    if (firstIndex < 0) return;
    setActiveTrainingScenario(firstIndex);
    if (trainingStarted) startTraining(firstIndex);
  }

  function recordTrainingRound(score: number, scenarioId: string, skillScores: TrainingSkillScores) {
    const practicedAt = new Date().toISOString();
    setTrainingStats((current) => {
      const previousScenario = current.scenarioStats[scenarioId] ?? { attempts: 0, best: 0, lastScore: 0, lastPracticedAt: null };
      return {
        rounds: current.rounds + 1,
        best: Math.max(current.best, score),
        scenarios: current.scenarios.includes(scenarioId) ? current.scenarios : [...current.scenarios, scenarioId],
        scoreHistory: [...current.scoreHistory, score].slice(-120),
        skillHistory: [...current.skillHistory, skillScores].slice(-120),
        scenarioStats: {
          ...current.scenarioStats,
          [scenarioId]: {
            attempts: previousScenario.attempts + 1,
            best: Math.max(previousScenario.best, score),
            lastScore: score,
            lastPracticedAt: practicedAt,
          },
        },
        lastPracticedAt: practicedAt,
      };
    });
  }

  function toggleCatalogCheck(itemId: string, check: string) {
    setDrawerChecks((current) => {
      const checked = current[itemId] ?? [];
      return {
        ...current,
        [itemId]: checked.includes(check) ? checked.filter((item) => item !== check) : [...checked, check],
      };
    });
  }

  function resetTraining() {
    cancelTrainingRequest();
    cancelPendingVoiceCapture();
    if (isRecording) stopVoiceCapture();
    window.speechSynthesis?.cancel();
    setSpeakingMessageId(null);
    if (voicePreviewUrl) discardVoiceDraft();
    setTrainingMessages([]);
    setTrainingFeedback(null);
    setTrainingInput("");
    setVoiceTranscript("");
    setVoiceInterim("");
    setVoiceStatus("Pronto para treinar por áudio");
    setTrainingStarted(false);
  }

  function cancelTrainingRequest() {
    const activeRequest = trainingRequestRef.current;
    if (activeRequest) activeRequest.controller.abort();
    trainingRequestRef.current = null;
    setTrainingBusy(false);
  }

  async function sendTrainingMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const sellerMessage = trainingInput.trim();
    if (!sellerMessage || trainingBusy || isRecording) return;

    const scenario = currentTrainingScenario;
    const turn = trainingTurns;
    setTrainingMessages((current) => [...current, { role: "seller", text: sellerMessage, audioUrl: voicePreviewUrl || undefined }]);
    setTrainingInput("");
    setVoiceTranscript("");
    setVoiceInterim("");
    setVoicePreviewUrl("");
    setVoiceStatus("Resposta enviada — você pode falar novamente na próxima rodada");
    const requestId = trainingRequestIdRef.current + 1;
    trainingRequestIdRef.current = requestId;
    const requestController = new AbortController();
    trainingRequestRef.current = { id: requestId, controller: requestController };
    setTrainingBusy(true);

    try {
      const response = await apiFetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenario,
          history: trainingMessages,
          sellerMessage,
          turn,
        }),
        signal: requestController.signal,
      });
      if (trainingRequestRef.current?.id !== requestId) return;
      if (!response.ok) throw new Error("AI não configurada");
      const data = await readResponseJson<Partial<TrainingFeedback>>(response);
      if (trainingRequestRef.current?.id !== requestId) return;
      if (!data.customerReply || typeof data.score !== "number") throw new Error("Resposta inválida");
      const feedback: TrainingFeedback = {
        mode: data.mode === "contextual" ? "contextual" : "guiado",
        score: Math.max(0, Math.min(10, Math.round(data.score))),
        phase: typeof data.phase === "string" ? data.phase : turn === 0 ? "Abertura e diagnóstico" : turn < 3 ? "Descoberta e condução" : "Confirmação e fechamento",
        skillScores: normalizeSkillScores(data.skillScores, Math.round(data.score)),
        summary: data.summary || "Continue conduzindo a conversa com clareza.",
        strengths: Array.isArray(data.strengths) ? data.strengths.slice(0, 3) : [],
        improvements: Array.isArray(data.improvements) ? data.improvements.slice(0, 3) : [],
        nextMove: data.nextMove || "Defina o próximo passo antes de encerrar.",
        coachQuestion: typeof data.coachQuestion === "string" ? data.coachQuestion : "O que o cliente precisa saber para avançar agora?",
        retryGuide: typeof data.retryGuide === "string" ? data.retryGuide : "Repita a resposta usando uma pergunta e uma ação concreta.",
        customerReply: data.customerReply,
        coachNote: data.coachNote || "O treinador está acompanhando o que o cliente trouxe nesta rodada.",
        customerMood: data.customerMood || "Aberto a continuar",
        customerNeed: data.customerNeed || "um próximo passo claro",
      };
      setTrainingFeedback(feedback);
      setTrainingMessages((current) => [...current, { role: "customer", text: feedback.customerReply }]);
      recordTrainingRound(feedback.score, scenario.id, feedback.skillScores);
    } catch {
      if (requestController.signal.aborted || trainingRequestRef.current?.id !== requestId) return;
      const feedback = guidedCoach(scenario, sellerMessage, turn, trainingMessages);
      setTrainingFeedback(feedback);
      setTrainingMessages((current) => [...current, { role: "customer", text: feedback.customerReply }]);
      recordTrainingRound(feedback.score, scenario.id, feedback.skillScores);
      showToast("Treino guiado ativado — a conversa continua funcionando", "info");
    } finally {
      if (trainingRequestRef.current?.id === requestId) {
        trainingRequestRef.current = null;
        setTrainingBusy(false);
      }
    }
  }

  function addFollowUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newClient.trim() || !newNext.trim()) {
      showToast("Preencha cliente e próxima ação", "error");
      return;
    }
    setFollowUps((current) => [{ id: `local-${Date.now()}`, client: newClient.trim(), status: newStatus, next: newNext.trim(), priority: newPriority, done: false }, ...current]);
    setNewClient("");
    setNewNext("");
    showToast("Pendência adicionada à sua conta");
  }

  function selectBrand(next: BrandId) {
    setBrand(next);
    setCatalogFamily("Todas");
    setCatalogSearch("");
  }

  function navigate(next: Section) {
    if (next !== "training") {
      cancelTrainingRequest();
      cancelPendingVoiceCapture();
    }
    if (isRecording) stopVoiceCapture();
    setSection(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function reloadServerState() {
    if (!authUser || !window.confirm("Recarregar a versão salva no servidor? A cópia local pendente será descartada.")) return;
    pendingStateRef.current = null;
    clearScopedLocalState(authUser.id);
    setSaveStatus("idle");
    setDataLoadError("");
    setDataLoaded(false);
    setHydrated(false);
    setDataLoadAttempt((current) => current + 1);
  }

  function updateMetric(key: keyof typeof metrics, value: string) {
    const numeric = key === "ticket" ? Number(value.replace(",", ".")) : Number.parseInt(value, 10);
    setMetrics((current) => {
      const next = { ...current, [key]: Number.isFinite(numeric) ? Math.max(0, numeric) : 0 };
      next.quotes = Math.round(next.quotes);
      next.officialQuotes = Math.min(Math.round(next.officialQuotes), next.quotes);
      next.incompleteQuotes = Math.min(Math.round(next.incompleteQuotes), Math.max(0, next.quotes - next.officialQuotes));
      next.followups = Math.min(Math.round(next.followups), next.quotes);
      next.closed = Math.min(Math.round(next.closed), next.quotes);
      return next;
    });
  }

  function updateFactoryWizard(key: FactoryWizardField, value: string) {
    setFactoryWizardDraft((current) => {
      const next = { ...current, [key]: value };
      if (key === "line") {
        const finishes = value && value !== "A confirmar" ? availableDalcomadKitValues("finish", { line: value }) : [];
        next.finish = finishes.length === 1 ? finishes[0] : "";
        const colors = availableDalcomadKitValues("color", next);
        if (next.color !== "A confirmar" && !colors.includes(next.color)) next.color = "";
      }
      if (key === "finish") {
        const colors = availableDalcomadKitValues("color", next);
        if (next.color !== "A confirmar" && !colors.includes(next.color)) next.color = "";
      }
      return next;
    });
  }

  function setFactoryWizardPending() {
    updateFactoryWizard(activeFactoryWizardStep.key, "A confirmar");
  }

  function goToNextFactoryWizardStep() {
    if (!activeFactoryWizardStep.optional && !factoryWizardDraft[activeFactoryWizardStep.key].trim()) {
      showToast(`Preencha ${activeFactoryWizardStep.label} ou marque como A confirmar`, "error");
      return;
    }
    setFactoryWizardStep((current) => Math.min(current + 1, factoryWizardSteps.length - 1));
  }

  function goToPreviousFactoryWizardStep() {
    setFactoryWizardStep((current) => Math.max(current - 1, 0));
  }

  function resetFactoryWizard() {
    setFactoryWizardDraft(blankFactoryWizard());
    setFactoryWizardStep(0);
    setEditingFactoryItemId(null);
  }

  function addFactoryWizardItem() {
    const missingStep = factoryWizardSteps.findIndex(({ key, optional }) => !optional && !factoryWizardDraft[key].trim());
    if (missingStep >= 0) {
      setFactoryWizardStep(missingStep);
      showToast(`Conclua a etapa ${factoryWizardSteps[missingStep].label} ou marque como A confirmar`, "error");
      return;
    }
    if (!isKnownDalcomadKitCombination(factoryWizardDraft)) {
      setFactoryWizardStep(factoryWizardSteps.findIndex(({ key }) => key === "line"));
      showToast("Escolha uma combinação de linha, acabamento e cor das amostras Dalcomad", "error");
      return;
    }
    for (const key of ["priceWithoutLock", "priceWithLock"] as const) {
      if (parseDalcomadKitPrice(factoryWizardDraft[key]) === null) {
        setFactoryWizardStep(factoryWizardSteps.findIndex((step) => step.key === key));
        showToast("Informe um valor válido, sem texto ou número negativo", "error");
        return;
      }
    }
    if (!editingFactoryItemId && factoryItems.length >= 240) {
      showToast("A requisição atingiu o limite de 240 kits. Exporte ou remova itens antes de continuar.", "error");
      return;
    }
    let generatedId = editingFactoryItemId;
    if (!generatedId) {
      const existingIds = new Set(factoryItems.map((item) => item.id));
      do {
        factoryIdRef.current += 1;
        generatedId = `wizard-${authUserId ?? "local"}-${factoryIdRef.current}`;
      } while (existingIds.has(generatedId));
    }

    const generatedItem: FactoryRequestItem = {
      id: generatedId,
      manufacturer: "DALCOMAD",
      description: "KIT PORTA",
      opening: "ABRIR",
      ...factoryWizardDraft,
    };
    setFactoryItems((current) => editingFactoryItemId
      ? current.map((item) => item.id === editingFactoryItemId ? generatedItem : item)
      : [...current, generatedItem]);
    resetFactoryWizard();
    showToast(editingFactoryItemId ? "Kit atualizado na requisição" : "Kit enviado para a requisição Dalcomad");
  }

  function editFactoryItem(item: FactoryRequestItem) {
    setEditingFactoryItemId(item.id);
    setFactoryWizardDraft({
      leafMeasure: item.leafMeasure,
      requadro: item.requadro,
      color: item.color,
      line: item.line,
      finish: item.finish,
      filling: item.filling,
      priceWithoutLock: item.priceWithoutLock,
      priceWithLock: item.priceWithLock,
    });
    setFactoryWizardStep(0);
    document.querySelector(".factory-locator")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function removeFactoryItem(item: FactoryRequestItem) {
    if (!window.confirm(`Remover o kit ${item.leafMeasure || item.id} da requisição?`)) return;
    setFactoryItems((current) => current.filter((candidate) => candidate.id !== item.id));
    if (editingFactoryItemId === item.id) resetFactoryWizard();
    showToast("Kit removido da requisição", "info");
  }

  function clearFactoryItems() {
    if (!window.confirm("Limpar os itens da requisição? As linhas já enviadas serão removidas da sua conta.")) return;
    setFactoryItems([]);
    resetFactoryWizard();
    showToast("Itens enviados removidos");
  }

  function exportFactoryToExcel() {
    if (filledFactoryItems.length === 0) {
      showToast("Envie pelo menos um kit antes de exportar", "error");
      return;
    }

    try {
      const invalidPriceItem = filledFactoryItems.find((item) => (
        parseDalcomadKitPrice(item.priceWithoutLock) === null
        || parseDalcomadKitPrice(item.priceWithLock) === null
      ));
      if (invalidPriceItem) {
        editFactoryItem(invalidPriceItem);
        showToast("Revise os valores deste kit antes de exportar", "error");
        return;
      }
      const rows = filledFactoryItems.map((item) => [
        "DALCOMAD",
        "KIT PORTA",
        "ABRIR",
        item.leafMeasure,
        item.requadro,
        item.color,
        item.line,
        item.finish,
        item.filling,
        parseDalcomadKitPrice(item.priceWithoutLock) ?? "",
        parseDalcomadKitPrice(item.priceWithLock) ?? "",
      ]);
      const listRows: (string | null)[][] = [["Linha", "Acabamento", "Cor da amostra"]];
      dalcomadKitCombinations.forEach((item) => listRows.push([item.line, item.finish, item.color]));
      listRows.push(["Requadros permitidos", factoryListOptions.requadros.join(", "), null]);
      listRows.push(["Preenchimentos", factoryListOptions.fillings.join(", "), null]);
      listRows.push(["Escopo fixo", "DALCOMAD · KIT PORTA · ABRIR", null]);
      listRows.push(["Orientação", "Use somente uma combinação de linha, acabamento e cor registrada acima. Valores são manuais, sem cálculo automático.", null]);
      const fileDate = new Intl.DateTimeFormat("sv-SE").format(new Date());
      downloadWorkbook({
        filename: `Requisicao_Kit_Porta_Dalcomad_${fileDate}.xlsx`,
        title: "Requisição de Kit Porta Dalcomad — Mult Portas",
        subject: "Montagem e requisição técnica de kits de porta",
        author: "Mult Portas",
        sheets: [
          {
            name: "Requisições",
            rows: [factoryHeaders, ...rows],
            columnWidths: [16, 22, 19, 18, 13, 14, 15, 19, 17, 18, 21],
            currencyColumns: [9, 10],
            autoFilter: true,
          },
          {
            name: "Listas",
            rows: listRows,
            columnWidths: [24, 64, 28],
            wrappedColumns: [1, 2],
            autoFilter: true,
          },
        ],
      });
      showToast(`${rows.length} ${rows.length === 1 ? "item exportado" : "itens exportados"} para Excel`);
    } catch (error) {
      console.error("Falha ao exportar requisição Dalcomad", error);
      showToast("Não foi possível gerar o arquivo Excel; tente novamente", "error");
    }
  }

  if (authLoading || (authUser && !dataLoaded)) {
    return (
      <main className="auth-shell">
        <section className="auth-card auth-loading" aria-live="polite" aria-busy={!dataLoadError}>
          <div className="brand-mark auth-mark">MP</div>
          <strong>{dataLoadError || (authUser ? "Abrindo seu espaço…" : "Carregando acesso…")}</strong>
          <span>{dataLoadError ? "Nenhum dado será sobrescrito enquanto a leitura não for concluída." : "Preparando o Guia Comercial Mult Portas"}</span>
          {dataLoadError && <button className="button primary" type="button" onClick={() => setDataLoadAttempt((current) => current + 1)}>Tentar novamente</button>}
        </section>
      </main>
    );
  }

  if (!authUser && !isAdmin) {
    return <AuthScreen mode={authMode} setMode={(mode) => { setAuthMode(mode); setAuthError(""); }} form={authForm} setForm={setAuthForm} error={authError} busy={authBusy} onSubmit={handleAuthSubmit} />;
  }

  if (isAdmin) return <AccountCenter onLogout={handleLogout} externalError={authError} />;
  if (!authUser) return null;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">MP</div>
          <div>
            <div className="brand-name">MULT PORTAS</div>
            <div className="brand-sub">Guia comercial interno</div>
          </div>
        </div>

        <div className="sidebar-label">Navegação</div>
        <nav className="sidebar-nav" aria-label="Navegação principal">
          {sections.map((item) => (
            <button key={item.id} className={`nav-item ${section === item.id ? "active" : ""}`} onClick={() => navigate(item.id)} aria-current={section === item.id ? "page" : undefined}>
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-text"><strong>{item.label}</strong><small>{item.description}</small></span>
              {item.id === "control" && <span className="nav-count">{openActionCount}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="source-mini">
            <span className="live-dot" />
            <div><strong>Base estudada</strong><small>{studiedCatalogCount} catálogos · {studiedBrandCount} marcas</small></div>
          </div>
          <div className="sidebar-foot">Dados separados por funcionário · {today}</div>
        </div>
      </aside>

      <section className="content-shell">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark small">MP</span><strong>GUIA MULT PORTAS</strong></div>
          <div className="breadcrumbs"><span>Mult Portas</span><b>/</b><strong>{sections.find((item) => item.id === section)?.label}</strong></div>
          <div className="topbar-actions">
            <span className={`save-status ${saveStatus}`} role="status" aria-live="polite"><i />{saveStatusLabel}</span>
            {saveStatus === "conflict" && <button className="sync-reload-button" type="button" onClick={reloadServerState}>Recarregar dados salvos</button>}
            <span className="date-chip">{today}</span>
            <div className="user-area">
              <span className="user-chip">{authUser.displayName.slice(0, 1).toUpperCase()}</span>
              <div className="user-details"><strong>{authUser.displayName}</strong><small>{authUser.branch} · {authUser.username}</small></div>
              <button className="profile-button" type="button" ref={profileTriggerRef} onClick={openProfileEditor}>Meu perfil</button>
              <button className="logout-button" type="button" onClick={handleLogout}>Sair da conta</button>
            </div>
          </div>
        </header>

        {profileOpen && (
          <div className="profile-backdrop" role="presentation" onMouseDown={closeProfileEditor}>
            <section className="profile-dialog" ref={profileDialogRef} role="dialog" aria-modal="true" aria-labelledby="profile-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
              <div className="profile-dialog-head">
                <div><span className="section-kicker">CONTA DO FUNCIONÁRIO</span><h2 id="profile-dialog-title">Editar meu perfil</h2><p>Atualize seu nome, filial ou senha sem perder os dados salvos.</p></div>
                <button type="button" className="profile-close" onClick={closeProfileEditor} aria-label="Fechar edição do perfil">×</button>
              </div>
              <form className="profile-form" onSubmit={handleProfileSubmit}>
                <label><span>Nome completo</span><input value={profileForm.displayName} onChange={(event) => setProfileForm((current) => ({ ...current, displayName: event.target.value }))} autoComplete="name" minLength={2} maxLength={80} required /></label>
                <label><span>Usuário de acesso</span><input value={profileForm.username} onChange={(event) => setProfileForm((current) => ({ ...current, username: event.target.value }))} autoComplete="username" minLength={3} maxLength={40} pattern="[a-zA-Z0-9._-]+" required /></label>
                <label><span>Filial</span><select value={profileForm.branch} onChange={(event) => setProfileForm((current) => ({ ...current, branch: event.target.value as EmployeeUser["branch"] }))}><option value="Araraquara">Araraquara</option><option value="São Carlos">São Carlos</option></select></label>
                <div className="profile-password-copy"><strong>Segurança do acesso</strong><small>A senha atual é obrigatória ao trocar o usuário ou criar uma nova senha. Deixe a nova senha vazia para mantê-la.</small></div>
                <label><span>Senha atual</span><input type="password" value={profileForm.currentPassword} onChange={(event) => setProfileForm((current) => ({ ...current, currentPassword: event.target.value }))} autoComplete="current-password" /></label>
                <label><span>Nova senha</span><input type="password" value={profileForm.newPassword} onChange={(event) => setProfileForm((current) => ({ ...current, newPassword: event.target.value }))} autoComplete="new-password" minLength={profileForm.newPassword ? 8 : undefined} /></label>
                <label><span>Confirmar nova senha</span><input type="password" value={profileForm.confirmPassword} onChange={(event) => setProfileForm((current) => ({ ...current, confirmPassword: event.target.value }))} autoComplete="new-password" minLength={profileForm.confirmPassword ? 8 : undefined} /></label>
                {profileError && <div className="auth-error profile-error" role="alert">{profileError}</div>}
                <div className="profile-actions"><button className="button account-cancel" type="button" onClick={closeProfileEditor} disabled={profileBusy}>Cancelar</button><button className="button dark" type="submit" disabled={profileBusy}>{profileBusy ? "Salvando…" : "Salvar perfil"}</button></div>
              </form>
            </section>
          </div>
        )}

        <div className="mobile-nav" aria-label="Navegação rápida">
          {sections.map((item) => <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => navigate(item.id)} aria-current={section === item.id ? "page" : undefined}>{item.icon} {item.label}</button>)}
        </div>

        {section === "overview" && (
          <div className="page-content">
            <section className="hero-panel">
              <div className="hero-copy">
                <div className="eyebrow"><span className="eyebrow-line" /> PAINEL DE COMANDO · MULT PORTAS {authUser.branch.toUpperCase()}</div>
                <h1>Venda com clareza.<br /><em>Acompanhe sem esquecer.</em></h1>
                <p>Um guia prático para escolher melhor, retornar no momento certo e transformar cada orçamento em próximo passo.</p>
                <div className="hero-actions">
                  <button className="button primary" onClick={() => navigate("script")}>Começar atendimento <span>↗</span></button>
                  <button className="button ghost" onClick={() => navigate("catalog")}>Pesquisar catálogo <span>⌕</span></button>
                  <button className="button coach-button" onClick={() => navigate("training")}>Treinar conversa <span>✦</span></button>
                  <button className="button message-button" onClick={() => navigate("messages")}>Criar mensagem <span>✎</span></button>
                  <button className="button fair-button" onClick={() => navigate("fair")}>Convite Feirão <span>✉</span></button>
                  <button className="button factory-button" onClick={() => navigate("factory")}>Requisição fábrica <span>▤</span></button>
                </div>
                <div className="hero-proof"><span>✓</span> 41 anos de experiência · atendimento em 85 cidades da região · qualidade e garantia conforme a linha.</div>
              </div>
              <div className="hero-visual" aria-hidden="true">
                <div className="visual-orbit orbit-one" />
                <div className="visual-orbit orbit-two" />
                <div className="visual-core"><span>MP</span><small>vendas</small></div>
                <div className="visual-tag tag-top">MARCAS <b>08</b></div>
                <div className="visual-tag tag-bottom">ORÇAMENTOS <b>{portfolioCount}</b></div>
                <div className="visual-line line-one" /><div className="visual-line line-two" />
              </div>
            </section>

            <section className="stats-grid" aria-label="Resumo da operação">
              <article className="stat-card"><div className="stat-top"><span>Carteira registrada</span><span className="stat-icon gray">⌁</span></div><strong>{portfolioCount}</strong><small>orçamentos informados na sua conta</small></article>
              <article className="stat-card"><div className="stat-top"><span>Com número oficial</span><span className="stat-icon amber">#</span></div><strong>{officialQuoteCount}</strong><small>identificadores preservados</small></article>
              <article className="stat-card"><div className="stat-top"><span>Incompletos / sem número</span><span className="stat-icon soft">!</span></div><strong>{incompleteQuoteCount}</strong><small>não cobrar sem completar o contexto</small></article>
              <article className="stat-card dark-stat"><div className="stat-top"><span>Próximo foco</span><span className="stat-icon light">→</span></div><strong>{openActionCount} {openActionCount === 1 ? "ação" : "ações"}</strong><small>{openActionCount ? "medida, decisão ou retorno marcado" : "nenhuma ação pendente"}</small></article>
            </section>

            <section className="trust-strip" aria-label="Provas institucionais da Mult Portas">
              <div className="trust-intro"><span className="section-kicker">COMO APRESENTAR A EMPRESA</span><h2>Confiança que cabe em uma frase.</h2><p>Use estes pontos para abrir a conversa com segurança, sem transformar o atendimento em discurso pronto.</p></div>
              <div className="trust-facts"><div><strong>41</strong><span>anos de experiência</span></div><div><strong>85</strong><span>cidades atendidas</span></div><div><strong>✓</strong><span>qualidade e garantia por linha</span></div></div>
              <button className="button dark" onClick={() => navigate("messages")}>Usar na mensagem <span>✎</span></button>
            </section>

            <section className="overview-grid">
              <article className="panel next-panel">
                <div className="panel-heading"><div><span className="section-kicker">AGORA</span><h2>O que fazer em seguida</h2></div><button className="text-button" onClick={() => navigate("control")}>Abrir controle <span>→</span></button></div>
                <div className="next-list">
                  <div className="next-row"><span className="number-dot">01</span><div><strong>Qualifique antes de indicar</strong><p>Ambiente, objetivo, medida, quantidade e prazo.</p></div><button onClick={() => navigate("script")}>Ver roteiro</button></div>
                  <div className="next-row"><span className="number-dot">02</span><div><strong>Faça o retorno com motivo</strong><p>Não é “só passando”; é resolver uma dúvida.</p></div><button onClick={() => navigate("timing")}>Ver timing</button></div>
                  <div className="next-row"><span className="number-dot">03</span><div><strong>Complete o cadastro</strong><p>Valores e status exatos; desconhecido fica “A confirmar”.</p></div><button onClick={() => navigate("control")}>Registrar</button></div>
                  <div className="next-row"><span className="number-dot">04</span><div><strong>Prepare a requisição técnica</strong><p>Uma linha por item, sem misturar consulta de fábrica com venda.</p></div><button onClick={() => navigate("factory")}>Montar</button></div>
                </div>
              </article>
              <article className="panel progress-panel">
                <div className="panel-heading"><div><span className="section-kicker">EVOLUÇÃO</span><h2>Seu nível de atendimento</h2></div><span className="progress-value">{completedSales}/5</span></div>
                <div className="progress-track"><span style={{ width: `${(completedSales / salesSteps.length) * 100}%` }} /></div>
                <p className="progress-copy">Marque cada etapa conforme você aplica. O objetivo é sair do “tirar preço” para conduzir a decisão.</p>
                <div className="level-row"><span className="level active">Básico</span><span className={completedSales >= 2 ? "level active" : "level"}>Seguro</span><span className={completedSales >= 4 ? "level active" : "level"}>Consultivo</span><span className={completedSales === 5 ? "level active" : "level"}>Gestor</span></div>
                <button className="button dark full" onClick={() => navigate("script")}>Continuar trilha <span>→</span></button>
              </article>
            </section>

            <section className="catalog-strip">
              <div><span className="section-kicker">BASE DE PRODUTO</span><h2>Oito marcas. Uma lógica de indicação.</h2><p>Comece pelo problema do cliente; use a marca como solução, não como lista infinita.</p></div>
              <div className="brand-pills">{(Object.keys(brandData) as BrandId[]).map((id) => <button key={id} style={{ "--brand-accent": brandData[id].accent } as React.CSSProperties} onClick={() => { selectBrand(id); navigate("catalog"); }}><span className="pill-dot" />{brandData[id].short}<small>{brandData[id].descriptor}</small></button>)}</div>
            </section>
          </div>
        )}

        {section === "script" && (
          <div className="page-content">
            <div className="section-intro"><div><span className="eyebrow"><span className="eyebrow-line" /> TRILHA DE ATENDIMENTO</span><h1>Do primeiro “quanto custa?”<br /><em>até a decisão.</em></h1><p>Use as perguntas na ordem. Quanto melhor o diagnóstico, menos o atendimento vira disputa de preço.</p></div><div className="intro-badge"><strong>{completedSales}/05</strong><span>etapas marcadas</span></div></div>
            <section className="opening-section panel">
              <div className="opening-heading"><div><span className="section-kicker">RECOMENDAÇÕES DE INICIAÇÃO</span><h2>Comece a conversa com intenção.</h2><p>Escolha a situação mais parecida com o atendimento e use a frase como ponto de partida. Depois, adapte ao que o cliente responder.</p></div><button className="text-button" onClick={() => navigate("messages")}>Abrir planejador <span>→</span></button></div>
              <div className="opening-grid">{openingRecommendations.map((item) => <article className="opening-card" key={item.id}><span className="opening-tag">{item.tag}</span><h3>{item.title}</h3><p>{item.advice}</p><div className="opening-message">“{item.message}”</div><button className="copy-button" onClick={() => copyMessage(item.message)}>Copiar início <span>⧉</span></button></article>)}</div>
            </section>
            <div className="script-layout">
              <div className="step-list">
                <div className="step-line" />
                {salesSteps.map((step, index) => <button key={step.id} className={`step-item ${activeSalesStep === index ? "active" : ""} ${doneSales.includes(step.id) ? "done" : ""}`} onClick={() => setActiveSalesStep(index)}><span className="step-bullet">{doneSales.includes(step.id) ? "✓" : step.level}</span><span><strong>{step.title}</strong><small>{step.subtitle}</small></span><span className="step-arrow">→</span></button>)}
              </div>
              <article className="script-detail panel">
                <div className="detail-top"><div><span className="section-kicker">ETAPA {activeSales.level}</span><h2>{activeSales.title}</h2><p>{activeSales.subtitle}</p></div><span className="detail-index">0{activeSalesStep + 1}</span></div>
                <div className="question-box"><span className="mini-label">PERGUNTAS QUE ABREM O CENÁRIO</span>{activeSales.questions.map((question) => <div className="question" key={question}><span>+</span>{question}</div>)}</div>
                <div className="phrase-box"><span className="mini-label">FRASE DE APOIO</span><p>“{activeSales.line}”</p><button className="copy-button" onClick={() => copyMessage(activeSales.line)}>Copiar frase <span>⧉</span></button></div>
                <div className="checkpoint"><span className={`check-circle ${doneSales.includes(activeSales.id) ? "checked" : ""}`} onClick={() => toggleSales(activeSales.id)}>{doneSales.includes(activeSales.id) ? "✓" : ""}</span><div><strong>Critério para avançar</strong><p>{activeSales.checkpoint}</p></div><button onClick={() => toggleSales(activeSales.id)}>{doneSales.includes(activeSales.id) ? "Concluída" : "Marcar como feita"}</button></div>
                <div className="detail-nav"><button disabled={activeSalesStep === 0} onClick={() => setActiveSalesStep((current) => Math.max(0, current - 1))}>← Anterior</button><button className="button dark" onClick={() => setActiveSalesStep((current) => Math.min(salesSteps.length - 1, current + 1))}>Próxima etapa <span>→</span></button></div>
              </article>
            </div>
            <div className="principles-grid"><article><span>01</span><strong>Não invente lacunas</strong><p>Sem medida, valor ou modelo confirmado, registre “A confirmar”.</p></article><article><span>02</span><strong>Uma prioridade por vez</strong><p>Cliente tem um status principal; o histórico continua separado.</p></article><article><span>03</span><strong>Venda a solução</strong><p>Kit, batente, guarnição, rodapé e complementos entram quando fizerem sentido.</p></article></div>
          </div>
        )}

        {section === "seller" && (
          <div className="page-content">
            <div className="section-intro seller-intro"><div><span className="eyebrow"><span className="eyebrow-line" /> DESENVOLVIMENTO DO FUNCIONÁRIO</span><h1>Ser um bom vendedor<br /><em>é conduzir bem.</em></h1><p>Venda não é falar mais. É entender o cliente, organizar a solução e deixar claro qual é o próximo passo.</p></div><div className="seller-score"><strong>06</strong><span>hábitos para praticar</span><small>um atendimento por vez</small></div></div>

            <section className="seller-hero panel"><div><span className="section-kicker">A REGRA PRINCIPAL</span><h2>Antes de oferecer, entenda.</h2><p>O cliente não procura apenas uma porta ou uma janela. Ele procura segurança para escolher certo, evitar retrabalho e fazer a obra avançar.</p></div><div className="seller-hero-quote">“Quem pergunta melhor, indica melhor.”</div></section>

            <section className="seller-pillars"><article><span>01</span><h3>Ouça de verdade</h3><p>Não interrompa. Anote ambiente, medida, objetivo, quantidade e prazo.</p><strong>Pratique:</strong><small>repita o que entendeu antes de apresentar.</small></article><article><span>02</span><h3>Faça perguntas</h3><p>Perguntas evitam indicação errada e mostram que você está cuidando da compra.</p><strong>Pratique:</strong><small>faça pelo menos três perguntas antes do preço.</small></article><article><span>03</span><h3>Explique com clareza</h3><p>Troque termos difíceis por benefícios que o cliente consegue visualizar.</p><strong>Pratique:</strong><small>fale uma ideia por vez e confirme se ficou claro.</small></article><article><span>04</span><h3>Seja preciso</h3><p>Não invente medida, valor, estoque, garantia ou prazo. Use “A confirmar” quando necessário.</p><strong>Pratique:</strong><small>confirme a informação antes de prometer.</small></article><article><span>05</span><h3>Defenda valor</h3><p>Preço faz sentido quando o cliente entende o que está incluso e por que a opção atende.</p><strong>Pratique:</strong><small>compare solução, acabamento, qualidade e pós-venda.</small></article><article><span>06</span><h3>Conduza o próximo passo</h3><p>Todo atendimento precisa terminar com uma ação: medida, escolha, retorno ou fechamento.</p><strong>Pratique:</strong><small>combine quem fará o quê e quando.</small></article></section>

            <div className="seller-practice-grid"><section className="panel seller-routine"><div className="panel-heading"><div><span className="section-kicker">ROTINA DE 10 MINUTOS</span><h2>Treino diário do vendedor</h2></div><span className="seller-routine-badge">TODOS OS DIAS</span></div><div className="seller-routine-list"><div><b>02 min</b><span>Leia um produto e explique em voz alta para qual ambiente ele serve.</span></div><div><b>03 min</b><span>Treine uma abertura: cumprimente, pergunte e confirme a necessidade.</span></div><div><b>03 min</b><span>Responda a uma objeção sem discutir: acolha, explique e devolva uma pergunta.</span></div><div><b>02 min</b><span>Revise um atendimento e registre o que faltou para o próximo passo.</span></div></div><button className="button dark" onClick={() => navigate("training")}>Praticar no treino de conversa <span>✦</span></button></section><section className="panel seller-language"><span className="section-kicker">FRASES QUE AJUDAM</span><h2>Fale como consultor.</h2><div className="seller-phrase"><span>ABERTURA</span><p>“Para eu te indicar a opção certa, posso entender primeiro o ambiente e as medidas?”</p><button className="copy-button" onClick={() => copyMessage("Para eu te indicar a opção certa, posso entender primeiro o ambiente e as medidas?")}>Copiar frase <span>⧉</span></button></div><div className="seller-phrase"><span>OBJEÇÃO DE PREÇO</span><p>“Entendo. Vamos comparar o que está incluso para você ver qual opção realmente atende melhor.”</p><button className="copy-button" onClick={() => copyMessage("Entendo. Vamos comparar o que está incluso para você ver qual opção realmente atende melhor.")}>Copiar frase <span>⧉</span></button></div><div className="seller-phrase"><span>FECHAMENTO</span><p>“Se essa opção atende ao que você precisa, o próximo passo é confirmarmos a medida e a cor, certo?”</p><button className="copy-button" onClick={() => copyMessage("Se essa opção atende ao que você precisa, o próximo passo é confirmarmos a medida e a cor, certo?")}>Copiar frase <span>⧉</span></button></div></section></div>

            <section className="seller-avoid panel"><div className="seller-avoid-head"><span className="section-kicker">CHECKLIST ANTES DE ENVIAR O ORÇAMENTO</span><h2>Um bom atendimento deixa o cliente seguro.</h2></div><div className="seller-checks"><span>✓ Eu entendi o ambiente e o objetivo.</span><span>✓ Confirmei medidas, abertura e quantidade.</span><span>✓ Expliquei o que está incluso.</span><span>✓ Mantive valores e prazos exatamente como confirmados.</span><span>✓ Combinei o próximo passo e o momento do retorno.</span></div><button className="button primary" onClick={() => navigate("script")}>Abrir roteiro completo <span>→</span></button></section>
          </div>
        )}

        {section === "training" && (
          <div className="page-content">
            <div className="section-intro training-intro">
              <div>
                <span className="eyebrow"><span className="eyebrow-line" /> LABORATÓRIO DE CONVERSA</span>
                <h1>Venda melhor<br /><em>na prática.</em></h1>
                <p>Treine respostas para situações reais da Mult Portas. O cliente simulado reage, o treinador avalia e você aprende a conduzir sem inventar informação.</p>
              </div>
              <div className="training-score-card"><span>ÍNDICE DE APRENDIZADO</span><strong>{learningMetric}<small>/100</small></strong><small>{learningStage}{trainingScores.length ? ` · média ${trainingAverage.toFixed(1)}/10` : " · comece a primeira rodada"}</small><small>{trainingStats.rounds} rodada{trainingStats.rounds === 1 ? "" : "s"} · melhor {trainingStats.best ? `${trainingStats.best}/10` : "—"}</small></div>
            </div>

            <section className="training-hero panel">
              <div className="training-hero-main"><div className="coach-pulse"><span>◉</span></div><div><span className="section-kicker">ASSISTENTE DE TREINO COMERCIAL</span><h2>O cliente reage ao que você fala — agora com voz.</h2><p>Fale como no WhatsApp, revise a transcrição, ouça o cliente simulado e receba uma leitura específica do que ele entendeu, do que falta e do próximo passo.</p></div></div>
              <div className="training-feature-list"><span><b>01</b> Fale como no atendimento real</span><span><b>02</b> O cliente responde ao seu conteúdo</span><span><b>03</b> Receba nota e próximo movimento</span></div>
            </section>

            <section className="learning-metric panel" aria-labelledby="learning-metric-title">
              <div className="learning-metric-copy">
                <span className="section-kicker">EVOLUÇÃO DO FUNCIONÁRIO</span>
                <h2 id="learning-metric-title">Seu aprendizado está sendo acompanhado.</h2>
                <p>O índice combina desempenho nas respostas, variedade de cenários praticados e constância. Ele é individual e fica salvo junto da sua conta.</p>
                <div className="learning-progress" role="progressbar" aria-label="Índice de aprendizado" aria-valuemin={0} aria-valuemax={100} aria-valuenow={learningMetric}>
                  <span style={{ width: `${learningMetric}%` }} />
                </div>
                <small>{trainingScores.length ? (trainingTrend > 0.2 ? `Tendência de alta: +${trainingTrend.toFixed(1)} ponto${trainingTrend >= 1 ? "s" : ""} nas últimas respostas.` : trainingTrend < -0.2 ? `Atenção: a média recente caiu ${Math.abs(trainingTrend).toFixed(1)} ponto${Math.abs(trainingTrend) >= 1 ? "s" : ""}. Revise os ajustes do treinador.` : "Tendência estável nas últimas respostas.") : "Faça uma rodada para começar a acompanhar sua evolução."}</small>
                <div className="learning-focus"><span>FOCO RECOMENDADO</span><strong>{weakestTrainingSkill ? weakestTrainingSkill.label : "Comece pelo acolhimento e diagnóstico"}</strong><small>{weakestTrainingSkill ? `${weakestTrainingSkill.hint} · média ${averageTrainingSkills[weakestTrainingSkill.id]}/10` : "A recomendação muda conforme suas respostas forem avaliadas."}</small></div>
              </div>
              <div className="learning-metric-grid">
                <div><strong>{trainingScores.length ? trainingAverage.toFixed(1) : "—"}</strong><span>média das notas</span></div>
                <div><strong>{trainingStats.scenarios.length}/{trainingScenarios.length}</strong><span>cenários praticados</span></div>
                <div><strong>{trainingStats.best ? `${trainingStats.best}/10` : "—"}</strong><span>melhor nota</span></div>
                <div><strong>{masteredScenarios}</strong><span>cenários dominados</span></div>
              </div>
            </section>

            <div className="training-layout">
              <aside className="training-scenarios panel">
                <div className="panel-heading"><div><span className="section-kicker">CENÁRIOS</span><h2>Escolha sua situação</h2></div><span className="training-count">{visibleTrainingScenarios.length}/{trainingScenarios.length}</span></div>
                <div className="training-filters" role="tablist" aria-label="Filtrar cenários por nível">{(["Todos", "Básico", "Intermediário", "Avançado"] as TrainingFilter[]).map((level) => <button key={level} className={trainingLevelFilter === level ? "active" : ""} onClick={() => selectTrainingLevel(level)} role="tab" aria-selected={trainingLevelFilter === level} disabled={trainingBusy}>{level}</button>)}</div>
                <div className="scenario-list">{visibleTrainingScenarios.map((scenario) => { const index = trainingScenarios.findIndex((item) => item.id === scenario.id); return <button key={scenario.id} className={`scenario-card ${activeTrainingScenario === index ? "active" : ""}`} onClick={() => { setActiveTrainingScenario(index); if (trainingStarted) startTraining(index); }} aria-pressed={activeTrainingScenario === index} disabled={trainingBusy}><span className={`scenario-level ${priorityClass(scenario.level === "Básico" ? "Baixa" : scenario.level === "Intermediário" ? "Média" : "Alta")}`}>{scenario.level}</span><span className="scenario-copy"><strong>{scenario.title}</strong><small>{scenario.tag} · {scenario.objective}</small></span><span className="scenario-arrow">→</span></button>; })}</div>
                <div className="scenario-note"><span>✦</span><p>Comece pelo básico e avance quando conseguir conduzir a conversa sem correr para o preço.</p></div>
              </aside>

              <section className="training-workspace panel">
                {!trainingStarted ? (
                  <div className="training-empty-state"><span className="empty-icon">◉</span><span className="section-kicker">SIMULAÇÃO PRONTA</span><h2>{currentTrainingScenario.title}</h2><p>{currentTrainingScenario.context}</p><div className="training-objective"><span>OBJETIVO DO TREINO</span><strong>{currentTrainingScenario.objective}</strong></div><div className="training-signal-row">{currentTrainingScenario.signals.slice(0, 3).map((signal) => <span key={signal}>✓ {signal}</span>)}</div><div className="voice-promise"><span>◉</span><div><strong>Treino por fala incluído</strong><small>{voiceSupported ? "Grave, revise a transcrição e ouça o cliente simulado." : "Você poderá usar texto se o navegador não liberar o microfone."}</small></div></div><button className="button primary" onClick={() => startTraining()}>Começar simulação <span>↗</span></button></div>
                ) : (
                  <>
                    <div className="training-session-head"><div><span className="section-kicker">{currentTrainingScenario.tag} · {currentTrainingScenario.level.toUpperCase()}</span><h2>{currentTrainingScenario.title}</h2></div><div className="training-session-actions"><span className={`voice-ready ${voiceSupported ? "ready" : "limited"}`}><span />{voiceSupported ? "voz disponível" : "modo texto"}</span><button className="text-button" onClick={resetTraining}>Encerrar treino <span>×</span></button></div></div>
                    <div className="training-chat" aria-live="polite">
                      <div className="training-chat-scroll">
                        {trainingMessages.map((message, index) => <div className={`training-bubble ${message.role}`} key={`${message.role}-${index}`}><div className="bubble-label"><span>{message.role === "customer" ? "CLIENTE SIMULADO" : "SUA RESPOSTA"}</span>{message.role === "customer" && <button className="speak-button" type="button" onClick={() => speakText(message.text, `customer-${index}`)}>{speakingMessageId === `customer-${index}` ? "Parar áudio" : "Ouvir cliente"} <span>{speakingMessageId === `customer-${index}` ? "■" : "▶"}</span></button>}</div><p>{message.text}</p>{message.audioUrl && <audio className="voice-audio" controls preload="metadata" src={message.audioUrl} aria-label="Ouvir sua resposta gravada" />}</div>)}
                        {trainingBusy && <div className="training-thinking"><span className="thinking-dot" /><span className="thinking-dot" /><span className="thinking-dot" /> treinador analisando</div>}
                        <div ref={trainingChatEndRef} aria-hidden="true" />
                      </div>
                      <div className="training-composer-shell">
                        <div className="training-mode-switch" aria-label="Modo de resposta"><button type="button" className={trainingInputMode === "voice" ? "active" : ""} onClick={() => selectTrainingInputMode("voice")} aria-pressed={trainingInputMode === "voice"} disabled={trainingBusy || voiceCapturePending}>◉ Falar</button><button type="button" className={trainingInputMode === "text" ? "active" : ""} onClick={() => selectTrainingInputMode("text")} aria-pressed={trainingInputMode === "text"} disabled={trainingBusy || voiceCapturePending}>Aa Digitar</button></div>
                        {trainingInputMode === "voice" && <div className="voice-control-panel"><button type="button" className={`voice-record-button ${isRecording ? "recording" : ""}`} onClick={isRecording ? stopVoiceCapture : startVoiceCapture} disabled={trainingBusy || voiceCapturePending} aria-pressed={isRecording}><span className="voice-mic">{isRecording ? "■" : "●"}</span><span>{voiceCapturePending ? "Aguardando microfone…" : isRecording ? `Parar gravação · ${formatVoiceDuration(voiceSeconds)}` : "Gravar resposta"}</span></button><div className="voice-control-copy"><strong>{voiceStatus}</strong><small>{speechSupported ? "A fala é transcrita no navegador e pode ser editada antes do envio." : "Seu navegador não transcreve automaticamente; você ainda pode gravar e digitar a resposta."}</small></div>{voicePreviewUrl && !isRecording && <audio className="voice-preview" controls preload="metadata" src={voicePreviewUrl} aria-label="Prévia da sua resposta gravada" />} {(voicePreviewUrl || voiceTranscript) && !isRecording && <button type="button" className="voice-discard" onClick={discardVoiceDraft}>Refazer <span>↻</span></button>}</div>}
                        <form className="training-composer" onSubmit={sendTrainingMessage}><textarea value={trainingInput} onChange={(event) => setTrainingInput(event.target.value)} placeholder={trainingInputMode === "voice" ? "Sua transcrição aparece aqui. Revise antes de enviar..." : "Digite como você responderia ao cliente..."} aria-label="Sua resposta para o cliente" disabled={trainingBusy || isRecording || voiceCapturePending} rows={trainingInputMode === "voice" ? 2 : 1} />{voiceInterim && <span className="voice-interim">ouvindo: {voiceInterim}</span>}<button className="button dark" type="submit" disabled={trainingBusy || isRecording || voiceCapturePending || !trainingInput.trim()}>{trainingBusy ? "Analisando" : "Enviar resposta"} <span>↗</span></button></form>
                      </div>
                    </div>
                    <div className="training-session-foot"><span>Regra do treino: não invente medida, valor, estoque ou prazo.</span><span>{trainingTurns} resposta{trainingTurns === 1 ? "" : "s"} enviada{trainingTurns === 1 ? "" : "s"} · melhor neste cenário {trainingStats.scenarioStats[currentTrainingScenario.id]?.best ? `${trainingStats.scenarioStats[currentTrainingScenario.id].best}/10` : "—"}</span></div>
                  </>
                )}
              </section>
            </div>

            {trainingFeedback && <section className="training-feedback panel" aria-live="polite"><div className="feedback-score"><strong>{trainingFeedback.score}</strong><span>/10</span><small>{trainingFeedback.mode === "contextual" ? "feedback contextual" : "feedback guiado"}</small></div><div className="feedback-main"><span className="section-kicker">LEITURA DA RESPOSTA</span><h2>{trainingFeedback.summary}</h2><div className="feedback-insights"><div><span className="mini-label">TOM DO CLIENTE</span><strong>{trainingFeedback.customerMood}</strong></div><div><span className="mini-label">O QUE FALTA AGORA</span><strong>{trainingFeedback.customerNeed}</strong></div><div><span className="mini-label">LEITURA DO TREINADOR</span><strong>{trainingFeedback.coachNote}</strong></div></div><div className="feedback-columns"><div><span className="mini-label">VOCÊ ACERTOU</span>{trainingFeedback.strengths.map((item) => <p key={item}>✓ {item}</p>)}</div><div><span className="mini-label">PRÓXIMO AJUSTE</span>{trainingFeedback.improvements.map((item) => <p key={item}>→ {item}</p>)}</div></div><div className="feedback-next"><span>PRÓXIMA JOGADA</span><strong>{trainingFeedback.nextMove}</strong></div><div className="feedback-actions"><button className="button dark" onClick={() => startTraining()}>Repetir cenário <span>↻</span></button><button className="text-button" onClick={resetTraining}>Escolher outro cenário <span>→</span></button></div></div></section>}

            {trainingFeedback && <section className="training-coach-detail panel" aria-label="Mapa de competências da resposta"><div className="training-coach-detail-head"><div><span className="section-kicker">DEBRIEF PROFISSIONAL</span><h2>{trainingFeedback.phase}</h2></div><span className="training-coach-mode">{trainingFeedback.mode === "contextual" ? "análise contextual" : "análise guiada"}</span></div><small className="training-coach-average">Média acumulada das habilidades: {Math.round((averageTrainingSkills.acolhimento + averageTrainingSkills.diagnostico + averageTrainingSkills.precisao + averageTrainingSkills.valor + averageTrainingSkills.proximoPasso) / 5)}/10</small><div className="training-skills-grid">{trainingSkillMeta.map((skill) => <div className="training-skill" key={skill.id}><div><strong>{skill.label}</strong><span>{trainingFeedback.skillScores[skill.id]}/10</span></div><small>{skill.hint}</small><div className="training-skill-bar"><span style={{ width: `${trainingFeedback.skillScores[skill.id] * 10}%` }} /></div></div>)}</div><div className="training-reflection-grid"><div><span className="mini-label">PERGUNTA DE REFLEXÃO</span><p>{trainingFeedback.coachQuestion}</p></div><div><span className="mini-label">COMO TENTAR DE NOVO</span><p>{trainingFeedback.retryGuide}</p></div></div></section>}

            <section className="training-rules"><div><span>01</span><strong>Diagnóstico antes do preço</strong><p>Descubra ambiente, objetivo, medida, quantidade e prazo.</p></div><div><span>02</span><strong>Valor com contexto</strong><p>Compare o que está incluso e separe principal, alternativa e “A confirmar”.</p></div><div><span>03</span><strong>Próximo passo claro</strong><p>Todo atendimento termina com ação, responsável e timing definidos.</p></div></section>
          </div>
        )}

        {section === "timing" && (
          <div className="page-content">
            <div className="section-intro timing-intro"><div><span className="eyebrow"><span className="eyebrow-line" /> RITMO COMERCIAL</span><h1>O retorno certo<br /><em>na hora certa.</em></h1><p>Timing não é pressionar. É agir enquanto você ainda consegue ajudar o cliente a decidir.</p></div><div className="timing-score"><span className="clock-face">◷</span><div><strong>{completedTiming}/06</strong><small>momentos dominados</small></div></div></div>
            <div className="timing-layout"><div className="timing-rail">{timingSteps.map((step, index) => <button key={step.id} className={`timing-item ${activeTimingStep === index ? "active" : ""} ${doneTiming.includes(step.id) ? "done" : ""}`} onClick={() => setActiveTimingStep(index)}><span className="timing-dot">{doneTiming.includes(step.id) ? "✓" : index + 1}</span><span><small>{step.when}</small><strong>{step.title}</strong></span></button>)}</div><article className="timing-detail panel"><div className="timing-detail-head"><div><span className={`priority-badge ${priorityClass(activeTiming.priority)}`}>{activeTiming.priority} prioridade</span><h2>{activeTiming.title}</h2><p className="when-label">{activeTiming.when}</p></div><span className="timing-number">{String(activeTimingStep + 1).padStart(2, "0")}</span></div><div className="why-row"><span>POR QUE AGORA?</span><p>{activeTiming.why}</p></div><div className="action-row"><span>COMO AGIR</span><p>{activeTiming.action}</p></div><div className="whatsapp-message"><div className="message-head"><span>MODELO DE MENSAGEM</span><button onClick={() => copyMessage(activeTiming.message)}>Copiar <span>⧉</span></button></div><p>{activeTiming.message}</p></div><div className="timing-footer"><label><input type="checkbox" checked={doneTiming.includes(activeTiming.id)} onChange={() => toggleTiming(activeTiming.id)} /><span className="fake-checkbox">✓</span><b>{doneTiming.includes(activeTiming.id) ? "Retorno registrado" : "Marcar retorno como feito"}</b></label><span className="timing-hint">Substitua os campos entre [colchetes]</span></div></article></div><div className="anti-pressure"><span>✦</span><div><strong>Regra de ouro</strong><p>Não use falsa urgência. Use o cronograma real da obra, a necessidade de medida e a disponibilidade confirmada.</p></div></div>
          </div>
        )}

        {section === "messages" && (
          <div className="page-content">
            <div className="section-intro messages-intro"><div><span className="eyebrow"><span className="eyebrow-line" /> CENTRAL DE MENSAGENS</span><h1>{messageAudience === "Prestador" ? <>Uma boa apresentação.<br /><em>Para abrir parcerias.</em></> : <>Uma mensagem certa.<br /><em>Para cada linha.</em></>}</h1><p>{messageAudience === "Prestador" ? "Escolha com quem vai falar. O texto mantém o cuidado necessário com empresas e usa uma linguagem mais próxima com prestadores de serviço." : "Monte uma abertura curta para WhatsApp ou áudio, com o produto, o ambiente, o objetivo e a próxima pergunta já organizados."}</p></div><div className="message-count"><strong>41</strong><span>anos para transmitir confiança</span><small>85 cidades atendidas</small></div></div>

            <section className="message-audience-switch panel" aria-label="Escolher destinatário da mensagem"><div><span className="section-kicker">QUEM VAI RECEBER?</span><h2>Separe atendimento de prospecção</h2><p>Os dados de cliente e prestador ficam organizados em planejadores diferentes.</p></div><div className="message-audience-options"><button type="button" className={messageAudience === "Cliente" ? "active" : ""} aria-pressed={messageAudience === "Cliente"} onClick={() => setMessageAudience("Cliente")}><span>01</span><strong>Cliente</strong><small>Atendimento, produto e orçamento</small></button><button type="button" className={messageAudience === "Prestador" ? "active partner" : "partner"} aria-pressed={messageAudience === "Prestador"} onClick={() => setMessageAudience("Prestador")}><span>02</span><strong>Prestador / parceiro</strong><small>Apresentação e início de parceria</small></button></div></section>

            <section className={`message-trust panel ${messageAudience === "Prestador" ? "partner" : ""}`}><div><span className="message-trust-icon">✓</span><div><strong>{messageAudience === "Prestador" ? (providerProfile === "Empresa" ? "Formal sem parecer distante" : "Próximo sem perder o respeito") : "Prova institucional sem discurso pesado"}</strong><p>{messageAudience === "Prestador" ? (providerProfile === "Empresa" ? "Diga quem você é, explique como pode ajudar e termine com uma pergunta fácil de responder." : "Use uma linguagem do dia a dia, seja educado e deixe claro que o contato pode ajudar nas próximas obras.") : "A mensagem pode ressaltar experiência, qualidade e garantia — depois volta para a necessidade real do cliente."}</p></div></div><div className="message-trust-points"><span>41 anos</span><span>85 cidades</span><span>{messageAudience === "Prestador" ? "Portfólio" : "Qualidade"}</span><span>{messageAudience === "Prestador" ? "Apoio técnico" : "Garantia da linha"}</span></div></section>
            {messageAudience === "Prestador" && <div className={`provider-contact-note ${providerProfile === "Empresa" ? "formal" : "informal"}`}><span>✦</span><p><strong>{providerProfile === "Empresa" ? "Contato com empresas:" : "Contato com prestadores de serviço:"}</strong> {providerProfile === "Empresa" ? "use o nome da empresa quando souber. Se ainda não tiver o contato de compras ou obras, peça essa orientação com educação e sem tentar apresentar tudo de uma vez." : "fale como você falaria com um profissional da região: direto, educado e sem gírias. A primeira mensagem só precisa abrir a conversa."}</p></div>}

            <div className="message-layout">
              <section className="panel message-form-panel">
                <div className="panel-heading"><div><span className="section-kicker">PLANEJADOR</span><h2>{messageAudience === "Prestador" ? "Monte sua apresentação" : "Preencha em menos de um minuto"}</h2></div><span className="planner-live"><span /> ao vivo</span></div>
                {messageAudience === "Prestador" && <div className="provider-profile-switch"><span className="section-kicker">TIPO DE APRESENTAÇÃO</span><div className="provider-profile-options"><button type="button" className={providerProfile === "Empresa" ? "active formal" : "formal"} aria-pressed={providerProfile === "Empresa"} onClick={() => selectProviderProfile("Empresa")}><span>01</span><div><strong>Empresas</strong><small>Cordial, profissional e sem cara de texto pronto</small></div></button><button type="button" className={providerProfile === "Prestador de Serviço" ? "active informal" : "informal"} aria-pressed={providerProfile === "Prestador de Serviço"} onClick={() => selectProviderProfile("Prestador de Serviço")}><span>02</span><div><strong>Prestador de Serviço</strong><small>Direto, respeitoso e com linguagem do dia a dia</small></div></button></div></div>}
                <div className="message-form-grid">
                  {messageAudience === "Prestador" ? <>
                    <label><span>{providerProfile === "Empresa" ? "Empresa ou contato (opcional)" : "Nome do prestador de serviço (opcional)"}</span><input value={providerName} onChange={(event) => setProviderName(event.target.value)} placeholder={providerProfile === "Empresa" ? "Ex.: Construtora Horizonte" : "Ex.: Carlos"} /></label>
                    <label><span>{providerProfile === "Empresa" ? "Segmento da empresa" : "Atividade profissional"}</span><select value={providerType} onChange={(event) => setProviderType(event.target.value)}>{providerTypeChoices.map((option) => <option key={option}>{option}</option>)}</select></label>
                    <div className="message-suggestions"><span>{providerProfile === "Empresa" ? "Atalhos de segmento" : "Atalhos de profissão"}</span><div>{providerTypeChoices.map((option) => <button key={option} type="button" className={providerType === option ? "active" : ""} onClick={() => setProviderType(option)}>{option}</button>)}</div></div>
                    <label><span>Cidade ou região</span><input value={providerRegion} onChange={(event) => setProviderRegion(event.target.value)} placeholder="Ex.: Araraquara e região" /></label>
                    <label><span>{providerProfile === "Empresa" ? "Objetivo comercial" : "Objetivo do contato"}</span><select value={providerObjective} onChange={(event) => setProviderObjective(event.target.value)}>{providerGoalChoices.map((option) => <option key={option}>{option}</option>)}</select></label>
                    <label className="message-question"><span>{providerProfile === "Empresa" ? "Pergunta formal para avançar" : "Pergunta para continuar a conversa"}</span><input value={providerQuestion} onChange={(event) => setProviderQuestion(event.target.value)} placeholder={providerProfile === "Empresa" ? "Ex.: com quem posso conversar sobre compras?" : "Ex.: você atende obras na região?"} /></label>
                    <div className="message-suggestions provider-question-suggestions"><span>Próximos passos sugeridos</span><div>{providerQuestionChoices.map((option) => <button key={option} type="button" className={providerQuestion === option ? "active" : ""} onClick={() => setProviderQuestion(option)}>{option}</button>)}</div></div>
                  </> : <>
                    <label><span>Nome do cliente (opcional)</span><input value={messageName} onChange={(event) => setMessageName(event.target.value)} placeholder="Ex.: João" /></label>
                    <label><span>Linha ou produto</span><input value={messageLine} onChange={(event) => setMessageLine(event.target.value)} placeholder="Ex.: porta de alumínio" /></label>
                    <div className="message-suggestions"><span>Atalhos de linha</span><div>{quickLineOptions.map((line) => <button key={line} type="button" className={messageLine === line ? "active" : ""} onClick={() => setMessageLine(line)}>{line}</button>)}</div></div>
                    <div className="message-brand-suggestions"><span>Usar uma marca do catálogo</span><div>{(Object.keys(brandData) as BrandId[]).map((id) => <button key={id} type="button" onClick={() => setMessageLine(brandData[id].descriptor)}><i style={{ background: brandData[id].accent }} />{brandData[id].short}</button>)}</div></div>
                    <label><span>Ambiente</span><select value={messageEnvironment} onChange={(event) => setMessageEnvironment(event.target.value)}><option value="">Escolha ou deixe para confirmar</option><option>entrada / fachada</option><option>sala ou área social</option><option>quarto</option><option>banheiro</option><option>cozinha ou lavanderia</option><option>obra em volume</option></select></label>
                    <label><span>Objetivo do cliente</span><select value={messageObjective} onChange={(event) => setMessageObjective(event.target.value)}><option>apresentar uma opção de qualidade</option><option>ganhar praticidade na obra</option><option>otimizar espaço</option><option>comparar custo-benefício</option><option>valorizar o acabamento</option><option>resolver vários ambientes</option><option>pedir as medidas do vão</option><option>retomar o orçamento</option><option>responder a uma dúvida</option><option>combinar o próximo passo</option></select></label>
                    <label className="message-question"><span>Próxima pergunta (opcional)</span><input value={messageQuestion} onChange={(event) => setMessageQuestion(event.target.value)} placeholder="Ex.: você já tem a medida do vão?" /></label>
                  </>}
                  <label><span>Canal</span><select value={messageChannel} onChange={(event) => setMessageChannel(event.target.value as QuickMessageChannel)}><option>WhatsApp</option><option>Áudio</option></select></label>
                  <label><span>Tom da mensagem</span><select value={messageTone} onChange={(event) => setMessageTone(event.target.value as QuickMessageTone)}><option>Consultivo</option><option>Direto</option><option>Próximo</option></select></label>
                </div>
                <div className="message-proof-options"><span className="section-kicker">O QUE RESSALTAR</span><label><input type="checkbox" checked={messageProof.company} onChange={(event) => setMessageProof((current) => ({ ...current, company: event.target.checked }))} /><span className="fake-checkbox">✓</span>41 anos e 85 cidades</label><label><input type="checkbox" checked={messageProof.quality} onChange={(event) => setMessageProof((current) => ({ ...current, quality: event.target.checked }))} /><span className="fake-checkbox">✓</span>{messageAudience === "Prestador" ? "Portfólio de portas e esquadrias" : "Qualidade"}</label><label><input type="checkbox" checked={messageProof.guarantee} onChange={(event) => setMessageProof((current) => ({ ...current, guarantee: event.target.checked }))} /><span className="fake-checkbox">✓</span>{messageAudience === "Prestador" ? "Apoio na especificação" : "Garantia da linha"}</label></div>
              </section>

              <section className="panel message-preview-panel">
                <div className="message-preview-head"><div><span className="section-kicker">PRÉVIA PRONTA</span><h2>{messageAudience === "Prestador" ? (providerProfile === "Empresa" ? (messageChannel === "Áudio" ? "Apresentação formal para falar" : "Apresentação formal para enviar") : (messageChannel === "Áudio" ? "Apresentação próxima para falar" : "Apresentação próxima para enviar")) : (messageChannel === "Áudio" ? "Roteiro para falar" : "Mensagem para enviar")}</h2></div><div className="message-preview-actions"><button className="copy-button" onClick={() => speakText(quickMessage, "quick-message")}>{speakingMessageId === "quick-message" ? "Parar áudio" : "Ouvir"} <span>{speakingMessageId === "quick-message" ? "■" : "▶"}</span></button><button className="copy-button" onClick={() => copyMessage(quickMessage, messageChannel === "Áudio" ? "Roteiro de áudio" : messageAudience === "Prestador" ? "Apresentação" : "Mensagem")}>Copiar {messageChannel === "Áudio" ? "roteiro" : "mensagem"} <span>⧉</span></button></div></div>
                <div className={`message-preview-bubble ${messageChannel === "Áudio" ? "audio" : ""} ${messageAudience === "Prestador" ? "partner" : ""} ${messageAudience === "Prestador" && providerProfile === "Empresa" ? "formal" : ""}`} aria-live="polite"><div className="preview-label"><span>{messageChannel === "Áudio" ? (messageAudience === "Prestador" ? `${providerProfile.toUpperCase()} · GUIA DE ÁUDIO` : "GUIA DE ÁUDIO") : messageAudience === "Prestador" ? `${providerProfile.toUpperCase()} · WHATSAPP` : "WHATSAPP"}</span><span>{messageTone.toUpperCase()}</span></div><p>{quickMessage}</p></div>
                <div className="message-next"><span className="mini-label">POR QUE FUNCIONA</span><p>{messageAudience === "Prestador" ? (providerProfile === "Empresa" ? "A mensagem é profissional, mas não fria: apresenta a Mult Portas, mostra utilidade e facilita o encaminhamento para a pessoa certa." : "Parece uma conversa de verdade: é respeitosa, explica como você pode ajudar e termina com uma pergunta simples.") : "Apresenta a linha, transmite confiança e termina com uma pergunta objetiva. Assim a conversa continua humana, sem parecer uma resposta automática."}</p></div>
                <div className="message-checklist"><span className="mini-label">ANTES DE ENVIAR</span><div>{messageAudience === "Prestador" ? (providerProfile === "Empresa" ? <><span>✓ confirme o nome da empresa</span><span>✓ identifique o segmento</span><span>✓ procure o responsável certo</span></> : <><span>✓ confirme o nome</span><span>✓ cite a região</span><span>✓ seja próximo sem usar gírias</span></>) : <><span>✓ cite o ambiente</span><span>✓ adapte o objetivo</span><span>✓ confirme medida, modelo e garantia</span></>}</div></div>
                <div className="message-pending"><span className="mini-label">{messageAudience === "Prestador" ? "CONFIRME DEPOIS DO PRIMEIRO CONTATO" : "AINDA PENDENTE NO ATENDIMENTO"}</span><p>{messagePendingFields.map((field, index) => <span key={field}>A confirmar: {field}{index < messagePendingFields.length - 1 ? " · " : ""}</span>)}</p></div>
                <button className="button dark full" onClick={() => copyMessage(quickMessage, messageChannel === "Áudio" ? "Roteiro de áudio" : messageAudience === "Prestador" ? "Apresentação" : "Mensagem")}>{messageChannel === "Áudio" ? "Copiar roteiro de áudio" : messageAudience === "Prestador" ? "Copiar apresentação" : "Copiar para o WhatsApp"} <span>⧉</span></button>
              </section>
            </div>

            <section className="message-examples"><div className="section-intro-mini"><span className="section-kicker">{messageAudience === "Prestador" ? `${providerProfile === "Empresa" ? "MODELOS PARA FALAR COM EMPRESAS" : "MODELOS PARA FALAR COM PRESTADORES DE SERVIÇO"}` : "ABERTURAS QUE PODEM SER ADAPTADAS"}</span><h2>{messageAudience === "Prestador" ? (providerProfile === "Empresa" ? "Mensagens profissionais que ainda parecem escritas por uma pessoa." : "Mensagens simples, respeitosas e prontas para usar.") : "Comece simples. Personalize na resposta."}</h2></div><div className="message-example-grid">{(messageAudience === "Prestador" ? providerExampleChoices : openingRecommendations.slice(0, 4)).map((item) => <article key={item.id}><span>{item.tag}</span><strong>{item.title}</strong><p>{item.message}</p><button className="copy-button" onClick={() => copyMessage(item.message, messageAudience === "Prestador" ? "Apresentação" : "Exemplo")}>{messageAudience === "Prestador" ? "Copiar apresentação" : "Copiar exemplo"} <span>⧉</span></button></article>)}</div></section>
          </div>
        )}

        {section === "fair" && (
          <div className="page-content fair-page">
            <div className="section-intro fair-intro">
              <div>
                <span className="eyebrow"><span className="eyebrow-line" /> CONVITES DO FEIRÃO</span>
                <h1>Convide com atenção.<br /><em>Sem parecer mensagem em massa.</em></h1>
                <p>Escolha o contexto do cliente, personalize o interesse e copie uma mensagem acolhedora para WhatsApp ou um roteiro natural para áudio.</p>
              </div>
              <div className="fair-date-card"><strong>{(fairEventDate.trim() || "sábado, 29/08").replace(/^sábado,\s*/i, "")}</strong><span>{(fairEventDate.trim() || "sábado, 29/08").split(",")[0] || "Feirão"}</span><small>{fairEventTime.trim() || "das 9h às 17h"}</small></div>
            </div>

            <section className="panel fair-promise">
              <div className="fair-promise-icon">✦</div>
              <div><span className="section-kicker">MONTAGEM RÁPIDA</span><h2>Uma abordagem certa para cada momento do cliente</h2><p>A mensagem muda o contexto sem inventar informações, pressionar ou cobrar resposta. Você só confere os dados e envia.</p></div>
              <div className="fair-promise-points"><span>7 perfis</span><span>144 variações por opção</span><span>WhatsApp</span><span>Áudio</span><span>Sem pressão</span></div>
            </section>

            <div className="fair-layout">
              <section className="panel fair-builder-panel">
                <div className="panel-heading"><div><span className="section-kicker">PERSONALIZAÇÃO</span><h2>Monte o convite em menos de um minuto</h2></div><span className="planner-live"><span /> ao vivo</span></div>

                <div className="fair-profile-picker">
                  <span className="mini-label">TIPO DE CLIENTE</span>
                  <div className="fair-profile-grid">
                    {fairClientProfiles.map((profile, index) => <button key={profile.id} type="button" className={fairProfileId === profile.id ? "active" : ""} aria-pressed={fairProfileId === profile.id} onClick={() => setFairProfileId(profile.id as FairProfileId)}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{profile.shortLabel}</strong><small>{profile.description}</small></div></button>)}
                  </div>
                </div>

                <div className="fair-form-grid">
                  <label><span>Nome do cliente (opcional)</span><input value={fairClientName} onChange={(event) => setFairClientName(event.target.value)} placeholder="Ex.: Carlos" /></label>
                  <label><span>Nome do consultor</span><input value={fairConsultantName} onChange={(event) => setFairConsultantName(event.target.value)} placeholder={authUser.displayName} /></label>
                  <label className="fair-interest-field"><span>Interesse ou produto (opcional)</span><input value={fairInterest} onChange={(event) => setFairInterest(event.target.value)} placeholder="Ex.: porta de alumínio" /></label>
                  <div className="fair-interest-options"><span>Atalhos de interesse</span><div>{fairInterestOptions.map((interest) => <button key={interest} type="button" className={fairInterest === interest ? "active" : ""} onClick={() => setFairInterest(interest)}>{interest}</button>)}</div></div>
                  <label><span>Canal</span><select value={fairChannel} onChange={(event) => setFairChannel(event.target.value as QuickMessageChannel)}><option>WhatsApp</option><option>Áudio</option></select></label>
                  <label><span>Tom do convite</span><select value={fairTone} onChange={(event) => setFairTone(event.target.value as FairTone)}>{fairToneOptions.map((tone) => <option key={tone.id} value={tone.id}>{tone.label}</option>)}</select></label>
                </div>

                <div className="fair-event-settings">
                  <div><span className="section-kicker">DADOS DO FEIRÃO</span><small>Edite quando houver uma nova campanha.</small></div>
                  <div className="fair-event-grid">
                    <label><span>Data</span><input value={fairEventDate} onChange={(event) => setFairEventDate(event.target.value)} placeholder="Ex.: sábado, 29/08" /></label>
                    <label><span>Horário</span><input value={fairEventTime} onChange={(event) => setFairEventTime(event.target.value)} placeholder="Ex.: das 9h às 17h" /></label>
                    <label><span>Cidade</span><input value={fairCity} onChange={(event) => setFairCity(event.target.value)} placeholder="Ex.: Araraquara" /></label>
                    <label><span>Condição principal</span><input value={fairDiscount} onChange={(event) => setFairDiscount(event.target.value)} placeholder="Ex.: até 60% OFF" /></label>
                  </div>
                </div>

                <div className={`fair-emoji-control ${fairChannel === "Áudio" ? "disabled" : ""}`}><div><span className="mini-label">EMOJIS NA MENSAGEM</span><small>{fairChannel === "Áudio" ? "O roteiro de áudio fica limpo automaticamente." : fairEmojiModes.find((mode) => mode.id === fairEmojiMode)?.description}</small></div><div className="fair-emoji-options" role="group" aria-label="Quantidade de emojis">{fairEmojiModes.map((mode) => <button key={mode.id} type="button" disabled={fairChannel === "Áudio"} className={fairEmojiMode === mode.id ? "active" : ""} aria-pressed={fairEmojiMode === mode.id} onClick={() => setFairEmojiMode(mode.id as FairEmojiMode)}>{mode.label}</button>)}</div></div>
              </section>

              <section className="panel fair-preview-panel">
                <div className="message-preview-head"><div><span className="section-kicker">CONVITE PRONTO</span><h2>{fairChannel === "Áudio" ? "Roteiro natural para falar" : "Mensagem pronta para enviar"}</h2></div><div className="message-preview-actions"><button className="copy-button" type="button" onClick={() => speakText(fairMessage, "fair-message")}>{speakingMessageId === "fair-message" ? "Parar áudio" : "Ouvir"} <span>{speakingMessageId === "fair-message" ? "■" : "▶"}</span></button><button className="copy-button" type="button" onClick={() => copyMessage(fairMessage, "Convite do Feirão")}>Copiar <span>⧉</span></button></div></div>
                <div key={fairVariation} className={`fair-preview-bubble ${fairChannel === "Áudio" ? "audio" : ""}`} aria-live="polite"><div className="preview-label"><span>{fairChannel.toUpperCase()} · {fairClientProfiles.find((profile) => profile.id === fairProfileId)?.shortLabel.toUpperCase()}</span><span>{fairToneOptions.find((tone) => tone.id === fairTone)?.label.toUpperCase()}</span></div><p>{fairMessage}</p></div>
                <div className="fair-randomizer"><div><span className="mini-label">VARIAÇÃO INSTANTÂNEA</span><p>Troque a redação sem alterar cliente, produto ou dados do Feirão.</p></div><button className="fair-randomize-button" type="button" onClick={randomizeFairMessage} aria-label="Gerar outra versão do convite"><span aria-hidden="true">↻</span><span><strong>Gerar outra versão</strong><small>Versão {fairVariation + 1} de {FAIR_VARIATION_COUNT}</small></span></button></div>
                <div className="message-next"><span className="mini-label">POR QUE FUNCIONA</span><p>{fairClientProfiles.find((profile) => profile.id === fairProfileId)?.description} O convite apresenta a condição com clareza e termina com uma pergunta fácil de responder.</p></div>
                <div className="fair-checklist"><span className="mini-label">ANTES DE ENVIAR</span><div><span>✓ confirme nome e interesse</span><span>✓ confira data e horário</span><span>✓ mantenha “até” no desconto</span><span>✓ envie sem cobrar resposta</span></div></div>
                <button className="button dark full" type="button" onClick={() => copyMessage(fairMessage, fairChannel === "Áudio" ? "Roteiro do Feirão" : "Convite do Feirão")}>{fairChannel === "Áudio" ? "Copiar roteiro de áudio" : "Copiar para o WhatsApp"} <span>⧉</span></button>
              </section>
            </div>

            <section className="fair-library">
              <div className="section-intro-mini"><span className="section-kicker">MODELOS POR TIPO DE CLIENTE</span><h2>Sete convites prontos, já com os dados preenchidos.</h2><p>Os modelos abaixo acompanham o nome, o interesse, o canal, o tom e as informações do Feirão escolhidas acima.</p></div>
              <div className="fair-template-grid">{fairProfileMessages.map((item) => <article key={item.id} className={fairProfileId === item.id ? "active" : ""}><div className="fair-template-head"><span>{item.shortLabel}</span><button type="button" onClick={() => setFairProfileId(item.id as FairProfileId)}>Usar modelo <span>→</span></button></div><strong>{item.label}</strong><p>{item.message}</p><button className="copy-button" type="button" onClick={() => copyMessage(item.message, `Convite ${item.shortLabel}`)}>Copiar convite <span>⧉</span></button></article>)}</div>
            </section>
          </div>
        )}

        {section === "factory" && (
          <div className="page-content factory-page">
            <div className="section-intro factory-intro">
              <div>
                <span className="eyebrow"><span className="eyebrow-line" /> REQUISIÇÃO TÉCNICA · USO INTERNO</span>
                <h1>Monte o Kit Porta.<br /><em>Envie sem ruído.</em></h1>
                <p>Uma linha por Kit Porta Dalcomad. Preencha somente as características aplicáveis, mantenha o que ainda falta como “A confirmar” e exporte o arquivo quando estiver pronto.</p>
              </div>
              <div className="factory-count"><strong>{filledFactoryItems.length}</strong><span>{filledFactoryItems.length === 1 ? "item enviado" : "itens enviados"}</span><small>Uma linha por orçamento encaminhado</small></div>
            </div>

            <section className="factory-rules" aria-label="Regras da requisição">
              <div><span>01</span><strong>Uma linha por kit</strong><p>Separe cada Kit Porta Dalcomad.</p></div>
              <div><span>02</span><strong>Consulta técnica</strong><p>Esta área não substitui o orçamento comercial.</p></div>
              <div><span>03</span><strong>Sem lacunas inventadas</strong><p>Use “A confirmar” ou deixe em branco.</p></div>
              <div><span>04</span><strong>Excel em um clique</strong><p>O arquivo leva as linhas preenchidas e as listas.</p></div>
            </section>

            <section className="panel factory-workspace">
              <div className="factory-toolbar">
                <div>
                  <span className="section-kicker">REQUISIÇÃO TÉCNICA</span>
                  <h2>Kits de porta para consultar ou requisitar</h2>
                  <p>Planilha exclusiva: monte apenas Kit Porta Dalcomad de abrir e exporte os kits enviados quando a consulta estiver pronta.</p>
                </div>
                <div className="factory-actions">
                  <button className="button primary" type="button" onClick={exportFactoryToExcel}>Exportar Excel <span>↓</span></button>
                  <button className="text-button danger-text" type="button" onClick={clearFactoryItems}>Limpar itens <span>×</span></button>
                </div>
              </div>

              <div className="factory-fixed-settings" aria-label="Escopo fixo da requisição">
                <div className="factory-scope">
                  <span className="section-kicker">ESCOPO FIXO</span>
                  <strong>DALCOMAD · KIT PORTA · ABRIR</strong>
                  <p>Produto e abertura já estão definidos para todas as linhas.</p>
                </div>
                <div className="factory-fixed-note"><span className="mini-label">CORES DAS AMOSTRAS</span><p>ECO usa PET/PVC TX; STANDART usa Melamínico; SENSE usa Renolit. A cor é filtrada automaticamente pela linha escolhida.</p></div>
              </div>

              <section className="factory-locator" aria-label="Montador passo a passo do Kit Porta Dalcomad">
                <div className="factory-locator-header">
                  <div><span className="section-kicker">{editingFactoryItemId ? "EDITANDO KIT ENVIADO" : "MONTADOR PASSO A PASSO"}</span><h3>{editingFactoryItemId ? "Revise o Kit Porta Dalcomad" : "Monte o Kit Porta Dalcomad"}</h3><p>Escolha uma característica válida por etapa. A linha só será criada ou atualizada quando você concluir o montador.</p></div>
                  <div className="factory-step-counter"><strong>{String(factoryWizardStep + 1).padStart(2, "0")}</strong><span>/ {String(factoryWizardSteps.length).padStart(2, "0")}</span></div>
                </div>
                <div className="factory-progress" aria-hidden="true"><span style={{ width: `${factoryWizardProgress}%` }} /></div>
                <div className="factory-step-tabs" aria-label="Etapas para montar o kit">
                  {factoryWizardSteps.map((step, index) => <button key={step.key} type="button" aria-current={factoryWizardStep === index ? "step" : undefined} className={factoryWizardStep === index ? "active" : factoryWizardDraft[step.key].trim() ? "done" : ""} onClick={() => setFactoryWizardStep(index)}><b>{String(index + 1).padStart(2, "0")}</b><span>{step.label}</span></button>)}
                </div>
                <div className="factory-locator-body">
                  <div className="factory-locator-copy"><span className="section-kicker">ETAPA {String(factoryWizardStep + 1).padStart(2, "0")}</span><h4>{activeFactoryWizardStep.title}</h4><p>{activeFactoryWizardStep.hint}</p></div>
                  <div className="factory-locator-input-wrap">
                    <label className="factory-locator-field"><span>{activeFactoryWizardStep.label}{activeFactoryWizardStep.optional ? " · opcional" : ""}</span>{activeFactoryWizardUsesSelect ? <select className="factory-locator-select" value={factoryWizardDraft[activeFactoryWizardStep.key]} onChange={(event) => updateFactoryWizard(activeFactoryWizardStep.key, event.target.value)} aria-label={`Etapa ${activeFactoryWizardStep.label}`} autoFocus><option value="">Selecione {activeFactoryWizardStep.label.toLocaleLowerCase("pt-BR")}</option>{activeFactoryWizardOptions.map((option) => <option key={option} value={option}>{option}</option>)}<option value="A confirmar">A confirmar</option></select> : <input value={factoryWizardDraft[activeFactoryWizardStep.key]} onChange={(event) => updateFactoryWizard(activeFactoryWizardStep.key, event.target.value)} placeholder={activeFactoryWizardStep.placeholder} list={activeFactoryWizardStep.listId} inputMode={activeFactoryWizardStep.key === "priceWithoutLock" || activeFactoryWizardStep.key === "priceWithLock" ? "decimal" : undefined} autoComplete="off" aria-label={`Etapa ${activeFactoryWizardStep.label}`} autoFocus />}</label>
                    <div className="factory-suggestion-row" aria-label={`Sugestões para ${activeFactoryWizardStep.label}`}>
                      {activeFactoryWizardOptions.map((option) => <button key={option} type="button" className={`${factoryWizardDraft[activeFactoryWizardStep.key] === option ? "selected" : ""}${activeFactoryWizardStep.key === "color" ? " factory-color-option" : ""}`} onClick={() => updateFactoryWizard(activeFactoryWizardStep.key, option)}>{activeFactoryWizardStep.key === "color" && <span className="factory-color-swatch" style={{ background: getDalcomadKitSwatch(factoryWizardDraft.line, option) }} aria-hidden="true" />}{option}</button>)}
                      <button type="button" className={factoryWizardDraft[activeFactoryWizardStep.key] === "A confirmar" ? "selected pending" : "pending"} onClick={setFactoryWizardPending}>A confirmar</button>
                    </div>
                  </div>
                </div>
                <div className="factory-locator-summary" aria-live="polite"><span className="mini-label">PRÉVIA DO KIT · DALCOMAD · KIT PORTA · ABRIR</span><div>{factoryWizardSteps.map((step) => <span key={step.key} className={factoryWizardDraft[step.key].trim() ? "filled" : ""}><b>{step.label}</b>{factoryWizardDraft[step.key].trim() || (step.optional ? "Opcional" : "—")}</span>)}</div></div>
                <div className="factory-locator-actions"><button className="text-button" type="button" onClick={resetFactoryWizard}>{editingFactoryItemId ? "Cancelar edição" : "Limpar montador"}</button><div><button className="button light" type="button" onClick={goToPreviousFactoryWizardStep} disabled={factoryWizardStep === 0}>← Voltar</button>{factoryWizardStep < factoryWizardSteps.length - 1 ? <button className="button dark" type="button" onClick={goToNextFactoryWizardStep}>Próxima etapa <span>→</span></button> : <button className="button primary" type="button" onClick={addFactoryWizardItem}>{editingFactoryItemId ? "Salvar alterações" : "Enviar kit para a requisição"} <span>↗</span></button>}</div></div>
              </section>

              <div className="factory-submission-note" role="status" aria-live="polite">
                <span><b>{filledFactoryItems.length}</b> {filledFactoryItems.length === 1 ? "item preparado" : "itens preparados"}</span>
                <span>Os kits enviados ficam salvos separadamente na sua conta e podem ser exportados para Excel quando a consulta estiver pronta.</span>
              </div>

              {filledFactoryItems.length > 0 && (
                <section className="factory-submitted" aria-labelledby="factory-submitted-title">
                  <div className="factory-submitted-heading"><div><span className="section-kicker">KITS ENVIADOS</span><h3 id="factory-submitted-title">Confira antes de exportar</h3></div><span>{filledFactoryItems.length}/240</span></div>
                  <div className="factory-submitted-list">
                    {filledFactoryItems.map((item, index) => (
                      <article className="factory-submitted-row" key={item.id}>
                        <span className="factory-row-number">{String(index + 1).padStart(2, "0")}</span>
                        <div><strong>{item.leafMeasure || "Medida a confirmar"}</strong><small>{[item.line, item.finish, item.color].filter(Boolean).join(" · ") || "Características a confirmar"}</small></div>
                        <div><strong>{item.requadro || "Requadro a confirmar"}</strong><small>{item.filling || "Preenchimento a confirmar"}</small></div>
                        <div className="factory-row-actions"><button type="button" onClick={() => editFactoryItem(item)}>Editar</button><button type="button" className="danger-text" onClick={() => removeFactoryItem(item)}>Remover</button></div>
                      </article>
                    ))}
                  </div>
                </section>
              )}

              <div className="factory-bottom-bar" role="status" aria-live="polite"><span>✓ Salvo automaticamente na sua conta</span><span>→ Exporte o arquivo depois de finalizar o localizador.</span></div>
            </section>

            <section className="factory-notes-grid">
              <article className="panel factory-note-card"><span className="section-kicker">COMO USAR</span><h2>Envie um kit por vez.</h2><p>Monte o kit, confira a prévia e envie a linha para preparar a consulta. Se precisar mudar algo, ajuste as etapas antes de enviar.</p><div className="factory-note-list"><span>✓ Medida do kit e requadro</span><span>✓ Linha define o acabamento</span><span>✓ Cor conforme a amostra</span><span>✓ Valores manuais opcionais</span></div></article>
              <article className="panel factory-note-card accent"><span className="section-kicker">ANTES DE ENCAMINHAR</span><h2>Não misture consulta e venda.</h2><p>Este arquivo é uma requisição técnica para a fábrica. Não inclui desconto, parcelas, validade ou promessa de estoque e prazo.</p><button className="button dark" type="button" onClick={() => navigate("messages")}>Voltar para mensagem comercial <span>→</span></button></article>
            </section>

            <datalist id="factory-requadros">{factoryListOptions.requadros.map((item) => <option key={item} value={item} />)}</datalist>
            <datalist id="factory-colors">{factoryListOptions.colors.map((item) => <option key={item} value={item} />)}</datalist>
            <datalist id="factory-lines">{factoryListOptions.lines.map((item) => <option key={item} value={item} />)}</datalist>
            <datalist id="factory-finishes">{factoryListOptions.finishes.map((item) => <option key={item} value={item} />)}</datalist>
            <datalist id="factory-fillings">{factoryListOptions.fillings.map((item) => <option key={item} value={item} />)}</datalist>
          </div>
        )}

        {section === "catalog" && (
          <div className="page-content">
            <div className="section-intro catalog-intro"><div><span className="eyebrow"><span className="eyebrow-line" /> INTELIGÊNCIA DE PRODUTO</span><h1>Catálogo de decisão,<br /><em>não de confusão.</em></h1><p>Pesquise por marca, família ou modelo. Use o argumento e confira os pontos técnicos antes de prometer.</p></div><div className="catalog-count"><strong>{catalogItems.length}</strong><span>fichas comerciais</span><small>{studiedCatalogCount} catálogos · {studiedBrandCount} marcas</small></div></div>
            <div className="brand-tabs">{(Object.keys(brandData) as BrandId[]).map((id) => <button key={id} className={brand === id ? "active" : ""} onClick={() => selectBrand(id)}><span className="brand-tab-mark" style={{ background: brandData[id].accent }} /> <strong>{brandData[id].short}</strong><small>{brandData[id].descriptor}</small></button>)}</div>
            <div className="brand-profile panel"><div className="brand-profile-main"><div className="profile-orb" style={{ background: currentBrand.accent }}><span>{currentBrand.short.slice(0, 2).toUpperCase()}</span></div><div><span className="section-kicker">{currentBrand.catalog}</span><h2>{currentBrand.name}</h2><p>{currentBrand.summary}</p><a className="official-link" href={currentBrand.official} target="_blank" rel="noreferrer">Abrir canal oficial <span>↗</span></a></div></div><div className="profile-columns"><div><span className="mini-label">INDICAR QUANDO</span>{currentBrand.when.map((item) => <span className="profile-tag" key={item}>+ {item}</span>)}</div><div><span className="mini-label">NÃO ESQUECER</span>{currentBrand.guardrails.map((item) => <p className="guardrail" key={item}>✓ {item}</p>)}</div></div></div>
            {currentBrand.documents?.length ? <section className="catalog-documents panel" aria-label={`Catálogos em PDF de ${currentBrand.short}`}><div className="catalog-documents-heading"><div><span className="section-kicker">ARQUIVOS PARA CONSULTA</span><h2>Catálogos completos em PDF</h2></div><span>{currentBrand.documents.length} arquivos</span></div><div className="catalog-document-grid">{currentBrand.documents.map((document, index) => <a className="catalog-document-card" href={document.href} target="_blank" rel="noreferrer" key={document.href}><div><span>{String(index + 1).padStart(2, "0")}</span><strong>{document.title}</strong></div><p>{document.description}</p><small>{document.pages} páginas <b>Abrir PDF ↗</b></small></a>)}</div></section> : null}
            <div className="catalog-tools"><div className="search-box"><span>⌕</span><input value={catalogSearch} onChange={(event) => setCatalogSearch(event.target.value)} placeholder={`Pesquisar em ${currentBrand.short}...`} aria-label="Pesquisar no catálogo" /></div><select value={catalogFamily} onChange={(event) => setCatalogFamily(event.target.value)} aria-label="Filtrar família">{families.map((family) => <option key={family}>{family}</option>)}</select><span className="result-count">{filteredCatalog.length} resultados</span></div>
            {filteredCatalog.length > 0 ? <div className="catalog-grid">{filteredCatalog.map((item) => <article className="catalog-card" key={item.id}><div className="card-meta"><span className="family-badge">{item.family}</span><span className="source-dot" title={item.source}>●</span></div><h3>{item.title}</h3>{item.code && <div className="catalog-code">{item.code}</div>}<p>{item.spec}</p><div className="card-bottom"><span>Indicar para <strong>{item.bestFor.split(",")[0]}</strong></span><button type="button" aria-label={`Abrir ficha de ${item.title}`} onClick={(event) => { catalogTriggerRef.current = event.currentTarget; setSelectedCatalog(item); }}>Ver ficha <span>→</span></button></div></article>)}</div> : <div className="empty-state catalog-empty"><strong>Nenhuma ficha encontrada.</strong><span>Revise o termo ou limpe os filtros para ver todas as opções desta marca.</span><button className="button light" type="button" onClick={() => { setCatalogSearch(""); setCatalogFamily("Todas"); }}>Limpar filtros</button></div>}
            <div className="catalog-note"><span>i</span><p>Os catálogos enviados são referências comerciais. Código, cor, medida final, ferragem, disponibilidade, prazo e composição devem ser confirmados antes do fechamento.</p></div>
            {selectedCatalog && <div className="drawer-backdrop" onClick={() => setSelectedCatalog(null)}><aside className="catalog-drawer" ref={catalogDialogRef} role="dialog" aria-modal="true" aria-label={`Ficha de ${selectedCatalog.title}`} onClick={(event) => event.stopPropagation()}><button className="drawer-close" aria-label="Fechar ficha" onClick={() => setSelectedCatalog(null)}>×</button><span className="family-badge">{selectedCatalog.family}</span><h2>{selectedCatalog.title}</h2><p className="drawer-spec">{selectedCatalog.spec}</p><div className="drawer-section"><span className="mini-label">QUANDO INDICAR</span><p>{selectedCatalog.bestFor}</p></div><div className="drawer-section pitch"><span className="mini-label">ARGUMENTO DE VENDA</span><p>“{selectedCatalog.pitch}”</p><div className="drawer-actions"><button className="copy-button" onClick={() => copyMessage(selectedCatalog.pitch)}>Copiar argumento <span>⧉</span></button><button className="copy-button" onClick={() => { setMessageLine(selectedCatalog.title); setSelectedCatalog(null); navigate("messages"); }}>Planejar mensagem <span>→</span></button></div></div><div className="drawer-section"><span className="mini-label">CONFIRMAR ANTES DE FECHAR</span>{selectedCatalog.checks.map((check) => <label className="drawer-check" key={check}><input type="checkbox" checked={drawerChecks[selectedCatalog.id]?.includes(check) ?? false} onChange={() => toggleCatalogCheck(selectedCatalog.id, check)} /><span className="fake-checkbox">✓</span>{check}</label>)}</div>{selectedCatalog.documentHref && <a className="catalog-pdf-link" href={selectedCatalog.documentHref} target="_blank" rel="noreferrer">Abrir catálogo completo em PDF <span>↗</span></a>}<div className="drawer-source"><span>Fonte</span><strong>{selectedCatalog.source}</strong><small>{brandData[selectedCatalog.brand].catalog}</small></div></aside></div>}
          </div>
        )}

        {section === "control" && (
          <div className="page-content">
            <div className="section-intro control-intro"><div><span className="eyebrow"><span className="eyebrow-line" /> CONTROLE COMERCIAL</span><h1>Nada fica solto.<br /><em>Tudo tem próximo passo.</em></h1><p>Use este quadro para organizar os atendimentos da sua conta. A planilha oficial continua sendo atualizada somente quando você pedir.</p></div><div className="control-total"><strong>{portfolioCount}</strong><span>orçamentos informados</span><small>{officialQuoteCount} oficiais · {incompleteQuoteCount} incompletos</small></div></div>
            <section className="control-rules"><div><span className="rule-number">01</span><strong>Número imutável</strong><p>O oficial não muda.</p></div><div><span className="rule-number">02</span><strong>Um status principal</strong><p>Sem duplicidade de cobrança.</p></div><div><span className="rule-number">03</span><strong>Histórico separado</strong><p>Encerrado não volta sozinho.</p></div><div><span className="rule-number">04</span><strong>Valor exato</strong><p>Centavos preservados.</p></div></section>
            <section className="panel add-followup"><div><span className="section-kicker">NOVA PENDÊNCIA LOCAL</span><h2>Registrar sem perder tempo</h2></div><form onSubmit={addFollowUp}><input value={newClient} onChange={(event) => setNewClient(event.target.value)} placeholder="Cliente / orçamento" aria-label="Cliente ou orçamento" /><input value={newNext} onChange={(event) => setNewNext(event.target.value)} placeholder="Próxima ação" aria-label="Próxima ação" /><select value={newStatus} onChange={(event) => setNewStatus(event.target.value)} aria-label="Status">{statusOptions.map((status) => <option key={status}>{status}</option>)}</select><select value={newPriority} onChange={(event) => setNewPriority(event.target.value as Priority)} aria-label="Prioridade"><option>Alta</option><option>Média</option><option>Baixa</option></select><button className="button dark" type="submit">Adicionar <span>+</span></button></form></section>
            <section className="board-heading"><div><span className="section-kicker">QUADRO DE AÇÃO</span><h2>O que merece atenção</h2></div><select value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)} aria-label="Filtrar status"><option>Todos</option>{statusOptions.map((status) => <option key={status}>{status}</option>)}</select></section>
            <section className="followup-list">{filteredFollowUps.map((item) => <article className={`followup-row ${item.done ? "completed" : ""}`} key={item.id}><button type="button" className={`row-check ${item.done ? "checked" : ""}`} aria-label={item.done ? `Reabrir pendência de ${item.client}` : `Concluir pendência de ${item.client}`} onClick={() => setFollowUps((current) => current.map((follow) => follow.id === item.id ? { ...follow, done: !follow.done } : follow))}>{item.done ? "✓" : ""}</button><div className="follow-main"><strong>{item.client}</strong><span>{item.status}</span></div><div className="follow-next"><small>Próxima ação</small><p>{item.next}</p></div><span className={`priority-badge ${priorityClass(item.priority)}`}>{item.priority}</span>{item.id.startsWith("local-") && <button type="button" className="delete-row" aria-label={`Excluir pendência de ${item.client}`} onClick={() => setFollowUps((current) => current.filter((follow) => follow.id !== item.id))}>×</button>}</article>)}{filteredFollowUps.length === 0 && <div className="empty-state">Nenhuma pendência com este filtro.</div>}</section>
            <div className="control-footnote"><span>!</span><p>Campos que não estiverem confirmados devem ficar como <strong>“A confirmar”</strong> ou em branco. Não transforme alternativa em venda e não some opções de cor como se fossem um único negócio.</p></div>
          </div>
        )}

        {section === "management" && (
          <div className="page-content">
            <div className="section-intro management-intro"><div><span className="eyebrow"><span className="eyebrow-line" /> GESTÃO SEM EXCESSO</span><h1>Melhore o processo,<br /><em>não só o resultado.</em></h1><p>Gestão é saber onde a venda travou, quem precisa de ação e qual comportamento repetir amanhã.</p></div><div className="management-level"><span>MODELO</span><strong>4 níveis</strong><small>rotina · dados · decisão · melhoria</small></div></div>
            <section className="level-cards"><article><span>01 · BASE</span><h3>Organizar</h3><p>Cliente, número, valor, status, responsável e próxima ação.</p></article><article><span>02 · RITMO</span><h3>Acompanhar</h3><p>Retornos em timing e pendências que não ficam invisíveis.</p></article><article><span>03 · DECISÃO</span><h3>Priorizar</h3><p>Tempo no que tem medida, necessidade e decisão possível.</p></article><article><span>04 · MELHORAR</span><h3>Aprender</h3><p>Registrar objeções e repetir os argumentos que funcionam.</p></article></section>
            <section className="management-grid"><article className="panel metrics-panel"><div className="panel-heading"><div><span className="section-kicker">PAINEL DE INDICADORES</span><h2>Coloque os números do dia</h2></div><span className="metric-calendar">⌗</span></div><div className="metric-inputs"><label><span>Novos contatos</span><input type="number" min="0" step="1" value={metrics.leads} onChange={(event) => updateMetric("leads", event.target.value)} /></label><label><span>Orçamentos</span><input type="number" min="0" step="1" value={metrics.quotes} onChange={(event) => updateMetric("quotes", event.target.value)} /></label><label><span>Com número oficial</span><input type="number" min="0" step="1" value={metrics.officialQuotes} onChange={(event) => updateMetric("officialQuotes", event.target.value)} /></label><label><span>Incompletos / sem número</span><input type="number" min="0" step="1" value={metrics.incompleteQuotes} onChange={(event) => updateMetric("incompleteQuotes", event.target.value)} /></label><label><span>Retornos feitos</span><input type="number" min="0" step="1" value={metrics.followups} onChange={(event) => updateMetric("followups", event.target.value)} /></label><label><span>Vendas fechadas</span><input type="number" min="0" step="1" value={metrics.closed} onChange={(event) => updateMetric("closed", event.target.value)} /></label></div><div className="metric-results"><div><strong>{formatPercent(metricsConversion)}</strong><span>conversão de orçamento</span></div><div><strong>{formatPercent(metricsReturn)}</strong><span>taxa de retorno</span></div><div><strong>{metrics.ticket ? `R$ ${metrics.ticket.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}</strong><span>ticket médio informado</span></div></div><label className="ticket-input"><span>Ticket médio (opcional)</span><input type="number" min="0" step="0.01" value={metrics.ticket || ""} onChange={(event) => updateMetric("ticket", event.target.value)} placeholder="R$" /></label></article><article className="panel daily-panel"><div className="panel-heading"><div><span className="section-kicker">ROTINA DIÁRIA</span><h2>Feche o ciclo</h2></div><span className="daily-progress">{dailyDone.length}/4</span></div><div className="daily-list">{dailyChecks.map((check) => <label className={`daily-row ${dailyDone.includes(check.id) ? "done" : ""}`} key={check.id}><input type="checkbox" checked={dailyDone.includes(check.id)} onChange={() => toggleDaily(check.id)} /><span className="fake-checkbox">✓</span><span><strong>{check.title}</strong><small>{check.description}</small></span></label>)}</div><div className="daily-footer"><span>Consistência &gt; memória</span><div className="mini-progress"><span style={{ width: `${(dailyDone.length / dailyChecks.length) * 100}%` }} /></div></div></article></section>
            <section className="management-callout"><span className="callout-icon">↗</span><div><span className="section-kicker">VISÃO DE GESTOR</span><h2>O melhor atendimento é aquele que deixa o próximo atendimento mais fácil.</h2><p>Use as objeções, dúvidas e medidas que aparecem todos os dias para enriquecer o roteiro e o catálogo. Se uma informação não estiver confirmada, preserve a dúvida até a fonte correta.</p></div><button className="button ghost" onClick={() => navigate("catalog")}>Voltar ao catálogo <span>→</span></button></section>
          </div>
        )}
      </section>
      {toast && <div className={`toast ${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"} aria-live={toast.kind === "error" ? "assertive" : "polite"}>{toast.kind === "success" ? "✓" : toast.kind === "error" ? "!" : "i"} {toast.message}</div>}
    </main>
  );
}
