# Research: Effects: Managing Side Effects

**Date:** 2026-03-30
**Chapter:** Ch 10
**Status:** Ready for chapter generation

## API Surface

### `createEffect` (Stable)
- **Import:** `@ngrx/effects`
- **Signature (class-based):** `createEffect(source: () => Observable<Action>, config?: EffectConfig): Observable<Action>`
- **Signature (functional):** `createEffect(source: (actions$ = inject(Actions), ...deps) => Observable<Action>, { functional: true, dispatch?: boolean })`
- **EffectConfig:** `{ dispatch?: boolean; functional?: boolean }`
  - `dispatch: false` means the effect does not dispatch resulting actions (fire-and-forget side effects like logging, navigation).
  - `functional: true` enables standalone functional effects (no class required, tree-shakeable).

### `Actions` (Stable)
- **Import:** `@ngrx/effects`
- **Type:** `Actions extends Observable<Action>`
- **Description:** Observable stream of all dispatched actions. Inject via `inject(Actions)` or constructor injection.

### `ofType` (Stable)
- **Import:** `@ngrx/effects`
- **Signature:** `ofType<T extends Action>(...allowedTypes: string[]): OperatorFunction<Action, T>`
- **Description:** Filters the `Actions` stream by one or more action types. Accepts action creators or string types.

### `provideEffects` (Stable)
- **Import:** `@ngrx/effects`
- **Signature:** `provideEffects(...effects: Type<any>[] | EffectSourceInstance[]): EnvironmentProviders`
- **Description:** Registers effect classes or functional effect sources with the store. Used in standalone `bootstrapApplication` or route providers.

### `concatLatestFrom` (Stable)
- **Import:** `@ngrx/operators` (moved from `@ngrx/effects` in v15)
- **Signature:** `concatLatestFrom<T, O>(observablesFactory: (value: T) => Observable<O>[] | Observable<O>): OperatorFunction<T, [T, O]>`
- **Description:** Lazily evaluated alternative to `withLatestFrom`. Defers subscription until source emits. Use for reading store state inside effects without eager evaluation.

### `OnInitEffects` (Stable)
- **Import:** `@ngrx/effects`
- **Interface:** `{ ngrxOnInitEffects(): Action }`
- **Description:** Dispatch an action immediately after effect class is registered. Useful for initialization logic (e.g., loading initial data on app start).

### `OnRunEffects` (Stable)
- **Import:** `@ngrx/effects`
- **Interface:** `{ ngrxOnRunEffects(resolvedEffects$: Observable<EffectNotification>): Observable<EffectNotification> }`
- **Description:** Control when effects run. Example: pause all effects until user logs in.

### `OnIdentifyEffects` (Stable)
- **Import:** `@ngrx/effects`
- **Interface:** `{ ngrxOnIdentifyEffects(): string }`
- **Description:** Provide a unique identifier for an effect instance. Allows multiple instances of the same effect class to run independently.

## Key Concepts

- **Effects as the side-effect layer:** Effects isolate side effects (HTTP calls, navigation, localStorage, analytics) from components and reducers. Components dispatch actions; effects listen and orchestrate async work.
- **Action in, action out:** Most effects receive an action via `ofType`, perform async work, and dispatch a new action (success or failure) back to the store.
- **Fire-and-forget effects:** Effects with `dispatch: false` perform side effects without dispatching (e.g., navigation, logging, showing notifications).
- **Choosing the right flattening operator:** The choice between `switchMap`, `concatMap`, `exhaustMap`, and `mergeMap` determines concurrency behavior and is the most critical decision in effect design.
- **Error handling inside the inner observable:** `catchError` must be placed inside the flattening operator's inner observable. Placing it at the effect level completes the effect stream permanently.
- **Functional effects (v16+):** Tree-shakeable, class-free effects using `inject()` for dependencies. Preferred pattern in Angular 21.
- **concatLatestFrom over withLatestFrom:** `concatLatestFrom` lazily evaluates store selectors only when the source action fires, avoiding unnecessary selector subscriptions.
- **Effect lifecycle hooks:** `OnInitEffects` dispatches on registration; `OnRunEffects` controls effect execution timing.
- **Effects should not orchestrate business logic:** Effects handle side effects. Derived state belongs in selectors. Business rules belong in reducers.

## RxJS Operator Guide for Effects

### switchMap
- **Concurrency:** Non-concurrent (cancels previous)
- **Behavior:** When a new action arrives, cancels any in-flight inner observable and subscribes to the new one.
- **Use for:** Read operations, search/typeahead, data fetching where only the latest result matters.
- **Danger:** Do NOT use for write operations (POST, PUT, DELETE). Canceling an in-flight HTTP request does not cancel the server-side operation, leading to silent data loss.

