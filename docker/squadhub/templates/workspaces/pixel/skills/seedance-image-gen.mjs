#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

function usage() {
  console.log(`Seedance image generation

Usage:
  node ./skills/seedance-image-gen.mjs --prompt "A minimal SaaS hero illustration"

Options:
  --prompt <text>          Required prompt
  --count <n>              Number of images (default: 1)
  --size <WxH>             Image size (default: 1536x1024)
  --model <name>           Model id (default: SEEDANCE_MODEL or doubao-seedream-4-0-250828)
  --out-dir <path>         Output directory (default: ./assets/seedance)
  --response-format <fmt>  b64_json or url (default: b64_json)
  --help                   Show this message

Environment:
  SEEDANCE_API_KEY         Required API key
  SEEDANCE_MODEL           Optional model override
  SEEDANCE_BASE_URL        Optional base URL (default: https://ark.cn-beijing.volces.com/api/v3)
`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function inferExtFromContentType(contentType) {
  const type = (contentType || "").toLowerCase();
  if (type.includes("webp")) return "webp";
  if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
  if (type.includes("gif")) return "gif";
  return "png";
}

async function loadJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function downloadToFile(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download generated image (${response.status})`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(outputPath, buffer);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }

  const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
  if (!prompt) {
    usage();
    throw new Error("--prompt is required");
  }

  const apiKey = process.env.SEEDANCE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("SEEDANCE_API_KEY is required");
  }

  const model =
    (typeof args.model === "string" && args.model.trim()) ||
    process.env.SEEDANCE_MODEL?.trim() ||
    "doubao-seedream-4-0-250828";
  const baseUrl = (
    process.env.SEEDANCE_BASE_URL?.trim() ||
    "https://ark.cn-beijing.volces.com/api/v3"
  ).replace(/\/+$/, "");
  const outputDir =
    (typeof args["out-dir"] === "string" && args["out-dir"].trim()) ||
    "./assets/seedance";
  const count = toPositiveInt(args.count, 1);
  const size =
    (typeof args.size === "string" && args.size.trim()) || "1536x1024";
  const responseFormat =
    (typeof args["response-format"] === "string" &&
      args["response-format"].trim()) ||
    "b64_json";

  await mkdir(outputDir, { recursive: true });

  const payload = {
    model,
    prompt,
    n: count,
    size,
    response_format: responseFormat,
  };

  const response = await fetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const result = await loadJson(response);
  if (!response.ok) {
    const message =
      result?.error?.message ||
      result?.message ||
      `Seedance request failed (${response.status})`;
    throw new Error(String(message));
  }

  const outputs = [];
  const items = Array.isArray(result?.data) ? result.data : [];
  const timestamp = Date.now();

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i] || {};
    const index = i + 1;
    if (typeof item.b64_json === "string" && item.b64_json.length > 0) {
      const outputPath = join(outputDir, `seedance-${timestamp}-${index}.png`);
      await writeFile(outputPath, Buffer.from(item.b64_json, "base64"));
      outputs.push({ index, path: outputPath });
      continue;
    }

    if (typeof item.url === "string" && item.url.length > 0) {
      let ext = "png";
      try {
        const probe = await fetch(item.url, { method: "HEAD" });
        ext = inferExtFromContentType(probe.headers.get("content-type"));
      } catch {
        ext = "png";
      }
      const outputPath = join(outputDir, `seedance-${timestamp}-${index}.${ext}`);
      await downloadToFile(item.url, outputPath);
      outputs.push({ index, path: outputPath, sourceUrl: item.url });
    }
  }

  const manifestPath = join(outputDir, `seedance-${timestamp}-manifest.json`);
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        model,
        size,
        countRequested: count,
        prompt,
        outputCount: outputs.length,
        outputs,
      },
      null,
      2,
    ),
  );

  if (outputs.length === 0) {
    throw new Error("API succeeded but returned no image data");
  }

  console.log(`Generated ${outputs.length} image(s).`);
  for (const output of outputs) {
    console.log(`- ${output.path}`);
  }
  console.log(`Manifest: ${manifestPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`seedance-image-gen failed: ${message}`);
  process.exit(1);
});
