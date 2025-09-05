const express = require("express");
const cors = require("cors");
const axios = require("axios");
const Airtable = require("airtable");

// Variables d'environnement
const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const DISCORD_WEBHOOK_URL =
  "https://discord.com/api/webhooks/1413583829939261562/QgcPoIo3-YUmVAuzQ1u9XiGa_G9uU5g6s8Vs_4bHsDHFbNtbJi92hue62vuvwW2jfwNY";

const base = new Airtable({ apiKey: AIRTABLE_PAT }).base(AIRTABLE_BASE_ID);

const app = express();
app.use(cors()); // Important pour que le front séparé puisse faire fetch
app.use(express.json());

// ---------------- UTIL ----------------
const toInt = (x, def = 0) =>
  Number.isFinite(parseInt(x, 10)) ? parseInt(x, 10) : def;
const toFloat = (x, def = 0.0) =>
  Number.isFinite(parseFloat(x)) ? parseFloat(x) : def;
const toBool = (x) => {
  if (x === undefined) return undefined;
  const s = String(x).toLowerCase();
  return s === "1" || s === "true" || s === "yes";
};

// ---------------- AIRTABLE ----------------
async function loadItems() {
  const records = await base("tbl8oKYhVPy5OET4U")
    .select({ view: "Grid view" })
    .all();
  return records
    .map((r) => ({
      id: r.id,
      title: r.get("title"),
      image: r.get("image"),
      price: parseFloat(r.get("price")),
      stock: toInt(r.get("stock")),
    }))
    .filter((i) => i.title);
}

async function updateStock(itemId, newStock) {
  await base("tbl8oKYhVPy5OET4U").update(itemId, { stock: newStock });
}

// ---------------- DISCORD ----------------
async function sendDiscordMessage(reservation) {
  try {
    const itemsList = reservation.items
      .map(
        (i) =>
          `• ${i.title} x${i.quantity} = ${(i.quantity * i.price).toFixed(
            2
          )}CHF${i.error ? " ⚠️ " + i.error : ""}`
      )
      .join("\n");
    await axios.post(DISCORD_WEBHOOK_URL, {
      content: `📢 Nouvelle réservation\n👤 ${reservation.customer}\n🕒 ${reservation.date}\n\n${itemsList}`,
    });
  } catch (err) {
    console.error("Erreur Discord:", err.message);
  }
}

// ---------------- ROUTES API ----------------
app.get("/health", async (req, res) => {
  try {
    const items = await loadItems();
    res.json({ ok: true, totalItems: items.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/items", async (req, res) => {
  try {
    let items = await loadItems();
    const q = (req.query.q ?? "").toLowerCase().trim();
    const inStock = toBool(req.query.inStock);
    const minPrice = req.query.minPrice
      ? toFloat(req.query.minPrice)
      : undefined;
    const maxPrice = req.query.maxPrice
      ? toFloat(req.query.maxPrice)
      : undefined;

    if (q)
      items = items.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          String(i.image).toLowerCase().includes(q)
      );
    if (inStock !== undefined)
      items = items.filter((i) => (inStock ? i.stock > 0 : i.stock <= 0));
    if (minPrice !== undefined)
      items = items.filter((i) => i.price >= minPrice);
    if (maxPrice !== undefined)
      items = items.filter((i) => i.price <= maxPrice);

    res.json({ total: items.length, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/test-discord", async (req, res) => {
  try {
    await axios.post(DISCORD_WEBHOOK_URL, {
      content: "Test Discord depuis l'API ✅",
    });
    res.json({ ok: true, message: "Message envoyé !" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/reserve", async (req, res) => {
  try {
    const { customer, items } = req.body;
    if (!customer || !Array.isArray(items))
      return res.status(400).json({ error: "Requête invalide" });

    const checkedItems = [];
    const allProducts = await loadItems();

    for (const it of items) {
      const product = allProducts.find((p) => p.id === it.id);
      if (!product) {
        checkedItems.push({ ...it, error: "Produit introuvable" });
        continue;
      }
      if (it.quantity > product.stock) {
        checkedItems.push({ ...it, error: "Quantité > stock" });
        continue;
      }

      const newStock = product.stock - it.quantity;
      await updateStock(product.id, newStock);
      checkedItems.push({ ...it, title: product.title, price: product.price });

      // 🚨 Message Discord si stock à 0
      if (newStock === 0) {
        try {
          await axios.post(DISCORD_WEBHOOK_URL, {
            content: `⚠️ Le produit "${product.title}" est maintenant en rupture de stock !`,
          });
        } catch (err) {
          console.error("Erreur Discord rupture:", err.message);
        }
      }
    }

    const reservation = {
      id: Date.now(),
      customer,
      items: checkedItems,
      date: new Date().toISOString(),
    };
    sendDiscordMessage(reservation);

    res.json({ ok: true, reservation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = app; // <- important pour Vercel
