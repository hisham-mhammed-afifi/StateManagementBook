# Research: Testing the Classic Store

**Date:** 2026-03-31
**Chapter:** Ch 13
**Status:** Ready for chapter generation

## API Surface

### @ngrx/store/testing

| API | Signature | Stability |
|-----|-----------|-----------|
| `provideMockStore` | `provideMockStore(config?: { initialState?, selectors?: { selector, value }[] })` | Stable |
| `MockStore` | Class extending `Store`. Methods: `setState(state)`, `overrideSelector(selector, value)`, `refreshState()`, `resetSelectors()`, `scannedActions$` | Stable |
| `createMockStore` | `createMockStore(config?: { initialState?, selectors?: { selector, value }[] }): MockStore` | Stable |

- **Import path:** `import { provideMockStore, MockStore } from '@ngrx/store/testing';`
- **Import path:** `import { createMockStore } from '@ngrx/store/testing';`

### @ngrx/effects/testing

| API | Signature | Stability |
|-----|-----------|-----------|
| `provideMockActions` | `provideMockActions(factory: () => Observable<Action>)` or `provideMockActions(source: Observable<Action>)` | Stable |

- **Import path:** `import { provideMockActions } from '@ngrx/effects/testing';`

### @ngrx/store (standalone provider APIs for integration tests)

| API | Signature | Stability |
|-----|-----------|-----------|
| `provideStore` | `provideStore(reducers?: ActionReducerMap, config?)` | Stable |
| `provideState` | `provideState(featureName, reducer)` or `provideState(feature)` | Stable |

- **Import path:** `import { provideStore, provideState } from '@ngrx/store';`

### @ngrx/effects (standalone provider APIs for integration tests)

| API | Signature | Stability |
|-----|-----------|-----------|
| `provideEffects` | `provideEffects(...effects: Type<any>[])` | Stable |

- **Import path:** `import { provideEffects } from '@ngrx/effects';`

### MockStore Key Methods

- `store.setState(newState)`: Replaces the entire mock state
- `store.overrideSelector(selector, value)`: Returns a `MemoizedSelector` that emits the given value
- `selector.setResult(newValue)`: Updates a previously overridden selector's value
- `store.refreshState()`: Triggers emissions from all overridden selectors after `setResult`
- `store.resetSelectors()`: Clears all selector overrides (call in `afterEach`)
- `store.scannedActions$`: Observable stream of all dispatched actions (dispatched actions do NOT modify mock state)
- `store.selectSignal(selector)`: Returns a signal; works with `overrideSelector` after calling `refreshState()`

## Key Concepts

- **Reducers are pure functions**: No TestBed, no DI, no mocking needed. Call the reducer with state + action, assert returned state. Verify unknown actions return the same reference (`toBe`), known actions return a new reference (`not.toBe`).
- **Selectors use `.projector()`**: Every `createSelector` result exposes a `.projector` property that calls the projection function directly, bypassing parent selectors. Skip testing trivial pluck selectors; focus on selectors with logic.
- **Effects testing has four approaches**: Subscribe-based (simplest), marble diagrams with `jasmine-marbles` or Vitest equivalents, RxJS `TestScheduler` (no extra dependency), and `ReplaySubject` (imperative action dispatch).
- **MockStore vs real store**: MockStore for unit tests (isolate component/effect under test), real store for integration tests (verify full action-reducer-selector flow).
- **`provideMockStore` is the primary unit testing tool**: Works as a standalone provider in Angular 21 TestBed.
- **`createMockStore` enables TestBed-free testing**: Useful for lightweight tests without Angular DI overhead.
- **Integration tests use `provideStore`/`provideEffects`**: The standalone API equivalents of `StoreModule.forRoot`/`EffectsModule.forRoot`.
- **Angular 21 uses Vitest by default**: New projects use Vitest, not Jasmine or Jest. Migration schematic exists: `ng g @schematics/angular:refactor-jasmine-vitest`.
- **Zoneless testing with `whenStable()`**: Angular 21 is zoneless by default. Prefer `await fixture.whenStable()` over `fixture.detectChanges()` in component tests.
- **`selectSignal` works with `overrideSelector`**: Confirmed working; call `refreshState()` after overriding to trigger signal updates.
- **Functional effects are testable without TestBed**: Pass mock `actions$` and mock services directly to the effect function.

