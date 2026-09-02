---
name: setup-pstack
description: Configure pstack model roles from models available to Pi. Use when installing pstack, changing delegation models, or repairing an unavailable role mapping.
---

# Set up pstack models in Pi

Use Pi's `/setup-pstack` command for the interactive setup flow.
The command reads the models available to the current Pi installation, displays every pstack role, and persists validated `provider/model` selectors in the Pi agent directory.

For a non-interactive setup, use `pstack_config`.

1. Call `pstack_config` with `action: list-models`.
2. Call `pstack_config` with `action: get` to inspect current role mappings.
3. Set each changed role with `action: set`, its exact role name, and either `model` or `models` for a panel role.
4. Use `inherit-parent` when the role should use the parent Pi model.
5. Read the completed configuration with `action: get` and report any role left unchanged.

Never write a model selector that `list-models` did not return.
The tool owns the configuration path, validation, and idempotent persistence.
