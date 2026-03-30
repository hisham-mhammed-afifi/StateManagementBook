# Chapter 9: Selectors and Memoization

Your product catalog is live. The team requests a dashboard page that shows the top five products by revenue, the current cart total, a count of out-of-stock items, and a personalized greeting based on the logged-in user's name. All of this data lives in the Store across three feature slices: products, cart, and auth. You could read the raw state in the component, filter arrays, sum prices, and format strings right inside the template. But now every time any property in any slice changes, Angular re-evaluates all of that logic, even if the cart total did not change. When the product list grows to 10,000 items, the dashboard stutters. The problem is not the Store. The problem is that you are reading state without a strategy for what to compute and when to recompute. Selectors solve this. They are the read layer of NgRx: pure functions that extract, combine, and transform state, and that skip recomputation when their inputs have not changed.

## A Quick Recap

In Chapter 8, we set up the NgRx Store for our product catalog. Actions describe events (`ProductsPageActions.opened`). Reducers handle those events and return new state. `createFeature` auto-generates a selector for every top-level state property and supports `extraSelectors` for derived values. We used `store.selectSignal()` to read state as signals and `store.select()` for Observable-based reads with RxJS operators. This chapter picks up exactly where that introduction left off. We will build selectors from scratch, understand why memoization matters, compose selectors across feature boundaries, and learn when the default memoization strategy is not enough.

## What Is a Selector?

A selector is a pure function that takes the entire application state as input and returns a slice or transformation of that state. "Pure" means the function has no side effects and always returns the same output for the same input. NgRx selectors add one critical feature on top of purity: memoization. The selector remembers its last input and last output. If you call it again with the same input, it returns the cached output instantly without running the transformation logic.

Picture a selector graph for our dashboard:

```
Root State
  ├── selectProductsState ──> selectProducts ──> selectTopFiveByRevenue
  │                       ├── selectLoading
  │                       └── selectQuery ──────> selectFilteredProducts
  ├── selectCartState ────> selectCartItems ────> selectCartTotal
  └── selectAuthState ────> selectUser ─────────> selectGreeting
                                                       │
                                         selectDashboardViewModel ◄─── all three
```

Each node is a selector. Each arrow is a dependency. When a reducer updates the `cart` slice, only `selectCartItems`, `selectCartTotal`, and `selectDashboardViewModel` need to recheck their inputs. Everything in the `products` and `auth` branches is untouched. That is the power of granular composition.

## createFeatureSelector

`createFeatureSelector` creates a selector that extracts a feature slice from the root state by name. You pass the feature name string (the same name used in `createFeature` or `provideState`), and it returns a typed selector:

```typescript
// src/app/products/state/products.selectors.ts
import { createFeatureSelector } from '@ngrx/store';
import { ProductsState } from './products.reducer';

export const selectProductsState = createFeatureSelector<ProductsState>('products');
```

This selector takes the root state object and returns `state['products']` with the type `ProductsState`. If the feature has not been registered yet (for example, the lazy route has not loaded), the selector returns `undefined`. Always use the single-generic overload shown above. The two-generic overload `createFeatureSelector<AppState, ProductsState>('products')` is deprecated.

When you use `createFeature` (as we did in Chapter 8), the feature selector is generated automatically as `selectProductsState`. You do not need to call `createFeatureSelector` manually. The manual approach is useful when you want selectors in a separate file from the feature definition, or when working with a reducer registered via `provideState({ name: 'products', reducer: productsReducer })` without `createFeature`.

## createSelector: The Core API

`createSelector` accepts one to eight input selectors and a projector function. The projector receives the results of the input selectors and returns the derived value:

```typescript
// src/app/products/state/products.selectors.ts
import { createSelector } from '@ngrx/store';

export const selectProducts = createSelector(
  selectProductsState,
  state => state.products
);

export const selectLoading = createSelector(
  selectProductsState,
  state => state.loading
);

export const selectError = createSelector(
  selectProductsState,
  state => state.error
);

export const selectQuery = createSelector(
  selectProductsState,
  state => state.query
);
```

Each of these base selectors extracts one property from the feature state. They form the foundation of the selector graph. Composed selectors build on them:

```typescript
// src/app/products/state/products.selectors.ts
export const selectFilteredProducts = createSelector(
  selectProducts,
  selectQuery,
  (products, query) =>
    query
      ? products.filter(p =>
          p.name.toLowerCase().includes(query.toLowerCase())
        )
      : products
);

export const selectProductCount = createSelector(
  selectProducts,
  products => products.length
);

export const selectFilteredProductCount = createSelector(
  selectFilteredProducts,
  products => products.length
);
```

