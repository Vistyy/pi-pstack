---
name: setup-pstack
description: Configure pstack model roles from models available to Pi. Use when installing pstack, changing delegation models, or repairing an unavailable role mapping.
---

# Set up pstack models in Pi

Use Pi's `/setup-pstack` command for the interactive setup flow.
The command reads the models available to the current Pi installation, displays every pstack role, and persists validated `provider/model` selectors in the Pi agent directory.

For a non-interactive setup, use `pstack_config`.

`pstack_config` owns the creator-equivalent baseline and returns it when no user configuration exists.
The baseline preserves the upstream role families, reasoning levels, panel order, and four-member fan-out through Pi selectors.
Treat that returned map as the starting state rather than replacing it with one inherited model.
If a baseline selector is unavailable, ask for a replacement and preserve model-family diversity across panel entries where the available set permits it.

1. Call `pstack_config` with `action: list-models`.
2. Call `pstack_config` with `action: get` to inspect current role mappings.
3. Set each changed single-worker role with `action: set`, its exact role name, `model`, and optional `thinking`.
4. Set each changed panel role with `models` and an optional same-length `thinkings` array.
5. Use `inherit-parent` when the role should use the parent Pi model, and omit the thinking value when it should inherit the parent's thinking level.
6. Preserve four entries for the upstream four-member review panels unless the user deliberately chooses another panel size.
7. Read the completed configuration with `action: get` and report any role left unchanged.

Never write a model selector that `list-models` did not return.
The tool owns the configuration path, validation, and idempotent persistence.
