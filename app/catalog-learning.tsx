"use client";

import { useEffect, useRef, useState } from "react";
import { beginnerGlossary, brimakDocumentLessons, learningByBrand, materialGuide, measurementMethod, qualityMethod } from "./lib/catalog-learning.mjs";

type Brand = keyof typeof learningByBrand;
type Question = { prompt: string; options: string[]; answer: number; why: string };
type Stage = "basics" | "materials" | "measures" | "quality" | "practice";
type LearningProgress = { stage: Stage; answers: Record<string, number> };

const stages: { id: Stage; label: string; summary: string }[] = [
  { id: "basics", label: "Comece do zero", summary: "Reconheça as partes" },
  { id: "materials", label: "Materiais", summary: "Entenda a composição" },
  { id: "measures", label: "Medidas", summary: "Separe obra e produto" },
  { id: "quality", label: "Qualidade", summary: "Confira a ficha" },
  { id: "practice", label: "Pratique", summary: "Resolva um caso" },
];

function progressStorageKey(userId: number, brand: Brand) {
  return `mult-portas-guia-learning-v1-user-${userId}-brand-${brand}`;
}

function pagesAssetHref(href: string) {
  const isGithubPages = (import.meta.env as { VITE_GITHUB_PAGES?: string } | undefined)?.VITE_GITHUB_PAGES === "true";
  return href.startsWith("/catalogos/") && isGithubPages
    ? `/guia-comercial-mult-portas${href}`
    : href;
}

