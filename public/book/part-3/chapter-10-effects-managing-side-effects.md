# Chapter 10: Effects: Managing Side Effects

The products page dispatches `ProductsPageActions.opened()`. The reducer sets `loading: true`. And then... nothing happens. No API call. No data arrives. The spinner spins forever. In Chapter 8, we mentioned that reducers are pure functions: no API calls, no navigation, no `localStorage` writes. But the application needs to fetch products from a server when the page opens, redirect to a dashboard after login, and show a notification when a save succeeds. That work has to live somewhere. Right now, the only option is the component itself, which means your `ProductsListComponent` dispatches an action, then also calls `HttpClient`, then dispatches another action with the result. The component is doing two jobs: describing what the user did and orchestrating what the application should do about it. Effects separate these concerns. The component describes the event. The effect handles the consequence.

## A Quick Recap

In Chapter 8, we defined actions with `createActionGroup`, wrote reducers with `createReducer` and `on()`, and registered feature state with `provideState()`. In Chapter 9, we built selectors to extract and transform state with memoization, used `store.selectSignal()` to read state as signals, and composed view model selectors for smart components. Our product catalog has actions like `ProductsPageActions.opened` and `ProductsApiActions.productsLoadedSuccessfully`, a reducer that handles both, and selectors that derive filtered product lists and view models. What we are missing is the bridge between dispatching `opened` and fetching the actual products. That bridge is `@ngrx/effects`.

## What Is an Effect?

An effect is an observable pipeline that listens to the `Actions` stream, performs side effects, and (optionally) dispatches new actions back to the Store. The `Actions` stream is a single observable containing every action dispatched anywhere in the application. Effects use the `ofType` operator to filter for specific action types, then use RxJS operators to call APIs, navigate, log analytics, or perform any async work that does not belong in a reducer.

Picture the data flow with effects added:

```
Component ──dispatch(action)──> Store ──forwards──> Reducer(state, action) ──> New State
    ↑                              │                                              │
    │                              └──> Actions stream ──> Effect ──dispatch──>    │
    │                                                       │                     │
    │                                                    API call                 │
    └───────────── selector reads slice of state ◄────────────────────────────────┘
```

The component dispatches `ProductsPageActions.opened()`. The reducer sets `loading: true`. The effect hears the same action, calls the API, and dispatches either `ProductsApiActions.productsLoadedSuccessfully` (with the data) or `ProductsApiActions.productsLoadedFailure` (with the error). The reducer handles whichever arrives and updates state. The component never knows about the API call. It just dispatches events and reads state.

## The Core API

### createEffect

The `createEffect` function registers an observable pipeline as a side-effect handler. It comes in two forms.

**Class-based effects** live inside `@Injectable()` classes. This is the traditional approach and is still supported:

```typescript
// src/app/products/state/products.effects.ts
import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { switchMap, map, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { ProductsApiService } from '../products-api.service';
import { ProductsPageActions, ProductsApiActions } from './products.actions';

@Injectable()
export class ProductsEffects {
  private readonly actions$ = inject(Actions);
  private readonly api = inject(ProductsApiService);

  readonly loadProducts$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ProductsPageActions.opened),
      switchMap(() =>
        this.api.getAll().pipe(
          map(products => ProductsApiActions.productsLoadedSuccessfully({ products })),
          catchError(error =>
            of(ProductsApiActions.productsLoadedFailure({ error: error.message }))
          )
        )
      )
    )
  );
}
```

**Functional effects** are standalone exported constants. They are tree-shakeable, require no class, and are the preferred pattern in Angular 21:

```typescript
// src/app/products/state/products.effects.ts
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { switchMap, map, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { ProductsApiService } from '../products-api.service';
import { ProductsPageActions, ProductsApiActions } from './products.actions';

export const loadProducts = createEffect(
  (actions$ = inject(Actions), api = inject(ProductsApiService)) =>
    actions$.pipe(
      ofType(ProductsPageActions.opened),
      switchMap(() =>
        api.getAll().pipe(
          map(products => ProductsApiActions.productsLoadedSuccessfully({ products })),
          catchError(error =>
            of(ProductsApiActions.productsLoadedFailure({ error: error.message }))
          )
        )
      )
    ),
  { functional: true }
);
```

