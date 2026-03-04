# seedance-image-gen

Generate images with Volcengine (Bytedance) Seedance and save them locally.

## Command

```bash
node ./skills/seedance-image-gen.mjs \
  --prompt "A modern SaaS hero illustration" \
  --count 1 \
  --size 1536x1024 \
  --out-dir ./assets/seedance
```

## Required Env

- `SEEDANCE_API_KEY`

## Optional Env

- `SEEDANCE_MODEL` (default: `doubao-seedream-4-0-250828`)
- `SEEDANCE_BASE_URL` (default: `https://ark.cn-beijing.volces.com/api/v3`)

## Notes

- The script supports response formats `b64_json` and `url`.
- Output includes image files and a JSON manifest in the target directory.
