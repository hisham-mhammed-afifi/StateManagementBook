# Research: Router Store (URL as State)

**Date:** 2026-03-30
**Chapter:** Ch 12
**Status:** Ready for chapter generation

## API Surface

### @ngrx/router-store (v21.1.0, all Stable)

| API | Import | Signature | Status |
|-----|--------|-----------|--------|
| `provideRouterStore` | `@ngrx/router-store` | `provideRouterStore<T>(config?: StoreRouterConfig<T>): EnvironmentProviders` | Stable |
| `routerReducer` | `@ngrx/router-store` | `routerReducer(state, action): RouterReducerState` | Stable |
| `getRouterSelectors` | `@ngrx/router-store` | `getRouterSelectors<V>(selectState?): RouterStateSelectors<V>` | Stable |
| `routerRequestAction` | `@ngrx/router-store` | Action creator, type `@ngrx/router-store/request` | Stable |
| `routerNavigationAction` | `@ngrx/router-store` | Action creator, type `@ngrx/router-store/navigation` | Stable |
| `routerNavigatedAction` | `@ngrx/router-store` | Action creator, type `@ngrx/router-store/navigated` | Stable |
| `routerCancelAction` | `@ngrx/router-store` | Action creator, type `@ngrx/router-store/cancel` | Stable |
| `routerErrorAction` | `@ngrx/router-store` | Action creator, type `@ngrx/router-store/error` | Stable |
| `MinimalRouterStateSerializer` | `@ngrx/router-store` | Default serializer, extracts url/params/data/queryParams/fragment/title | Stable |
| `RouterStateSerializer` | `@ngrx/router-store` | Abstract base class for custom serializers | Stable |

### StoreRouterConfig interface

```typescript
interface StoreRouterConfig<T extends BaseRouterStoreState = SerializedRouterStateSnapshot> {
  stateKey?: StateKeyOrSelector;           // default: 'router'
  serializer?: new (...args: any[]) => RouterStateSerializer<T>;
  navigationActionTiming?: NavigationActionTiming; // default: PreActivation
  routerState?: RouterState;               // default: Minimal
}
```

### Router Selectors (from getRouterSelectors)

- `selectCurrentRoute` - the leaf ActivatedRouteSnapshot
- `selectFragment` - URL fragment
- `selectQueryParams` - all query params as object
- `selectQueryParam(param: string)` - single query param
- `selectRouteParams` - all route params (leaf route only)
- `selectRouteParam(param: string)` - single route param
- `selectRouteData` - route data object
- `selectRouteDataParam(param: string)` - single route data value
- `selectUrl` - current URL string
- `selectTitle` - route title

### Angular 21 Router APIs (relevant to chapter)

| API | Import | Signature | Status |
|-----|--------|-----------|--------|
| `withComponentInputBinding` | `@angular/router` | `withComponentInputBinding(): RouterFeature` | Stable |
| `isActive` | `@angular/router` | `isActive(url, router, matchOptions?): Signal<boolean>` | Stable (new in 21.1) |
| `Router.lastSuccessfulNavigation` | `@angular/router` | Signal property (was method, now signal in v21) | Stable |

### NavigationActionTiming enum

```typescript
enum NavigationActionTiming {
  PreActivation = 1,   // ROUTER_NAVIGATION dispatched before guards/resolvers
  PostActivation = 2   // ROUTER_NAVIGATION dispatched after guards/resolvers
}
```

### RouterState enum

```typescript
enum RouterState {
  Full = 0,    // Full ActivatedRouteSnapshot tree (NOT serializable)
  Minimal = 1  // Default. Serializable minimal state
}
```

## Key Concepts

