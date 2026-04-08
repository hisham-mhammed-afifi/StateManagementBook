---
chapter: 25
title: Shared State vs Feature State (boundaries and contracts)
date: 2026-04-07
status: Ready for chapter generation
---

# Research: Shared State vs Feature State

**Date:** 2026-04-07
**Chapter:** Ch 25
**Status:** Ready for chapter generation

## Scope

Chapter 25 follows Ch 24 (Feature State Isolation). Where Ch 24 covers *how* to isolate a lazy-loaded feature store, Ch 25 answers the harder design question: which slices belong in a **shared** layer versus a **feature** layer, and how do features collaborate without coupling? The chapter must define:

1. What makes a piece of state genuinely "shared" (vs accidentally shared).
2. Where shared state physically lives (root provider, shared lib, app shell).
3. The contracts features use to read/write shared state without importing each other.
4. How to enforce those contracts at build time (Nx tags, barrels, type-level input contracts in `signalStoreFeature`).
5. Anti-patterns: god stores, cross-feature selector imports, hidden coupling via shared actions.

## API Surface

All APIs are stable in Angular 21 / NgRx 21 unless noted.

### NgRx Classic Store
- `provideStore()` — root store, hosts shared feature reducers. `@ngrx/store`.
- `provideState(featureKey, reducer)` — registers a lazy feature slice. Used inside a route's `providers`.
- `createFeature({ name, reducer })` — colocates reducer + auto-generated selectors. Stable.
- `createSelector` — used to compose **read-only contracts** across feature slices.
- Action creators (`createAction`, `createActionGroup`) — the *event* contract between features and the shared store.

### NgRx SignalStore (`@ngrx/signals` v21.1.0)
- `signalStore({ providedIn: 'root' }, ...)` — the standard way to expose a shared store app-wide.
- `signalStoreFeature(typeContract, ...)` — declares an **input contract**: required state slices, props, or methods that the host store must already provide. This is the type-level mechanism for "this feature needs an `auth` slice on the parent store."
- `type<{ state: {...}, props: {...}, methods: {...} }>()` — helper used as the first argument to `signalStoreFeature` to declare the contract.
- `withFeature()` — composes a feature into a store, satisfying its input contract at compile time.
- `withLinkedState()` — derive state in a child store from a parent store's signals (Ch 18 covered the mechanic; Ch 25 references it as the cross-store read pattern).
- `getState(store)` — escape hatch for snapshots; do not use across feature boundaries.

### Nx tooling
- `@nx/enforce-module-boundaries` ESLint rule — enforces tag-based dependency rules. Configured in the root `eslint.config.js` (flat config) under `depConstraints`.
- Project tags in `project.json`: conventional dimensions are `scope:*` (vertical/domain) and `type:*` (layer: `feature`, `data-access`, `ui`, `util`, `shell`).

## Key Concepts

