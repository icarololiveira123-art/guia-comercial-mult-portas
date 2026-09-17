"use client";

import { useEffect } from "react";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("guide_render_failed", { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <main className="auth-shell">
      <section className="auth-card recovery-card" role="alert" aria-labelledby="recovery-title">
        <div className="auth-brand"><div className="brand-mark auth-mark">MP</div><div><strong>MULT PORTAS</strong><span>Guia comercial interno</span></div></div>
        <div className="auth-heading">
          <span className="section-kicker">RECUPERAÇÃO SEGURA</span>
          <h1 id="recovery-title">A tela não carregou por completo.</h1>
          <p>Seus registros permanecem vinculados à sua conta. Tente reconstruir a tela; se o problema continuar, recarregue o navegador.</p>
        </div>
        <div className="recovery-actions">
          <button className="button primary" type="button" onClick={reset}>Tentar novamente <span>↻</span></button>
          <button className="button ghost" type="button" onClick={() => window.location.reload()}>Recarregar página</button>
        </div>
      </section>
    </main>
  );
}
