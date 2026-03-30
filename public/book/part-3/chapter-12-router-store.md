# Chapter 12: Router Store

A customer shares a link to your product catalog: `/products?category=electronics&sort=price&page=3`. The recipient opens it and sees... page one, all categories, sorted by name. Every filter the sender applied is lost because the application treats the URL as a navigation target but not as a source of truth. Filters live in component state, sorting lives in a BehaviorSubject, and pagination lives in a local variable. The URL and the application state are two separate worlds. `@ngrx/router-store` connects them. It pushes every navigation event into the Store as an action, serializes the current route into the state tree, and provides selectors that let you read route params, query params, and URL fragments the same way you read any other piece of state. When the URL drives the state and the state drives the view, links become shareable, the back button works, and DevTools can time-travel through navigation history.

## A Quick Recap

In Chapters 8 through 11, we built a product catalog with `createActionGroup`, `createReducer`, `createFeature`, memoized selectors, functional effects, and `@ngrx/entity` for normalized collections. Our `Product` model has `id`, `name`, `price`, `category`, `description`, and `featured` properties. Effects handle API calls and dispatch success or failure actions. The Store holds the products in an `EntityState`, and selectors derive filtered views for the component. This chapter adds the Angular Router to the Store, turning the URL into a first-class piece of application state.

## Why the URL Belongs in the Store

The URL is state. It contains parameters that describe what resource the user is viewing (`/products/:productId`), how they want to view it (`?sort=price&page=3`), and sometimes which section they scrolled to (`#reviews`). When this state lives outside the Store, three problems emerge.

**You cannot compose route data with application data.** Selecting the current product requires the route's `productId` param and the entity dictionary from the Store. Without router state in the Store, the component must inject both `ActivatedRoute` and `Store`, subscribe to both, and manually combine them. With `@ngrx/router-store`, you write a single selector that joins the two.

**Effects cannot react to navigation.** When the user navigates to `/products/42`, an effect should fetch product 42 from the API. Without router state in the action stream, you must wire up the fetch manually in the component or subscribe to `ActivatedRoute` inside the effect, which is awkward and untestable.

**DevTools cannot replay navigation.** NgRx DevTools record every action. With `@ngrx/router-store`, navigations become actions in the timeline. You can step backward through route changes, inspect the serialized URL at each point, and see exactly what the user saw.

## The Router Action Lifecycle

When Angular's Router completes a navigation, `@ngrx/router-store` dispatches a sequence of actions into the Store:

```
User clicks link or calls router.navigate()
       │
       ▼
ROUTER_REQUEST ── navigation initiated
       │
       ▼
ROUTER_NAVIGATION ── before guards/resolvers (default timing)
       │
       ├──(guards reject)──> ROUTER_CANCEL (includes pre-navigation state)
       │
       ├──(error thrown)───> ROUTER_ERROR (includes pre-navigation state)
       │
       └──(success)────────> ROUTER_NAVIGATED ── navigation complete
```

The `routerReducer` handles `ROUTER_NAVIGATION`, `ROUTER_ERROR`, and `ROUTER_CANCEL`. It updates the router slice with the serialized route state and the current `navigationId`. It does not handle `ROUTER_REQUEST` or `ROUTER_NAVIGATED` by default, but you can listen for them in effects.

Each action creator is importable:

```typescript
// Available action creators from @ngrx/router-store
import {
  routerRequestAction,
  routerNavigationAction,
  routerNavigatedAction,
  routerCancelAction,
  routerErrorAction,
} from '@ngrx/router-store';
```

## Setting Up @ngrx/router-store

Install the package alongside the existing NgRx dependencies:

```bash
npm install @ngrx/router-store
```

Register the router reducer and the router store provider in the application bootstrap:

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

Three things are happening here. First, `routerReducer` is registered under the `router` key in the root state. Second, `provideRouterStore()` connects the Angular Router to the Store so that every navigation dispatches actions. Third, DevTools will now show `@ngrx/router-store/navigation` actions in the timeline alongside your application actions.

The routes themselves are standard Angular routes. For the product catalog:

```typescript
// src/app/app.routes.ts
import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'products', pathMatch: 'full' },
  {
    path: 'products',
    loadComponent: () =>
      import('./products/product-list.component').then(
        (m) => m.ProductListComponent
      ),
    title: 'Product Catalog',
  },
  {
    path: 'products/:productId',
    loadComponent: () =>
      import('./products/product-detail.component').then(
        (m) => m.ProductDetailComponent
      ),
    title: 'Product Detail',
  },
];
```

## The Router State Serializer

