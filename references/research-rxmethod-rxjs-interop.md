# Research: rxMethod and RxJS Interop in SignalStore

**Date:** 2026-04-01
**Chapter:** Ch 20
**Status:** Ready for chapter generation

## API Surface

### rxMethod

- **Import:** `import { rxMethod } from '@ngrx/signals/rxjs-interop';`
- **Signature:** `rxMethod<Input>(generator: (source$: Observable<Input>) => Observable<unknown>): RxMethodRef<Input>`
- **Stability:** Stable
- **Purpose:** Creates a reactive method inside SignalStore that leverages RxJS operators for side effects (HTTP calls, debouncing, polling, retry). Accepts multiple input types: static values, Signals, computation functions, or Observables.

**Input types and behavior:**

| Input Type | Behavior | Example |
|------------|----------|---------|
| Static value `T` | Emits once | `store.load('angular')` |
| Signal `Signal<T>` | Re-emits on every signal change | `store.load(querySignal)` |
| Computation `() => T` | Re-emits when dependencies change (NgRx 21+) | `store.load(() => this.query())` |
| Observable `Observable<T>` | Proxies emissions | `store.load(query$)` |

**Returns:** `RxMethodRef<Input>` which is a callable function with a `destroy()` method for manual cleanup. Automatic cleanup occurs when the injector is destroyed.

```typescript
// products/store/product.store.ts
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { signalStore, withState, withMethods, patchState } from '@ngrx/signals';
import { tapResponse } from '@ngrx/operators';
import { pipe, switchMap, debounceTime, distinctUntilChanged, tap } from 'rxjs';

export const ProductStore = signalStore(
  withState({
    products: [] as Product[],
    query: '',
    loading: false,
    error: null as string | null,
  }),
  withMethods((store, productService = inject(ProductService)) => ({
    searchProducts: rxMethod<string>(
      pipe(
        debounceTime(300),
        distinctUntilChanged(),
        tap(() => patchState(store, { loading: true })),
        switchMap((query) =>
          productService.search(query).pipe(
            tapResponse({
              next: (products) => patchState(store, { products, loading: false }),
              error: (err: HttpErrorResponse) =>
                patchState(store, { error: err.message, loading: false }),
            }),
          ),
        ),
      ),
    ),
  })),
);
```

### Computation Function Overload (NgRx 21+)

- **New in NgRx 21:** rxMethod can now accept a computation function `() => T` that reads multiple signals and re-runs automatically when any dependency changes.
- **Eliminates:** the need for intermediate computed signals just to feed rxMethod.

```typescript
// Before NgRx 21: required intermediate computed signal
const params = computed(() => ({ query: store.query(), page: store.page() }));
store.loadProducts(params);

// NgRx 21: computation function inline
readonly loadProducts = rxMethod<void>(
  pipe(
    switchMap(() =>
      productService.search(store.query(), store.page()).pipe(
        tapResponse({
          next: (products) => patchState(store, { products }),
          error: (err) => patchState(store, { error: err.message }),
        }),
      ),
    ),
  ),
);
// Called: store.loadProducts()  -- automatically re-runs when query or page change
```

### tapResponse

- **Import:** `import { tapResponse } from '@ngrx/operators';`
- **Signature:** `tapResponse<T>({ next: (value: T) => void, error: (error: unknown) => void, finalize?: () => void })`
- **Stability:** Stable
- **Purpose:** Combines tap, catchError, and finalize. Enforces error handling and prevents stream termination on errors.
- **Note:** Moved from `@ngrx/component-store` to `@ngrx/operators` package.

```typescript
// Standalone usage within rxMethod
switchMap((id) =>
  productService.getById(id).pipe(
    tapResponse({
      next: (product) => patchState(store, { selectedProduct: product }),
      error: (err: HttpErrorResponse) => patchState(store, { error: err.message }),
      finalize: () => patchState(store, { loading: false }),
    }),
  ),
),
```

### Angular RxJS Interop Utilities

All from `@angular/core/rxjs-interop`:

#### toSignal

- **Import:** `import { toSignal } from '@angular/core/rxjs-interop';`
- **Signature:** `toSignal<T>(source: Observable<T>, options?: ToSignalOptions<T>): Signal<T>`
- **Stability:** Stable
- **Options:**
  - `initialValue?: T` -- provides initial value before first emission
  - `requireSync?: boolean` -- asserts Observable emits synchronously (BehaviorSubject, of())
  - `injector?: Injector` -- manual injector for use outside injection context
  - `manualCleanup?: boolean` -- disables automatic unsubscription
  - `equal?: (a: T, b: T) => boolean` -- custom equality check
