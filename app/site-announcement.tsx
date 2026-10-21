"use client";

import { useEffect, useRef, useState } from "react";
import { WorkspaceIcon } from "./workspace-icon";
import "./site-announcement.css";

type Props = {
  userId: number;
  storageScope: string;
  onOpenQuotes: () => void;
};

export function SiteAnnouncement({ userId, storageScope, onOpenQuotes }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [doNotShowAgain, setDoNotShowAgain] = useState(false);
  const [preferenceError, setPreferenceError] = useState("");
  const preferenceKey = `mult-portas-site-announcement:quote-requests-v1:${encodeURIComponent(storageScope)}:${userId}`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    try {
      if (window.localStorage.getItem(preferenceKey) === "dismissed") return;
    } catch {
      // The announcement remains usable when browser storage is unavailable.
    }

    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const restorePage = () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
    const handleClose = () => {
      if (!dialog.open) restorePage();
    };

    dialog.addEventListener("close", handleClose);
    document.body.style.overflow = "hidden";
    dialog.showModal();
    headingRef.current?.focus();

    return () => {
      dialog.removeEventListener("close", handleClose);
      if (dialog.open) dialog.close();
      restorePage();
    };
  }, [preferenceKey]);

  function updatePreference(checked: boolean) {
    try {
      if (checked) window.localStorage.setItem(preferenceKey, "dismissed");
      else window.localStorage.removeItem(preferenceKey);
      setDoNotShowAgain(checked);
      setPreferenceError("");
    } catch {
      setPreferenceError("Não foi possível guardar sua escolha neste navegador. Você pode fechar o aviso e continuar usando o site.");
    }
  }

  function closeAnnouncement() {
    dialogRef.current?.close();
  }

  return (
    <dialog className="site-announcement" ref={dialogRef} aria-labelledby="site-announcement-title" aria-describedby="site-announcement-description">
      <div className="site-announcement-body">
        <header className="site-announcement-header">
          <span className="site-announcement-badge"><span /> NOVIDADE NO SEU ESPAÇO</span>
          <button className="site-announcement-close" type="button" onClick={closeAnnouncement} aria-label="Fechar aviso de novidades">×</button>
        </header>

        <div className="site-announcement-intro">
          <span className="site-announcement-symbol"><WorkspaceIcon name="work" /></span>
          <h2 id="site-announcement-title" ref={headingRef} tabIndex={-1}>Seus pedidos de orçamento,<br /><em>do início ao envio.</em></h2>
          <p id="site-announcement-description">A seção <strong>Pedidos de orçamento</strong> reúne o que o cliente pediu e ajuda você a acompanhar cada envio.</p>
        </div>

        <ol className="site-announcement-steps">
          <li><span>01</span><div><h3>Registre o pedido</h3><p>Informe o cliente, o telefone e a data da solicitação. A data de criação é registrada automaticamente.</p></div></li>
          <li><span>02</span><div><h3>Detalhe cada item</h3><p>Adicione os produtos e as quantidades. Altura e largura em metros, medida livre e valor por item são opcionais.</p></div></li>
          <li><span>03</span><div><h3>Copie, envie e acompanhe</h3><p>O resumo pronto já inclui seu nome como vendedor. Ao marcar como enviado, o pedido vai para <strong>Arquivados</strong>, com o histórico preservado.</p></div></li>
        </ol>

        <div className="site-announcement-tip"><WorkspaceIcon name="book" /><p>Para encontrar um pedido depois, busque pelo <strong>cliente, telefone ou medida</strong>.</p></div>
        <p className="site-announcement-location">Onde encontrar: <strong>Operação → Pedidos de orçamento</strong></p>

        <footer className="site-announcement-footer">
          <label className="site-announcement-preference"><input type="checkbox" checked={doNotShowAgain} onChange={(event) => updatePreference(event.target.checked)} aria-describedby="site-announcement-preference-note" /><span>Não mostrar novamente</span></label>
          <p className="site-announcement-preference-note" id="site-announcement-preference-note">Sua escolha vale para sua conta neste navegador.</p>
          {preferenceError && <p className="site-announcement-error" role="alert">{preferenceError}</p>}
          <div className="site-announcement-actions">
            <button className="site-announcement-secondary" type="button" onClick={closeAnnouncement}>Continuar no site</button>
            <button className="site-announcement-primary" type="button" onClick={() => { closeAnnouncement(); onOpenQuotes(); }}>Conhecer a seção <WorkspaceIcon name="arrow" /></button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}
