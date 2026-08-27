import { apiDelete, apiGet, apiPost, apiPut } from "./client";
import type { Setup } from "../types/domain";

export type SetupInput = Omit<Setup, "id" | "createdAt" | "updatedAt">;

export function listSetups(): Promise<Setup[]> {
  return apiGet("/setups");
}

export function createSetup(input: SetupInput): Promise<Setup> {
  return apiPost("/setups", input);
}

export function updateSetup(id: string, input: SetupInput): Promise<Setup> {
  return apiPut(`/setups/${id}`, input);
}

export function deleteSetup(id: string): Promise<void> {
  return apiDelete(`/setups/${id}`);
}
