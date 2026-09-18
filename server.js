require("dotenv").config({ quiet: true });
const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "64kb" }));

const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set. Refusing to start.");
  process.exit(1);
}
if (!ADMIN_TOKEN) {
  console.warn("WARNING: ADMIN_TOKEN is not set — the admin endpoints are unprotected.");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS participations (
      id SERIAL PRIMARY KEY,
      firstname TEXT,
      result_name TEXT,
      result_tagline TEXT,
      answers JSONB,
      confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      ip TEXT
    );
  `);
}

// --- very small in-memory rate limiter (per IP) ---
const submissionLog = new Map(); // ip -> array of timestamps (ms)
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1h
const RATE_LIMIT_MAX = 20;

function isRateLimited(ip) {
  const now = Date.now();
  const arr = (submissionLog.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  arr.push(now);
  submissionLog.set(ip, arr);
  return arr.length > RATE_LIMIT_MAX;
}

function requireAdmin(req, res, next) {
  const token = req.query.token || req.get("x-admin-token") || "";
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
}

function clampString(v, max) {
  if (typeof v !== "string") return "";
  return v.slice(0, max);
}

// --- e-mail notification (Resend HTTP API — SMTP is blocked on Render's free plan) ---
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || "";
const MAIL_FROM = process.env.MAIL_FROM || "FIMANI Quiz <onboarding@resend.dev>";

if (!RESEND_API_KEY || !NOTIFY_EMAIL) {
  console.warn("RESEND_API_KEY / NOTIFY_EMAIL not set — result e-mails are disabled.");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function sendResultEmail({ firstname, resultName, resultTagline, resultDesc, answers, confirmedAt }) {
  if (!RESEND_API_KEY || !NOTIFY_EMAIL) return;

  const who = firstname || "Une participante";
  const answerRows = Object.keys(answers)
    .map((k) => `<tr><td style="padding:2px 12px 2px 0;color:#666">${escapeHtml(k)}</td><td>${escapeHtml(answers[k])}</td></tr>`)
    .join("");
  const html =
    `<h2>${escapeHtml(who)} a confirmé sa participation</h2>` +
    `<p><b>Profil :</b> ${escapeHtml(resultName)}<br><b>${escapeHtml(resultTagline)}</b></p>` +
    (resultDesc ? `<p>${escapeHtml(resultDesc)}</p>` : "") +
    `<h3>Ses réponses</h3><table>${answerRows}</table>` +
    `<p style="color:#666">Confirmé le ${escapeHtml(confirmedAt.toLocaleString("fr-FR", { timeZone: "Europe/Paris" }))}</p>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: MAIL_FROM,
      to: [NOTIFY_EMAIL],
      subject: `Résultat FIMANI — ${who} : ${resultName}`,
      html,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error("Resend responded " + res.status + ": " + (await res.text()));
  }
}

app.post("/api/participations", async (req, res) => {
  try {
    const ip = req.ip || "";
    if (isRateLimited(ip)) {
      return res.status(429).json({ ok: false, error: "rate_limited" });
    }

    const body = req.body || {};
    const firstname = clampString(body.firstname, 60);
    const resultName = clampString(body.resultName, 120);
    const resultTagline = clampString(body.resultTagline, 240);
    let answers = body.answers;
    if (typeof answers !== "object" || answers === null || Array.isArray(answers)) {
      answers = {};
    }
    // keep answers small & flat
    const safeAnswers = {};
    Object.keys(answers).slice(0, 40).forEach((k) => {
      const key = String(k).slice(0, 60);
      const val = answers[k];
      safeAnswers[key] = typeof val === "string" ? val.slice(0, 200) : val;
    });

    const confirmedAt = (() => {
      const d = new Date(body.confirmedAt);
      return isNaN(d.getTime()) ? new Date() : d;
    })();

    const result = await pool.query(
      `INSERT INTO participations (firstname, result_name, result_tagline, answers, confirmed_at, ip)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [firstname, resultName, resultTagline, JSON.stringify(safeAnswers), confirmedAt, ip]
    );

    // Fire and forget: a mail failure must never break the participant's confirmation.
    sendResultEmail({
      firstname,
      resultName,
      resultTagline,
      resultDesc: clampString(body.resultDesc, 1000),
      answers: safeAnswers,
      confirmedAt,
    }).catch((err) => console.error("Result e-mail failed:", err));

    res.json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    console.error("POST /api/participations failed:", err);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

app.get("/api/participations", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, firstname, result_name AS "resultName", result_tagline AS "resultTagline",
              answers, confirmed_at AS "confirmedAt"
       FROM participations ORDER BY confirmed_at DESC LIMIT 2000`
    );
    res.json({ ok: true, rows: result.rows });
  } catch (err) {
    console.error("GET /api/participations failed:", err);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

app.get("/api/participations.csv", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT firstname, result_name AS "resultName", result_tagline AS "resultTagline", confirmed_at AS "confirmedAt"
       FROM participations ORDER BY confirmed_at DESC LIMIT 5000`
    );
    const esc = (v) => '"' + String(v === null || v === undefined ? "" : v).replace(/"/g, '""') + '"';
    const header = ["prenom", "profil", "tagline", "confirme_le"];
    const lines = [header.join(",")];
    result.rows.forEach((r) => {
      lines.push([esc(r.firstname), esc(r.resultName), esc(r.resultTagline), esc(r.confirmedAt)].join(","));
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="participations-fimani.csv"');
    res.send(lines.join("\n"));
  } catch (err) {
    console.error("GET /api/participations.csv failed:", err);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

app.get("/healthz", (req, res) => res.json({ ok: true }));

app.use(express.static(path.join(__dirname, "public")));

initDb()
  .then(() => {
    app.listen(PORT, () => console.log("FIMANI quiz server listening on port " + PORT));
  })
  .catch((err) => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  });