Both forms do the same thing. The functional form uses `inject()` via default parameter values to obtain dependencies. The `{ functional: true }` config tells NgRx this is a standalone effect, not a class method. For the rest of this chapter, we use functional effects exclusively.

### ofType

The `ofType` operator filters the `Actions` stream by action type. It accepts one or more action creators:

```typescript
// Single action type
ofType(ProductsPageActions.opened)

// Multiple action types
ofType(ProductsPageActions.opened, ProductsPageActions.refreshRequested)
```

After `ofType`, the observable emits only the matched actions, fully typed. If `ProductsPageActions.opened` carries no payload, the emitted value is `{ type: '[Products Page] Opened' }`. If it carries props, those props are available on the emitted value.

### provideEffects

Effects register through `provideEffects()`, either at the application root or in lazy-loaded route configurations. For functional effects, pass the namespace import:

```typescript
// src/app/app.config.ts
import { ApplicationConfig } from '@angular/core';
import { provideStore } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import * as productEffects from './products/state/products.effects';

export const appConfig: ApplicationConfig = {
  providers: [
    provideStore(),
    provideEffects(productEffects),
  ],
};
```

For feature-level effects that load lazily with a route:

```typescript
// src/app/products/products.routes.ts
import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { productsFeature } from './state/products.feature';
import * as productEffects from './state/products.effects';

export const productsRoutes: Routes = [
  {
    path: '',
    providers: [
      provideState(productsFeature),
      provideEffects(productEffects),
    ],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./products-list.component').then(m => m.ProductsListComponent),
      },
    ],
  },
];
```

Functional effects must be registered as namespace imports (`import * as productEffects`). NgRx scans the namespace for exported `createEffect` instances and subscribes to each one. Individual named imports will not be auto-detected by `provideEffects`.

## Choosing the Right RxJS Flattening Operator

The flattening operator you choose inside `createEffect` determines how concurrent actions are handled. This is the single most critical decision in effect design. Choose wrong and you get canceled requests, duplicate submissions, or race conditions.

### switchMap: Cancel Previous

`switchMap` unsubscribes from the previous inner observable when a new source value arrives. If a user types "wid" and then "widget" before the first search completes, `switchMap` cancels the "wid" request and only processes "widget".

```typescript
// src/app/products/state/products.effects.ts
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { switchMap, map, catchError, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { of } from 'rxjs';
import { ProductsApiService } from '../products-api.service';
import { ProductsPageActions, ProductsApiActions } from './products.actions';

export const searchProducts = createEffect(
  (actions$ = inject(Actions), api = inject(ProductsApiService)) =>
    actions$.pipe(
      ofType(ProductsPageActions.searchChanged),
      debounceTime(300),
      distinctUntilChanged((prev, curr) => prev.query === curr.query),
      switchMap(({ query }) =>
        api.search(query).pipe(
          map(results => ProductsApiActions.searchSuccess({ results })),
          catchError(error =>
            of(ProductsApiActions.searchFailure({ error: error.message }))
          )
        )
      )
    ),
  { functional: true }
);
```

**Use for:** GET requests, search, typeahead, data fetching where only the latest result matters.

**Never use for:** POST, PUT, or DELETE operations. Canceling an HTTP request on the client does not cancel the server-side operation. If a user submits an order and then submits again before the first completes, `switchMap` cancels the client-side observable for the first request, but the server still processes it. You end up with a duplicate order and no error.

### exhaustMap: Ignore New

`exhaustMap` ignores new source values while the current inner observable is still in progress. If a user clicks "Login" three times rapidly, only the first click triggers an API call. The second and third clicks are silently dropped.

```typescript
// src/app/auth/state/auth.effects.ts
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { exhaustMap, map, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { AuthApiService } from '../auth-api.service';
import { AuthPageActions, AuthApiActions } from './auth.actions';

export const login = createEffect(
  (actions$ = inject(Actions), api = inject(AuthApiService)) =>
    actions$.pipe(
      ofType(AuthPageActions.login),
      exhaustMap(({ credentials }) =>
        api.login(credentials).pipe(
          map(user => AuthApiActions.loginSuccess({ user })),
          catchError(error =>
            of(AuthApiActions.loginFailure({ error: error.message }))
          )
        )
      )
    ),
  { functional: true }
);
```

