# Research: Resource API and httpResource

**Date:** 2026-03-29
**Chapter:** Ch 6
**Status:** Ready for chapter generation

## API Surface

### `resource()`

- **Import:** `import { resource } from '@angular/core';`
- **Stability:** Experimental (since Angular v19.0, still experimental in v21)
- **Purpose:** Generic async data fetching using Promises

**Signature:**

```ts
resource<T, R>(options: ResourceOptions<T, R>): ResourceRef<T>;
```

**Options:**

```ts
interface ResourceOptions<T, R> {
  params: () => R;                           // reactive params signal (renamed from `request` in v20)
  loader: (params: { params: R; abortSignal: AbortSignal }) => Promise<T>;
  defaultValue?: NoInfer<T>;                 // fallback when value is undefined
  equal?: (a: T, b: T) => boolean;          // custom equality function
  injector?: Injector;                       // explicit injector context
}
```

**Returns: `ResourceRef<T>`**

```ts
interface ResourceRef<T> {
  readonly value: Signal<T | undefined>;     // current value (throws in error state since v20)
  readonly status: Signal<ResourceStatus>;   // current status
  readonly error: Signal<unknown>;           // current error
  readonly isLoading: Signal<boolean>;       // true during loading/reloading
  hasValue(): boolean;                       // safe check before reading value()
  reload(): boolean;                         // triggers re-fetch with same params; returns false if already loading
  set(value: T): void;                       // locally override value (status becomes 'local')
  update(updater: (current: T | undefined) => T): void;  // locally update value
  destroy(): void;                           // clean up the resource
}
```

---

### `rxResource()`

- **Import:** `import { rxResource } from '@angular/core/rxjs-interop';`
- **Stability:** Experimental (since Angular v19.0, still experimental in v21)
- **Purpose:** Observable-based variant for RxJS-heavy codebases

**Signature:**

```ts
rxResource<T, R>(options: RxResourceOptions<T, R>): ResourceRef<T>;
```

**Options:**

```ts
interface RxResourceOptions<T, R> {
  params: () => R;                           // reactive params signal (renamed from `request` in v20)
  stream: (params: { params: R; abortSignal: AbortSignal }) => Observable<T>;  // renamed from `loader` in v20
  defaultValue?: NoInfer<T>;
  equal?: (a: T, b: T) => boolean;
  injector?: Injector;
}
```

---

### `httpResource()`

- **Import:** `import { httpResource } from '@angular/common/http';`
- **Stability:** Experimental (since Angular v19.2, still experimental in v21)
- **Purpose:** HTTP-specific resource with built-in HttpClient integration

**Overloads:**

```ts
// Simple URL string (returns text)
httpResource(url: string | (() => string | undefined)): HttpResourceRef<string>;

// Full request options
httpResource<T>(options: HttpResourceOptions<T>): HttpResourceRef<T>;

// With response type variants
httpResource.text(url: string | (() => string | undefined)): HttpResourceRef<string>;
httpResource.arrayBuffer(url: string | (() => string | undefined)): HttpResourceRef<ArrayBuffer>;
httpResource.blob(url: string | (() => string | undefined)): HttpResourceRef<Blob>;
```

**Options:**

```ts
interface HttpResourceOptions<T> {
  url: string | (() => string | undefined);  // returning undefined skips the request
  method?: string;                            // HTTP method (default: 'GET')
  headers?: HttpHeaders | Record<string, string | string[]>;
  params?: HttpParams | Record<string, string | string[]>;
  body?: unknown;                             // request body (for POST, etc.)
  reportProgress?: boolean;                   // enables progress tracking
  withCredentials?: boolean;
  transferCache?: boolean | { includeHeaders?: string[] };
  parse?: (raw: unknown) => T;               // runtime validation/transform (e.g., Zod)
  defaultValue?: NoInfer<T>;
  equal?: (a: T, b: T) => boolean;
  injector?: Injector;
}
```

**Returns: `HttpResourceRef<T>` (extends `ResourceRef<T>`)**

```ts
interface HttpResourceRef<T> extends ResourceRef<T> {
  readonly headers: Signal<HttpHeaders | undefined>;     // response headers
  readonly statusCode: Signal<number | undefined>;       // HTTP status code
  readonly progress: Signal<HttpProgressEvent | undefined>;  // upload/download progress
}
```

