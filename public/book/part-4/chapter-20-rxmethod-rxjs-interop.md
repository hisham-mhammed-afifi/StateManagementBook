# Chapter 20: rxMethod and RxJS Interop in SignalStore

Your product catalog store needs to call an API whenever the user types in a search box. You want debouncing so the API is not hammered on every keystroke, cancellation so a slow response does not overwrite a newer one, and retry logic so transient network errors do not leave the UI in a broken state. These are RxJS problems. Signals are synchronous reactive primitives. They do not have operators for time, concurrency, or error recovery. You need a bridge that lets the SignalStore hold signal-based state while delegating async orchestration to RxJS pipelines. That bridge is `rxMethod`.

This chapter covers `rxMethod` from `@ngrx/signals/rxjs-interop`, Angular's built-in signal/observable converters (`toSignal`, `toObservable`, `takeUntilDestroyed`), and the `tapResponse` operator from `@ngrx/operators`. Together, these tools let you combine the simplicity of signals with the power of RxJS operators, without sacrificing either.

## A Quick Recap

In Chapters 15 through 19, we built SignalStore stores using `withState` for reactive state, `withComputed` for derived signals, `withMethods` for synchronous and async operations via `patchState`, `withEntities` for normalized collections, `withHooks` for lifecycle, and `withEventHandlers` for event-driven side effects. All of those chapters used RxJS lightly or avoided it entirely. This chapter embraces RxJS head-on, showing when and how to integrate operator chains into your signal-based stores.

## What rxMethod Does

`rxMethod` creates a store method backed by an RxJS pipeline. You define the pipeline once, and the method accepts inputs of several types: a static value, a Signal, a computation function, or an Observable. Internally, `rxMethod` converts whatever you pass into an Observable, pushes it through your pipeline, and manages the subscription lifecycle automatically.

```
import { rxMethod } from '@ngrx/signals/rxjs-interop';
```

The signature:

```typescript
rxMethod<Input>(
  generator: (source$: Observable<Input>) => Observable<unknown>
): RxMethodRef<Input>
```

The generic type parameter `Input` defines what the method accepts. The `generator` function receives a source Observable of that type and returns the transformed Observable. The return value is an `RxMethodRef`, a callable function that also exposes a `destroy()` method for manual cleanup.

### The Four Input Types

The same `rxMethod` can be invoked four different ways:

| Input | Behavior | When to use |
|-------|----------|-------------|
| Static value `T` | Emits once | Imperative calls from event handlers or lifecycle hooks |
| `Signal<T>` | Re-emits whenever the signal changes | Reactive binding to component state |
| `() => T` (computation) | Re-emits when any read signal changes | Combining multiple signals without an intermediate computed (NgRx 21+) |
| `Observable<T>` | Proxies all emissions | Integrating external streams like route params or WebSocket messages |

Here is a minimal example showing all four invocations:

```typescript
// src/app/products/store/product-search.store.ts
import { inject } from '@angular/core';
import { signalStore, withState, withMethods, patchState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { tapResponse } from '@ngrx/operators';
import { pipe, switchMap, debounceTime, distinctUntilChanged, tap } from 'rxjs';
import { ProductService } from '../product.service';
import { Product } from '../product.model';

type SearchState = {
  query: string;
  results: Product[];
  loading: boolean;
  error: string | null;
};

export const ProductSearchStore = signalStore(
  withState<SearchState>({
    query: '',
    results: [],
    loading: false,
    error: null,
  }),
  withMethods((store, productService = inject(ProductService)) => ({
    search: rxMethod<string>(
      pipe(
        tap((query) => patchState(store, { query })),
        debounceTime(300),
        distinctUntilChanged(),
        tap(() => patchState(store, { loading: true })),
        switchMap((query) =>
          productService.search(query).pipe(
            tapResponse({
              next: (results) => patchState(store, { results, loading: false }),
              error: (err: { message: string }) =>
                patchState(store, { error: err.message, loading: false }),
            }),
          ),
        ),
      ),
    ),
  })),
);
```

