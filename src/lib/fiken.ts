import "server-only";

// Liten klient for Fiken API v2 (https://api.fiken.no/api/v2/docs/).
// Beløp sendes i øre. Nye ressurser returnerer 201 med Location-header som peker på ressursen.

const BASE = process.env.FIKEN_API_BASE ?? "https://api.fiken.no/api/v2";

export class FikenError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export type VatType = "HIGH" | "MEDIUM" | "LOW" | "NONE";
export function vatTypeFor(rate: number): VatType {
  if (rate === 25) return "HIGH";
  if (rate === 15) return "MEDIUM";
  if (rate === 12) return "LOW";
  return "NONE";
}
export function defaultIncomeAccount(rate: number) {
  return rate > 0 ? "3000" : "3100";
}

export interface FikenCompany { name: string; slug: string; organizationNumber?: string }
export interface FikenContact { contactId: number; name: string; email?: string; organizationNumber?: string; customer?: boolean }
export interface FikenOffer { offerId: number; offerNumber: number; net: number; vat: number; gross: number; contactId?: number }
export interface DraftLine {
  description: string;
  unitPrice: number; // øre, ekskl. mva
  quantity: number;
  vatType: VatType;
  incomeAccount: string;
  comment?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function fiken(token: string) {
  async function call<T>(method: string, path: string, body?: unknown): Promise<{ data: T | null; location: string | null }> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(BASE + path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
      // Fiken tillater bare én forespørsel om gangen per bruker; vent litt og prøv igjen
      if (res.status === 429 && attempt < 2) { await sleep(800 * (attempt + 1)); continue; }
      if (!res.ok) {
        let msg = `Fiken svarte ${res.status}`;
        try {
          const j = await res.json();
          msg = j.error_description ?? j.message ?? j.error ?? msg;
        } catch { /* ingen JSON */ }
        if (res.status === 401) msg = "Fiken avviste API-nøkkelen. Lag en ny nøkkel i Fiken og koble til på nytt.";
        if (res.status === 403) msg = "Fiken nektet tilgang. Sjekk at API-modulen er aktivert for selskapet.";
        throw new FikenError(res.status, msg);
      }
      const text = await res.text();
      return { data: text ? (JSON.parse(text) as T) : null, location: res.headers.get("location") };
    }
    throw new FikenError(429, "Fiken er opptatt. Prøv igjen om litt.");
  }

  const idFrom = (location: string | null) => {
    const id = Number(location?.split("/").filter(Boolean).pop());
    if (!id) throw new FikenError(500, "Fiken returnerte ikke ID for det som ble opprettet");
    return id;
  };

  return {
    async companies() {
      return (await call<FikenCompany[]>("GET", "/companies")).data ?? [];
    },

    /** Finner kunde på org.nr eller e-post, ellers opprettes en ny. */
    async findOrCreateCustomer(slug: string, c: { name: string; email: string; organizationNumber?: string | null; phoneNumber?: string | null }) {
      const s = encodeURIComponent(slug);
      const searches: string[] = [];
      if (c.organizationNumber) searches.push(`organizationNumber=${encodeURIComponent(c.organizationNumber)}`);
      searches.push(`email=${encodeURIComponent(c.email)}`);
      for (const q of searches) {
        const found = (await call<FikenContact[]>("GET", `/companies/${s}/contacts?${q}&customer=true&pageSize=5`)).data ?? [];
        if (found.length) return found[0].contactId;
      }
      const { location } = await call("POST", `/companies/${s}/contacts`, {
        name: c.name,
        email: c.email,
        organizationNumber: c.organizationNumber || undefined,
        phoneNumber: c.phoneNumber || undefined,
        customer: true,
      });
      return idFrom(location);
    },

    async createOffer(slug: string, d: { customerId: number; lines: DraftLine[]; text?: string; yourReference?: string; daysValid?: number }) {
      const s = encodeURIComponent(slug);
      const draft = await call("POST", `/companies/${s}/offers/drafts`, {
        type: "offer",
        customerId: d.customerId,
        daysUntilDueDate: d.daysValid ?? 14,
        invoiceText: d.text,
        yourReference: d.yourReference,
        currency: "NOK",
        lines: d.lines,
      });
      const draftId = idFrom(draft.location);
      const created = await call("POST", `/companies/${s}/offers/drafts/${draftId}/createOffer`);
      const offerId = idFrom(created.location);
      const offer = (await call<FikenOffer>("GET", `/companies/${s}/offers/${offerId}`)).data!;
      return offer;
    },

    async sendOffer(slug: string, d: { offerId: number; email: string; name: string; message?: string }) {
      await call("POST", `/companies/${encodeURIComponent(slug)}/offers/send`, {
        offerId: d.offerId,
        method: ["email"],
        recipientEmail: d.email,
        recipientName: d.name,
        message: d.message,
        includeDocumentAttachments: true,
        emailSendOption: "attachment",
      });
    },

    async createOrderConfirmation(slug: string, d: { customerId: number; lines: DraftLine[]; text?: string; yourReference?: string }) {
      const s = encodeURIComponent(slug);
      const draft = await call("POST", `/companies/${s}/orderConfirmations/drafts`, {
        type: "order_confirmation",
        customerId: d.customerId,
        daysUntilDueDate: 14,
        invoiceText: d.text,
        yourReference: d.yourReference,
        currency: "NOK",
        lines: d.lines,
      });
      const draftId = idFrom(draft.location);
      const created = await call("POST", `/companies/${s}/orderConfirmations/drafts/${draftId}/createOrderConfirmation`);
      return idFrom(created.location);
    },
  };
}
