import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectDay } from "./nre.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const STATIONS = [
  { crs: "SNS", name: "Staines" },
  { crs: "TWI", name: "Twickenham" },
  { crs: "WAT", name: "London Waterloo" },
];

const pairs = [];
for (const a of STATIONS) {
  for (const b of STATIONS) {
    if (a.crs !== b.crs) pairs.push({ key: `${a.crs}:${b.crs}`, from: a.crs, to: b.crs });
  }
}

const results = await Promise.all(
  pairs.map(async (p) => {
    process.stdout.write(`Fetching ${p.from} -> ${p.to}... `);
    const board = await collectDay(p.from, p.to);
    console.log(`got ${board.services.length} services`);
    return [p.key, board];
  })
);

const directions = Object.fromEntries(results);
const snapshot = { generatedAt: new Date().toISOString(), directions };

const outPath = join(__dirname, "..", "public", "data", "departures.json");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(snapshot));
console.log(`Snapshot written: ${Object.keys(directions).length} directions`);
console.log(outPath);