```typescript
// src/app/products/product-search.component.ts
import { Component, inject, signal, OnInit } from '@angular/core';
import { interval, map } from 'rxjs';
import { ProductSearchStore } from './store/product-search.store';

@Component({
  selector: 'app-product-search',
  standalone: true,
  providers: [ProductSearchStore],
  template: `
    <input
      type="text"
      placeholder="Search products..."
      (input)="onInput($event)"
    />

    @if (store.loading()) {
      <p>Searching...</p>
    }

    @for (product of store.results(); track product.id) {
      <div class="product-card">
        <h3>{{ product.name }}</h3>
        <p>{{ product.price | currency }}</p>
      </div>
    } @empty {
      @if (!store.loading() && store.query()) {
        <p>No products found for "{{ store.query() }}".</p>
      }
    }
  `,
})
export class ProductSearchComponent implements OnInit {
  protected readonly store = inject(ProductSearchStore);
  private readonly query = signal('');

  ngOnInit(): void {
    // Option 1: Static value (emits once)
    this.store.search('electronics');

    // Option 2: Signal (re-emits on every change)
    this.store.search(this.query);

    // Option 3: Observable (proxies emissions)
    const query$ = interval(60000).pipe(map(() => this.query()));
    this.store.search(query$);
  }

  onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.query.set(value);
  }
}
```

In practice, you pick one invocation style per use case. The example above shows all three for illustration. Passing a Signal is the most common pattern because it creates a live reactive link between the component and the store.

## The Computation Function Overload

NgRx 21 introduced a fourth invocation style: computation functions. When you pass a function `() => T` to an rxMethod, NgRx tracks the signal dependencies inside that function and re-runs the pipeline whenever any of them change. This eliminates the need for intermediate `computed` signals when you want to combine multiple signals.

```typescript
// src/app/products/store/product-catalog.store.ts
import { inject } from '@angular/core';
import { signalStore, withState, withMethods, patchState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { tapResponse } from '@ngrx/operators';
import { pipe, switchMap, tap } from 'rxjs';
import { ProductService } from '../product.service';
import { Product } from '../product.model';

type CatalogState = {
  query: string;
  categoryId: string;
  page: number;
  products: Product[];
  loading: boolean;
};

export const ProductCatalogStore = signalStore(
  withState<CatalogState>({
    query: '',
    categoryId: 'all',
    page: 1,
    products: [],
    loading: false,
  }),
  withMethods((store, productService = inject(ProductService)) => ({
    setQuery(query: string): void {
      patchState(store, { query, page: 1 });
    },
    setCategory(categoryId: string): void {
      patchState(store, { categoryId, page: 1 });
    },
    setPage(page: number): void {
      patchState(store, { page });
    },
    loadProducts: rxMethod<void>(
      pipe(
        tap(() => patchState(store, { loading: true })),
        switchMap(() =>
          productService
            .searchCatalog(store.query(), store.categoryId(), store.page())
            .pipe(
              tapResponse({
                next: (products) =>
                  patchState(store, { products, loading: false }),
                error: () => patchState(store, { loading: false }),
              }),
            ),
        ),
      ),
    ),
  })),
);
```

```typescript
// src/app/products/product-catalog.component.ts
import { Component, inject, OnInit } from '@angular/core';
import { ProductCatalogStore } from './store/product-catalog.store';

@Component({
  selector: 'app-product-catalog',
  standalone: true,
  providers: [ProductCatalogStore],
  template: `
    <input
      type="text"
      placeholder="Search..."
      (input)="store.setQuery(getValue($event))"
    />
    <select (change)="store.setCategory(getValue($event))">
      <option value="all">All Categories</option>
      <option value="electronics">Electronics</option>
      <option value="clothing">Clothing</option>
    </select>

    @for (product of store.products(); track product.id) {
      <div>{{ product.name }}</div>
    }

    <button (click)="store.setPage(store.page() + 1)">Next Page</button>
  `,
})
export class ProductCatalogComponent implements OnInit {
  protected readonly store = inject(ProductCatalogStore);

  ngOnInit(): void {
    // Computation function: re-runs when query, categoryId, or page change
    this.store.loadProducts(() => {
      // Reading these signals registers them as dependencies
      store.query();
      store.categoryId();
      store.page();
    });
  }

  getValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
```

