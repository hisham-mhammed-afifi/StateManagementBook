# Chapter 21: Testing SignalStore

Your `ProductCatalogStore` loads products from an API, filters them by category, computes a total count, and manages loading and error states. The `CartStore` adds, removes, and calculates line totals. The `OrderStore` dispatches events that coordinate all three. Every one of these stores passed code review, shipped to production, and then broke after a refactor that renamed an entity property. Nobody caught it because there were no tests. The team that invested time learning `signalStore`, `withEntities`, `withEventHandlers`, and `rxMethod` skipped the part that protects their investment. This chapter fixes that. We will build a complete testing strategy for SignalStore: unit testing state and computed signals, testing methods that call services, testing entity operations, testing event-driven flows, testing `rxMethod` pipelines, testing custom store features in isolation, and testing components that consume stores via manual mocks.

## A Quick Recap

In Chapters 15 through 20, we built SignalStore knowledge layer by layer. `withState` holds reactive state as `DeepSignal`s (Chapter 15). `withComputed` derives signals. `withMethods` defines operations using `patchState`. `withEntities` normalizes collections (Chapter 16). `withHooks` manages lifecycle and `withProps` centralizes injected dependencies (Chapter 17). `signalStoreFeature` extracts reusable, composable store logic (Chapter 18). `withEventHandlers` and `eventGroup` enable event-driven state updates (Chapter 19). `rxMethod` bridges SignalStore with RxJS for async orchestration (Chapter 20). This chapter tests all of them.

Angular 21 is zoneless by default. That means `fakeAsync()`, `tick()`, `flush()`, and `flushMicrotasks()` are not available. All async test patterns in this chapter use native `async`/`await` with `fixture.whenStable()` or `TestBed.flushEffects()`. The default test runner is Vitest, but every pattern shown here works with Jest as well. The mock function syntax uses Vitest's `vi.fn()`. If your project uses Jest, swap `vi.fn()` for `jest.fn()`.

## The Testing Pyramid for SignalStore

Before writing a single test, decide what each test should prove. SignalStore tests fall into four levels:

1. **Store unit tests.** Instantiate the real store with `TestBed`, mock only external services, call methods, and assert signal values. This is the most common and most valuable test type.
2. **Custom feature tests.** Create a minimal throwaway `signalStore` that composes only the feature under test. Proves the feature works in isolation before integrating it into a larger store.
3. **Component tests with mock stores.** Replace the real store with a hand-crafted mock to verify that the component reads signals and calls methods correctly, without involving real state logic.
4. **Integration tests.** Test the full pipeline: component dispatches an event, the event handler calls a service, the service returns data, and the state updates. Use a real store with mocked HTTP.

Each level serves a different purpose. Skipping store unit tests and jumping straight to integration tests is a common mistake that leads to slow, fragile test suites. Skipping component mock tests means every component test depends on every store implementation detail.

## Setting Up a Store Unit Test

The foundation of SignalStore testing is straightforward: configure `TestBed` with the store as a provider, inject it, and read signals.

```typescript
// src/app/products/store/product-catalog.store.spec.ts
import { TestBed } from '@angular/core/testing';
import { ProductCatalogStore } from './product-catalog.store';
import { ProductService } from '../product.service';

describe('ProductCatalogStore', () => {
  let store: InstanceType<typeof ProductCatalogStore>;

  const mockProductService = {
    getAll: vi.fn(),
    search: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ProductCatalogStore,
        { provide: ProductService, useValue: mockProductService },
      ],
    });
    store = TestBed.inject(ProductCatalogStore);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should initialize with default state', () => {
    expect(store.products()).toEqual([]);
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
    expect(store.query()).toBe('');
  });
});
```

The store type is `InstanceType<typeof ProductCatalogStore>` because `signalStore()` returns a class, not an instance. `TestBed.inject()` creates the instance. Every external service is replaced with a mock object whose methods are Vitest fakes. This is Arrange-Act-Assert at its simplest: arrange the store, act by calling a method, assert by reading a signal.

## The unprotected() Helper

