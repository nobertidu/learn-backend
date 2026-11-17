require("dotenv").config();
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { Pool } = require("pg");

// ---------- config (comes from .env) ----------
const PORT = process.env.PORT || 3001;
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "./uploads");
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 100);
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim());

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is missing. copy .env.example to .env first.");
  process.exit(1);
}

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- database ----------
// a pool keeps a few connections open and reuses them
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function initDb() {
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(sql);
}

// ---------- file upload rules ----------
const ALLOWED = {
  image: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  video: ["video/mp4", "video/webm", "video/quicktime"],
  file: ["application/pdf", "text/plain", "application/zip"],
};

function kindOf(mime) {
  for (const [kind, list] of Object.entries(ALLOWED)) {
    if (list.includes(mime)) return kind;
  }
  return null;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    // random name so users can't overwrite each other's files
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, crypto.randomBytes(16).toString("hex") + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (kindOf(file.mimetype)) return cb(null, true);
    cb(new Error("file type not allowed: " + file.mimetype));
  },
});

// express 4 does not catch errors in async handlers, so we wrap them
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ---------- app ----------
const app = express();
app.use(cors({ origin: CORS_ORIGINS }));
app.use(express.json());

// uploaded files are served from /uploads/<name>
app.use("/uploads", express.static(UPLOAD_DIR));

// health check, also proves the database is reachable
app.get(
  "/api/health",
  wrap(async (req, res) => {
    await pool.query("SELECT 1");
    res.json({ status: "ok", db: "connected", time: new Date().toISOString() });
  })
);

// list posts, newest first
app.get(
  "/api/posts",
  wrap(async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM posts ORDER BY id DESC");
    res.json(
      rows.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        createdAt: r.created_at,
        file: r.file_name
          ? {
              url: "/uploads/" + r.file_name,
              name: r.file_original,
              type: r.file_type,
              kind: r.file_kind,
            }
          : null,
      }))
    );
  })
);

// get a single post by id
app.get(
  "/api/posts/:id",
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "bad id" });
    }
    const { rows } = await pool.query("SELECT * FROM posts WHERE id = $1", [id]);
    if (rows.length === 0) return res.status(404).json({ error: "not found" });

    const r = rows[0];
    res.json({
      id: r.id,
      title: r.title,
      body: r.body,
      createdAt: r.created_at,
      file: r.file_name
        ? {
            url: "/uploads/" + r.file_name,
            name: r.file_original,
            type: r.file_type,
            kind: r.file_kind,
          }
        : null,
    });
  })
);

// create a post: text fields + optional single file called "file"
app.post(
  "/api/posts",
  upload.single("file"),
  wrap(async (req, res) => {
    const title = (req.body.title || "").trim();
    const body = (req.body.body || "").trim();
    const f = req.file;

    if (!title) {
      if (f) fs.unlink(f.path, () => {});
      return res.status(400).json({ error: "title is required" });
    }

    try {
      // $1, $2 ... are placeholders. never build sql by joining strings (sql injection)
      const { rows } = await pool.query(
        `INSERT INTO posts (title, body, file_name, file_original, file_type, file_kind)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          title,
          body,
          f ? f.filename : null,
          f ? f.originalname : null,
          f ? f.mimetype : null,
          f ? kindOf(f.mimetype) : null,
        ]
      );
      res.status(201).json({ id: rows[0].id });
    } catch (err) {
      // db failed, so don't leave an orphan file on disk
      if (f) fs.unlink(f.path, () => {});
      throw err;
    }
  })
);

// delete a post and its file
app.delete(
  "/api/posts/:id",
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "bad id" });
    }
    const { rows } = await pool.query(
      "DELETE FROM posts WHERE id = $1 RETURNING file_name",
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "not found" });

    if (rows[0].file_name) {
      fs.unlink(path.join(UPLOAD_DIR, rows[0].file_name), () => {});
    }
    res.json({ ok: true });
  })
);

// error handler (catches multer errors like file too big, and db errors)
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg =
      err.code === "LIMIT_FILE_SIZE"
        ? `file too large, max is ${MAX_UPLOAD_MB}MB`
        : err.message;
    return res.status(400).json({ error: msg });
  }
  if (err.message && err.message.startsWith("file type not allowed")) {
    return res.status(400).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: "server error" });
});

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`api running on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error("could not connect to the database:", err.message);
    process.exit(1);
  });
