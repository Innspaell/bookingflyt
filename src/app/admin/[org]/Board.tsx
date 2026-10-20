"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { STATUSES, type BookingRequest, type LogEntry, type Product, type RequestStatus } from "@/lib/types";
import { conflictsWith, dateOf, displayName, kr, productLabel, rel, stamp, when, withVat } from "@/lib/format";

export function Board({
  orgId,
  initialRequests,
  products,
  initialOpen,
}: {
  orgId: string;
  initialRequests: BookingRequest[];
  products: Product[];
  initialOpen: string | null;
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
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}

function Drawer({
  r, products, conflict, onClose, onMove, onCancelConflict, onSaved, onError,
}: {
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

  async function save() {
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

    if (!changes.length) { onSaved(r, "Ingen endringer"); return; }
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
    case "tilbud": moves.push({ to: "kontaktet", label: "← Kontaktet" }, { to: "bekreftet", label: "Kunden har akseptert – bekreft →", kind: "primary" }, { to: "avslatt", label: "Kunden takket nei", kind: "danger" }); break;
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
        <div><button className="btn" onClick={save} disabled={saving}>{saving ? "Lagrer …" : "Lagre endringer"}</button></div>

        <div className="label">Historikk</div>
        <ul className="log">
          {log.map((l) => <li key={l.id}><span className="mono muted">{stamp(l.created_at)}</span><span>{l.message}</span></li>)}
        </ul>
      </aside>
    </>
  );
}
