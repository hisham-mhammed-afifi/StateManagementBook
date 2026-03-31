# Chapter 13: Testing the Classic Store

Your product catalog has grown to hundreds of actions, dozens of selectors, and a handful of effects that coordinate API calls, router navigation, and entity updates. You ship a refactor that changes how the `loadProducts` effect handles pagination. It passes code review, the app looks fine in dev mode, and you merge it. Two days later, a bug report comes in: the second page of products never loads because the effect now emits the wrong action when the API returns an empty array. The reducer silently ignores the unknown action, the selector returns stale data, and nobody notices until a customer complains. A three-line test would have caught it before the PR was approved. This chapter gives you every tool and pattern you need to test reducers, selectors, effects, and full Store integration with confidence.

## A Quick Recap

Through Chapters 8 to 12, we built a product catalog using `createActionGroup`, `createReducer`, `createFeature`, memoized selectors with `createSelector`, functional effects with `createEffect`, `@ngrx/entity` for normalized collections, and `@ngrx/router-store` for URL-driven state. Our `Product` model has `id`, `name`, `price`, `category`, `description`, and `featured` properties. Actions are grouped by source: `ProductPageActions` for user-initiated events and `ProductApiActions` for API responses. The Store holds products in an `EntityState` with `loading`, `error`, and filter metadata. This chapter tests every layer of that architecture.

## The Testing Pyramid for NgRx

NgRx testing falls into three levels. At the base are **unit tests** for reducers and selectors: pure functions with no dependencies, no TestBed, and no async behavior. In the middle are **effect tests**: these require a mock action stream and mock services but isolate the effect from the real Store. At the top are **integration tests**: these wire up the real Store, real reducers, and real effects with only the HTTP layer mocked, verifying that a dispatched action flows through the entire pipeline and produces the expected state.

```
         ┌─────────────────────┐
         │  Integration Tests  │  Real Store + real reducers + real effects
         │  (few, slow, high   │  Only HTTP is mocked
         │   confidence)       │
         ├─────────────────────┤
         │   Effect Tests      │  Mock actions + mock services
         │  (moderate count)   │  provideMockActions + provideMockStore
         ├─────────────────────┤
         │  Reducer + Selector │  Pure function calls
         │  Tests (many, fast, │  No TestBed, no DI
         │  no dependencies)   │
         └─────────────────────┘
```

Angular 21 ships with Vitest as the default test runner. All examples in this chapter use Vitest syntax (`vi.fn()`, `vi.spyOn()`, `describe`, `it`, `expect`). If your project still uses Jasmine, the structural patterns are identical; only spy creation and timer APIs differ. Angular provides a migration schematic: `ng generate @schematics/angular:refactor-jasmine-vitest`.

## Testing Reducers

Reducers are the easiest part of NgRx to test. A reducer is a pure function: given a state and an action, it returns a new state. No TestBed, no dependency injection, no async behavior. Call the function, assert the result.

### The Reducer Under Test

Here is the product reducer from Chapter 8, extended with the entity adapter from Chapter 11:

```typescript
// src/app/products/state/products.reducer.ts
import { createFeature, createReducer, on } from '@ngrx/store';
import { EntityState, EntityAdapter, createEntityAdapter } from '@ngrx/entity';
import { ProductPageActions, ProductApiActions } from './products.actions';
import { Product } from '../product.model';

export interface ProductsState extends EntityState<Product> {
  loading: boolean;
  error: string | null;
}

export const adapter: EntityAdapter<Product> = createEntityAdapter<Product>();

export const initialState: ProductsState = adapter.getInitialState({
  loading: false,
  error: null,
});

export const productsFeature = createFeature({
  name: 'products',
  reducer: createReducer(
    initialState,
    on(ProductPageActions.enter, (state) => ({
      ...state,
      loading: true,
      error: null,
    })),
    on(ProductApiActions.loadProductsSuccess, (state, { products }) =>
      adapter.setAll(products, { ...state, loading: false })
    ),
    on(ProductApiActions.loadProductsFailure, (state, { error }) => ({
      ...state,
      loading: false,
      error,
    }))
  ),
});
```

