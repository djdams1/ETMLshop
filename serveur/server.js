const express = require("express");
const path = require("path");
const cors = require("cors");
const axios = require("axios");
const Airtable = require("airtable");

// ---------------- CONFIG ----------------

const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// const AIRTABLE_PAT = "patnf0j0L63L87HMF.08d52d0bf7b44c157091e8b5c513c8078e79d4e6d0033bb33932ec65baeb1afd";
// const AIRTABLE_BASE_ID = "app2KcZXoyufc1Eou";
// const DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1413583829939261562/QgcPoIo3-YUmVAuzQ1u9XiGa_G9uU5g6s8Vs_4bHsDHFbNtbJi92hue62vuvwW2jfwNY";

const base = new Airtable({ apiKey: AIRTABLE_PAT }).base(AIRTABLE_BASE_ID);

const PORT = process.env.PORT || 3000;
const app = express();
app.use(cors());
app.use(express.json());

// ---------------- UTIL ----------------
function toInt(x, def = 0) {
  const n = parseInt(x, 10);
  return Number.isFinite(n) ? n : def;
}
function toFloat(x, def = 0.0) {
  const n = parseFloat(x);
  return Number.isFinite(n) ? n : def;
}
function toBool(x) {
  if (x === undefined) return undefined;
  const s = String(x).toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

// ---------------- AIRTABLE ----------------
async function loadItems() {
  const records = await base("tbl8oKYhVPy5OET4U").select({ view: "Grid view" }).all();

  // DEBUG console
  console.log("DEBUG Airtable:", records.map(r => r.fields));

  return records
    .map((r) => ({
      id: r.id,
      fields: r.fields,
      title: r.get("title"),
      image: r.get("image"),
      price: parseFloat(r.get("price")),
      stock: toInt(r.get("stock")),
    }))
    .filter(item => item.title); // <- on garde seulement ceux qui ont un title
}



async function updateStock(itemId, newStock) {
  await base("tbl8oKYhVPy5OET4U").update(itemId, { stock: newStock });
}

// ---------------- DISCORD ----------------
async function sendDiscordMessage(reservation) {
  try {
    const itemsList = reservation.items
      .map((i) => `• **${i.title}** x${i.quantity} = ${(i.quantity * i.price).toFixed(2)}CHF${i.error ? " ⚠️ " + i.error : ""}`)
      .join("\n");

    const content = `📢 **Nouvelle réservation**\n👤 Client: **${reservation.customer}**\n🕒 Date: ${reservation.date}\n\n${itemsList}`;
    await axios.post(DISCORD_WEBHOOK_URL, { content });
    console.log("✅ Message envoyé !");
  } catch (err) {
    console.error("❌ Erreur envoi Discord:", err.message);
  }
}

const path = require("path");
app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});


app.get("/data/items.csv", (req, res) => {
  const csvPath = path.join(__dirname, "data", "items.csv");
  fs.readFile(csvPath, "utf8", (err, data) => {
    if (err) return res.status(500).send("Erreur lecture CSV");
    res.type("text/csv").send(data);
  });
});

// Servir index.html


app.get("/", (req, res) => {

  res.sendFile(path.join(__dirname, "..", "public", "index.html"));

});

// ---------------- ROUTES ----------------
app.get("/health", async (req, res) => {
  const items = await loadItems();
  res.json({ ok: true, totalItems: items.length });
});

app.get("/items", async (req, res) => {
  let items = await loadItems();
  const q = (req.query.q ?? "").toLowerCase().trim();
  const inStock = toBool(req.query.inStock);
  const minPrice = req.query.minPrice ? toFloat(req.query.minPrice) : undefined;
  const maxPrice = req.query.maxPrice ? toFloat(req.query.maxPrice) : undefined;

  if (q) items = items.filter(i => (i.title?.toLowerCase().includes(q) || String(i.image).toLowerCase().includes(q)));
  if (inStock !== undefined) items = items.filter(i => (inStock ? i.stock > 0 : i.stock <= 0));
  if (minPrice !== undefined) items = items.filter(i => i.price >= minPrice);
  if (maxPrice !== undefined) items = items.filter(i => i.price <= maxPrice);

  res.json({ total: items.length, items });
});

app.post("/reserve", async (req, res) => {
  const { customer, items } = req.body;
  if (!customer || !Array.isArray(items)) return res.status(400).json({ error: "Requête invalide" });

  const checkedItems = [];
  const allProducts = await loadItems();

  for (const it of items) {
    const product = allProducts.find(p => p.id === it.id);
    if (!product) { checkedItems.push({ ...it, error: "Produit introuvable" }); continue; }
    if (it.quantity > product.stock) { checkedItems.push({ ...it, error: "Quantité > stock" }); continue; }

    await updateStock(product.id, product.stock - it.quantity);
    checkedItems.push({ ...it, title: product.title, price: product.price });
  }

  const reservation = {
    id: Date.now(),
    customer,
    items: checkedItems,
    date: new Date().toISOString()
  };

  sendDiscordMessage(reservation);

  console.log("📦 Nouvelle réservation:", reservation);
  res.json({ ok: true, reservation });
});
app.get("*", (req,res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// ---------------- BOOT ----------------
app.listen(PORT, () => console.log(`🚀 API dispo sur http://localhost:${PORT}`));