`selectFilteredProducts` depends on `selectProducts` and `selectQuery`. If a reducer changes the `loading` flag but leaves `products` and `query` untouched, `selectFilteredProducts` returns its cached result. The projector never runs. This is memoization at work.

### Dictionary-Based Selectors

When your projector function simply bundles its inputs into an object, you can use the dictionary overload to skip the projector entirely:

```typescript
// src/app/products/state/products.selectors.ts
import { createSelector } from '@ngrx/store';

export const selectProductsListViewModel = createSelector({
  products: selectFilteredProducts,
  loading: selectLoading,
  error: selectError,
  totalCount: selectProductCount,
});
```

This returns `{ products: Product[], loading: boolean, error: string | null, totalCount: number }` with the same memoization guarantees. The keys in the dictionary become the property names on the returned object. This is equivalent to writing a projector that manually constructs the object, but shorter and less error-prone.

## How Memoization Works

Every selector created by `createSelector` wraps its projector function in `defaultMemoize`. Understanding how `defaultMemoize` works will help you avoid subtle performance traps.

`defaultMemoize` maintains a last-1 cache: it stores the most recent arguments and the most recent result. On each invocation:

1. It compares each current argument against the corresponding stored argument using strict reference equality (`===`).
2. If every argument matches, it returns the stored result without calling the projector.
3. If any argument differs, it calls the projector with the new arguments, stores the new result, and returns it.

This has two important implications.

**Implication 1: Reference equality drives everything.** When a reducer returns a new state object (even if the values inside are identical), selectors that depend on that slice will recompute. That is correct behavior. Reducers should only return new objects when something actually changed, and the spread pattern (`{ ...state, loading: false }`) naturally produces new references only for properties that differ.

**Implication 2: Last-1 means no history.** If your app alternates between two different inputs (A, B, A, B), the cache misses every time because the stored arguments flip back and forth. For most UI patterns this is fine. For pathological alternation, custom memoization (covered later) can help.

Here is a concrete example. Consider `selectFilteredProducts`:

```
Dispatch: searchChanged({ query: 'widget' })
  Reducer updates query from '' to 'widget'
  selectQuery returns 'widget' (new reference: string changed)
  selectProducts returns same array reference (products did not change)
  selectFilteredProducts: query argument changed -> projector runs -> new filtered array

Dispatch: productSelected({ productId: '42' })
  Reducer updates selectedProductId from null to '42'
  selectQuery returns 'widget' (same reference)
  selectProducts returns same array reference (products did not change)
  selectFilteredProducts: all arguments match -> returns cached array (projector skipped)
```

The second dispatch changed `selectedProductId`, which is irrelevant to `selectFilteredProducts`. Because we used `selectProducts` and `selectQuery` as inputs (not the broad `selectProductsState`), the selector correctly skips recomputation.

## The View Model Pattern

Smart components often need data from multiple selectors. Instead of creating five signals in the component, create a single view model selector that returns everything the component needs:

```typescript
// src/app/products/state/products.selectors.ts
export interface ProductsPageViewModel {
  products: Product[];
  loading: boolean;
  error: string | null;
  query: string;
  totalCount: number;
  filteredCount: number;
}

export const selectProductsPageViewModel = createSelector(
  selectFilteredProducts,
  selectLoading,
  selectError,
  selectQuery,
  selectProductCount,
  selectFilteredProductCount,
  (products, loading, error, query, totalCount, filteredCount): ProductsPageViewModel => ({
    products,
    loading,
    error,
    query,
    totalCount,
    filteredCount,
  })
);
```

The component consumes it as a single signal:

