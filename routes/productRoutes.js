
const express = require("express");
const router = express.Router();
const multer = require("multer");
const csv = require("csv-parser");
const fs = require("fs");
const db = require("../db");

// Multer upload → store images in /uploads folder
const upload = multer({ dest: "uploads/" });

/**
 * Helper: Build CSV string from rows
 */
function buildCsv(rows) {
  let csvData = "name,unit,category,brand,stock,status,image\n";
  rows.forEach((r) => {
    const name = `"${r.name || ""}"`;
    const unit = `"${r.unit || ""}"`;
    const category = `"${r.category || ""}"`;
    const brand = `"${r.brand || ""}"`;
    const stock = r.stock != null ? r.stock : 0;
    const status = `"${r.status || ""}"`;
    const image = `"${r.image || ""}"`;

    csvData += `${name},${unit},${category},${brand},${stock},${status},${image}\n`;
  });
  return csvData;
}

//
// ----------------------------------------------------
// IMPORT CSV
// ----------------------------------------------------
router.post("/import", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  let added = 0;
  let skipped = 0;
  let duplicates = [];
  const results = [];

  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on("data", (data) => results.push(data))
    .on("end", async () => {
      for (const row of results) {
        await new Promise((resolve) => {
          db.get(
            "SELECT id FROM products WHERE LOWER(name)=LOWER(?)",
            [row.name],
            (err, existing) => {
              if (existing) {
                skipped++;
                duplicates.push({ name: row.name, existingId: existing.id });
                return resolve();
              }

              db.run(
                `
                INSERT INTO products (name, unit, category, brand, stock, status, image)
                VALUES (?, ?, ?, ?, ?, ?, ?)
              `,
                [
                  row.name,
                  row.unit,
                  row.category,
                  row.brand,
                  parseInt(row.stock || "0", 10),
                  row.status,
                  row.image
                ],
                () => {
                  added++;
                  resolve();
                }
              );
            }
          );
        });
      }

      return res.json({ added, skipped, duplicates });
    });
});

//
// ----------------------------------------------------
// EXPORT CSV
// ----------------------------------------------------
router.get("/export", (req, res) => {
  db.all("SELECT * FROM products", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    const csvData = buildCsv(rows);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="products.csv"');
    return res.send(csvData);
  });
});

//
// ----------------------------------------------------
// CREATE PRODUCT WITH IMAGE UPLOAD
// ----------------------------------------------------
router.post("/", upload.single("image"), (req, res) => {
  const { name, unit, category, brand, stock, status } = req.body;

  // File from multer
  const image = req.file ? req.file.filename : null;

  if (!name || !unit || !category || !brand || stock == null) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const stockNum = parseInt(stock, 10);
  if (isNaN(stockNum)) return res.status(400).json({ error: "Stock must be a number" });

  // Unique name check
  db.get(
    "SELECT id FROM products WHERE LOWER(name)=LOWER(?)",
    [name],
    (err, existing) => {
      if (existing)
        return res.status(400).json({ error: "Product name must be unique" });

      db.run(
        `
        INSERT INTO products (name, unit, category, brand, stock, status, image)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
        [name, unit, category, brand, stockNum, status, image],
        function (err2) {
          if (err2) return res.status(500).json({ error: err2.message });

          db.get(
            "SELECT * FROM products WHERE id=?",
            [this.lastID],
            (err3, row) => {
              res.json(row);
            }
          );
        }
      );
    }
  );
});

//
// ----------------------------------------------------
// GET ALL PRODUCTS (with sorting, category filter, pagination)
// ----------------------------------------------------
router.get("/", (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 1000;
  const offset = (page - 1) * limit;

  const category = req.query.category || "";
  const sort = req.query.sort || "name";
  const order = req.query.order === "desc" ? "DESC" : "ASC";

  let whereClause = category
    ? `WHERE category = '${category.replace(/'/g, "''")}'`
    : "";

  const countQuery = `SELECT COUNT(*) AS total FROM products ${whereClause}`;
  const dataQuery = `
    SELECT * FROM products
    ${whereClause}
    ORDER BY ${sort} ${order}
    LIMIT ${limit} OFFSET ${offset}
  `;

  db.get(countQuery, [], (err, countResult) => {
    db.all(dataQuery, [], (err2, rows) => {
      db.all("SELECT DISTINCT category FROM products", [], (err3, catRows) => {
        res.json({
          data: rows,
          totalPages:
            limit === 0 ? 1 : Math.max(1, Math.ceil(countResult.total / limit)),
          categories: catRows.map((c) => c.category)
        });
      });
    });
  });
});

//
// ----------------------------------------------------
// SEARCH PRODUCTS
// ----------------------------------------------------
router.get("/search", (req, res) => {
  const name = req.query.name || "";
  const likeValue = `%${name.toLowerCase()}%`;

  db.all(
    "SELECT * FROM products WHERE LOWER(name) LIKE ?",
    [likeValue],
    (err, rows) => {
      res.json(rows);
    }
  );
});

//
// ----------------------------------------------------
// GET PRODUCT BY ID
// ----------------------------------------------------
router.get("/:id", (req, res) => {
  db.get("SELECT * FROM products WHERE id=?", [req.params.id], (err, row) => {
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  });
});

//
// ----------------------------------------------------
// GET INVENTORY HISTORY
// ----------------------------------------------------
router.get("/:id/history", (req, res) => {
  db.all(
    "SELECT * FROM inventory_logs WHERE productId=? ORDER BY datetime(timestamp) DESC",
    [req.params.id],
    (err, rows) => res.json(rows)
  );
});

//
// ----------------------------------------------------
// UPDATE PRODUCT (with stock history logging)
// ----------------------------------------------------
router.put("/:id", upload.single("image"), (req, res) => {
  const { name, unit, category, brand, stock, status } = req.body;
  const image = req.file ? req.file.filename : null;

  if (!name || !unit || !category || !brand || stock == null)
    return res.status(400).json({ error: "Missing fields" });

  const stockNum = parseInt(stock, 10);

  db.get(
    "SELECT id FROM products WHERE LOWER(name)=LOWER(?) AND id <> ?",
    [name, req.params.id],
    (err, existing) => {
      if (existing)
        return res.status(400).json({ error: "Product name must be unique" });

      db.get(
        "SELECT stock FROM products WHERE id=?",
        [req.params.id],
        (err2, row) => {
          if (!row) return res.status(404).json({ error: "Not found" });

          const oldStock = row.stock;

          db.run(
            `
            UPDATE products
            SET name=?, unit=?, category=?, brand=?, stock=?, status=?, image=COALESCE(?, image)
            WHERE id=?
          `,
            [name, unit, category, brand, stockNum, status, image, req.params.id],
            () => {
              // stock change → log history
              if (oldStock !== stockNum) {
                db.run(
                  `
                  INSERT INTO inventory_logs (productId, oldStock, newStock, changedBy, timestamp)
                  VALUES (?, ?, ?, ?, datetime('now'))
                `,
                  [req.params.id, oldStock, stockNum, "admin"]
                );
              }

              db.get(
                "SELECT * FROM products WHERE id=?",
                [req.params.id],
                (err4, updated) => res.json(updated)
              );
            }
          );
        }
      );
    }
  );
});

//
// ----------------------------------------------------
// DELETE PRODUCT
// ----------------------------------------------------
router.delete("/:id", (req, res) => {
  db.run("DELETE FROM products WHERE id=?", [req.params.id], () => {
    res.json({ message: "Deleted" });
  });
});

module.exports = router;