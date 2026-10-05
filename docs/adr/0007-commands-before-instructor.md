# Commands first with on-device generation

Status: superseded by ADR-0012.

The original design prioritised instant commands and offline questions.

It proposed Apple-first generation and model tools for knowledge/session actions.
[ADR 0012](0012-text-instructor-with-ordered-fallback.md) replaces that model policy.

- Commands remain deterministic and run first.
- Model tools and the Android self-hosted model were not adopted.
