import { useEffect, useState } from "react";
import { listHubs, listProjects } from "../api/hubs";
import type { HubSummary, ProjectSummary } from "../types/domain";

interface HubProjectSelectProps {
  hubId: string | null;
  projectId: string | null;
  onChangeHub: (hub: HubSummary | null) => void;
  onChangeProject: (project: ProjectSummary | null) => void;
}

export function HubProjectSelect({
  hubId,
  projectId,
  onChangeHub,
  onChangeProject,
}: HubProjectSelectProps) {
  const [hubs, setHubs] = useState<HubSummary[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listHubs()
      .then(setHubs)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load hubs"));
  }, []);

  useEffect(() => {
    if (!hubId) {
      setProjects([]);
      return;
    }
    listProjects(hubId)
      .then(setProjects)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load projects"));
  }, [hubId]);

  return (
    <div className="hub-project-select">
      {error && <p className="error-text">{error}</p>}
      <label>
        Hub
        <select
          value={hubId ?? ""}
          onChange={(e) => {
            const hub = hubs.find((h) => h.id === e.target.value) ?? null;
            onChangeHub(hub);
            onChangeProject(null);
          }}
        >
          <option value="">Select a hub…</option>
          {hubs.map((hub) => (
            <option key={hub.id} value={hub.id}>
              {hub.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Project
        <select
          value={projectId ?? ""}
          disabled={!hubId}
          onChange={(e) => {
            const project = projects.find((p) => p.id === e.target.value) ?? null;
            onChangeProject(project);
          }}
        >
          <option value="">Select a project…</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
