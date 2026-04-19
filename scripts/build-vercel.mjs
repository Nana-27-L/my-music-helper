import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const rootDir = process.cwd();
const frontendDir = resolve(rootDir, "frontend");
const frontendDistDir = resolve(frontendDir, "dist");
const publicDir = resolve(rootDir, "public");

execSync("npm ci", { cwd: frontendDir, stdio: "inherit" });
execSync("npm run build", { cwd: frontendDir, stdio: "inherit" });

if (!existsSync(frontendDistDir)) {
  throw new Error("Frontend build failed: frontend/dist was not generated.");
}

rmSync(publicDir, { recursive: true, force: true });
mkdirSync(publicDir, { recursive: true });

for (const entryName of readdirSync(frontendDistDir)) {
  cpSync(
    resolve(frontendDistDir, entryName),
    resolve(publicDir, entryName),
    { recursive: true, force: true },
  );
}