### Writing the Tests

```typescript
// src/app/products/state/products.reducer.spec.ts
import { productsFeature, initialState, ProductsState } from './products.reducer';
import { ProductPageActions, ProductApiActions } from './products.actions';
import { Product } from '../product.model';

const { reducer } = productsFeature;

function buildProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: '1',
    name: 'Test Widget',
    price: 29.99,
    category: 'electronics',
    description: 'A test product',
    featured: false,
    ...overrides,
  };
}

describe('Products Reducer', () => {
  describe('unknown action', () => {
    it('should return the initial state', () => {
      const action = { type: 'UNKNOWN' } as any;
      const result = reducer(initialState, action);
      expect(result).toBe(initialState);
    });
  });

  describe('ProductPageActions.enter', () => {
    it('should set loading to true and clear error', () => {
      const priorState: ProductsState = {
        ...initialState,
        loading: false,
        error: 'previous error',
      };
      const action = ProductPageActions.enter();
      const result = reducer(priorState, action);

      expect(result.loading).toBe(true);
      expect(result.error).toBeNull();
      expect(result).not.toBe(priorState);
    });
  });

  describe('ProductApiActions.loadProductsSuccess', () => {
    it('should set all products and clear loading', () => {
      const products = [
        buildProduct({ id: '1', name: 'Widget' }),
        buildProduct({ id: '2', name: 'Gadget' }),
      ];
      const loadingState: ProductsState = {
        ...initialState,
        loading: true,
      };
      const action = ProductApiActions.loadProductsSuccess({ products });
      const result = reducer(loadingState, action);

      expect(result.ids).toEqual(['1', '2']);
      expect(result.entities['1']?.name).toBe('Widget');
      expect(result.entities['2']?.name).toBe('Gadget');
      expect(result.loading).toBe(false);
    });
  });

  describe('ProductApiActions.loadProductsFailure', () => {
    it('should set the error and clear loading', () => {
      const loadingState: ProductsState = {
        ...initialState,
        loading: true,
      };
      const action = ProductApiActions.loadProductsFailure({
        error: 'Network timeout',
      });
      const result = reducer(loadingState, action);

      expect(result.error).toBe('Network timeout');
      expect(result.loading).toBe(false);
    });
  });
});
```

Three patterns to notice. First, the unknown action test uses `toBe` (reference equality) to prove the reducer returned the exact same object, not a copy. Returning a new reference on an unknown action would trigger unnecessary change detection in every selector. Second, each known-action test uses `not.toBe` to confirm the reducer produced a new reference. Third, the `buildProduct` helper prevents brittle tests that break every time you add a property to the `Product` model.

## Testing Selectors

Selectors built with `createSelector` expose a `.projector` method that calls the projection function directly, skipping all parent selectors. This means you can test a deeply composed selector without constructing the full state tree.

### The Selectors Under Test

```typescript
// src/app/products/state/products.selectors.ts
import { createSelector } from '@ngrx/store';
import { productsFeature, adapter } from './products.reducer';

const { selectAll, selectEntities } = adapter.getSelectors();

export const selectAllProducts = createSelector(
  productsFeature.selectProductsState,
  selectAll
);

export const selectProductEntities = createSelector(
  productsFeature.selectProductsState,
  selectEntities
);

export const selectLoading = productsFeature.selectLoading;
export const selectError = productsFeature.selectError;

export const selectFeaturedProducts = createSelector(
  selectAllProducts,
  (products) => products.filter((p) => p.featured)
);

export const selectProductsByCategory = (category: string) =>
  createSelector(selectAllProducts, (products) =>
    products.filter((p) => p.category === category)
  );

export const selectExpensiveProducts = createSelector(
  selectAllProducts,
  (products) => products.filter((p) => p.price > 100)
);

export const selectProductSummary = createSelector(
  selectAllProducts,
  selectFeaturedProducts,
  (all, featured) => ({
    totalCount: all.length,
    featuredCount: featured.length,
    averagePrice:
      all.length > 0
        ? all.reduce((sum, p) => sum + p.price, 0) / all.length
        : 0,
  })
);
```