```typescript
// src/app/products/products-page.component.ts
import { Component, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { selectProductsPageViewModel } from './state/products.selectors';
import { ProductsPageActions } from './state/products.actions';
import { ProductCardComponent } from './product-card.component';

@Component({
  selector: 'app-products-page',
  imports: [ProductCardComponent],
  template: `
    <h1>Products</h1>
    <input
      type="text"
      placeholder="Search products..."
      [value]="vm().query"
      (input)="onSearch($event)" />

    @if (vm().loading) {
      <div class="spinner">Loading...</div>
    } @else if (vm().error; as err) {
      <div class="error-banner">{{ err }}</div>
    } @else {
      <p>Showing {{ vm().filteredCount }} of {{ vm().totalCount }} products</p>
      @for (product of vm().products; track product.id) {
        <app-product-card
          [product]="product"
          (selected)="onSelect(product.id)" />
      } @empty {
        <p>No products match your search.</p>
      }
    }
  `,
})
export class ProductsPageComponent {
  private readonly store = inject(Store);
  readonly vm = this.store.selectSignal(selectProductsPageViewModel);

  onSelect(productId: string): void {
    this.store.dispatch(ProductsPageActions.productSelected({ productId }));
  }

  onSearch(event: Event): void {
    const query = (event.target as HTMLInputElement).value;
    this.store.dispatch(ProductsPageActions.searchChanged({ query }));
  }
}
```

One signal. One call in the template per property. No separate loading/error/data observables to synchronize. The view model selector recomputes only when at least one of its six inputs changes by reference.

## Factory Selectors: Parameterized Queries

Sometimes you need a selector that depends on a runtime parameter, like a product ID from a route. The deprecated approach used selector props. The modern approach is a factory function that returns a selector:

```typescript
// src/app/products/state/products.selectors.ts
export const selectProductById = (productId: string) =>
  createSelector(
    selectProducts,
    products => products.find(p => p.id === productId) ?? null
  );
```

Use it in a component:

```typescript
// src/app/products/product-detail.component.ts
import { Component, inject, input } from '@angular/core';
import { Store } from '@ngrx/store';
import { selectProductById } from './state/products.selectors';
import { CurrencyPipe } from '@angular/common';

@Component({
  selector: 'app-product-detail',
  imports: [CurrencyPipe],
  template: `
    @if (product(); as p) {
      <h2>{{ p.name }}</h2>
      <p>{{ p.description }}</p>
      <p class="price">{{ p.price | currency }}</p>
      <p class="category">{{ p.category }}</p>
    } @else {
      <p>Product not found.</p>
    }
  `,
})
export class ProductDetailComponent {
  private readonly store = inject(Store);
  readonly productId = input.required<string>();
  readonly product = this.store.selectSignal(selectProductById(this.productId()));
}
```

There is a catch. Every call to `selectProductById('42')` creates a new selector instance with its own memoization cache. If this factory is called in a loop or from multiple components with the same ID, each instance maintains its own cache independently. For most applications, this is fine. If profiling reveals a performance issue, cache the selector instances:

```typescript
// src/app/products/state/products.selectors.ts
const productByIdCache = new Map<string, ReturnType<typeof createSelector>>();

export const selectProductById = (productId: string) => {
  if (!productByIdCache.has(productId)) {
    productByIdCache.set(
      productId,
      createSelector(
        selectProducts,
        products => products.find(p => p.id === productId) ?? null
      )
    );
  }
  return productByIdCache.get(productId)!;
};
```

Now `selectProductById('42')` returns the same selector instance on every call, sharing the memoization cache. Be mindful of memory: if product IDs are unbounded, this cache grows indefinitely. Use an LRU strategy or clear the cache when the feature unloads.

## Cross-Feature Selectors

Real applications combine state from multiple feature slices. Our dashboard needs products, cart items, and the authenticated user. Define selectors for each feature first, then compose them in a shared location:

```typescript
// src/app/cart/state/cart.selectors.ts
import { createFeatureSelector, createSelector } from '@ngrx/store';
import { CartState } from './cart.reducer';

export const selectCartState = createFeatureSelector<CartState>('cart');

export const selectCartItems = createSelector(
  selectCartState,
  state => state.items
);

export const selectCartTotal = createSelector(
  selectCartItems,
  items => items.reduce((sum, item) => sum + item.price * item.quantity, 0)
);
```

```typescript
// src/app/auth/state/auth.selectors.ts
import { createFeatureSelector, createSelector } from '@ngrx/store';
import { AuthState } from './auth.reducer';

export const selectAuthState = createFeatureSelector<AuthState>('auth');

export const selectUser = createSelector(
  selectAuthState,
  state => state.user
);

export const selectUserName = createSelector(
  selectUser,
  user => user?.name ?? 'Guest'
);
```