- **Behavior:** Subscribes immediately, auto-unsubscribes on destroy.

```typescript
// Converting an external observable to a signal inside a store
withMethods((store) => {
  const route = inject(ActivatedRoute);
  const productId = toSignal(
    route.params.pipe(map(p => p['id'])),
    { initialValue: '' }
  );
  return { productId };
}),
```

#### toObservable

- **Import:** `import { toObservable } from '@angular/core/rxjs-interop';`
- **Signature:** `toObservable<T>(source: Signal<T>, options?: { injector?: Injector }): Observable<T>`
- **Stability:** Stable
- **Behavior:** Uses an internal effect with ReplaySubject. First emission may be synchronous; subsequent are asynchronous.
- **Requires injection context.**

```typescript
// Converting a store signal to an observable for external consumption
const query$ = toObservable(store.query);
const results$ = query$.pipe(
  debounceTime(300),
  switchMap(q => searchService.search(q)),
);
```

#### takeUntilDestroyed

- **Import:** `import { takeUntilDestroyed } from '@angular/core/rxjs-interop';`
- **Signature:** `takeUntilDestroyed(destroyRef?: DestroyRef): MonoTypeOperatorFunction<T>`
- **Stability:** Stable
- **Purpose:** Completes an observable when the component/service is destroyed.
- **Note:** Auto-injects DestroyRef if omitted and called within injection context.

```typescript
// Manual subscription with automatic cleanup
toObservable(store.selectedId).pipe(
  filter(id => !!id),
  switchMap(id => productService.getById(id)),
  takeUntilDestroyed(),
).subscribe(product => store.setProduct(product));
```

#### outputFromObservable / outputToObservable

- **Import:** `import { outputFromObservable, outputToObservable } from '@angular/core/rxjs-interop';`
- **Stability:** Stable
- **Purpose:** Bridge component outputs with RxJS. `outputFromObservable` declares an output sourced from an Observable. `outputToObservable` converts a component output to an Observable.

#### rxResource

- **Import:** `import { rxResource } from '@angular/core/rxjs-interop';`
- **Stability:** Experimental (Angular 21)
- **Purpose:** Like `resource()` but uses an Observable-returning loader instead of Promise-returning.
- **Relationship to rxMethod:** rxResource is declarative (tracks loading states automatically); rxMethod is imperative (you manage loading state manually).

## Key Concepts

- **rxMethod is the bridge** between NgRx SignalStore's signal-based state and RxJS's operator-based async composition. It allows leveraging the full power of RxJS within the signal-based paradigm.
- **Multiple input types** make rxMethod flexible: call it imperatively with a value, reactively with a signal, or push-based with an observable.
- **Computation function overload** (NgRx 21) simplifies multi-signal reactive patterns by eliminating intermediate computed signals.
- **Automatic lifecycle management:** rxMethod ties to the injector's lifecycle. No manual unsubscription needed in most cases.
- **tapResponse is mandatory in practice:** Always use it inside rxMethod to prevent stream termination on errors.
- **toSignal and toObservable** form the general Angular interop layer; rxMethod is the NgRx-specific interop layer built on top of similar principles.
- **rxMethod vs withEventHandlers:** rxMethod is for RxJS-heavy side effects within a single store. withEventHandlers is for event-driven inter-store communication and Redux-style patterns.
- **rxMethod vs signalMethod:** signalMethod is a lightweight, non-RxJS alternative for simple synchronous or Promise-based operations. Use rxMethod when you need RxJS operators.

## Code Patterns

### Pattern 1: Debounced Search

```typescript
// search/store/search.store.ts
export const SearchStore = signalStore(
  withState({
    query: '',
    results: [] as SearchResult[],
    loading: false,
  }),
  withMethods((store, searchService = inject(SearchService)) => ({
    updateQuery: rxMethod<string>(
      pipe(
        tap((query) => patchState(store, { query })),
        debounceTime(300),
        distinctUntilChanged(),
        tap(() => patchState(store, { loading: true })),
        switchMap((query) =>
          searchService.search(query).pipe(
            tapResponse({
              next: (results) => patchState(store, { results, loading: false }),
              error: () => patchState(store, { results: [], loading: false }),
            }),
          ),
        ),
      ),
    ),
  })),
);
```

### Pattern 2: Polling with Interval

