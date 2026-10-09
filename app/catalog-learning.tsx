"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { sharedApiBaseUrl } from "./lib/shared-api-config.mjs";
import { CLIENT_PROGRESS_EVENT } from "./lib/client-progress.mjs";
import { beginnerGlossary, brimakDocumentLessons, learningByBrand, materialGuide, measurementMethod, measurementTypes, qualityMethod, readingChecklist } from "./lib/catalog-learning.mjs";

type Brand = keyof typeof learningByBrand;
type Question = { prompt: string; options: string[]; answer: number; why: string };
type Stage = "basics" | "materials" | "measures" | "quality" | "practice";
type LearningProgress = { stage: Stage; answers: Record<string, number> };
type StudyField = "product" | "use" | "composition" | "measure" | "pending";
type StudySheet = Record<StudyField, string>;

const emptySheet: StudySheet = { product: "", use: "", composition: "", measure: "", pending: "" };
const studyFields: { id: StudyField; label: string; hint: string; example: string }[] = [
  { id: "product", label: "Qual peça você escolheu?", hint: "Copie a marca, a linha, o código e onde achou a informação.", example: "Ex.: nome da linha, código e página ou link da ficha" },
  { id: "use", label: "Para qual uso?", hint: "Anote cômodo, exposição à água/sol e tipo de abertura necessário.", example: "Ex.: quarto interno; porta de giro; sentido ainda a confirmar" },
  { id: "composition", label: "Do que ela é feita e o que acompanha?", hint: "Separe estrutura, revestimento, vidro, ferragens e itens opcionais.", example: "Ex.: material informado na ficha; vidro e fechadura a confirmar" },
  { id: "measure", label: "Quais medidas você tem?", hint: "Escreva unidade e origem de cada medida: folha, conjunto, vão e passagem livre.", example: "Ex.: vão medido em três pontos; dimensão do produto na tabela" },
  { id: "pending", label: "O que falta confirmar antes de cotar?", hint: "Liste folgas, lado, instalação, acabamento, disponibilidade ou dados ausentes.", example: "Ex.: instrução de instalação e lado pela convenção da marca" },
];

const stages: { id: Stage; label: string; summary: string }[] = [
  { id: "basics", label: "Comece do zero", summary: "Reconheça as partes" },
  { id: "materials", label: "Materiais", summary: "Entenda a composição" },
  { id: "measures", label: "Medidas", summary: "Separe obra e produto" },
  { id: "quality", label: "Qualidade", summary: "Confira a ficha" },
  { id: "practice", label: "Pratique", summary: "Resolva um caso" },
];

function progressStorageKey(userId: number, brand: Brand) {
  return `${sharedApiBaseUrl ? "mult-portas-shared" : "mult-portas-guia"}-learning-v1-user-${userId}-brand-${brand}`;
}

function sheetStorageKey(userId: number, brand: Brand) {
  return `${sharedApiBaseUrl ? "mult-portas-shared" : "mult-portas-guia"}-study-sheet-v1-user-${userId}-brand-${brand}`;
}

function readStudySheet(key: string, sharedValue?: unknown): StudySheet {
  try {
    const stored: unknown = sharedValue ?? JSON.parse(localStorage.getItem(key) ?? "null");
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return { ...emptySheet };
    return Object.fromEntries(studyFields.map(({ id }) => [id, typeof (stored as Record<string, unknown>)[id] === "string" ? String((stored as Record<string, unknown>)[id]).slice(0, 1000) : ""])) as StudySheet;
  } catch {
    return { ...emptySheet };
  }
}

function pagesAssetHref(href: string) {
  const isGithubPages = (import.meta.env as { VITE_GITHUB_PAGES?: string } | undefined)?.VITE_GITHUB_PAGES === "true";
  return href.startsWith("/catalogos/") && isGithubPages
    ? `/guia-comercial-mult-portas${href}`
    : href;
}