```typescript
// src/app/dashboard/state/dashboard.selectors.ts
import { createSelector } from '@ngrx/store';
import { selectProducts } from '../../products/state/products.selectors';
import { selectCartTotal } from '../../cart/state/cart.selectors';
import { selectUserName } from '../../auth/state/auth.selectors';

export const selectTopFiveByRevenue = createSelector(
  selectProducts,
  products =>
    [...products]
      .sort((a, b) => b.price - a.price)
      .slice(0, 5)
);

export const selectOutOfStockCount = createSelector(
  selectProducts,
  products => products.filter(p => !p.inStock).length
);

export interface DashboardViewModel {
  topProducts: Product[];
  outOfStockCount: number;
  cartTotal: number;
  greeting: string;
}

export const selectDashboardViewModel = createSelector(
  selectTopFiveByRevenue,
  selectOutOfStockCount,
  selectCartTotal,
  selectUserName,
  (topProducts, outOfStockCount, cartTotal, userName): DashboardViewModel => ({
    topProducts,
    outOfStockCount,
    cartTotal,
    greeting: `Welcome back, ${userName}`,
  })
);
```

`selectDashboardViewModel` pulls from three separate feature slices. If the auth state changes, only `selectUserName` and `selectDashboardViewModel` recompute. The product and cart branches return their cached results. This is why selector granularity matters: each branch in the graph short-circuits independently.

## Selectors with createFeature and extraSelectors

Chapter 8 introduced `createFeature` with `extraSelectors`. Now that we understand selector composition, we can see the full picture. The `extraSelectors` callback receives all auto-generated base selectors and returns additional composed selectors:

```typescript
// src/app/products/state/products.feature.ts
import { createFeature, createSelector } from '@ngrx/store';
import { productsReducer } from './products.reducer';

export const productsFeature = createFeature({
  name: 'products',
  reducer: productsReducer,
  extraSelectors: ({
    selectProducts,
    selectQuery,
    selectSelectedProductId,
    selectLoading,
    selectError,
  }) => {
    const selectFilteredProducts = createSelector(
      selectProducts,
      selectQuery,
      (products, query) =>
        query
          ? products.filter(p =>
              p.name.toLowerCase().includes(query.toLowerCase())
            )
          : products
    );

    const selectSelectedProduct = createSelector(
      selectProducts,
      selectSelectedProductId,
      (products, id) => products.find(p => p.id === id) ?? null
    );

    const selectProductsPageViewModel = createSelector({
      products: selectFilteredProducts,
      loading: selectLoading,
      error: selectError,
      selectedProduct: selectSelectedProduct,
    });

    return {
      selectFilteredProducts,
      selectSelectedProduct,
      selectProductsPageViewModel,
    };
  },
});
```

All selectors, both auto-generated and extra, are accessible directly on the `productsFeature` object: `productsFeature.selectProducts`, `productsFeature.selectFilteredProducts`, `productsFeature.selectProductsPageViewModel`. This keeps everything co-located with the feature definition while still allowing cross-feature selectors to import individual selectors from the feature object.

## Custom Memoization with createSelectorFactory

The default `createSelector` uses `defaultMemoize` with reference equality (`===`). This works well for most cases, but sometimes you need different behavior.

### Deep Equality for Result Comparison

When a projector returns a new array or object with the same contents (for example, filtering always produces `[]` when the list is empty), the default memoization emits a new reference every time. If a downstream `computed()` or component depends on that reference, it re-renders unnecessarily. Use `createSelectorFactory` to apply deep equality on the result:

```typescript
// src/app/shared/state/custom-selectors.ts
import { createSelectorFactory, defaultMemoize } from '@ngrx/store';

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export const createDeepEqualSelector = createSelectorFactory(
  (projectionFn: (...args: unknown[]) => unknown) =>
    defaultMemoize(projectionFn, undefined, deepEqual)
);
```

Use it exactly like `createSelector`:

```typescript
// src/app/products/state/products.selectors.ts
import { createDeepEqualSelector } from '../../shared/state/custom-selectors';

export const selectCategories = createDeepEqualSelector(
  selectProducts,
  products => [...new Set(products.map(p => p.category))].sort()
);
```

Now `selectCategories` returns the same reference when the sorted category list has not changed, even if the `products` array was replaced with a new reference containing identical data.

Use `JSON.stringify` for simple, flat structures. For production applications with nested objects or ordering concerns, use a battle-tested deep equality library instead.

### How createSelectorFactory Works

`createSelector` is literally `createSelectorFactory(defaultMemoize)`. When you call `createSelectorFactory(myMemoize)`, it returns a function that works exactly like `createSelector` but uses `myMemoize` instead of `defaultMemoize` to wrap the projector. The memoize function receives the projector and must return an object with a `memoized` function (the wrapped projector), `reset`, `setResult`, and `clearResult` methods.

