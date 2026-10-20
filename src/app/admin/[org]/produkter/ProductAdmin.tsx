"use client";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CATEGORIES, VAT_RATES, type Product } from "@/lib/types";
import { kr } from "@/lib/format";

export function ProductAdmin({ orgId, initial }: { orgId: string; initial: Product[] }) {
  const supabase = useMemo(() => createClient(), []);
  const [products, setProducts] = useState(initial);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [n, setN] = useState({ name: "", category: CATEGORIES[0] as string, booking_type: "avtales", price: "", vat: "25" });

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 2400); };

  async function patch(p: Product, change: Partial<Product>, okMsg: string) {
    setProducts((ps) => ps.map((x) => (x.id === p.id ? { ...x, ...change } : x)));
    const { error } = await supabase.from("products").update(change).eq("id", p.id);
    if (error) { setProducts((ps) => ps.map((x) => (x.id === p.id ? p : x))); flash("Kunne ikke lagre: " + error.message); }
    else flash(okMsg);
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!n.name.trim()) return;
    const { data, error } = await supabase.from("products").insert({
      org_id: orgId,
      name: n.name.trim(),
      category: n.category,
      booking_type: n.booking_type,
      price_ex_vat: n.price === "" ? null : Number(n.price),
      vat_rate: Number(n.vat),
      sort_order: products.filter((p) => p.category === n.category).length + 1,
    }).select("*").single();
    if (error) { flash("Kunne ikke legge til: " + error.message); return; }
    setProducts((ps) => [...ps, data as Product]);
    setN({ ...n, name: "", price: "" });
    flash(`${data.name} lagt til – vises nå i skjemaet`);
  }

  async function remove(p: Product) {
    setConfirmDel(null);
    const { count } = await supabase.from("requests").select("id", { count: "exact", head: true }).eq("product_id", p.id);
    if ((count ?? 0) > 0) {
      await patch(p, { active: false }, "Har forespørsler – skjult i stedet for slettet");
      return;
    }
    const { error } = await supabase.from("products").delete().eq("id", p.id);
    if (error) { flash("Kunne ikke slette: " + error.message); return; }
    setProducts((ps) => ps.filter((x) => x.id !== p.id));
    flash("Slettet " + p.name);
  }

  const sorted = CATEGORIES.flatMap((c) => products.filter((p) => p.category === c));

  return (
    <>
      <div className="sectionhead">
        <p className="muted">
          Det kunden kan velge i skjemaet. Skru av et produkt for å skjule det uten å miste gamle forespørsler.
          «Annet» vises alltid i skjemaet. Prisene er ekskl. mva, og mva-satsen følger produktet inn i tilbudet. «Konto i Fiken» er inntektskontoen; tom betyr 3000 (med mva) eller 3100 (uten mva).
        </p>
      </div>

      <form className="panel addform" onSubmit={add}>
        <div className="field"><label htmlFor="n-name">Navn</label>
          <input id="n-name" required placeholder="F.eks. Dronefilm" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></div>
        <div className="field"><label htmlFor="n-cat">Kategori</label>
          <select id="n-cat" value={n.category} onChange={(e) => setN({ ...n, category: e.target.value })}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select></div>
        <div className="field"><label htmlFor="n-type">Tidsramme</label>
          <select id="n-type" value={n.booking_type} onChange={(e) => setN({ ...n, booking_type: e.target.value })}>
            <option value="avtales">Avtales med kunden</option><option value="heldag">Heldag</option>
          </select></div>
        <div className="field"><label htmlFor="n-price">Veil. pris ekskl. mva</label>
          <input id="n-price" type="number" step={500} min={0} placeholder="kr" value={n.price} onChange={(e) => setN({ ...n, price: e.target.value })} /></div>
        <div className="field"><label htmlFor="n-vat">Mva</label>
          <select id="n-vat" value={n.vat} onChange={(e) => setN({ ...n, vat: e.target.value })}>
            {VAT_RATES.map((v) => <option key={v} value={v}>{v === 0 ? "Fritatt (0 %)" : `${v} %`}</option>)}
          </select></div>
        <button className="btn primary">Legg til</button>
      </form>

      <div className="tscroll">
        <table className="ptable">
          <thead><tr><th>Produkt</th><th>Kategori</th><th>Tidsramme</th><th>Veil. pris ekskl. mva</th><th>Mva</th><th>Konto i Fiken</th><th>Vises</th><th></th></tr></thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={p.id} className={p.active ? "" : "off"}>
                <td><b>{p.name}</b></td>
                <td>{p.category}</td>
                <td>
                  <select aria-label={`Tidsramme for ${p.name}`} value={p.booking_type}
                    onChange={(e) => patch(p, { booking_type: e.target.value as Product["booking_type"] }, "Lagret")}>
                    <option value="avtales">Avtales</option><option value="heldag">Heldag</option>
                  </select>
                </td>
                <td>
                  <input aria-label={`Pris for ${p.name}`} className="mono num" type="number" step={500} min={0}
                    defaultValue={p.price_ex_vat ?? ""}
                    onBlur={(e) => {
                      const v = e.target.value === "" ? null : Number(e.target.value);
                      if (v !== (p.price_ex_vat == null ? null : Number(p.price_ex_vat))) patch(p, { price_ex_vat: v }, `Pris: ${kr(v)}`);
                    }} />
                </td>
                <td>
                  <select aria-label={`Mva for ${p.name}`} value={p.vat_rate}
                    onChange={(e) => patch(p, { vat_rate: Number(e.target.value) }, "Mva oppdatert")}>
                    {VAT_RATES.map((v) => <option key={v} value={v}>{v === 0 ? "Fritatt" : `${v} %`}</option>)}
                  </select>
                </td>
                <td>
                  <input aria-label={`Inntektskonto for ${p.name}`} className="mono num" inputMode="numeric" maxLength={4}
                    placeholder={p.vat_rate > 0 ? "3000" : "3100"} defaultValue={p.income_account ?? ""}
                    onBlur={(e) => {
                      const v = e.target.value.trim() || null;
                      if (v && !/^\d{4}$/.test(v)) { flash("Kontonummer skal ha 4 siffer"); return; }
                      if (v !== p.income_account) patch(p, { income_account: v }, v ? `Konto ${v}` : "Standardkonto");
                    }} />
                </td>
                <td>
                  <button className="switch" role="switch" aria-checked={p.active} aria-label={`Vis ${p.name}`}
                    onClick={() => patch(p, { active: !p.active }, p.active ? `${p.name} er skjult` : `${p.name} vises`)} />
                </td>
                <td>
                  {confirmDel === p.id ? (
                    <span className="moves">
                      <button className="btn small danger" onClick={() => remove(p)}>Slett</button>
                      <button className="btn small" onClick={() => setConfirmDel(null)}>Avbryt</button>
                    </span>
                  ) : (
                    <button className="btn small" onClick={() => setConfirmDel(p.id)}>Slett</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {msg && <div className="toast" role="status">{msg}</div>}
    </>
  );
}
