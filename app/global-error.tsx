"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="pt-BR">
      <body>
        <main className="auth-shell">
          <section className="auth-card recovery-card" role="alert">
            <div className="auth-brand"><div className="brand-mark auth-mark">MP</div><div><strong>MULT PORTAS</strong><span>Guia comercial interno</span></div></div>
            <div className="auth-heading"><span className="section-kicker">RECUPERAÇÃO</span><h1>Não foi possível abrir o guia.</h1><p>Nenhum dado da sua conta foi apagado. Tente carregar a aplicação novamente.</p></div>
            <div className="recovery-actions"><button className="button primary" type="button" onClick={reset}>Tentar novamente <span>↻</span></button><button className="button ghost" type="button" onClick={() => window.location.reload()}>Recarregar página</button></div>
          </section>
        </main>
      </body>
    </html>
  );
}
