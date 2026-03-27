# Book Outline: State Management in Angular - The Definitive Guide

## Part 1: Foundations of State

- Ch 1: What Is State? (UI state, server state, URL state, form state)
- Ch 2: The Mental Model (unidirectional data flow, immutability, single source of truth)
- Ch 3: State Without Libraries (services + BehaviorSubject, signals, computed, effect)
- Ch 4: When You Need a Library and When You Don't (decision framework)

## Part 2: Angular Signals Deep Dive

- Ch 5: Signals from First Principles (signal, computed, effect, linkedSignal)
- Ch 6: Signal-Based Components (input signals, model signals, output)
- Ch 7: Resource API and httpResource (async state the Angular way)
- Ch 8: Signal Forms (experimental in v21, reactive forms reimagined)

## Part 3: NgRx Classic Store Mastery

- Ch 9: Actions, Reducers, Store (the Redux pattern in Angular)
- Ch 10: Selectors and Memoization (the read layer)
- Ch 11: Effects (side effects, API calls, navigation)
- Ch 12: Entity Management (@ngrx/entity)
- Ch 13: Router Store (@ngrx/router-store)
- Ch 14: Testing the Classic Store (reducers, selectors, effects, integration)
- Ch 15: Meta-Reducers (logging, hydration, undo/redo, devtools)

## Part 4: NgRx SignalStore

- Ch 16: SignalStore Fundamentals (withState, withComputed, withMethods, patchState)
- Ch 17: Entity Management in SignalStore (withEntities)
- Ch 18: Lifecycle and Hooks (withHooks, withProps)
- Ch 19: Custom Store Features (signalStoreFeature, composition)
- Ch 20: withFeature and withLinkedState (v20+ advanced composition)
- Ch 21: The Events Plugin (eventGroup, withReducer, withEffects, injectDispatch)
- Ch 22: Scoped Events and Local vs Global Stores
- Ch 23: rxMethod and RxJS Interop in SignalStore
- Ch 24: Testing SignalStore
- Ch 25: Migrating from Classic Store to SignalStore

## Part 5: State Architecture at Scale

- Ch 26: State Design Principles (normalization, derived state, status patterns)
- Ch 27: Feature State Isolation (lazy-loaded feature stores)
- Ch 28: Shared State vs Feature State (boundaries and contracts)
- Ch 29: Facade Pattern (when it helps, when it hurts)
- Ch 30: Optimistic and Pessimistic Updates
- Ch 31: Real-Time State (WebSockets, SSE, polling)
- Ch 32: Caching Strategies (stale-while-revalidate, TTL, invalidation)
- Ch 33: Performance (selector memoization, signal equality, OnPush, change detection)

## Part 6: Nx Monorepo and Micro-Frontends

- Ch 34: Nx Workspace Architecture for State (libs, shared state libs, feature libs)
- Ch 35: State in Module Federation (host/remote state boundaries)
- Ch 36: Dynamic Remotes with @module-federation/enhanced/runtime
- Ch 37: Shared State Across Micro-Frontends (patterns and anti-patterns)
- Ch 38: Cross-MFE Communication (custom events, shared stores, message bus)
- Ch 39: Testing State in a Monorepo (affected, caching, CI strategies)

## Part 7: The Playbook

- Ch 40: Decision Framework (flowchart: which state tool for which problem)
- Ch 41: Golden Rules (the 15 commandments of state management)
- Ch 42: Code Review Checklist for State
- Ch 43: Migration Playbook (AngularJS to modern, RxJS-heavy to signals, classic to signal store)
