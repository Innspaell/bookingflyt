"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        shouldCreateUser: true,
      },
    });
    if (error) {
      setError(error.message);
      setState("error");
    } else setState("sent");
  }

  return (
    <main className="center">
      <form className="panel narrow" onSubmit={submit}>
        <h1>Bookingflyt</h1>
        {state === "sent" ? (
          <p>Sjekk e-posten din. Vi har sendt en innloggingslenke til <b>{email}</b>.</p>
        ) : (
          <>
            <p className="muted">Logg inn med e-post. Du får en lenke, ingen passord.</p>
            <div className="field">
              <label htmlFor="email">E-post</label>
              <input id="email" type="email" required autoComplete="email" value={email}
                onChange={(e) => setEmail(e.target.value)} />
            </div>
            {state === "error" && <p className="error">{error}</p>}
            <button className="btn primary" disabled={state === "sending"}>
              {state === "sending" ? "Sender …" : "Send innloggingslenke"}
            </button>
          </>
        )}
      </form>
    </main>
  );
}
