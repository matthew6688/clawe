import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, "..");
const nextRoot = path.join(appRoot, ".next");
const standaloneRoot = path.join(nextRoot, "standalone", "apps", "web");

async function replaceDir(source, destination) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true });
}

async function main() {
  await replaceDir(path.join(appRoot, "public"), path.join(standaloneRoot, "public"));
  await replaceDir(
    path.join(nextRoot, "static"),
    path.join(standaloneRoot, ".next", "static"),
  );
}

main().catch((error) => {
  console.error("Failed to prepare standalone assets", error);
  process.exit(1);
});