---

### `ResourceStatus` (string union since Angular v20)

```ts
type ResourceStatus = 'idle' | 'loading' | 'reloading' | 'resolved' | 'error' | 'local';
```

**Status transitions:**
- `'idle'` -- initial state before first load (when params returns undefined)
- `'loading'` -- first fetch or params changed; **value resets to undefined**
- `'reloading'` -- triggered by `reload()`; **value is preserved**
- `'resolved'` -- successful fetch
- `'error'` -- fetch failed
- `'local'` -- value was set locally via `set()` or `update()`

> **Breaking change (Angular 19 to 20):** ResourceStatus changed from a numeric enum to a string union. Code using `ResourceStatus.Loading` (numeric) must migrate to `'loading'` (string).

---

## Key Concepts

- **Declarative async state**: httpResource replaces imperative HttpClient subscribe patterns with a declarative, signal-based approach. You declare what data you need based on reactive parameters, and the framework handles fetching, cancellation, and status tracking.

- **Read-only primitive**: httpResource is designed exclusively for data fetching (reads). It is NOT suitable for mutations (POST/PUT/DELETE that change server state). It uses switchMap semantics internally, which silently cancels in-flight requests when params change. This is correct for reads but dangerous for writes.

- **Automatic request cancellation**: When reactive params change, any in-flight request is automatically cancelled (via AbortSignal) and a new request fires. This is built-in switchMap behavior.

- **Three tiers of abstraction**:
  - `resource()` -- lowest level, Promise-based, for any async source
  - `rxResource()` -- Observable-based, for RxJS pipelines or streaming
  - `httpResource()` -- highest level, zero-boilerplate HTTP with extra signals

- **The `parse` option for runtime validation**: httpResource accepts a `parse` function that transforms and validates raw JSON. Integrates naturally with Zod schemas for type-safe API boundaries.

- **SSR transfer cache**: httpResource inherits HttpClient's `TransferState` behavior. GET/HEAD responses are serialized during SSR and reused on client hydration, preventing duplicate requests.

- **Reactive params pattern**: The URL or options can be a signal/computed function. When the computed value changes, httpResource automatically re-fetches. Returning `undefined` from the URL function skips the request entirely (useful for conditional fetching).

- **`reload()` vs params change**: `reload()` preserves the current value (status becomes `'reloading'`), while a params change resets value to undefined (status becomes `'loading'`). This distinction is critical for UX (stale-while-revalidate vs fresh load).

- **Local state with `set()` and `update()`**: Resources support optimistic updates by locally overriding the value. Status becomes `'local'`, and calling `reload()` re-fetches from the server.

---

## Code Patterns

### Basic httpResource Usage

```ts
// src/app/services/product.service.ts
import { Injectable, inject, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';

interface Product {
  id: number;
  name: string;
  price: number;
}

@Injectable({ providedIn: 'root' })
export class ProductService {
  private productId = signal<number | undefined>(undefined);

  // httpResource with reactive URL
  productResource = httpResource<Product>(() =>
    this.productId()
      ? { url: `/api/products/${this.productId()}` }
      : undefined  // skip request when no ID
  );

  loadProduct(id: number): void {
    this.productId.set(id);
  }

  refresh(): void {
    this.productResource.reload();
  }
}
```

### httpResource with Zod Validation

```ts
// src/app/services/validated-product.service.ts
import { Injectable } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { z } from 'zod';

const ProductSchema = z.object({
  id: z.number(),
  name: z.string(),
  price: z.number().positive(),
  category: z.string(),
});

type Product = z.infer<typeof ProductSchema>;

const ProductListSchema = z.array(ProductSchema);

@Injectable({ providedIn: 'root' })
export class ProductService {
  productsResource = httpResource<Product[]>({
    url: '/api/products',
    parse: (raw) => ProductListSchema.parse(raw),
    defaultValue: [],
  });
}
```

### Component Consuming httpResource