function readProgress(key: string, brand: Brand, sharedValue?: unknown): LearningProgress {
  const empty: LearningProgress = { stage: "basics", answers: {} };
  try {
    const parsed: unknown = sharedValue ?? JSON.parse(localStorage.getItem(key) ?? "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return empty;
    const record = parsed as { stage?: unknown; answers?: unknown };
    const stage = stages.some((item) => item.id === record.stage) ? record.stage as Stage : "basics";
    const validIds = new Set(["measures", "brand", ...(brand === "brimak" ? brimakDocumentLessons.map((lesson) => `document:${lesson.href}`) : [])]);
    const answers: Record<string, number> = {};
    if (record.answers && typeof record.answers === "object" && !Array.isArray(record.answers)) {
      for (const [id, choice] of Object.entries(record.answers)) {
        if (validIds.has(id) && Number.isInteger(choice) && Number(choice) >= 0 && Number(choice) <= 2) answers[id] = Number(choice);
      }
    }
    return { stage, answers };
  } catch {
    return empty;
  }
}

function DoorAnatomy() {
  return (
    <figure className="learning-anatomy" aria-labelledby="learning-anatomy-title">
      <figcaption className="learning-anatomy-heading">
        <span className="section-kicker">ANTES DE ABRIR O CATÁLOGO</span>
        <strong id="learning-anatomy-title">Quatro partes e medidas que você precisa separar</strong>
        <span>Esquema ilustrativo, sem escala: o tamanho da peça e a folga de instalação dependem da ficha do modelo.</span>
      </figcaption>
      <div className="learning-anatomy-visuals" aria-hidden="true">
        <div className="learning-anatomy-front">
          <span className="learning-anatomy-wall-label">Vão acabado na parede</span>
          <div className="learning-anatomy-opening">
            <div className="learning-anatomy-frame">
              <span className="learning-anatomy-frame-label">Marco ou batente</span>
              <div className="learning-anatomy-leaf"><span>Folha</span></div>
            </div>
          </div>
        </div>
        <div className="learning-anatomy-passage">
          <span className="learning-anatomy-passage-label">Com a folha aberta</span>
          <div className="learning-anatomy-passage-opening">
            <span className="learning-anatomy-open-leaf">Folha</span>
            <span className="learning-anatomy-free-space">Vão livre de passagem</span>
          </div>
        </div>
      </div>
      <dl className="learning-anatomy-terms">
        <div><dt>Vão acabado</dt><dd>A abertura da parede após piso e revestimentos previstos.</dd></div>
        <div><dt>Marco ou batente</dt><dd>A estrutura fixada no vão que recebe a folha.</dd></div>
        <div><dt>Folha</dt><dd>A parte móvel que abre ou corre.</dd></div>
        <div><dt>Vão livre</dt><dd>O espaço de passagem quando a porta está aberta.</dd></div>
      </dl>
    </figure>
  );
}

function KnowledgeCheck({ question, savedChoice, onCheck }: { question: Question; savedChoice?: number; onCheck: (choice: number) => void }) {
  const [choice, setChoice] = useState<number | null>(savedChoice ?? null);
  const [revealed, setRevealed] = useState(savedChoice !== undefined);
  const correct = choice === question.answer;

  return (
    <div className="learning-quiz">
      <fieldset>
        <legend>{question.prompt}</legend>
        {question.options.map((option, index) => (
          <label key={option} className={choice === index ? "chosen" : ""}>
            <input type="radio" name={`quiz-${question.prompt}`} checked={choice === index} onChange={() => { setChoice(index); setRevealed(false); }} />
            <span>{option}</span>
          </label>
        ))}
      </fieldset>
      <button type="button" className="learning-action" disabled={choice === null} onClick={() => { if (choice !== null) { setRevealed(true); onCheck(choice); } }}>Conferir resposta</button>
      {revealed && <p className={`learning-feedback ${correct ? "correct" : "review"}`} role="status">{correct ? "Correto. " : `Revise: ${question.options[question.answer]} `}{question.why}</p>}
    </div>
  );
}

function FichesLink({ children, onOpenFiches }: { children: ReactNode; onOpenFiches?: () => void }) {
  return onOpenFiches
    ? <button type="button" className="learning-inline-link" onClick={onOpenFiches}>{children}</button>
    : <a href="#catalog-results">{children}</a>;
}

export function CatalogLearning({ brand, brandName, userId, initialProgress, onOpenFiches }: { brand: Brand; brandName: string; userId: number; initialProgress?: { learning?: unknown; studySheet?: unknown }; onOpenFiches?: () => void }) {
  const storageKey = progressStorageKey(userId, brand);
  const sheetKey = sheetStorageKey(userId, brand);
  const [startingProgress] = useState(() => readProgress(storageKey, brand, initialProgress?.learning));
  const [stage, setStage] = useState<Stage>(startingProgress.stage);
  const [answers, setAnswers] = useState<Record<string, number>>(startingProgress.answers);
  const [sheet, setSheet] = useState<StudySheet>(() => readStudySheet(sheetKey, initialProgress?.studySheet));
  const savedProgressRef = useRef(JSON.stringify(startingProgress));
  const savedSheetRef = useRef(JSON.stringify(sheet));
  const [hasNavigated, setHasNavigated] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const guide = learningByBrand[brand];
  const stageIndex = stages.findIndex((item) => item.id === stage);
  const measuresQuestion: Question = { prompt: "Qual anotação permite conferir esse vão com segurança?", options: ["Só 90 × 211 cm, pois é a maior leitura.", "Todas as larguras e alturas, parede, estágio da obra e confirmação da peça escolhida.", "Uma medida da folha com 7 cm somados."], answer: 1, why: "As diferenças entre pontos indicam que a instalação precisa de conferência; nenhuma soma fixa define a peça." };
  const correctAnswers = Number(answers.measures === measuresQuestion.answer)
    + Number(answers.brand === guide.quiz.answer)
    + (brand === "brimak" ? brimakDocumentLessons.filter((lesson) => answers[`document:${lesson.href}`] === lesson.quiz.answer).length : 0);
  const questionCount = brand === "brimak" ? 2 + brimakDocumentLessons.length : 2;

  useEffect(() => {
    const serialized = JSON.stringify({ stage, answers } satisfies LearningProgress);
    if (serialized === savedProgressRef.current) return;
    savedProgressRef.current = serialized;
    try {
      localStorage.setItem(storageKey, serialized);
    } catch {
      // The lesson still works when this browser does not allow local storage.
    }
    if (sharedApiBaseUrl) window.dispatchEvent(new CustomEvent(CLIENT_PROGRESS_EVENT, { detail: { userId, brand, field: "learning", value: { stage, answers } } }));
  }, [storageKey, stage, answers, userId, brand]);

  useEffect(() => {
    const serialized = JSON.stringify(sheet);
    if (serialized === savedSheetRef.current) return;
    savedSheetRef.current = serialized;
    try {
      localStorage.setItem(sheetKey, serialized);
    } catch {
      // Keep the editable sheet available for this session when storage is blocked.
    }
    if (sharedApiBaseUrl) window.dispatchEvent(new CustomEvent(CLIENT_PROGRESS_EVENT, { detail: { userId, brand, field: "studySheet", value: sheet } }));
  }, [sheetKey, sheet, userId, brand]);

  useEffect(() => { if (hasNavigated) headingRef.current?.focus(); }, [stage, hasNavigated]);

  function navigateStage(next: Stage) {
    setHasNavigated(true);
    setStage(next);
  }

  function saveAnswer(id: string, choice: number) {
    setAnswers((current) => ({ ...current, [id]: choice }));
  }

  function updateSheet(id: StudyField, value: string) {
    setSheet((current) => ({ ...current, [id]: value }));
  }

  return (
    <section className="catalog-learning panel" aria-labelledby="catalog-learning-title">
      <div className="learning-header">
        <div><span className="section-kicker">GUIA PARA QUEM ESTÁ COMEÇANDO</span><h2 id="catalog-learning-title">{guide.title}</h2><p>Escolha uma peça da marca e aprenda a entender o que é, de que é feita, qual a medida e o que falta confirmar. Você pode voltar a qualquer etapa.</p></div>
        <span className="learning-duration">5 etapas curtas</span>
      </div>

      <div className="learning-overview" aria-label="Seu caminho de estudo nesta marca">
        <div><span>ETAPA ATUAL</span><strong>{stageIndex + 1} de {stages.length}</strong><small>{stages[stageIndex].label}</small></div>
        <div><span>PARA PRATICAR</span><strong>{correctAnswers} de {questionCount}</strong><small>respostas certas nesta marca</small></div>
        <p>Abra uma ficha enquanto estuda. A ficha de estudo da última etapa guarda suas anotações neste navegador, separadas para cada login e marca.</p>
      </div>
      <div className="catalog-lesson-layout">
        <div className="catalog-lesson-rail"><p className="learning-stage-help" id="learning-stage-help">Comece pela etapa 1 ou escolha o assunto que precisa revisar.</p>
          <nav className="learning-stage-nav" aria-label={`Etapas de estudo de ${brandName}`} aria-describedby="learning-stage-help">
            {stages.map((item, index) => <button type="button" key={item.id} className={stage === item.id ? "active" : ""} aria-current={stage === item.id ? "step" : undefined} aria-controls="learning-stage-panel" onClick={() => navigateStage(item.id)}><span className="learning-stage-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><span className="learning-stage-copy"><strong>{item.label}</strong><small>{item.summary}</small></span></button>)}
          </nav>
        </div>
        <div className="catalog-lesson-body"><div className="learning-stage-content" id="learning-stage-panel" key={stage}>
        {stage === "basics" && <>
          <h3 ref={headingRef} tabIndex={-1}>Primeiro entenda o que está comprando</h3>
          <p className="learning-lead">{guide.startingPoint}</p>
          <DoorAnatomy />
          <div className="learning-route">
            <div className="learning-route-heading"><span className="section-kicker">LEIA UMA FICHA DE VERDADE</span><h4>Roteiro para qualquer produto</h4><p>Abra <FichesLink onOpenFiches={onOpenFiches}>uma ficha da marca</FichesLink> ou <a href={pagesAssetHref(guide.source.href)} target="_blank" rel="noreferrer">a fonte indicada</a>. Em cada passo, procure uma informação escrita. Se não estiver lá, anote “a confirmar”.</p></div>
            <ol>{readingChecklist.map((item) => <li key={item.name}><strong>{item.name}</strong><span>{item.prompt}</span></li>)}</ol>
          </div>
          <div className="learning-decision"><strong>Teste rápido</strong><p>Se a foto mostra uma porta de madeira, ela é maciça? Você ainda não sabe: leia núcleo e revestimento na descrição do código.</p></div>
          <details className="learning-glossary"><summary>Glossário essencial: {beginnerGlossary.length} termos para começar</summary><dl>{beginnerGlossary.map((item) => <div key={item.term}><dt>{item.term}</dt><dd>{item.meaning}</dd></div>)}</dl></details>
        </>}
        {stage === "materials" && <>
          <h3 ref={headingRef} tabIndex={-1}>Material, composição e acabamento</h3>
          <p className="learning-lead">Uma porta tem camadas e peças. “Material” pode indicar apenas a estrutura; acabamento, vidro, batente e ferragens precisam ser conferidos à parte.</p>
          <div className="learning-material-grid">{materialGuide.map((item) => <article key={item.name}><h4>{item.name}</h4><div className="learning-note-grid"><div><strong>O que procurar</strong><p>{item.read}</p></div><div><strong>Não conclua pela foto</strong><p>{item.avoid}</p></div></div><small><strong>Pergunte:</strong> {item.ask}</small></article>)}</div>
          <div className="learning-decision"><strong>Comparação justa</strong><p>Compare duas peças com a mesma função e medidas adequadas à obra. Anote o que acompanha cada código, o ambiente de uso e a manutenção. Preço ou nome do material isolado não responde qual opção serve melhor.</p></div>
          <h4 className="learning-subtitle">Na {brandName}, observe primeiro</h4>
          <ul className="learning-list">{guide.materials.map((item) => <li key={item}>{item}</li>)}</ul>
          <p className="learning-reminder">Exercício: encontre dois códigos da mesma função. Escreva “material da estrutura”, “acabamento” e “itens inclusos” de cada um. Onde a ficha não responder, escreva “a confirmar”.</p>
        </>}
        {stage === "measures" && <>
          <h3 ref={headingRef} tabIndex={-1}>Medir sem confundir produto e obra</h3>
          <p className="learning-lead">Uma porta “de 80” pode se referir à folha, ao conjunto ou ao vão. Antes de cotar, descubra qual medida a pessoa está falando.</p>
          <div className="learning-measure-cards">{measurementTypes.map((item) => <article key={item.name}><h4>{item.name}</h4><p>{item.meaning}</p><small>De onde vem: {item.source}</small></article>)}</div>
          <h4 className="learning-subtitle">Como registrar o vão da obra</h4>
          <ol className="learning-sequence">{measurementMethod.map((step) => <li key={step}>{step}</li>)}</ol>
          <p className="learning-brand-note"><strong>Em {brandName}:</strong> {guide.measures}</p>
          <p className="learning-reminder"><strong>Exemplo fictício de anotação:</strong> “vão acabado — largura em cima 90 cm, centro 89,8 cm, baixo 89,5 cm; alturas 211 e 210,7 cm; parede 12 cm”. Guarde todas as leituras. A dimensão da peça e a folga de instalação só são definidas após conferir o modelo e a orientação do fabricante/instalador.</p>
          <KnowledgeCheck question={measuresQuestion} savedChoice={answers.measures} onCheck={(choice) => saveAnswer("measures", choice)} />
        </>}
        {stage === "quality" && <>
          <h3 ref={headingRef} tabIndex={-1}>Como avaliar qualidade sem adivinhar</h3>
          <p className="learning-lead">Qualidade é adequação ao uso e acabamento da peça escolhida. Um material sozinho não garante resistência à água, isolamento ou durabilidade.</p>
          <ol className="learning-sequence">{qualityMethod.map((step) => <li key={step}>{step}</li>)}</ol>
          <div className="learning-brand-note"><strong>Inspeção de {brandName}</strong><ul className="learning-list">{guide.quality.map((item) => <li key={item}>{item}</li>)}</ul></div>
          <div className="learning-route learning-toc"><div className="learning-route-heading"><span className="section-kicker">PERGUNTAS PARA ESTE CATÁLOGO</span><h4>Antes de apresentar um produto</h4></div><ol>{guide.questions.map((question, index) => <li key={question}><strong>{String(index + 1).padStart(2, "0")}</strong><span>{question}</span></li>)}</ol></div>
          <p className="learning-reminder">Se a ficha não traz um ensaio ou uma garantia para o código escolhido, evite prometer desempenho. Peça a documentação atualizada.</p>
        </>}
        {stage === "practice" && <>
          <h3 ref={headingRef} tabIndex={-1}>Resolva um atendimento</h3>
          <p className="learning-lead">Primeiro pense em quais dados pediria. Depois abra o raciocínio e confira sua resposta.</p>
          <p className="learning-case"><strong>Situação</strong>{guide.scenario}</p>
          <details className="learning-answer"><summary>Mostrar um caminho de resposta</summary><p>{guide.reasoning}</p></details>
          <KnowledgeCheck key={brand} question={guide.quiz} savedChoice={answers.brand} onCheck={(choice) => saveAnswer("brand", choice)} />
          <section className="learning-sheet" aria-labelledby="learning-sheet-title">
            <div className="learning-sheet-heading"><span className="section-kicker">CADERNO DE ESTUDO · {brandName.toUpperCase()}</span><h4 id="learning-sheet-title">Preencha com uma peça real do catálogo</h4><p>Abra a ficha da marca, copie o que ela informa e marque as dúvidas. Seus textos são salvos automaticamente para este login e esta marca neste navegador.</p></div>
            <div className="learning-field-grid">{studyFields.map((field) => <div className="learning-field" key={field.id}><label htmlFor={`learning-sheet-${brand}-${field.id}`}>{field.label}</label><p id={`learning-help-${brand}-${field.id}`}>{field.hint}</p><textarea id={`learning-sheet-${brand}-${field.id}`} value={sheet[field.id]} onChange={(event) => updateSheet(field.id, event.target.value)} aria-describedby={`learning-help-${brand}-${field.id}`} placeholder={field.example} rows={3} maxLength={1000} /></div>)}</div>
            <div className="learning-field-actions"><a href={pagesAssetHref(guide.source.href)} target="_blank" rel="noreferrer">Abrir a fonte desta marca ↗</a><FichesLink onOpenFiches={onOpenFiches}>Procurar uma ficha →</FichesLink></div>
          </section>
          <p className="learning-reminder">Na proposta comercial, use apenas especificações verificadas na ficha atual da peça. Se algum dado faltar, anote “a confirmar” e consulte o fabricante ou instalador.</p>
        </>}
        {stageIndex < stages.length - 1 && <button type="button" className="learning-next" onClick={() => navigateStage(stages[stageIndex + 1].id)}>Próxima etapa: {stages[stageIndex + 1].label} →</button>}
        </div></div>
      </div>
      <div className="learning-footer"><a href={pagesAssetHref(guide.source.href)} target="_blank" rel="noreferrer">Conferir fonte: {guide.source.label} ↗</a><FichesLink onOpenFiches={onOpenFiches}>Ver fichas desta marca →</FichesLink></div>
      {brand === "brimak" && <div className="learning-documents" aria-label="Aulas de cada catálogo Brimak">
        <div className="learning-documents-heading"><span className="section-kicker">BIBLIOTECA BRIMAK</span><h3>Estude cada um dos cinco PDFs</h3><p>Escolha a linha que combina com a peça procurada. Em cada aula, leia as páginas indicadas, compare medidas e itens inclusos, depois responda a pergunta.</p></div>
        <div className="learning-documents-grid">{brimakDocumentLessons.map((lesson, index) => <details className="learning-document learning-document-card" key={lesson.href}>
          <summary><span>{String(index + 1).padStart(2, "0")}</span><strong>{lesson.title}</strong><small>{lesson.pages}</small><span className="learning-document-focus">{lesson.focus}</span></summary>
          <div className="learning-document-body"><div><h4>O que reconhecer</h4><p>{lesson.learn}</p></div><div><h4>Como ler medidas</h4><p>{lesson.measurements}</p></div><div><h4>O que verificar na qualidade</h4><p>{lesson.inspect}</p></div><div><h4>Faça no PDF</h4><p>{lesson.task}</p></div><a href={pagesAssetHref(lesson.href)} target="_blank" rel="noreferrer">Abrir {lesson.title} em PDF ↗</a><KnowledgeCheck question={lesson.quiz} savedChoice={answers[`document:${lesson.href}`]} onCheck={(choice) => saveAnswer(`document:${lesson.href}`, choice)} /></div>
        </details>)}</div>
      </div>}
    </section>
  );
}
