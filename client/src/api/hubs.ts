import { apiGet } from "./client";
import type { FolderTreeNode, HubSummary, ProjectSummary } from "../types/domain";

export function listHubs(): Promise<HubSummary[]> {
  return apiGet("/hubs");
}

export function listProjects(hubId: string): Promise<ProjectSummary[]> {
  return apiGet(`/hubs/${hubId}/projects`);
}

export function listTopFolders(hubId: string, projectId: string): Promise<FolderTreeNode[]> {
  return apiGet(`/hubs/${hubId}/projects/${projectId}/topFolders`);
}

export function listFolderChildren(projectId: string, folderId: string): Promise<FolderTreeNode[]> {
  return apiGet(`/projects/${projectId}/folders/${folderId}/children`);
}