By default, `provideRouterStore()` uses the `MinimalRouterStateSerializer`. This serializer extracts a small, serializable object from the full `RouterStateSnapshot`:

```typescript
// What the MinimalRouterStateSerializer produces
{
  url: '/products/42?sort=price',
  params: { productId: '42' },
  queryParams: { sort: 'price' },
  data: { title: 'Product Detail' },
  fragment: null,
  title: 'Product Detail'
}
```

The minimal serializer is the right choice for most applications. It is serializable (safe for DevTools and SSR hydration), compact, and provides the data you actually need. The alternative is `RouterState.Full`, which stores the entire `ActivatedRouteSnapshot` tree. That tree contains circular references and non-serializable objects, which breaks DevTools and state transfer. Avoid it unless you have a very specific reason.

## Router Selectors

`@ngrx/router-store` provides `getRouterSelectors()`, a function that returns a set of pre-built selectors for reading route data from the Store. Call it once and destructure the selectors you need:

```typescript
// src/app/products/state/product-router.selectors.ts
import { getRouterSelectors } from '@ngrx/router-store';

export const {
  selectRouteParam,
  selectRouteParams,
  selectQueryParam,
  selectQueryParams,
  selectRouteData,
  selectUrl,
  selectTitle,
  selectFragment,
} = getRouterSelectors();
```

Each selector reads from the `router` slice of the root state. Because they are standard NgRx selectors, they compose with `createSelector` exactly like the selectors from Chapters 9 and 11.

### Reading a Route Parameter

The most common use case is reading a route param to look up an entity:

```typescript
// src/app/products/state/product.selectors.ts
import { createSelector } from '@ngrx/store';
import { getRouterSelectors } from '@ngrx/router-store';
import { productsFeature } from './products.feature';

const { selectRouteParam } = getRouterSelectors();

export const selectCurrentProductId = selectRouteParam('productId');

export const selectCurrentProduct = createSelector(
  productsFeature.selectEntities,
  selectCurrentProductId,
  (entities, productId) =>
    productId ? (entities[productId] ?? null) : null
);
```

This selector composes the entity dictionary from `@ngrx/entity` (Chapter 11) with the `productId` route parameter. When the user navigates to `/products/42`, the selector returns the product with ID `'42'`. No `ActivatedRoute` injection, no subscription, no manual combination. One selector, one signal read in the component.

### Reading Query Parameters

For the product list with URL-driven filtering:

```typescript
// src/app/products/state/product-list.selectors.ts
import { createSelector } from '@ngrx/store';
import { getRouterSelectors } from '@ngrx/router-store';
import { productsFeature } from './products.feature';

const { selectQueryParam, selectQueryParams } = getRouterSelectors();

export const selectSortField = createSelector(
  selectQueryParam('sort'),
  (sort) => sort ?? 'name'
);

export const selectCurrentPage = createSelector(
  selectQueryParam('page'),
  (page) => (page ? Number(page) : 1)
);

export const selectCategoryFilter = selectQueryParam('category');

export const selectFilteredProducts = createSelector(
  productsFeature.selectAll,
  selectCategoryFilter,
  (products, category) =>
    category
      ? products.filter((p) => p.category === category)
      : products
);

export const selectSortedProducts = createSelector(
  selectFilteredProducts,
  selectSortField,
  (products, sortField) => {
    const sorted = [...products];
    switch (sortField) {
      case 'price':
        return sorted.sort((a, b) => a.price - b.price);
      case 'name':
      default:
        return sorted.sort((a, b) => a.name.localeCompare(b.name));
    }
  }
);

const PAGE_SIZE = 20;

export const selectPaginatedProducts = createSelector(
  selectSortedProducts,
  selectCurrentPage,
  (products, page) => {
    const start = (page - 1) * PAGE_SIZE;
    return products.slice(start, start + PAGE_SIZE);
  }
);

export const selectProductListViewModel = createSelector(
  selectPaginatedProducts,
  selectSortField,
  selectCurrentPage,
  selectCategoryFilter,
  productsFeature.selectLoading,
  productsFeature.selectError,
  (products, sort, page, category, loading, error) => ({
    products,
    sort,
    page,
    category,
    loading,
    error,
    totalPages: Math.ceil(products.length / PAGE_SIZE),
  })
);
```

Every filter, sort, and page value comes from the URL. The selectors extract them, apply defaults (page 1, sort by name), parse types (string to number for page), and compose them into a view model. When the user changes any parameter in the URL, the selectors recompute and the component updates.

## Building the Product List Component

The component reads the view model from the Store and updates the URL when the user interacts with filters:

