
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.join("/tmp", "inventory.db");

const db = new sqlite3.Database(dbPath);



db.serialize(() => {
  // Products table
  db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        unit TEXT,
        category TEXT,
        brand TEXT,
        stock INTEGER NOT NULL,
        status TEXT,
        image TEXT
    )`);

  // Old reference-table (from reference doc) – keep it, no harm
  db.run(`CREATE TABLE IF NOT EXISTS inventory_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER,
        old_quantity INTEGER,
        new_quantity INTEGER,
        change_date TEXT,
        user_info TEXT,
        FOREIGN KEY(product_id) REFERENCES products(id)
    )`);

  // New required table for main assignment: inventory_logs
  db.run(`CREATE TABLE IF NOT EXISTS inventory_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        productId INTEGER,
        oldStock INTEGER,
        newStock INTEGER,
        changedBy TEXT,
        timestamp TEXT,
        FOREIGN KEY(productId) REFERENCES products(id)
    )`);
});

module.exports = db;