- **URL as single source of truth**: route params, query params, and fragments should drive application state, not the other way around
- **Router actions lifecycle**: REQUEST -> NAVIGATION -> NAVIGATED (success) or CANCEL/ERROR (failure)
- **MinimalRouterStateSerializer** is the default and recommended serializer; FullRouterStateSerializer is NOT serializable (breaks DevTools/hydration)
- **getRouterSelectors()** returns composable selectors that integrate with createSelector for derived state
- **selectRouteParams reads leaf route only**: parent route params are NOT included unless a custom serializer merges them
- **NavigationActionTiming**: PreActivation (default) dispatches before guards run; PostActivation waits for guards/resolvers to complete
- **withComponentInputBinding** is the built-in Angular alternative: binds route params, query params, static data, and resolver data directly to component signal inputs
- **isActive()** signal function (Angular 21.1): reactive route-active tracking, replaces `Router.isActive()` method
- **Query params vs route params**: route params = resource identity (`/products/:id`), query params = view context (`?sort=price&page=2`)
- **Effects reacting to router actions**: use `ofType(routerNavigationAction)` to trigger side effects on navigation
- **Bidirectional URL sync**: read params on component init to restore state; update URL on user interaction (filter/sort/paginate)

## Code Patterns

### Standalone Setup

```typescript
// src/main.ts
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideStore } from '@ngrx/store';
import { provideRouterStore, routerReducer } from '@ngrx/router-store';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';

bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(routes),
    provideStore({ router: routerReducer }),
    provideRouterStore(),
    provideStoreDevtools({ maxAge: 25 }),
  ],
});
```

### Using Router Selectors

```typescript
// src/app/products/state/product.selectors.ts
import { createSelector } from '@ngrx/store';
import { getRouterSelectors } from '@ngrx/router-store';
import { selectAllProducts } from './product.reducer';

const { selectRouteParam, selectQueryParams } = getRouterSelectors();

export const selectCurrentProductId = selectRouteParam('productId');

export const selectCurrentProduct = createSelector(
  selectAllProducts,
  selectCurrentProductId,
  (products, productId) => products.find(p => p.id === productId)
);

export const selectProductFilters = selectQueryParams;

export const selectSortField = createSelector(
  selectQueryParams,
  (params) => params['sort'] ?? 'name'
);
```

### Router Selector in Component

```typescript
// src/app/products/product-detail.component.ts
import { Component, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { selectCurrentProduct } from './state/product.selectors';

@Component({
  selector: 'app-product-detail',
  template: `
    @if (product(); as product) {
      <h2>{{ product.name }}</h2>
      <p>{{ product.description }}</p>
    } @else {
      <p>Product not found.</p>
    }
  `,
})
export class ProductDetailComponent {
  private readonly store = inject(Store);
  readonly product = this.store.selectSignal(selectCurrentProduct);
}
```

### Custom Router Serializer (merging parent + child params)

```typescript
// src/app/state/custom-router-serializer.ts
import { RouterStateSerializer } from '@ngrx/router-store';
import { RouterStateSnapshot, Params } from '@angular/router';

export interface AppRouterState {
  url: string;
  params: Params;
  queryParams: Params;
  data: Record<string, unknown>;
  fragment: string | null;
}

export class AppRouterSerializer implements RouterStateSerializer<AppRouterState> {
  serialize(routerState: RouterStateSnapshot): AppRouterState {
    let route = routerState.root;
    let params: Params = {};

    while (route.firstChild) {
      route = route.firstChild;
      params = { ...params, ...route.params };
    }

    return {
      url: routerState.url,
      params,
      queryParams: route.queryParams,
      data: route.data as Record<string, unknown>,
      fragment: route.fragment,
    };
  }
}
```

### Providing Custom Serializer

```typescript
// src/main.ts
provideRouterStore({ serializer: AppRouterSerializer })
```

### Effects Reacting to Navigation

```typescript
// src/app/products/state/product.effects.ts
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { routerNavigationAction } from '@ngrx/router-store';
import { filter, map, switchMap } from 'rxjs';
import { ProductService } from '../product.service';
import { ProductActions } from './product.actions';

export const loadProductOnNavigation = createEffect(
  (actions$ = inject(Actions), productService = inject(ProductService)) =>
    actions$.pipe(
      ofType(routerNavigationAction),
      filter(({ payload }) =>
        payload.routerState.url.startsWith('/products/')
      ),
      map(({ payload }) => payload.routerState.root.params['productId']),
      filter((id): id is string => !!id),
      switchMap((id) =>
        productService.getProduct(id).pipe(
          map((product) => ProductActions.loadProductSuccess({ product }))
        )
      )
    ),
  { functional: true }
);
```

