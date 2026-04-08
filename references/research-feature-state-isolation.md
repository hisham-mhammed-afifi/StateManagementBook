## Research: Feature State Isolation (Lazy-Loaded Feature Stores)

**Date:** 2026-04-07
**Chapter:** Ch 24
**Status:** Ready for chapter generation

## API Surface

- `provideStore(rootReducers?, config?)` — `@ngrx/store`. Stable. Used in `app.config.ts` to bootstrap the Classic Store. Pass `{}` if there is no root state.
- `provideState(featureKeyOrFeature, reducer?, config?)` — `@ngrx/store`. Stable. Registers a feature slice; use inside a lazy route's `providers` array. Accepts either `(key, reducer)` or a `createFeature()` result.
- `createFeature({ name, reducer, extraSelectors? })` — `@ngrx/store`. Stable. Bundles key, reducer, and selectors.
- `provideEffects(...effectClasses)` — `@ngrx/effects`. Stable. Place in the lazy route's providers next to `provideState` to scope effects to the feature.
- `provideRouterStore()` — `@ngrx/router-store`. Stable. Root-only.
- `provideStoreDevtools(config)` — `@ngrx/store-devtools`. Stable. Root-only.
- `signalStore({ providedIn: 'root' }, ...features)` — `@ngrx/signals` v21. Stable. Tree-shaken into the lazy chunk if only referenced from a lazy route.
- `signalStore(...features)` (no `providedIn`) — non-root. Stable. Provided via the lazy route's `providers` array or a component's `providers`.
- `Route.providers: Provider[]` — `@angular/router`. Stable. Creates an `EnvironmentInjector` scoped to the route subtree.
- `Route.loadChildren: () => import(...).then(m => m.routes)` — Stable. Standalone routes file pattern.

No experimental APIs in this chapter.

## Key Concepts

- A lazy route's `providers` array creates a child `EnvironmentInjector`. Anything provided there lives only as long as the route subtree is active. This is the modern replacement for `StoreModule.forFeature`.
- Two distinct goals: **bundle isolation** (don't ship the slice's code until needed) and **state isolation** (the slice is added to/removed from the store as the route is entered/left). `provideState` in a lazy route's providers achieves both.
- Classic Store: feature reducers are *added* to the global state tree under their feature key when the lazy route is matched. They are *not* removed by default — once registered, they stay (Classic Store behavior). Discuss this honestly.
- SignalStore: when provided at the route level (not `providedIn: 'root'`), the store instance is created on entry and destroyed on exit. This is true state lifecycle isolation, not just lazy registration.
- `providedIn: 'root'` SignalStores are still tree-shaken into the lazy chunk if they're only imported from lazy code, so you get bundle isolation for free. The trade-off is the store outlives the route — useful for shared/cached state, wrong for ephemeral feature state.
- Feature key collisions: each feature must own a unique top-level key in Classic Store. Naming conventions matter (`'products'`, `'products-cart'`, etc.).
- Effects in lazy features: `provideEffects(ProductsEffects)` in the route providers. Effects run as long as the injector is alive.
- Cross-feature reads: a lazy feature should not import another feature's selectors directly. Either lift shared state to a `shared-data-access` lib or expose a typed contract via a facade. (Forward reference to Ch 25.)
- Nx libs map cleanly to feature isolation: one `feature-X` lib + one `data-access-X` lib per bounded context. Module Federation pushes this further (Ch 33).

## Code Patterns

```ts
// apps/shop/src/app/app.config.ts
import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideStore } from '@ngrx/store';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { provideRouterStore } from '@ngrx/router-store';
import { appRoutes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(appRoutes),
    provideStore({}), // empty root, all state lives in features
    provideRouterStore(),
    provideStoreDevtools({ maxAge: 50 }),
  ],
};
```

```ts
// apps/shop/src/app/app.routes.ts
import { Routes } from '@angular/router';

export const appRoutes: Routes = [
  {
    path: 'products',
    loadChildren: () =>
      import('./products/products.routes').then((m) => m.productsRoutes),
  },
  {
    path: 'cart',
    loadChildren: () =>
      import('./cart/cart.routes').then((m) => m.cartRoutes),
  },
];
```

```ts
// apps/shop/src/app/products/products.feature.ts
import { createFeature, createReducer, on } from '@ngrx/store';
import { productsEvents } from './products.events';

export interface ProductsState {
  ids: string[];
  status: 'idle' | 'loading' | 'success' | 'error';
  error: string | null;
}

const initial: ProductsState = { ids: [], status: 'idle', error: null };

export const productsFeature = createFeature({
  name: 'products',
  reducer: createReducer(
    initial,
    on(productsEvents.loadRequested, (s) => ({ ...s, status: 'loading' })),
    on(productsEvents.loadSucceeded, (s, { ids }) => ({
      ...s,
      ids,
      status: 'success',
    })),
  ),
});
```

