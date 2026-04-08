# Chapter 25: Shared State vs Feature State

The shop application from the last chapter now has four lazy-loaded features and a problem nobody noticed until the second team joined the project. The `orders` feature needs to know who the current user is, so its developer imported `selectCurrentUser` from `cart/state` because that was the only place it existed. A week later the cart team renamed their state shape and the orders page started rendering "undefined" in the header. Two sprints after that, the catalog team added a "favorites" badge that reaches into the orders store to count pending shipments, and now removing an order from the orders feature breaks a button in catalog. Nothing is technically broken. Every import resolves. Every test passes in isolation. But the features are quietly stitched together by a hundred small references, and any change in one tears the others.

This chapter is about the boundary you draw between **shared** state and **feature** state, and the contracts you use so features can collaborate without importing each other. We will define what makes state genuinely shared, where it should physically live, how to enforce the boundary at compile time with input contracts and Nx tags, and what to do when a feature needs to react to something that belongs to another feature.

## A Brief Recap

Chapter 24 drew lines around features so each one owns its bundle and its state lifecycle, using route-scoped `providers` to lazy-load NgRx feature slices and per-route SignalStores. That gave us isolation: the cart cannot accidentally see the orders state because the orders store does not exist until the user enters `/orders`. This chapter answers the question Chapter 24 left open: what about the things that *every* feature legitimately needs, like the current user or the active tenant? Those cannot live in any one feature, but if we drop them into a global bag we are back to the spaghetti we started with. The answer is a small, deliberate **shared** layer with a contract, and a discipline about which slices belong there.

## The "Shared" Test

State qualifies as shared only if two conditions hold at the same time:

1. More than one feature **reads** it.
2. The features are independently owned, deployed, or developed.

Both conditions matter. State that one feature reads from another but the second team did not plan for is not shared, it is leaked. Move it back. State that two features happen to display today but that conceptually belongs to one of them should stay where it belongs and the other feature should ask for it through a public method or selector.

In practice, three categories of state pass the test in almost every application:

- **Identity and authorization.** The current user, their roles, the active session. Every feature needs to ask "may this person do X?" and there is exactly one answer.
- **Cross-cutting reference data.** Feature flags, tenant configuration, locale, currency rates, the server clock. Slow-moving values that are read everywhere and written almost nowhere.
- **Global UI chrome.** The theme, the layout mode, the locale picker, the global toast queue.

If a slice does not fall into one of those buckets, default to feature-owned. Promoting state to the shared layer is a one-way door. Once five features import it, you cannot take it back without coordinating five teams.

## Where Shared State Lives

Shared state belongs in a dedicated library that no feature library imports transitively. In an Nx workspace this is conventionally `libs/shared/data-access-<thing>/` with a single barrel that exports only the public surface. Inside that library, the store is provided at the root injector so it is a singleton for the entire app.

```typescript
// libs/shared/data-access-auth/src/lib/auth.store.ts
import { computed, inject } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';
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

```typescript
// libs/shared/data-access-auth/src/index.ts
export { AuthStore } from './lib/auth.store';
```

The barrel is the contract. Notice what is *not* exported: the `AuthState` type, the `initial` constant, the `AuthApi` class. Features cannot reach past the barrel even if they want to, because the lint rule we will configure in a moment forbids deep imports. The shared library exposes one thing: a store with a clearly named, narrow surface.

## Reading Shared State From a Feature

A feature store consumes shared state by injecting it. Because `AuthStore` is `providedIn: 'root'`, every feature in the app gets the same instance, regardless of where the feature is provided in the route tree.

```typescript
// libs/orders/data-access/src/lib/orders.store.ts
import { computed, inject } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';
import { AuthStore } from '@acme/shared/data-access-auth';
import { OrdersApi } from './orders.api';

type OrdersState = {
  ids: string[];
  loading: boolean;
};