## Code Patterns

### Testing Reducers

```typescript
// src/app/products/state/products.reducer.spec.ts
import { productsReducer, initialState } from './products.reducer';
import { ProductApiActions } from './products.actions';

describe('Products Reducer', () => {
  it('should return the initial state on unknown action', () => {
    const action = { type: 'NOOP' } as any;
    const result = productsReducer(initialState, action);
    expect(result).toBe(initialState); // same reference
  });

  it('should set products on loadProductsSuccess', () => {
    const products = [{ id: 1, name: 'Widget', price: 9.99 }];
    const action = ProductApiActions.loadProductsSuccess({ products });
    const result = productsReducer(initialState, action);

    expect(result.products).toEqual(products);
    expect(result.loading).toBe(false);
    expect(result).not.toBe(initialState); // new reference
  });

  it('should set error on loadProductsFailure', () => {
    const action = ProductApiActions.loadProductsFailure({ error: 'Network error' });
    const result = productsReducer(initialState, action);

    expect(result.error).toBe('Network error');
    expect(result.products).toEqual([]);
  });
});
```

### Testing Selectors with projector()

```typescript
// src/app/products/state/products.selectors.spec.ts
import { selectFilteredProducts } from './products.selectors';

describe('selectFilteredProducts', () => {
  it('should filter products by active status', () => {
    const products = [
      { id: 1, name: 'A', status: 'active' },
      { id: 2, name: 'B', status: 'inactive' },
      { id: 3, name: 'C', status: 'active' },
    ];
    const filter = 'active';

    const result = selectFilteredProducts.projector(products, filter);

    expect(result.length).toBe(2);
    expect(result.every(p => p.status === 'active')).toBe(true);
  });

  it('should return all products when filter is empty', () => {
    const products = [
      { id: 1, name: 'A', status: 'active' },
      { id: 2, name: 'B', status: 'inactive' },
    ];

    const result = selectFilteredProducts.projector(products, '');

    expect(result.length).toBe(2);
  });
});
```

### Testing Effects: Subscribe-Based

```typescript
// src/app/products/state/products.effects.spec.ts
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { Observable, of, throwError } from 'rxjs';
import { Action } from '@ngrx/store';
import { ProductsEffects } from './products.effects';
import { ProductsService } from '../products.service';
import { ProductPageActions, ProductApiActions } from './products.actions';

describe('ProductsEffects', () => {
  let actions$: Observable<Action>;
  let effects: ProductsEffects;
  let productsService: { getAll: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    productsService = { getAll: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        ProductsEffects,
        provideMockActions(() => actions$),
        provideMockStore(),
        { provide: ProductsService, useValue: productsService },
      ],
    });
    effects = TestBed.inject(ProductsEffects);
  });

  it('should dispatch loadProductsSuccess on success', () => {
    const products = [{ id: 1, name: 'Widget' }];
    actions$ = of(ProductPageActions.enter());
    productsService.getAll.mockReturnValue(of(products));

    effects.loadProducts$.subscribe((action) => {
      expect(action).toEqual(ProductApiActions.loadProductsSuccess({ products }));
    });
  });

  it('should dispatch loadProductsFailure on error', () => {
    actions$ = of(ProductPageActions.enter());
    productsService.getAll.mockReturnValue(throwError(() => new Error('fail')));

    effects.loadProducts$.subscribe((action) => {
      expect(action).toEqual(
        ProductApiActions.loadProductsFailure({ error: 'fail' })
      );
    });
  });
});
```

### Testing Effects: RxJS TestScheduler

