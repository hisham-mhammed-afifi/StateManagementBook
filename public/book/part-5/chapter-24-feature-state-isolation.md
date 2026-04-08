# Chapter 24: Feature State Isolation

The shop application has grown again. The product catalog, the shopping cart, the checkout flow, and the admin dashboard all live in the same Angular project, and every one of them has its own slice of state. On the first page load, the user lands on `/products` and waits while the bundle downloads the entire admin dashboard's reducers, effects, and forty selectors they will never see. Meanwhile, the cart's state lingers in the global store after the user navigates away, pinning memory and confusing the next test that boots the same store. A developer adds a new feature called `orders` and copies an existing reducer, accidentally reusing the feature key `'cart'`, and suddenly the cart silently empties every time someone visits the orders page. None of these are bugs in NgRx. They are bugs in how the features are wired into the application.

This chapter is about drawing hard lines around features so each one owns its bundle, its state lifecycle, and its public surface. We will route-scope state with the standalone APIs, contrast Classic Store's "register and stay" semantics with SignalStore's true per-route lifecycle, and walk through a working example that lazy-loads two features with zero shared globals.

## A Brief Recap

Chapter 23 covered the principles of state shape: normalize entities, derive what you can, model status as a single field. Those principles assume one store per feature. This chapter is the structural counterpart: where do those stores live, how are they registered, and what happens when the user leaves the route? The standalone APIs we use here (`provideStore`, `provideState`, `provideEffects`, route `providers`) were introduced in NgRx v15 alongside Angular's standalone components and are the only supported path in an Angular 21 / NgRx 21 codebase. If you previously used `StoreModule.forFeature` or `EffectsModule.forFeature`, the migration is mechanical: every `forFeature` call becomes a `provideState` or `provideEffects` call inside a route's `providers` array.

## Two Goals, One Pattern

Feature isolation chases two goals that sound similar but are not the same.

The first is **bundle isolation**: code for the cart should not download until the user visits `/cart`. This is a build-time concern. Angular's `loadChildren` and `loadComponent` already handle it. As long as a feature's modules, reducers, components, and effects are only imported from inside a lazily loaded routes file, the bundler puts them in their own chunk.

The second is **state lifecycle isolation**: the cart's state should not exist in memory until the user enters the cart route, and ideally should be released when they leave. This is a runtime concern and requires more care. Classic Store and SignalStore handle it differently, and the difference is the most important thing in this chapter.

The single pattern that addresses both goals is the route `providers` array. When the router matches a route that declares a `providers` array, Angular creates a new `EnvironmentInjector` scoped to that route's subtree. Anything provided there is constructed lazily on first injection, and instances tied to that injector are destroyed when the user navigates away. State libraries plug into this mechanism using their `provide*` functions.

```typescript
// src/app/cart/cart.routes.ts
import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { cartFeature } from './cart.feature';
import { CartEffects } from './cart.effects';

export const cartRoutes: Routes = [
  {
    path: '',
    providers: [
      provideState(cartFeature),
      provideEffects(CartEffects),
    ],
    loadComponent: () =>
      import('./cart-page.component').then((m) => m.CartPageComponent),
  },
];
```

The two `provide*` calls register the cart's state and effects on the route's environment injector. Because this file is only imported via `loadChildren`, neither the cart reducer nor `CartEffects` is in the initial bundle.

## The Root Setup

Before features can register themselves, the root injector needs an empty store and the support packages it expects. Put `provideStore`, devtools, and router store at the root, and nothing else.

```typescript
// src/app/app.config.ts
import { ApplicationConfig } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideStore } from '@ngrx/store';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { provideRouterStore } from '@ngrx/router-store';
import { appRoutes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(),
    provideRouter(appRoutes, withComponentInputBinding()),
    provideStore({}),
    provideRouterStore(),
    provideStoreDevtools({ maxAge: 50, connectInZone: false }),
  ],
};
```

`provideStore({})` boots an empty global store. Every slice of state will arrive later, attached by a feature route. A common mistake is to pass a root reducer map here that already references every feature; that defeats the entire chapter, because importing those reducers from `app.config.ts` pulls them into the initial bundle.