Since NgRx v18, SignalStore state is protected by default. The internal `[STATE_SOURCE]` symbol is not exposed, so tests cannot call `patchState()` directly on a store instance. This creates a problem during the Arrange phase: to test a computed signal that depends on specific state, you must either call every public method needed to reach that state (verbose) or bypass the protection.

The `unprotected()` helper from `@ngrx/signals/testing` solves this. It wraps the store to expose its state source, allowing `patchState()` to work in tests.

```typescript
// src/app/products/store/product-catalog.store.spec.ts
import { patchState } from '@ngrx/signals';
import { unprotected } from '@ngrx/signals/testing';
import { Product } from '../product.model';

describe('ProductCatalogStore - computed signals', () => {
  let store: InstanceType<typeof ProductCatalogStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ProductCatalogStore,
        { provide: ProductService, useValue: mockProductService },
      ],
    });
    store = TestBed.inject(ProductCatalogStore);
  });

  it('should compute featured products', () => {
    const products: Product[] = [
      { id: '1', name: 'Widget', price: 9.99, category: 'tools', description: 'A widget', featured: true },
      { id: '2', name: 'Gadget', price: 19.99, category: 'tools', description: 'A gadget', featured: false },
      { id: '3', name: 'Gizmo', price: 29.99, category: 'electronics', description: 'A gizmo', featured: true },
    ];

    patchState(unprotected(store), { products, loading: false });

    expect(store.featuredProducts().length).toBe(2);
    expect(store.featuredProducts().every(p => p.featured)).toBe(true);
  });

  it('should compute products filtered by category', () => {
    const products: Product[] = [
      { id: '1', name: 'Widget', price: 9.99, category: 'tools', description: 'A widget', featured: false },
      { id: '2', name: 'Gadget', price: 19.99, category: 'electronics', description: 'A gadget', featured: false },
    ];

    patchState(unprotected(store), { products, selectedCategory: 'tools' });

    expect(store.filteredProducts().length).toBe(1);
    expect(store.filteredProducts()[0].name).toBe('Widget');
  });
});
```

Use `unprotected()` only in the Arrange phase. If you find yourself using it in the Act phase, that is a sign the store is missing a public method.

## Testing Methods That Call Services

Most store methods call an injected service and update state based on the result. Test these by configuring the mock service to return specific values, calling the store method, and asserting both the service call and the resulting state.

```typescript
// src/app/products/store/product-catalog.store.spec.ts
import { of, throwError } from 'rxjs';

describe('ProductCatalogStore - loadProducts', () => {
  let store: InstanceType<typeof ProductCatalogStore>;

  const mockProductService = {
    getAll: vi.fn(),
    search: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ProductCatalogStore,
        { provide: ProductService, useValue: mockProductService },
      ],
    });
    store = TestBed.inject(ProductCatalogStore);
  });

  it('should load products and update state', async () => {
    const products: Product[] = [
      { id: '1', name: 'Widget', price: 9.99, category: 'tools', description: 'A widget', featured: false },
    ];
    mockProductService.getAll.mockReturnValue(of(products));

    store.loadProducts();
    await fixture.whenStable();

    expect(store.products()).toEqual(products);
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
    expect(mockProductService.getAll).toHaveBeenCalledOnce();
  });

  it('should handle errors and preserve existing products', async () => {
    const existingProducts: Product[] = [
      { id: '1', name: 'Widget', price: 9.99, category: 'tools', description: 'A widget', featured: false },
    ];
    patchState(unprotected(store), { products: existingProducts });

    mockProductService.getAll.mockReturnValue(
      throwError(() => new Error('Server unavailable'))
    );

    store.loadProducts();
    await fixture.whenStable();

    expect(store.error()).toBe('Server unavailable');
    expect(store.loading()).toBe(false);
    expect(store.products()).toEqual(existingProducts);
  });
});
```

The key insight: test the happy path and the error path separately. Verify that errors do not wipe existing state.

## Testing Entity Operations

Stores using `withEntities` have entity-specific signals (`entities`, `entityMap`, `ids`) and updaters (`setAllEntities`, `addEntity`, `updateEntity`, `removeEntity`). Use `unprotected()` with entity updaters to set up test data.