```typescript
// src/app/products/state/products.effects.spec.ts
import { TestScheduler } from 'rxjs/testing';

describe('ProductsEffects (TestScheduler)', () => {
  let testScheduler: TestScheduler;

  beforeEach(() => {
    testScheduler = new TestScheduler((actual, expected) => {
      expect(actual).toEqual(expected);
    });
  });

  it('should load products with marble timing', () => {
    testScheduler.run(({ cold, hot, expectObservable }) => {
      const products = [{ id: 1, name: 'Widget' }];
      actions$ = hot('-a', { a: ProductPageActions.enter() });
      productsService.getAll.mockReturnValue(cold('--b|', { b: products }));

      expectObservable(effects.loadProducts$).toBe('---c', {
        c: ProductApiActions.loadProductsSuccess({ products }),
      });
    });
  });
});
```

### Testing Effects: ReplaySubject (Imperative Dispatch)

```typescript
// src/app/products/state/products.effects.spec.ts
import { ReplaySubject } from 'rxjs';

it('should load products (imperative)', () => {
  const actionsSubject = new ReplaySubject<Action>(1);
  actions$ = actionsSubject.asObservable();
  const products = [{ id: 1, name: 'Widget' }];
  productsService.getAll.mockReturnValue(of(products));

  actionsSubject.next(ProductPageActions.enter());

  effects.loadProducts$.subscribe((action) => {
    expect(action).toEqual(ProductApiActions.loadProductsSuccess({ products }));
  });
});
```

### Testing Functional Effects (No Class)

```typescript
// src/app/actors/state/actors.effects.spec.ts
import { loadActors } from './actors.effects';
import { ActorsPageActions, ActorsApiActions } from './actors.actions';
import { of } from 'rxjs';

it('should load actors via functional effect', () => {
  const actors = [{ id: 1, name: 'Alice' }];
  const serviceMock = { getAll: () => of(actors) };
  const actions$ = of(ActorsPageActions.opened());

  loadActors(actions$, serviceMock as any).subscribe((action) => {
    expect(action).toEqual(ActorsApiActions.loadSuccess({ actors }));
  });
});
```

### Component Testing with MockStore

```typescript
// src/app/products/product-list.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { ProductListComponent } from './product-list.component';
import { selectFilteredProducts, selectLoading } from './state/products.selectors';

describe('ProductListComponent', () => {
  let store: MockStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProductListComponent],
      providers: [
        provideMockStore({
          selectors: [
            { selector: selectFilteredProducts, value: [] },
            { selector: selectLoading, value: false },
          ],
        }),
      ],
    }).compileComponents();

    store = TestBed.inject(MockStore);
  });

  afterEach(() => {
    store.resetSelectors();
  });

  it('should display products', async () => {
    const products = [{ id: 1, name: 'Widget', price: 9.99 }];
    store.overrideSelector(selectFilteredProducts, products);
    store.refreshState();

    const fixture = TestBed.createComponent(ProductListComponent);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Widget');
  });

  it('should dispatch load action on init', () => {
    vi.spyOn(store, 'dispatch');
    const fixture = TestBed.createComponent(ProductListComponent);
    fixture.detectChanges();

    expect(store.dispatch).toHaveBeenCalledWith(ProductPageActions.enter());
  });
});
```

### Component Testing with selectSignal

```typescript
// src/app/products/product-list.component.spec.ts
it('should work with selectSignal', () => {
  const products = [{ id: 1, name: 'Widget' }];
  store.overrideSelector(selectFilteredProducts, products);
  store.refreshState();

  // selectSignal reads from the same overridden selector
  const signal = store.selectSignal(selectFilteredProducts);
  expect(signal()).toEqual(products);
});
```

### Integration Testing with Real Store

```typescript
// src/app/products/state/products.integration.spec.ts
import { TestBed } from '@angular/core/testing';
import { provideStore, provideState, Store } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { productsFeature } from './products.reducer';
import { ProductsEffects } from './products.effects';
import { ProductPageActions } from './products.actions';
import { selectFilteredProducts } from './products.selectors';

describe('Products Integration', () => {
  let store: Store;
  let httpController: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideStore(),
        provideState(productsFeature),
        provideEffects(ProductsEffects),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    store = TestBed.inject(Store);
    httpController = TestBed.inject(HttpTestingController);
  });

  it('should load products end-to-end', () => {
    const products = [{ id: 1, name: 'Widget', price: 9.99 }];

    store.dispatch(ProductPageActions.enter());

    const req = httpController.expectOne('/api/products');
    req.flush(products);

    store.select(selectFilteredProducts).subscribe((result) => {
      expect(result).toEqual(products);
    });
  });
});
```