### Writing the Tests

```typescript
// src/app/products/state/products.selectors.spec.ts
import {
  selectFeaturedProducts,
  selectProductsByCategory,
  selectExpensiveProducts,
  selectProductSummary,
} from './products.selectors';
import { Product } from '../product.model';

function buildProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: '1',
    name: 'Test Widget',
    price: 29.99,
    category: 'electronics',
    description: 'A test product',
    featured: false,
    ...overrides,
  };
}

describe('Product Selectors', () => {
  const products: Product[] = [
    buildProduct({ id: '1', name: 'Cheap Widget', price: 9.99, featured: false }),
    buildProduct({ id: '2', name: 'Premium Gadget', price: 199.99, featured: true }),
    buildProduct({ id: '3', name: 'Basic Tool', price: 49.99, category: 'tools', featured: true }),
  ];

  describe('selectFeaturedProducts', () => {
    it('should return only featured products', () => {
      const result = selectFeaturedProducts.projector(products);
      expect(result.length).toBe(2);
      expect(result.every((p) => p.featured)).toBe(true);
    });

    it('should return empty array when no products are featured', () => {
      const unfeatured = products.map((p) => ({ ...p, featured: false }));
      const result = selectFeaturedProducts.projector(unfeatured);
      expect(result).toEqual([]);
    });
  });

  describe('selectProductsByCategory', () => {
    it('should filter by the given category', () => {
      const selector = selectProductsByCategory('tools');
      const result = selector.projector(products);
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('Basic Tool');
    });

    it('should return empty array for a category with no products', () => {
      const selector = selectProductsByCategory('clothing');
      const result = selector.projector(products);
      expect(result).toEqual([]);
    });
  });

  describe('selectExpensiveProducts', () => {
    it('should return products with price above 100', () => {
      const result = selectExpensiveProducts.projector(products);
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('Premium Gadget');
    });
  });

  describe('selectProductSummary', () => {
    it('should compute summary statistics', () => {
      const featured = products.filter((p) => p.featured);
      const result = selectProductSummary.projector(products, featured);

      expect(result.totalCount).toBe(3);
      expect(result.featuredCount).toBe(2);
      expect(result.averagePrice).toBeCloseTo(86.66, 1);
    });

    it('should handle empty product list', () => {
      const result = selectProductSummary.projector([], []);

      expect(result.totalCount).toBe(0);
      expect(result.featuredCount).toBe(0);
      expect(result.averagePrice).toBe(0);
    });
  });
});
```

Notice that `selectProductSummary.projector` takes two arguments because the selector has two input selectors (`selectAllProducts` and `selectFeaturedProducts`). The projector arguments match the input selector arguments in order. You never need to construct a `ProductsState` or root `AppState` object. Each selector is tested in isolation with plain arrays.

Do not bother testing trivial selectors that just pluck a property. `selectLoading` returns `state.loading` and nothing else. That code is generated by `createFeature` and tested by NgRx itself. Focus your tests on selectors that contain filtering logic, computations, or composition.

## Testing Effects

Effects are where testing gets interesting. An effect subscribes to the action stream, calls services, reads from the Store, and dispatches new actions. Testing requires mocking the action stream, the services, and optionally the Store.

### The Effect Under Test

```typescript
// src/app/products/state/products.effects.ts
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { ProductPageActions, ProductApiActions } from './products.actions';
import { ProductsApiService } from '../products-api.service';
import { catchError, map, of, switchMap } from 'rxjs';

export const loadProducts = createEffect(
  (
    actions$ = inject(Actions),
    productsApi = inject(ProductsApiService)
  ) =>
    actions$.pipe(
      ofType(ProductPageActions.enter),
      switchMap(() =>
        productsApi.getAll().pipe(
          map((products) =>
            ProductApiActions.loadProductsSuccess({ products })
          ),
          catchError((err) =>
            of(ProductApiActions.loadProductsFailure({ error: err.message }))
          )
        )
      )
    ),
  { functional: true }
);
```

### Approach 1: Subscribe-Based Testing

