## Description

What does this PR do? What problem does it solve?

## Related Issue

Fixes #(issue number)

## Architecture Impact

- Owning capability/module:
- Failure and degradation behavior:
- State owner and lifecycle:
- Permission or IPC surface changes:
- Diagnostics and verification:
- ADR: Not required / `docs/decisions/...`

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Documentation
- [ ] Refactoring / Code cleanup
- [ ] Other (please describe)

## Testing

- [ ] Tested with `pnpm dev`
- [ ] `pnpm verify` passes
- [ ] Added/updated tests

## Checklist

- [ ] Code follows the repository style guide
- [ ] Change complies with the architecture constitution in `docs/architecture.md`
- [ ] Change preserves the closed S0-S4 stable baseline
- [ ] Capability failure degrades independently and exposes a diagnosable state
- [ ] IPC/preload changes include sender, runtime schema, scope, and cleanup review
- [ ] State ownership and lifecycle are explicit; no new cross-store implicit transaction
- [ ] External irreversible actions still require explicit user confirmation
- [ ] No architecture exception is introduced, or an accepted ADR is included under `docs/decisions/`
- [ ] Comments added where necessary (in Chinese)
- [ ] Documentation updated if needed
- [ ] Package or edition changes include the target checks from `docs/ops/package-target-check.md`
- [ ] No new warnings introduced