```typescript
// src/app/app.routes.ts
import { Routes } from '@angular/router';

export const appRoutes: Routes = [
  { path: '', redirectTo: 'products', pathMatch: 'full' },
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

Two features, two lazy boundaries, two future bundles.

## The Classic Store Feature

We will build the products feature using Classic Store first, because its quirks are the ones most teams trip on.

```typescript
// src/app/products/products.events.ts
import { createActionGroup, emptyProps, props } from '@ngrx/store';
import { Product } from './product.model';

export const productsEvents = createActionGroup({
  source: 'Products Page',
  events: {
    'Opened': emptyProps(),
    'Load Succeeded': props<{ products: Product[] }>(),
    'Load Failed': props<{ message: string }>(),
  },
});
```

```typescript
// src/app/products/product.model.ts
export interface Product {
  id: string;
  name: string;
  price: number;
}
```

```typescript
// src/app/products/products.feature.ts
import { createFeature, createReducer, on } from '@ngrx/store';
import { Product } from './product.model';
import { productsEvents } from './products.events';

type Status = 'idle' | 'loading' | 'success' | 'error';

export interface ProductsState {
  items: Product[];
  status: Status;
  error: string | null;
}

const initial: ProductsState = { items: [], status: 'idle', error: null };

export const productsFeature = createFeature({
  name: 'products',
  reducer: createReducer(
    initial,
    on(productsEvents.opened, (s) => ({ ...s, status: 'loading' as const })),
    on(productsEvents.loadSucceeded, (s, { products }) => ({
      items: products,
      status: 'success' as const,
      error: null,
    })),
    on(productsEvents.loadFailed, (s, { message }) => ({
      ...s,
      status: 'error' as const,
      error: message,
    })),
  ),
});

export const { selectItems, selectStatus, selectError } = productsFeature;
```

`createFeature` bundles the key, the reducer, and a set of generated selectors. Its `name` is the unique top-level key under which this slice will appear in the global state object. If two features share a name, the second one silently overwrites the first.

```typescript
// src/app/products/products.effects.ts
import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { HttpClient } from '@angular/common/http';
import { catchError, map, of, switchMap } from 'rxjs';
import { Product } from './product.model';
import { productsEvents } from './products.events';

@Injectable()
export class ProductsEffects {
  private readonly actions$ = inject(Actions);
  private readonly http = inject(HttpClient);

  readonly load$ = createEffect(() =>
    this.actions$.pipe(
      ofType(productsEvents.opened),
      switchMap(() =>
        this.http.get<Product[]>('/api/products').pipe(
          map((products) => productsEvents.loadSucceeded({ products })),
          catchError((err: Error) =>
            of(productsEvents.loadFailed({ message: err.message })),
          ),
        ),
      ),
    ),
  );
}
```

```typescript
// src/app/products/products.routes.ts
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

```typescript
// src/app/products/products-page.component.ts
import { Component, OnInit, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import {
  productsFeature,
  selectItems,
  selectStatus,
  selectError,
} from './products.feature';
import { productsEvents } from './products.events';

@Component({
  selector: 'app-products-page',
  template: `
    @switch (status()) {
      @case ('loading') { <p>Loading products...</p> }
      @case ('error') { <p>Failed: {{ error() }}</p> }
      @case ('success') {
        <ul>
          @for (p of items(); track p.id) {
            <li>{{ p.name }} -- {{ p.price | currency }}</li>
          }
        </ul>
      }
    }
  `,
})
export class ProductsPageComponent implements OnInit {
  private readonly store = inject(Store);
  protected readonly items = this.store.selectSignal(selectItems);
  protected readonly status = this.store.selectSignal(selectStatus);
  protected readonly error = this.store.selectSignal(selectError);

  ngOnInit(): void {
    this.store.dispatch(productsEvents.opened());
  }
}
```

When the user navigates to `/products`, Angular downloads the products chunk, instantiates the route's environment injector, runs `provideState(productsFeature)` (which adds the `products` key to the global state), and instantiates `ProductsEffects` (which subscribes to the action stream). The component dispatches `Opened`, the effect calls the API, the reducer updates the slice, the signal updates the view.

Now the gotcha. When the user navigates away from `/products` to `/cart`, the route's environment injector is destroyed and `ProductsEffects` is unsubscribed. But **the `products` slice is not removed from the global state tree**. Classic Store, by design, retains feature reducers once they have been registered. The next time the user visits `/products`, `provideState` registers the same reducer again on a fresh injector, the existing slice is reused, and the reducer picks up where it left off. Most of the time this is fine, sometimes it is desirable, occasionally it is the source of a "why does my feature start with stale data?" bug. Treat the global store as monotonically growing and design your initial-load actions to reset the slice if you need a clean start.