- **The "shared" test.** State is shared only if (a) more than one feature *reads* it AND (b) the features are independently deployable or owned by different teams. State that one feature reads from another but the second team doesn't know about is not shared — it is leaked.
- **Three legitimate kinds of shared state.** Identity/auth (current user, permissions), cross-cutting reference data (feature flags, tenant config, currency rates), and global UI state (theme, locale, layout chrome). Everything else is suspect.
- **Read contracts vs write contracts.** A feature reading shared state is cheap and explicit (a selector, a `Signal<T>`, a facade method). A feature *writing* to shared state needs justification — usually it should dispatch an event the shared owner reacts to, not patch directly.
- **Physical placement.** Shared state lives in a `shared/data-access-*` library (Nx) or in a root-provided `signalStore({ providedIn: 'root' })`. Feature state lives in `<feature>/data-access` and is provided at the route level via `provideState` or by providing the SignalStore class on the route.
- **Contract enforcement layers.** TypeScript (input contracts via `signalStoreFeature` + `type<...>()`), build-time (Nx tags), runtime (do not export selectors that reach into other features' internal state), review-time (PR checklist).
- **Direction of dependency.** Features depend on shared. Shared *never* depends on features. If shared needs to react to a feature, invert it: shared exposes an event/method, the feature subscribes.
- **Action namespacing as a contract.** With `createActionGroup({ source: 'Auth API' })` the source string becomes the public contract. Other features may listen to `'[Auth API] Login Success'` but must never dispatch it.
- **Facades are the boundary, not a layer.** With SignalStore, `withMethods` already *is* the facade. Don't wrap a SignalStore in a service just to call it a facade — expose the store itself as the contract surface.

## Code Patterns

### 1. A shared SignalStore providing identity to the whole app

```ts
// libs/shared/data-access-auth/src/lib/auth.store.ts
import { computed, inject } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { AuthApi } from './auth.api';

type AuthState = {
  user: { id: string; email: string; roles: string[] } | null;
  status: 'idle' | 'loading' | 'authenticated' | 'error';
};

const initial: AuthState = { user: null, status: 'idle' };

export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState(initial),
  withComputed(({ user }) => ({
    isAuthenticated: computed(() => user() !== null),
    roles: computed(() => user()?.roles ?? []),
  })),
  withMethods((store, api = inject(AuthApi)) => ({
    async signIn(email: string, password: string) {
      patchState(store, { status: 'loading' });
      try {
        const user = await api.signIn(email, password);
        patchState(store, { user, status: 'authenticated' });
      } catch {
        patchState(store, { status: 'error' });
      }
    },
    signOut() {
      patchState(store, initial);
    },
  })),
);
```

This is the only place `user` is owned. Feature stores read it; they never duplicate it.

### 2. A feature store consuming shared state via injection (read contract)

```ts
// libs/orders/data-access/src/lib/orders.store.ts
import { computed, inject } from '@angular/core';
import { signalStore, withState, withComputed, withMethods } from '@ngrx/signals';
import { AuthStore } from '@acme/shared/data-access-auth';

type OrdersState = { ids: string[]; loading: boolean };

export const OrdersStore = signalStore(
  withState<OrdersState>({ ids: [], loading: false }),
  withComputed(() => {
    const auth = inject(AuthStore);
    return {
      // Derived from shared state. The orders feature does not own `user`.
      canPlaceOrder: computed(() => auth.isAuthenticated() && auth.roles().includes('buyer')),
    };
  }),
  withMethods(() => {
    const auth = inject(AuthStore);
    return {
      async load() {
        if (!auth.isAuthenticated()) return;
        // ...
      },
    };
  }),
);
```

The dependency direction is one-way: `orders` imports `auth`. `auth` knows nothing about `orders`.

### 3. Type-level input contract with `signalStoreFeature`

When a reusable feature *requires* its host store to provide certain state, declare it:

```ts
// libs/shared/util-state/src/lib/with-tenant-aware.feature.ts
import { computed } from '@angular/core';
import { signalStoreFeature, type, withComputed } from '@ngrx/signals';

type TenantInput = {
  state: { tenantId: string };
};

export function withTenantAware() {
  return signalStoreFeature(
    type<TenantInput>(),
    withComputed(({ tenantId }) => ({
      tenantHeader: computed(() => ({ 'X-Tenant': tenantId() })),
    })),
  );
}
```

Now any store that uses `withTenantAware()` *must* already provide a `tenantId` slice. The compiler enforces the contract — no runtime check, no comment, no convention.

### 4. NgRx Classic shared feature with public selector contract

```ts
// libs/shared/data-access-config/src/lib/config.feature.ts
import { createFeature, createReducer, on } from '@ngrx/store';
import { ConfigApiActions } from './config.actions';

export const configFeature = createFeature({
  name: 'config',
  reducer: createReducer(
    { flags: {} as Record<string, boolean>, loaded: false },
    on(ConfigApiActions.loaded, (s, { flags }) => ({ flags, loaded: true })),
  ),
});

// PUBLIC contract — re-exported from the lib's index.ts
export const { selectFlags, selectLoaded } = configFeature;
export const selectFlag = (key: string) =>
  createSelector(selectFlags, (flags) => !!flags[key]);
```

Feature libs import `selectFlag('checkout.v2')`. They never import the reducer, the action group, or the internal state shape.

### 5. Nx module boundaries enforcing the rule

```js
// eslint.config.js (excerpt)
module.exports = [
  {
    files: ['**/*.ts'],
    rules: {
      '@nx/enforce-module-boundaries': ['error', {
        depConstraints: [
          // Shared can only depend on shared.
          { sourceTag: 'scope:shared', onlyDependOnLibsWithTags: ['scope:shared'] },
          // Features can depend on their own scope and on shared.
          { sourceTag: 'scope:orders', onlyDependOnLibsWithTags: ['scope:orders', 'scope:shared'] },
          { sourceTag: 'scope:catalog', onlyDependOnLibsWithTags: ['scope:catalog', 'scope:shared'] },
          // Layer rules: feature -> data-access -> util.
          { sourceTag: 'type:feature',     onlyDependOnLibsWithTags: ['type:feature', 'type:data-access', 'type:ui', 'type:util'] },
          { sourceTag: 'type:data-access', onlyDependOnLibsWithTags: ['type:data-access', 'type:util'] },
          { sourceTag: 'type:util',        onlyDependOnLibsWithTags: ['type:util'] },
        ],
      }],
    },
  },
];
```

Now an `orders` developer cannot accidentally `import { CatalogStore } from '@acme/catalog/data-access'`. The lint fails in CI before the PR is reviewed.

### 6. Anti-pattern: cross-feature selector composition

```ts
// libs/orders/data-access/src/lib/orders.selectors.ts -- DO NOT DO THIS
import { selectCatalogProducts } from '@acme/catalog/data-access'; // ❌ violates boundary

export const selectOrdersWithProductNames = createSelector(
  selectOrdersEntities,
  selectCatalogProducts,
  (orders, products) => /* ... */,
);
```

The fix: lift the join into a *view model* at the page/route level (the page composes both feature stores), or move the shared product reference data into `shared/data-access-catalog-ref` if it is genuinely cross-cutting.

## Breaking Changes and Gotchas

- No API renames specific to this chapter in NgRx 21. `withEffects` → `withEventHandlers` is mentioned in Ch 19 and is unrelated here.
- **`providedIn: 'root'` SignalStores survive route changes.** That is the point for shared state — but it also means a misplaced feature store with `providedIn: 'root'` becomes accidentally shared. Default feature stores should be provided on the route, not in root.
- **`inject()` inside `withComputed`/`withMethods` factories runs in the store's injection context.** Shared stores injected this way are resolved against the *root* injector regardless of where the consuming store is provided, which is what makes pattern #2 work. New readers often expect feature-scoped resolution and are surprised.
- **`getState()` is a snapshot.** Tempting for cross-feature reads in effects/event handlers. Prefer reading the shared store's signals directly so reactivity is preserved.
- **Nx flat-config migration.** Projects still on `.eslintrc.json` use the same `@nx/enforce-module-boundaries` rule but a slightly different shape. Mention both in passing; do not write two full examples.
- **Barrel exports are part of the contract.** If `libs/shared/data-access-auth/src/index.ts` only re-exports `AuthStore`, then internal selectors and the reducer literally cannot be imported by features even without the lint rule. Treat the barrel as the API surface.

## Common Mistakes (for the chapter's "Common mistakes" section)

1. **The "shared" lib that grew a UI.** A `shared/data-access-orders` lib that everyone imports because two features happened to need order data once. Cure: move it back into `orders`, expose a read-only view via a public selector, and require justification for any new shared lib.
2. **Dispatching another feature's actions.** Catalog dispatches `OrdersActions.addItem`. Cure: catalog emits `CatalogEvents.itemSelected`; orders' effect/event handler reacts. The action contract belongs to its owner.
3. **God SignalStore in root.** One `AppStore` with everything. Cure: split by ownership; root-provide only the genuinely shared slices.
4. **Hidden coupling via `getState()`.** A feature snapshots another feature's store inside an effect, then quietly depends on its shape. Cure: forbid cross-feature `getState`; expose explicit signals.
5. **Selectors as the wrong contract.** Exposing every `createFeature`-generated selector in the barrel, including ones that leak internal shape. Cure: hand-curate the barrel; treat selectors as the public API and review them in PRs.

## Sources

- [NgRx SignalStore — Custom Store Features](https://ngrx.io/guide/signals/signal-store/custom-store-features)
- [NgRx SignalStore guide](https://ngrx.io/guide/signals/signal-store)
- [Nx — Enforce Module Boundaries (feature)](https://nx.dev/docs/features/enforce-module-boundaries)
- [Nx — Enforce Module Boundaries ESLint rule](https://nx.dev/docs/technologies/eslint/eslint-plugin/guides/enforce-module-boundaries)
- [Nx Blog — Mastering project boundaries in Nx](https://nx.dev/blog/mastering-the-project-boundaries-in-nx)
- [Tim Deschryver — Sharing NgRx state between Angular modules is peanuts](https://timdeschryver.dev/blog/sharing-data-between-modules-is-peanuts)
- [Angular Architects — The NgRx Signal Store and Your Architecture](https://www.angulararchitects.io/blog/the-ngrx-signal-store-and-your-architecture/)
- [Nx Blog — Angular State Management for 2025](https://nx.dev/blog/angular-state-management-2025)
- [Stefanos Lignos — Three Ways to Enforce Module Boundaries in Nx](https://www.stefanos-lignos.dev/posts/nx-module-boundaries)
- [NgRx RFC #4340 — signalStoreFeature and access to Store](https://github.com/ngrx/platform/issues/4340)

## Open Questions

- Confirm against the installed `@ngrx/signals@21.1.0` that the `type<{ state, props, methods }>()` shape is unchanged from v20. The RFC discussions suggest minor ergonomic tweaks — verify before writing the chapter so example #3 compiles verbatim.
- Decide whether to show the Nx flat config (`eslint.config.js`) only, or include a short `.eslintrc.json` variant. Recommend flat-only since Angular 21 / Nx 21 default to flat.
- Cross-check with the existing `references/research-feature-state-isolation.md` (Ch 24) so the two chapters do not duplicate the lazy-loading mechanics — Ch 25 should *reference* Ch 24 and stay focused on the design question.
