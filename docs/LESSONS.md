# THE RULE: lessons

Read the headlines before work. Record actual surprises from this project only, newest first. Each entry is `### YYYY-MM-DD: headline`, followed by bullets: what happened, the root cause with evidence, and the rule going forward. Update it in the same commit as the related behavior change.

### 2026-11-04: near CLI wrote THE RULE's key into another project's credentials folder

- **What happened:** `near account create-account ... save-to-legacy-keychain` saved the `therule.testnet` key under the CONSTITUTION project's `.secrets/near-credentials/`.
- **Root cause:** the WSL near-cli-rs config (`~/.config/near-cli/config.toml`) is shared, and its `credentials_home_dir` already pointed at that project. Evidence: the CLI printed the path after the create call.
- **Rule:** before the first key-writing command read `credentials_home_dir`. THE RULE uses only the `near-rule` wrapper (own `XDG_CONFIG_HOME`, credentials in `~/.near-credentials-the-rule`, mode 600). The two stray files were moved out and the other project's own entries were left unchanged.