## The SignalStore Feature

The cart feature shows what changes when we use SignalStore at the route level. SignalStore instances created without `providedIn: 'root'` are owned by whichever injector provides them, and they are destroyed with that injector. That gives us true lifecycle isolation.

```typescript
// src/app/cart/cart.store.ts
import { computed } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';

export interface CartLine {
  sku: string;
  name: string;
  price: number;
  qty: number;
}

interface CartState {
  lines: CartLine[];
}

const initial: CartState = { lines: [] };

export const CartStore = signalStore(
  withState<CartState>(initial),
  withComputed(({ lines }) => ({
    total: computed(() =>
      lines().reduce((sum, l) => sum + l.price * l.qty, 0),
    ),
    count: computed(() => lines().reduce((n, l) => n + l.qty, 0)),
  })),
  withMethods((store) => ({
    add(line: Omit<CartLine, 'qty'>): void {
      const existing = store.lines().find((l) => l.sku === line.sku);
      if (existing) {
        patchState(store, {
          lines: store.lines().map((l) =>
            l.sku === line.sku ? { ...l, qty: l.qty + 1 } : l,
          ),
        });
        return;
      }
      patchState(store, { lines: [...store.lines(), { ...line, qty: 1 }] });
    },
    remove(sku: string): void {
      patchState(store, { lines: store.lines().filter((l) => l.sku !== sku) });
    },
    clear(): void {
      patchState(store, initial);
    },
  })),
);
```

Notice the absence of `{ providedIn: 'root' }`. That single omission is what makes this store route-scoped.

```typescript
// src/app/cart/cart.routes.ts
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

```typescript
// src/app/cart/cart-page.component.ts
import { Component, inject } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { CartStore } from './cart.store';

@Component({
  selector: 'app-cart-page',
  imports: [CurrencyPipe],
  template: `
    @if (cart.count() === 0) {
      <p>Your cart is empty.</p>
    } @else {
      <ul>
        @for (line of cart.lines(); track line.sku) {
          <li>
            {{ line.name }} x {{ line.qty }}
            ({{ line.price * line.qty | currency }})
            <button type="button" (click)="cart.remove(line.sku)">Remove</button>
          </li>
        }
      </ul>
      <p>Total: {{ cart.total() | currency }}</p>
    }
  `,
})
export class CartPageComponent {
  protected readonly cart = inject(CartStore);
}
```

When the user visits `/cart`, Angular instantiates `CartStore` from the route's environment injector. When they leave `/cart`, the injector is destroyed and the store instance with it. Visit `/cart` again and a brand-new store starts with the empty initial state. This is the opposite of the Classic Store behavior we just saw, and which one you want depends on the feature. Ephemeral state (a multi-step form, a wizard, a cart that should reset on logout) belongs in a route-scoped SignalStore. Long-lived shared state (the current user, app-wide preferences) belongs in `providedIn: 'root'`.

## When `providedIn: 'root'` Is Still the Right Answer

Route-scoped is not automatically better. A `providedIn: 'root'` SignalStore that is only ever imported from a lazily loaded route still ends up in that route's chunk, because the bundler tracks imports, not provider scopes. So you get bundle isolation for free. The only thing you give up is lifecycle isolation, which is a feature, not a bug, when the state needs to survive route changes.

```typescript
// src/app/products/recently-viewed.store.ts
import { signalStore, withState, withMethods, patchState } from '@ngrx/signals';

interface RecentlyViewedState {
  ids: string[];
}