export const OrdersStore = signalStore(
  withState<OrdersState>({ ids: [], loading: false }),
  withComputed(() => {
    const auth = inject(AuthStore);
    return {
      canPlaceOrder: computed(
        () => auth.isAuthenticated() && auth.roles().includes('buyer'),
      ),
    };
  }),
  withMethods((store, api = inject(OrdersApi), auth = inject(AuthStore)) => ({
    async load() {
      if (!auth.isAuthenticated()) {
        return;
      }
      patchState(store, { loading: true });
      const ids = await api.listForUser(auth.user()!.id);
      patchState(store, { ids, loading: false });
    },
  })),
);
```

The dependency direction is one way: `orders` knows about `auth`, but `auth` knows nothing about `orders`. If you ever feel the urge to make the shared store import a feature, stop. The direction is not negotiable. When shared state needs to react to something that happens in a feature, the feature calls a method on the shared store, or emits an event the shared store handles. Shared never reaches downward.

## Read Contracts vs Write Contracts

There is an asymmetry between reading and writing shared state that beginners miss. Reading is cheap: the consumer pulls a signal, the framework wires up reactivity, and there is no ambiguity about who owns the value. Writing is dangerous: every feature that calls `authStore.signOut()` becomes a participant in the auth lifecycle, and the auth team's ability to refactor shrinks.

The rule is: **read freely through public signals and computed properties; write only through methods the shared store explicitly exposes for that purpose.** If a feature needs to mutate shared state, it should call a named method like `signOut()` or `setTheme('dark')`, never reach in with `patchState`. The list of methods is the write contract. It can be reviewed, tested, and deprecated. Direct state pokes cannot.

## Type-Level Input Contracts

Sometimes you want the inverse: a piece of *behavior* that any store can opt into, as long as the host store already has the right shape. NgRx SignalStore expresses this with `signalStoreFeature` and the `type<>()` helper. The feature declares an input contract, and the compiler enforces that any store using it provides the required slice.

```typescript
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

A store that uses `withTenantAware()` must already declare a `tenantId: string` slice in its state. If it does not, the call fails to typecheck. This is the strongest form of contract available: not a comment, not a convention, not a runtime check, but a compiler error.

```typescript
// libs/orders/data-access/src/lib/orders-tenant.store.ts
import { signalStore, withState } from '@ngrx/signals';
import { withTenantAware } from '@acme/shared/util-state';

export const OrdersTenantStore = signalStore(
  withState({ tenantId: 'acme', orders: [] as string[] }),
  withTenantAware(),
);
```

Remove `tenantId` from the initial state and the build breaks before the test runner ever starts.

## The Classic Store Version

Classic Store expresses the same boundary with `createFeature` and a curated barrel. The shared library owns the feature key, the reducer, and the public selectors. Features import only the selectors.

```typescript
// libs/shared/data-access-config/src/lib/config.actions.ts
import { createActionGroup, emptyProps, props } from '@ngrx/store';

export const ConfigApiActions = createActionGroup({
  source: 'Config API',
  events: {
    'Load Requested': emptyProps(),
    'Loaded': props<{ flags: Record<string, boolean> }>(),
  },
});
```

```typescript
// libs/shared/data-access-config/src/lib/config.feature.ts
import { createFeature, createReducer, createSelector, on } from '@ngrx/store';
import { ConfigApiActions } from './config.actions';

type ConfigState = {
  flags: Record<string, boolean>;
  loaded: boolean;
};

const initial: ConfigState = { flags: {}, loaded: false };

export const configFeature = createFeature({
  name: 'config',
  reducer: createReducer(
    initial,
    on(ConfigApiActions.loaded, (state, { flags }) => ({
      flags,
      loaded: true,
    })),
  ),
});

const { selectFlags, selectLoaded } = configFeature;

export { selectFlags, selectLoaded };

export const selectFlag = (key: string) =>
  createSelector(selectFlags, (flags) => !!flags[key]);
```

```typescript
// libs/shared/data-access-config/src/index.ts
export { ConfigApiActions } from './lib/config.actions';
export { selectFlags, selectLoaded, selectFlag } from './lib/config.feature';
```

The barrel exports the action group (so features can dispatch the public events), three selectors, and nothing else. The reducer, the state type, and the initial value are private. A feature that wants to know whether the `checkout.v2` flag is on writes `store.select(selectFlag('checkout.v2'))` and never sees the shape of `ConfigState`. The feature key `'config'` is also private in the sense that no other code should ever type the literal string `'config'` to reach into this slice.

The shared feature is registered once at the root, not on a route, because it is genuinely global.