**Use for:** Login, form submissions, any single-fire operation where duplicate requests are harmful.

### concatMap: Queue in Order

`concatMap` waits for the current inner observable to complete before subscribing to the next one. Actions queue up and process sequentially, preserving order.

```typescript
// src/app/orders/state/orders.effects.ts
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { concatMap, map, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { OrdersApiService } from '../orders-api.service';
import { OrdersPageActions, OrdersApiActions } from './orders.actions';

export const submitOrder = createEffect(
  (actions$ = inject(Actions), api = inject(OrdersApiService)) =>
    actions$.pipe(
      ofType(OrdersPageActions.submitOrder),
      concatMap(({ order }) =>
        api.submit(order).pipe(
          map(confirmation => OrdersApiActions.submitOrderSuccess({ confirmation })),
          catchError(error =>
            of(OrdersApiActions.submitOrderFailure({ error: error.message }))
          )
        )
      )
    ),
  { functional: true }
);
```

**Use for:** Sequential write operations where order matters. If the user adds item A, then item B to a wishlist, `concatMap` guarantees A is saved before B.

### mergeMap: Run in Parallel

`mergeMap` subscribes to every inner observable immediately without waiting. All requests run concurrently. Responses arrive in whatever order the server returns them.

```typescript
// src/app/cart/state/cart.effects.ts
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { mergeMap, map, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { CartApiService } from '../cart-api.service';
import { CartPageActions, CartApiActions } from './cart.actions';

export const removeCartItem = createEffect(
  (actions$ = inject(Actions), api = inject(CartApiService)) =>
    actions$.pipe(
      ofType(CartPageActions.removeItem),
      mergeMap(({ itemId }) =>
        api.removeItem(itemId).pipe(
          map(() => CartApiActions.removeItemSuccess({ itemId })),
          catchError(error =>
            of(CartApiActions.removeItemFailure({ itemId, error: error.message }))
          )
        )
      )
    ),
  { functional: true }
);
```

**Use for:** Independent operations that benefit from parallelism, like removing multiple cart items or toggling favorites on several products at once.

### The Decision Table

| Operator | When a new action arrives while one is in-flight | Best for |
|---|---|---|
| `switchMap` | Cancels the previous request | Read operations, search, navigation |
| `exhaustMap` | Ignores the new action | Login, form submit, deduplication |
| `concatMap` | Queues it behind the current request | Ordered writes, sequential operations |
| `mergeMap` | Runs both in parallel | Independent bulk operations |

When in doubt, start with `switchMap` for reads and `exhaustMap` for writes. These two cover the vast majority of real-world effects.

## Fire-and-Forget Effects

Not every effect dispatches an action. Navigation, logging, and notification effects perform their side effect and are done. Set `dispatch: false` to tell NgRx not to expect a return action:

```typescript
// src/app/auth/state/auth.effects.ts
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { tap } from 'rxjs/operators';
import { AuthApiActions } from './auth.actions';

export const redirectAfterLogin = createEffect(
  (actions$ = inject(Actions), router = inject(Router)) =>
    actions$.pipe(
      ofType(AuthApiActions.loginSuccess),
      tap(() => router.navigate(['/dashboard']))
    ),
  { functional: true, dispatch: false }
);

export const redirectAfterLogout = createEffect(
  (actions$ = inject(Actions), router = inject(Router)) =>
    actions$.pipe(
      ofType(AuthApiActions.logoutSuccess),
      tap(() => router.navigate(['/login']))
    ),
  { functional: true, dispatch: false }
);
```

Without `dispatch: false`, NgRx treats whatever the observable emits as an action and tries to dispatch it. The return value of `router.navigate()` is a `Promise<boolean>`, not an action, which causes a runtime error. Always set `dispatch: false` for effects that do not return actions.

