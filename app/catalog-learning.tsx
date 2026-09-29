"use client";

import { useState } from "react";
import { beginnerGlossary, brimakDocumentLessons, learningByBrand, materialGuide, measurementMethod, qualityMethod } from "./lib/catalog-learning.mjs";

type Brand = keyof typeof learningByBrand;
type Question = { prompt: string; options: string[]; answer: number; why: string };
type Stage = "basics" | "materials" | "measures" | "quality" | "practice";

const stages: { id: Stage; label: string }[] = [
  { id: "basics", label: "1. Comece do zero" },
  { id: "materials", label: "2. Materiais" },
  { id: "measures", label: "3. Medidas" },
  { id: "quality", label: "4. Qualidade" },
  { id: "practice", label: "5. Pratique" },
];

function KnowledgeCheck({ question }: { question: Question }) {
  const [choice, setChoice] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
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
      <button type="button" className="learning-action" disabled={choice === null} onClick={() => setRevealed(true)}>Conferir resposta</button>
      {revealed && <p className={`learning-feedback ${correct ? "correct" : "review"}`} role="status">{correct ? "Correto. " : `Revise: ${question.options[question.answer]} `}{question.why}</p>}
    </div>
  );
}

export function CatalogLearning({ brand, brandName }: { brand: Brand; brandName: string }) {
  const [stage, setStage] = useState<Stage>("basics");
  const guide = learningByBrand[brand];
  const stageIndex = stages.findIndex((item) => item.id === stage);

  return (
    <section className="catalog-learning panel" aria-labelledby="catalog-learning-title">
      <div className="learning-header">
        <div><span className="section-kicker">ESCOLA DO CATÁLOGO · PARA QUEM ESTÁ COMEÇANDO</span><h2 id="catalog-learning-title">{guide.title}</h2><p>Aprenda a reconhecer a peça, ler a ficha, conferir medidas e explicar a escolha. Estude na ordem e depois resolva o caso.</p></div>
        <span className="learning-duration">5 etapas</span>
      </div>

      <nav className="learning-stage-nav" aria-label={`Etapas de estudo de ${brandName}`}>
        {stages.map((item) => <button type="button" key={item.id} className={stage === item.id ? "active" : ""} aria-pressed={stage === item.id} onClick={() => setStage(item.id)}>{item.label}</button>)}
      </nav>

      <div className="learning-stage-content" key={stage}>
        {stage === "basics" && <>
          <h3>Primeiro entenda o que está comprando</h3>
          <p className="learning-lead">{guide.startingPoint}</p>
          <ol className="learning-sequence"><li>Observe a foto e leia o nome da família.</li><li>Identifique folha, marco, vidro e ferragens que aparecem na descrição.</li><li>Separe o que o catálogo confirma do que ainda precisa perguntar.</li><li>Explique com suas palavras para que ambiente a peça pode servir.</li></ol>
          <details className="learning-glossary"><summary>Glossário essencial: oito termos para começar</summary><dl>{beginnerGlossary.map((item) => <div key={item.term}><dt>{item.term}</dt><dd>{item.meaning}</dd></div>)}</dl></details>
        </>}
        {stage === "materials" && <>
          <h3>Material, composição e acabamento</h3>
          <p className="learning-lead">Material da estrutura, revestimento, ferragens e vidro são informações diferentes. Leia cada campo da peça antes de dizer que um produto é melhor para um ambiente.</p>
          <div className="learning-material-grid">{materialGuide.map((item) => <article key={item.name}><h4>{item.name}</h4><p>{item.read}</p><small>{item.avoid}</small></article>)}</div>
          <h4 className="learning-subtitle">Agora aplique em {brandName}</h4>
          <ul className="learning-list">{guide.materials.map((item) => <li key={item}>{item}</li>)}</ul>
          <p className="learning-reminder">Método: compare dois códigos da mesma função e registre o que muda em material, composição, acabamento e manutenção.</p>
        </>}
        {stage === "measures" && <>
          <h3>Medir sem confundir produto e obra</h3>
          <ol className="learning-sequence">{measurementMethod.map((step) => <li key={step}>{step}</li>)}</ol>
          <p className="learning-brand-note"><strong>Em {brandName}:</strong> {guide.measures}</p>
          <p className="learning-reminder">Exemplo de anotação para treinar: “vão acabado — largura em cima 90 cm, centro 89,8 cm, baixo 89,5 cm; alturas 211 e 210,7 cm; parede 12 cm”. Guarde todas as leituras. Este exemplo é fictício e não define o tamanho da peça a encomendar.</p>
          <KnowledgeCheck question={{ prompt: "Qual anotação permite conferir esse vão com segurança?", options: ["Só 90 × 211 cm, pois é a maior leitura.", "Todas as larguras e alturas, parede, estágio da obra e confirmação da peça escolhida.", "Uma medida da folha com 7 cm somados."], answer: 1, why: "As diferenças entre pontos indicam que a instalação precisa de conferência; nenhuma soma fixa define a peça." }} />
        </>}
        {stage === "quality" && <>
          <h3>Como avaliar qualidade sem adivinhar</h3>
          <ol className="learning-sequence">{qualityMethod.map((step) => <li key={step}>{step}</li>)}</ol>
          <div className="learning-brand-note"><strong>Checklist de {brandName}</strong><ul className="learning-list">{guide.quality.map((item) => <li key={item}>{item}</li>)}</ul></div>
        </>}
        {stage === "practice" && <>
          <h3>Resolva um atendimento</h3>
          <p className="learning-case"><strong>Situação</strong>{guide.scenario}</p>
          <details className="learning-answer"><summary>Ver o raciocínio depois de tentar</summary><p>{guide.reasoning}</p></details>
          <KnowledgeCheck key={brand} question={guide.quiz} />
          <p className="learning-reminder">Se algum dado ficar sem resposta, marque “a confirmar” e abra a ficha do produto antes de cotar.</p>
        </>}
        {stageIndex < stages.length - 1 && <button type="button" className="learning-next" onClick={() => setStage(stages[stageIndex + 1].id)}>Próxima: {stages[stageIndex + 1].label} →</button>}
      </div>
      <div className="learning-footer"><a href={guide.source.href} target="_blank" rel="noreferrer">Conferir fonte: {guide.source.label} ↗</a><a href="#catalog-results">Ver fichas desta marca ↓</a></div>
      {brand === "brimak" && <div className="learning-documents" aria-label="Aulas de cada catálogo Brimak">
        <div className="learning-documents-heading"><span className="section-kicker">UM ARQUIVO DE CADA VEZ</span><h3>Cinco aulas com os PDFs anexados</h3><p>Abra uma aula, localize as páginas indicadas e faça o exercício antes de conferir a resposta.</p></div>
        {brimakDocumentLessons.map((lesson, index) => <details className="learning-document" key={lesson.href}>
          <summary><span>{String(index + 1).padStart(2, "0")}</span><strong>{lesson.title}</strong><small>{lesson.pages}</small></summary>
          <div className="learning-document-body"><div><h4>O que reconhecer</h4><p>{lesson.learn}</p></div><div><h4>Medidas</h4><p>{lesson.measurements}</p></div><div><h4>Qualidade da peça</h4><p>{lesson.inspect}</p></div><div><h4>Exercício no PDF</h4><p>{lesson.task}</p></div><a href={lesson.href} target="_blank" rel="noreferrer">Abrir {lesson.title} em PDF ↗</a><KnowledgeCheck question={lesson.quiz} /></div>
        </details>)}
      </div>}
    </section>
  );
}