```ts
// src/app/components/product-detail.component.ts
import { Component, inject } from '@angular/core';
import { ProductService } from '../services/product.service';

@Component({
  selector: 'app-product-detail',
  template: `
    @if (service.productResource.status() === 'loading') {
      <app-skeleton />
    } @else if (service.productResource.status() === 'error') {
      <app-error [error]="service.productResource.error()" />
    } @else if (service.productResource.hasValue()) {
      <div class="product">
        <h2>{{ service.productResource.value()!.name }}</h2>
        <p>{{ service.productResource.value()!.price | currency }}</p>
      </div>
    }
  `,
})
export class ProductDetailComponent {
  protected readonly service = inject(ProductService);
}
```

### Preserving Previous Value with linkedSignal

```ts
// src/app/services/search.service.ts
import { Injectable, signal, linkedSignal } from '@angular/core';
import { httpResource } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class SearchService {
  query = signal('');

  private searchResource = httpResource<SearchResult[]>(() =>
    this.query()
      ? { url: '/api/search', params: { q: this.query() } }
      : undefined
  );

  // linkedSignal preserves previous results while loading new ones
  results = linkedSignal<SearchResult[]>(() =>
    this.searchResource.hasValue()
      ? this.searchResource.value()!
      : this.results()  // keep previous value
  );
}
```

### Debouncing Params (Signal Level)

```ts
// src/app/services/debounced-search.service.ts
import { Injectable, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class DebouncedSearchService {
  rawQuery = signal('');

  // Debounce at the signal level, not the resource level
  private debouncedQuery = toSignal(
    toObservable(this.rawQuery).pipe(
      debounceTime(300),
      distinctUntilChanged()
    ),
    { initialValue: '' }
  );

  searchResource = httpResource<SearchResult[]>(() =>
    this.debouncedQuery()
      ? { url: '/api/search', params: { q: this.debouncedQuery() } }
      : undefined
  );
}
```

### httpResource in NgRx SignalStore (withProps pattern)

```ts
// src/app/stores/product.store.ts
import { signalStore, withState, withProps, withComputed, withMethods, patchState } from '@ngrx/signals';
import { httpResource } from '@angular/common/http';
import { computed } from '@angular/core';

export const ProductStore = signalStore(
  { providedIn: 'root' },
  withState({
    selectedId: undefined as number | undefined,
  }),
  withProps((store) => ({
    _productResource: httpResource<Product>(() =>
      store.selectedId()
        ? { url: `/api/products/${store.selectedId()}` }
        : undefined
    ),
    _listResource: httpResource<Product[]>({
      url: '/api/products',
      defaultValue: [],
    }),
  })),
  withComputed((store) => ({
    product: computed(() => store._productResource.value()),
    productLoading: computed(() => store._productResource.isLoading()),
    productError: computed(() => store._productResource.error()),
    products: computed(() => store._listResource.value() ?? []),
    productsLoading: computed(() => store._listResource.isLoading()),
  })),
  withMethods((store) => ({
    selectProduct(id: number): void {
      patchState(store, { selectedId: id });
    },
    refreshProducts(): void {
      store._listResource.reload();
    },
  })),
);
```

### resource() with Custom Promise Loader

```ts
// src/app/services/indexed-db.service.ts
import { Injectable, resource, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class IndexedDbService {
  private key = signal<string | undefined>(undefined);

  cachedItem = resource({
    params: () => ({ key: this.key() }),
    loader: async ({ params, abortSignal }) => {
      if (!params.key) return undefined;
      const db = await openDB('myApp', 1);
      return db.get('cache', params.key);
    },
  });

  lookup(key: string): void {
    this.key.set(key);
  }
}
```

### rxResource with Observable Streams