Notification effects follow the same pattern:

```typescript
// src/app/shared/state/notification.effects.ts
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { tap } from 'rxjs/operators';
import { NotificationService } from '../notification.service';
import { OrdersApiActions } from '../../orders/state/orders.actions';

export const showOrderSuccess = createEffect(
  (actions$ = inject(Actions), notifications = inject(NotificationService)) =>
    actions$.pipe(
      ofType(OrdersApiActions.submitOrderSuccess),
      tap(({ confirmation }) =>
        notifications.show(`Order ${confirmation.id} placed successfully`)
      )
    ),
  { functional: true, dispatch: false }
);
```

One action, three effects: a reducer updates state, a navigation effect redirects, and a notification effect shows a toast. That is the power of the event-driven model. The action describes what happened. Each handler independently decides how to respond.

## Reading Store State with concatLatestFrom

Sometimes an effect needs current state from the Store. For example, an effect that loads products might want to skip the API call if products are already loaded. The `concatLatestFrom` operator reads a store selector lazily, only when the source action arrives:

```typescript
// src/app/products/state/products.effects.ts
import { inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { concatLatestFrom } from '@ngrx/operators';
import { switchMap, map, catchError, filter } from 'rxjs/operators';
import { of } from 'rxjs';
import { ProductsApiService } from '../products-api.service';
import { ProductsPageActions, ProductsApiActions } from './products.actions';
import { productsFeature } from './products.feature';

export const loadProducts = createEffect(
  (
    actions$ = inject(Actions),
    store = inject(Store),
    api = inject(ProductsApiService)
  ) =>
    actions$.pipe(
      ofType(ProductsPageActions.opened),
      concatLatestFrom(() => store.select(productsFeature.selectLoaded)),
      filter(([, alreadyLoaded]) => !alreadyLoaded),
      switchMap(() =>
        api.getAll().pipe(
          map(products => ProductsApiActions.productsLoadedSuccessfully({ products })),
          catchError(error =>
            of(ProductsApiActions.productsLoadedFailure({ error: error.message }))
          )
        )
      )
    ),
  { functional: true }
);
```

`concatLatestFrom` accepts a factory function `() => Observable` and evaluates it only when the source emits. This is important because the alternative, RxJS's built-in `withLatestFrom`, eagerly subscribes to the store selector at effect initialization time, which means the selector runs on every store change regardless of whether the action has fired. For effects, always prefer `concatLatestFrom`.

Note that `concatLatestFrom` is imported from `@ngrx/operators`, not `@ngrx/effects`. It was moved to the dedicated operators package in NgRx v15.

## Effect Lifecycle Hooks

Class-based effects support lifecycle interfaces that control when and how effects run.

### OnInitEffects

`OnInitEffects` dispatches an action immediately after the effect class is registered. This is useful for loading configuration or initial data on application startup:

```typescript
// src/app/config/state/config.effects.ts
import { Injectable, inject } from '@angular/core';
import { Action } from '@ngrx/store';
import { Actions, createEffect, ofType, OnInitEffects } from '@ngrx/effects';
import { switchMap, map, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { ConfigApiService } from '../config-api.service';
import { ConfigActions } from './config.actions';

@Injectable()
export class ConfigEffects implements OnInitEffects {
  private readonly actions$ = inject(Actions);
  private readonly api = inject(ConfigApiService);

  ngrxOnInitEffects(): Action {
    return ConfigActions.init();
  }

  readonly loadConfig$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ConfigActions.init),
      switchMap(() =>
        this.api.getConfig().pipe(
          map(config => ConfigActions.loadConfigSuccess({ config })),
          catchError(error =>
            of(ConfigActions.loadConfigFailure({ error: error.message }))
          )
        )
      )
    )
  );
}
```

`ngrxOnInitEffects()` returns a single action that NgRx dispatches automatically after registration. The effect then picks up that action through `ofType` like any other. This keeps initialization logic inside the standard action/effect flow rather than burying it in a constructor or `APP_INITIALIZER`.

Lifecycle hooks require class-based effects because they rely on class interfaces. Functional effects do not support `OnInitEffects` or `OnRunEffects`. If you need initialization behavior with functional effects, dispatch the action from an application initializer or a component constructor instead.

