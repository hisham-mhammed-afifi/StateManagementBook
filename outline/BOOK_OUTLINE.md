# Book Outline: State Management in Angular -- The Definitive Guide

> 39 chapters across 7 parts. Consolidated from the original 43-chapter outline
> based on the technical review (see docs/BOOK_REVIEW.md).

---

## Part 1: Foundations of State (3 chapters)

- Ch 1: What Is State? (UI state, server state, URL state, form state)
- Ch 2: The Mental Model (unidirectional data flow, immutability, single source of truth)
- Ch 3: State Without Libraries: Services and RxJS (services + BehaviorSubject/ReplaySubject, async pipe, shareReplay; signals get a brief teaser only, full coverage in Part 2)

> Original Ch 4 ("When You Need a Library") merged into Ch 38 (Decision Framework).

---

## Part 2: Angular Signals Deep Dive (4 chapters)

- Ch 4: Signals from First Principles (signal, computed, effect, linkedSignal)
- Ch 5: Signal-Based Components (input signals, model signals, output, viewChild)
- Ch 6: Resource API and httpResource (async state the Angular way) **[Experimental API]**
- Ch 7: Signal-Based Forms (experimental in v21, forms reimagined with signals as source of truth) **[Experimental API]**

---

## Part 3: NgRx Classic Store Mastery (7 chapters)

- Ch 8: Actions, Reducers, and the Store (the Redux pattern in Angular; includes DevTools setup with @ngrx/store-devtools)
- Ch 9: Selectors and Memoization (the read layer)
- Ch 10: Effects: Managing Side Effects (API calls, navigation; includes RxJS operator guide: switchMap vs concatMap vs exhaustMap vs mergeMap)
- Ch 11: Entity Management with @ngrx/entity
- Ch 12: Router Store (URL as state, query params as source of truth, @ngrx/router-store)
- Ch 13: Testing the Classic Store (reducers, selectors, effects, integration tests)
- Ch 14: Meta-Reducers (logging, hydration, undo/redo)

---

## Part 4: NgRx SignalStore (8 chapters)

- Ch 15: SignalStore Fundamentals (withState, withComputed, withMethods, patchState; includes DevTools integration)
- Ch 16: Entity Management in SignalStore (withEntities)
- Ch 17: Lifecycle, Hooks, and Props (withHooks, withProps)
- Ch 18: Custom Store Features and Advanced Composition (signalStoreFeature, withFeature, withLinkedState, type-safe feature constraints)
- Ch 19: The Events Plugin: Event-Driven SignalStore (eventGroup, withReducer, on, withEventHandlers, scoped events, local vs global stores)
- Ch 20: rxMethod and RxJS Interop in SignalStore
- Ch 21: Testing SignalStore
- Ch 22: Migration Paths: Classic Store and ComponentStore to SignalStore (includes @ngrx/component-store migration patterns)

> Original Ch 19+20 merged into new Ch 18. Original Ch 21+22 merged into new Ch 19.
> withEffects renamed to withEventHandlers in NgRx v21.

---

## Part 5: State Architecture at Scale (9 chapters)

- Ch 23: State Design Principles (normalization, derived state, status patterns, error state patterns)
- Ch 24: Feature State Isolation (lazy-loaded feature stores)
- Ch 25: Shared State vs Feature State (boundaries and contracts)
- Ch 26: The Facade Pattern: When It Helps, When It Hurts (must present both sides; note that SignalStore's withMethods already acts as a facade)
- Ch 27: Optimistic and Pessimistic Updates
- Ch 28: Real-Time State (WebSockets, SSE, polling)
- Ch 29: Caching Strategies (stale-while-revalidate, TTL, invalidation)
- Ch 30: SSR, Hydration, and State Transfer (TransferState, httpResource in SSR, serialization constraints, SignalStore hydration) **[NEW]**
- Ch 31: Performance and Zoneless Change Detection (signal equality, selector memoization, entity adapter performance, zoneless Angular impact on state propagation) **[EXPANDED]**

> New Ch 30 added for SSR coverage. Ch 31 expanded to cover zoneless Angular.

---

## Part 6: Nx Monorepo and Micro-Frontends (6 chapters)

- Ch 32: Nx Workspace Architecture for State (libs, shared state libs, feature libs)
- Ch 33: State in Module Federation (host/remote state boundaries)
- Ch 34: Dynamic Remotes with @module-federation/enhanced/runtime
- Ch 35: Shared State Across Micro-Frontends (patterns and anti-patterns)
- Ch 36: Cross-MFE Communication (custom events, shared stores, message bus)
- Ch 37: Testing State in a Monorepo (affected, caching, CI strategies)

---

## Part 7: The Playbook (2 chapters)

- Ch 38: Decision Framework and Golden Rules (flowchart: which state tool for which problem, the commandments of state management, code review checklist, alternative libraries comparison: TanStack Query, NGXS, Elf, plain services + signals)
- Ch 39: Migration Playbook (AngularJS to modern, RxJS-heavy to signals, classic to signal store)

> Original Ch 40+41+42 merged into Ch 38. Original Ch 4 content absorbed here.