```typescript
// src/app/app.config.ts
import { ApplicationConfig } from '@angular/core';
import { provideStore, provideState } from '@ngrx/store';
import { provideRouter } from '@angular/router';
import { configFeature } from '@acme/shared/data-access-config';
import { appRoutes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(appRoutes),
    provideStore(),
    provideState(configFeature),
  ],
};
```

## Enforcing the Boundary at Build Time

Discipline is good. A lint rule that fails CI is better. Nx ships a tag-based dependency check that turns architectural intent into a build-time guarantee. Every library declares one or more tags in its `project.json`, and the workspace ESLint config defines which tags are allowed to depend on which.

```json
// libs/shared/data-access-auth/project.json (excerpt)
{
  "name": "shared-data-access-auth",
  "tags": ["scope:shared", "type:data-access"]
}
```

```json
// libs/orders/data-access/project.json (excerpt)
{
  "name": "orders-data-access",
  "tags": ["scope:orders", "type:data-access"]
}
```

```javascript
// eslint.config.js (excerpt)
const nx = require('@nx/eslint-plugin');

module.exports = [
  ...nx.configs['flat/base'],
  {
    files: ['**/*.ts'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          depConstraints: [
            { sourceTag: 'scope:shared', onlyDependOnLibsWithTags: ['scope:shared'] },
            { sourceTag: 'scope:orders', onlyDependOnLibsWithTags: ['scope:orders', 'scope:shared'] },
            { sourceTag: 'scope:catalog', onlyDependOnLibsWithTags: ['scope:catalog', 'scope:shared'] },
            { sourceTag: 'type:feature', onlyDependOnLibsWithTags: ['type:feature', 'type:data-access', 'type:ui', 'type:util'] },
            { sourceTag: 'type:data-access', onlyDependOnLibsWithTags: ['type:data-access', 'type:util'] },
          ],
        },
      ],
    },
  },
];
```

With these constraints in place, an `orders` developer who tries to `import { CatalogStore } from '@acme/catalog/data-access'` gets a lint failure in their editor, in the precommit hook, and in CI. The boundary is no longer a guideline. It is mechanical. The same rule prevents a `scope:shared` library from importing any `scope:orders` library, which is how we keep the dependency direction one-way.

## The Page Composes, the Stores Do Not

A common situation: the orders page wants to display each order with the product name from the catalog. Both feature stores exist, both are reading separate API resources, and the temptation is to write a selector inside `orders` that imports something from `catalog`. Don't. Compose at the page level instead.

```typescript
// libs/orders/feature/src/lib/orders-page.component.ts
import { Component, computed, inject } from '@angular/core';
import { OrdersStore } from '@acme/orders/data-access';
import { CatalogStore } from '@acme/catalog/data-access';

@Component({
  selector: 'app-orders-page',
  template: `
    @if (rows().length) {
      <ul>
        @for (row of rows(); track row.id) {
          <li>{{ row.id }} — {{ row.productName }}</li>
        }
      </ul>
    } @else {
      <p>No orders.</p>
    }
  `,
  providers: [OrdersStore, CatalogStore],
})
export class OrdersPageComponent {
  private orders = inject(OrdersStore);
  private catalog = inject(CatalogStore);

  rows = computed(() =>
    this.orders.ids().map((id) => ({
      id,
      productName: this.catalog.nameFor(id) ?? 'Unknown',
    })),
  );
}
```

The page is a leaf. It is allowed to know about both features because it lives at the seam where they meet. Neither store knows about the other. If catalog disappears tomorrow, the orders store still compiles, still tests, still ships. Only the page changes.

## Common Mistakes

**1. The "shared" lib that grew a UI.** A team creates `libs/shared/data-access-orders` because two features briefly needed order data, and a year later it owns half the order domain.

```typescript
// libs/shared/data-access-orders/src/lib/orders.store.ts -- WRONG
export const OrdersStore = signalStore({ providedIn: 'root' }, /* ... */);
```

The store is "shared" only because of where the file lives, not because the state is genuinely cross-cutting. Now the orders team cannot move fast without breaking unrelated features. The fix is to move the store back into `libs/orders/data-access` and expose only what is actually needed by other features, usually a single read method.

