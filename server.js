const express = require("express");
const session = require("express-session");
const { Pool } = require("pg");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not configured.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false }
});

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS registrations (
      id SERIAL PRIMARY KEY,
      registration_id VARCHAR(100) UNIQUE NOT NULL,
      team TEXT NOT NULL,
      leader TEXT NOT NULL,
      college TEXT NOT NULL,
      department TEXT NOT NULL,
      year TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      members TEXT NOT NULL,
      member_names TEXT NOT NULL,
      project TEXT NOT NULL,
      category TEXT NOT NULL,
      abstract TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  console.log("PostgreSQL database ready.");
}

const required = [
  "team",
  "leader",
  "college",
  "department",
  "year",
  "phone",
  "email",
  "members",
  "memberNames",
  "project",
  "category",
  "abstract"
];

function rid() {
  return `INV-26-${Date.now().toString().slice(-8)}-${Math.floor(
    100 + Math.random() * 900
  )}`;
}

const admin = (req, res, next) =>
  req.session.admin
    ? next()
    : res.status(401).json({ error: "Admin login required" });

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "change-this-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    }
  })
);

app.post("/api/register", async (req, res) => {
  try {
    if (
      required.some(
        (key) => !String(req.body[key] || "").trim()
      )
    ) {
      return res
        .status(400)
        .json({ error: "Please complete all required fields." });
    }

    let registrationId;

    for (;;) {
      registrationId = rid();

      const check = await pool.query(
        "SELECT 1 FROM registrations WHERE registration_id = $1",
        [registrationId]
      );

      if (check.rowCount === 0) break;
    }

    const values = [
      registrationId,
      String(req.body.team).trim(),
      String(req.body.leader).trim(),
      String(req.body.college).trim(),
      String(req.body.department).trim(),
      String(req.body.year).trim(),
      String(req.body.phone).trim(),
      String(req.body.email).trim(),
      String(req.body.members).trim(),
      String(req.body.memberNames).trim(),
      String(req.body.project).trim(),
      String(req.body.category).trim(),
      String(req.body.abstract).trim()
    ];

    await pool.query(
      `
      INSERT INTO registrations
      (
        registration_id,
        team,
        leader,
        college,
        department,
        year,
        phone,
        email,
        members,
        member_names,
        project,
        category,
        abstract
      )
      VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      `,
      values
    );

    res.json({ registrationId });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ error: "Unable to save registration." });
  }
});

app.get("/api/registration/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        registration_id AS "registrationId",
        team,
        leader,
        college,
        department,
        year,
        phone,
        email,
        members,
        member_names AS "memberNames",
        project,
        category,
        abstract,
        created_at AS "createdAt"
      FROM registrations
      WHERE registration_id = $1
      `,
      [req.params.id]
    );

    if (!result.rows.length) {
      return res
        .status(404)
        .json({ error: "Registration not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to load registration." });
  }
});

app.get("/admin/login", (req, res) =>
  res.sendFile(path.join(__dirname, "public/admin-login.html"))
);

app.post("/admin/login", (req, res) => {
  const username = process.env.ADMIN_USERNAME || "gojo";
  const password =
    process.env.ADMIN_PASSWORD || "jigokuraku@2008";

  if (
    req.body.username === username &&
    req.body.password === password
  ) {
    req.session.admin = true;
    return res.redirect("/admin");
  }

  res
    .status(401)
    .send("<h2>Invalid login</h2><a href='/admin/login'>Try again</a>");
});

app.get("/admin/logout", (req, res) =>
  req.session.destroy(() => res.redirect("/admin/login"))
);

app.get("/admin", (req, res) =>
  req.session.admin
    ? res.sendFile(path.join(__dirname, "public/admin.html"))
    : res.redirect("/admin/login")
);

app.get("/api/admin/registrations", admin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        registration_id AS "registrationId",
        team,
        leader,
        college,
        department,
        year,
        phone,
        email,
        members,
        member_names AS "memberNames",
        project,
        category,
        abstract,
        created_at AS "createdAt"
      FROM registrations
      ORDER BY created_at DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to load registrations." });
  }
});

app.delete(
  "/api/admin/registrations/:id",
  admin,
  async (req, res) => {
    try {
      await pool.query(
        "DELETE FROM registrations WHERE registration_id = $1",
        [req.params.id]
      );

      res.json({ ok: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Unable to delete registration." });
    }
  }
);

app.get("/api/admin/export", admin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        registration_id AS "registrationId",
        team,
        leader,
        college,
        department,
        year,
        phone,
        email,
        members,
        project,
        category,
        abstract,
        created_at AS "createdAt"
      FROM registrations
      ORDER BY created_at DESC
    `);

    const columns = [
      "registrationId",
      "team",
      "leader",
      "college",
      "department",
      "year",
      "phone",
      "email",
      "members",
      "project",
      "category",
      "abstract",
      "createdAt"
    ];

    const quote = (value) =>
      `"${String(value ?? "").replaceAll('"', '""')}"`;

    const csv = [
      columns.join(","),
      ...result.rows.map((row) =>
        columns.map((column) => quote(row[column])).join(",")
      )
    ].join("\r\n");

    res.setHeader(
      "Content-Type",
      "text/csv;charset=utf-8"
    );

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=invictus-2026-registrations.csv"
    );

    res.send("\ufeff" + csv);
  } catch (error) {
    console.error(error);
    res.status(500).send("Unable to export registrations.");
  }
});

initDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(
        `INVICTUS 2026 running at http://localhost:${PORT}`
      );
    });
  })
  .catch((error) => {
    console.error("Database initialization failed:", error);
    process.exit(1);
  });