## Consuming Selectors in Components

Chapter 8 showed `store.selectSignal()` for signal-based reads and `store.select()` for Observable-based reads. Here is a summary of when to use each:

**`store.selectSignal(selector)`** returns a `Signal<T>`. Use it when you need the value in a template, in a `computed()`, or in an `effect()`. This is the default choice in Angular 21.

**`store.select(selector)`** returns an `Observable<T>`. Use it when you need RxJS operators between the Store and the consumer: `debounceTime`, `switchMap`, `combineLatestWith`, or integration with other Observable-based APIs.

```typescript
// src/app/dashboard/dashboard.component.ts
import { Component, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { CurrencyPipe } from '@angular/common';
import { selectDashboardViewModel } from './state/dashboard.selectors';
import { ProductCardComponent } from '../products/product-card.component';

@Component({
  selector: 'app-dashboard',
  imports: [CurrencyPipe, ProductCardComponent],
  template: `
    <h1>{{ vm().greeting }}</h1>

    <section class="stats">
      <div class="stat-card">
        <span class="label">Cart Total</span>
        <span class="value">{{ vm().cartTotal | currency }}</span>
      </div>
      <div class="stat-card">
        <span class="label">Out of Stock</span>
        <span class="value">{{ vm().outOfStockCount }}</span>
      </div>
    </section>

    <section class="top-products">
      <h2>Top Products</h2>
      @for (product of vm().topProducts; track product.id) {
        <app-product-card [product]="product" />
      }
    </section>
  `,
})
export class DashboardComponent {
  private readonly store = inject(Store);
  readonly vm = this.store.selectSignal(selectDashboardViewModel);
}
```

### Custom Equality on selectSignal

When a selector returns an array or object that may have a new reference but identical contents, pass a custom equality function to prevent unnecessary signal updates:

```typescript
// src/app/products/products-page.component.ts
readonly vm = this.store.selectSignal(selectProductsPageViewModel, {
  equal: (a, b) =>
    a.loading === b.loading &&
    a.error === b.error &&
    a.totalCount === b.totalCount &&
    a.filteredCount === b.filteredCount &&
    a.products === b.products,
});
```

In most cases you will not need this. If your selectors are composed correctly, memoization at the selector level handles reference stability. Reserve custom equality for edge cases where a projector must return a new object even when values have not changed.

## The projector Property and Testing

Every `MemoizedSelector` exposes a `projector` property: the raw projector function without the memoization wrapper. This is invaluable for unit testing because you can test the transformation logic in isolation without constructing the entire store state:

```typescript
// src/app/products/state/products.selectors.spec.ts
import { selectFilteredProducts, selectProductCount } from './products.selectors';
import { Product } from '../product.model';

describe('selectFilteredProducts', () => {
  const products: Product[] = [
    { id: '1', name: 'Blue Widget', price: 29.99, category: 'Widgets', description: '', imageUrl: '' },
    { id: '2', name: 'Red Gadget', price: 49.99, category: 'Gadgets', description: '', imageUrl: '' },
    { id: '3', name: 'Green Widget', price: 19.99, category: 'Widgets', description: '', imageUrl: '' },
  ];

  it('returns all products when query is empty', () => {
    const result = selectFilteredProducts.projector(products, '');
    expect(result).toEqual(products);
  });

  it('filters products by name case-insensitively', () => {
    const result = selectFilteredProducts.projector(products, 'widget');
    expect(result).toEqual([products[0], products[2]]);
  });

  it('returns empty array when nothing matches', () => {
    const result = selectFilteredProducts.projector(products, 'nonexistent');
    expect(result).toEqual([]);
  });
});

describe('selectProductCount', () => {
  it('returns the length of the products array', () => {
    const result = selectProductCount.projector([{}, {}, {}]);
    expect(result).toBe(3);
  });
});
```

No Store setup. No action dispatching. No state construction. Just call the projector with mock inputs and assert the output. Chapter 13 covers selector testing in full detail, including integration tests with `MockStore.overrideSelector()`.

## Releasing Memoized State

Every `MemoizedSelector` has a `release()` method that clears the memoization cache and recursively releases all ancestor selectors:

```typescript
selectDashboardViewModel.release();
```

In a typical Angular application, you rarely need to call `release()`. Selectors live as module-level constants, and their caches are small (one entry per selector). But in two scenarios it matters:

1. **Tests**: Call `release()` in `afterEach` to prevent memoized state from leaking between test cases.
2. **Long-running applications with many factory selectors**: If you cache thousands of factory selector instances in a `Map`, call `release()` on each when removing them from the cache to free the associated closure memory.

## Common Mistakes

### Mistake 1: Using the Feature Selector When a Property Selector Suffices

```typescript
// WRONG: recomputes whenever ANY property in ProductsState changes
export const selectProductCount = createSelector(
  selectProductsState,
  state => state.products.length
);
```

When a reducer changes `loading` from `false` to `true`, `selectProductsState` returns a new reference (the whole feature slice changed). The projector runs even though `products` did not change. Fix this by depending on `selectProducts` instead:

```typescript
// CORRECT: recomputes only when the products array changes
export const selectProductCount = createSelector(
  selectProducts,
  products => products.length
);
```

This is the most common selector performance mistake. Always use the most granular input selector possible.

### Mistake 2: Combining Store Reads in the Component Instead of in a Selector

```typescript
// WRONG: three separate signals, no shared memoization
export class ProductsPageComponent {
  private readonly store = inject(Store);
  readonly products = this.store.selectSignal(selectFilteredProducts);
  readonly loading = this.store.selectSignal(selectLoading);
  readonly error = this.store.selectSignal(selectError);
}
```

This works, but each `selectSignal` call creates an independent subscription. If a single action triggers changes to all three, the component processes three separate updates. With a view model selector, the component sees one update:

```typescript
// CORRECT: single view model selector
export class ProductsPageComponent {
  private readonly store = inject(Store);
  readonly vm = this.store.selectSignal(selectProductsPageViewModel);
}
```

### Mistake 3: Creating Factory Selectors Inside Templates or @for Loops

```typescript
// WRONG: creates a new selector instance on every change detection cycle
@Component({
  template: `
    @for (id of productIds(); track id) {
      <app-product-card [product]="store.selectSignal(selectProductById(id))()" />
    }
  `,
})
export class ProductListComponent {
  readonly store = inject(Store);
  readonly productIds = this.store.selectSignal(selectProductIds);
}
```

Every render creates new selector instances inside the `@for` block, defeating memoization entirely. Solve this by creating a dedicated child component that creates the selector once:

```typescript
// CORRECT: child component creates the selector once on initialization
@Component({
  selector: 'app-product-card-container',
  template: `
    @if (product(); as p) {
      <app-product-card [product]="p" />
    }
  `,
  imports: [ProductCardComponent],
})
export class ProductCardContainerComponent {
  private readonly store = inject(Store);
  readonly productId = input.required<string>();
  readonly product = this.store.selectSignal(selectProductById(this.productId()));
}
```

```typescript
// Parent template
@for (id of productIds(); track id) {
  <app-product-card-container [productId]="id" />
}
```

### Mistake 4: Returning New References When the Value Has Not Changed

```typescript
// WRONG: always returns a new array reference, even when categories are identical
export const selectCategories = createSelector(
  selectProducts,
  products => [...new Set(products.map(p => p.category))].sort()
);
```

If a reducer updates a product's `price` but not its `category`, `selectProducts` returns a new reference (the array was replaced). `selectCategories` runs the projector and returns a new sorted array, even though the categories are identical. Downstream consumers see a new reference and re-render.

Two fixes:

1. Use `createDeepEqualSelector` (shown earlier) to compare results by value instead of reference.
2. Structure your state so that category data is stored separately from product data, giving each its own selector chain.

Option 1 is simpler for isolated cases. Option 2 is the architectural solution for features where this pattern recurs frequently. Chapter 23 covers state normalization in depth.

## Key Takeaways

- **Selectors are pure functions with memoization.** They extract and transform state, skipping recomputation when their inputs have not changed by reference. Build a selector graph where each node depends on the most granular input possible.

- **Use the view model pattern for smart components.** One selector per component returning a single typed object. This eliminates multiple signals, prevents synchronization issues, and gives Angular one signal to track instead of many.

- **Factory selectors replace deprecated selector props.** Wrap `createSelector` in a function that takes runtime parameters. Cache instances in a `Map` when the same parameter is used repeatedly.

- **`createSelectorFactory` unlocks custom memoization.** Use it to apply deep equality on results when projectors must return new references for unchanged data. Reach for it only after confirming that selector granularity alone does not solve the problem.

- **Test projectors directly with `selector.projector()`.** No Store setup required. Pass mock inputs, assert the output. Reserve integration tests with `MockStore` for verifying selector wiring.