```ts
// src/app/services/realtime.service.ts
import { Injectable, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { webSocket } from 'rxjs/webSocket';
import { retry } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class RealtimePriceService {
  symbol = signal('AAPL');

  priceResource = rxResource({
    params: () => ({ symbol: this.symbol() }),
    stream: ({ params }) =>
      webSocket<StockPrice>(`wss://prices.example.com/${params.symbol}`).pipe(
        retry({ delay: 3000 })
      ),
  });
}
```

---

## Breaking Changes and Gotchas

### Breaking Changes Across Angular Versions

**Angular 19 to 20:**
- `request` parameter renamed to `params` in resource() and rxResource()
- `loader` renamed to `stream` in rxResource()
- `ResourceStatus` changed from numeric enum to string union (`'loading'` not `ResourceStatus.Loading`)
- `value()` now throws when status is `'error'` (previously returned undefined). Must guard with `hasValue()` first.
- `abortSignal` moved into params object: `loader: ({ params, abortSignal }) => ...`

**Angular 20 to 21:**
- `HttpErrorResponse` no longer wrapped in `ResourceWrappedError`. Errors are the raw `HttpErrorResponse` directly (can access `.status`, `.message` without `.cause` unwrapping).
- HttpClient provided by default in Angular 21 (no explicit `provideHttpClient()` needed in most setups, though it's still recommended for configuration).

### Known Bugs and Gotchas

1. **Value resets to `undefined` when params change.** During `'loading'` status (params changed), the value is `undefined`. This causes DOM flicker, scroll position loss, and template errors. Workaround: use `linkedSignal` to preserve previous values or provide `defaultValue`.

2. **`reload()` does not clear the error state.** If a resource is in `'error'` status and you call `reload()`, the error remains visible until the new response arrives. No clean workaround exists as of v21.

3. **`reload()` returns false during loading.** If you call `reload()` while a request is already in flight (status `'loading'`), it returns `false` and does nothing. Only works during `'resolved'`, `'error'`, or `'local'` status.

4. **No built-in debounce.** The Angular team closed the debounce feature request (angular/angular#59528) as NOT_PLANNED, stating that signals lack a concept of time. Debounce must be implemented at the signal level using `toObservable` + `debounceTime` + `toSignal`.

5. **`hasValue()` is not a signal.** It's a regular method, not a signal, so it cannot be used in reactive contexts like `computed()` or templates for fine-grained reactivity. Use `status() === 'resolved' || status() === 'local'` or `value() !== undefined` instead.

6. **Undefined individual params still fire requests.** Only the entire URL returning `undefined` prevents a request. If you construct a URL like `/api/items/${id()}` where `id()` is `undefined`, it will fire a request to `/api/items/undefined`.

7. **switchMap semantics are dangerous for writes.** httpResource uses switchMap internally. If used for mutations, changing params will cancel the in-flight write operation silently. Never use httpResource for POST/PUT/DELETE operations that modify server state.

8. **SSR double-payload.** httpResource inherits HttpClient's transfer cache, which means the HTML includes both the rendered content and the JSON payload. For large datasets, this doubles the initial page weight. Use `withNoHttpTransferCache()` or `transferCache: false` selectively.

9. **Incremental hydration + `isLoading()` bug.** Using `@if (resource.isLoading())` inside `@defer` blocks can break incremental hydration, causing duplicate requests and component reconstruction (angular/angular#63791).

10. **No cache layer.** httpResource has no built-in caching, TTL, or stale-while-revalidate. Every params change or `reload()` hits the server. For apps needing caching, consider wrapping with a service-level cache or using TanStack Query.

---

## Integration Patterns

### With NgRx SignalStore (Official Approach: withProps)

The current recommended pattern is to declare httpResource in `withProps()` and expose derived signals via `withComputed()`. See code pattern above.

### With @angular-architects/ngrx-toolkit (Community)

The `ngrx-toolkit` library provides `withResource()` as a higher-level feature:

```ts
import { signalStore, withState } from '@ngrx/signals';
import { withResource } from '@angular-architects/ngrx-toolkit';

