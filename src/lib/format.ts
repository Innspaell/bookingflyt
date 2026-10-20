import type { BookingRequest, Product } from "./types";

const MND = ["jan", "feb", "mar", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "des"];
const DAG = ["søn", "man", "tir", "ons", "tor", "fre", "lør"];

export function kr(n: number | null | undefined) {
  if (n == null) return "–";
  return Number(n).toLocaleString("nb-NO", { maximumFractionDigits: 0 }) + " kr";
}

export function withVat(ex: number | null | undefined, rate: number) {
  return ex == null ? null : Math.round(Number(ex) * (1 + rate / 100));
}

export function fdate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const thisYear = new Date().getFullYear();
  return `${DAG[dt.getDay()]} ${d}. ${MND[m - 1]}${y !== thisYear ? " " + y : ""}`;
}

export function stamp(iso: string) {
  const d = new Date(iso);
  return `${d.getDate()}. ${MND[d.getMonth()]} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function rel(iso: string) {
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3600e3);
  if (h < 1) return "nå nettopp";
  if (h < 24) return `for ${h} t siden`;
  return `for ${Math.round(h / 24)} d siden`;
}

function addMin(t: string, min: number) {
  const [h, m] = t.split(":").map(Number);
  const x = h * 60 + m + min;
  return `${String(Math.floor(x / 60) % 24).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
}

export const dateOf = (r: BookingRequest) => r.agreed_date ?? r.wanted_date;

export function when(r: BookingRequest) {
  const d = fdate(dateOf(r));
  if (!r.start_time) return `${d} · hele dagen`;
  const s = r.start_time.slice(0, 5);
  return `${d} · ${s}${r.duration_min ? "–" + addMin(s, r.duration_min) : ""}`;
}

export function productLabel(r: BookingRequest, products: Product[]) {
  const p = r.product_id ? products.find((x) => x.id === r.product_id) : null;
  return p ? p.name : `Annet: ${r.other_text ?? "ikke beskrevet"}`;
}

export function displayName(r: BookingRequest) {
  return r.company_name ? `${r.company_name} v/ ${r.contact_name}` : r.contact_name;
}

function range(r: BookingRequest): [number, number] {
  if (!r.start_time) return [0, 1440];
  const [h, m] = r.start_time.split(":").map(Number);
  const s = h * 60 + m;
  return [s, s + (r.duration_min ?? 60)];
}

/** Bekreftede avtaler samme dag som overlapper i tid. */
export function conflictsWith(r: BookingRequest, all: BookingRequest[]) {
  const a = range(r);
  return all.filter((o) => {
    if (o.id === r.id || o.status !== "bekreftet" || dateOf(o) !== dateOf(r)) return false;
    const b = range(o);
    return a[0] < b[1] && b[0] < a[1];
  });
}