```typescript
// src/app/products/store/product-entity.store.spec.ts
import { TestBed } from '@angular/core/testing';
import { patchState } from '@ngrx/signals';
import { setAllEntities } from '@ngrx/signals/entities';
import { unprotected } from '@ngrx/signals/testing';
import { ProductEntityStore } from './product-entity.store';
import { Product } from '../product.model';

describe('ProductEntityStore', () => {
  let store: InstanceType<typeof ProductEntityStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ProductEntityStore],
    });
    store = TestBed.inject(ProductEntityStore);
  });

  it('should initialize with empty entities', () => {
    expect(store.entities()).toEqual([]);
    expect(store.ids()).toEqual([]);
  });

  it('should set entities and expose them through signals', () => {
    const products: Product[] = [
      { id: '1', name: 'Widget', price: 9.99, category: 'tools', description: 'A widget', featured: false },
      { id: '2', name: 'Gadget', price: 19.99, category: 'electronics', description: 'A gadget', featured: true },
    ];

    patchState(unprotected(store), setAllEntities(products));

    expect(store.entities().length).toBe(2);
    expect(store.entityMap()['1'].name).toBe('Widget');
    expect(store.ids()).toEqual(['1', '2']);
  });

  it('should add a product via the public method', () => {
    store.addProduct({
      id: '1', name: 'Widget', price: 9.99, category: 'tools', description: 'A widget', featured: false,
    });

    expect(store.entities().length).toBe(1);
  });

  it('should remove a product and update the count', () => {
    patchState(unprotected(store), setAllEntities([
      { id: '1', name: 'Widget', price: 9.99, category: 'tools', description: 'A widget', featured: false },
      { id: '2', name: 'Gadget', price: 19.99, category: 'electronics', description: 'A gadget', featured: true },
    ]));

    store.removeProduct('1');

    expect(store.entities().length).toBe(1);
    expect(store.entityMap()['1']).toBeUndefined();
  });
});
```

## Testing Event-Driven Stores

Stores using the Events plugin (Chapter 19) require `injectDispatch()` to send events. This function must be called within an injection context. Use `TestBed.runInInjectionContext()` to obtain a dispatcher in your test.

```typescript
// src/app/products/store/product-page.store.spec.ts
import { TestBed } from '@angular/core/testing';
import { injectDispatch } from '@ngrx/signals/events';
import { of, throwError } from 'rxjs';
import { ProductPageStore } from './product-page.store';
import { ProductPageEvents } from '../events/product-page.events';
import { ProductService } from '../product.service';
import { Product } from '../product.model';

describe('ProductPageStore - events', () => {
  let store: InstanceType<typeof ProductPageStore>;
  let dispatch: ReturnType<typeof injectDispatch<typeof ProductPageEvents>>;

  const mockProductService = {
    getAll: vi.fn(),
    search: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ProductPageStore,
        { provide: ProductService, useValue: mockProductService },
      ],
    });
    store = TestBed.inject(ProductPageStore);
    dispatch = TestBed.runInInjectionContext(() =>
      injectDispatch(ProductPageEvents)
    );
  });

  it('should load products when page opened event is dispatched', async () => {
    const products: Product[] = [
      { id: '1', name: 'Widget', price: 9.99, category: 'tools', description: 'A widget', featured: false },
    ];
    mockProductService.getAll.mockReturnValue(of(products));

    dispatch.opened();

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(store.products()).toEqual(products);
    expect(store.loading()).toBe(false);
    expect(mockProductService.getAll).toHaveBeenCalledOnce();
  });

  it('should set error state when API fails after page opened', async () => {
    mockProductService.getAll.mockReturnValue(
      throwError(() => new Error('Network error'))
    );

    dispatch.opened();

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(store.error()).toBe('Network error');
    expect(store.loading()).toBe(false);
  });
});
```

The `setTimeout(resolve, 0)` gives the event handler's Observable pipeline a microtask to complete. For more complex async flows, increase the delay or chain multiple `await` calls.

