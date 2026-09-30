import {
  beginnerGlossary,
  brimakDocumentLessons,
  learningByBrand,
  materialGuide,
  measurementMethod,
  qualityMethod,
} from "./catalog-learning.mjs";
import { catalogItems } from "./catalog-items.mjs";

const names = {
  dalcomad: "Dalcomad",
  destak: "Destak",
  casmavi: "Casmavi",
  aluan: "Aluan",
  brimak: "Brimak",
  brasil: "Brasil Esquadrias",
  crv: "CRV",
  lucasa: "Lucasa",
  riobras: "Riobras",
};
const brands = Object.keys(learningByBrand);
const stages = [
  { id: "basics", label: "Comece do zero", short: "O produto" },
  { id: "materials", label: "Materiais", short: "Materiais" },
  { id: "measures", label: "Medidas", short: "Medidas" },
  { id: "quality", label: "Qualidade", short: "Qualidade" },
  { id: "practice", label: "Pratique", short: "Pratique" },
];
const storageKey = "guia-comercial-escola-v1";
const measureQuiz = {
  prompt: "Qual anotação permite conferir esse vão com segurança?",
  options: [
    "Só 90 × 211 cm, pois é a maior leitura.",
    "Todas as larguras e alturas, parede, estágio da obra e confirmação da peça escolhida.",
    "Uma medida da folha com 7 cm somados.",
  ],
  answer: 1,
  why: "As diferenças entre pontos indicam que a instalação precisa de conferência; nenhuma soma fixa define a peça.",
};

function readProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
    return {
      visited: saved.visited && typeof saved.visited === "object" ? saved.visited : {},
      completed: saved.completed && typeof saved.completed === "object" ? saved.completed : {},
    };
  } catch {
    return { visited: {}, completed: {} };
  }
}
const progress = readProgress();
const requestedBrand = new URLSearchParams(location.search).get("marca");
const state = {
  brand: brands.includes(requestedBrand) ? requestedBrand : brands[0],
  stage: "basics",
  shown: 12,
};

