"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { STATUSES, type BookingRequest, type LogEntry, type Offer, type Product, type RequestStatus } from "@/lib/types";
import { conflictsWith, dateOf, displayName, kr, productLabel, rel, stamp, when, withVat } from "@/lib/format";

export function Board({
  orgId,
  initialRequests,
  products,
  initialOpen,
  orgSlug,
  fikenReady,
}: {
  orgId: string;
  initialRequests: BookingRequest[];
  products: Product[];
  initialOpen: string | null;
  orgSlug: string;
  fikenReady: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [requests, setRequests] = useState(initialRequests);
  const [openId, setOpenId] = useState<string | null>(initialOpen);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<RequestStatus | null>(null);
  const [conflict, setConflict] = useState<{ id: string; with: BookingRequest[] } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Nye forespørsler dukker opp uten å laste siden på nytt
  useEffect(() => {
    const ch = supabase
      .channel(`requests-${orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "requests", filter: `org_id=eq.${orgId}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            setRequests((rs) => rs.filter((r) => r.id !== (payload.old as BookingRequest).id));
          } else {
            const row = payload.new as BookingRequest;
            setRequests((rs) => (rs.some((r) => r.id === row.id) ? rs.map((r) => (r.id === row.id ? row : r)) : [row, ...rs]));
          }
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [supabase, orgId]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  }

  async function move(r: BookingRequest, to: RequestStatus, force = false) {
    if (r.status === to) return;
    if (to === "bekreftet" && !force) {
      const c = conflictsWith(r, requests);
      if (c.length) { setOpenId(r.id); setConflict({ id: r.id, with: c }); return; }
    }
    const prev = r.status;
    setRequests((rs) => rs.map((x) => (x.id === r.id ? { ...x, status: to } : x)));
    setConflict(null);
    const { error } = await supabase.from("requests").update({ status: to }).eq("id", r.id);
    if (error) {
      setRequests((rs) => rs.map((x) => (x.id === r.id ? { ...x, status: prev } : x)));
      flash("Kunne ikke flytte kortet: " + error.message);
      return;
    }
    flash(to === "bekreftet" ? "Bekreftet og lagt i kalenderen" : prev === "bekreftet" ? "Fjernet fra kalenderen" : "Flyttet til " + STATUSES.find((s) => s.key === to)!.label);
  }

  const open = requests.find((r) => r.id === openId) ?? null;

  return (
    <>
      <div className="sectionhead">
        <p className="muted">
          Dra kortene mellom kolonnene, eller åpne et kort for å justere det. Når et kort havner i Bekreftet, legges det i kalenderen.
        </p>
      </div>
      <div className="board">
        {STATUSES.map((s) => {
          const items = requests
            .filter((r) => r.status === s.key)
            .sort((a, b) => (s.key === "ny" ? b.created_at.localeCompare(a.created_at) : dateOf(a).localeCompare(dateOf(b))));
          return (
            <section
              key={s.key}
              className={`col st-${s.key}${overCol === s.key ? " over" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setOverCol(s.key); }}
              onDragLeave={() => setOverCol(null)}
              onDrop={(e) => {
                e.preventDefault();
                setOverCol(null);
                const r = requests.find((x) => x.id === dragId);
                if (r) move(r, s.key);
              }}
            >
              <div className="col-h">
                <div>
                  <h3><span className="dot" />{s.short !== "–" ? `${s.short} · ` : ""}{s.label}</h3>
                  <p className="muted small">{s.hint}</p>
                </div>
                <span className="count">{items.length}</span>
              </div>
              {items.length === 0 && <div className="empty">Ingen her nå</div>}
              {items.map((r) => (
                <button
                  key={r.id}
                  className={`card st-${r.status}${dragId === r.id ? " dragging" : ""}`}
                  draggable
                  onDragStart={(e) => { setDragId(r.id); e.dataTransfer.effectAllowed = "move"; }}
                  onDragEnd={() => setDragId(null)}
                  onClick={() => { setOpenId(r.id); setConflict(null); }}
                >
                  <span className="row">
                    <b>{displayName(r)}</b>
                    {r.status === "ny" ? <small>{rel(r.created_at)}</small> : r.price_ex_vat != null ? <small className="mono">{kr(r.price_ex_vat)}</small> : null}
                  </span>
                  <span className="row">
                    <small>{productLabel(r, products)}</small>
                    <span className="tag">{r.customer_type === "privat" ? "Privat" : "Bedrift"}</span>
                  </span>
                  <small className="mono">{when(r)}</small>
                </button>
              ))}
            </section>
          );
        })}
      </div>

      {open && (
        <Drawer
          key={open.id}
          r={open}
          products={products}
          conflict={conflict?.id === open.id ? conflict.with : null}
          onClose={() => { setOpenId(null); setConflict(null); }}
          onMove={(to, force) => move(open, to, force)}
          onCancelConflict={() => setConflict(null)}
          onSaved={(next, msg) => { setRequests((rs) => rs.map((x) => (x.id === next.id ? next : x))); flash(msg); }}
          onError={flash}
          orgSlug={orgSlug}
          fikenReady={fikenReady}
          allRequests={requests}
          onStatus={(status) => setRequests((rs) => rs.map((x) => (x.id === open.id ? { ...x, status } : x)))}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}

function Drawer({
  r, products, conflict, onClose, onMove, onCancelConflict, onSaved, onError, orgSlug, fikenReady, allRequests, onStatus,
}: {
  orgSlug: string;
  fikenReady: boolean;
  allRequests: BookingRequest[];
  onStatus: (s: RequestStatus) => void;
  r: BookingRequest;
  products: Product[];
  conflict: BookingRequest[] | null;
  onClose: () => void;
  onMove: (to: RequestStatus, force?: boolean) => void;
  onCancelConflict: () => void;
  onSaved: (r: BookingRequest, msg: string) => void;
  onError: (msg: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [f, setF] = useState({
    product_id: r.product_id ?? "",
    other_text: r.other_text ?? "",
    date: dateOf(r),
    start_time: r.start_time?.slice(0, 5) ?? "",
    duration_h: r.duration_min ? String(r.duration_min / 60) : "",
    price: r.price_ex_vat != null ? String(r.price_ex_vat) : "",
    customer_type: r.customer_type,
    notes: r.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [fkBusy, setFkBusy] = useState(false);
  const [fkMsg, setFkMsg] = useState("");
  const [fkError, setFkError] = useState("");
  const [acceptConflict, setAcceptConflict] = useState<BookingRequest[] | null>(null);

  const loadOffers = useMemo(() => async () => {
    const { data } = await supabase.from("offers").select("*").eq("request_id", r.id).order("created_at", { ascending: false });
    setOffers((data ?? []) as Offer[]);
  }, [supabase, r.id]);
  useEffect(() => { loadOffers(); }, [loadOffers]);

  async function fikenCall(path: "offer" | "accept", body: unknown) {
    setFkBusy(true); setFkError(""); setFkMsg("");
    const res = await fetch(`/api/admin/${orgSlug}/requests/${r.id}/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    setFkBusy(false);
    if (!res.ok) { setFkError(j.error ?? "Noe gikk galt"); return null; }
    return j;
  }

  async function makeOffer(send: boolean) {
    await save(true);
    const j = await fikenCall("offer", { send, message: offerMsg || undefined });
    if (!j) return;
    if (j.warning) setFkError(j.warning);
    else setFkMsg(send ? `Tilbud #${j.offerNumber} er sendt til ${r.email}.` : `Tilbud #${j.offerNumber} ligger i Fiken. Send det derfra, og merk kortet som «Tilbud sendt».`);
    if (j.sent) onStatus("tilbud");
    loadOffers(); loadLog();
  }

  async function accept(force = false) {
    if (!force) {
      const c = conflictsWith(r, allRequests);
      if (c.length) { setAcceptConflict(c); return; }
    }
    setAcceptConflict(null);
    const j = await fikenCall("accept", {});
    if (!j) return;
    onStatus("bekreftet");
    setFkMsg("Ordrebekreftelse opprettet i Fiken. Avtalen ligger i kalenderen.");
    loadOffers(); loadLog();
  }

  const [offerMsg, setOfferMsg] = useState("");

  const loadLog = useMemo(() => async () => {
    const { data } = await supabase.from("request_log").select("*").eq("request_id", r.id).order("created_at", { ascending: false });
    setLog((data ?? []) as LogEntry[]);
  }, [supabase, r.id]);

  useEffect(() => { loadLog(); }, [loadLog, r.status]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const product = products.find((p) => p.id === (f.product_id || r.product_id));
  const vat = product?.vat_rate ?? 25;
  const priceNum = f.price === "" ? null : Number(f.price);

  async function save(quiet = false) {
    const patch: Partial<BookingRequest> = {};
    const changes: string[] = [];
    if ((f.product_id || null) !== r.product_id && f.product_id) {
      patch.product_id = f.product_id; patch.other_text = null;
      changes.push("produkt → " + products.find((p) => p.id === f.product_id)?.name);
    }
    if (!r.product_id && !f.product_id && f.other_text.trim() !== (r.other_text ?? "")) {
      patch.other_text = f.other_text.trim(); changes.push("beskrivelse oppdatert");
    }
    if (f.date && f.date !== dateOf(r)) { patch.agreed_date = f.date; changes.push("dato → " + f.date); }
    const st = f.start_time || null;
    if (st !== (r.start_time?.slice(0, 5) ?? null)) { patch.start_time = st; changes.push(st ? "start → " + st : "satt til hele dagen"); }
    const dm = f.duration_h === "" ? null : Math.round(Number(f.duration_h) * 60);
    if (dm !== r.duration_min) { patch.duration_min = dm; changes.push(dm ? `varighet → ${dm / 60} t` : "varighet fjernet"); }
    if (priceNum !== (r.price_ex_vat == null ? null : Number(r.price_ex_vat))) { patch.price_ex_vat = priceNum; changes.push("pris → " + kr(priceNum) + " ekskl. mva"); }
    if (f.customer_type !== r.customer_type) { patch.customer_type = f.customer_type; changes.push("kundetype → " + f.customer_type); }
    if (f.notes !== (r.notes ?? "")) { patch.notes = f.notes; changes.push("notater oppdatert"); }

    if (!changes.length) { if (!quiet) onSaved(r, "Ingen endringer"); return; }
    setSaving(true);
    const { data, error } = await supabase.from("requests").update(patch).eq("id", r.id).select("*").single();
    if (error) { setSaving(false); onError("Kunne ikke lagre: " + error.message); return; }
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("request_log").insert({
      request_id: r.id, org_id: r.org_id, actor: user?.id,
      message: "Endret: " + changes.join(", ") + (r.status === "bekreftet" ? " · kalenderen oppdatert" : ""),
    });
    setSaving(false);
    onSaved(data as BookingRequest, "Endringer lagret");
    loadLog();
  }

  const moves: { to: RequestStatus; label: string; kind?: string }[] = [];
  switch (r.status) {
    case "ny": moves.push({ to: "kontaktet", label: "Merk som kontaktet →", kind: "primary" }, { to: "avslatt", label: "Avslå", kind: "danger" }); break;
    case "kontaktet": moves.push({ to: "ny", label: "← Ny" }, { to: "tilbud", label: "Merk tilbud sendt →" }, { to: "bekreftet", label: "Bekreft og legg i kalender", kind: "primary" }, { to: "avslatt", label: "Avslå", kind: "danger" }); break;
    case "tilbud": moves.push({ to: "kontaktet", label: "← Kontaktet" },
      offers.length && fikenReady
        ? { to: "bekreftet", label: "Bekreft uten ordrebekreftelse" }
        : { to: "bekreftet", label: "Kunden har akseptert – bekreft →", kind: "primary" },
      { to: "avslatt", label: "Kunden takket nei", kind: "danger" }); break;
    case "bekreftet": moves.push({ to: "kontaktet", label: "← Opphev bekreftelse" }, { to: "avslatt", label: "Avlys", kind: "danger" }); break;
    case "avslatt": moves.push({ to: "kontaktet", label: "Hent tilbake til Kontaktet" }); break;
  }
  const s = STATUSES.find((x) => x.key === r.status)!;

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className={`drawer st-${r.status}`} role="dialog" aria-label="Forespørsel">
        <div className="drawer-h">
          <div className="stack">
            <span className="status-pill">{s.short !== "–" ? `${s.short} · ` : ""}{s.label}</span>
            <h2>{displayName(r)}</h2>
            <span className="muted">{productLabel(r, products)} · {r.category}</span>
          </div>
          <button className="btn small" onClick={onClose}>Lukk</button>
        </div>

        {conflict && (
          <div className="alert">
            <b>Kollisjon i kalenderen</b>
            <span>{conflict.map((o) => `${displayName(o)} – ${when(o)}`).join(" · ")}</span>
            <div className="moves">
              <button className="btn small" onClick={onCancelConflict}>Avbryt og juster</button>
              <button className="btn small primary" onClick={() => onMove("bekreftet", true)}>Bekreft likevel</button>
            </div>
          </div>
        )}

        <div className="moves">
          {moves.map((m) => (
            <button key={m.to + m.label} className={`btn ${m.kind ?? ""}`} onClick={() => onMove(m.to)}>{m.label}</button>
          ))}
        </div>

        <FikenPanel
          r={r}
          offers={offers}
          fikenReady={fikenReady}
          orgSlug={orgSlug}
          busy={fkBusy}
          msg={fkMsg}
          error={fkError}
          offerMsg={offerMsg}
          setOfferMsg={setOfferMsg}
          hasPrice={f.price !== "" || product?.price_ex_vat != null}
          onOffer={makeOffer}
          onAccept={() => accept(false)}
          acceptConflict={acceptConflict}
          onAcceptForce={() => accept(true)}
          onAcceptCancel={() => setAcceptConflict(null)}
        />

        <dl className="contact">
          <dt>Kundetype</dt><dd>{r.customer_type === "privat" ? "Privatperson" : "Bedrift" + (r.orgnr ? ` · org.nr ${r.orgnr}` : "")}</dd>
          <dt>E-post</dt><dd>{r.email}</dd>
          <dt>Telefon</dt><dd className="mono">{r.phone || "–"}</dd>
          <dt>Sted</dt><dd>{r.place || "–"}</dd>
          <dt>Ønsket dato</dt><dd>{r.wanted_date}</dd>
          <dt>Melding</dt><dd className="prewrap">{r.message || "–"}</dd>
        </dl>

        <div className="label">Avtale {r.status === "bekreftet" ? "(endringer oppdaterer kalenderen)" : "(kan justeres)"}</div>
        <div className="grid2">
          <div className="field">
            <label htmlFor="d-prod">Produkt</label>
            <select id="d-prod" value={f.product_id} onChange={(e) => setF({ ...f, product_id: e.target.value })}>
              {!r.product_id && <option value="">Annet (kundens beskrivelse)</option>}
              {["Film", "Foto", "Foto + video"].map((c) => {
                const g = products.filter((p) => p.category === c && (p.active || p.id === r.product_id));
                return g.length ? (
                  <optgroup key={c} label={c}>
                    {g.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </optgroup>
                ) : null;
              })}
            </select>
          </div>
          {!r.product_id && !f.product_id && (
            <div className="field">
              <label htmlFor="d-other">Kunden ønsker</label>
              <input id="d-other" value={f.other_text} onChange={(e) => setF({ ...f, other_text: e.target.value })} />
            </div>
          )}
          <div className="field">
            <label htmlFor="d-date">Dato</label>
            <input id="d-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="d-time">Starttid <span className="muted">(tom = hele dagen)</span></label>
            <input id="d-time" type="time" step={900} value={f.start_time} onChange={(e) => setF({ ...f, start_time: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="d-dur">Varighet, timer</label>
            <input id="d-dur" type="number" min={0.5} step={0.5} placeholder="Ukjent" value={f.duration_h} onChange={(e) => setF({ ...f, duration_h: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="d-price">Avtalt pris ekskl. mva</label>
            <input id="d-price" type="number" step={500} placeholder={product?.price_ex_vat != null ? String(product.price_ex_vat) : ""} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
            <small className="muted">{priceNum != null ? `= ${kr(withVat(priceNum, vat))} inkl. ${vat} % mva` : `Mva ${vat} % fra produktet`}</small>
          </div>
          <div className="field">
            <label htmlFor="d-ctype">Kundetype</label>
            <select id="d-ctype" value={f.customer_type} onChange={(e) => setF({ ...f, customer_type: e.target.value as BookingRequest["customer_type"] })}>
              <option value="privat">Privatperson</option>
              <option value="bedrift">Bedrift</option>
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="d-notes">Interne notater</label>
          <textarea id="d-notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Hva er avtalt, hva gjenstår …" />
        </div>
        <div><button className="btn" onClick={() => save()} disabled={saving}>{saving ? "Lagrer …" : "Lagre endringer"}</button></div>

        <div className="label">Historikk</div>
        <ul className="log">
          {log.map((l) => <li key={l.id}><span className="mono muted">{stamp(l.created_at)}</span><span>{l.message}</span></li>)}
        </ul>
      </aside>
    </>
  );
}

function FikenPanel({
  r, offers, fikenReady, orgSlug, busy, msg, error, offerMsg, setOfferMsg, hasPrice,
  onOffer, onAccept, acceptConflict, onAcceptForce, onAcceptCancel,
}: {
  r: BookingRequest; offers: Offer[]; fikenReady: boolean; orgSlug: string; busy: boolean;
  msg: string; error: string; offerMsg: string; setOfferMsg: (s: string) => void; hasPrice: boolean;
  onOffer: (send: boolean) => void; onAccept: () => void;
  acceptConflict: BookingRequest[] | null; onAcceptForce: () => void; onAcceptCancel: () => void;
}) {
  const canOffer = ["ny", "kontaktet", "tilbud"].includes(r.status);
  if (!canOffer && offers.length === 0) return null;
  const latest = offers[0];

  return (
    <section className="fiken">
      <div className="fiken-h"><span className="fk">Fiken</span><b>{latest ? `Tilbud #${latest.fiken_offer_number}` : "Tilbud"}</b></div>

      {offers.length > 0 && (
        <ul className="plain small">
          {offers.map((o) => (
            <li key={o.id}>
              <span className="mono">#{o.fiken_offer_number}</span> · {kr(o.total_inc_vat)} inkl. mva ·{" "}
              {o.accepted_at ? <b>Akseptert {stamp(o.accepted_at)}</b> : o.sent_at ? `Sendt ${stamp(o.sent_at)} til ${o.sent_to}` : "Ikke sendt fra Bookingflyt"}
              {o.fiken_order_confirmation_id ? " · ordrebekreftelse laget" : ""}
            </li>
          ))}
        </ul>
      )}

      {!fikenReady && canOffer && (
        <p className="small muted" style={{ margin: 0 }}>
          Koble bedriften til Fiken under <Link href={`/admin/${orgSlug}/innstillinger`}>Innstillinger</Link> for å lage tilbud herfra.
        </p>
      )}

      {fikenReady && r.status === "tilbud" && latest && !latest.accepted_at && (
        <>
          {acceptConflict ? (
            <div className="alert">
              <b>Kollisjon i kalenderen</b>
              <span>{acceptConflict.map((o) => `${displayName(o)} – ${when(o)}`).join(" · ")}</span>
              <div className="moves">
                <button className="btn small" onClick={onAcceptCancel}>Avbryt og juster</button>
                <button className="btn small primary" disabled={busy} onClick={onAcceptForce}>Bekreft likevel</button>
              </div>
            </div>
          ) : (
            <div className="moves">
              <button className="btn primary" disabled={busy} onClick={onAccept}>
                {busy ? "Lager ordrebekreftelse …" : "Kunden har akseptert → ordrebekreftelse og bekreft"}
              </button>
            </div>
          )}
        </>
      )}

      {fikenReady && canOffer && (
        <details open={offers.length === 0}>
          <summary className="small">{offers.length ? "Lag nytt tilbud (f.eks. etter endret pris)" : "Lag tilbud i Fiken"}</summary>
          <div className="stack" style={{ marginTop: 8 }}>
            {!hasPrice && <p className="error small">Sett avtalt pris under før du lager tilbud.</p>}
            <div className="field">
              <label htmlFor="fk-msg">Melding til kunden i e-posten (valgfritt)</label>
              <textarea id="fk-msg" rows={3} value={offerMsg} onChange={(e) => setOfferMsg(e.target.value)}
                placeholder={`Hei ${r.contact_name.split(" ")[0]}! Takk for hyggelig prat. Her er tilbudet vi snakket om.`} />
            </div>
            <div className="moves">
              <button className="btn primary" disabled={busy || !hasPrice} onClick={() => onOffer(true)}>
                {busy ? "Jobber mot Fiken …" : `Lag og send til ${r.email}`}
              </button>
              <button className="btn" disabled={busy || !hasPrice} onClick={() => onOffer(false)}>Lag uten å sende</button>
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              Endringer i feltene under lagres først. Kunden opprettes i Fiken hvis den ikke finnes. Fiken sender tilbudet som PDF.
            </p>
          </div>
        </details>
      )}

      {msg && <p className="small" role="status" style={{ margin: 0 }}>{msg}</p>}
      {error && <p className="error small" role="alert">{error}</p>}
    </section>
  );
}