## Testing rxMethod

An `rxMethod` is backed by an RxJS pipeline. Test it by passing a static value and asserting the resulting state changes after the pipeline runs. Mock the service the pipeline calls.

```typescript
// src/app/products/store/product-search.store.spec.ts
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ProductSearchStore } from './product-search.store';
import { ProductService } from '../product.service';
import { Product } from '../product.model';

describe('ProductSearchStore - rxMethod', () => {
  let store: InstanceType<typeof ProductSearchStore>;

  const mockProductService = {
    search: vi.fn(),
    getAll: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [
        ProductSearchStore,
        { provide: ProductService, useValue: mockProductService },
      ],
    });
    store = TestBed.inject(ProductSearchStore);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should search after debounce period', async () => {
    const results: Product[] = [
      { id: '1', name: 'Widget', price: 9.99, category: 'tools', description: 'A widget', featured: false },
    ];
    mockProductService.search.mockReturnValue(of(results));

    store.search('wid');

    // Before debounce, the API should not be called
    expect(mockProductService.search).not.toHaveBeenCalled();

    // Advance past the 300ms debounce
    vi.advanceTimersByTime(300);

    expect(mockProductService.search).toHaveBeenCalledWith('wid');
    expect(store.results()).toEqual(results);
    expect(store.loading()).toBe(false);
  });

  it('should cancel previous search when a new query arrives', () => {
    mockProductService.search.mockReturnValue(of([]));

    store.search('wid');
    vi.advanceTimersByTime(100);

    store.search('widget');
    vi.advanceTimersByTime(300);

    // Only the second query should have been sent
    expect(mockProductService.search).toHaveBeenCalledOnce();
    expect(mockProductService.search).toHaveBeenCalledWith('widget');
  });
});
```

Vitest's `vi.useFakeTimers()` replaces `fakeAsync`/`tick` for controlling time-based operators like `debounceTime`. Advance the fake clock with `vi.advanceTimersByTime()` to push values through the pipeline.

## Testing Custom Store Features in Isolation

Chapter 18 introduced `signalStoreFeature` for reusable store logic. Test these features by composing a minimal throwaway store that includes only the feature under test.

```typescript
// src/app/shared/store-features/with-request-status.feature.spec.ts
import { TestBed } from '@angular/core/testing';
import { signalStore, withState } from '@ngrx/signals';
import { withRequestStatus } from './with-request-status.feature';

describe('withRequestStatus', () => {
  const TestStore = signalStore(
    withState({ data: null as string | null }),
    withRequestStatus(),
  );

  let store: InstanceType<typeof TestStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [TestStore],
    });
    store = TestBed.inject(TestStore);
  });

  it('should initialize with idle status', () => {
    expect(store.requestStatus()).toBe('idle');
    expect(store.isPending()).toBe(false);
    expect(store.isFulfilled()).toBe(false);
    expect(store.isError()).toBe(false);
  });

  it('should transition to pending', () => {
    store.setPending();

    expect(store.requestStatus()).toBe('pending');
    expect(store.isPending()).toBe(true);
    expect(store.isFulfilled()).toBe(false);
  });

  it('should transition to fulfilled', () => {
    store.setPending();
    store.setFulfilled();

    expect(store.requestStatus()).toBe('fulfilled');
    expect(store.isFulfilled()).toBe(true);
    expect(store.isPending()).toBe(false);
  });

  it('should transition to error with message', () => {
    store.setPending();
    store.setError('Something went wrong');

    expect(store.requestStatus()).toBe('error');
    expect(store.isError()).toBe(true);
    expect(store.errorMessage()).toBe('Something went wrong');
  });
});
```

The `TestStore` is declared inside the `describe` block. It exists only for this test file. This approach proves the feature works without coupling the test to any specific application store.

## Testing Components with Mock Stores

When testing a component that injects a SignalStore, you want to verify that the component reads and displays signals correctly and calls the right methods in response to user interaction. The store logic itself is not under test here, so we replace it with a mock.

