import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "fs";
import { dirname, join, resolve, sep } from "path";

import { extractDescription } from "./changelog.js";
import type { Feature } from "./feature.js";
import { slugify } from "./slugify.js";

import { LinearClient, LinearFetch, User, Issue, Team } from "@linear/sdk";

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  state: {
    id: string;
    name: string;
    type: string;
  } | null;
}

export interface LinearTeamSetup {
  teamId: string;
  teamLabel: string;
  startedStateId: string | null;
  completedStateId: string | null;
}

export function getLinearConfigFromEnv(): { apiKey: string; teamRef: string } | null {
  const apiKey = process.env.LINEAR_API_KEY?.trim();
  const teamRef =
    process.env.LINEAR_TEAM_KEY?.trim() ??
    process.env.LINEAR_TEAM?.trim() ??
    process.env.LINEAR_TEAM_NAME?.trim();

  if (!apiKey || !teamRef) return null;
  return { apiKey, teamRef };
}

export class LocalLinearClient {
  private readonly client: LinearClient;

  constructor(apiKey: string) {
    this.client = new LinearClient({ apiKey });
  }

  async getCurrentUser(): LinearFetch<User> {
    return this.client.viewer;
  }

  async getNextReadyIssue(): Promise<LinearIssue | null> {
    const me = await this.client.viewer;
    const myIssues = await me.assignedIssues();

    // const unassigned = await this.client.issues({
    //   filter: {
    //     assignee: { null: true },
    //   },
    // });

    // const myIssues = unassigned;

    const candidates: LinearIssue[] = [];

    if (myIssues.nodes.length) {
      // myIssues.nodes.map((issue) =>
      //   console.log(`${me.displayName} has issue: ${issue.title} ${issue.team}/${issue.teamId}`),
      // );
      for (const issue of myIssues.nodes) {
        const mapped = await this.mapIssue(issue);
        const type = mapped.state?.type?.toLowerCase() ?? "";
        // console.log(`Issue ${mapped.id} / ${mapped.identifier} is in state type: ${type}`);
        if (type === "triage" || type === "backlog" || type === "unstarted") {
          candidates.push(mapped);
        }
      }
    } else {
      console.log(`${me.displayName} has no issues`);
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    return candidates[0];
  }

  async createIssue(teamId: string, title: string, description: string): Promise<string> {
    const payload = await this.client.createIssue({ teamId, title, description });
    if (!payload.success) {
      throw new Error("Failed to create Linear issue.");
    }

    const issue = await Promise.resolve(payload.issue ?? null);
    if (!issue?.identifier) {
      throw new Error("Linear issue created without an identifier.");
    }

    return issue.identifier;
  }

  async updateIssueState(issueId: string, stateId: string): Promise<void> {
    const payload = await this.client.updateIssue(issueId, { stateId });
    if (!payload.success) {
      throw new Error(`Failed to update Linear issue state: ${issueId}`);
    }
  }

  async addComment(issueId: string, body: string): Promise<void> {
    const payload = await this.client.createComment({ issueId, body });
    if (!payload.success) {
      throw new Error(`Failed to create Linear comment for issue: ${issueId}`);
    }
  }

  async resolveTeamSetup(teamRef: string): Promise<LinearTeamSetup> {
    const normalizedRef = teamRef.trim();
    if (!normalizedRef) {
      throw new Error("Linear team reference is required.");
    }

    const team = await this.findTeam(normalizedRef);
    if (!team) {
      throw new Error(`Linear team not found: ${normalizedRef}`);
    }

    const stateConnection = await team.states();
    const states = stateConnection.nodes ?? [];
    const started =
      states.find((state) => state.type.toLowerCase() === "started") ??
      (team.startWorkflowState ? await Promise.resolve(team.startWorkflowState) : null);
    const completed = states.find((state) => state.type.toLowerCase() === "completed") ?? null;

    return {
      teamId: team.id,
      teamLabel: `${team.key} (${team.name})`,
      startedStateId: started?.id ?? null,
      completedStateId: completed?.id ?? null,
    };
  }

  private async mapIssue(issue: Issue): Promise<LinearIssue> {
    const resolvedState = issue.state ? await Promise.resolve(issue.state) : null;

    if (!issue.id || !issue.identifier || !issue.title || !issue.createdAt || !issue.updatedAt) {
      throw new Error("Linear issue is missing required fields.");
    }

    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description ?? "",
      createdAt:
        issue.createdAt instanceof Date ? issue.createdAt.toISOString() : String(issue.createdAt),
      updatedAt:
        issue.updatedAt instanceof Date ? issue.updatedAt.toISOString() : String(issue.updatedAt),
      state:
        resolvedState?.id && resolvedState.name && resolvedState.type
          ? {
              id: resolvedState.id,
              name: resolvedState.name,
              type: resolvedState.type,
            }
          : null,
    };
  }

