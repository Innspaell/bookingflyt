/*! Bookingflyt-widget
 *  Bruk p\u00e5 nettsiden:
 *    <div id="bookingflyt"></div>
 *    <script src="https://DIN-APP.vercel.app/w.js" data-org="innspaell" defer></script>
 */
(function () {
  "use strict";
  var script = document.currentScript;
  if (!script) return;
  var ORG = script.getAttribute("data-org");
  var BASE = new URL(script.src).origin;
  var TARGET = script.getAttribute("data-target") || "bookingflyt";

  function mount() {
    var host = document.getElementById(TARGET);
    if (!host) {
      host = document.createElement("div");
      script.parentNode.insertBefore(host, script);
    }
    var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    root.innerHTML = '<style>' + CSS + '</style><div class="bf" aria-live="polite"><p class="muted">Laster skjema \u2026</p></div>';
    var el = root.querySelector(".bf");

    fetch(BASE + "/api/widget/" + encodeURIComponent(ORG), { credentials: "omit" })
      .then(function (r) { if (!r.ok) throw r; return r.json(); })
      .then(function (cfg) { render(el, cfg); })
      .catch(function () {
        el.innerHTML = '<p class="err">Skjemaet kunne ikke lastes akkurat n\u00e5. Pr\u00f8v \u00e5 laste siden p\u00e5 nytt.</p>';
      });
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function render(el, cfg) {
    el.style.setProperty("--wc", cfg.color);
    var cats = [];
    cfg.products.forEach(function (p) { if (cats.indexOf(p.category) < 0) cats.push(p.category); });
    cats.push("Annet");

    var st = { ctype: "privat", cat: cats[0], prod: null, draft: {} };

    function save() {
      el.querySelectorAll("input,textarea").forEach(function (i) { if (i.id) st.draft[i.id] = i.value; });
    }
    function restore() {
      Object.keys(st.draft).forEach(function (k) { var i = el.querySelector("#" + k); if (i) i.value = st.draft[k]; });
    }
    var today = new Date(); today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
    var minDate = today.toISOString().slice(0, 10);

    function draw() {
      var other = st.cat === "Annet" || st.prod === "annet";
      var list = cfg.products.filter(function (p) { return p.category === st.cat; });
      el.innerHTML =
        '<form novalidate>' +
        '<div class="head"><h2>' + esc(cfg.heading) + '</h2>' + (cfg.intro ? '<p class="muted">' + esc(cfg.intro) + '</p>' : '') + '</div>' +
        '<fieldset><legend>Jeg bestiller som</legend><div class="chips">' +
          [["privat", "Privatperson"], ["bedrift", "Bedrift / organisasjon"]].map(function (o) {
            return '<button type="button" class="chip" data-ct="' + o[0] + '" aria-pressed="' + (st.ctype === o[0]) + '">' + o[1] + '</button>';
          }).join("") +
        '</div></fieldset>' +
        '<fieldset><legend>Hva gjelder det?</legend><div class="chips">' +
          cats.map(function (c) { return '<button type="button" class="chip" data-cat="' + esc(c) + '" aria-pressed="' + (c === st.cat) + '">' + esc(c) + '</button>'; }).join("") +
        '</div>' +
        (st.cat !== "Annet" ? '<div class="prods">' +
          list.map(function (p) {
            return '<button type="button" class="prod" data-prod="' + p.id + '" aria-pressed="' + (p.id === st.prod) + '"><b>' + esc(p.name) + '</b>' + (p.booking_type === "heldag" ? "<span>Heldag</span>" : "") + '</button>';
          }).join("") +
          '<button type="button" class="prod" data-prod="annet" aria-pressed="' + (st.prod === "annet") + '"><b>Annet</b><span>Beskriv selv</span></button>' +
        '</div>' : '') +
        '</fieldset>' +
        (other ? field("bf-other", "Hva trenger du?", '<input id="bf-other" maxlength="200" placeholder="F.eks. livestream, dronefilm, minnefilm \u2026">') : "") +
        field("bf-msg", "Fortell litt mer", '<textarea id="bf-msg" maxlength="4000" placeholder="Tidspunkt, omtrent hvor lenge det varer (om du vet det), antall gjester, \u00f8nsker, budsjett \u2026"></textarea>') +
        '<div class="grid">' +
          field("bf-date", "\u00d8nsket dato", '<input id="bf-date" type="date" required min="' + minDate + '">') +
          field("bf-place", "Sted", '<input id="bf-place" maxlength="200" placeholder="Hvor skal det skje?">') +
        '</div>' +
        '<div class="grid">' +
          (st.ctype === "bedrift"
            ? field("bf-company", "Firma / organisasjon", '<input id="bf-company" autocomplete="organization" maxlength="160">') +
              field("bf-orgnr", "Org.nr (valgfritt)", '<input id="bf-orgnr" inputmode="numeric" maxlength="11">')
            : "") +
          field("bf-name", st.ctype === "bedrift" ? "Kontaktperson" : "Navn", '<input id="bf-name" autocomplete="name" required maxlength="120">') +
          field("bf-email", "E-post", '<input id="bf-email" type="email" autocomplete="email" required maxlength="200">') +
          field("bf-phone", "Telefon", '<input id="bf-phone" type="tel" autocomplete="tel" maxlength="40">') +
        '</div>' +
        '<div class="hp" aria-hidden="true"><label>Nettside<input id="bf-website" tabindex="-1" autocomplete="off"></label></div>' +
        '<p class="err" role="alert" hidden></p>' +
        '<button class="submit" type="submit"><span>Send foresp\u00f8rsel</span><span aria-hidden="true">\u2192</span></button>' +
        '</form>';
      restore();
    }
    function field(id, label, input) {
      return '<div class="field"><label for="' + id + '">' + label + '</label>' + input + '</div>';
    }

    el.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-ct],button[data-cat],button[data-prod]");
      if (!b) return;
      save();
      if (b.dataset.ct) st.ctype = b.dataset.ct;
      if (b.dataset.cat) { st.cat = b.dataset.cat; st.prod = null; }
      if (b.dataset.prod) st.prod = b.dataset.prod;
      draw();
    });

    el.addEventListener("submit", function (e) {
      e.preventDefault();
      save();
      var d = st.draft, err = el.querySelector(".err"), btn = el.querySelector(".submit");
      var other = st.cat === "Annet" || st.prod === "annet";
      var miss = [];
      if (!other && !st.prod) miss.push("velg tjeneste");
      if (other && !(d["bf-other"] || "").trim()) miss.push("skriv kort hva du trenger");
      if (!d["bf-date"]) miss.push("velg dato");
      if (!(d["bf-name"] || "").trim()) miss.push("fyll inn navn");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d["bf-email"] || "")) miss.push("fyll inn en gyldig e-post");
      if (miss.length) { err.hidden = false; err.textContent = "F\u00f8r du sender: " + miss.join(", ") + "."; return; }

      btn.disabled = true; btn.firstChild.textContent = "Sender \u2026";
      fetch(BASE + "/api/widget/" + encodeURIComponent(ORG) + "/requests", {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issued: cfg.issued,
          website: d["bf-website"] || "",
          customer_type: st.ctype,
          category: st.cat,
          product_id: other ? null : st.prod,
          other_text: other ? d["bf-other"] : null,
          message: d["bf-msg"],
          wanted_date: d["bf-date"],
          place: d["bf-place"],
          company_name: d["bf-company"],
          orgnr: d["bf-orgnr"],
          contact_name: d["bf-name"],
          email: d["bf-email"],
          phone: d["bf-phone"]
        })
      })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok) throw new Error(res.j.error || "Noe gikk galt.");
          el.innerHTML = '<div class="thanks"><h2>Takk, ' + esc((d["bf-name"] || "").split(" ")[0]) + '!</h2>' +
            '<p>Vi har f\u00e5tt foresp\u00f8rselen din og tar kontakt s\u00e5 snart vi kan.</p></div>';
        })
        .catch(function (x) {
          btn.disabled = false; btn.firstChild.textContent = "Send foresp\u00f8rsel";
          err.hidden = false; err.textContent = x.message || "Noe gikk galt. Pr\u00f8v igjen.";
        });
    });

    draw();
  }

  var CSS =
    ':host{all:initial;display:block}' +
    '.bf{--wc:#2f5d50;--fg:#1d2321;--muted:#5f6862;--line:#d6d9d3;--bg:#fff;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--fg)}' +
    'form,.thanks{display:flex;flex-direction:column;gap:16px;background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:clamp(16px,4vw,24px)}' +
    'h2{margin:0;font-size:1.35rem;line-height:1.25}' +
    '.head p,.thanks p{margin:4px 0 0}' +
    '.muted{color:var(--muted)}' +
    'fieldset{border:0;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;min-width:0}' +
    'legend{font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:600;padding:0;margin-bottom:8px}' +
    '.chips{display:flex;flex-wrap:wrap;gap:8px}' +
    'button{font:inherit;color:inherit;cursor:pointer}' +
    'button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--wc);outline-offset:2px}' +
    '.chip{border:1px solid var(--line);background:#fff;border-radius:999px;padding:6px 14px}' +
    '.chip[aria-pressed="true"]{background:var(--wc);border-color:var(--wc);color:#fff}' +
    '.prods{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px}' +
    '.prod{border:1px solid var(--line);background:#fff;border-radius:10px;padding:10px 12px;text-align:left;display:flex;flex-direction:column;gap:2px}' +
    '.prod span{font-size:.8rem;color:var(--muted)}' +
    '.prod[aria-pressed="true"]{border-color:var(--wc);box-shadow:inset 0 0 0 1px var(--wc)}' +
    '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}' +
    '.field{display:flex;flex-direction:column;gap:5px;min-width:0}' +
    'label{font-size:.85rem;font-weight:500}' +
    'input,textarea{font:inherit;color:inherit;background:#fff;border:1px solid var(--line);border-radius:8px;padding:9px 11px;width:100%;box-sizing:border-box}' +
    'textarea{min-height:90px;resize:vertical}' +
    '.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}' +
    '.err{color:#b42318;margin:0}' +
    '.err[hidden]{display:none}' +
    '.submit{background:var(--wc);color:#fff;border:0;border-radius:10px;padding:12px 16px;font-weight:600;display:flex;justify-content:space-between}' +
    '.submit:disabled{opacity:.6;cursor:wait}';

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
