# TOOLS.md — Local Notes

## Image Generation

Use the local `seedance-image-gen` skill script for image generation.

Quick reference:

```bash
node ./skills/seedance-image-gen.mjs \
  --prompt "A modern SaaS hero illustration, soft gradients, clean geometry" \
  --count 1 \
  --size 1536x1024 \
  --out-dir ./assets/seedance
```

Required environment variable:

- `SEEDANCE_API_KEY`

Optional environment variables:

- `SEEDANCE_MODEL` (default: `doubao-seedream-4-0-250828`)
- `SEEDANCE_BASE_URL` (default: `https://ark.cn-beijing.volces.com/api/v3`)
- CLI overrides: `--model`, `--response-format`

If your Volcengine account exposes a different Seedance model id, pass it with `--model`.

Output: local image files + manifest JSON in the output directory.

## Asset Specs

- Hero images: 1792x1024 or 1536x1024
- Social preview: 1200x630
- Diagrams: As needed, clean and minimal

## Design Guidelines

_Add brand colors, fonts, style preferences here._

---

Add whatever helps you do your job.
