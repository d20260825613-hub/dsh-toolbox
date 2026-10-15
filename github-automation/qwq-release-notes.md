# nameplate 0.1.0

Two things in one tool: an audit of how a repository presents itself, and
offline generation of the graphics to fix the gaps.

## What the audit checks

- the files a visitor looks for: README, LICENSE, CHANGELOG, SECURITY,
  CONTRIBUTING, CODE_OF_CONDUCT
- the manifest fields a registry reads: description, repository, license,
  engines
- whether the README explains the project, shows a runnable example, and has the
  four headings people scan for
- anything committed that should not be: node_modules, .env, private keys
- conflicting lockfiles
- whether tests exist

## Notes

The committed-file checks read `git ls-files` rather than walking the directory,
so a gitignored `node_modules` is not reported as tracked. A tool that accuses
you of a mistake you did not make is worse than no tool.

`badge` and `banner` write plain SVG into your repository, so a README carries
its own graphics instead of requesting them from a third-party badge service on
every page view.

No HTTP client, no token, no telemetry.

## Install

```bash
npx nameplate audit .
```
