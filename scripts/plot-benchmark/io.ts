import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const hash = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");
export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(
    tmp,
    JSON.stringify(
      value,
      (_key, item) => (item === undefined ? null : item),
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  fs.renameSync(tmp, file);
}
export const readJson = (file: string): unknown =>
  JSON.parse(fs.readFileSync(file, "utf8"));
export function appendJson(file: string, value: unknown): void {
  fs.appendFileSync(file, JSON.stringify(value) + "\n", { mode: 0o600 });
}