### TestBed-Free Testing with createMockStore

```typescript
// src/app/products/state/products.effects.no-testbed.spec.ts
import { createMockStore } from '@ngrx/store/testing';
import { Actions } from '@ngrx/effects';
import { of } from 'rxjs';
import { ProductsEffects } from './products.effects';
import { selectProductIds } from './products.selectors';

it('should work without TestBed', () => {
  const store = createMockStore({
    selectors: [{ selector: selectProductIds, value: [1, 2, 3] }],
  });
  const actions$ = new Actions(of(ProductPageActions.enter()));
  const serviceMock = { getAll: vi.fn().mockReturnValue(of([])) };

  const effects = new ProductsEffects(store as any, actions$, serviceMock as any);

  effects.loadProducts$.subscribe((action) => {
    expect(action).toBeDefined();
  });
});
```

### Testing Non-Dispatching Effects

```typescript
// src/app/products/state/products.effects.spec.ts
it('should navigate on product select', () => {
  const router = TestBed.inject(Router);
  vi.spyOn(router, 'navigateByUrl');

  actions$ = of(ProductPageActions.productSelected({ id: 42 }));

  effects.navigateToProduct$.subscribe();

  expect(router.navigateByUrl).toHaveBeenCalledWith('/products/42');
});
```

### Testing Time-Dependent Effects

```typescript
// src/app/search/state/search.effects.spec.ts
it('should debounce search', () => {
  const testScheduler = new TestScheduler((actual, expected) => {
    expect(actual).toEqual(expected);
  });

  testScheduler.run(({ hot, cold, expectObservable }) => {
    actions$ = hot('-a-b 300ms', {
      a: SearchActions.search({ term: 'ang' }),
      b: SearchActions.search({ term: 'angular' }),
    });
    searchService.search.mockReturnValue(cold('-r|', { r: results }));

    expectObservable(effects.search$).toBe('-- 300ms -r', {
      r: SearchApiActions.searchSuccess({ results }),
    });
  });
});
```

## Breaking Changes and Gotchas

### No Breaking Changes in NgRx 21 for Classic Store Testing
The Classic Store testing surface (`provideMockStore`, `MockStore`, `createMockStore`, `provideMockActions`, `overrideSelector`, `refreshState`, `resetSelectors`) is completely unchanged in NgRx 21. The only v21 breaking change was the `withEffects` to `withEventHandlers` rename in `@ngrx/signals/events`, which affects SignalStore only.

### Angular 21: Vitest is the Default Test Runner
- New Angular 21 projects use Vitest, not Jasmine or Jest
- Migration schematic: `ng g @schematics/angular:refactor-jasmine-vitest`
- Key differences from Jasmine:
  - `jasmine.createSpy()` becomes `vi.fn()`
  - `spyOn().and.returnValue()` becomes `vi.spyOn().mockReturnValue()`
  - `fit`/`fdescribe` become `it.only`/`describe.only`
  - `fakeAsync()`/`flush()` are NOT available in Vitest; use `vi.useFakeTimers()` + `vi.advanceTimersByTime()` instead
- Builder: `@angular/build:unit-test`

### Angular 21: Zoneless Testing
- Angular 21 is zoneless by default. TestBed runs in zoneless mode when `zone.js` is not loaded.
- Prefer `await fixture.whenStable()` over `fixture.detectChanges()` in component tests. The latter forces change detection that Angular might not have scheduled.
- CLI-generated tests in Angular 21 use `whenStable()` by default.

### Common Pitfalls

1. **Forgetting `refreshState()` after `overrideSelector`**: Overriding a selector does NOT trigger emissions. You must call `store.refreshState()` to push the new value to subscribers.

2. **Forgetting `resetSelectors()` in `afterEach`**: Selector overrides leak between tests if not reset. Always call `store.resetSelectors()` in `afterEach`.

3. **Dispatched actions do NOT modify MockStore state**: `MockStore` does NOT process actions through reducers. If your test relies on state changes from dispatched actions, use a real store (integration test) or explicitly call `setState()`.

