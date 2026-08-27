import { Router } from "express";
import { listFolderChildren, listHubs, listProjects, listTopFolders } from "../services/apsDataManagement.service.js";

export const hubsRouter = Router();

hubsRouter.get("/hubs", async (req, res, next) => {
  try {
    res.json(await listHubs(req.apsAccessToken));
  } catch (err) {
    next(err);
  }
});

hubsRouter.get("/hubs/:hubId/projects", async (req, res, next) => {
  try {
    res.json(await listProjects(req.apsAccessToken, req.params.hubId));
  } catch (err) {
    next(err);
  }
});

hubsRouter.get("/hubs/:hubId/projects/:projectId/topFolders", async (req, res, next) => {
  try {
    res.json(
      await listTopFolders(req.apsAccessToken, req.params.hubId, req.params.projectId)
    );
  } catch (err) {
    next(err);
  }
});

hubsRouter.get("/projects/:projectId/folders/:folderId/children", async (req, res, next) => {
  try {
    res.json(
      await listFolderChildren(req.apsAccessToken, req.params.projectId, req.params.folderId)
    );
  } catch (err) {
    next(err);
  }
});
