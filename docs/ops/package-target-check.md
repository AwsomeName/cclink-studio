# Package Target Check

> Current operational checklist. Last updated: 2026-10-12.

## Conclusion

This repository builds the only CCLink Studio desktop App. Local packaging and formal Release
use the same source tree and product identity; they differ only in signing, notarization and
publication. The legacy `cclink-dev` commercial overlay is not a current package target.

## Local Package Target

| Field             | Required value                       |
| ----------------- | ------------------------------------ |
| Working directory | `cclink-studio` repository root      |
| Package name      | `cclink-studio`                      |
| Product name      | `CCLink Studio 开源版`               |
| Bundle identifier | `com.cclink.studio`                  |
| Builder config    | `cclink-studio/electron-builder.yml` |
| Output            | `cclink-studio/dist/`                |
| Signing           | ad-hoc, not notarized                |
| Command           | `pnpm package:local`                 |

This table describes local test packaging. Formal releases use
`.github/workflows/release-oss.yml`, which applies the protected Developer ID, notarizes the
artifacts, and publishes a stable Release from an immutable Tag after all automated gates pass.

Preflight:

```bash
test "$(node -p "require('./package.json').name")" = "cclink-studio"
test "$(node -p "require('./package.json').productName")" = "CCLink Studio 开源版"
test "$(pwd -P)" = "$(git rev-parse --show-toplevel)"
rg -n "^productName: CCLink Studio 开源版$|^appId: com\\.cclink\\.studio$" electron-builder.yml
```

Postflight:

```bash
test -d "dist"
find dist -maxdepth 2 -name 'CCLink Studio 开源版.app' -print
find dist -maxdepth 1 \( -name '*开源版*.dmg' -o -name '*开源版*.zip' \) -print
```

An artifact produced under `cclink-dev/.build/cclink-studio-commercial`, using the legacy
`.commercial` bundle identifier, or assembled by overlaying another desktop source tree is not
a current CCLink Studio deliverable.

## Delivery Gate

Before reporting a package as deliverable:

1. Record the exact command, repository root and source SHA.
2. Record package version, architecture, product name, bundle identifier and artifact path.
3. For a local test package, run the checks above. For a formal Release, use `pnpm release` and
   verify the resulting `release-oss.yml` run and public assets.
4. Do not reuse an artifact based only on modification time or a similar filename.

If any identity field is ambiguous, stop. Rebuilding is cheaper than distributing the wrong
artifact.