```typescript
// src/app/products/product-list.component.ts
import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { CurrencyPipe } from '@angular/common';
import { selectProductListViewModel } from './state/product-list.selectors';

@Component({
  selector: 'app-product-list',
  standalone: true,
  imports: [CurrencyPipe],
  template: `
    @if (vm().loading) {
      <div class="loading-spinner">Loading products...</div>
    } @else if (vm().error) {
      <div class="error-message">{{ vm().error }}</div>
    } @else {
      <div class="toolbar">
        <label>
          Category:
          <select
            [value]="vm().category ?? ''"
            (change)="onCategoryChange($event)"
          >
            <option value="">All</option>
            <option value="electronics">Electronics</option>
            <option value="tools">Tools</option>
            <option value="clothing">Clothing</option>
          </select>
        </label>
        <label>
          Sort by:
          <select [value]="vm().sort" (change)="onSortChange($event)">
            <option value="name">Name</option>
            <option value="price">Price</option>
          </select>
        </label>
      </div>
      <ul class="product-list">
        @for (product of vm().products; track product.id) {
          <li>
            <a [routerLink]="['/products', product.id]">
              {{ product.name }}
            </a>
            &mdash; {{ product.price | currency }}
          </li>
        } @empty {
          <li>No products match the current filters.</li>
        }
      </ul>
      <div class="pagination">
        <button
          [disabled]="vm().page <= 1"
          (click)="onPageChange(vm().page - 1)"
        >
          Previous
        </button>
        <span>Page {{ vm().page }}</span>
        <button (click)="onPageChange(vm().page + 1)">Next</button>
      </div>
    }
  `,
})
export class ProductListComponent {
  private readonly store = inject(Store);
  private readonly router = inject(Router);

  protected readonly vm = this.store.selectSignal(
    selectProductListViewModel
  );

  onCategoryChange(event: Event): void {
    const category = (event.target as HTMLSelectElement).value || null;
    this.router.navigate([], {
      queryParams: { category, page: 1 },
      queryParamsHandling: 'merge',
    });
  }

  onSortChange(event: Event): void {
    const sort = (event.target as HTMLSelectElement).value;
    this.router.navigate([], {
      queryParams: { sort },
      queryParamsHandling: 'merge',
    });
  }

  onPageChange(page: number): void {
    this.router.navigate([], {
      queryParams: { page },
      queryParamsHandling: 'merge',
    });
  }
}
```

Notice the pattern. The component never sets local state for filters, sort, or page. Every user interaction calls `router.navigate()` with `queryParamsHandling: 'merge'` to update only the relevant query parameter while preserving the others. The URL changes, `@ngrx/router-store` dispatches `ROUTER_NAVIGATED`, the router slice updates, the selectors recompute, and the signal pushes the new view model to the template. The cycle is: **URL changes state, state drives view, view changes URL**.

## The Product Detail Component

The detail component reads the `productId` route param through a composed selector:

```typescript
// src/app/products/product-detail.component.ts
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { CurrencyPipe } from '@angular/common';
import { selectCurrentProduct } from './state/product.selectors';

@Component({
  selector: 'app-product-detail',
  standalone: true,
  imports: [RouterLink, CurrencyPipe],
  template: `
    @if (product(); as product) {
      <h2>{{ product.name }}</h2>
      <p class="price">{{ product.price | currency }}</p>
      <p class="category">Category: {{ product.category }}</p>
      <p class="description">{{ product.description }}</p>
      <a routerLink="/products">Back to catalog</a>
    } @else {
      <p>Product not found.</p>
      <a routerLink="/products">Back to catalog</a>
    }
  `,
})
export class ProductDetailComponent {
  private readonly store = inject(Store);
  readonly product = this.store.selectSignal(selectCurrentProduct);
}
```

The component does not inject `ActivatedRoute`. It does not subscribe to `paramMap`. It reads one signal, and that signal composes entity state with router state inside the selector.

## Effects That React to Navigation

When the user navigates to `/products/42`, the product may not be in the Store yet. An effect can listen for navigation actions and trigger an API call:

```typescript
// src/app/products/state/product-navigation.effects.ts
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { routerNavigatedAction } from '@ngrx/router-store';
import { Store } from '@ngrx/store';
import { filter, map, switchMap, withLatestFrom } from 'rxjs';
import { ProductsApiService } from '../products-api.service';
import { ProductsApiActions } from './products.actions';
import { productsFeature } from './products.feature';

export const loadProductOnNavigation = createEffect(
  (
    actions$ = inject(Actions),
    store = inject(Store),
    api = inject(ProductsApiService)
  ) =>
    actions$.pipe(
      ofType(routerNavigatedAction),
      map(({ payload }) => {
        const url = payload.routerState.url;
        const match = url.match(/^\/products\/([^?#]+)/);
        return match ? match[1] : null;
      }),
      filter((productId): productId is string => productId !== null),
      withLatestFrom(store.select(productsFeature.selectEntities)),
      filter(([productId, entities]) => !entities[productId]),
      switchMap(([productId]) =>
        api.getProduct(productId).pipe(
          map((product) =>
            ProductsApiActions.productLoadedSuccessfully({ product })
          )
        )
      )
    ),
  { functional: true }
);
```

