"use client";

import { type KeyboardEvent, useEffect, useState } from "react";
import { CatalogLearning } from "./catalog-learning";

export type WorkspaceBrandId = "dalcomad" | "destak" | "casmavi" | "aluan" | "brimak" | "brasil" | "crv" | "lucasa" | "riobras";

export type WorkspaceCatalogDocument = {
  title: string;
  description: string;
  href: string;
  pages: number;
};

export type WorkspaceBrand = {
  name: string;
  short: string;
  descriptor: string;
  accent: string;
  summary: string;
  when: string[];
  guardrails: string[];
  official: string;
  catalog: string;
  documents?: WorkspaceCatalogDocument[];
};

export type WorkspaceCatalogItem = {
  id: string;
  brand: WorkspaceBrandId;
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

type WorkspaceView = "learn" | "fiches" | "pdfs";

function readWorkspaceView(key: string): WorkspaceView {
  try {
    const value = localStorage.getItem(key);
    return value === "fiches" || value === "pdfs" ? value : "learn";
  } catch { return "learn"; }
}

export type CatalogWorkspaceProps = {
  brand: WorkspaceBrandId;
  userId: number;
  currentBrand: WorkspaceBrand;
  brands: Record<WorkspaceBrandId, WorkspaceBrand>;
  items: WorkspaceCatalogItem[];
  totalItemCount: number;
  studiedCatalogCount: number;
  catalogSearch: string;
  catalogFamily: string;
  families: string[];
  assetHref: (href: string) => string;
  onSelectBrand: (brand: WorkspaceBrandId) => void;
  onSearchChange: (value: string) => void;
  onFamilyChange: (value: string) => void;
  onOpenItem: (item: WorkspaceCatalogItem, trigger: HTMLButtonElement) => void;
};

export function CatalogWorkspace({
  brand,
  userId,
  currentBrand,
  brands,
  items,
  totalItemCount,
  studiedCatalogCount,
  catalogSearch,
  catalogFamily,
  families,
  assetHref,
  onSelectBrand,
  onSearchChange,
  onFamilyChange,
  onOpenItem,
}: CatalogWorkspaceProps) {
  const viewKey = `mult-portas-guia-catalog-view-v1-user-${userId}-brand-${brand}`;
  const [view, setView] = useState<WorkspaceView>(() => readWorkspaceView(viewKey));
  useEffect(() => {
    try { localStorage.setItem(viewKey, view); } catch { /* A consulta continua disponível sem armazenamento. */ }
  }, [viewKey, view]);
  const views: { id: WorkspaceView; label: string; helper: string }[] = [
    { id: "learn", label: "Aprender", helper: "Aulas e exercícios" },
    { id: "fiches", label: "Fichas", helper: "Modelos e detalhes" },
    { id: "pdfs", label: "PDFs", helper: "Documentos completos" },
  ];

  function chooseBrand(next: WorkspaceBrandId) {
    if (next !== brand) {
      onSelectBrand(next);
    }
  }

  function clearFilters() {
    onSearchChange("");
    onFamilyChange("Todas");
  }

  function openFichesFromLesson() {
    setView("fiches");
    window.requestAnimationFrame(() => document.getElementById("catalog-tab-fiches")?.focus());
  }

  function handleTabKeys(event: KeyboardEvent<HTMLButtonElement>, current: WorkspaceView) {
    const index = views.findIndex((item) => item.id === current);
    const nextIndex = event.key === "ArrowRight" ? (index + 1) % views.length
      : event.key === "ArrowLeft" ? (index + views.length - 1) % views.length
        : event.key === "Home" ? 0 : event.key === "End" ? views.length - 1 : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const next = views[nextIndex].id;
    setView(next);
    document.getElementById(`catalog-tab-${next}`)?.focus();
  }

  return (
    <div className="page-content catalog-workspace">
      <header className="catalog-workspace-header">
        <div>
          <span className="section-kicker">BIBLIOTECA COMERCIAL</span>
          <h1 id="catalog-workspace-title">Catálogos</h1>
          <p>Escolha a marca e siga o caminho: aprenda a peça, confira a ficha e consulte o documento.</p>
        </div>
        <div className="catalog-workspace-stats" aria-label="Conteúdo da biblioteca"><strong>{Object.keys(brands).length}</strong><span>marcas</span><strong>{totalItemCount}</strong><span>fichas</span><small>{studiedCatalogCount} catálogos de referência</small></div>
      </header>

      <div className="catalog-library">
        <nav className="catalog-index" id="catalog-brands" aria-label="Escolha uma marca">
          <div className="catalog-index-heading"><span className="section-kicker">MARCA</span><strong>O que vamos estudar?</strong></div>
          <div className="catalog-index-list">{(Object.keys(brands) as WorkspaceBrandId[]).map((id) => (
            <button type="button" key={id} className={brand === id ? "active" : ""} aria-pressed={brand === id} onClick={() => chooseBrand(id)}>
              <span className="catalog-index-mark" style={{ background: brands[id].accent }} aria-hidden="true" />
              <span><strong>{brands[id].short}</strong><small>{brands[id].descriptor}</small></span>
            </button>
          ))}</div>
          <p>Seu estudo e suas anotações são retomados separadamente em cada marca e login neste navegador.</p>
        </nav>

        <div className="catalog-main">
          <section className="catalog-brand-heading" aria-labelledby="catalog-brand-name">
            <div className="catalog-brand-topline"><span className="catalog-brand-symbol" style={{ background: currentBrand.accent }} aria-hidden="true">{currentBrand.short.slice(0, 2).toUpperCase()}</span><span className="section-kicker">{currentBrand.catalog}</span></div>
            <h2 id="catalog-brand-name">{currentBrand.name}</h2>
            <p>{currentBrand.summary}</p>
            <div className="catalog-brand-actions"><a href={currentBrand.official} target="_blank" rel="noreferrer">Canal oficial da marca ↗</a><details className="catalog-brand-details"><summary>Quando indicar e o que confirmar</summary><div><div><strong>Indicar quando</strong><ul>{currentBrand.when.map((item) => <li key={item}>{item}</li>)}</ul></div><div><strong>Antes de cotar</strong><ul>{currentBrand.guardrails.map((item) => <li key={item}>{item}</li>)}</ul></div></div></details></div>
          </section>

          <div className="catalog-view-switch" role="tablist" aria-label={`Conteúdo de ${currentBrand.short}`}>
            {views.map((item) => <button type="button" key={item.id} id={`catalog-tab-${item.id}`} role="tab" className={view === item.id ? "active" : ""} aria-selected={view === item.id} aria-controls={view === item.id ? `catalog-panel-${item.id}` : undefined} tabIndex={view === item.id ? 0 : -1} onClick={() => setView(item.id)} onKeyDown={(event) => handleTabKeys(event, item.id)}><strong>{item.label}</strong><small>{item.helper}</small></button>)}
          </div>

          {view === "learn" && <div className="catalog-view-panel" id="catalog-panel-learn" role="tabpanel" aria-labelledby="catalog-tab-learn" tabIndex={0}>
            <CatalogLearning key={`${userId}-${brand}`} brand={brand} brandName={currentBrand.short} userId={userId} onOpenFiches={openFichesFromLesson} />
          </div>}

          {view === "fiches" && <section className="catalog-view-panel catalog-fiches-panel" id="catalog-panel-fiches" role="tabpanel" aria-labelledby="catalog-tab-fiches" tabIndex={0}>
            <div className="catalog-view-heading"><div><span className="section-kicker">FICHAS COMERCIAIS</span><h3>Encontre um modelo</h3><p>Abra a ficha para ver indicação, argumento e pontos que precisam de confirmação.</p></div><span>{items.length} {items.length === 1 ? "resultado" : "resultados"}</span></div>
            <div className="catalog-tools" id="catalog-results"><label className="search-box"><span aria-hidden="true">⌕</span><input value={catalogSearch} onChange={(event) => onSearchChange(event.target.value)} placeholder={`Buscar em ${currentBrand.short}...`} aria-label="Pesquisar no catálogo" /></label><select value={catalogFamily} onChange={(event) => onFamilyChange(event.target.value)} aria-label="Filtrar família">{families.map((family) => <option key={family}>{family}</option>)}</select></div>
            {items.length > 0 ? <div className="catalog-grid">{items.map((item) => <article className="catalog-card" key={item.id}><div className="card-meta"><span className="family-badge">{item.family}</span><span className="source-dot" title={item.source} aria-label={item.source}>●</span></div><h3>{item.title}</h3>{item.code && <div className="catalog-code">{item.code}</div>}<p>{item.spec}</p><div className="card-bottom"><span>Indicar para <strong>{item.bestFor.split(",")[0]}</strong></span><button type="button" aria-label={`Abrir ficha de ${item.title}`} onClick={(event) => onOpenItem(item, event.currentTarget)}>Ver ficha <span aria-hidden="true">→</span></button></div></article>)}</div> : <div className="empty-state catalog-empty"><strong>Nenhuma ficha encontrada.</strong><span>Revise o termo ou limpe os filtros para ver as opções desta marca.</span><button className="button light" type="button" onClick={clearFilters}>Limpar filtros</button></div>}
            <p className="catalog-note"><span aria-hidden="true">i</span><span>As fichas são referências comerciais. Código, cor, medida, ferragens, disponibilidade e composição devem ser confirmados antes da proposta.</span></p>
          </section>}

          {view === "pdfs" && <section className="catalog-view-panel catalog-pdfs-panel" id="catalog-panel-pdfs" role="tabpanel" aria-labelledby="catalog-tab-pdfs" tabIndex={0}>
            <div className="catalog-view-heading"><div><span className="section-kicker">ARQUIVOS PARA CONSULTA</span><h3>Documentos de {currentBrand.short}</h3><p>Leia o modelo e a edição da ficha. A disponibilidade e as especificações atuais exigem confirmação.</p></div><span>{currentBrand.documents?.length ?? 0} PDFs</span></div>
            {currentBrand.documents?.length ? <div className="catalog-document-grid">{currentBrand.documents.map((document, index) => <a className="catalog-document-card" href={assetHref(document.href)} target="_blank" rel="noreferrer" key={document.href}><div><span>{String(index + 1).padStart(2, "0")}</span><strong>{document.title}</strong></div><p>{document.description}</p><small>{document.pages} páginas <b>Abrir PDF ↗</b></small></a>)}</div> : <div className="catalog-no-pdfs"><strong>Nenhum PDF anexado desta marca.</strong><p>Consulte a ficha online ou peça a edição atual do catálogo antes de usar dados técnicos em uma proposta.</p><a href={currentBrand.official} target="_blank" rel="noreferrer">Abrir canal oficial ↗</a></div>}
          </section>}
        </div>
      </div>
    </div>
  );
}
