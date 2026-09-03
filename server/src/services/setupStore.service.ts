import { JSONFilePreset } from "lowdb/node";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import type { Setup } from "../types/domain.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "..", "data");
const dbPath = path.join(dataDir, "setups.json");

/* lowdb writes via a `<file>.tmp` + rename, but never creates the parent directory itself - it
   only conjures the *file* on first use. `data/` holds nothing else worth committing (setups.json
   is gitignored, being runtime state), so a fresh deploy checkout can easily lack the directory
   entirely, and every save then fails with ENOENT on the .tmp write. Guarantee it exists instead
   of depending on deployment artifacts. */
fs.mkdirSync(dataDir, { recursive: true });

interface DbShape {
  setups: Setup[];
}

const dbPromise = JSONFilePreset<DbShape>(dbPath, { setups: [] });

export async function listSetups(): Promise<Setup[]> {
  const db = await dbPromise;
  await db.read();
  return db.data.setups;
}

export async function getSetup(id: string): Promise<Setup | undefined> {
  const db = await dbPromise;
  await db.read();
  return db.data.setups.find((s) => s.id === id);
}

export async function createSetup(input: Omit<Setup, "id" | "createdAt" | "updatedAt">): Promise<Setup> {
  const db = await dbPromise;
  await db.read();
  const now = new Date().toISOString();
  const setup: Setup = { ...input, id: uuidv4(), createdAt: now, updatedAt: now };
  db.data.setups.push(setup);
  await db.write();
  return setup;
}

export async function updateSetup(
  id: string,
  input: Omit<Setup, "id" | "createdAt" | "updatedAt">
): Promise<Setup | undefined> {
  const db = await dbPromise;
  await db.read();
  const index = db.data.setups.findIndex((s) => s.id === id);
  if (index === -1) return undefined;
  const updated: Setup = {
    ...input,
    id,
    createdAt: db.data.setups[index].createdAt,
    updatedAt: new Date().toISOString(),
  };
  db.data.setups[index] = updated;
  await db.write();
  return updated;
}

export async function deleteSetup(id: string): Promise<boolean> {
  const db = await dbPromise;
  await db.read();
  const before = db.data.setups.length;
  db.data.setups = db.data.setups.filter((s) => s.id !== id);
  await db.write();
  return db.data.setups.length < before;
}
