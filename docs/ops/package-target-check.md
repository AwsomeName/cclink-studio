# Package Target Check

> Current operational checklist. Last updated: 2026-07-28.

## Conclusion

OSS and commercial packages are different build targets. Before packaging, the operator
must identify the repository, product name, bundle identifier, assembly path, and output
directory. A successful `electron-builder` exit code does not prove that the intended
product was built.

## OSS Local Package Target

| Field             | Required value                                             |
| ----------------- | ---------------------------------------------------------- |
| Working directory | `cclink-studio` repository root                            |
| Package name      | `cclink-studio`                                            |
| Product name      | `CCLink Studio 开源版`                                     |
| Bundle identifier | `com.cclink.studio`                                        |
| Builder config    | `cclink-studio/electron-builder.yml`                       |
| Output            | `cclink-studio/dist/`                                      |
| Signing           | ad-hoc (`identity: '-'`), not notarized                    |
| Command           | `pnpm package:local`                                       |

This table describes local test packaging. Formal OSS releases use
`.github/workflows/release-oss.yml`, which overrides the ad-hoc identity with the protected
Developer ID, notarizes artifacts, and creates a Draft Release from an immutable Tag.

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

The package is invalid if its app name is `CCLink Studio`, its bundle identifier contains
`.commercial`, or it was produced under `cclink-dev/.build/cclink-studio-commercial`.

## Commercial Target

| Field             | Required value                          |
| ----------------- | --------------------------------------- |
| Working directory | `cclink-dev` repository root            |
| Product name      | `CCLink Studio`                         |
| Bundle identifier | `com.cclink.studio.commercial`          |
| Assembly          | `.build/cclink-studio-commercial`       |
| Output            | `.build/cclink-studio-commercial/dist/` |
| Command           | `pnpm commercial:package`               |
| Verification      | `pnpm commercial:package:check`         |

Commercial assembly copies the OSS source into an isolated build directory and overlays
`commercial/src`, the commercial Vite config, builder config, resources, scripts, and
package metadata. It must not write generated commercial source or configuration back into
the OSS repository.

## Delivery Gate

Before reporting a package as deliverable:

1. Record the exact command and working directory.
2. Record package version, architecture, product name, bundle identifier, and artifact path.
3. Run the target-specific package check.
4. Open the packaged app and confirm its first screen matches the intended edition.
5. Do not reuse an artifact based only on modification time or a similar filename.

If any identity field is ambiguous, stop. Rebuilding is cheaper than distributing the wrong
edition.