The computation function reads `store.query()`, `store.categoryId()`, and `store.page()` inside the callback. NgRx detects these reads and re-triggers the pipeline whenever any of those signals change. Before NgRx 21, you would have needed:

```typescript
// The old approach: intermediate computed signal
const params = computed(() => ({
  query: store.query(),
  categoryId: store.categoryId(),
  page: store.page(),
}));
this.store.loadProducts(params);
```

The computation function achieves the same result with less boilerplate.

## tapResponse: Error Handling That Keeps the Stream Alive

Every `rxMethod` example in this chapter uses `tapResponse` from `@ngrx/operators`. This is not optional. If an HTTP call throws inside a `switchMap` and nothing catches the error, the rxMethod's internal Observable terminates permanently. All future inputs are silently ignored.

`tapResponse` combines three behaviors into one operator:

1. **Success handling** (like `tap`): runs when the inner Observable emits a value
2. **Error handling** (like `catchError`): runs when the inner Observable errors, then re-subscribes
3. **Finalize** (like `finalize`): runs after the inner Observable completes or errors

```typescript
// src/app/shared/operators/tap-response-example.ts
import { tapResponse } from '@ngrx/operators';

// Inside an rxMethod pipe
switchMap((id: string) =>
  productService.getById(id).pipe(
    tapResponse({
      next: (product) => patchState(store, { product, loading: false }),
      error: (err: { message: string }) =>
        patchState(store, { error: err.message, loading: false }),
      finalize: () => console.log('Request completed or errored'),
    }),
  ),
),
```

