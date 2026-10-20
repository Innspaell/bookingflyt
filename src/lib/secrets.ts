import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Krypterer hemmeligheter (som Fiken-nøkkelen) før de lagres i databasen.
// Nøkkelen ligger bare i Vercel (SECRETS_KEY), så en databaselekkasje alene avslører ingenting.

function key() {
  const raw = process.env.SECRETS_KEY;
  if (!raw) throw new Error("SECRETS_KEY mangler i miljøvariablene");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("SECRETS_KEY må være 32 byte, base64-kodet");
  return k;
}

export function encrypt(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decrypt(stored: string) {
  const [v, iv, tag, ct] = stored.split(":");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Ukjent format på lagret hemmelighet");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}