```ts
// apps/shop/src/app/products/products.routes.ts
import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { productsFeature } from './products.feature';
import { ProductsEffects } from './products.effects';

export const productsRoutes: Routes = [
  {
    path: '',
    providers: [
      provideState(productsFeature),
      provideEffects(ProductsEffects),
    ],
    loadComponent: () =>
      import('./products-page.component').then((m) => m.ProductsPageComponent),
  },
];
```

```ts
// apps/shop/src/app/cart/cart.store.ts — SignalStore variant, route-scoped
import { signalStore, withState, withMethods, patchState } from '@ngrx/signals';

type CartState = { lines: { sku: string; qty: number }[] };

export const CartStore = signalStore(
  // no providedIn — instance lives only inside the cart route subtree
  withState<CartState>({ lines: [] }),
  withMethods((store) => ({
    add(sku: string) {
      patchState(store, (s) => ({ lines: [...s.lines, { sku, qty: 1 }] }));
    },
    clear() {
      patchState(store, { lines: [] });
    },
  })),
);
```

```ts
// apps/shop/src/app/cart/cart.routes.ts
import { Routes } from '@angular/router';
import { CartStore } from './cart.store';

export const cartRoutes: Routes = [
  {
    path: '',
    providers: [CartStore],
    loadComponent: () =>
      import('./cart-page.component').then((m) => m.CartPageComponent),
  },
];
```

```ts
// apps/shop/src/app/cart/cart-page.component.ts
import { Component, inject } from '@angular/core';
import { CartStore } from './cart.store';

@Component({
  selector: 'app-cart-page',
  template: `
    @for (line of cart.lines(); track line.sku) {
      <div>{{ line.sku }} x {{ line.qty }}</div>
    }
  `,
})
export class CartPageComponent {
  protected readonly cart = inject(CartStore);
}
```

## Breaking Changes and Gotchas

- `StoreModule.forFeature` and `EffectsModule.forFeature` are legacy. Standalone APIs (`provideState`, `provideEffects`) are the only path going forward in Angular 21 / NgRx 21 codebases.
- Classic Store does **not** unregister feature reducers when a route is destroyed. State accumulates in the global tree. SignalStores provided at the route level **do** get destroyed.
- Putting `provideStore({})` inside a lazy route's `providers` instead of the root will create a *second* store. Always provide the root store at the application root.
- `providedIn: 'root'` SignalStores are still bundle-isolated when only imported from lazy code, but are not lifecycle-isolated. Pick `providedIn: 'root'` only when the state must survive route changes.
- Feature key collisions are silent: two features with the same `name` overwrite each other. Use unique keys, ideally namespaced per bounded context.
- Selectors in a lazy feature reference state slices that may not exist yet if the selector runs before the route is visited. Defensive selectors should default to `undefined` rather than crash. Better: don't read a feature's selectors from outside that feature.
- Devtools (`provideStoreDevtools`) belongs at the root only. Adding it to a lazy route's providers is a no-op or worse.

## Sources

- [NgRx Standalone APIs guide (this-is-angular essentials)](https://this-is-angular.github.io/ngrx-essentials-course/docs/chapter-12/)
- [Tim Deschryver — Sharing NgRx state between modules](https://timdeschryver.dev/blog/sharing-data-between-modules-is-peanuts)
- [Using NgRx Standalone APIs with Nx](https://nx.dev/blog/using-ngrx-standalone-apis-with-nx)
- [Angular Architects — The NgRx Signal Store and Your Architecture](https://www.angulararchitects.io/blog/the-ngrx-signal-store-and-your-architecture/)
- [Angular Architects — Routing and Lazy Loading with Standalone Components](https://www.angulararchitects.io/en/blog/routing-and-lazy-loading-with-standalone-components/)
- [Angular docs — Route Loading Strategies](https://angular.dev/guide/routing/loading-strategies)
- [NgRx SignalStore docs](https://ngrx.io/guide/signals/signal-store)
- [Discussion: providing SignalStore in EnvironmentInjector](https://github.com/ngrx/platform/discussions/4342)

## Open Questions

- Confirm whether NgRx v21 added any opt-in for *removing* a feature reducer from the Classic Store on injector destroy. Last known answer: no — this is by design. Verify against the v21 changelog before writing.
