# Dependencies

Status: Current.

## Exact Pins

Every dependency names one exact version:

- `package.json`: `"some-package": "1.2.3"`, never `^1.2.3` or `~1.2.3`.
  Internal packages use `"workspace:0.0.1"`. `yarn add` pins exactly by
  default (`defaultSemverRangePrefix` in `.yarnrc.yml`).
- `pyproject.toml`: `"some-package==1.2.3"`. Internal packages are named
  without a version and resolve through `[tool.uv.sources]`. `uv add` pins
  exactly (`add-bounds = "exact"`).

`nx run repo:check-projects` fails on anything else in a `package.json`
(`dependencies`, `devDependencies`, `optionalDependencies`, `resolutions`) or
a `pyproject.toml` (dependencies, optional dependencies, and dependency
groups; `[build-system]` keeps the range uv_build asks for).

The lockfiles (`yarn.lock`, `uv.lock`) pin everything transitive. Commit them
with the manifest change.

## Release-Age Gate

A release must be at least **seven days old** before it can be installed. A
compromised package is usually caught and pulled within days, so waiting a
week keeps most of them out.

| Ecosystem      | Setting                                        |
| -------------- | ---------------------------------------------- |
| npm (Yarn)     | `npmMinimalAgeGate: 7d` in `.yarnrc.yml`       |
| PyPI (uv)      | `exclude-newer = "7 days"` in `pyproject.toml` |
| Dependabot     | `cooldown: default-days: 7`                    |
| GitHub Actions | The same Dependabot cooldown                   |

An urgent fix, such as a security release, may need an exception. Exceptions
need the repository owner's approval and are recorded next to the setting with
the reason and a removal date:

- npm: add the exact `name@version` to `npmPreapprovedPackages` in
  `.yarnrc.yml`.
- PyPI: add the package to `exclude-newer-package` in `pyproject.toml`.

## Install Scripts

Third-party install scripts never run (`enableScripts: false`), and Git
dependencies are blocked (`approvedGitRepositories: []`). The packages in use
ship prebuilt binaries. A package that truly needs its build step gets an
exact `dependenciesMeta` entry with `built: true`, approved like an age-gate
exception.

## Security Overrides

When a vulnerable version arrives through a dependency that pins it, override
exactly that version in `resolutions` in the root `package.json`, and record
it here. Remove the override once the dependent ships the fix.

None are in place. Record each one in a table with the override, why it is
needed (the advisory and the dependency that pins the vulnerable version), and
when to remove it.

## Updates and Audits

- Dependabot opens grouped weekly PRs for npm, uv, and GitHub Actions.
- To update by hand, change the pin and reinstall: `yarn up <name>@<version>`
  or `uv add --package <project> '<name>==<version>'`, then commit the
  lockfile.
- The weekly CI run audits both ecosystems: `yarn npm audit --all --recursive --severity high`
  and `uv audit`. Fix findings by upgrading, or with an override as above.