const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);
const e = escapeHTML;
const pdfHref = (href) => String(href).replace(/^\/catalogos\//, "./catalogos/");
function safeHref(href) {
  const url = String(href || "");
  return e(url.startsWith("/catalogos/") ? pdfHref(url) : /^https:\/\//.test(url) ? url : "#fichas");
}
const normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const list = (items, ordered = false, className = "lesson-list") => `<${ordered ? "ol" : "ul"} class="${className}">${items.map((item) => `<li>${e(item)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`;

function saveProgress() {
  try { localStorage.setItem(storageKey, JSON.stringify(progress)); } catch { /* O site continua disponível se o armazenamento estiver desativado. */ }
}
function markVisited() {
  const key = `${state.brand}:${state.stage}`;
  if (!progress.visited[key]) { progress.visited[key] = true; saveProgress(); }
  renderProgress();
}
function renderProgress() {
  const total = brands.length * stages.length;
  const studied = brands.flatMap((brand) => stages.map((stage) => `${brand}:${stage.id}`)).filter((key) => progress.visited[key]).length;
  const done = Object.keys(progress.completed).filter((key) => progress.completed[key]).length;
  const percentage = Math.round(studied / total * 100);
  document.querySelector("#progress-overview").innerHTML = `
    <span class="progress-figure">${studied}<small>/${total}</small></span>
    <span class="progress-caption"><strong>etapas visitadas</strong><span>${done} exercício${done === 1 ? "" : "s"} acertado${done === 1 ? "" : "s"}</span></span>
    <span class="progress-track" role="progressbar" aria-label="Etapas visitadas" aria-valuenow="${studied}" aria-valuemin="0" aria-valuemax="${total}"><span style="width:${percentage}%"></span></span>`;
}
function renderBrands() {
  document.querySelector("#brand-list").innerHTML = brands.map((brand, index) => `
    <button type="button" class="brand-button ${brand === state.brand ? "active" : ""}" data-brand="${brand}" aria-pressed="${brand === state.brand}">
      <span class="brand-number">${String(index + 1).padStart(2, "0")}</span>
      <span>${e(names[brand])}</span>
      <span class="brand-arrow" aria-hidden="true">↗</span>
    </button>`).join("");
}
function quizMarkup(question, id) {
  const checked = Boolean(progress.completed[id]);
  return `<form class="quiz" data-quiz="${e(id)}">
    <span class="quiz-eyebrow">TESTE SEU CONHECIMENTO ${checked ? "· ACERTADO ✓" : ""}</span>
    <fieldset><legend>${e(question.prompt)}</legend>
      ${question.options.map((option, index) => `<label class="quiz-option"><input type="radio" name="answer-${e(id)}" value="${index}" /><span>${e(option)}</span></label>`).join("")}
    </fieldset>
    <button class="button button-dark quiz-submit" type="submit" disabled>Conferir resposta <span aria-hidden="true">→</span></button>
    <div class="quiz-feedback" role="status" aria-live="polite"></div>
  </form>`;
}
function stageMarkup(guide) {
  const name = names[state.brand];
  switch (state.stage) {
    case "basics": return `
      <span class="lesson-eyebrow">ETAPA 01 · O PRODUTO</span>
      <h4 class="lesson-title" id="stage-title" tabindex="-1">Primeiro, entenda o que está comprando.</h4>
      <p class="lesson-lead">${e(guide.startingPoint)}</p>
      <div class="lesson-subsection"><h5>Faça assim</h5>
        ${list([
          "Abra uma ficha desta marca ou a fonte indicada e leia a descrição antes de olhar a foto.",
          "Identifique folha, marco, vidro e ferragens que aparecem na descrição.",
          "Separe o que o catálogo confirma do que ainda precisa perguntar.",
          "Explique com suas palavras para que ambiente a peça pode servir.",
        ], true)}
      </div>
      <p class="lesson-tip"><strong>Palavra nova?</strong> O <a href="#glossario">glossário</a> explica os termos usados nas fichas.</p>`;
    case "materials": return `
      <span class="lesson-eyebrow">ETAPA 02 · MATERIAIS</span>
      <h4 class="lesson-title" id="stage-title" tabindex="-1">Material, composição e acabamento.</h4>
      <p class="lesson-lead">Estrutura, revestimento, ferragens e vidro são informações diferentes. Leia cada campo da peça antes de dizer que um produto é melhor para um ambiente.</p>
      <div class="material-grid">${materialGuide.map((item) => `<article><h5>${e(item.name)}</h5><p>${e(item.read)}</p><p class="material-caution"><strong>Cuidado:</strong> ${e(item.avoid)}</p></article>`).join("")}</div>
      <div class="lesson-subsection"><h5>Agora aplique em ${e(name)}</h5>${list(guide.materials)}</div>
      <p class="lesson-tip"><strong>Exercício:</strong> compare dois códigos com a mesma função e anote o que muda em material, composição, acabamento e manutenção.</p>`;
    case "measures": return `
      <span class="lesson-eyebrow">ETAPA 03 · MEDIDAS</span>
      <h4 class="lesson-title" id="stage-title" tabindex="-1">Meça sem confundir produto e obra.</h4>
      <p class="lesson-lead">A medida da folha, a dimensão externa do conjunto e a abertura da parede podem ser diferentes. Registre o que foi medido e leia a convenção da ficha.</p>
      ${list(measurementMethod, true, "lesson-list measure-list")}
      <div class="brand-insight"><span>NA FICHA DE ${e(name.toUpperCase())}</span><p>${e(guide.measures)}</p></div>
      <p class="lesson-tip"><strong>Exemplo fictício:</strong> “vão acabado — largura em cima 90 cm, centro 89,8 cm, baixo 89,5 cm; alturas 211 e 210,7 cm; parede 12 cm”. Guarde todas as leituras. Este exemplo não define o tamanho da peça a encomendar.</p>
      ${quizMarkup(measureQuiz, `measures-${state.brand}`)}`;
    case "quality": return `
      <span class="lesson-eyebrow">ETAPA 04 · QUALIDADE</span>
      <h4 class="lesson-title" id="stage-title" tabindex="-1">Avalie qualidade sem adivinhar.</h4>
      <p class="lesson-lead">Uma peça adequada ao ambiente depende do modelo específico, da aplicação e da instalação. Aparência e nome da linha não substituem a ficha.</p>
      ${list(qualityMethod, true, "lesson-list measure-list")}
      <div class="brand-insight"><span>CHECKLIST DE ${e(name.toUpperCase())}</span>${list(guide.quality)}</div>`;
    case "practice": return `
      <span class="lesson-eyebrow">ETAPA 05 · PRÁTICA</span>
      <h4 class="lesson-title" id="stage-title" tabindex="-1">Resolva um atendimento.</h4>
      <p class="lesson-lead">Leia a situação, tente responder em voz alta e só então confira o raciocínio.</p>
      <div class="case-card"><span>O CASO</span><p>${e(guide.scenario)}</p></div>
      <details class="answer-details"><summary>Ver o raciocínio depois de tentar <span aria-hidden="true">+</span></summary><p>${e(guide.reasoning)}</p></details>
      ${quizMarkup(guide.quiz, `practice-${state.brand}`)}
      <p class="lesson-tip"><strong>Regra de ouro:</strong> se algum dado estiver sem resposta, marque “a confirmar” e abra a ficha do produto antes de cotar.</p>`;
    default: return "";
  }
}
function renderDocuments() {
  if (state.brand !== "brimak") return "";
  return `<section class="documents" aria-labelledby="documents-title">
    <div class="documents-heading"><div><span class="eyebrow">UM ARQUIVO POR VEZ</span><h4 id="documents-title">Cinco PDFs, cinco aulas.</h4><p>Abra o catálogo, encontre as páginas indicadas e faça o exercício antes de conferir a resposta.</p></div><span class="pdf-count">05<br /><small>PDFs</small></span></div>
    <div class="document-list">${brimakDocumentLessons.map((lesson, index) => `
      <details class="document-card"><summary><span class="document-number">${String(index + 1).padStart(2, "0")}</span><strong>${e(lesson.title)}</strong><small>${e(lesson.pages)}</small><span class="document-plus" aria-hidden="true">+</span></summary>
        <div class="document-body"><div class="document-grid">
          <div><h5>O que reconhecer</h5><p>${e(lesson.learn)}</p></div>
          <div><h5>Medidas</h5><p>${e(lesson.measurements)}</p></div>
          <div><h5>Qualidade da peça</h5><p>${e(lesson.inspect)}</p></div>
          <div><h5>Exercício no PDF</h5><p>${e(lesson.task)}</p></div>
        </div><a class="document-link" href="${safeHref(lesson.href)}" target="_blank" rel="noopener noreferrer">Abrir ${e(lesson.title)} em PDF <span aria-hidden="true">↗</span></a>
        ${quizMarkup(lesson.quiz, `document-${index}`)}
        </div></details>`).join("")}</div>
  </section>`;
}
function renderGuide({ focus = false } = {}) {
  markVisited();
  const guide = learningByBrand[state.brand];
  const stageIndex = stages.findIndex((stage) => stage.id === state.stage);
  const visited = stages.filter((stage) => progress.visited[`${state.brand}:${stage.id}`]).length;
  document.querySelector("#guide").innerHTML = `
    <div class="guide-head"><div><span class="eyebrow">${e(names[state.brand].toUpperCase())} · GUIA PARA INICIANTES</span><h3 tabindex="-1">${e(guide.title)}</h3><p>Reconheça a peça, leia a ficha, confira medidas e explique sua escolha. Faça as etapas na ordem ou retome de onde parou.</p></div><div class="brand-progress"><strong>${visited}/5</strong><span>etapas visitadas</span></div></div>
    <nav class="stage-nav" aria-label="Etapas de ${e(names[state.brand])}">${stages.map((stage, index) => `
      <button type="button" data-stage="${stage.id}" class="stage-button ${state.stage === stage.id ? "active" : ""}" aria-current="${state.stage === stage.id ? "step" : "false"}"><span class="stage-number">${progress.visited[`${state.brand}:${stage.id}`] && state.stage !== stage.id ? "✓" : String(index + 1).padStart(2, "0")}</span><span>${e(stage.short)}</span></button>`).join("")}</nav>
    <div class="lesson-body">${stageMarkup(guide)}
      <div class="lesson-bottom">${stageIndex < stages.length - 1 ? `<button class="button button-primary" type="button" data-stage="${stages[stageIndex + 1].id}">Próxima: ${e(stages[stageIndex + 1].label)} <span aria-hidden="true">→</span></button>` : `<a class="button button-primary" href="#fichas">Consultar fichas <span aria-hidden="true">→</span></a>`}
        <span>Etapa ${stageIndex + 1} de 5</span></div>
    </div>
    <div class="guide-footer"><a href="${safeHref(guide.source.href)}" target="_blank" rel="noopener noreferrer">Conferir fonte: ${e(guide.source.label)} <span aria-hidden="true">↗</span></a><a href="#fichas">Ver fichas desta marca ↓</a></div>
    ${renderDocuments()}`;
  if (focus) document.querySelector("#stage-title")?.focus({ preventScroll: true });
}
function setupCatalog() {
  const brandSelect = document.querySelector("#catalog-brand");
  brandSelect.innerHTML = `<option value="all">Todas as marcas</option>${brands.map((brand) => `<option value="${brand}">${e(names[brand])}</option>`).join("")}`;
  brandSelect.value = state.brand;
  renderFamilyOptions();
  renderCatalog();
}
function renderFamilyOptions() {
  const brand = document.querySelector("#catalog-brand").value;
  const familySelect = document.querySelector("#catalog-family");
  const previous = familySelect.value;
  const families = [...new Set(catalogItems.filter((item) => brand === "all" || item.brand === brand).map((item) => item.family))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  familySelect.innerHTML = `<option value="all">Todas as famílias</option>${families.map((family) => `<option value="${e(family)}">${e(family)}</option>`).join("")}`;
  familySelect.value = families.includes(previous) ? previous : "all";
}
function catalogCard(item) {
  return `<article class="catalog-card"><div class="card-top"><span>${e(names[item.brand] || item.brand)}</span><span>${e(item.family)}</span></div>
    <h3>${e(item.title)}</h3>${item.code ? `<p class="card-code">${e(item.code)}</p>` : ""}
    <p class="card-spec">${e(item.spec)}</p>
    <div class="card-best"><strong>Onde faz sentido</strong><p>${e(item.bestFor)}</p></div>
    <details class="card-details"><summary>Argumento e pontos a conferir <span aria-hidden="true">+</span></summary>
      <p><strong>Como explicar:</strong> ${e(item.pitch)}</p><strong>Confirme antes de cotar</strong>${list(item.checks, false, "check-list")}
      <small>Referência: ${e(item.source)}</small>${item.documentHref ? `<a href="${safeHref(item.documentHref)}" target="_blank" rel="noopener noreferrer">Abrir PDF da linha ↗</a>` : ""}
    </details></article>`;
}
function renderCatalog() {
  const brand = document.querySelector("#catalog-brand").value;
  const family = document.querySelector("#catalog-family").value;
  const query = normalize(document.querySelector("#catalog-search").value.trim());
  const results = catalogItems.filter((item) => {
    if (brand !== "all" && item.brand !== brand) return false;
    if (family !== "all" && item.family !== family) return false;
    return !query || normalize([names[item.brand], item.family, item.title, item.code, item.spec, item.bestFor, item.checks.join(" ")].join(" ")).includes(query);
  });
  const shown = results.slice(0, state.shown);
  document.querySelector("#catalog-total").textContent = `${results.length} ficha${results.length === 1 ? "" : "s"} encontrada${results.length === 1 ? "" : "s"}${results.length > shown.length ? ` · mostrando ${shown.length}` : ""}`;
  document.querySelector("#catalog-grid").innerHTML = results.length ? shown.map(catalogCard).join("") : `<p class="empty-state">Nenhuma ficha corresponde à busca. Tente outra palavra ou selecione “Todas as marcas”.</p>`;
  document.querySelector("#load-more").hidden = results.length <= state.shown;
}
function renderGlossary() {
  document.querySelector("#glossary-items").innerHTML = beginnerGlossary.map((item, index) => `<details class="glossary-item"><summary><span class="glossary-index">${String(index + 1).padStart(2, "0")}</span><strong>${e(item.term)}</strong><span aria-hidden="true">+</span></summary><p>${e(item.meaning)}</p></details>`).join("");
}

document.querySelector("#intro-stats").innerHTML = `
  <span><strong>${brands.length}</strong><small>marcas</small></span>
  <span><strong>${catalogItems.length}</strong><small>fichas</small></span>
  <span><strong>${brimakDocumentLessons.length}</strong><small>PDFs Brimak</small></span>`;
renderBrands();
renderGuide();
setupCatalog();
renderGlossary();

document.querySelector("#brand-list").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-brand]");
  if (!button) return;
  state.brand = button.dataset.brand;
  state.stage = "basics";
  state.shown = 12;
  const url = new URL(location.href);
  url.searchParams.set("marca", state.brand);
  history.replaceState(null, "", url);
  renderBrands();
  renderGuide();
  document.querySelector("#catalog-brand").value = state.brand;
  document.querySelector("#catalog-search").value = "";
  renderFamilyOptions();
  renderCatalog();
  document.querySelector("#guide h3")?.focus({ preventScroll: true });
});
document.querySelector("#guide").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-stage]");
  if (!button) return;
  state.stage = button.dataset.stage;
  renderGuide({ focus: true });
});
document.querySelector("#guide").addEventListener("change", (event) => {
  if (event.target.matches(".quiz input[type=radio]")) {
    const form = event.target.closest(".quiz");
    form.querySelector(".quiz-submit").disabled = false;
    form.querySelector(".quiz-feedback").textContent = "";
    form.querySelectorAll(".quiz-option").forEach((label) => label.classList.toggle("selected", label.contains(event.target)));
  }
});
document.querySelector("#guide").addEventListener("submit", (event) => {
  if (!event.target.matches(".quiz")) return;
  event.preventDefault();
  const form = event.target;
  const answer = form.querySelector("input:checked");
  if (!answer) return;
  const id = form.dataset.quiz;
  const question = id.startsWith("document-") ? brimakDocumentLessons[Number(id.slice(9))]?.quiz : id.startsWith("measures-") ? measureQuiz : learningByBrand[state.brand].quiz;
  if (!question) return;
  const correct = Number(answer.value) === question.answer;
  const feedback = form.querySelector(".quiz-feedback");
  feedback.className = `quiz-feedback ${correct ? "correct" : "review"}`;
  feedback.textContent = `${correct ? "Correto. " : `Revise: ${question.options[question.answer]} `}${question.why}`;
  if (correct && !progress.completed[id]) {
    progress.completed[id] = true;
    saveProgress();
    form.querySelector(".quiz-eyebrow").textContent = "TESTE SEU CONHECIMENTO · ACERTADO ✓";
    renderProgress();
  }
});
document.querySelector("#catalog-search").addEventListener("input", () => { state.shown = 12; renderCatalog(); });
document.querySelector("#catalog-brand").addEventListener("change", () => { state.shown = 12; renderFamilyOptions(); renderCatalog(); });
document.querySelector("#catalog-family").addEventListener("change", () => { state.shown = 12; renderCatalog(); });
document.querySelector("#load-more").addEventListener("click", () => { state.shown += 12; renderCatalog(); });
