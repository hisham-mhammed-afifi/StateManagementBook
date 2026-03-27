# Review Chapter

Review and improve chapter number: $ARGUMENTS

## Resolving the Chapter

1. Read `outline/BOOK_OUTLINE.md` and find the chapter matching the number provided (e.g., "1" matches "Ch 1").
2. Derive the file path: `public/book/part-{N}/chapter-{NN}-{slug}.md`.
3. Read the chapter file at that path.

## Pre-Review Setup

1. Read `CLAUDE.md` for all writing constraints, API stability labels, NgRx v21 API names, and Angular 21 defaults.
2. Use the outline to understand what this chapter should cover.
3. Check `references/` for the research file related to this chapter's topic. Use it as the source of truth for API accuracy.
4. Read the previous and next chapter files (if they exist) to check continuity.

## Review Criteria

### 1. API Accuracy (highest priority)
- Search the web to verify every API call, import path, and method signature against Angular 21 / NgRx 21.
- Cross-reference against the research file in `references/`.
- Check for renamed APIs (e.g., `withEffects` should be `withEventHandlers`).
- Verify experimental APIs have the stability callout block from CLAUDE.md.

### 2. Code Compilation
- Every code example must be valid TypeScript that would compile.
- No `...` placeholders, no pseudocode, no missing imports.
- All components must be standalone (no NgModules).
- All injection must use `inject()`, not constructor injection.
- All templates must use `@if`/`@for`/`@switch`, not `*ngIf`/`*ngFor`.
- No zone.js assumptions unless explicitly discussing legacy patterns.

### 3. Completeness
- Every concept introduced in prose MUST have a code example.
- The "Common Mistakes" section must have at least 3 items, each with wrong code, explanation, and corrected code.
- Key Takeaways must be 3-5 concrete, actionable bullet points.

### 4. Structure and Flow
- Does the chapter open with a specific real-world problem (not generic filler)?
- Does complexity build logically from simple to advanced?
- Are there abrupt jumps between topics?
- Does it reference previous chapters with brief recaps (not bare references)?

### 5. Voice and Tone
- Uses "we" for code walkthroughs, "you" for advice/rules.
- No em dashes anywhere.
- No fluff sentences. Every paragraph teaches something.
- No generic filler like "State management is important because..."

### 6. Continuity
- Terminology matches previous chapters (same terms for same concepts).
- Example domain is consistent with the rest of the book.
- Forward/backward references to other chapters are accurate (correct chapter numbers after consolidation to 39 chapters).

## Output

- Apply all fixes directly to the chapter file.
- Add review notes at the top of the file as an HTML comment:

```html
<!-- Review: {date}
  - Changes made: {bulleted list of changes}
  - Verified against: Angular 21.x / NgRx 21.1.x
  - Research file: references/{filename}
  - Status: PASS / NEEDS SECOND REVIEW
-->
```

- If major structural issues are found (wrong chapter scope, missing entire sections), flag them clearly and explain what needs to be rewritten rather than patching.