The simplest approach. Set `actions$` to an observable that emits the trigger action, mock the service, and subscribe to the effect output.

```typescript
// src/app/products/state/products.effects.spec.ts
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { Observable, of, throwError } from 'rxjs';
import { Action } from '@ngrx/store';
import { loadProducts } from './products.effects';
import { ProductsApiService } from '../products-api.service';
import { ProductPageActions, ProductApiActions } from './products.actions';
import { Product } from '../product.model';

describe('loadProducts effect', () => {
  let actions$: Observable<Action>;
  let productsApi: { getAll: ReturnType<typeof vi.fn> };

  function setup(): Observable<Action> {
    productsApi = { getAll: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        provideMockStore(),
        { provide: ProductsApiService, useValue: productsApi },
      ],
    });

    return TestBed.runInInjectionContext(() => loadProducts());
  }

  it('should dispatch loadProductsSuccess on API success', () => {
    const effect$ = setup();
    const products: Product[] = [
      { id: '1', name: 'Widget', price: 29.99, category: 'electronics', description: 'A widget', featured: false },
    ];
    actions$ = of(ProductPageActions.enter());
    productsApi.getAll.mockReturnValue(of(products));

    effect$.subscribe((action) => {
      expect(action).toEqual(
        ProductApiActions.loadProductsSuccess({ products })
      );
    });
  });

  it('should dispatch loadProductsFailure on API error', () => {
    const effect$ = setup();
    actions$ = of(ProductPageActions.enter());
    productsApi.getAll.mockReturnValue(
      throwError(() => new Error('Server down'))
    );

    effect$.subscribe((action) => {
      expect(action).toEqual(
        ProductApiActions.loadProductsFailure({ error: 'Server down' })
      );
    });
  });
});
```

Functional effects created with `{ functional: true }` use `inject()` internally, so they must run inside an injection context. We call `TestBed.runInInjectionContext(() => loadProducts())` to provide that context. The `provideMockActions(() => actions$)` factory form lets us reassign `actions$` per test before the effect subscribes.

### Approach 2: RxJS TestScheduler (Marble Testing)

When effects involve timing operators like `debounceTime`, `delay`, or `throttleTime`, marble testing with the built-in RxJS `TestScheduler` gives you precise control over virtual time. No third-party marble library is needed.

```typescript
// src/app/search/state/search.effects.ts
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { SearchPageActions, SearchApiActions } from './search.actions';
import { SearchService } from '../search.service';
import { catchError, debounceTime, map, of, switchMap } from 'rxjs';

export const searchProducts = createEffect(
  (
    actions$ = inject(Actions),
    searchService = inject(SearchService)
  ) =>
    actions$.pipe(
      ofType(SearchPageActions.searchTermChanged),
      debounceTime(300),
      switchMap(({ term }) =>
        searchService.search(term).pipe(
          map((results) => SearchApiActions.searchSuccess({ results })),
          catchError((err) =>
            of(SearchApiActions.searchFailure({ error: err.message }))
          )
        )
      )
    ),
  { functional: true }
);
```

```typescript
// src/app/search/state/search.effects.spec.ts
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { TestScheduler } from 'rxjs/testing';
import { Observable } from 'rxjs';
import { Action } from '@ngrx/store';
import { searchProducts } from './search.effects';
import { SearchService } from '../search.service';
import { SearchPageActions, SearchApiActions } from './search.actions';

describe('searchProducts effect', () => {
  let actions$: Observable<Action>;
  let searchService: { search: ReturnType<typeof vi.fn> };
  let testScheduler: TestScheduler;

  function setup(): Observable<Action> {
    searchService = { search: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        provideMockStore(),
        { provide: SearchService, useValue: searchService },
      ],
    });

    return TestBed.runInInjectionContext(() => searchProducts());
  }

  beforeEach(() => {
    testScheduler = new TestScheduler((actual, expected) => {
      expect(actual).toEqual(expected);
    });
  });

  it('should debounce and emit search results', () => {
    const effect$ = setup();
    const results = [{ id: '1', name: 'Angular Book' }];

    testScheduler.run(({ hot, cold, expectObservable }) => {
      actions$ = hot('-a--b 300ms', {
        a: SearchPageActions.searchTermChanged({ term: 'ang' }),
        b: SearchPageActions.searchTermChanged({ term: 'angular' }),
      });
      searchService.search.mockReturnValue(
        cold('-r|', { r: results })
      );

      expectObservable(effect$).toBe('-- 300ms --r', {
        r: SearchApiActions.searchSuccess({ results }),
      });
    });
  });
});
```