```typescript
// src/app/products/state/products.effects.ts
export const searchProducts = createEffect(
  (actions$ = inject(Actions), api = inject(ProductsApiService)) =>
    actions$.pipe(
      ofType(ProductsPageActions.searchChanged),
      debounceTime(300),
      switchMap(({ query }) =>
        api.search(query).pipe(
          map(results => ProductsApiActions.searchSuccess({ results })),
          catchError(error => of(ProductsApiActions.searchFailure({ error: error.message })))
        )
      )
    ),
  { functional: true }
);
```

### concatMap
- **Concurrency:** Non-concurrent (queues)
- **Behavior:** Waits for the current inner observable to complete before subscribing to the next. Preserves order.
- **Use for:** Sequential write operations where order matters (e.g., processing a queue of form submissions, sequential API calls with dependencies).

```typescript
// src/app/orders/state/orders.effects.ts
export const submitOrder = createEffect(
  (actions$ = inject(Actions), api = inject(OrdersApiService)) =>
    actions$.pipe(
      ofType(OrdersPageActions.submitOrder),
      concatMap(({ order }) =>
        api.submit(order).pipe(
          map(confirmation => OrdersApiActions.submitOrderSuccess({ confirmation })),
          catchError(error => of(OrdersApiActions.submitOrderFailure({ error: error.message })))
        )
      )
    ),
  { functional: true }
);
```

### exhaustMap
- **Concurrency:** Non-concurrent (drops new)
- **Behavior:** Ignores new actions while the current inner observable is still in progress.
- **Use for:** Login, form submissions, any action where duplicate requests must be prevented (user clicking "Submit" multiple times).

```typescript
// src/app/auth/state/auth.effects.ts
export const login = createEffect(
  (actions$ = inject(Actions), api = inject(AuthApiService)) =>
    actions$.pipe(
      ofType(AuthPageActions.login),
      exhaustMap(({ credentials }) =>
        api.login(credentials).pipe(
          map(user => AuthApiActions.loginSuccess({ user })),
          catchError(error => of(AuthApiActions.loginFailure({ error: error.message })))
        )
      )
    ),
  { functional: true }
);
```

### mergeMap
- **Concurrency:** Fully concurrent
- **Behavior:** Subscribes to all inner observables simultaneously. No cancellation, no queuing.
- **Use for:** Independent operations that can run in parallel (e.g., bulk deleting items, favoriting multiple products).
- **Danger:** Unordered responses. No backpressure control. Use sparingly.

```typescript
// src/app/cart/state/cart.effects.ts
export const removeCartItem = createEffect(
  (actions$ = inject(Actions), api = inject(CartApiService)) =>
    actions$.pipe(
      ofType(CartPageActions.removeItem),
      mergeMap(({ itemId }) =>
        api.removeItem(itemId).pipe(
          map(() => CartApiActions.removeItemSuccess({ itemId })),
          catchError(error => of(CartApiActions.removeItemFailure({ itemId, error: error.message })))
        )
      )
    ),
  { functional: true }
);
```

### Quick Reference Table

| Operator | New action arrives while previous in-flight | Best for |
|---|---|---|
| `switchMap` | Cancels previous | Reads, search, navigation |
| `concatMap` | Queues behind previous | Ordered writes |
| `exhaustMap` | Ignores new action | Login, submit, deduplicate |
| `mergeMap` | Runs in parallel | Independent bulk operations |

## Code Patterns

### Pattern 1: Class-based effects (traditional)
```typescript
// src/app/products/state/products.effects.ts
import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
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
          map(products => ProductsApiActions.loadProductsSuccess({ products })),
          catchError(error =>
            of(ProductsApiActions.loadProductsFailure({ error: error.message }))
          )
        )
      )
    )
  );
}
```

### Pattern 2: Functional effects (preferred in Angular 21)
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
          map(products => ProductsApiActions.loadProductsSuccess({ products })),
          catchError(error =>
            of(ProductsApiActions.loadProductsFailure({ error: error.message }))
          )
        )
      )
    ),
  { functional: true }
);
```

### Pattern 3: Fire-and-forget (dispatch: false)
```typescript
// src/app/products/state/products.effects.ts
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { tap } from 'rxjs/operators';
import { ProductsApiActions } from './products.actions';