For component-level stores (provided in the component's `providers` array), use `overrideComponent` to swap the provider.

```typescript
// src/app/products/components/product-list.component.spec.ts
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ProductListComponent } from './product-list.component';
import { ProductCatalogStore } from '../store/product-catalog.store';
import { Product } from '../product.model';

describe('ProductListComponent', () => {
  let fixture: ComponentFixture<ProductListComponent>;
  let component: ProductListComponent;

  const mockStore = {
    products: signal<Product[]>([]),
    loading: signal(false),
    error: signal<string | null>(null),
    featuredProducts: signal<Product[]>([]),
    filteredProducts: signal<Product[]>([]),
    loadProducts: vi.fn(),
    addProduct: vi.fn(),
    removeProduct: vi.fn(),
    setCategory: vi.fn(),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProductListComponent],
    })
      .overrideComponent(ProductListComponent, {
        set: {
          providers: [
            { provide: ProductCatalogStore, useValue: mockStore },
          ],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ProductListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should display products when loaded', async () => {
    mockStore.products.set([
      { id: '1', name: 'Widget', price: 9.99, category: 'tools', description: 'A widget', featured: false },
      { id: '2', name: 'Gadget', price: 19.99, category: 'electronics', description: 'A gadget', featured: true },
    ]);

    await fixture.whenStable();
    fixture.detectChanges();

    const items = fixture.nativeElement.querySelectorAll('[data-testid="product-item"]');
    expect(items.length).toBe(2);
  });

  it('should show loading indicator', async () => {
    mockStore.loading.set(true);

    await fixture.whenStable();
    fixture.detectChanges();

    const spinner = fixture.nativeElement.querySelector('[data-testid="loading"]');
    expect(spinner).toBeTruthy();
  });

  it('should call loadProducts on initialization', () => {
    expect(mockStore.loadProducts).toHaveBeenCalled();
  });

  it('should call setCategory when user selects a category', async () => {
    const select = fixture.nativeElement.querySelector('[data-testid="category-select"]');
    select.value = 'electronics';
    select.dispatchEvent(new Event('change'));

    await fixture.whenStable();

    expect(mockStore.setCategory).toHaveBeenCalledWith('electronics');
  });
});
```

The mock store uses writable `signal()` calls for every state property. This lets the test set signal values directly to simulate different store states. Methods are replaced with `vi.fn()` to track calls.

## Avoiding Lifecycle Hook Side Effects

If your store uses `withHooks()`, the `onInit` hook executes as soon as the store is instantiated, before your test's Arrange phase. This often triggers unwanted API calls or subscriptions. Replace `withHooks()` with `withOptionalHooks()` in stores where the hook runs side effects.

```typescript
// src/app/products/store/product-catalog.store.ts
import { signalStore, withState, withMethods, patchState } from '@ngrx/signals';
import { withOptionalHooks } from '@ngrx/signals';
import { inject } from '@angular/core';
import { ProductService } from '../product.service';

export const ProductCatalogStore = signalStore(
  withState({ products: [] as Product[], loading: false, error: null as string | null }),
  withMethods((store, productService = inject(ProductService)) => ({
    loadProducts(): void {
      patchState(store, { loading: true });
      productService.getAll().subscribe({
        next: (products) => patchState(store, { products, loading: false }),
        error: (err) => patchState(store, { error: err.message, loading: false }),
      });
    },
  })),
  withOptionalHooks({
    onInit(store) {
      store.loadProducts();
    },
  }),
);
```

With `withOptionalHooks`, the `onInit` hook runs in application code but is skipped during testing. This gives your test full control over when `loadProducts` is called.

## Common Mistakes

### Mistake 1: Calling patchState on a Protected Store Without unprotected()

```typescript
// WRONG: This will throw a runtime error
it('should filter products', () => {
  const store = TestBed.inject(ProductCatalogStore);
  patchState(store, { products: mockProducts }); // TypeError: Cannot read STATE_SOURCE

  expect(store.filteredProducts().length).toBe(2);
});
```

The store's state is protected. `patchState` cannot access the internal state source. Wrap the store with `unprotected()`.

```typescript
// CORRECT
import { unprotected } from '@ngrx/signals/testing';

it('should filter products', () => {
  const store = TestBed.inject(ProductCatalogStore);
  patchState(unprotected(store), { products: mockProducts });

  expect(store.filteredProducts().length).toBe(2);
});
```

### Mistake 2: Using fakeAsync and tick in Zoneless Angular

```typescript
// WRONG: fakeAsync is not available in zoneless Angular 21
it('should load products', fakeAsync(() => {
  mockProductService.getAll.mockReturnValue(of(mockProducts));
  store.loadProducts();
  tick();
  expect(store.products()).toEqual(mockProducts);
}));
```

Angular 21 runs without Zone.js by default. The `fakeAsync` utility depends on Zone.js and is not available. Use `async`/`await` with `fixture.whenStable()`, `TestBed.flushEffects()`, or Vitest's fake timers for time-based operators.

```typescript
// CORRECT: Use async/await
it('should load products', async () => {
  mockProductService.getAll.mockReturnValue(of(mockProducts));
  store.loadProducts();
  await fixture.whenStable();
  expect(store.products()).toEqual(mockProducts);
});

// CORRECT: Use fake timers for debounce/delay
it('should search with debounce', () => {
  vi.useFakeTimers();
  mockProductService.search.mockReturnValue(of([]));
  store.search('query');
  vi.advanceTimersByTime(300);
  expect(mockProductService.search).toHaveBeenCalledWith('query');
  vi.useRealTimers();
});
```

### Mistake 3: Using withHooks Instead of withOptionalHooks for Side Effects

```typescript
// WRONG: onInit fires immediately on TestBed.inject(), hitting the real API
export const MyStore = signalStore(
  withState({ data: [] as Item[] }),
  withHooks({
    onInit(store) {
      inject(DataService).fetchAll().subscribe(data =>
        patchState(store, { data })
      );
    },
  }),
);
```

The test has no chance to configure the mock service before `onInit` runs. Use `withOptionalHooks` to skip the hook during testing.

```typescript
// CORRECT: withOptionalHooks skips in test context
export const MyStore = signalStore(
  withState({ data: [] as Item[] }),
  withMethods((store, dataService = inject(DataService)) => ({
    loadData(): void {
      dataService.fetchAll().subscribe(data =>
        patchState(store, { data })
      );
    },
  })),
  withOptionalHooks({
    onInit(store) {
      store.loadData();
    },
  }),
);
```

### Mistake 4: Creating Incomplete Mock Stores

```typescript
// WRONG: Missing signals that the component template reads
const mockStore = {
  products: signal([]),
  loadProducts: vi.fn(),
  // Template also reads store.loading() and store.error() - missing!
};
```

The component template reads `store.loading()` and `store.error()`. If the mock does not include these signals, the template throws at runtime. Always include every signal and method that the component accesses.

```typescript
// CORRECT: Every signal and method the component uses is present
const mockStore = {
  products: signal<Product[]>([]),
  loading: signal(false),
  error: signal<string | null>(null),
  loadProducts: vi.fn(),
};
```

## Key Takeaways

- **Use `unprotected()` from `@ngrx/signals/testing` to set up test state.** It bypasses protected state encapsulation, letting you call `patchState()` directly during the Arrange phase without routing through public methods.

- **Test custom store features with minimal throwaway stores.** Create a `signalStore` inside your test that composes only the feature under test. This isolates the feature from application-specific state and methods, making failures easy to diagnose.

- **Mock stores for component tests, not for store tests.** When testing the store itself, use the real store with mocked services. When testing a component that consumes the store, replace the entire store with writable signals and spy functions.

- **Replace `withHooks` with `withOptionalHooks` when hooks trigger side effects.** This prevents `onInit` from firing during `TestBed.inject()`, giving your test full control over when side effects execute.

- **Use Vitest fake timers instead of `fakeAsync`/`tick`.** Angular 21 is zoneless. Time-based RxJS operators like `debounceTime` and `delay` are controlled via `vi.useFakeTimers()` and `vi.advanceTimersByTime()`.