  private async findTeam(teamRef: string): Promise<Team | null> {
    const byKey = await this.client.teams({
      first: 1,
      filter: { key: { eqIgnoreCase: teamRef } },
    });
    if (byKey.nodes.length > 0) return byKey.nodes[0];

    const byName = await this.client.teams({
      first: 1,
      filter: { name: { eqIgnoreCase: teamRef } },
    });
    return byName.nodes[0] ?? null;
  }
}

/**
 * Create a local markdown workfile from a Linear issue so the existing agent
 * workflow can operate unchanged.
 */
export function materializeLinearIssue(projectDir: string, issue: LinearIssue): Feature {
  const localDir = join(projectDir, ".kaibot", "linear");
  mkdirSync(localDir, { recursive: true });

  const safeTitle = slugify(issue.identifier) || "feature";
  const baseName = `${issue.identifier.toLowerCase()}_${safeTitle}`;
  const filePath = join(localDir, `${baseName}.md`);

  const content =
    issue.description?.trim() || `Implement Linear issue ${issue.identifier}: ${issue.title}`;
  writeFileSync(filePath, content + "\n");

  return {
    name: baseName,
    state: "new",
    filePath,
  };
}

/**
 * Delete a materialized Linear workfile and prune empty directories under
 * {projectDir}/.kaibot/linear.
 */
export function cleanupMaterializedLinearWorkfile(projectDir: string, filePath: string): void {
  const linearDir = resolve(join(projectDir, ".kaibot", "linear"));
  const targetPath = resolve(filePath);
  const linearPrefix = `${linearDir}${sep}`;

  // Safety guard: only delete files that are under .kaibot/linear.
  if (!targetPath.startsWith(linearPrefix)) return;

  if (existsSync(targetPath)) {
    rmSync(targetPath, { force: true });
  }

  let current = dirname(targetPath);
  while (current.startsWith(linearDir)) {
    if (existsSync(current) && readdirSync(current).length === 0) {
      rmdirSync(current);
    } else {
      break;
    }

    if (current === linearDir) break;
    current = dirname(current);
  }
}

/**
 * Remove stale local Linear workfiles from previous runs.
 */
export function cleanupStaleLinearWorkfiles(projectDir: string): void {
  const linearDir = resolve(join(projectDir, ".kaibot", "linear"));
  if (!existsSync(linearDir)) return;
  rmSync(linearDir, { recursive: true, force: true });
}

function getSectionLines(content: string, heading: string): string[] {
  const lines = content.split("\n");
  const start = lines.findIndex(
    (line) => line.trim().toLowerCase() === `## ${heading.toLowerCase()}`,
  );
  if (start === -1) return [];

  const section: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("## ")) break;
    section.push(line);
  }
  return section;
}

export function buildLinearPlanComment(identifier: string, planSection: string): string {
  return [`KaiBot started work on ${identifier}.`, "", "### Plan", "", planSection.trim()].join(
    "\n",
  );
}

export function buildLinearCompletionComment(
  feature: Feature,
  identifier: string,
  changedFiles: string[] = [],
): string {
  let summary = feature.name;
  let metadataLines: string[] = [];
  try {
    const content = readFileSync(feature.filePath, "utf8");
    summary = extractDescription(content, feature.name);
    metadataLines = getSectionLines(content, "Metadata")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- **"));
  } catch {
    // Best effort only
  }

  const changedFileLines =
    changedFiles.length > 0
      ? changedFiles.map((file) => `- \`${file}\``)
      : ["- (No tracked file changes detected)"];

  const metaLines =
    metadataLines.length > 0
      ? metadataLines
      : ["- **Cost:** unavailable", "- **Turns:** unavailable"];

  return [
    `KaiBot completed ${identifier}.`,
    "",
    "### Summary",
    summary,
    "",
    "### Changed Files",
    ...changedFileLines,
    "",
    "### Run Metadata",
    ...metaLines,
  ].join("\n");
}