## Building the Complete Products Feature

Let us wire up the full effect layer for our product catalog, building on the actions, reducers, and selectors from Chapters 8 and 9.

First, the API service that our effects will call:

```typescript
// src/app/products/products-api.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Product } from './product.model';

@Injectable({ providedIn: 'root' })
export class ProductsApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/products';

  getAll(): Observable<Product[]> {
    return this.http.get<Product[]>(this.baseUrl);
  }

  search(query: string): Observable<Product[]> {
    return this.http.get<Product[]>(this.baseUrl, {
      params: { q: query },
    });
  }

  getById(id: string): Observable<Product> {
    return this.http.get<Product>(`${this.baseUrl}/${id}`);
  }

  create(product: Omit<Product, 'id'>): Observable<Product> {
    return this.http.post<Product>(this.baseUrl, product);
  }

  update(product: Product): Observable<Product> {
    return this.http.put<Product>(`${this.baseUrl}/${product.id}`, product);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }
}
```

Now the extended actions. We add a new action group for admin operations to demonstrate different operator choices:

```typescript
// src/app/products/state/products.actions.ts
import { createActionGroup, emptyProps, props } from '@ngrx/store';
import { Product } from '../product.model';

export const ProductsPageActions = createActionGroup({
  source: 'Products Page',
  events: {
    'Opened': emptyProps(),
    'Product Selected': props<{ productId: string }>(),
    'Search Changed': props<{ query: string }>(),
    'Refresh Requested': emptyProps(),
  },
});

export const ProductsApiActions = createActionGroup({
  source: 'Products API',
  events: {
    'Products Loaded Successfully': props<{ products: Product[] }>(),
    'Products Loaded Failure': props<{ error: string }>(),
    'Search Success': props<{ results: Product[] }>(),
    'Search Failure': props<{ error: string }>(),
  },
});

export const ProductAdminActions = createActionGroup({
  source: 'Product Admin',
  events: {
    'Create Product': props<{ product: Omit<Product, 'id'> }>(),
    'Update Product': props<{ product: Product }>(),
    'Delete Product': props<{ productId: string }>(),
  },
});

export const ProductAdminApiActions = createActionGroup({
  source: 'Product Admin API',
  events: {
    'Create Product Success': props<{ product: Product }>(),
    'Create Product Failure': props<{ error: string }>(),
    'Update Product Success': props<{ product: Product }>(),
    'Update Product Failure': props<{ error: string }>(),
    'Delete Product Success': props<{ productId: string }>(),
    'Delete Product Failure': props<{ productId: string; error: string }>(),
  },
});
```

Now the complete effects file, demonstrating each operator in context:

