import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sanitizeUserSettings } from "../../src/core/settings.ts";
import { isValidSegmentPath } from "../../src/core/prompt-segments.ts";
import type { ProfileSnapshot } from "./contracts.ts";

export async function loadProfile(
  profileDir: string,
): Promise<ProfileSnapshot> {
  const file = path.join(profileDir, "cairn.db");
  if (!fs.existsSync(file)) throw new Error("Profile database does not exist");
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec("PRAGMA query_only = ON; BEGIN");
    const row = db
      .prepare("SELECT value_json FROM kv_documents WHERE key = 'settings'")
      .get();
    if (!row || typeof row.value_json !== "string")
      throw new Error("Profile has no settings");
    const settings = sanitizeUserSettings(JSON.parse(row.value_json));
    if (!settings) throw new Error("Invalid profile settings");
    const promptOverrides: Record<string, string> = {};
    for (const row of db
      .prepare("SELECT segment_path, content FROM prompt_overrides")
      .all()) {
      if (
        typeof row.segment_path === "string" &&
        typeof row.content === "string" &&
        isValidSegmentPath(row.segment_path)
      )
        promptOverrides[row.segment_path] = row.content;
    }
    db.exec("COMMIT");
    const authFile = path.join(profileDir, "auth.json");
    const authContent = fs.existsSync(authFile)
      ? fs.readFileSync(authFile, "utf8")
      : null;
    if (authContent !== null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(authContent);
      } catch {
        throw new Error("Profile credential store is not valid JSON");
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("Invalid profile credential store");
    }
    return { settings, promptOverrides, authContent };
  } finally {
    db.close();
  }
}
