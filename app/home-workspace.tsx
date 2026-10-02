import { WorkspaceIcon, type WorkspaceIconName } from "./workspace-icon";

type Destination = "overview" | "script" | "seller" | "training" | "timing" | "messages" | "fair" | "factory" | "catalog" | "control" | "management";
type BrandId = "dalcomad" | "destak" | "casmavi" | "aluan" | "brimak" | "brasil" | "crv" | "lucasa" | "riobras";
type Brand = { short: string; descriptor: string; accent: string };

type HomeWorkspaceProps = {
  firstName: string;
  branch: string;
  brands: Record<BrandId, Brand>;
  brand: BrandId;
  portfolioCount: number;
  officialQuoteCount: number;
  incompleteQuoteCount: number;
  openActionCount: number;
  completedSales: number;
  learningMetric: number;
  studiedBrandCount: number;
  studiedCatalogCount: number;
  pending: { id: string; client: string; next: string; priority: string; status: string }[];
  onNavigate: (section: Destination) => void;
  onSelectBrand: (brand: BrandId) => void;
};

const tools: { section: Destination; title: string; copy: string; icon: WorkspaceIconName }[] = [
  { section: "messages", title: "Criar mensagem", copy: "Personalize uma conversa para WhatsApp ou áudio.", icon: "message" },
  { section: "fair", title: "Convite do Feirão", copy: "Monte o convite certo para cada perfil de cliente.", icon: "mail" },
  { section: "factory", title: "Requisição de fábrica", copy: "Prepare o kit Dalcomad e exporte para Excel.", icon: "work" },
  { section: "timing", title: "Planejar o retorno", copy: "Saiba quando retomar e qual motivo apresentar.", icon: "calendar" },
];