This effect uses `routerNavigatedAction` (not `routerNavigationAction`) because we want to react after the navigation completes and all guards and resolvers have run. It extracts the product ID from the URL, checks if the product already exists in the entity dictionary, and fetches only when it is missing. This avoids redundant API calls when the user navigates back to a product they already viewed.

## Custom Router State Serializer

The default `MinimalRouterStateSerializer` reads params from the leaf route segment only. If your routes are nested like `/categories/:categoryId/products/:productId`, the default serializer gives you `{ productId: '42' }` but not `{ categoryId: 'electronics' }`. A custom serializer can walk the route tree and merge all params:

```typescript
// src/app/state/custom-router-serializer.ts
import { RouterStateSerializer } from '@ngrx/router-store';
import { RouterStateSnapshot, Params } from '@angular/router';

export interface MergedRouterState {
  url: string;
  params: Params;
  queryParams: Params;
  data: Record<string, unknown>;
  fragment: string | null;
  title: string | undefined;
}

export class MergedRouterSerializer
  implements RouterStateSerializer<MergedRouterState>
{
  serialize(routerState: RouterStateSnapshot): MergedRouterState {
    let route = routerState.root;
    let params: Params = {};
    let data: Record<string, unknown> = {};

    while (route.firstChild) {
      route = route.firstChild;
      params = { ...params, ...route.params };
      data = { ...data, ...(route.data as Record<string, unknown>) };
    }

    return {
      url: routerState.url,
      params,
      queryParams: route.queryParams,
      data,
      fragment: route.fragment,
      title: route.title,
    };
  }
}
```

Register it in the provider:

```typescript
// src/main.ts
import { MergedRouterSerializer } from './app/state/custom-router-serializer';

provideRouterStore({ serializer: MergedRouterSerializer })
```

Now `selectRouteParams` returns merged params from every segment in the route tree. Both `categoryId` and `productId` are available in one object.

## Configuration Options

`provideRouterStore()` accepts a configuration object with several options:

```typescript
// src/main.ts
import { NavigationActionTiming } from '@ngrx/router-store';

provideRouterStore({
  stateKey: 'router',
  serializer: MergedRouterSerializer,
  navigationActionTiming: NavigationActionTiming.PostActivation,
})
```

**`stateKey`** controls which key in the root state holds the router slice. The default is `'router'`. If you change this, pass a `selectState` function to `getRouterSelectors()` so the selectors know where to look.

**`navigationActionTiming`** controls when `ROUTER_NAVIGATION` is dispatched. `PreActivation` (the default) dispatches before guards and resolvers run. `PostActivation` dispatches after they complete. Use `PostActivation` when your effects depend on resolved data being available in the route. The trade-off is that `PostActivation` delays the action, so guard rejections are not visible in the action stream until later.

## Angular 21 Alternatives: withComponentInputBinding

Angular 21 provides `withComponentInputBinding()`, which binds route params, query params, static data, and resolver data directly to component `input()` signals:

```typescript
// src/main.ts
provideRouter(routes, withComponentInputBinding())
```

```typescript
// src/app/products/product-detail-simple.component.ts
import { Component, input } from '@angular/core';

@Component({
  selector: 'app-product-detail-simple',
  standalone: true,
  template: `
    <h2>Product {{ productId() }}</h2>
  `,
})
export class ProductDetailSimpleComponent {
  readonly productId = input<string>();
}
```

When the route is `/products/:productId`, Angular automatically binds the `productId` param to the `productId` input signal. No `ActivatedRoute`, no Store, no selectors.

When should you use `withComponentInputBinding` instead of `@ngrx/router-store`? The two are not mutually exclusive. Use them together when it makes sense:

| Criterion | withComponentInputBinding | @ngrx/router-store |
|---|---|---|
| Scope | Component-level only | Global (effects, services, any selector) |
| DevTools visibility | No router state in DevTools | Full router state in action timeline |
| Cross-cutting concerns | Cannot trigger effects from route changes | Effects react to navigation actions |
| Composability | Limited to the routed component | Compose with any Store selector |
| Setup cost | One line | routerReducer + provideRouterStore |
| Testing | Set inputs directly | MockStore with selector overrides |