```typescript
// src/app/products/state/products.effects.ts
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import {
  switchMap,
  map,
  catchError,
  exhaustMap,
  concatMap,
  mergeMap,
  tap,
  debounceTime,
  distinctUntilChanged,
} from 'rxjs/operators';
import { of } from 'rxjs';
import { ProductsApiService } from '../products-api.service';
import {
  ProductsPageActions,
  ProductsApiActions,
  ProductAdminActions,
  ProductAdminApiActions,
} from './products.actions';

// switchMap: only the latest load matters
export const loadProducts = createEffect(
  (actions$ = inject(Actions), api = inject(ProductsApiService)) =>
    actions$.pipe(
      ofType(ProductsPageActions.opened, ProductsPageActions.refreshRequested),
      switchMap(() =>
        api.getAll().pipe(
          map(products => ProductsApiActions.productsLoadedSuccessfully({ products })),
          catchError(error =>
            of(ProductsApiActions.productsLoadedFailure({ error: error.message }))
          )
        )
      )
    ),
  { functional: true }
);

// switchMap + debounce: cancel stale searches
export const searchProducts = createEffect(
  (actions$ = inject(Actions), api = inject(ProductsApiService)) =>
    actions$.pipe(
      ofType(ProductsPageActions.searchChanged),
      debounceTime(300),
      distinctUntilChanged((prev, curr) => prev.query === curr.query),
      switchMap(({ query }) =>
        api.search(query).pipe(
          map(results => ProductsApiActions.searchSuccess({ results })),
          catchError(error =>
            of(ProductsApiActions.searchFailure({ error: error.message }))
          )
        )
      )
    ),
  { functional: true }
);

// exhaustMap: prevent duplicate create submissions
export const createProduct = createEffect(
  (actions$ = inject(Actions), api = inject(ProductsApiService)) =>
    actions$.pipe(
      ofType(ProductAdminActions.createProduct),
      exhaustMap(({ product }) =>
        api.create(product).pipe(
          map(created => ProductAdminApiActions.createProductSuccess({ product: created })),
          catchError(error =>
            of(ProductAdminApiActions.createProductFailure({ error: error.message }))
          )
        )
      )
    ),
  { functional: true }
);

// concatMap: process updates in order
export const updateProduct = createEffect(
  (actions$ = inject(Actions), api = inject(ProductsApiService)) =>
    actions$.pipe(
      ofType(ProductAdminActions.updateProduct),
      concatMap(({ product }) =>
        api.update(product).pipe(
          map(updated => ProductAdminApiActions.updateProductSuccess({ product: updated })),
          catchError(error =>
            of(ProductAdminApiActions.updateProductFailure({ error: error.message }))
          )
        )
      )
    ),
  { functional: true }
);

// mergeMap: deletions are independent, run in parallel
export const deleteProduct = createEffect(
  (actions$ = inject(Actions), api = inject(ProductsApiService)) =>
    actions$.pipe(
      ofType(ProductAdminActions.deleteProduct),
      mergeMap(({ productId }) =>
        api.delete(productId).pipe(
          map(() => ProductAdminApiActions.deleteProductSuccess({ productId })),
          catchError(error =>
            of(ProductAdminApiActions.deleteProductFailure({ productId, error: error.message }))
          )
        )
      )
    ),
  { functional: true }
);

// dispatch: false for navigation
export const navigateAfterCreate = createEffect(
  (actions$ = inject(Actions), router = inject(Router)) =>
    actions$.pipe(
      ofType(ProductAdminApiActions.createProductSuccess),
      tap(({ product }) => router.navigate(['/products', product.id]))
    ),
  { functional: true, dispatch: false }
);
```

Each effect uses the operator that matches its concurrency requirements. Loading uses `switchMap` because only the latest fetch matters. Creating uses `exhaustMap` to prevent double submissions. Updating uses `concatMap` to preserve order. Deleting uses `mergeMap` because each deletion is independent. Navigation uses `dispatch: false` because it does not produce a new action.

Register everything in the route configuration:

```typescript
// src/app/products/products.routes.ts
import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { productsFeature } from './state/products.feature';
import * as productEffects from './state/products.effects';

export const productsRoutes: Routes = [
  {
    path: '',
    providers: [
      provideState(productsFeature),
      provideEffects(productEffects),
    ],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./products-list.component').then(m => m.ProductsListComponent),
      },
      {
        path: ':id',
        loadComponent: () =>
          import('./product-detail.component').then(m => m.ProductDetailComponent),
      },
    ],
  },
];
```

## Updated File Organization

With effects added, the feature directory grows by two files:

```
src/app/products/
  state/
    products.actions.ts        ← action groups (page, API, admin, admin API)
    products.reducer.ts        ← state interface, initial state, reducer
    products.feature.ts        ← createFeature with selectors
    products.effects.ts        ← all effects for this feature
    index.ts                   ← barrel file
  product.model.ts             ← domain model interface
  products.routes.ts           ← lazy route config with provideState + provideEffects
  products-list.component.ts
  product-detail.component.ts
  product-card.component.ts
  products-api.service.ts      ← HttpClient wrapper
```

The barrel file re-exports the public API:

```typescript
// src/app/products/state/index.ts
export { ProductsPageActions, ProductsApiActions, ProductAdminActions, ProductAdminApiActions } from './products.actions';
export { productsFeature } from './products.feature';
export { ProductsState } from './products.reducer';
```

