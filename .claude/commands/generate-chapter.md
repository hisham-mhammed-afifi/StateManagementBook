# Generate Chapter

Write a book chapter based on the outline entry: $ARGUMENTS

## Steps

1. Read CLAUDE.md for all writing guidelines and constraints
2. Read outline/BOOK_OUTLINE.md to understand where this chapter fits
3. Check references/ for any pre-researched material on this topic
4. If no research exists yet, search the web for the latest syntax and APIs
5. Read the previous chapter file (if it exists) for continuity
6. Write the full chapter following the structure in CLAUDE.md:
   - Opening hook (real-world problem)
   - Concepts with clear explanations
   - Complete, compilable code examples with file paths
   - Common mistakes section
   - Key takeaways
7. The chapter should be 2000-4000 words depending on topic complexity
8. Save to the correct path: chapters/part-N/chapter-NN-slug.md
9. After writing, do a self-review:
   - Does every concept have a code example?
   - Are all APIs current for Angular 21 / NgRx 21?
   - Is there any filler that can be cut?
   - Would a mid-level Angular dev understand this without external context?