export function HomeWorkspace(props: HomeWorkspaceProps) {
  const { firstName, branch, brands, brand, pending, onNavigate, onSelectBrand } = props;
  const currentBrand = brands[brand];
  return <div className="page-content home-page">
    <header className="home-heading">
      <div><span className="section-kicker">OLÁ, {firstName.toUpperCase()} · {branch.toUpperCase()}</span><h1>Seu próximo passo<br />começa aqui.</h1><p>Aprenda o produto, prepare a conversa e mantenha cada atendimento em movimento.</p></div>
      <button className="button dark" type="button" onClick={() => onNavigate("control")}>Ver meus atendimentos <WorkspaceIcon name="arrow" /></button>
    </header>

    <section className="home-grid" aria-label="Atividades do seu espaço">
      <article className="home-launch">
        <div className="home-card-label"><span>01 / ATENDER</span><WorkspaceIcon name="message" /></div>
        <h2>Uma boa conversa<br />tem direção.</h2><p>Abra o roteiro e conduza do primeiro contato até um próximo passo combinado.</p>
        <ol className="home-sales-path">{["Entender", "Medir", "Indicar", "Propor", "Avançar"].map((label, index) => <li key={label}><span>{String(index + 1).padStart(2, "0")}</span><strong>{label}</strong></li>)}</ol>
        <div className="home-launch-bottom"><button className="button primary" type="button" onClick={() => onNavigate("script")}>Abrir roteiro de venda <WorkspaceIcon name="arrow" /></button><span>{props.completedSales}/5 etapas aplicadas</span></div>
      </article>

      <article className="home-course">
        <div className="home-card-label"><span>02 / APRENDER</span><WorkspaceIcon name="book" /></div>
        <h2>Conheça o material.<br />Ganhe segurança.</h2><p>Partes, materiais, medidas e qualidade explicados para quem está começando.</p>
        <button className="home-course-link" type="button" onClick={() => onNavigate("catalog")}><span className="home-brand-symbol">{currentBrand.short.slice(0, 2).toUpperCase()}</span><span><small>MARCA SELECIONADA</small><strong>{currentBrand.short}</strong><span>{currentBrand.descriptor}</span></span><WorkspaceIcon name="arrow" /></button>
        <div className="home-course-footer"><button type="button" onClick={() => onNavigate("training")}>Praticar uma conversa <WorkspaceIcon name="arrow" /></button><span>{props.learningMetric}/100 no treino</span></div>
      </article>

      <section className="home-tools" aria-labelledby="home-tools-title">
        <div className="home-section-heading"><div><span className="section-kicker">PRONTAS PARA USAR</span><h2 id="home-tools-title">Ferramentas de trabalho</h2></div><span>Escolha uma tarefa</span></div>
        <div className="home-tool-grid">{tools.map((tool) => <button className="home-tool-card" type="button" key={tool.section} onClick={() => onNavigate(tool.section)}><WorkspaceIcon name={tool.icon} /><strong>{tool.title}</strong><span>{tool.copy}</span><WorkspaceIcon className="home-tool-arrow" name="arrow" /></button>)}</div>
      </section>

      <section className="home-agenda" aria-labelledby="home-agenda-title">
        <div className="home-section-heading"><div><span className="section-kicker">SEU QUADRO</span><h2 id="home-agenda-title">O que precisa de atenção</h2></div><span className="home-count">{props.openActionCount}</span></div>
        <div className="home-agenda-list">{pending.length ? pending.map((item) => <button key={item.id} type="button" onClick={() => onNavigate("control")}><span className="home-agenda-dot" /><span><strong>{item.client}</strong><small>{item.next}</small><span>{item.status} · {item.priority}</span></span><WorkspaceIcon name="arrow" /></button>) : <div className="home-agenda-empty"><WorkspaceIcon name="check" /><strong>Nenhum retorno em aberto.</strong><p>Registre cliente, próxima ação e prioridade para acompanhar por aqui.</p></div>}</div>
        {props.incompleteQuoteCount > 0 && <p className="home-agenda-warning">{props.incompleteQuoteCount} orçamento{props.incompleteQuoteCount > 1 ? "s" : ""} incompleto{props.incompleteQuoteCount > 1 ? "s" : ""}. Complete o contexto antes de cobrar retorno.</p>}
        <button className="home-text-link" type="button" onClick={() => onNavigate("control")}>Organizar meus atendimentos <WorkspaceIcon name="arrow" /></button>
      </section>
    </section>

    <section className="home-metrics" aria-label="Resumo da sua conta">
      <div><span>CARTEIRA</span><strong>{props.portfolioCount}</strong><small>orçamentos registrados</small></div>
      <div><span>IDENTIFICADOS</span><strong>{props.officialQuoteCount}</strong><small>com número oficial</small></div>
      <div><span>A COMPLETAR</span><strong>{props.incompleteQuoteCount}</strong><small>incompletos ou sem número</small></div>
      <div><span>SEU ROTEIRO</span><strong>{props.completedSales}<small>/5</small></strong><small>etapas marcadas</small></div>
      <button type="button" onClick={() => onNavigate("management")}><WorkspaceIcon name="chart" /><span>Atualizar meus<br /><strong>indicadores</strong></span><WorkspaceIcon name="arrow" /></button>
    </section>

    <section className="home-brand-index" aria-labelledby="home-brands-title">
      <div className="home-section-heading"><div><span className="section-kicker">BIBLIOTECA DE PRODUTOS</span><h2 id="home-brands-title">Explore uma marca</h2></div><span>{props.studiedBrandCount} marcas · {props.studiedCatalogCount} catálogos</span></div>
      <div className="home-brand-list">{(Object.keys(brands) as BrandId[]).map((id) => <button key={id} type="button" onClick={() => { onSelectBrand(id); onNavigate("catalog"); }}><span>{brands[id].short.slice(0, 2).toUpperCase()}</span><strong>{brands[id].short}</strong><WorkspaceIcon name="arrow" /></button>)}</div>
    </section>

    <section className="home-routine" aria-label="Princípios de atendimento"><div><span>01</span><p><strong>Qualifique antes de indicar.</strong> Ambiente, medida, quantidade e prazo.</p></div><div><span>02</span><p><strong>Retorne com um motivo.</strong> Resolva uma dúvida e combine a próxima ação.</p></div><div><span>03</span><p><strong>Registre com precisão.</strong> Valor e status exatos; dúvida fica “A confirmar”.</p></div></section>
    <footer className="home-proof"><span>41 anos de experiência · 85 cidades atendidas</span><p>Qualidade e garantia conforme a linha. Confirme a ficha antes de prometer.</p><button type="button" onClick={() => onNavigate("seller")}>Desenvolver meu atendimento <WorkspaceIcon name="arrow" /></button></footer>
  </div>;
}
