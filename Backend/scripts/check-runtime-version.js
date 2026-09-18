const path = require("node:path");
const { version: packageVersion } = require(path.resolve(__dirname, "../package.json"));

const REQUEST_TIMEOUT_MS = 5000;

async function checkRuntimeVersion(rawUrl, { expectedVersion = packageVersion, fetchImpl = globalThis.fetch } = {}) {
  if (!rawUrl) throw new Error("Versions-URL fehlt");
  const url = new URL(rawUrl);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Versions-URL muss HTTP oder HTTPS verwenden");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`Versionsabruf antwortete mit HTTP ${response.status}`);
    const data = await response.json();
    const runtimeVersion = typeof data?.version === "string" ? data.version : null;
    if (!runtimeVersion) throw new Error("Versionsantwort enthaelt keine Version");
    if (runtimeVersion !== expectedVersion) {
      throw new Error(`Laufzeitversion ${runtimeVersion} stimmt nicht mit Paketversion ${expectedVersion} ueberein`);
    }
    return runtimeVersion;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const rawUrl = process.argv[2] || process.env.RUNTIME_VERSION_URL;
  try {
    const version = await checkRuntimeVersion(rawUrl);
    process.stdout.write(`Laufzeitversion ${version} stimmt mit Backend/package.json ueberein.\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { checkRuntimeVersion };
