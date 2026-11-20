# uv Setup — Per-Platform

Install uv explicitly through a package manager. Setup never downloads or executes a remote installer and never upgrades an existing installation.

| Platform | Explicit installation command |
|---|---|
| macOS / Homebrew Linux | `brew install uv` |
| Linux / WSL with pipx | `pipx install uv` |
| Windows | `winget install --id=astral-sh.uv -e` |

Package managers provide their own distribution verification. Use your organisation's approved package source and version policy. CI should provision uv through that same package manager before running this skill.

Verify with `bash scripts/setup-uv.sh` or `powershell -File scripts/setup-uv.ps1`. Both return failure if uv is missing, and otherwise run only `uv --version`. Ensure the package manager's binary directory is on PATH.

Updates are separate, explicit actions: `brew upgrade uv`, `pipx upgrade uv`, or `winget upgrade --id=astral-sh.uv -e`.

With `LAZYNEON_OFFLINE=1`, verification still works for an existing uv; a missing uv fails without downloading. For air-gapped systems, provision uv from an approved offline package repository. Subsequent `uv run --with ...` also requires cached packages or an approved package mirror.
