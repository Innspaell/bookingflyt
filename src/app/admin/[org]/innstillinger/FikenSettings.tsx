"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Company { name: string; slug: string; organizationNumber?: string }

export function FikenSettings({
  slug, orgName, canManage, connected, companySlug, secretsConfigured,
}: {
  slug: string; orgName: string; canManage: boolean; connected: boolean; companySlug: string | null; secretsConfigured: boolean;
}) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  async function api(method: "POST" | "DELETE", body?: unknown) {
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/admin/${slug}/fiken`, {
      method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setMsg({ kind: "error", text: j.error ?? "Noe gikk galt" }); return null; }
    return j;
  }

  // Hent selskapslisten hvis vi er koblet til men ikke har valgt selskap
  useEffect(() => {
    if (connected && !companySlug && canManage && companies === null) {
      api("POST", { list: true }).then((j) => j && setCompanies(j.companies));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, companySlug]);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    const j = await api("POST", { token });
    if (!j) return;
    setToken("");
    setCompanies(j.companies);
    setMsg({ kind: "ok", text: j.selected ? "Koblet til Fiken." : "Nøkkelen virker. Velg hvilket selskap i Fiken som hører til " + orgName + "." });
    router.refresh();
  }

  async function choose(s: string) {
    const j = await api("POST", { companySlug: s });
    if (j) { setMsg({ kind: "ok", text: "Fiken-selskap valgt." }); router.refresh(); }
  }

  async function disconnect() {
    setConfirmDisconnect(false);
    const j = await api("DELETE");
    if (j) { setCompanies(null); setMsg({ kind: "ok", text: "Koblet fra Fiken. Nøkkelen er slettet fra Bookingflyt." }); router.refresh(); }
  }

  const status = connected && companySlug ? "tilkoblet" : connected ? "velg-selskap" : "ikke";

  return (
    <section className="panel">
      <div className="row-between">
        <h2>Fiken</h2>
        <span className={`pill ${status === "tilkoblet" ? "ok" : ""}`}>
          {status === "tilkoblet" ? "Tilkoblet" : status === "velg-selskap" ? "Velg selskap" : "Ikke tilkoblet"}
        </span>
      </div>

      {status === "tilkoblet" && (
        <p>{orgName} lager tilbud og ordrebekreftelser i Fiken-selskapet <code className="code-inline">{companySlug}</code>.</p>
      )}

      {!secretsConfigured && (
        <p className="error small">
          Serveren mangler <code>SECRETS_KEY</code>. Legg den inn i Vercel før du kobler til (se README).
        </p>
      )}

      {!canManage ? (
        <p className="muted small">Bare eier eller admin kan endre Fiken-tilkoblingen.</p>
      ) : (
        <>
          {status !== "tilkoblet" && (
            <ol className="steps small">
              <li>Logg inn i Fiken, åpne selskapet og aktiver <b>API-modulen</b> under innstillingene (betalt tillegg).</li>
              <li>Finn <b>API</b> under innstillingene i Fiken, og lag en ny <b>personlig API-nøkkel</b>. Kall den «Bookingflyt».</li>
              <li>Lim nøkkelen inn under. Den lagres kryptert og vises aldri igjen.</li>
            </ol>
          )}

          {(status === "ikke" || status === "velg-selskap") && (
            <form className="addform" onSubmit={connect}>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="fk-token">{status === "ikke" ? "API-nøkkel fra Fiken" : "Ny API-nøkkel (valgfritt)"}</label>
                <input id="fk-token" type="password" autoComplete="off" spellCheck={false} value={token}
                  onChange={(e) => setToken(e.target.value)} placeholder="Lim inn nøkkelen" required={status === "ikke"} />
              </div>
              <button className="btn primary" disabled={busy || !token || !secretsConfigured}>{busy ? "Sjekker …" : "Koble til"}</button>
            </form>
          )}

          {status === "velg-selskap" && companies && (
            <div className="stack">
              <span className="label">Hvilket Fiken-selskap er {orgName}?</span>
              {companies.length === 0 && <p className="muted small">Nøkkelen har ikke tilgang til noen selskaper.</p>}
              {companies.map((c) => (
                <button key={c.slug} className="btn" style={{ textAlign: "left" }} disabled={busy} onClick={() => choose(c.slug)}>
                  <b>{c.name}</b>{c.organizationNumber ? <span className="muted"> · org.nr {c.organizationNumber}</span> : null}
                </button>
              ))}
            </div>
          )}

          {connected && (
            <div className="moves">
              {confirmDisconnect ? (
                <>
                  <button className="btn small danger" onClick={disconnect} disabled={busy}>Koble fra Fiken</button>
                  <button className="btn small" onClick={() => setConfirmDisconnect(false)}>Avbryt</button>
                </>
              ) : (
                <button className="btn small" onClick={() => setConfirmDisconnect(true)}>Koble fra …</button>
              )}
            </div>
          )}
        </>
      )}

      {msg && <p className={msg.kind === "error" ? "error" : "muted"} role="status">{msg.text}</p>}
    </section>
  );
}