```typescript
// dashboard/store/dashboard.store.ts
export const DashboardStore = signalStore(
  withState({ metrics: null as Metrics | null }),
  withMethods((store, metricsService = inject(MetricsService)) => ({
    startPolling: rxMethod<number>(
      pipe(
        switchMap((intervalMs) =>
          interval(intervalMs).pipe(
            startWith(0),
            switchMap(() =>
              metricsService.getMetrics().pipe(
                tapResponse({
                  next: (metrics) => patchState(store, { metrics }),
                  error: () => console.error('Polling failed'),
                }),
              ),
            ),
          ),
        ),
      ),
    ),
  })),
);

// Usage: store.startPolling(5000); // Poll every 5 seconds
```

### Pattern 3: Retry with Backoff

```typescript
// data/store/data.store.ts
import { retry, timer } from 'rxjs';

readonly loadData = rxMethod<void>(
  pipe(
    switchMap(() =>
      dataService.fetchAll().pipe(
        retry({
          count: 3,
          delay: (error, retryCount) => timer(retryCount * 1000),
        }),
        tapResponse({
          next: (data) => patchState(store, { data, error: null }),
          error: (err) => patchState(store, { error: 'Failed after 3 retries' }),
        }),
      ),
    ),
  ),
);
```

### Pattern 4: Combining Signals with toObservable

```typescript
// catalog/store/catalog.store.ts
withHooks({
  onInit(store) {
    // React to multiple signal changes using toObservable
    toObservable(store.selectedCategoryId).pipe(
      filter((id) => !!id),
      switchMap((id) =>
        catalogService.getProductsByCategory(id).pipe(
          tapResponse({
            next: (products) => patchState(store, { products }),
            error: () => patchState(store, { products: [] }),
          }),
        ),
      ),
      takeUntilDestroyed(),
    ).subscribe();
  },
}),
```

### Pattern 5: Calling rxMethod with a Signal (Reactive Trigger)

```typescript
// Component that reactively triggers search on signal change
@Component({
  template: `<input #search (input)="query.set(search.value)">`,
  providers: [SearchStore],
})
export class SearchComponent implements OnInit {
  readonly store = inject(SearchStore);
  readonly query = signal('');

