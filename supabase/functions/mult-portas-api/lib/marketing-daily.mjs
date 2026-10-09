/** @typedef {'newContacts' | 'interacting' | 'notInteracting' | 'phone' | 'inPerson' | 'inPersonExisting'} MarketingCounter */
/** @typedef {{ date: string, seller: string, newContacts: number, interacting: number, notInteracting: number, phone: number, inPerson: number, inPersonExisting: number }} MarketingDay */
/** @typedef {{ days: MarketingDay[] }} MarketingDailyState */

export const MARKETING_HISTORY_LIMIT = 366;
export const MAX_MARKETING_COUNT = 1_000_000;
export const MARKETING_TIME_ZONE = "America/Sao_Paulo";

/** @type {{ id: MarketingCounter, label: string, description: string, reportLabel: string }[]} */
export const marketingCounters = [
  { id: "newContacts", label: "Contatos novos total", description: "Clientes novos que entraram na plataforma hoje.", reportLabel: "Contatos novos total" },
  { id: "interacting", label: "Contatos interagindo", description: "Clientes que estão respondendo à conversa.", reportLabel: "Contatos interagindo" },
  { id: "notInteracting", label: "Contatos não interagindo", description: "Clientes que ainda não responderam.", reportLabel: "Contatos ñ interagindo" },
  { id: "phone", label: "Contatos via fone", description: "Atendimentos realizados por telefone.", reportLabel: "Contatos via fone" },
  { id: "inPerson", label: "Atendimentos presenciais novos", description: "Novos clientes atendidos pessoalmente.", reportLabel: "Atendimentos presencial novos" },
  { id: "inPersonExisting", label: "Atendimentos presenciais já cliente", description: "Clientes que já compraram e foram atendidos pessoalmente.", reportLabel: "Atendimentos presencial já cliente" },
];

/** @param {Date} [now] */
export function marketingDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MARKETING_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** @param {unknown} value */
function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T12:00:00Z`))
    && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

/** @param {unknown} value */
export function normalizeMarketingCount(value) {
  if (typeof value !== "number" && typeof value !== "string") return 0;
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(0, Math.min(MAX_MARKETING_COUNT, Math.floor(count))) : 0;
}

/** @param {unknown} value */
function sellerName(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 80) : "";
}

/** @param {string} date @param {string} seller @returns {MarketingDay} */
export function emptyMarketingDay(date, seller) {
  if (!validDate(date)) throw new Error("Data do marketing diário inválida.");
  return { date, seller: sellerName(seller), newContacts: 0, interacting: 0, notInteracting: 0, phone: 0, inPerson: 0, inPersonExisting: 0 };
}

/** @param {unknown} value @returns {MarketingDailyState} */
export function normalizeMarketingDaily(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.days)) return { days: [] };
  const seen = new Set();
  const days = value.days.slice(0, 1_000).flatMap((raw) => {
    if (!raw || typeof raw !== "object" || !validDate(raw.date) || seen.has(raw.date)) return [];
    seen.add(raw.date);
    const day = emptyMarketingDay(raw.date, sellerName(raw.seller));
    for (const { id } of marketingCounters) day[id] = normalizeMarketingCount(raw[id]);
    return [day];
  }).sort((a, b) => b.date.localeCompare(a.date)).slice(0, MARKETING_HISTORY_LIMIT);
  return { days };
}

function firstMarketingDays(value) {
  const result = new Map();
  if (!value || typeof value !== "object" || !Array.isArray(value.days)) return result;
  for (const day of value.days.slice(0, 1_000)) {
    if (day && typeof day === "object" && validDate(day.date) && !result.has(day.date)) result.set(day.date, day);
  }
  return result;
}

/** Detect a five-counter browser before normalization fills in the sixth zero.
 * @param {unknown} value */
export function hasLegacyMarketingDays(value) {
  return [...firstMarketingDays(value).values()].some((day) => !Object.hasOwn(day, "inPersonExisting"));
}

/** Preserve only the omitted sixth counter for dates included by an old browser.
 * Explicit zeros and removing a date remain intentional updates.
 * @param {unknown} incoming
 * @param {unknown} saved
 * @returns {MarketingDailyState} */
export function preserveLegacyMarketingCounts(incoming, saved) {
  const rawDays = firstMarketingDays(incoming);
  const savedDays = new Map(normalizeMarketingDaily(saved).days.map((day) => [day.date, day]));
  return { days: normalizeMarketingDaily(incoming).days.map((day) => {
    const raw = rawDays.get(day.date);
    const previous = savedDays.get(day.date);
    return previous && raw && !Object.hasOwn(raw, "inPersonExisting")
      ? { ...day, inPersonExisting: previous.inPersonExisting }
      : day;
  }) };
}

/** @param {MarketingDailyState} state @param {string} date @param {string} seller @returns {MarketingDay} */
export function getMarketingDay(state, date, seller) {
  return normalizeMarketingDaily(state).days.find((day) => day.date === date) ?? emptyMarketingDay(date, seller);
}

/** @param {MarketingDailyState} state @param {string} date @param {string} seller @param {MarketingCounter} field @param {unknown} value @returns {MarketingDailyState} */
export function setMarketingCount(state, date, seller, field, value) {
  const current = normalizeMarketingDaily(state);
  if (!marketingCounters.some(({ id }) => id === field)) return current;
  const day = { ...getMarketingDay(current, date, seller), [field]: normalizeMarketingCount(value) };
  return normalizeMarketingDaily({ days: [day, ...current.days.filter((item) => item.date !== date)] });
}

/** @param {MarketingDailyState} state @param {string} date @param {string} seller @returns {MarketingDailyState} */
export function resetMarketingDay(state, date, seller) {
  const current = normalizeMarketingDaily(state);
  return normalizeMarketingDaily({ days: [emptyMarketingDay(date, seller), ...current.days.filter((day) => day.date !== date)] });
}

/** @param {string} date */
export function formatMarketingDate(date) {
  if (!validDate(date)) return "";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00Z`));
}

/** @param {MarketingDay} day */
export function buildMarketingReport(day) {
  return [
    `Vendedora: ${sellerName(day.seller).toLocaleUpperCase("pt-BR")}`,
    "PLATAFORMA",
    ...marketingCounters.map(({ id, reportLabel }) => `${reportLabel}: ${normalizeMarketingCount(day[id])}`),
  ].join("\n");
}