export const RecentlyViewedStore = signalStore(
  { providedIn: 'root' },
  withState<RecentlyViewedState>({ ids: [] }),
  withMethods((store) => ({
    track(id: string): void {
      const next = [id, ...store.ids().filter((x) => x !== id)].slice(0, 10);
      patchState(store, { ids: next });
    },
  })),
);
```

A "recently viewed products" list should persist as the user moves between `/products` and `/products/:id`, so it lives at the root. If `RecentlyViewedStore` is only ever imported from files inside `src/app/products/`, it ships in the products chunk anyway.

The decision rule: pick `providedIn: 'root'` when the state must outlive route changes; pick a route provider when the state is conceptually scoped to "while the user is on this screen."

## Common Mistakes

### Mistake 1: Calling `provideStore` Inside a Lazy Route

```typescript
// src/app/cart/cart.routes.ts -- WRONG
export const cartRoutes: Routes = [
  {
    path: '',
    providers: [
      provideStore({ cart: cartReducer }),
    ],
    loadComponent: () => import('./cart-page.component').then((m) => m.CartPageComponent),
  },
];
```

`provideStore` boots a *new* store. Calling it inside a route creates a second `Store` instance scoped to that route, which does not see the rest of the application's state and which devtools cannot connect to. The fix is to call `provideStore({})` exactly once at the root and use `provideState` everywhere else.

```typescript
// src/app/cart/cart.routes.ts -- correct
providers: [provideState(cartFeature)],
```

### Mistake 2: Reusing a Feature Key

```typescript
// src/app/orders/orders.feature.ts -- WRONG
export const ordersFeature = createFeature({
  name: 'cart', // copy-pasted from cart.feature.ts
  reducer: createReducer(/* ... */),
});
```

Two features with the same `name` collide silently. Whichever one's route is visited last wins, and the other feature's selectors return data from the wrong reducer. There is no compile error and no runtime warning. The fix is to keep feature names unique across the entire application, ideally namespaced by bounded context.

```typescript
// src/app/orders/orders.feature.ts -- correct
export const ordersFeature = createFeature({ name: 'orders', reducer: /* ... */ });
```

### Mistake 3: Importing a Feature's Selectors From Another Feature

```typescript
// src/app/cart/cart-page.component.ts -- WRONG
import { selectItems } from '../products/products.feature';

protected readonly products = this.store.selectSignal(selectItems);
```

The cart now imports from the products feature. The bundler follows the import and pulls the products reducer, products effects, and the entire products feature into the cart chunk. Bundle isolation gone. The fix is to lift the truly shared piece (a product catalog cache, a price lookup) into a `shared` library, or to expose a typed read API from the products feature that the cart can call without importing reducers. Chapter 25 covers the boundaries in detail.

```typescript
// src/app/cart/cart-page.component.ts -- correct
// Read product names from the cart line itself, not from the products store.
@for (line of cart.lines(); track line.sku) {
  <li>{{ line.name }} x {{ line.qty }}</li>
}
```

### Mistake 4: Expecting Classic Store Slices to Disappear on Navigation

```typescript
// src/app/products/products-page.component.ts -- assumption
ngOnInit(): void {
  // "The slice is fresh because we just navigated here."
  this.store.dispatch(productsEvents.opened());
}
```

The slice is *not* fresh. If the user visited `/products` earlier in the session, the previous `items`, `status`, and `error` are still sitting in the global state. If `loadSucceeded` is delayed and the template renders the cached `items` first, the user sees flicker. The fix is to model "opened" as a deliberate reset:

```typescript
// src/app/products/products.feature.ts -- correct
on(productsEvents.opened, () => ({
  items: [],
  status: 'loading' as const,
  error: null,
})),
```

Or, if you want true lifecycle isolation, switch the feature to a route-scoped SignalStore.

### Mistake 5: Putting Devtools in a Lazy Route

```typescript
// src/app/products/products.routes.ts -- WRONG
providers: [
  provideState(productsFeature),
  provideStoreDevtools({ maxAge: 25 }),
],
```

Devtools is a root concern. Providing it inside a route either does nothing useful or registers a second devtools connection that fights the first. Provide it once in `app.config.ts` and never again.

## Key Takeaways

- A lazy route's `providers` array is the standalone equivalent of `forFeature`. Use `provideState`, `provideEffects`, or a route-scoped SignalStore there to attach state to a feature without bloating the initial bundle.
- Bundle isolation and lifecycle isolation are different problems. `loadChildren` solves the first for free; lifecycle isolation requires a route-scoped SignalStore or a deliberate "reset on open" reducer pattern in Classic Store.
- Classic Store feature slices are registered on first visit and stay registered. Plan for stale data on the second visit, either by resetting in the reducer or by moving the feature to SignalStore.
- A route-scoped SignalStore (`signalStore(...)` without `providedIn: 'root'`) is destroyed when the user leaves the route, giving you a clean instance every visit. Use it for ephemeral, screen-scoped state.
- Never import one feature's reducers, selectors, or stores from another feature. Either lift the shared piece into a shared library or expose a typed contract. Cross-feature imports silently destroy the bundle boundaries you worked to create.