4. **Marble testing: hot vs cold confusion**: Use `hot()` for `actions$` (the action stream is shared/hot). Use `cold()` for service responses (they are cold/on-demand).

5. **Testing effects that depend on store state**: Use `provideMockStore({ selectors: [...] })` to provide initial selector values. Use `overrideSelector` + `refreshState` to change state mid-test.

6. **Using `fakeAsync` in Vitest**: It does not exist. Use `vi.useFakeTimers()` and `vi.advanceTimersByTime()` instead.

7. **`getMockStore` vs `createMockStore`**: The function was originally named `getMockStore()` (NgRx v11), later renamed to `createMockStore()`. Both may appear in older docs; `createMockStore` is current.

8. **Testing effects with `inject()`**: Effects using `inject()` inside `createEffect()` must be tested with TestBed (DI context required). Functional effects that accept dependencies as parameters can be tested without TestBed.

## Sources

### Official Documentation
- NgRx Store Testing Guide: https://ngrx.io/guide/store/testing
- NgRx Effects Testing Guide: https://ngrx.io/guide/effects/testing
- provideMockStore API: https://ngrx.io/api/store/testing/provideMockStore
- MockStore API: https://ngrx.io/api/store/testing/MockStore
- Angular Testing Overview: https://angular.dev/guide/testing
- Angular Zoneless Guide: https://angular.dev/guide/zoneless
- Angular Migration to Vitest: https://angular.dev/guide/testing/migrating-to-vitest

### Blog Posts and Articles
- Tim Deschryver: Testing an NgRx Project: https://timdeschryver.dev/blog/testing-an-ngrx-project
- Tim Deschryver: How I Test My NgRx Selectors: https://timdeschryver.dev/blog/how-i-test-my-ngrx-selectors
- Tim Deschryver: Angular Testing Library Zoneless: https://timdeschryver.dev/blog/introducing-angular-testing-library-zoneless
- Angular Architects: What's New in Angular 21: https://www.angulararchitects.io/blog/whats-new-in-angular-21-signal-forms-zone-less-vitest-angular-aria-cli-with-mcp-server/
- HeroDevs: Testing NgRx Effects with Async/Await: https://www.herodevs.com/blog-posts/testing-ngrx-effects-with-async-await
- Angular Addicts: Mocking NgRx Signal Stores: https://www.angularaddicts.com/p/how-to-mock-ngrx-signal-stores
- Vitest in Angular 21: https://javascript-conference.com/blog/angular-21-vitest-testing/

### GitHub Issues and Discussions
- NgRx v21 Release: https://github.com/ngrx/platform/issues/5005
- selectSignal with MockStore: https://github.com/ngrx/platform/issues/4473
- mockSignalStore discussion: https://github.com/ngrx/platform/discussions/4427
- getMockStore rename: https://github.com/ngrx/platform/issues/3781
- withEffects rename: https://github.com/ngrx/platform/issues/4976
- NgRx CHANGELOG: https://github.com/ngrx/platform/blob/main/CHANGELOG.md

### NgRx Standalone APIs
- Using NgRx with Standalone Features: https://dev.to/ngrx/using-ngrx-packages-with-standalone-angular-features-53d8

## Open Questions

1. **Marble testing library for Vitest**: The `jasmine-marbles` library is Jasmine-specific. Need to verify whether `rxjs-marbles` or the built-in `TestScheduler` from RxJS is the recommended approach for marble testing in Vitest. The `TestScheduler` approach (shown in code patterns above) works without any third-party library and is the safest recommendation.

2. **`fakeAsync` alternative in Vitest for effects with timers**: Confirmed that `vi.useFakeTimers()` replaces `fakeAsync`. However, need to verify if `TestScheduler.run()` handles all timing scenarios or if `vi.useFakeTimers()` is still needed for some effect patterns.

3. **Standalone effects testing in Angular 21**: Functional effects created with `createEffect(() => { ... }, { functional: true })` can be tested without TestBed. Need to verify the exact API shape in NgRx 21 for functional effects and whether the `functional: true` flag is still required or is now the default.