Inside `testScheduler.run()`, all RxJS time-based operators use virtual time. The `hot()` function creates a hot observable (like the action stream), and `cold()` creates a cold observable (like an HTTP response). The marble string `-a--b 300ms` means: one frame of silence, emit `a`, two frames of silence, emit `b`, then wait 300 milliseconds of virtual time. The `TestScheduler` advances time synchronously, so the test completes instantly.

### Approach 3: ReplaySubject for Imperative Dispatch

When you want to dispatch actions one at a time and assert after each dispatch, a `ReplaySubject` gives you imperative control:

```typescript
// src/app/products/state/products.effects.spec.ts
import { ReplaySubject } from 'rxjs';

it('should handle sequential dispatches', () => {
  const effect$ = setup();
  const actionsSubject = new ReplaySubject<Action>(1);
  actions$ = actionsSubject.asObservable();

  const products = [
    { id: '1', name: 'Widget', price: 29.99, category: 'electronics', description: 'A widget', featured: false },
  ];
  productsApi.getAll.mockReturnValue(of(products));

  actionsSubject.next(ProductPageActions.enter());

  effect$.subscribe((action) => {
    expect(action).toEqual(
      ProductApiActions.loadProductsSuccess({ products })
    );
  });
});
```

This approach is useful when the test involves multiple actions dispatched in sequence or when you need to change mock return values between dispatches.

## Testing Components with MockStore

Components that inject `Store` need a mock in tests. `provideMockStore` from `@ngrx/store/testing` replaces the real Store with a `MockStore` that lets you override selectors and inspect dispatched actions.

```typescript
// src/app/products/product-list.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { ProductListComponent } from './product-list.component';
import { selectProductListViewModel } from './state/product-list.selectors';
import { ProductPageActions } from './state/products.actions';

describe('ProductListComponent', () => {
  let store: MockStore;

  const defaultViewModel = {
    products: [],
    sort: 'name',
    page: 1,
    category: null as string | null,
    loading: false,
    error: null as string | null,
    totalPages: 0,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProductListComponent],
      providers: [
        provideMockStore({
          selectors: [
            { selector: selectProductListViewModel, value: defaultViewModel },
          ],
        }),
      ],
    }).compileComponents();

    store = TestBed.inject(MockStore);
  });

  afterEach(() => {
    store.resetSelectors();
  });

  it('should display product names', async () => {
    store.overrideSelector(selectProductListViewModel, {
      ...defaultViewModel,
      products: [
        { id: '1', name: 'Widget', price: 29.99, category: 'electronics', description: 'A widget', featured: false },
      ],
    });
    store.refreshState();

    const fixture = TestBed.createComponent(ProductListComponent);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Widget');
  });

  it('should show loading spinner when loading', async () => {
    store.overrideSelector(selectProductListViewModel, {
      ...defaultViewModel,
      loading: true,
    });
    store.refreshState();

    const fixture = TestBed.createComponent(ProductListComponent);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Loading');
  });

  it('should verify dispatched actions with scannedActions$', () => {
    vi.spyOn(store, 'dispatch');
    const fixture = TestBed.createComponent(ProductListComponent);
    fixture.detectChanges();

    expect(store.dispatch).toHaveBeenCalled();
  });
});
```

Three critical patterns here. First, `overrideSelector` tells the MockStore to return a specific value for a selector regardless of the actual state. Second, `refreshState()` must be called after every `overrideSelector` to trigger emissions. Without it, subscribers do not receive the new value. Third, `resetSelectors()` in `afterEach` prevents selector overrides from leaking between tests.

Components that use `store.selectSignal()` work the same way. The `MockStore.selectSignal` method reads from the overridden selector values, so `overrideSelector` + `refreshState` is all you need.

