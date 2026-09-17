const PENDING_VALUE = "A confirmar";

/** @type {ReadonlyArray<Readonly<{ line: string, finish: string, color: string, swatch: string }>>} */
export const dalcomadKitCombinations = Object.freeze([
  Object.freeze({ line: "ECO", finish: "PET/PVC TX", color: "CINZA URBAN", swatch: "#596367" }),
  Object.freeze({ line: "ECO", finish: "PET/PVC TX", color: "BRANCO DIAMANTE", swatch: "#f2f3ef" }),
  Object.freeze({ line: "ECO", finish: "PET/PVC TX", color: "CURUPIXA", swatch: "#b8753f" }),
  Object.freeze({ line: "STANDART", finish: "MELAMÍNICO", color: "UNI WHITE", swatch: "#ecece6" }),
  Object.freeze({ line: "STANDART", finish: "MELAMÍNICO", color: "FREIJO", swatch: "#806248" }),
  Object.freeze({ line: "STANDART", finish: "MELAMÍNICO", color: "CURUPIXA", swatch: "#ad6d3c" }),
  Object.freeze({ line: "SENSE", finish: "RENOLIT", color: "BLACK SP", swatch: "#252628" }),
  Object.freeze({ line: "SENSE", finish: "RENOLIT", color: "CINZA GREY", swatch: "#a8acae" }),
  Object.freeze({ line: "SENSE", finish: "RENOLIT", color: "BRANCO POLAR", swatch: "#f4f3ed" }),
  Object.freeze({ line: "SENSE", finish: "RENOLIT", color: "SIRUS CREAM", swatch: "#d4d0c5" }),
]);

export const dalcomadKitFillings = Object.freeze(["BOONDOOR", "COLMÉIA"]);
export const dalcomadKitRequadros = Object.freeze(["11CM", "14CM", "16CM", "18CM", "20CM"]);

/**
 * @param {"line" | "finish" | "color"} key
 * @returns {string[]}
 */
export function uniqueDalcomadKitValues(key) {
  return Array.from(new Set(dalcomadKitCombinations.map((item) => item[key])));
}

export const dalcomadKitLines = Object.freeze(uniqueDalcomadKitValues("line"));
export const dalcomadKitFinishes = Object.freeze(uniqueDalcomadKitValues("finish"));
export const dalcomadKitColors = Object.freeze(uniqueDalcomadKitValues("color"));
export const dalcomadKitSwatches = Object.freeze(Object.fromEntries(dalcomadKitCombinations.map((item) => [`${item.line}|${item.color}`, item.swatch])));

/** @param {string} line @param {string} color */
export function getDalcomadKitSwatch(line, color) {
  return dalcomadKitSwatches[`${line}|${color}`]
    ?? dalcomadKitCombinations.find((item) => item.color === color)?.swatch
    ?? "transparent";
}

/**
 * Converts a manually entered Brazilian price into a safe spreadsheet number.
 * Blank values remain blank and malformed or negative values return null.
 * @param {unknown} value
 * @returns {number | "" | null}
 */
export function parseDalcomadKitPrice(value) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string") return null;
  const compact = value.trim().replace(/^R\$\s*/i, "").replace(/[\s\u00a0]/g, "");
  if (!compact) return "";
  if (!/^[0-9.,]+$/.test(compact)) return null;

  let normalized = compact;
  if (compact.includes(",")) {
    if (!/^\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?$/.test(compact) && !/^\d+(?:,\d{1,2})?$/.test(compact)) return null;
    normalized = compact.replace(/\./g, "").replace(",", ".");
  } else if ((compact.match(/\./g) ?? []).length > 1) {
    if (!/^\d{1,3}(?:\.\d{3})+$/.test(compact)) return null;
    normalized = compact.replace(/\./g, "");
  } else if (/^\d{1,3}\.\d{3}$/.test(compact)) {
    normalized = compact.replace(".", "");
  } else if (!/^\d+(?:\.\d{1,2})?$/.test(compact)) {
    return null;
  }

  const numeric = Number(normalized);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