export const navigateToProduct = createEffect(
  (actions$ = inject(Actions), router = inject(Router)) =>
    actions$.pipe(
      ofType(ProductsApiActions.createProductSuccess),
      tap(({ product }) => router.navigate(['/products', product.id]))
    ),
  { functional: true, dispatch: false }
);
```

### Pattern 4: Reading store state with concatLatestFrom
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
import { selectProductsLoaded } from './products.selectors';

export const loadProducts = createEffect(
  (
    actions$ = inject(Actions),
    store = inject(Store),
    api = inject(ProductsApiService)
  ) =>
    actions$.pipe(
      ofType(ProductsPageActions.opened),
      concatLatestFrom(() => store.select(selectProductsLoaded)),
      filter(([, loaded]) => !loaded),
      switchMap(() =>
        api.getAll().pipe(
          map(products => ProductsApiActions.loadProductsSuccess({ products })),
          catchError(error =>
            of(ProductsApiActions.loadProductsFailure({ error: error.message }))
          )
        )
      )
    ),
  { functional: true }
);
```

### Pattern 5: OnInitEffects lifecycle hook
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

### Pattern 6: Navigation effects with Router
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

### Pattern 7: Error action pattern
```typescript
// src/app/products/state/products.actions.ts
import { createActionGroup, emptyProps, props } from '@ngrx/store';
import { Product } from '../products.model';

export const ProductsPageActions = createActionGroup({
  source: 'Products Page',
  events: {
    'Opened': emptyProps(),
    'Search Changed': props<{ query: string }>(),
    'Product Selected': props<{ productId: string }>(),
  },
});

export const ProductsApiActions = createActionGroup({
  source: 'Products API',
  events: {
    'Load Products Success': props<{ products: Product[] }>(),
    'Load Products Failure': props<{ error: string }>(),
    'Search Success': props<{ results: Product[] }>(),
    'Search Failure': props<{ error: string }>(),
  },
});
```

### Pattern 8: Registering effects in standalone app
```typescript
// src/app/app.config.ts
import { ApplicationConfig } from '@angular/core';
import { provideStore } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import * as productEffects from './products/state/products.effects';
import * as authEffects from './auth/state/auth.effects';

export const appConfig: ApplicationConfig = {
  providers: [
    provideStore(),
    provideEffects(productEffects, authEffects),
  ],
};
```

For lazy-loaded feature routes:
```typescript
// src/app/products/products.routes.ts
import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { productsFeature } from './state/products.feature';
import * as productEffects from './state/products.effects';

export const PRODUCTS_ROUTES: Routes = [
  {
    path: '',
    providers: [
      provideState(productsFeature),
      provideEffects(productEffects),
    ],
    children: [
      { path: '', loadComponent: () => import('./products-list.component').then(m => m.ProductsListComponent) },
    ],
  },
];
```

### Pattern 9: Showing notifications from effects
```typescript
// src/app/shared/state/notification.effects.ts
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { tap } from 'rxjs/operators';
import { NotificationService } from '../notification.service';
import { ProductsApiActions } from '../../products/state/products.actions';

export const showSaveSuccess = createEffect(
  (actions$ = inject(Actions), notifications = inject(NotificationService)) =>
    actions$.pipe(
      ofType(ProductsApiActions.loadProductsSuccess),
      tap(() => notifications.show('Products loaded successfully'))
    ),
  { functional: true, dispatch: false }
);
```

### Pattern 10: Debounced search effect
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

## Breaking Changes and Gotchas

- **No major breaking changes to `@ngrx/effects` in v21.** The `createEffect` API is stable and unchanged.
- **Effects error handler config key renamed in v21.** NgRx provides automated migration schematics for this rename. Run `ng update @ngrx/effects` to apply.
- **`concatLatestFrom` moved to `@ngrx/operators`** (since v15). Import from `@ngrx/operators`, not `@ngrx/effects`. The old import path still works but is deprecated.
- **`@Effect()` decorator removed.** The decorator-based approach was deprecated in v11 and removed. Use `createEffect()` exclusively.
- **`catchError` placement is critical.** Placing `catchError` at the effect stream level (outside the flattening operator) completes the entire effect. All subsequent actions of that type will be silently ignored. Always place `catchError` inside the inner observable.
- **`switchMap` cancels in-flight requests.** HTTP cancellation is client-side only. The server still processes the request. Never use `switchMap` for mutating operations (POST, PUT, DELETE).
- **`withLatestFrom` evaluates eagerly.** It subscribes to the store selector immediately at effect instantiation. Use `concatLatestFrom` for lazy evaluation.
- **Functional effects must be registered as namespace imports.** Use `import * as effects from './effects'` and pass the namespace to `provideEffects(effects)`. Individual exports will not be auto-detected.
- **Effects run outside Angular's injection context after initialization.** You cannot call `inject()` inside the observable pipeline. All dependencies must be injected via default parameter values in functional effects.
- **Resubscription on error:** By default, NgRx resubscribes to a completed effect stream. However, relying on this masks bugs. Always handle errors explicitly.

## Common Mistakes