For simple components that just need one or two route params, `withComponentInputBinding` is the lighter choice. For applications where navigation drives data loading, where selectors compose route data with application data, or where DevTools replay of navigation is valuable, `@ngrx/router-store` is the right tool.

## Common Mistakes

### Mistake 1: Using selectRouteParams with Nested Routes

```typescript
// WRONG: only reads the leaf route's params
const { selectRouteParams } = getRouterSelectors();

export const selectCategoryId = createSelector(
  selectRouteParams,
  (params) => params['categoryId']  // undefined for /categories/:categoryId/products/:productId
);
```

The default `MinimalRouterStateSerializer` only serializes the deepest activated route. For the URL `/categories/electronics/products/42`, `selectRouteParams` returns `{ productId: '42' }`. The parent `categoryId` is invisible.

```typescript
// CORRECT: use a custom serializer that merges params from all route segments
// (see MergedRouterSerializer above)
// Then selectRouteParams returns { categoryId: 'electronics', productId: '42' }
export const selectCategoryId = createSelector(
  selectRouteParams,
  (params) => params['categoryId']  // 'electronics'
);
```

### Mistake 2: Losing Query Params on Navigation

```typescript
// WRONG: replaces all query params, dropping existing ones
onSortChange(sort: string): void {
  this.router.navigate([], {
    queryParams: { sort },
  });
}
// URL was: /products?category=electronics&sort=name&page=2
// URL becomes: /products?sort=price  (category and page are lost)
```

The default `queryParamsHandling` is `'replace'`, which discards every query param not in the new object.

```typescript
// CORRECT: merge preserves existing params
onSortChange(sort: string): void {
  this.router.navigate([], {
    queryParams: { sort },
    queryParamsHandling: 'merge',
  });
}
// URL was: /products?category=electronics&sort=name&page=2
// URL becomes: /products?category=electronics&sort=price&page=2
```

Always use `queryParamsHandling: 'merge'` when updating a single query parameter in a multi-param URL.

### Mistake 3: Treating Query Params as Numbers

```typescript
// WRONG: query params are always strings
export const selectCurrentPage = createSelector(
  selectQueryParam('page'),
  (page) => page ?? 1  // page is '2' (string), not 2 (number)
);

// Later: page + 1 produces '21' instead of 3
```

Every route param and query param arrives as a `string | undefined`. There is no automatic type coercion.

```typescript
// CORRECT: parse explicitly
export const selectCurrentPage = createSelector(
  selectQueryParam('page'),
  (page) => {
    const parsed = Number(page);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }
);
```

### Mistake 4: Using routerNavigationAction When You Need Resolved Data

```typescript
// WRONG: fires before guards and resolvers complete
export const loadOnNav = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(routerNavigationAction),
      // route data from resolvers may not be populated yet
      map(({ payload }) => payload.routerState.data['resolvedProduct']),
      filter((product) => !!product),
      map((product) => SomeAction({ product }))
    ),
  { functional: true }
);
```

With the default `NavigationActionTiming.PreActivation`, `ROUTER_NAVIGATION` fires before resolvers run. The `data` property will not contain resolved values.

```typescript
// CORRECT: use routerNavigatedAction (fires after navigation completes)
export const loadOnNav = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(routerNavigatedAction),
      map(({ payload }) => payload.routerState.data['resolvedProduct']),
      filter((product) => !!product),
      map((product) => SomeAction({ product }))
    ),
  { functional: true }
);
```

Or configure `PostActivation` timing globally if all your effects need resolved data:

```typescript
provideRouterStore({
  navigationActionTiming: NavigationActionTiming.PostActivation,
})
```

## Key Takeaways

- **The URL is state.** Treat route params, query params, and fragments as the single source of truth for navigation-related data. Drive filters, sorting, and pagination from the URL so that links are shareable and the back button works.

- **`getRouterSelectors()` gives you composable selectors for every part of the route.** Use `selectRouteParam('id')` and `selectQueryParam('sort')` in `createSelector` to join route data with application state in one memoized pipeline.

- **Use `routerNavigatedAction` in effects to react to completed navigations.** Prefer it over `routerNavigationAction` unless you specifically need to act before guards resolve. Check the Store before fetching to avoid redundant API calls.

- **The default serializer reads the leaf route only.** If your app uses nested routes, write a custom serializer that merges params from every segment in the route tree.

- **`withComponentInputBinding` and `@ngrx/router-store` are complementary.** Use input binding for simple param reads in routed components. Use router store when you need global access, effect triggers, DevTools replay, or selector composition with application state.