Effects stay inside the `state/` directory because they are part of the state management layer. They are not imported by components directly. Components dispatch actions and read state through selectors. The effects layer is invisible to the component.

## Common Mistakes

### Mistake 1: Placing catchError at the Effect Level

```typescript
// WRONG: catchError on the outer observable kills the effect permanently
export const loadProducts = createEffect(
  (actions$ = inject(Actions), api = inject(ProductsApiService)) =>
    actions$.pipe(
      ofType(ProductsPageActions.opened),
      switchMap(() => api.getAll()),
      map(products => ProductsApiActions.productsLoadedSuccessfully({ products })),
      catchError(error =>
        of(ProductsApiActions.productsLoadedFailure({ error: error.message }))
      )
    ),
  { functional: true }
);
```

When the API call fails, `catchError` intercepts the error and emits a failure action. But because `catchError` is on the outer observable (after `switchMap`, not inside it), the outer observable completes after the error is handled. The effect stops listening for future `ProductsPageActions.opened` actions. The user navigates away and back, the action dispatches, and nothing happens. The effect is dead.

```typescript
// CORRECT: catchError inside the inner observable
export const loadProducts = createEffect(
  (actions$ = inject(Actions), api = inject(ProductsApiService)) =>
    actions$.pipe(
      ofType(ProductsPageActions.opened),
      switchMap(() =>
        api.getAll().pipe(
          map(products => ProductsApiActions.productsLoadedSuccessfully({ products })),
          catchError(error =>
            of(ProductsApiActions.productsLoadedFailure({ error: error.message }))
          )
        )
      )
    ),
  { functional: true }
);
```

Now `catchError` handles the error inside the `switchMap` inner observable. The outer observable continues running and picks up future actions.

### Mistake 2: Using switchMap for Write Operations

```typescript
// WRONG: switchMap cancels the previous save when a new one arrives
export const saveProduct = createEffect(
  (actions$ = inject(Actions), api = inject(ProductsApiService)) =>
    actions$.pipe(
      ofType(ProductAdminActions.updateProduct),
      switchMap(({ product }) =>
        api.update(product).pipe(
          map(updated => ProductAdminApiActions.updateProductSuccess({ product: updated })),
          catchError(error =>
            of(ProductAdminApiActions.updateProductFailure({ error: error.message }))
          )
        )
      )
    ),
  { functional: true }
);
```

If the user saves a product, then quickly saves again with different data, `switchMap` cancels the client-side observable for the first request. But the first PUT request is already in-flight on the server. The server processes both requests in unpredictable order. The user sees "success" for the second save, but the server may have applied the first save's data last, silently overwriting the second save.

```typescript
// CORRECT: concatMap processes saves in order
export const saveProduct = createEffect(
  (actions$ = inject(Actions), api = inject(ProductsApiService)) =>
    actions$.pipe(
      ofType(ProductAdminActions.updateProduct),
      concatMap(({ product }) =>
        api.update(product).pipe(
          map(updated => ProductAdminApiActions.updateProductSuccess({ product: updated })),
          catchError(error =>
            of(ProductAdminApiActions.updateProductFailure({ error: error.message }))
          )
        )
      )
    ),
  { functional: true }
);
```

### Mistake 3: Forgetting dispatch: false on Non-Dispatching Effects

```typescript
// WRONG: NgRx tries to dispatch the router.navigate() return value as an action
export const redirectAfterLogin = createEffect(
  (actions$ = inject(Actions), router = inject(Router)) =>
    actions$.pipe(
      ofType(AuthApiActions.loginSuccess),
      tap(() => router.navigate(['/dashboard']))
    ),
  { functional: true }
);
```

Without `dispatch: false`, NgRx subscribes to the effect's observable and dispatches whatever it emits. The `tap` operator passes through the original action, so NgRx dispatches `AuthApiActions.loginSuccess` again, which triggers the effect again, creating an infinite loop of navigation attempts.

```typescript
// CORRECT: dispatch: false tells NgRx not to dispatch the result
export const redirectAfterLogin = createEffect(
  (actions$ = inject(Actions), router = inject(Router)) =>
    actions$.pipe(
      ofType(AuthApiActions.loginSuccess),
      tap(() => router.navigate(['/dashboard']))
    ),
  { functional: true, dispatch: false }
);
```