function readProgress(key: string, brand: Brand): LearningProgress {
  const empty: LearningProgress = { stage: "basics", answers: {} };
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return empty;
    const parsed: unknown = JSON.parse(raw);
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

export function CatalogLearning({ brand, brandName, userId }: { brand: Brand; brandName: string; userId: number }) {
  const storageKey = progressStorageKey(userId, brand);
  const [initialProgress] = useState(() => readProgress(storageKey, brand));
  const [stage, setStage] = useState<Stage>(initialProgress.stage);
  const [answers, setAnswers] = useState<Record<string, number>>(initialProgress.answers);
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
    try {
      localStorage.setItem(storageKey, JSON.stringify({ stage, answers } satisfies LearningProgress));
    } catch {
      // The lesson still works when this browser does not allow local storage.
    }
  }, [storageKey, stage, answers]);

  useEffect(() => { if (hasNavigated) headingRef.current?.focus(); }, [stage, hasNavigated]);

  function navigateStage(next: Stage) {
    setHasNavigated(true);
    setStage(next);
  }

  function saveAnswer(id: string, choice: number) {
    setAnswers((current) => ({ ...current, [id]: choice }));
  }

  return (
    <section className="catalog-learning panel" aria-labelledby="catalog-learning-title">
      <div className="learning-header">
        <div><span className="section-kicker">ESCOLA DO CATÁLOGO · PARA QUEM ESTÁ COMEÇANDO</span><h2 id="catalog-learning-title">{guide.title}</h2><p>Aprenda a reconhecer a peça, ler a ficha, conferir medidas e explicar a escolha. Estude na ordem e depois resolva o caso.</p></div>
        <span className="learning-duration">5 etapas</span>
      </div>

      <p className="learning-stage-help" id="learning-stage-help">Siga as etapas na ordem ou abra a que precisa revisar. {correctAnswers} de {questionCount} questões certas nesta marca.</p>
      <nav className="learning-stage-nav" aria-label={`Etapas de estudo de ${brandName}`} aria-describedby="learning-stage-help">
        {stages.map((item, index) => <button type="button" key={item.id} className={stage === item.id ? "active" : ""} aria-pressed={stage === item.id} aria-controls="learning-stage-panel" onClick={() => navigateStage(item.id)}><span className="learning-stage-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><span className="learning-stage-copy"><strong>{item.label}</strong><small>{item.summary}</small></span></button>)}
      </nav>

      <div className="learning-stage-content" id="learning-stage-panel" key={stage}>
        {stage === "basics" && <>
          <h3 ref={headingRef} tabIndex={-1}>Primeiro entenda o que está comprando</h3>
          <p className="learning-lead">{guide.startingPoint}</p>
          <DoorAnatomy />
          <h4 className="learning-subtitle">Agora encontre essas partes em uma ficha</h4>
          <ol className="learning-sequence"><li>Abra <a href="#catalog-results">uma ficha desta marca abaixo</a> ou <a href={pagesAssetHref(guide.source.href)} target="_blank" rel="noreferrer">a fonte indicada</a>; observe a foto quando houver e leia a descrição.</li><li>Identifique folha, marco, vidro e ferragens que aparecem na descrição.</li><li>Separe o que o catálogo confirma do que ainda precisa perguntar.</li><li>Explique com suas palavras para que ambiente a peça pode servir.</li></ol>
          <details className="learning-glossary"><summary>Glossário essencial: {beginnerGlossary.length} termos para começar</summary><dl>{beginnerGlossary.map((item) => <div key={item.term}><dt>{item.term}</dt><dd>{item.meaning}</dd></div>)}</dl></details>
        </>}
        {stage === "materials" && <>
          <h3 ref={headingRef} tabIndex={-1}>Material, composição e acabamento</h3>
          <p className="learning-lead">Material da estrutura, revestimento, ferragens e vidro são informações diferentes. Leia cada campo da peça antes de dizer que um produto é melhor para um ambiente.</p>
          <div className="learning-material-grid">{materialGuide.map((item) => <article key={item.name}><h4>{item.name}</h4><p>{item.read}</p><small>{item.avoid}</small></article>)}</div>
          <h4 className="learning-subtitle">Agora aplique em {brandName}</h4>
          <ul className="learning-list">{guide.materials.map((item) => <li key={item}>{item}</li>)}</ul>
          <p className="learning-reminder">Método: compare dois códigos da mesma função e registre o que muda em material, composição, acabamento e manutenção.</p>
        </>}
        {stage === "measures" && <>
          <h3 ref={headingRef} tabIndex={-1}>Medir sem confundir produto e obra</h3>
          <ol className="learning-sequence">{measurementMethod.map((step) => <li key={step}>{step}</li>)}</ol>
          <p className="learning-brand-note"><strong>Em {brandName}:</strong> {guide.measures}</p>
          <p className="learning-reminder">Exemplo de anotação para treinar: “vão acabado — largura em cima 90 cm, centro 89,8 cm, baixo 89,5 cm; alturas 211 e 210,7 cm; parede 12 cm”. Guarde todas as leituras. Este exemplo é fictício e não define o tamanho da peça a encomendar.</p>
          <KnowledgeCheck question={measuresQuestion} savedChoice={answers.measures} onCheck={(choice) => saveAnswer("measures", choice)} />
        </>}
        {stage === "quality" && <>
          <h3 ref={headingRef} tabIndex={-1}>Como avaliar qualidade sem adivinhar</h3>
          <ol className="learning-sequence">{qualityMethod.map((step) => <li key={step}>{step}</li>)}</ol>
          <div className="learning-brand-note"><strong>Checklist de {brandName}</strong><ul className="learning-list">{guide.quality.map((item) => <li key={item}>{item}</li>)}</ul></div>
        </>}
        {stage === "practice" && <>
          <h3 ref={headingRef} tabIndex={-1}>Resolva um atendimento</h3>
          <p className="learning-case"><strong>Situação</strong>{guide.scenario}</p>
          <details className="learning-answer"><summary>Ver o raciocínio depois de tentar</summary><p>{guide.reasoning}</p></details>
          <KnowledgeCheck key={brand} question={guide.quiz} savedChoice={answers.brand} onCheck={(choice) => saveAnswer("brand", choice)} />
          <p className="learning-reminder">Se algum dado ficar sem resposta, marque “a confirmar” e abra a ficha do produto antes de cotar.</p>
        </>}
        {stageIndex < stages.length - 1 && <button type="button" className="learning-next" onClick={() => navigateStage(stages[stageIndex + 1].id)}>Próxima etapa: {stages[stageIndex + 1].label} →</button>}
      </div>
      <div className="learning-footer"><a href={pagesAssetHref(guide.source.href)} target="_blank" rel="noreferrer">Conferir fonte: {guide.source.label} ↗</a><a href="#catalog-results">Ver fichas desta marca ↓</a></div>
      {brand === "brimak" && <div className="learning-documents" aria-label="Aulas de cada catálogo Brimak">
        <div className="learning-documents-heading"><span className="section-kicker">UM ARQUIVO DE CADA VEZ</span><h3>Cinco aulas com os PDFs anexados</h3><p>Abra uma aula, localize as páginas indicadas e faça o exercício antes de conferir a resposta.</p></div>
        {brimakDocumentLessons.map((lesson, index) => <details className="learning-document" key={lesson.href}>
          <summary><span>{String(index + 1).padStart(2, "0")}</span><strong>{lesson.title}</strong><small>{lesson.pages}</small></summary>
          <div className="learning-document-body"><div><h4>O que reconhecer</h4><p>{lesson.learn}</p></div><div><h4>Medidas</h4><p>{lesson.measurements}</p></div><div><h4>Qualidade da peça</h4><p>{lesson.inspect}</p></div><div><h4>Exercício no PDF</h4><p>{lesson.task}</p></div><a href={pagesAssetHref(lesson.href)} target="_blank" rel="noreferrer">Abrir {lesson.title} em PDF ↗</a><KnowledgeCheck question={lesson.quiz} savedChoice={answers[`document:${lesson.href}`]} onCheck={(choice) => saveAnswer(`document:${lesson.href}`, choice)} /></div>
        </details>)}
      </div>}
    </section>
  );
}