### URL-Driven Filtering with Query Params

```typescript
// src/app/products/product-list.component.ts
import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { selectSortField, selectFilteredProducts } from './state/product.selectors';

@Component({
  selector: 'app-product-list',
  template: `
    <div class="toolbar">
      <select [value]="sortField()" (change)="onSortChange($event)">
        <option value="name">Name</option>
        <option value="price">Price</option>
      </select>
    </div>
    <ul>
      @for (product of products(); track product.id) {
        <li>{{ product.name }} - {{ product.price | currency }}</li>
      }
    </ul>
  `,
})
export class ProductListComponent {
  private readonly store = inject(Store);
  private readonly router = inject(Router);

  readonly sortField = this.store.selectSignal(selectSortField);
  readonly products = this.store.selectSignal(selectFilteredProducts);

  onSortChange(event: Event): void {
    const sort = (event.target as HTMLSelectElement).value;
    this.router.navigate([], {
      queryParams: { sort },
      queryParamsHandling: 'merge',
    });
  }
}
```

### withComponentInputBinding Alternative

```typescript
// src/app/products/product-detail-simple.component.ts
import { Component, input } from '@angular/core';

@Component({
  selector: 'app-product-detail-simple',
  template: `<h2>Product {{ productId() }}</h2>`,
})
export class ProductDetailSimpleComponent {
  readonly productId = input<string>();
}
```

Setup: `provideRouter(routes, withComponentInputBinding())`

### isActive() Signal Function (Angular 21.1)

```typescript
// src/app/nav/nav-link.component.ts
import { Component, inject, input } from '@angular/core';
import { Router, isActive } from '@angular/router';

@Component({
  selector: 'app-nav-link',
  template: `
    <a [class.active]="active()">{{ label() }}</a>
  `,
})
export class NavLinkComponent {
  private readonly router = inject(Router);
  readonly url = input.required<string>();
  readonly label = input.required<string>();

  readonly active = isActive(this.url, this.router, {
    paths: 'subset',
    queryParams: 'subset',
    fragment: 'ignored',
    matrixParams: 'ignored',
  });
}
```

## Breaking Changes and Gotchas

### NgRx v21 Changes
- **No breaking changes** to @ngrx/router-store in v21. The only NgRx v21 breaking change is `withEffects` renamed to `withEventHandlers` in `@ngrx/signals/events`.
- **`getSelectors()` was removed** in a prior version; use `getRouterSelectors()` instead.
- `routerReducer` only handles `ROUTER_NAVIGATION`, `ROUTER_ERROR`, and `ROUTER_CANCEL`. It does NOT handle `ROUTER_REQUEST` or `ROUTER_NAVIGATED`.

### Angular 21 Router Changes
- `Router.isActive()` method deprecated in favor of standalone `isActive()` signal function.
- `Router.lastSuccessfulNavigation` is now a signal (was a method).
- Zoneless is default, no `provideZoneChangeDetection()` needed.

### Common Pitfalls

1. **selectRouteParams reads leaf route only**: Parent route params are excluded. If route is `/categories/:catId/products/:prodId`, only `:prodId` is available. Solution: custom serializer that merges params up the tree.

2. **All query/route params are strings**: No automatic type coercion. `route.params['page']` returns `"2"` not `2`. Must parse explicitly: `Number(params['page'])`.

3. **Objects in query params serialize to `[object Object]`**: Flatten complex objects or use `JSON.stringify`/`JSON.parse`, but prefer flat key-value pairs.

4. **Default queryParamsHandling replaces all params**: Use `queryParamsHandling: 'merge'` to preserve existing params when updating a single one.

5. **FullRouterStateSerializer is NOT serializable**: Breaks DevTools and SSR hydration. Use MinimalRouterStateSerializer (the default) or a custom one.

6. **NavigationActionTiming.PreActivation fires before guards**: Data may not be resolved yet. Use `PostActivation` if you need resolved data, but note this delays effect execution.

