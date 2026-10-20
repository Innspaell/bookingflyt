export type RequestStatus = "ny" | "kontaktet" | "tilbud" | "bekreftet" | "avslatt";
export type CustomerType = "privat" | "bedrift";
export type BookingType = "heldag" | "avtales";

export const CATEGORIES = ["Film", "Foto", "Foto + video"] as const;
export type Category = (typeof CATEGORIES)[number];

export const VAT_RATES = [25, 15, 12, 0] as const;

export const STATUSES: { key: RequestStatus; label: string; short: string; hint: string }[] = [
  { key: "ny", label: "Nye forespørsler", short: "A", hint: "Ikke tatt kontakt ennå" },
  { key: "kontaktet", label: "Kontaktet", short: "B", hint: "Avklares – juster dato, pris og innhold" },
  { key: "tilbud", label: "Tilbud sendt", short: "B2", hint: "Venter på svar på tilbudet" },
  { key: "bekreftet", label: "Bekreftet", short: "C", hint: "Låst i kalenderen" },
  { key: "avslatt", label: "Avslått / arkiv", short: "–", hint: "Kan dras tilbake" },
];

export interface Organization {
  id: string;
  slug: string;
  name: string;
  domain: string | null;
  brand_color: string;
  widget_heading: string;
  widget_intro: string | null;
  allowed_origins: string[];
  notify_email: string | null;
}

export interface Product {
  id: string;
  org_id: string;
  category: Category;
  name: string;
  booking_type: BookingType;
  price_ex_vat: number | null;
  vat_rate: number;
  income_account: string | null;
  active: boolean;
  sort_order: number;
}

export interface BookingRequest {
  id: string;
  org_id: string;
  status: RequestStatus;
  product_id: string | null;
  category: string | null;
  other_text: string | null;
  wanted_date: string;
  place: string | null;
  message: string | null;
  customer_type: CustomerType;
  contact_name: string;
  company_name: string | null;
  orgnr: string | null;
  email: string;
  phone: string | null;
  agreed_date: string | null;
  start_time: string | null;
  duration_min: number | null;
  price_ex_vat: number | null;
  notes: string | null;
  fiken_contact_id: number | null;
  created_at: string;
  updated_at: string;
  status_changed_at: string;
}

export interface LogEntry {
  id: number;
  request_id: string;
  message: string;
  created_at: string;
}

export interface Offer {
  id: string;
  request_id: string;
  fiken_offer_id: number | null;
  fiken_offer_number: string | null;
  total_inc_vat: number | null;
  sent_to: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  fiken_order_confirmation_id: number | null;
  created_at: string;
}