/**
 * @param {"line" | "finish" | "color"} key
 * @param {{ line?: string, finish?: string }} selection
 * @returns {string[]}
 */
export function availableDalcomadKitValues(key, selection = {}) {
  const matches = dalcomadKitCombinations.filter((item) => {
    const lineMatches = key === "line" || !selection.line || selection.line === PENDING_VALUE || item.line === selection.line;
    const finishMatches = key !== "color" || !selection.finish || selection.finish === PENDING_VALUE || item.finish === selection.finish;
    return lineMatches && finishMatches;
  });
  return Array.from(new Set(matches.map((item) => item[key])));
}

/** @param {{ line?: string, finish?: string, color?: string }} selection */
export function isKnownDalcomadKitCombination(selection) {
  return dalcomadKitCombinations.some((item) => (
    (!selection.line || selection.line === PENDING_VALUE || item.line === selection.line)
    && (!selection.finish || selection.finish === PENDING_VALUE || item.finish === selection.finish)
    && (!selection.color || selection.color === PENDING_VALUE || item.color === selection.color)
  ));
}

function normalizedText(value) {
  return typeof value === "string" ? value.trim().toLocaleUpperCase("pt-BR") : "";
}

/** @param {unknown} value */
export function isEligibleDalcomadKitItem(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = /** @type {Record<string, unknown>} */ (value);
  const manufacturer = normalizedText(item.manufacturer);
  const description = normalizedText(item.description);
  const opening = normalizedText(item.opening);
  return (!manufacturer || manufacturer === "DALCOMAD")
    && ["KIT PORTA", "KIT PORTA PRONTA", "KIT DE PORTA"].includes(description)
    && (!opening || opening === "ABRIR");
}

function allowedValue(value, options, aliases = {}) {
  const normalized = normalizedText(value);
  const resolved = aliases[normalized] ?? normalized;
  return resolved === "A CONFIRMAR" ? PENDING_VALUE : options.includes(resolved) ? resolved : "";
}

/**
 * Migrates earlier spellings and generic color names to the labels shown on
 * the Dalcomad sample boards supplied for this request.
 * @param {{ line?: string, finish?: string, color?: string }} selection
 * @param {{ finish?: string, color?: string }} legacy
 */
export function normalizeDalcomadKitSelection(selection = {}, legacy = {}) {
  const line = allowedValue(selection.line, dalcomadKitLines, {
    STANDER: "STANDART",
    STANDARD: "STANDART",
    SENCE: "SENSE",
  });
  const expectedFinish = line && line !== PENDING_VALUE
    ? dalcomadKitCombinations.find((item) => item.line === line)?.finish ?? ""
    : "";
  const finish = expectedFinish || allowedValue(selection.finish || legacy.finish, dalcomadKitFinishes, {
    PET: "PET/PVC TX",
    "PET/PVC": "PET/PVC TX",
    "PET PVC TX": "PET/PVC TX",
    MELAMINICO: "MELAMÍNICO",
  });
  const rawColor = normalizedText(selection.color || legacy.color);
  const whiteByLine = line === "STANDART" ? "UNI WHITE" : line === "SENSE" ? "BRANCO POLAR" : "BRANCO DIAMANTE";
  const color = allowedValue(rawColor, dalcomadKitColors, {
    BRANCO: whiteByLine,
    "BRANCO TX": whiteByLine,
    PRETO: "BLACK SP",
    "UNI WHITE (BRANCO)": "UNI WHITE",
    "FREIJÓ": "FREIJO",
    "CURUPIXÁ": "CURUPIXA",
    "CIRUS CREAM": "SIRUS CREAM",
  });
  const colorMatchesLine = !line || line === PENDING_VALUE || !color || color === PENDING_VALUE || dalcomadKitCombinations.some((item) => item.line === line && item.color === color);

  return {
    line,
    finish,
    color: colorMatchesLine ? color : "",
  };
}