7. **Snapshot vs reactive approach**: Using `ActivatedRoute.snapshot.params` is stale for same-component navigations (e.g., `/products/1` to `/products/2`). Always use the observable or signal approach.

8. **withComponentInputBinding only works in routed components**: Child components don't receive bindings. Must pass via standard inputs or use ActivatedRoute.

9. **Deep link timing issue with signal inputs**: Known Angular issue where signal inputs may be `undefined` on initial page load with `withComponentInputBinding` (GitHub #60703). In-app navigation works fine.

10. **ROUTER_CANCEL includes pre-navigation state**: The `storeState` property on cancel/error payloads gives you the state before navigation started, useful for rollback patterns.

## Sources

### Official Documentation
- https://ngrx.io/guide/router-store
- https://ngrx.io/guide/router-store/selectors
- https://ngrx.io/guide/router-store/configuration
- https://ngrx.io/guide/router-store/actions
- https://angular.dev/guide/routing/read-route-state
- https://angular.dev/api/router/withComponentInputBinding
- https://angular.dev/api/router/isActive

### NgRx Source Code (v21)
- https://github.com/ngrx/platform/blob/main/modules/router-store/src/provide_router_store.ts
- https://github.com/ngrx/platform/blob/main/modules/router-store/src/router_selectors.ts
- https://github.com/ngrx/platform/blob/main/modules/router-store/src/actions.ts
- https://github.com/ngrx/platform/blob/main/modules/router-store/src/serializers/minimal_serializer.ts

### Blog Posts and Articles
- https://blog.ninja-squad.com/2025/11/20/what-is-new-angular-21.0 (Angular 21 features)
- https://blog.ninja-squad.com/2026/01/15/what-is-new-angular-21.1 (isActive signal, experimental navigation)
- https://dev.to/ngrx/announcing-ngrx-21-celebrating-a-10-year-journey-with-a-fresh-new-look-and-ngrxsignalsevents-5ekp (NgRx v21 announcement)
- https://dev.to/this-is-angular/angular-url-state-management-with-query-params-or-route-params-3mcb (URL state patterns)
- https://dev.to/abdunnahid/managing-angular-material-table-states-with-query-params-a-comprehensive-guide-1o8j (table state via query params)
- https://brianflove.com/posts/2020-06-01-route-params-ngrx-store/ (route params with NgRx)
- https://justangular.com/blog/creating-reusable-router-signals-apis/ (ngxtension signal router APIs)
- https://angularexperts.io/blog/angular-signal-inputs/ (signal inputs with routing)

### GitHub Issues
- https://github.com/angular/angular/issues/60703 (deep link signal input binding bug)
- https://github.com/angular/angular/issues/58495 (default value override with withComponentInputBinding)
- https://github.com/angular/angular/issues/59877 (feature request: signal-based ActivatedRoute)
- https://github.com/angular/angular/issues/12359 (query string values always strings)

### Community Libraries
- https://ngxtension.dev/utilities/injectors/inject-query-params/ (ngxtension injectQueryParams)
- https://ngxtension.dev/utilities/injectors/inject-params/ (ngxtension injectParams)

## Open Questions

1. **Signal-based ActivatedRoute**: Feature request exists (GitHub #59877) but not implemented as of Angular 21.2. Verify before writing whether any progress has been made.

2. **Deep link bug (#60703)**: Filed against Angular 19. Unclear if fixed in 21. Worth testing: does `withComponentInputBinding` + signal inputs work correctly on initial page load in Angular 21?

3. **isActive() exact API signature**: Verify that the first parameter accepts both string and UrlTree. Confirm match options interface shape.

4. **Router.lastSuccessfulNavigation signal**: Confirm this is available in Angular 21.0 (some sources say 21, others say it was in a later minor). Check angular.dev API docs.

5. **NavigationActionTiming default**: All documentation says PreActivation, but verify this hasn't changed in NgRx 21.

6. **Custom serializer typing with getRouterSelectors**: When using a custom serializer, the generic parameter on `getRouterSelectors<T>()` should match. Verify the type wiring works cleanly.
