# Contributing to TinyOp

Thanks for taking the time to contribute. TinyOp is a small, focused library and contributions should stay consistent with that fixes, edge cases, and well-reasoned additions, not feature creep. 

By submitting a pull request, issue fix, or any other contribution to this repository, you agree that:

1. You are the original author of the contribution, or have the right to submit it.
2. Your contribution is provided under the **GNU General Public License v3.0** that governs this project.
3. You retain full copyright ownership of your contribution.


## What to contribute

**Good contributions:**

- Bug fixes with a clear description of what was wrong and how to verify it's fixed
- Edge cases in spatial queries, transactions, or event handling that produce incorrect results
- Performance improvements with benchmark evidence
- Documentation corrections — wrong API shapes, misleading examples, typos
- Tests for untested behaviour

**Discuss first (open an issue before writing code):**

- New API methods or changes to existing method signatures
- Changes to the spatial indexing strategy or query engine
- Anything that would increase the bundle size meaningfully
- `TinyOp+` changes involving sync or vector clock behaviour

**Out of scope:**

- Persistence backends — `store.dump()` and `store.checkpoint()` are the persistence boundary
- Framework integrations (React hooks, Vue plugins, etc.) — these belong in separate packages
- TypeScript types — may be added as a separate `.d.ts` file in future

---

## How to contribute

1. Fork the repository and create a branch from `main`.
2. Make your change. Keep it focused — one fix or addition per PR.
3. Test it manually against the relevant scenarios. There is no automated test suite yet; describe in the PR how you verified the change works and doesn't break existing behaviour.
4. Open a pull request with a clear title and description. Reference any related issue.

---

## Code style

TinyOp core is intentionally dense. Match the existing style:

- No dependencies, no build step
- Compact but not obfuscated — variable names should be readable in context
- New public API methods follow the existing naming conventions (`find`, `near`, `get`, `create`, etc.)
- No TypeScript in the source files
- No comments in the minified-style sections of `TinyOp.js` — the README is the documentation

---

## Reporting bugs

Open an issue with:

- The version of `TinyOp.js` you are using
- A minimal reproduction — ideally a self-contained code snippet
- What you expected to happen and what actually happened
- Node version and environment if relevant (browser, React Native, etc.)

---

## License

By contributing, you agree that your contributions will be licensed under GPL-3.0.

See [LICENSE](LICENSE) for the full terms.


Thanks for contributing.
