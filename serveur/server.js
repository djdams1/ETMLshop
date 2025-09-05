const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse");
const { stringify } = require("csv-stringify/sync");
const axios = require("axios");

// ---------------- CONFIG ----------------
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.resolve("data/items.csv");

// ⚠️ Mets ici ton webhook Discord
const DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1413583829939261562/QgcPoIo3-YUmVAuzQ1u9XiGa_G9uU5g6s8Vs_4bHsDHFbNtbJi92hue62vuvwW2jfwNY";

// ---------------- CACHE ----------------
let CACHE = {
  items: [],
  etag: "",
  lastLoaded: 0
};

const RESERVATIONS = [];

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

// ---------------- CSV ----------------
function parseCsv(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(filePath)
      .pipe(parse({ columns: true, trim: true, skip_empty_lines: true }))
      .on("data", r => rows.push(r))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

async function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    console.warn(`⚠️ Fichier non trouvé: ${DATA_FILE}`);
    CACHE.items = [];
    CACHE.etag = `${Date.now()}-0`;
    CACHE.lastLoaded = Date.now();
    return;
  }

  const arr = await parseCsv(DATA_FILE);

  CACHE.items = arr.map((row, idx) => {
    const image = row.image ?? "";
    const title = row.title ?? "";
    const stock = toInt(row.stock, 0);
    const price = toFloat(row.price, 0.0);
    const id = String(row.id ?? `${idx}-${title.toLowerCase().replace(/\s+/g, "-")}`);
    return { id, image, title, stock, price };
  });

  CACHE.lastLoaded = Date.now();
  CACHE.etag = `${CACHE.lastLoaded}-${CACHE.items.length}`;
  console.log(`✅ Données chargées (${CACHE.items.length} items)`);
}

function saveCsv(filePath, items) {
  const records = items.map(i => ({
    id: i.id,
    image: i.image,
    title: i.title,
    stock: i.stock,
    price: i.price
  }));

  const csv = stringify(records, { header: true });
  fs.writeFileSync(filePath, csv, "utf8");
  console.log("💾 CSV mis à jour avec les stocks actuels");
}

// ---------------- WATCH ----------------
function watchFile() {
  if (fs.existsSync(DATA_FILE)) {
    fs.watchFile(DATA_FILE, { interval: 500 }, async () => {
      console.log("♻️ Fichier CSV modifié → rechargement...");
      try { await loadData(); } catch (e) { console.error(e); }
    });
  }
}

// ---------------- ETag ----------------
function withEtag(req, res, next) {
  res.setHeader("ETag", CACHE.etag);
  if (req.headers["if-none-match"] === CACHE.etag) return res.status(304).end();
  next();
}

// ---------------- DISCORD ----------------
async function sendDiscordMessage(reservation) {
  try {
    const itemsList = reservation.items
      .map(i => {
        const lineTotal = (i.quantity * i.price).toFixed(2);
        return `• **${i.title}** x${i.quantity} = ${lineTotal}CHF${i.error ? " ⚠️ " + i.error : ""}`;
      })
      .join("\n");

    const content = `📢 **Nouvelle réservation**\n👤 Client: **${reservation.customer}**\n🕒 Date: ${reservation.date}\n\n${itemsList}`;

    // Envoi du message via webhook
    await axios.post(DISCORD_WEBHOOK_URL, { content });

    console.log("✅ Message envoyé !");
  } catch (err) {
    console.error("❌ Erreur envoi Discord:", err.message);
  }
}


// ---------------- ROUTES ----------------
app.get("/health", (req, res) => {
  res.json({ ok: true, items: CACHE.items.length, lastLoaded: CACHE.lastLoaded });
});

app.get("/items", withEtag, (req, res) => {
  const q = (req.query.q ?? "").toString().toLowerCase().trim();
  const inStock = toBool(req.query.inStock);
  const minPrice = req.query.minPrice ? toFloat(req.query.minPrice) : undefined;
  const maxPrice = req.query.maxPrice ? toFloat(req.query.maxPrice) : undefined;
  const limit = Math.min(Math.max(toInt(req.query.limit, 50), 1), 200);
  const offset = Math.max(toInt(req.query.offset, 0), 0);
  const sort = (req.query.sort ?? "title").toString();

  let data = CACHE.items;

  if (q) data = data.filter(i => i.title.toLowerCase().includes(q) || i.image.toLowerCase().includes(q));
  if (inStock !== undefined) data = data.filter(i => (inStock ? i.stock > 0 : i.stock <= 0));
  if (minPrice !== undefined) data = data.filter(i => i.price >= minPrice);
  if (maxPrice !== undefined) data = data.filter(i => i.price <= maxPrice);

  const field = sort.replace(/^[-+]/, "");
  const dir = sort.startsWith("-") ? -1 : 1;
  data = data.slice().sort((a, b) => {
    if (!(field in a) || !(field in b)) return 0;
    if (a[field] < b[field]) return -1 * dir;
    if (a[field] > b[field]) return 1 * dir;
    return 0;
  });

  const total = data.length;
  const page = data.slice(offset, offset + limit);
  res.json({ total, offset, limit, items: page });
});

app.get("/items/:id", withEtag, (req, res) => {
  const item = CACHE.items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Item not found" });
  res.json(item);
});

app.post("/admin/reload", async (req, res) => {
  try {
    await loadData();
    res.json({ ok: true, reloadedAt: CACHE.lastLoaded, count: CACHE.items.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/reserve", (req, res) => {
  const { customer, items } = req.body;
  if (!customer || !Array.isArray(items)) return res.status(400).json({ error: "Requête invalide" });

  const checkedItems = [];

  for (const it of items) {
    const product = CACHE.items.find(p => p.id === it.id);
    if (!product) { checkedItems.push({ ...it, error: "Produit introuvable" }); continue; }
    if (it.quantity > product.stock) { checkedItems.push({ ...it, error: "Quantité > stock" }); continue; }

    // Décrément stock
    product.stock -= it.quantity;

    checkedItems.push({ ...it, title: product.title, price: product.price });
  }

  // Persister le stock
  saveCsv(DATA_FILE, CACHE.items);

  const reservation = {
    id: RESERVATIONS.length + 1,
    customer,
    items: checkedItems,
    date: new Date().toISOString()
  };
  RESERVATIONS.push(reservation);

  // Envoi Discord
  sendDiscordMessage(reservation);

  console.log("📦 Nouvelle réservation:", reservation);
  res.json({ ok: true, reservation });
});

const TARGET_URL = "https://example.com"; // mets l'URL que tu veux pinger

// Fonction pour faire la requête
async function pingWebsite() {
  try {
    const res = await axios.get(TARGET_URL);
    console.log(`♻️ Ping réussi (${new Date().toLocaleTimeString()}), status: ${res.status}`);
  } catch (err) {
    console.error(`❌ Erreur ping (${new Date().toLocaleTimeString()}):`, err.message);
  }
}

// Toutes les 2 minutes (120000 ms)
setInterval(pingWebsite, 120000);


// ---------------- BOOT ----------------
(async () => {
  await loadData();
  watchFile();
  app.listen(PORT, () => console.log(`🚀 API dispo sur http://localhost:${PORT}`));
})();