  ngOnInit() {
    // Passing a signal: rxMethod re-executes whenever query changes
    this.store.updateQuery(this.query);
  }
}
```

### Pattern 6: rxMethod with exhaustMap for Form Submission

```typescript
// form/store/form.store.ts
readonly submitForm = rxMethod<FormData>(
  pipe(
    tap(() => patchState(store, { submitting: true })),
    exhaustMap((formData) =>
      formService.submit(formData).pipe(
        tapResponse({
          next: (result) => patchState(store, { submitting: false, result }),
          error: (err) => patchState(store, { submitting: false, error: err.message }),
        }),
      ),
    ),
  ),
);
```

## Breaking Changes and Gotchas

### Breaking Changes

1. **`unsubscribe()` renamed to `destroy()`:** The `RxMethodRef` return type changed from having `.unsubscribe()` to `.destroy()` (NgRx v19+). Migration schematics available.

2. **tapResponse moved to `@ngrx/operators`:** Previously in `@ngrx/component-store`. Update imports.

3. **Computation function overload is new in NgRx 21:** Passing `() => T` to rxMethod and having it automatically track signal dependencies is a v21 feature.

### Gotchas

1. **Memory leak with root-level stores (#4528):** Passing a component's signal to an rxMethod in a root-provided store causes leaks because the subscription uses the RootInjector. The effect lives as long as the root store, not the component.

   **Workaround:** Use `withHooks` + `toObservable` + `takeUntilDestroyed` for component-scoped reactive subscriptions to global stores. Or provide the store at the component level.

2. **Stream termination on unhandled errors (#4755):** If an error occurs outside `tapResponse` (e.g., in a `tap` or `map` before `switchMap`), the rxMethod's internal observable terminates permanently.

   **Solution:** Always wrap error-prone logic inside the inner observable where `tapResponse` catches it.

3. **Injection context required for toSignal/toObservable:** Both require injection context. If using inside `withMethods`, the store factory function runs in injection context, so they work. If using in `withHooks.onInit`, injection context is also available. But calling them inside callbacks (event handlers, setTimeout) will fail.

4. **toObservable timing:** Uses ReplaySubject internally, so the first emission may be synchronous. This can cause unexpected behavior with `distinctUntilChanged` if you assume all emissions are async.

5. **toSignal subscribes immediately:** Unlike the `async` pipe which defers subscription, `toSignal` subscribes immediately on creation. If the source Observable has side effects (HTTP calls), they fire even if the signal is never read.

6. **Feature declaration order matters (#4243):** `withMethods` must appear before `withHooks` in the signalStore call if hooks reference methods. Similarly, rxMethod definitions must be available before `onInit` tries to call them.

7. **rxMethod cannot return Promises:** rxMethod returns `void` (or `RxMethodRef` for the reference). It cannot return a Promise, which is needed for Angular Signal Forms' submit handler. Community workaround: `rxPromiseMethod` wrapper.

8. **Operator selection has real consequences:**
   - `switchMap`: Cancels in-flight requests (good for search, bad for saves)
   - `concatMap`: Queues requests sequentially (good for ordered operations)
   - `exhaustMap`: Ignores new requests while one is in-flight (good for form submit)
   - `mergeMap`: Runs all requests in parallel (good for independent operations, bad for ordered ones)

## Sources

### Official Documentation
- [NgRx SignalStore RxJS Integration Guide](https://ngrx.io/guide/signals/rxjs-integration)
- [NgRx rxMethod API Reference](https://ngrx.io/api/signals/rxjs-interop/rxMethod)
- [NgRx Signal Method Guide](https://ngrx.io/guide/signals/signal-method)
- [NgRx tapResponse Operator](https://ngrx.io/api/operators/tapResponse)
- [Angular RxJS Interop Guide](https://angular.dev/ecosystem/rxjs-interop)
- [Angular toSignal API](https://angular.dev/api/core/rxjs-interop/toSignal)
- [Angular toObservable API](https://angular.dev/api/core/rxjs-interop/toObservable)
- [Angular takeUntilDestroyed](https://angular.dev/ecosystem/rxjs-interop/take-until-destroyed)

### Community Resources
- [Angular Architects: The New NGRX Signal Store](https://www.angulararchitects.io/blog/the-new-ngrx-signal-store-for-angular-2-1-flavors/)
- [Stefanos Lignos: Getting Started with NgRx Signal Store](https://www.stefanos-lignos.dev/posts/ngrx-signals-store)
- [Egghead: Initialize SignalStore with rxMethod](https://egghead.io/lessons/angular-initialize-the-ngrx-signal-store-state-from-using-rxjs-observables-and-rxmethod)
- [NgRx 21 Announcement](https://dev.to/ngrx/announcing-ngrx-21-celebrating-a-10-year-journey-with-a-fresh-new-look-and-ngrxsignalsevents-5ekp)
- [Frontend Masters: Reading State with rxMethod](https://frontendmasters.com/courses/advanced-angular/reading-state-with-rxmethod/)

### GitHub Issues and Discussions
- [#4528: Memory leak with root-level store rxMethod](https://github.com/ngrx/platform/issues/4528)
- [#4755: Unexpected errors terminate rxMethod stream](https://github.com/ngrx/platform/issues/4755)
- [#4661: Angular 19 compatibility - unsubscribe to destroy](https://github.com/ngrx/platform/issues/4661)
- [#4121: Best practice for reacting to signal in rxMethod](https://github.com/ngrx/platform/discussions/4121)
- [#4243: Feature ordering in signalStore](https://github.com/ngrx/platform/issues/4243)
- [#4408: RFC - Add a reactivity layer to signalStore](https://github.com/ngrx/platform/issues/4408)

### Real-World Example Repos
- [angular-ngrx-nx-realworld-example-app](https://github.com/stefanoslig/angular-ngrx-nx-realworld-example-app)

## Open Questions

1. **rxResource vs rxMethod in SignalStore:** rxResource (experimental in Angular 21) provides declarative async loading with automatic status tracking. Need to verify whether the community has converged on guidance for when to use rxResource inside a SignalStore vs rxMethod. The distinction seems to be: rxResource for simple data fetching, rxMethod for complex operator chains.

2. **Computation function overload exact behavior:** Verify whether the computation function overload uses Angular's `effect()` or `computed()` internally to track dependencies. This affects timing (synchronous vs microtask) and glitch-free guarantees.

3. **signalMethod vs rxMethod bundle impact:** signalMethod (without RxJS) may enable tree-shaking of RxJS in stores that don't need it. Verify actual bundle size difference with NgRx 21.

4. **Memory leak fix status (#4528):** Check if this was resolved in NgRx 21 or if the workaround is still needed.
