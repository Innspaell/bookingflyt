import "server-only";
import { defaultIncomeAccount, vatTypeFor, type DraftLine } from "./fiken";
import type { BookingRequest, Product } from "./types";

const MND = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"];

export function longDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d}. ${MND[m - 1]} ${y}`;
}

/** Bygger linjene til tilbud/ordrebekreftelse fra kortet. */
export function linesFor(r: BookingRequest, p: Product | null): DraftLine[] {
  const price = r.price_ex_vat ?? p?.price_ex_vat;
  if (price == null) throw new Error("Sett avtalt pris på kortet før du lager tilbud");
  const vat = p?.vat_rate ?? 25;
  const date = r.agreed_date ?? r.wanted_date;
  const name = p?.name ?? (r.other_text ? r.other_text : "Oppdrag");
  const time = r.start_time
    ? `kl. ${r.start_time.slice(0, 5)}${r.duration_min ? `, ca. ${String(r.duration_min / 60).replace(".", ",")} t` : ""}`
    : p?.booking_type === "heldag" ? "hele dagen" : null;

  return [{
    description: `${name} – ${longDate(date)}`,
    comment: [time, r.place].filter(Boolean).join(" · ") || undefined,
    unitPrice: Math.round(Number(price) * 100),
    quantity: 1,
    vatType: vatTypeFor(vat),
    incomeAccount: p?.income_account || defaultIncomeAccount(vat),
  }];
}
