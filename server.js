

const express = require("express");
const cors = require("cors");
const path = require("path");
const app = express();

const productRoutes = require("./routes/productRoutes");
const db = require("./db");

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded images
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Routes
app.use("/api/products", productRoutes);

// Base route check
app.get("/", (req, res) => {
  res.send("Inventory Management Backend Running");
});

// Start server
const PORT = process.env.PORT || 5000
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});