The critical property: `tapResponse` catches the error inside the inner Observable, so the outer stream (the rxMethod's source) stays alive. The next time the user triggers the method, it works normally.

## Angular's RxJS Interop Utilities

Angular provides its own set of signal/observable bridge functions in `@angular/core/rxjs-interop`. These are not NgRx-specific. They work anywhere in Angular and complement `rxMethod` when you need to convert between signals and observables outside of a store method.

### toSignal: Observable to Signal

`toSignal` subscribes to an Observable and exposes its latest value as a Signal. It subscribes immediately and auto-unsubscribes when the injection context is destroyed.

```typescript
// src/app/products/store/route-aware.store.ts
import { inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { signalStore, withState, withMethods, withProps, patchState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { tapResponse } from '@ngrx/operators';
import { pipe, switchMap, tap, map } from 'rxjs';
import { ProductService } from '../product.service';
import { Product } from '../product.model';

export const ProductDetailStore = signalStore(
  withState({
    product: null as Product | null,
    loading: false,
  }),
  withProps(() => {
    const route = inject(ActivatedRoute);
    return {
      productId: toSignal(
        route.params.pipe(map((p) => p['id'] as string)),
        { initialValue: '' },
      ),
    };
  }),
  withMethods((store, productService = inject(ProductService)) => ({
    loadProduct: rxMethod<string>(
      pipe(
        tap(() => patchState(store, { loading: true })),
        switchMap((id) =>
          productService.getById(id).pipe(
            tapResponse({
              next: (product) => patchState(store, { product, loading: false }),
              error: () => patchState(store, { product: null, loading: false }),
            }),
          ),
        ),
      ),
    ),
  })),
);
```

The `toSignal` call inside `withProps` converts the route params Observable into a signal. This signal can then be passed to `rxMethod` as a reactive trigger, or read directly in computed signals and templates.

Key rules for `toSignal`:

- **`initialValue` is required** for asynchronous Observables (HTTP calls, route params, timers). Without it, the signal's type becomes `Signal<T | undefined>`.
- **`requireSync: true`** is for synchronous Observables like `BehaviorSubject` or `of()`. It asserts that the Observable emits immediately on subscription. If it does not, Angular throws a runtime error.
- **`toSignal` subscribes immediately.** If the source Observable triggers side effects (like an HTTP call), those side effects fire even if the signal is never read.

### toObservable: Signal to Observable

`toObservable` converts a Signal into an Observable that emits whenever the signal's value changes. It requires an injection context.

```typescript
// src/app/products/store/filtered-catalog.store.ts
import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { signalStore, withState, withHooks, patchState } from '@ngrx/signals';
import { tapResponse } from '@ngrx/operators';
import { switchMap, filter, debounceTime } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ProductService } from '../product.service';
import { Product } from '../product.model';

export const FilteredCatalogStore = signalStore(
  withState({
    categoryId: '',
    products: [] as Product[],
  }),
  withHooks({
    onInit(store, productService = inject(ProductService)) {
      toObservable(store.categoryId)
        .pipe(
          filter((id) => id !== ''),
          debounceTime(200),
          switchMap((id) =>
            productService.getByCategory(id).pipe(
              tapResponse({
                next: (products) => patchState(store, { products }),
                error: () => patchState(store, { products: [] }),
              }),
            ),
          ),
          takeUntilDestroyed(),
        )
        .subscribe();
    },
  }),
);
```

This pattern is useful when you want to react to signal changes with RxJS operators but the store does not define an `rxMethod` for it. The `toObservable` + `takeUntilDestroyed` combination in `withHooks.onInit` gives you the full power of RxJS with automatic cleanup.

### takeUntilDestroyed: Lifecycle-Aware Subscriptions

`takeUntilDestroyed` is an RxJS operator that completes the Observable when the component or service is destroyed. It auto-injects `DestroyRef` when called within an injection context.

```typescript
// src/app/products/product-detail.component.ts
import { Component, inject, OnInit } from '@angular/core';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter, switchMap } from 'rxjs';
import { ProductDetailStore } from './store/route-aware.store';

@Component({
  selector: 'app-product-detail',
  standalone: true,
  providers: [ProductDetailStore],
  template: `
    @if (store.loading()) {
      <p>Loading product...</p>
    } @else if (store.product(); as product) {
      <h1>{{ product.name }}</h1>
      <p>{{ product.price | currency }}</p>
    }
  `,
})
export class ProductDetailComponent {
  protected readonly store = inject(ProductDetailStore);

  constructor() {
    // Reactively load product whenever the route-derived productId changes
    toObservable(this.store.productId)
      .pipe(
        filter((id) => id !== ''),
        takeUntilDestroyed(),
      )
      .subscribe((id) => this.store.loadProduct(id));
  }
}
```

The subscription starts in the constructor (an injection context) so `takeUntilDestroyed` can inject `DestroyRef` automatically. When the component is destroyed, the subscription completes.

## Choosing the Right Higher-Order Mapping Operator

The operator you place before your inner Observable in an `rxMethod` pipeline determines how concurrent requests are handled. This choice has real consequences for your application's behavior.

| Operator | Behavior | Best for |
|----------|----------|----------|
| `switchMap` | Cancels the previous inner Observable when a new value arrives | Search, autocomplete, filter changes |
| `exhaustMap` | Ignores new values while the current inner Observable is active | Form submission, button clicks |
| `concatMap` | Queues values and processes them one at a time, in order | Sequential saves, ordered operations |
| `mergeMap` | Runs all inner Observables concurrently | Independent parallel requests |

```typescript
// src/app/orders/store/order-submit.store.ts
import { inject } from '@angular/core';
import { signalStore, withState, withMethods, patchState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { tapResponse } from '@ngrx/operators';
import { pipe, exhaustMap, tap } from 'rxjs';
import { OrderService } from '../order.service';

interface OrderSubmitState {
  submitting: boolean;
  lastOrderId: string | null;
  error: string | null;
}

export const OrderSubmitStore = signalStore(
  withState<OrderSubmitState>({
    submitting: false,
    lastOrderId: null,
    error: null,
  }),
  withMethods((store, orderService = inject(OrderService)) => ({
    submitOrder: rxMethod<{ items: { productId: string; quantity: number }[] }>(
      pipe(
        tap(() => patchState(store, { submitting: true, error: null })),
        exhaustMap((order) =>
          orderService.submit(order.items).pipe(
            tapResponse({
              next: (orderId) =>
                patchState(store, { lastOrderId: orderId, submitting: false }),
              error: (err: { message: string }) =>
                patchState(store, { error: err.message, submitting: false }),
            }),
          ),
        ),
      ),
    ),
  })),
);
```

`exhaustMap` is the right choice here because double-clicking the "Place Order" button should not submit two orders. While the first request is in flight, subsequent clicks are silently dropped.

## Polling with rxMethod

A dashboard that shows real-time inventory levels needs periodic API polling. `rxMethod` with `switchMap` and `interval` handles this cleanly.

```typescript
// src/app/dashboard/store/inventory-dashboard.store.ts
import { inject } from '@angular/core';
import { signalStore, withState, withMethods, patchState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { tapResponse } from '@ngrx/operators';
import { pipe, switchMap, interval, startWith } from 'rxjs';
import { InventoryService } from '../inventory.service';

interface StockLevel {
  productId: string;
  productName: string;
  available: number;
}

export const InventoryDashboardStore = signalStore(
  withState({ stockLevels: [] as StockLevel[] }),
  withMethods((store, inventoryService = inject(InventoryService)) => ({
    startPolling: rxMethod<number>(
      pipe(
        switchMap((intervalMs) =>
          interval(intervalMs).pipe(
            startWith(0),
            switchMap(() =>
              inventoryService.getStockLevels().pipe(
                tapResponse({
                  next: (stockLevels) => patchState(store, { stockLevels }),
                  error: () => {
                    /* Keep stale data on polling failure */
                  },
                }),
              ),
            ),
          ),
        ),
      ),
    ),
  })),
);
```

```typescript
// src/app/dashboard/inventory-dashboard.component.ts
import { Component, inject, OnInit } from '@angular/core';
import { InventoryDashboardStore } from './store/inventory-dashboard.store';

@Component({
  selector: 'app-inventory-dashboard',
  standalone: true,
  providers: [InventoryDashboardStore],
  template: `
    <h2>Inventory Levels</h2>
    <table>
      <thead>
        <tr><th>Product</th><th>In Stock</th></tr>
      </thead>
      <tbody>
        @for (stock of store.stockLevels(); track stock.productId) {
          <tr>
            <td>{{ stock.productName }}</td>
            <td>{{ stock.available }}</td>
          </tr>
        }
      </tbody>
    </table>
  `,
})
export class InventoryDashboardComponent implements OnInit {
  protected readonly store = inject(InventoryDashboardStore);

  ngOnInit(): void {
    this.store.startPolling(10000); // Poll every 10 seconds
  }
}
```

The outer `switchMap` ensures that if `startPolling` is called again with a different interval, the previous polling loop is cancelled. The inner `switchMap` ensures that a slow API response does not stack up behind a faster polling tick.

## Lifecycle and Cleanup

`rxMethod` ties its subscription to the injector that created the store. For a component-scoped store (provided via `providers: [MyStore]`), the subscription is destroyed when the component is destroyed. For a root-scoped store (`providedIn: 'root'`), the subscription lives for the entire application lifetime.

Manual cleanup is available via the `destroy()` method on the returned `RxMethodRef`:

```typescript
// src/app/dashboard/dashboard-host.component.ts
import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { InventoryDashboardStore } from './store/inventory-dashboard.store';
import { RxMethodRef } from '@ngrx/signals/rxjs-interop';

@Component({
  selector: 'app-dashboard-host',
  standalone: true,
  providers: [InventoryDashboardStore],
  template: `<app-inventory-dashboard />`,
})
export class DashboardHostComponent implements OnInit, OnDestroy {
  private readonly store = inject(InventoryDashboardStore);
  private pollingRef: RxMethodRef<number> | undefined;

  ngOnInit(): void {
    // store.startPolling returns an RxMethodRef
    this.pollingRef = this.store.startPolling(10000);
  }

  ngOnDestroy(): void {
    // Explicit cleanup (usually unnecessary for component-scoped stores)
    this.pollingRef?.destroy();
  }
}
```

In most cases, you do not need to call `destroy()` manually. The automatic injector-based cleanup handles it. The manual approach is useful when you need to stop a long-running operation (like polling) before the store itself is destroyed.

## rxMethod vs withEventHandlers vs effect

Three different tools handle side effects in NgRx SignalStore. Each serves a different purpose:

| Tool | Package | Best for |
|------|---------|----------|
| `rxMethod` | `@ngrx/signals/rxjs-interop` | RxJS-heavy async operations within a single store: debouncing, polling, retry, cancellation |
| `withEventHandlers` | `@ngrx/signals/events` | Event-driven cross-store communication using the dispatcher/reducer pattern (Chapter 19) |
| `effect` | `@angular/core` | Simple signal-watching side effects with no RxJS operators needed |

Use `rxMethod` when you need RxJS operators. Use `withEventHandlers` when multiple stores coordinate through events. Use Angular's `effect()` when you need a basic "run this code whenever a signal changes" with no operator composition.

## Common Mistakes

### Mistake 1: Handling Errors Outside the Inner Observable

```typescript
// WRONG: error in tap before switchMap kills the entire stream
readonly search = rxMethod<string>(
  pipe(
    tap((query) => {
      if (!query) throw new Error('Query cannot be empty');
    }),
    switchMap((query) =>
      productService.search(query).pipe(
        tapResponse({
          next: (results) => patchState(store, { results }),
          error: () => patchState(store, { results: [] }),
        }),
      ),
    ),
  ),
);
```

The `throw` in `tap` happens in the outer Observable. `tapResponse` only protects the inner Observable inside `switchMap`. Once the outer stream errors, the rxMethod is dead. No future calls will trigger the pipeline.

```typescript
// CORRECT: validate inside the inner Observable, or filter instead of throwing
readonly search = rxMethod<string>(
  pipe(
    filter((query) => query.length > 0),
    switchMap((query) =>
      productService.search(query).pipe(
        tapResponse({
          next: (results) => patchState(store, { results }),
          error: () => patchState(store, { results: [] }),
        }),
      ),
    ),
  ),
);
```

Use `filter` to skip invalid inputs. Never throw in the outer pipeline.

### Mistake 2: Using toSignal for Side-Effectful Observables Without Reading the Signal

```typescript
// WRONG: toSignal subscribes immediately, firing the HTTP call
// even though nobody reads productSignal
const productSignal = toSignal(
  productService.getById('123'),
  { initialValue: null },
);
```

`toSignal` subscribes on creation, not on first read. If the Observable triggers an HTTP call, that call fires immediately. If you create the signal conditionally or never read it, you still pay the cost.

```typescript
// CORRECT: use rxMethod for on-demand HTTP calls
readonly loadProduct = rxMethod<string>(
  pipe(
    switchMap((id) =>
      productService.getById(id).pipe(
        tapResponse({
          next: (product) => patchState(store, { product }),
          error: () => patchState(store, { product: null }),
        }),
      ),
    ),
  ),
);
```

Reserve `toSignal` for Observables that should be "always on" (route params, auth state, WebSocket streams). Use `rxMethod` for on-demand operations.

### Mistake 3: Passing a Component Signal to a Root Store's rxMethod

```typescript
// WRONG: memory leak when component is destroyed
@Component({
  selector: 'app-search',
  template: `<input (input)="query.set(getValue($event))">`,
})
export class SearchComponent implements OnInit {
  private readonly store = inject(GlobalSearchStore); // providedIn: 'root'
  readonly query = signal('');

  ngOnInit(): void {
    // This subscription lives as long as the ROOT store, not the component
    this.store.search(this.query);
  }
}
```

When you pass a Signal to an rxMethod on a root-provided store, the subscription is tied to the root injector. It lives forever. Each time the component is created and destroyed, a new subscription is added but the old ones are never cleaned up.

```typescript
// CORRECT: use toObservable + takeUntilDestroyed for component-scoped reactivity
@Component({
  selector: 'app-search',
  template: `<input (input)="query.set(getValue($event))">`,
})
export class SearchComponent {
  private readonly store = inject(GlobalSearchStore);
  readonly query = signal('');

  constructor() {
    toObservable(this.query)
      .pipe(takeUntilDestroyed())
      .subscribe((q) => this.store.search(q));
  }

  getValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
```

The `takeUntilDestroyed` operator ensures the subscription ends when the component is destroyed, regardless of the store's scope.

### Mistake 4: Using switchMap for Save Operations

```typescript
// WRONG: switchMap cancels the previous save if the user clicks fast
readonly saveProduct = rxMethod<Product>(
  pipe(
    switchMap((product) =>
      productService.save(product).pipe(
        tapResponse({
          next: () => patchState(store, { saved: true }),
          error: () => patchState(store, { error: 'Save failed' }),
        }),
      ),
    ),
  ),
);
```

If the user clicks "Save" twice quickly, `switchMap` cancels the first HTTP request. The first save may have partially completed on the server, leaving data in an inconsistent state.

```typescript
// CORRECT: use exhaustMap to ignore duplicate clicks, or concatMap to queue them
readonly saveProduct = rxMethod<Product>(
  pipe(
    exhaustMap((product) =>
      productService.save(product).pipe(
        tapResponse({
          next: () => patchState(store, { saved: true }),
          error: () => patchState(store, { error: 'Save failed' }),
        }),
      ),
    ),
  ),
);
```

`exhaustMap` drops new emissions while the current save is in progress. `concatMap` queues them. Either is safer than `switchMap` for write operations.

## Key Takeaways

- **`rxMethod` bridges SignalStore and RxJS.** It accepts static values, Signals, computation functions, or Observables as input, converts them into an Observable stream, and runs them through your RxJS pipeline with automatic subscription management.

- **Always use `tapResponse` inside the inner Observable.** An unhandled error in the outer stream permanently kills the rxMethod. `tapResponse` catches errors in the inner Observable, keeping the outer stream alive for future inputs.

- **Choose your flattening operator deliberately.** `switchMap` for search and read operations (cancel stale requests). `exhaustMap` for form submissions (ignore duplicates). `concatMap` for ordered writes. `mergeMap` for independent parallel operations.

- **Beware of memory leaks with root-scoped stores.** Passing a component Signal to an rxMethod on a `providedIn: 'root'` store creates a subscription that outlives the component. Use `toObservable` + `takeUntilDestroyed` instead, or provide the store at the component level.

- **`toSignal` and `toObservable` are general-purpose Angular utilities, not NgRx-specific.** Use `toSignal` for always-on streams (route params, auth state). Use `toObservable` when you need to feed a signal's changes into an RxJS pipeline. Use `rxMethod` when the pipeline lives inside a SignalStore.
