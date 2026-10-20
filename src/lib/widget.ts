import { NextResponse } from "next/server";
import type { Organization } from "./types";

/** Godkjente opphav for en bedrift. I utvikling tillates også localhost. */
export function originAllowed(org: Pick<Organization, "allowed_origins">, origin: string | null, selfOrigin?: string) {
  if (!origin) return false;
  if (selfOrigin && origin === selfOrigin) return true; // appens egen forhåndsvisning
  if (org.allowed_origins.includes(origin)) return true;
  if (process.env.NODE_ENV !== "production" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return false;
}

export function cors(res: NextResponse, origin: string | null) {
  if (origin) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Vary", "Origin");
    res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.headers.set("Access-Control-Allow-Headers", "Content-Type");
    res.headers.set("Access-Control-Max-Age", "86400");
  }
  return res;
}

export function json(body: unknown, status: number, origin: string | null) {
  return cors(NextResponse.json(body, { status }), origin);
}

const s = (v: unknown, max: number) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

export interface WidgetSubmission {
  customer_type: "privat" | "bedrift";
  category: string;
  product_id: string | null;
  other_text: string | null;
  message: string | null;
  wanted_date: string;
  place: string | null;
  company_name: string | null;
  orgnr: string | null;
  contact_name: string;
  email: string;
  phone: string | null;
}

/** Validerer innsendt skjema. Returnerer feilmelding på norsk eller ferdig rensede data. */
export function parseSubmission(body: Record<string, unknown>):
  { ok: true; data: WidgetSubmission } | { ok: false; error: string } {
  const customer_type = body.customer_type === "bedrift" ? "bedrift" : "privat";
  const category = s(body.category, 40);
  const product_id = s(body.product_id, 40) || null;
  const other_text = s(body.other_text, 200) || null;
  const wanted_date = s(body.wanted_date, 10);
  const contact_name = s(body.contact_name, 120);
  const email = s(body.email, 200).toLowerCase();

  if (!category) return { ok: false, error: "Velg hva forespørselen gjelder." };
  if (!product_id && !other_text) return { ok: false, error: "Velg en tjeneste, eller beskriv hva du trenger." };
  if (product_id && !/^[0-9a-f-]{36}$/i.test(product_id)) return { ok: false, error: "Ukjent tjeneste." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(wanted_date) || isNaN(Date.parse(wanted_date)))
    return { ok: false, error: "Velg en gyldig dato." };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (new Date(wanted_date) < today) return { ok: false, error: "Datoen har allerede vært." };
  if (!contact_name) return { ok: false, error: "Fyll inn navn." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: "Fyll inn en gyldig e-postadresse." };

  const orgnr = s(body.orgnr, 20).replace(/\s/g, "") || null;
  if (orgnr && !/^\d{9}$/.test(orgnr)) return { ok: false, error: "Org.nr skal ha 9 siffer." };

  return {
    ok: true,
    data: {
      customer_type,
      category,
      product_id,
      other_text,
      message: s(body.message, 4000) || null,
      wanted_date,
      place: s(body.place, 200) || null,
      company_name: customer_type === "bedrift" ? s(body.company_name, 160) || null : null,
      orgnr: customer_type === "bedrift" ? orgnr : null,
      contact_name,
      email,
      phone: s(body.phone, 40) || null,
    },
  };
}