```typescript
// libs/orders/data-access/src/lib/orders.store.ts -- right
export const OrdersStore = signalStore(/* not providedIn root */);
// Other features ask for order counts via a public method, or not at all.
```

**2. Dispatching another feature's actions.** Catalog wants to add a product to the cart, so it imports `CartActions.addItem` and dispatches it directly.

```typescript
// libs/catalog/feature/src/lib/product.component.ts -- WRONG
import { CartActions } from '@acme/cart/data-access';

addToCart(id: string) {
  this.store.dispatch(CartActions.addItem({ productId: id }));
}
```

The cart's internal action shape is now part of the catalog's contract. The cart team cannot rename the action without breaking catalog. Invert it: let catalog emit an event it owns, and let cart react.

```typescript
// libs/catalog/feature/src/lib/product.component.ts -- right
import { CatalogEvents } from '@acme/catalog/data-access';

addToCart(id: string) {
  this.store.dispatch(CatalogEvents.productSelected({ productId: id }));
}

// libs/cart/data-access/src/lib/cart.effects.ts
addOnCatalogSelection$ = createEffect(() =>
  this.actions$.pipe(
    ofType(CatalogEvents.productSelected),
    map(({ productId }) => CartActions.addItem({ productId })),
  ),
);
```

Each team owns its own action group. The contract is the public event, not the internal reducer call.

**3. `getState` as a back channel.** A feature snapshots another feature's store inside an effect because reactivity feels like overkill.

```typescript
// libs/orders/data-access/src/lib/orders.effects.ts -- WRONG
import { getState } from '@ngrx/signals';
import { CartStore } from '@acme/cart/data-access';

place$ = createEffect(() =>
  this.actions$.pipe(
    ofType(OrdersActions.place),
    map(() => {
      const cart = getState(inject(CartStore));
      return OrdersActions.placed({ items: cart.items });
    }),
  ),
);
```

This works once and rots. The orders effect now silently depends on the cart's internal shape, and there is no compile error if the cart renames `items` to `lines`. Either expose a public signal on the cart and read it reactively, or have the cart pass the items through the dispatched action so the orders effect never has to know the cart exists.

**4. Putting a feature store at the root by accident.** A developer copy-pastes the auth store template and writes `{ providedIn: 'root' }` on a per-feature store.

```typescript
// libs/checkout/data-access/src/lib/checkout.store.ts -- WRONG
export const CheckoutStore = signalStore(
  { providedIn: 'root' },
  withState(initialCheckout),
);
```

The checkout state now lives for the entire app session, holds onto the user's previous attempt forever, and is implicitly shared with anything that injects it. The fix is to drop `providedIn: 'root'` and provide the store on the checkout route.

```typescript
// libs/checkout/feature/src/lib/checkout.routes.ts -- right
export const checkoutRoutes: Routes = [
  {
    path: '',
    providers: [CheckoutStore],
    loadComponent: () => import('./checkout-page.component').then((m) => m.CheckoutPageComponent),
  },
];
```

**5. Exporting every selector from the barrel.** The shared library author runs "Auto-export all" and ships every selector `createFeature` generated, including ones that expose internal shape.

```typescript
// libs/shared/data-access-config/src/index.ts -- WRONG
export * from './lib/config.feature';
```

Now `selectConfigState` is public and three features import it and pluck fields directly. The config team can no longer change the state shape. Hand-curate the barrel and export only the selectors you are willing to support.

```typescript
// libs/shared/data-access-config/src/index.ts -- right
export { selectFlag, selectLoaded } from './lib/config.feature';
export { ConfigApiActions } from './lib/config.actions';
```

## Key Takeaways

- State is shared only when it is read by multiple features **and** owned by no single one. Default to feature-owned. Promotion to the shared layer is a one-way door.
- Shared state lives in a dedicated library, is provided at the root injector, and exposes a hand-curated barrel. The barrel is the contract; everything else is private.
- Reading shared state is free, writing it is restricted to named methods. Dependency direction is always feature → shared, never the reverse.
- Use `signalStoreFeature` with `type<>()` to express input contracts that the compiler enforces. Use Nx tags and `@nx/enforce-module-boundaries` to enforce dependency direction at build time.
- When two features must collaborate, compose them at the page (the leaf), let each emit events it owns, and never let one feature's store reach into another's shape with `getState` or deep imports.
