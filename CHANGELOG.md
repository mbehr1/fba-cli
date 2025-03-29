# Changelog

All notable changes to this project will be documented in this file. See 
[Conventional Commits](https://conventionalcommits.org) for commit guidelines.


# [1.7.0](https://github.com/mbehr1/fba-cli/compare/v1.6.8...v1.7.0) (2025-03-29)


### Features

* **exec:** add option to write report to file ([caa4261](https://github.com/mbehr1/fba-cli/commit/caa42614880db48293ef07942966ecb77f32b9bb))

## [1.6.8](https://github.com/mbehr1/fba-cli/compare/v1.6.7...v1.6.8) (2025-03-29)

## [1.6.7](https://github.com/mbehr1/fba-cli/compare/v1.6.6...v1.6.7) (2025-03-02)


### Bug Fixes

* **deps:** bump dlt-logs-utils ([a63a90f](https://github.com/mbehr1/fba-cli/commit/a63a90f4849d282aed1786cfa482702f0261983d))

## [1.6.6](https://github.com/mbehr1/fba-cli/compare/v1.6.5...v1.6.6) (2025-03-02)


### Bug Fixes

* **deps:** bump dlt-logs-utils ([797f9bd](https://github.com/mbehr1/fba-cli/commit/797f9bd7dc2b2afc3ecf5a21601730f7b7cddc7d))

## [1.6.5](https://github.com/mbehr1/fba-cli/compare/v1.6.4...v1.6.5) (2025-02-13)


### Bug Fixes

* **exec:** handle sequence conversion errors ([3651448](https://github.com/mbehr1/fba-cli/commit/3651448f6d42329c1ec7f7957378d800c38d61ce))

## [1.6.4](https://github.com/mbehr1/fba-cli/compare/v1.6.3...v1.6.4) (2025-01-13)


### Bug Fixes

* **deps:** bump dlt-logs-utils ([de9afb1](https://github.com/mbehr1/fba-cli/commit/de9afb165aec4009eb864aabe49fb7945e2e2f46))

## [1.6.3](https://github.com/mbehr1/fba-cli/compare/v1.6.2...v1.6.3) (2025-01-07)


### Bug Fixes

* **deps:** bump dlt-logs-utils ([6d5db11](https://github.com/mbehr1/fba-cli/commit/6d5db118afa3512470e80a428309fd756c972cfd))

## [1.6.2](https://github.com/mbehr1/fba-cli/compare/v1.6.1...v1.6.2) (2025-01-01)


### Bug Fixes

* **deps:** bump dlt-logs-utils ([e33827f](https://github.com/mbehr1/fba-cli/commit/e33827f47bd5393e24e6d44a42092a21ab96fec0))

## [1.6.1](https://github.com/mbehr1/fba-cli/compare/v1.6.0...v1.6.1) (2025-01-01)

# [1.6.0](https://github.com/mbehr1/fba-cli/compare/v1.5.1...v1.6.0) (2024-11-23)


### Features

* **sequence:** add context support ([73a6528](https://github.com/mbehr1/fba-cli/commit/73a6528a2854c1f8a72374d5802a7cc245982143))

## [1.5.1](https://github.com/mbehr1/fba-cli/compare/v1.5.0...v1.5.1) (2024-11-20)


### Bug Fixes

* **sequences:** incr limit to 1mio msgs ([f56460d](https://github.com/mbehr1/fba-cli/commit/f56460d4fcdfefdabe6b497bb385d159897214cf))

# [1.5.0](https://github.com/mbehr1/fba-cli/compare/v1.4.0...v1.5.0) (2024-11-19)


### Features

* **sequence:** first support for badges ([fdb3432](https://github.com/mbehr1/fba-cli/commit/fdb3432d287d668fb1f8d0beb117c796097505f4))

# [1.4.0](https://github.com/mbehr1/fba-cli/compare/v1.3.1...v1.4.0) (2024-10-13)


### Features

* **exec:** use new one_pass support ([de751da](https://github.com/mbehr1/fba-cli/commit/de751da98b37d85d3f531fca007e55cb88deaed4))

## [1.3.1](https://github.com/mbehr1/fba-cli/compare/v1.3.0...v1.3.1) (2024-09-29)

# [1.3.0](https://github.com/mbehr1/fba-cli/compare/v1.2.0...v1.3.0) (2024-09-29)


### feat

* **exec:** show lifecycle infos ([804d971](https://github.com/mbehr1/fba-cli/commit/804d9717e3fdc28e55bd555d8cebbb8a35b4c4b6))
* show lifecycle infos ([5725116](https://github.com/mbehr1/fba-cli/commit/5725116748ac7a890e12f023b6f097c85a6c80e6))


### fix

* multibar output ([93de5e9](https://github.com/mbehr1/fba-cli/commit/93de5e9e8af725c962fbf2eb7dd81d044a3d6700))

# [1.2.0](https://github.com/mbehr1/fba-cli/compare/v1.1.2...v1.2.0) (2024-09-29)


### chore

* **deps:** update dependencies ([40e0209](https://github.com/mbehr1/fba-cli/commit/40e02097eee5331c521a531b09ccbb1cd521181c))
* update remote types to match adlt 0.60 ([2939946](https://github.com/mbehr1/fba-cli/commit/29399463ab4b89307f42837ee5e83c983e0d8272))


### feat

* add class DltFilter ([54b48f4](https://github.com/mbehr1/fba-cli/commit/54b48f40a6a3d8ff42c3904eac33a27bb897fa99))
* add first events support ([7a0c822](https://github.com/mbehr1/fba-cli/commit/7a0c822c1edc73f8776d929b006b4e3f4c0e3cf6))
* add support for events ([f5ea0b1](https://github.com/mbehr1/fba-cli/commit/f5ea0b1b238e45d62b12d2e37c3f56de3f4b6adb))


### fix

* at startup wait for all msgs being loaded ([c90d048](https://github.com/mbehr1/fba-cli/commit/c90d048f85c519ba046500b3dedfeaf15acb38b6))
* getMatchingMessages returns ViewableDltMsgs ([9d78315](https://github.com/mbehr1/fba-cli/commit/9d7831567b9642e33609d10b1b1e9ba538f63ee3))
* pass bintype Progress to fileBasedMsgsHandler ([5c72ac0](https://github.com/mbehr1/fba-cli/commit/5c72ac0b9a973c2ab42e6f6000af3860cfb53ef7))

## [1.1.2](https://github.com/mbehr1/fba-cli/compare/v1.1.1...v1.1.2) (2024-01-08)


### fix

* **export:** autodetect regex for apid/ctid ([86b9cd0](https://github.com/mbehr1/fba-cli/commit/86b9cd0b3661decaba172763260ac9b64c8e02ad))
* **export:** autodetect regex for apid/ctid ([0615ff8](https://github.com/mbehr1/fba-cli/commit/0615ff8d95b394d3fd6bf466dd84ae072b614d1a))

## [1.1.1](https://github.com/mbehr1/fba-cli/compare/v1.1.0...v1.1.1) (2024-01-04)


### fix

* **export:** change file name ext to dlf ([cb99dca](https://github.com/mbehr1/fba-cli/commit/cb99dcaa9ac38e8269e5bdd67c9f9d5da3b7f065))
* **export:** change file name ext to dlf ([f67ba79](https://github.com/mbehr1/fba-cli/commit/f67ba799250ca0529257b26baea3cbde80f814f1))

# [1.1.0](https://github.com/mbehr1/fba-cli/compare/v1.0.7...v1.1.0) (2024-01-04)


### feat

* add export of filters in dlt-viewer xml format ([658d271](https://github.com/mbehr1/fba-cli/commit/658d2710422f015bad38e8296345dc0d76df6053))
* add export of filters in dlt-viewer xml format ([6e0fdf0](https://github.com/mbehr1/fba-cli/commit/6e0fdf0343f93687d001be8e55ede44640cd4dc4))

## [1.0.7](https://github.com/mbehr1/fba-cli/compare/v1.0.6...v1.0.7) (2023-11-12)


### ci

* dont publish jest.config.ts ([5164fa0](https://github.com/mbehr1/fba-cli/commit/5164fa072ca56b66e9c4df1a4828f0b9b78ea78c))


### fix

* generate CHANGELOG.md ([4b14ef3](https://github.com/mbehr1/fba-cli/commit/4b14ef3af4a79bcb17abca61ea6bd0dba199c8d1))
