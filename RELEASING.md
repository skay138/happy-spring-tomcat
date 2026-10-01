# Release Guide

Happy Spring Tomcat follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

## Choosing a version

### Patch (`1.1.0` → `1.1.1`)

Use a patch release for backward-compatible corrections to existing behavior:

- Bug, security, reliability, or compatibility fixes
- Validation and error-message improvements
- Internal implementation changes that preserve the existing workflow
- A setting added only to control or opt out of a bug fix

Examples: fixing duplicate Spring configuration loading, stabilizing Start/Restart/Stop, or preserving existing JSONC configuration.

### Minor (`1.1.x` → `1.2.0`)

Use a minor release for new backward-compatible functionality:

- A new command, execution mode, or independently useful setting
- Support for a new server, build system, or major workflow
- A substantial optional behavior that users may deliberately adopt

Example: introducing a supported isolated runtime mode that assembles a web application with Tomcat `WebResourceSet`s.

### Major (`1.x.x` → `2.0.0`)

Use a major release for incompatible changes:

- Removing or renaming existing settings or commands
- Changing generated configuration in a way that requires migration
- Replacing the existing workflow or changing defaults in a way likely to break projects

## Decision rules

- Classify the release by its largest user-visible change, not by the amount of code changed.
- New code does not automatically require a minor release when it only fixes existing behavior.
- When a change is technically compatible but materially changes the workflow, prefer a minor release.
- Pre-release testing does not change the target version; use a suffix such as `1.2.0-beta.1` when needed.

## Release checklist

1. Update `package.json` and `package-lock.json` to the same version.
2. Add a concise, user-focused entry to `CHANGELOG.md`.
3. Run `npm test`.
4. Build the VSIX with `npm run package`.
5. Install and smoke-test the generated VSIX before publishing.

## Current release

Version `1.2.0` is prepared at the maintainer’s explicit request. This release makes an exception to the major-version rule above: old path setting names are removed without aliases. Users must configure the new paths and run Setup again; see the README upgrade instructions.
