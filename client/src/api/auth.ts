import { apiGet, apiPost } from "./client";

export interface Profile {
  name: string;
  email: string;
  userId: string;
}

export function getMe(): Promise<{ profile: Profile }> {
  return apiGet("/auth/me");
}

export function logout(): Promise<void> {
  return apiPost("/auth/logout");
}

export function loginUrl(): string {
  return "/api/auth/login";
}
