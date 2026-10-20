"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { stamp } from "@/lib/format";

export type Role = "eier" | "admin" | "medarbeider";
export interface Member { user_id: string; email: string; role: Role; joined_at: string; last_sign_in_at: string | null }
export interface Invitation { email: string; role: Role; created_at: string }

const ROLE_LABEL: Record<Role, string> = { eier: "Eier", admin: "Admin", medarbeider: "Medarbeider" };
const ROLE_HINT: Record<Role, string> = {
  eier: "Alt, inkludert å gi og fjerne eierskap",
  admin: "Alt i bedriften, og kan invitere og fjerne brukere",
  medarbeider: "Tavle, kalender og produkter, men ikke brukere",
};

export function MemberAdmin({
  orgId, orgName, me, myRole, members, invitations, loginUrl,
}: {
  orgId: string; orgName: string; me: string; myRole: Role | null;
  members: Member[]; invitations: Invitation[]; loginUrl: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const canManage = myRole === "eier" || myRole === "admin";
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("admin");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string; link?: boolean } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function run(fn: () => PromiseLike<{ error: { message: string } | null; data?: unknown }>, ok: string, link = false) {
    setBusy(true);
    const { error, data } = await fn();
    setBusy(false);
    setConfirm(null);
    if (error) { setNotice({ kind: "error", text: error.message }); return null; }
    setNotice({ kind: "ok", text: ok, link });
    router.refresh();
    return data;
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    const addr = email.trim().toLowerCase();
    setBusy(true);
    const { data, error } = await supabase.rpc("invite_member", { p_org: orgId, p_email: addr, p_role: role });
    setBusy(false);
    if (error) { setNotice({ kind: "error", text: error.message }); return; }
    setEmail("");
    setNotice(
      data === "lagt_til"
        ? { kind: "ok", text: `${addr} hadde allerede konto og har nå tilgang til ${orgName}.` }
        : { kind: "ok", text: `${addr} er invitert. Send lenken under til personen. Hen logger inn med akkurat denne e-postadressen og får tilgang med en gang.`, link: true },
    );
    router.refresh();
  }

  async function copy() {
    try { await navigator.clipboard.writeText(loginUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  }

  const roleOptions: Role[] = myRole === "eier" ? ["eier", "admin", "medarbeider"] : ["admin", "medarbeider"];

  return (
    <>
      <div className="sectionhead">
        <p className="muted">
          Personene under har tilgang til <b>{orgName}</b> og ingenting annet. Hver bedrift har sin egen liste.
        </p>
      </div>

      {canManage ? (
        <form className="panel addform" onSubmit={invite}>
          <div className="field">
            <label htmlFor="inv-email">E-post</label>
            <input id="inv-email" type="email" required placeholder="navn@firma.no" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="inv-role">Rolle</label>
            <select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {roleOptions.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </div>
          <button className="btn primary" disabled={busy}>Inviter</button>
          <p className="muted small" style={{ gridColumn: "1 / -1", margin: 0 }}>{ROLE_LABEL[role]}: {ROLE_HINT[role]}.</p>
        </form>
      ) : (
        <p className="muted small">Du er medarbeider. Be en eier eller admin om å invitere nye brukere.</p>
      )}

      {notice && (
        <div className={`panel notice ${notice.kind}`} role="status">
          <span>{notice.text}</span>
          {notice.link && (
            <div className="moves">
              <code className="code-inline">{loginUrl}</code>
              <button className="btn small" type="button" onClick={copy}>{copied ? "Kopiert" : "Kopier lenke"}</button>
            </div>
          )}
        </div>
      )}

      <div className="tscroll">
        <table className="ptable members">
          <thead><tr><th>E-post</th><th>Rolle</th><th>Sist innlogget</th><th></th></tr></thead>
          <tbody>
            {members.map((m) => {
              const self = m.user_id === me;
              const mayEditRole = canManage && !self && (myRole === "eier" || m.role !== "eier");
              const mayRemove = self || (canManage && (myRole === "eier" || m.role !== "eier"));
              return (
                <tr key={m.user_id}>
                  <td><b>{m.email}</b>{self && <span className="tag" style={{ marginLeft: 8 }}>Deg</span>}</td>
                  <td>
                    {mayEditRole ? (
                      <select aria-label={`Rolle for ${m.email}`} value={m.role} disabled={busy}
                        onChange={(e) => run(() => supabase.rpc("set_member_role", { p_org: orgId, p_user: m.user_id, p_role: e.target.value }), "Rollen er endret")}>
                        {(myRole === "eier" ? ["eier", "admin", "medarbeider"] : ["admin", "medarbeider"]).map((r) =>
                          <option key={r} value={r}>{ROLE_LABEL[r as Role]}</option>)}
                      </select>
                    ) : ROLE_LABEL[m.role]}
                  </td>
                  <td className="mono small">{m.last_sign_in_at ? stamp(m.last_sign_in_at) : "–"}</td>
                  <td>
                    {mayRemove && (confirm === m.user_id ? (
                      <span className="moves">
                        <button className="btn small danger" disabled={busy}
                          onClick={() => run(() => supabase.rpc("remove_member", { p_org: orgId, p_user: m.user_id }), self ? "Du har meldt deg ut" : `${m.email} har ikke lenger tilgang`)}>
                          {self ? "Meld meg ut" : "Fjern tilgang"}
                        </button>
                        <button className="btn small" onClick={() => setConfirm(null)}>Avbryt</button>
                      </span>
                    ) : (
                      <button className="btn small" onClick={() => setConfirm(m.user_id)}>{self ? "Meld meg ut …" : "Fjern …"}</button>
                    ))}
                  </td>
                </tr>
              );
            })}
            {invitations.map((i) => (
              <tr key={i.email} className="off">
                <td><b style={{ textDecoration: "none" }}>{i.email}</b><span className="tag" style={{ marginLeft: 8 }}>Invitert</span></td>
                <td>{ROLE_LABEL[i.role]}</td>
                <td className="small">Ikke logget inn ennå</td>
                <td>
                  {canManage && (
                    <button className="btn small" disabled={busy}
                      onClick={() => run(() => supabase.rpc("revoke_invitation", { p_org: orgId, p_email: i.email }), "Invitasjonen er trukket tilbake")}>
                      Trekk tilbake
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
