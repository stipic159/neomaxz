---
name: library-docs-style
description: Writes, refactors, and standardizes software library documentation (README, API references, guides, examples, and changelogs) using consistent tone, precise terminology, verified signatures, and self-contained code examples.
---

# Library Documentation Guidelines

Maintain strict consistency across all documentation so it reads as if written by a single technical author, regardless of which model or contributor generates it.

## Source of Truth

1. Inspect the codebase first: `package.json`, exported types, entry points, unit/e2e tests, and existing documentation.
2. Document only existing, publicly exported APIs. Never invent methods, options, or speculative behaviors.
3. If an implementation detail is unclear or unverified, mark it with `TODO: verify behavior` instead of guessing.
4. Conflict resolution order: Public Types & Tests > Source Code Implementation > Existing README > Inline Comments.

## Document Structure

Adapt the structure to the document type while maintaining predictable ordering:

### Main README / Overview
1. **Title & Purpose**: One sentence stating precisely what the library does.
2. **Installation**: Direct package manager commands (`npm`, `pnpm`, `yarn`).
3. **Quick Start**: Minimal, copy-pasteable snippet demonstrating the most common workflow.
4. **Core Features**: Factual list of capabilities without marketing claims.
5. **API Overview**: High-level map of main modules or link to the API reference.
6. **Usage Examples**: Focused, realistic scenarios.
7. **Error Handling**: How errors are emitted, caught, or typed.
8. **Requirements & Limitations**: Runtime versions, platform support, and peer dependencies.
9. **FAQ / Troubleshooting**: Optional; include only for non-trivial edge cases.

### API Reference Entry
For every exported class, function, type, or interface:
- **Signature**: Exact language/TypeScript declaration.
- **Description**: 1–2 sentences explaining intent and behavior.
- **Parameters / Properties**: Name, type, required/optional status, default value, and description.
- **Returns**: Return type and semantics (including resolved Promise types).
- **Errors / Exceptions**: Specific error classes, codes, or reject triggers with exact conditions.
- **Minimal Example**: Self-contained runnable code snippet.
- **Side Effects & Caveats**: State mutations, network calls, thread safety, or performance overhead.

## Style & Voice

- **Language**: English by default, unless the repository explicitly mandates another language.
- **Tone**: Technical, factual, and direct. Use active voice and imperative mood ("Call `client.connect()`", "Pass the configuration object").
- **Zero Marketing Fluff**: Strip adjectives like *powerful*, *blazing fast*, *robust*, *simple*, *easy*, or *seamless*.
- **No Stating the Obvious**: Avoid redundant text (e.g., do not write "The `name` parameter sets the name").
- **Clarity**: One core idea per sentence.
- **Code Fences**: Always specify the language tag for code blocks (`ts`, `js`, `bash`, `json`).

## Terminology Consistency

- Maintain a strict 1:1 mapping between terms and concepts throughout all pages:
    - Do not mix `instance`, `client`, and `object`.
    - Use `parameter` in function definitions, `argument` in function calls, and `option` in configuration objects.
    - Do not interchange `function` and `method`.
- Keep identifiers, filenames, environment variables, types, and commands in their exact casing and enclosed in backticks (`client.send()`, `tsconfig.json`).
- Never translate code identifiers into other languages.

## Code Examples

- **One scenario per example**: Keep snippets focused on solving a single task.
- **No hidden dependencies**: Include all necessary imports and prerequisite setup.
- **Public API only**: Never rely on internal modules, private fields, or unexported helpers.
- **No deprecated patterns**: Use current idiomatic practices and active APIs.
- **Type Annotations**: For TypeScript, provide explicit types where they aid comprehension.

## Final Review Checklist

Before finishing any documentation task, verify:
- [ ] Every documented symbol exists in the public exports.
- [ ] Parameter names, types, and defaults match source definitions exactly.
- [ ] All code snippets are syntactically valid and contain necessary imports.
- [ ] Terminology is uniform across all sections and files.
- [ ] No promotional words or empty filler sentences remain.
- [ ] All relative file paths, import specifiers, and internal links resolve correctly.