### Mistake 4: Overloading a Single Effect with Multiple Responsibilities

```typescript
// WRONG: one effect does everything
export const handleOrderSubmission = createEffect(
  (
    actions$ = inject(Actions),
    api = inject(OrdersApiService),
    router = inject(Router),
    notifications = inject(NotificationService),
    analytics = inject(AnalyticsService)
  ) =>
    actions$.pipe(
      ofType(OrdersPageActions.submitOrder),
      exhaustMap(({ order }) =>
        api.submit(order).pipe(
          tap(confirmation => {
            router.navigate(['/orders', confirmation.id]);
            notifications.show(`Order ${confirmation.id} placed!`);
            analytics.track('order_placed', { orderId: confirmation.id });
          }),
          map(confirmation => OrdersApiActions.submitOrderSuccess({ confirmation })),
          catchError(error =>
            of(OrdersApiActions.submitOrderFailure({ error: error.message }))
          )
        )
      )
    ),
  { functional: true }
);
```

This effect has four responsibilities: calling the API, navigating, showing a notification, and tracking analytics. If any of the `tap` side effects throw, the entire effect breaks. And when you need to change the notification text, you are editing an effect that also handles API calls and navigation.

```typescript
// CORRECT: split into focused effects
export const submitOrder = createEffect(
  (actions$ = inject(Actions), api = inject(OrdersApiService)) =>
    actions$.pipe(
      ofType(OrdersPageActions.submitOrder),
      exhaustMap(({ order }) =>
        api.submit(order).pipe(
          map(confirmation => OrdersApiActions.submitOrderSuccess({ confirmation })),
          catchError(error =>
            of(OrdersApiActions.submitOrderFailure({ error: error.message }))
          )
        )
      )
    ),
  { functional: true }
);

export const navigateAfterOrder = createEffect(
  (actions$ = inject(Actions), router = inject(Router)) =>
    actions$.pipe(
      ofType(OrdersApiActions.submitOrderSuccess),
      tap(({ confirmation }) => router.navigate(['/orders', confirmation.id]))
    ),
  { functional: true, dispatch: false }
);

export const notifyOrderSuccess = createEffect(
  (actions$ = inject(Actions), notifications = inject(NotificationService)) =>
    actions$.pipe(
      ofType(OrdersApiActions.submitOrderSuccess),
      tap(({ confirmation }) =>
        notifications.show(`Order ${confirmation.id} placed!`)
      )
    ),
  { functional: true, dispatch: false }
);

export const trackOrderPlaced = createEffect(
  (actions$ = inject(Actions), analytics = inject(AnalyticsService)) =>
    actions$.pipe(
      ofType(OrdersApiActions.submitOrderSuccess),
      tap(({ confirmation }) =>
        analytics.track('order_placed', { orderId: confirmation.id })
      )
    ),
  { functional: true, dispatch: false }
);
```

Four effects, each with one job. They all listen to the same success action. If analytics tracking breaks, the navigation and notification effects continue working. Each can be tested independently.

## Key Takeaways

- **Effects handle side effects so reducers stay pure.** Components dispatch events, effects orchestrate async work, and reducers handle the results. No component should call an API and dispatch an action with the result.

- **The flattening operator determines concurrency behavior.** Use `switchMap` for reads (cancel stale requests), `exhaustMap` for writes that must not duplicate (login, submit), `concatMap` for ordered writes, and `mergeMap` for independent parallel operations.

- **Always place `catchError` inside the inner observable.** Placing it on the outer stream completes the effect permanently. Every effect that calls an API needs `catchError` inside the flattening operator, returning a failure action via `of()`.

- **Use `dispatch: false` for fire-and-forget effects.** Navigation, notifications, and analytics effects do not return actions. Without this flag, NgRx re-dispatches the original action, causing infinite loops.

- **Keep effects focused on one responsibility.** If an effect calls an API, navigates, shows a notification, and logs analytics, split it into four effects listening to the same action. The event-driven model makes this natural and testable.