## Integration Testing with the Real Store

Unit tests with `MockStore` verify that components read the right selectors and dispatch the right actions. Integration tests verify that the full pipeline works: dispatching an action flows through the reducer, updates the state, and produces the correct selector output. These tests use the real `provideStore` and `provideEffects` instead of `provideMockStore`.

```typescript
// src/app/products/state/products.integration.spec.ts
import { TestBed } from '@angular/core/testing';
import { provideStore, provideState, Store } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { provideHttpClient } from '@angular/common/http';
import {
  provideHttpClientTesting,
  HttpTestingController,
} from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { productsFeature } from './products.reducer';
import { loadProducts } from './products.effects';
import { ProductPageActions } from './products.actions';
import {
  selectAllProducts,
  selectLoading,
  selectError,
} from './products.selectors';

describe('Products State Integration', () => {
  let store: Store;
  let httpController: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideStore(),
        provideState(productsFeature),
        provideEffects({ loadProducts }),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    store = TestBed.inject(Store);
    httpController = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpController.verify();
  });

  it('should load products end-to-end', async () => {
    const products = [
      { id: '1', name: 'Widget', price: 29.99, category: 'electronics', description: 'A widget', featured: false },
      { id: '2', name: 'Gadget', price: 49.99, category: 'tools', description: 'A gadget', featured: true },
    ];

    store.dispatch(ProductPageActions.enter());

    const loadingBefore = await firstValueFrom(store.select(selectLoading));
    expect(loadingBefore).toBe(true);

    const req = httpController.expectOne('/api/products');
    expect(req.request.method).toBe('GET');
    req.flush(products);

    const result = await firstValueFrom(store.select(selectAllProducts));
    expect(result.length).toBe(2);
    expect(result[0].name).toBe('Widget');

    const loadingAfter = await firstValueFrom(store.select(selectLoading));
    expect(loadingAfter).toBe(false);
  });

  it('should handle API failure end-to-end', async () => {
    store.dispatch(ProductPageActions.enter());

    const req = httpController.expectOne('/api/products');
    req.flush('Server error', { status: 500, statusText: 'Internal Server Error' });

    const error = await firstValueFrom(store.select(selectError));
    expect(error).toBeTruthy();

    const loading = await firstValueFrom(store.select(selectLoading));
    expect(loading).toBe(false);
  });
});
```

Notice how the integration test uses `provideEffects({ loadProducts })` with the functional effect as an object. The test dispatches a real action, intercepts the HTTP request with `HttpTestingController`, flushes a response, and asserts the final state via selectors. This verifies the action-to-reducer-to-selector pipeline in one shot.

Use `firstValueFrom` from RxJS to convert a Store selection to a promise. This works cleanly with async/await and avoids dangling subscriptions.

## Common Mistakes

### Mistake 1: Forgetting refreshState After overrideSelector

```typescript
// WRONG: selector override has no effect
store.overrideSelector(selectLoading, true);
const fixture = TestBed.createComponent(ProductListComponent);
await fixture.whenStable();
// Component still shows loading = false (the initial value)
```

`overrideSelector` registers the override but does not trigger emissions. Subscribers only receive the new value after `refreshState()`.

```typescript
// CORRECT: refreshState triggers the emission
store.overrideSelector(selectLoading, true);
store.refreshState();
const fixture = TestBed.createComponent(ProductListComponent);
await fixture.whenStable();
// Component correctly shows loading = true
```

### Mistake 2: Expecting MockStore to Process Actions Through Reducers

```typescript
// WRONG: dispatching to MockStore does not change state
store.dispatch(ProductApiActions.loadProductsSuccess({ products }));
const result = await firstValueFrom(store.select(selectAllProducts));
// result is still [], because MockStore ignores reducers
```

`MockStore` does not run reducers. It is a controlled mock. If your test needs state to change in response to an action, use `setState()` to set the state explicitly, or switch to an integration test with the real Store.

```typescript
// CORRECT: use setState to set state directly
store.setState({
  products: adapter.setAll(products, initialState),
});
```

