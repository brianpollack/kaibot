import { existsSync, readFileSync } from "fs";
import { join } from "path";

import type { FeatureRecord } from "../featureDb.js";

// ---------------------------------------------------------------------------
// Spend tracking
// ---------------------------------------------------------------------------

const DB_PATH = ".kaibot/features.json";

/**
 * Calculate the total USD spend for today by summing `totalCostUsd` from
 * all feature records completed today.
 */
export function getTodaySpend(projectDir: string): number {
  if (!projectDir) return 0;

  const dbFile = join(projectDir, DB_PATH);
  if (!existsSync(dbFile)) return 0;

  try {
    const raw = readFileSync(dbFile, "utf8");
    const records = JSON.parse(raw) as FeatureRecord[];
    if (!Array.isArray(records)) return 0;

    const todayStr = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

    let total = 0;
    for (const record of records) {
      if (record.completedAt && record.completedAt.startsWith(todayStr)) {
        total += record.totalCostUsd ?? 0;
      }
    }
    return total;
  } catch {
    return 0;
  }
}
