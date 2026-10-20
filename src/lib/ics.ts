// Lager en iCalendar-fil (RFC 5545) for kalenderabonnement.

export interface IcsEvent {
  uid: string;
  date: string;            // YYYY-MM-DD
  startTime: string | null; // HH:MM[:SS], null = hele dagen
  durationMin: number | null;
  summary: string;
  description?: string;
  location?: string | null;
  tentative?: boolean;
  updatedAt: string;       // ISO
}

const TZ = "Europe/Oslo";

/** Minutter Oslo ligger foran UTC på et gitt tidspunkt (60 om vinteren, 120 om sommeren). */
function osloOffsetMin(utcMs: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return Math.round((asUtc - utcMs) / 60000);
}

/** Norsk lokal dato og klokkeslett → UTC-tidspunkt. */
export function osloToUtc(date: string, time: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  // To runder gir riktig svar også rundt overgang til/fra sommertid
  let utc = naive - osloOffsetMin(naive) * 60000;
  utc = naive - osloOffsetMin(utc) * 60000;
  return new Date(utc);
}

const pad = (n: number) => String(n).padStart(2, "0");
const utcStamp = (d: Date) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const dateOnly = (iso: string) => iso.replace(/-/g, "");

function nextDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}`;
}

function escapeText(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Bryter linjer etter 75 byte, uten å dele flerbyte-tegn som æøå. */
function fold(line: string) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // fortsettelseslinjer starter med mellomrom
    if (bytes + b > limit) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function buildCalendar(name: string, events: IcsEvent[]) {
  const now = utcStamp(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Bookingflyt//NO",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
    `X-WR-TIMEZONE:${TZ}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT30M",
    "X-PUBLISHED-TTL:PT30M",
  ];
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${now}`, `LAST-MODIFIED:${utcStamp(new Date(e.updatedAt))}`);
    if (e.startTime) {
      const start = osloToUtc(e.date, e.startTime);
      const end = new Date(start.getTime() + (e.durationMin ?? 60) * 60000);
      lines.push(`DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(end)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${dateOnly(e.date)}`, `DTEND;VALUE=DATE:${nextDay(e.date)}`);
    }
    lines.push(`SUMMARY:${escapeText(e.summary)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    lines.push(`STATUS:${e.tentative ? "TENTATIVE" : "CONFIRMED"}`, `TRANSP:${e.tentative ? "TRANSPARENT" : "OPAQUE"}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
