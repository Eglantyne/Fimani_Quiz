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
