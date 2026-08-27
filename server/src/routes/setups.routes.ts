import { Router } from "express";
import { createSetup, deleteSetup, listSetups, updateSetup } from "../services/setupStore.service.js";
import type { Setup } from "../types/domain.js";

export const setupsRouter = Router();

setupsRouter.get("/setups", async (_req, res, next) => {
  try {
    res.json(await listSetups());
  } catch (err) {
    next(err);
  }
});

setupsRouter.post("/setups", async (req, res, next) => {
  try {
    const body = req.body as Omit<Setup, "id" | "createdAt" | "updatedAt">;
    if (!body.name || !body.hubId || !body.projectId) {
      res.status(400).json({ error: "name, hubId, and projectId are required" });
      return;
    }
    res.status(201).json(await createSetup(body));
  } catch (err) {
    next(err);
  }
});

setupsRouter.put("/setups/:id", async (req, res, next) => {
  try {
    const body = req.body as Omit<Setup, "id" | "createdAt" | "updatedAt">;
    const updated = await updateSetup(req.params.id, body);
    if (!updated) {
      res.status(404).json({ error: "Setup not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

setupsRouter.delete("/setups/:id", async (req, res, next) => {
  try {
    const deleted = await deleteSetup(req.params.id);
    res.status(deleted ? 204 : 404).end();
  } catch (err) {
    next(err);
  }
});
