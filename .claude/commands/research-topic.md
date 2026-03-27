# Research Topic

Research the topic for chapter number: $ARGUMENTS

## Resolving the Chapter

1. Read `outline/BOOK_OUTLINE.md` and find the chapter matching the number provided (e.g., "1" matches "Ch 1").
2. Extract the chapter title and topic scope from the outline entry.

## Context

Read CLAUDE.md for tech stack versions and constraints.
Use the outline to understand what this chapter must cover.

## Research Steps

1. **Web search**: Search for the latest information on this topic as of 2026. Use at least 3 different search queries to cover breadth.
2. **Official docs**: Check angular.dev and ngrx.io for current API signatures, parameters, return types, and usage examples.
3. **Breaking changes**: Explicitly search for breaking changes, deprecations, or renamed APIs in Angular 21 / NgRx 21 related to this topic.
4. **Experimental status**: Determine if any API covered is experimental or developer preview. Check CLAUDE.md for the list of known experimental APIs.
5. **Community patterns**: Find real-world examples, blog posts from recognized Angular experts (Manfred Steyer, Kevin Kreuzer, Angular Architects, Push-Based), and community best practices.
6. **Common pitfalls**: Search for common mistakes, StackOverflow questions, and GitHub issues related to this topic.

## Output Format

Save findings to `references/research-{topic-slug}.md` with this structure:

```markdown
# Research: {Topic Name}

**Date:** {today's date}
**Chapter:** Ch {N}
**Status:** Ready for chapter generation

## API Surface

List every API function/class/decorator covered in this chapter with:
- Import path
- Signature
- Stability status (Stable / Experimental / Developer Preview)

## Key Concepts

Bullet points of the core ideas this chapter must convey.

## Code Patterns

Working code snippets (paraphrased, not copied) demonstrating each API.
Include file path comments.

## Breaking Changes and Gotchas

- Any renamed APIs (e.g., withEffects -> withEventHandlers)
- Behavior changes from previous versions
- Known bugs or workarounds

## Sources

- Links to official docs
- Links to blog posts and articles
- Links to relevant GitHub issues or RFCs

## Open Questions

Anything unresolved that needs manual verification before writing.
```
