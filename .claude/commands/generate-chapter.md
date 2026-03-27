# Generate Chapter

Write book chapter number: $ARGUMENTS

## Resolving the Chapter

1. Read `outline/BOOK_OUTLINE.md` and find the chapter matching the number provided (e.g., "1" matches "Ch 1", "15" matches "Ch 15").
2. Extract the chapter title, part number, and topic scope from the outline entry.
3. Derive the file path: `public/book/part-{N}/chapter-{NN}-{slug}.md` (e.g., Ch 1 in Part 1 becomes `public/book/part-1/chapter-01-what-is-state.md`).

## Pre-Writing Checklist (do all before writing)

1. Read `CLAUDE.md` for all writing guidelines, API stability labels, NgRx v21 API names, and Angular 21 defaults.
2. Use the outline to understand where this chapter sits in the book and what comes before/after it.
3. Check `references/` for a research file on this topic. If one exists, use it as the primary source for API signatures and patterns. If none exists, perform web research first (search angular.dev, ngrx.io, and community sources).
4. Read the previous chapter file (if it exists) to ensure:
   - Terminology is consistent (same names for the same concepts)
   - The example application domain continues (don't switch from a "product catalog" to a "todo app" mid-book)
   - Complexity builds on what was already introduced
5. If this chapter covers an API listed as experimental in CLAUDE.md, prepare the stability callout block.

## Writing the Chapter

Follow the structure defined in CLAUDE.md strictly:

### 1. Opening Hook (1-2 paragraphs)
A real-world problem this chapter solves. Be specific. Name a scenario, describe the pain, then say what we will build to fix it.

### 2. Concepts (as many sections as needed)
- Explain each concept with clear, original prose. No copy-paste from docs.
- Describe diagrams in text (data flow, component trees, state shape).
- Every concept MUST have a code example immediately after the explanation.

### 3. Step-by-Step Code Walkthrough
- Build a working example that the reader could paste into the playground app at `src/app/`.
- Use Angular 21 standalone components, `inject()`, new control flow syntax (`@if`, `@for`, `@switch`).
- Use signals and signal-based APIs wherever applicable.
- Include file paths as comments at the top of every code block.
- If the chapter covers NgRx, show both Classic Store AND SignalStore implementations where relevant.
- All code must compile. No pseudocode. No `...` shortcuts. No placeholder imports.

### 4. Common Mistakes (3-5 items)
Each mistake must:
- Show the wrong code
- Explain WHY it is wrong (not just "don't do this")
- Show the corrected code

### 5. Key Takeaways (3-5 bullet points)
Concrete, actionable statements. Not vague summaries.

## Quality Gates (self-review before saving)

Before saving the file, verify:
- [ ] Every concept introduced has a code example
- [ ] All APIs match Angular 21 / NgRx 21 (check against research file)
- [ ] No em dashes used anywhere
- [ ] No `*ngIf`, `*ngFor`, `NgModule`, constructor injection, or zone.js assumptions
- [ ] File paths appear as comments in every code block
- [ ] The opening hook describes a real problem, not a generic intro
- [ ] No sentences that could be deleted without losing information
- [ ] Chapter does not assume the reader read previous chapters without a brief recap of needed concepts

## Output

Save to: `public/book/part-N/chapter-NN-slug.md` (create directories if needed).
Target length: 2000-4000 words depending on topic complexity.
