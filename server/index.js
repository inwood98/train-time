import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectDepartures } from "./nre.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;
const cache = new Map();

const app = express();
app.use(express.json());

app.get("/api/departures", async (req, res) => {
  const from = String(req.query.from || "SNS").toUpperCase();
  const to = String(req.query.to || "TWI").toUpperCase();
  const count = Math.min(Number(req.query.count) || 10, 30);
  const key = `${from}:${to}:${count}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < 20000) {
    return res.json(cached.data);
  }

  try {
    const data = await collectDepartures(from, to, count);
    cache.set(key, { at: Date.now(), data });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

const dist = path.join(__dirname, "..", "dist");
app.use(express.static(dist));

app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(dist, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Departures API + app running on http://localhost:${PORT}`);
});