1. **catchError at the wrong level:** Placing `catchError` on the outer observable instead of the inner observable kills the effect permanently.
2. **Using switchMap for writes:** `switchMap` cancels previous requests. For POST/PUT/DELETE, use `concatMap` or `exhaustMap`.
3. **Dispatching actions from effects that trigger the same effect:** Creates infinite loops. Guard with `filter()` or use distinct action types.
4. **Effects doing too much:** An effect that calls an API, transforms data, updates localStorage, shows a notification, and navigates should be split into multiple focused effects.
5. **Not debouncing search/typeahead effects:** Fires an HTTP request per keystroke without `debounceTime`.
6. **Using `withLatestFrom` instead of `concatLatestFrom`:** `withLatestFrom` eagerly subscribes to selectors. Use `concatLatestFrom` for lazy evaluation.
7. **Forgetting `dispatch: false` on navigation effects:** Without it, NgRx expects the effect to return an action. The router navigation result becomes an invalid action, causing runtime errors.

## Sources

### Official Documentation
- NgRx Effects Guide: https://ngrx.io/guide/effects
- NgRx Effects API: https://ngrx.io/api/effects
- NgRx createEffect API: https://ngrx.io/api/effects/createEffect
- NgRx provideEffects API: https://ngrx.io/api/effects/provideEffects
- NgRx concatLatestFrom: https://ngrx.io/api/operators/concatLatestFrom
- NgRx Effects Lifecycle: https://ngrx.io/guide/effects/lifecycle
- NgRx Effects Testing: https://ngrx.io/guide/effects/testing
- NgRx Operators Guide: https://ngrx.io/guide/operators/operators
- NgRx Router Store Actions: https://ngrx.io/guide/router-store/actions
- NgRx v21 Migration Guide: https://ngrx.io/guide/migration/v21

### Blog Posts and Articles
- Angular Architects: When (Not) to use Effects: https://www.angulararchitects.io/blog/when-not-to-use-effects-in-angular-and-what-to-do-instead/
- Tim Deschryver: Common NgRx Mistakes: https://timdeschryver.dev/blog/common-and-easy-to-make-mistakes-when-youre-new-to-ngrx
- Christian Ludemann: Top 5 NgRx Mistakes: https://christianlydemann.com/top-5-ngrx-mistakes/
- RxJS Higher-Order Mapping: https://blog.angular-university.io/rxjs-higher-order-mapping/
- BrieBug: A Place for Every Mapper: https://blog.briebug.com/blog/a-place-for-every-mapper
- CRUD Operations with NgRx Operators: https://www.danywalls.com/when-to-use-concatmap-mergemap-switchmap-and-exhaustmap-operators-in-building-a-crud-with-ngrx
- Understanding NgRx Effects Internals: https://angular.love/understanding-the-magic-behind-ngrx-effects/
- NgRx Bad Practices: https://angular.love/ngrx-bad-practices/
- concatLatestFrom Edge Case: https://medium.com/javascript-everyday/concatlatestfrom-operator-edge-case-617bd9e7f88a
- HeroDevs: Testing Effects with Async/Await: https://www.herodevs.com/blog-posts/testing-ngrx-effects-with-async-await
- Testing Five Common Effect Patterns: https://dev.to/jdpearce/how-to-test-five-common-ngrx-effect-patterns-26cb

### GitHub
- NgRx Platform Repository: https://github.com/ngrx/platform
- NgRx CHANGELOG: https://github.com/ngrx/platform/blob/main/CHANGELOG.md
- NgRx v21 Announcement: https://dev.to/ngrx/announcing-ngrx-21-celebrating-a-10-year-journey-with-a-fresh-new-look-and-ngrxsignalsevents-5ekp

### Community Resources
- Nx Blog: Angular State Management 2025: https://nx.dev/blog/angular-state-management-2025
- NgRx Essentials Course (Effects chapter): https://this-is-angular.github.io/ngrx-essentials-course/docs/chapter-11/

## Open Questions

1. **`concatLatestFrom` import path in v21:** Verify whether `@ngrx/operators` is the canonical import in v21.1.0, or if it has been moved back to `@ngrx/effects`. Check `node_modules/@ngrx/operators/index.d.ts`.
2. **Functional effects namespace registration:** Confirm that `provideEffects(effects)` with a namespace import (`import * as effects`) correctly registers all exported `createEffect` instances in v21. Some community reports suggest individual registration may be needed.
3. **Effects error handler config key rename:** Identify the exact property name change in v21 and whether the migration schematic handles it automatically.
4. **`OnRunEffects` with functional effects:** Verify whether `OnRunEffects` lifecycle hook works with functional effects or only with class-based effects. The interface suggests class-based only.
5. **Router Store action types in v21:** Confirm the exact action type strings (ROUTER_REQUEST, ROUTER_NAVIGATION, etc.) are unchanged in `@ngrx/router-store@21.1.0`.
