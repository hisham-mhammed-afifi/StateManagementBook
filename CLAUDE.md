# State Management in Angular: The Definitive Guide

## Project Purpose

This is a comprehensive technical book about state management in Angular.
Target audience: intermediate to advanced Angular developers.
The book covers fundamentals through expert-level architecture patterns.

## Tech Stack Context

- Angular 21 (latest stable, released Nov 2025)
- NgRx 21 (latest stable, aligned with Angular 21)
- TypeScript 5.9
- Nx monorepo tooling
- Module Federation for micro-frontends
- @module-federation/enhanced/runtime for dynamic remotes

## Writing Guidelines

### Voice and Tone

- Authoritative but approachable. Like a senior architect mentoring a mid-level dev.
- Use "we" not "you" when walking through code. Use "you" for advice/rules.
- No fluff. Every paragraph must teach something concrete.
- Never use em dashes.

### Code Examples

- Every concept MUST have a working code example.
- Use Angular 21 standalone components (no NgModules unless discussing legacy).
- Use the new control flow syntax (@if, @for, @switch) not *ngIf/*ngFor.
- Use `inject()` function, not constructor injection.
- Use signals and signal-based APIs wherever applicable.
- NgRx examples must use both Classic Store AND SignalStore where relevant.
- All code must compile. No pseudocode. No shortcuts.
- Include file paths as comments at the top of every code block.

### Structure Per Chapter

1. Opening hook: a real-world problem this chapter solves
2. Concepts explained with diagrams described in text
3. Step-by-step code walkthrough
4. Common mistakes and how to fix them
5. Key takeaways (3-5 bullet points)

### What to Avoid

- No outdated patterns (NgModules-first, constructor injection, zone.js assumptions)
- No generic filler ("State management is important because...")
- No copy-paste from docs. Original explanations with original examples.
- Never assume the reader has read previous chapters without a brief recap.

## Research Requirements

Before writing ANY chapter, you MUST:

1. Search the web for the latest syntax and APIs for the topic
2. Verify against official docs (angular.dev, ngrx.io)
3. Check for breaking changes in Angular 21 / NgRx 21
4. Note any experimental APIs and label them clearly

## Book Outline Reference

See outline/BOOK_OUTLINE.md for the full structure.

## File Naming Convention

chapters/part-N/chapter-NN-slug.md
Example: chapters/part-2/chapter-05-ngrx-classic-store.md