export const FlightStore = signalStore(
  withResource({
    name: 'flights',
    loader: () => httpResource<Flight[]>({ url: '/api/flights' }),
  })
  // Auto-creates: flightsValue, flightsIsLoading, flightsError, flightsStatus
);
```

Official `@ngrx/signals` `withResource()` is proposed (ngrx/platform#4833) but will not ship until Resource API exits experimental status.

### httpResource for Reads + HttpClient for Writes

```ts
// src/app/services/product-crud.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { httpResource } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class ProductCrudService {
  private http = inject(HttpClient);

  // READ: use httpResource
  productsResource = httpResource<Product[]>({
    url: '/api/products',
    defaultValue: [],
  });

  // WRITE: use HttpClient directly
  createProduct(product: Omit<Product, 'id'>): void {
    this.http.post<Product>('/api/products', product).subscribe({
      next: () => this.productsResource.reload(),  // refresh list after write
    });
  }

  updateProduct(id: number, updates: Partial<Product>): void {
    this.http.patch<Product>(`/api/products/${id}`, updates).subscribe({
      next: () => this.productsResource.reload(),
    });
  }

  deleteProduct(id: number): void {
    this.http.delete(`/api/products/${id}`).subscribe({
      next: () => this.productsResource.reload(),
    });
  }
}
```

---

## Sources

### Official Documentation
- Angular Resource Guide: https://angular.dev/guide/signals/resource
- Angular httpResource Guide: https://angular.dev/guide/http/http-resource
- Angular httpResource API Reference: https://angular.dev/api/common/http/httpResource
- Angular Resource API Reference: https://angular.dev/api/core/resource

### RFCs and GitHub Issues
- Resource RFC 1 (Architecture): https://github.com/angular/angular/discussions/60120
- Resource RFC 2 (APIs): https://github.com/angular/angular/discussions/60121
- HttpResource DX Improvements: https://github.com/angular/angular/issues/61789
- Debounce Feature Request (closed NOT_PLANNED): https://github.com/angular/angular/issues/59528
- Incremental Hydration Bug: https://github.com/angular/angular/issues/63791
- NgRx withResource RFC: https://github.com/ngrx/platform/issues/4833

### Expert Blog Posts
- Angular Architects: "Learning httpResource with Super Mario": https://www.angulararchitects.io/en/blog/learning-httpresource-with-super-mario/
- Angular Architects: "Full-Cycle Reactivity in Angular": https://www.angulararchitects.io/blog/full-cycle-reativity-in-angular-signal-forms-signal-store-resources-mutation-api/
- Angular Architects: "Using the Resource API with the NgRx Signal Store": https://www.angulararchitects.io/blog/using-the-resource-api-with-the-ngrx-signal-store/
- Angular.Schule: "Angular's Resource APIs Are Broken": https://angular.schule/blog/2025-10-rx-resource-is-broken/
- Ninja Squad: "httpResource Guide": https://blog.ninja-squad.com/2025/02/20/angular-http-resource
- DrDreo: "httpResource In The Wild": https://blog.drdreo.com/http-resource-in-the-wild
- Tim Deschryver: "Testing httpResource": https://timdeschryver.dev/blog/writing-resilient-angular-component-tests-that-use-httpresource-with-httptestingcontroller
- Alfredo Perez: "Skip Angular Resource": https://medium.com/ngconf/skip-angular-resource-ff3441e8b2ba
- Dev.to: "Resource API Changes in Angular 20": https://dev.to/railsstudent/resource-api-changes-in-angular-20-streaming-data-in-rxresource-pg4

### Community Tools
- ngrx-toolkit withResource: https://ngrx-toolkit.angulararchitects.io/docs/extensions
- ngrx-toolkit withMutations: https://ngrx-toolkit.angulararchitects.io/docs/mutations

### Release Notes
- InfoQ: "Angular 21 Released": https://www.infoq.com/news/2025/11/angular-21-released/
- Nx Blog: "Angular State Management 2025": https://nx.dev/blog/angular-state-management-2025

---

## Open Questions

1. **Exact `httpResource` signature changes in Angular 21.1+:** The API is experimental, so minor releases may introduce changes. Verify against the installed v21 package before writing the chapter.

2. **`hasValue()` becoming a signal:** There is community discussion about making `hasValue()` a signal for template reactivity. Check if this has landed by the time of writing.

3. **`parse` option type inference:** The interplay between the generic type parameter `T` and the `parse` return type needs verification. Does `parse` override `T` or must they match?

4. **`linkedSignal` import stability:** `linkedSignal` was introduced in Angular v19 as developer preview. Verify its stability status in v21 since the chapter depends on it as a workaround.

5. **Transfer cache behavior with httpResource:** Verify whether httpResource automatically uses the transfer cache in SSR or requires explicit opt-in. Angular 21 documentation should clarify.

6. **Angular 21 HttpClient auto-provision:** Confirm whether `provideHttpClient()` is truly optional in Angular 21 or still required. Some sources are inconsistent on this.
