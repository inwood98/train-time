import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectDay } from "./nre.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ROUTES = [
  { key: "out", from: "SNS", to: "TWI" },
  { key: "back", from: "TWI", to: "SNS" },
];

const dirs = {};
for (const route of ROUTES) {
  process.stdout.write(`Fetching ${route.from} -> ${route.to}... `);
  dirs[route.key] = await collectDay(route.from, route.to);
  console.log(`got ${dirs[route.key].services.length} services`);
}

const snapshot = {
  generatedAt: new Date().toISOString(),
  directions: dirs,
};

const outPath = join(__dirname, "..", "public", "data", "departures.json");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
console.log(`Snapshot written to ${outPath}`);