### Mistake 3: Forgetting resetSelectors in afterEach

```typescript
// WRONG: selector override from test A leaks into test B
describe('ProductListComponent', () => {
  it('test A', () => {
    store.overrideSelector(selectLoading, true);
    store.refreshState();
    // ...assertions...
  });

  it('test B', () => {
    // selectLoading is STILL overridden to true from test A
    const fixture = TestBed.createComponent(ProductListComponent);
    // ...unexpected behavior...
  });
});
```

Selector overrides persist across tests within the same `describe` block unless explicitly cleared.

```typescript
// CORRECT: reset in afterEach
afterEach(() => {
  store.resetSelectors();
});
```

### Mistake 4: Using hot() for Service Responses in Marble Tests

```typescript
// WRONG: service responses should be cold, not hot
testScheduler.run(({ hot, expectObservable }) => {
  actions$ = hot('-a', { a: ProductPageActions.enter() });
  productsApi.getAll.mockReturnValue(
    hot('--b|', { b: products })  // hot creates a shared observable
  );
  expectObservable(effect$).toBe('---c', {
    c: ProductApiActions.loadProductsSuccess({ products }),
  });
});
```

A `hot()` observable starts emitting immediately when the test begins, regardless of when something subscribes. HTTP responses are cold: they start when the caller subscribes.

```typescript
// CORRECT: cold creates an on-demand observable
testScheduler.run(({ hot, cold, expectObservable }) => {
  actions$ = hot('-a', { a: ProductPageActions.enter() });
  productsApi.getAll.mockReturnValue(
    cold('--b|', { b: products })
  );
  expectObservable(effect$).toBe('---c', {
    c: ProductApiActions.loadProductsSuccess({ products }),
  });
});
```

Use `hot()` for the action stream (it is a shared, long-lived observable). Use `cold()` for service responses and any observable that starts fresh per subscription.

### Mistake 5: Testing Selectors by Building Full State Trees

```typescript
// WRONG: brittle, requires full state shape
it('should return featured products', () => {
  const state = {
    products: {
      ids: ['1', '2'],
      entities: {
        '1': { id: '1', name: 'A', featured: true, price: 10, category: 'x', description: 'x' },
        '2': { id: '2', name: 'B', featured: false, price: 20, category: 'y', description: 'y' },
      },
      loading: false,
      error: null,
    },
    router: { state: { url: '/' }, navigationId: 1 },
  };
  const result = selectFeaturedProducts(state as any);
  expect(result.length).toBe(1);
});
```

This test breaks whenever the state shape changes (new slice added, property renamed). It also tests the parent selectors implicitly, which makes failures harder to diagnose.

```typescript
// CORRECT: use projector to test only the projection logic
it('should return featured products', () => {
  const products = [
    { id: '1', name: 'A', featured: true, price: 10, category: 'x', description: 'x' },
    { id: '2', name: 'B', featured: false, price: 20, category: 'y', description: 'y' },
  ];
  const result = selectFeaturedProducts.projector(products);
  expect(result.length).toBe(1);
});
```

## Key Takeaways

- **Reducers and selectors are pure functions. Test them without TestBed, without DI, and without mocks.** Call the function, pass inputs, assert outputs. Use `toBe` for reference checks on unknown actions and `.projector()` to isolate selector logic.

- **Use `provideMockStore` for component unit tests and `provideStore` + `provideEffects` for integration tests.** MockStore gives you control (`overrideSelector`, `setState`), while the real Store gives you confidence that the full action-reducer-selector pipeline works.

- **Always call `refreshState()` after `overrideSelector` and `resetSelectors()` in `afterEach`.** These two calls prevent the most common MockStore bugs: stale emissions and test leakage.

- **Prefer RxJS `TestScheduler` over third-party marble libraries.** It ships with RxJS, works with Vitest out of the box, and handles virtual time for `debounceTime`, `delay`, and other time-based operators.

- **Integration tests are your safety net for refactors.** When you rename an action, change a reducer's logic, or restructure selectors, integration tests catch mismatches between layers that unit tests miss. Write a few for every feature slice.
