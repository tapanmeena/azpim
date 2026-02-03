# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [1.3.0](https://github.com/tapanmeena/azpim/compare/v1.4.0...v1.3.0) (2026-02-03)


### Features

* add debug logging functionality and enhance error handling across modules ([05bb2c2](https://github.com/tapanmeena/azpim/commit/05bb2c22440b60e524581dde751a0a26f51e2c7b))
* add subscription reader support for role activation and deactiv… ([#4](https://github.com/tapanmeena/azpim/issues/4)) ([9e3b231](https://github.com/tapanmeena/azpim/commit/9e3b231f4e6d7be868177d0d98301f81dbddf220))
* enhance subscription selection and favorite management in deactivation flow ([c77fa01](https://github.com/tapanmeena/azpim/commit/c77fa010057b4143ccaa825a2d47d37ccf48098e))


### Bug Fixes

* normalize presets data structure in loadPresets function ([b283bbc](https://github.com/tapanmeena/azpim/commit/b283bbc8a013bac1dec81906b312184384f7a7d6))
* revert version number to 1.0.0 in package.json ([e1a2692](https://github.com/tapanmeena/azpim/commit/e1a26925e2fc14e7de04c5934d2c5fb307410d83))

## [1.2.0](https://github.com/tapanmeena/azpim/compare/v1.4.0...v1.2.0) (2026-01-31)


### Features

* add subscription reader support for role activation and deactiv… ([#4](https://github.com/tapanmeena/azpim/issues/4)) ([9e3b231](https://github.com/tapanmeena/azpim/commit/9e3b231f4e6d7be868177d0d98301f81dbddf220))


### Bug Fixes

* revert version number to 1.0.0 in package.json ([e1a2692](https://github.com/tapanmeena/azpim/commit/e1a26925e2fc14e7de04c5934d2c5fb307410d83))

## [1.4.0](https://github.com/tapanmeena/azp-cli/compare/v1.3.1...v1.4.0) (2026-01-15)


### Features

* add presets management functionality to CLI ([253c66c](https://github.com/tapanmeena/azp-cli/commit/253c66c3691d31f7bc032c293b069667a6a148b5))
* add subscription reader support for role activation and deactivation ([182027b](https://github.com/tapanmeena/azp-cli/commit/182027be73accf0d9f3b13385b28da1701b50297))
* utilize cached update check result if within interval ([b4c999d](https://github.com/tapanmeena/azp-cli/commit/b4c999d37fcbbb23ba9d2f637833ba48dd7a38e9))

### [1.3.1](https://github.com/tapanmeena/azp-cli/compare/v1.3.0...v1.3.1) (2026-01-14)

## [1.3.0](https://github.com/tapanmeena/azp-cli/compare/v1.2.0...v1.3.0) (2026-01-14)


### Features

* add Azure CLI installation check before authentication ([c291268](https://github.com/tapanmeena/azp-cli/commit/c291268359854e7da74a0cea046741c0449609d7))
* update package.json with repository type; rename CLI command to 'check-update' and adjust header formatting ([8ef92d4](https://github.com/tapanmeena/azp-cli/commit/8ef92d4da233459f7631f2bf4f85ed5a4113c918))
* update README with new features and installation instructions; refactor CLI command name to 'azp' ([24510f7](https://github.com/tapanmeena/azp-cli/commit/24510f78f44f9e1570d93c8b750aa6a41b27b62e))

## [1.2.0](https://github.com/tapanmeena/azp-cli/compare/v1.1.0...v1.2.0) (2026-01-13)


### Features

* enhance header display with improved formatting and styling ([7f88b3c](https://github.com/tapanmeena/azp-cli/commit/7f88b3c6dc49f141ab7925bb2d9b89aaf5f70bbf))

## [1.1.0](https://github.com/tapanmeena/azp-cli/compare/v1.0.0...v1.1.0) (2026-01-13)


### Features

* add update command to check for newer azp-cli versions ([be50502](https://github.com/tapanmeena/azp-cli/commit/be5050207b90335aace73927ccd9cc47e1c7f9ae))

## [1.0.0](https://github.com/tapanmeena/azp-cli/compare/v0.0.4...v1.0.0) (2026-01-13)


### Features

* add presets CLI for managing activation and deactivation presets ([67a50c5](https://github.com/tapanmeena/azp-cli/commit/67a50c545126bd8f9eed8f3f7ba24987a51f854a))

### [0.0.4](https://github.com/tapanmeena/azp-cli/compare/v0.0.3...v0.0.4) (2026-01-13)

### Features

- add reusable presets for activation/deactivation (stored in user config dir)
- add preset management commands: `preset list|show|add|edit|remove`
- support justification templates (`${date}`, `${datetime}`, `${userPrincipalName}`)

### 0.0.3 (2026-01-13)

### Features

- add Azure PIM CLI for role activation and deactivation ([2d10b87](https://github.com/tapanmeena/azp-cli/commit/2d10b87eab7d51a6427f4a70f200521e66e45b98))
- add copilot instructions for azp-cli ([4c9ab89](https://github.com/tapanmeena/azp-cli/commit/4c9ab894110595f2c88ef8b12073ea51b2c468ef))
- enhance CLI with non-interactive activation and deactivation options ([3e6fa12](https://github.com/tapanmeena/azp-cli/commit/3e6fa1253e7f1fa1e29c9a75cb90fa6a3d5484bc))

### Bug Fixes

- revert version number to 0.0.1 in package.json ([0e814da](https://github.com/tapanmeena/azp-cli/commit/0e814da76560c3416602c46bdc9ae7c2b312e6ea))
- update @types/node dependency to version 25.0.6 ([21a03a1](https://github.com/tapanmeena/azp-cli/commit/21a03a12eff9ee372ff2f398dfdab40ae83891b1))
- update import paths to use relative references ([2a287af](https://github.com/tapanmeena/azp-cli/commit/2a287af68d1e0071a8c48af38d46546ccbe184e1))

## [0.0.2] - 2026-01-13

### Added

- Initial public release.
