# Chapter 6: Resource API and httpResource

Your product catalog is wired up with signals. `ProductCardComponent` renders data through `input()` signals, `SearchBarComponent` emits queries through `output()`, and `linkedSignal()` bridges immutable inputs and local editable state. But every product is hardcoded in a `CATALOG` array. Real applications load data from APIs. And the moment you introduce HTTP calls, a cascade of concerns follows: loading indicators, error messages, request cancellation when the user navigates away, and stale data when parameters change mid-flight.

The traditional approach is to inject `HttpClient`, subscribe to an Observable, stash the result in a signal, track a `loading` boolean, catch errors into an `error` signal, and remember to unsubscribe on destroy. That is five moving parts for a single GET request. Multiply it across every feature, and you are writing the same boilerplate in every service.

Angular's Resource API eliminates this boilerplate. You declare what data you need as a function of reactive parameters, and the framework handles fetching, cancellation, status tracking, and cleanup. In this chapter, we build a product catalog that loads data from a REST API using `httpResource`, handles errors and loading states in templates, validates responses at the boundary, and debounces search input to avoid flooding the server.

> **API Status: Experimental**
> `resource()`, `rxResource()`, and `httpResource()` are marked as `@experimental` in Angular 21.0.0. The core concepts are stable but method signatures may change in future versions.

## A Quick Recap

Chapter 4 introduced `signal()`, `computed()`, `effect()`, and `linkedSignal()`. Chapter 5 showed how to wire signals through component boundaries with `input()`, `output()`, `model()`, and signal queries. This chapter builds on both. You should be comfortable reading signal values with `()` and understand that `computed()` creates derived read-only state. We will also use `linkedSignal()` to solve a specific pain point with resource value resets.

## The Three Resource Functions

Angular provides three resource functions at different levels of abstraction. All three share the same reactive model: you declare parameters as a signal-derived function, provide a data-fetching strategy, and receive a `ResourceRef` with signals for value, status, and error.

**`resource()`** is the lowest level. It accepts a Promise-based loader and works with any async source: IndexedDB, Web Workers, custom fetch wrappers, or third-party SDKs.

**`rxResource()`** is the Observable-based variant. It accepts a `stream` function that returns an Observable, making it suitable for RxJS-heavy codebases or streaming data sources.

**`httpResource()`** is the highest level and the one you will use most often. It wraps Angular's `HttpClient` internally, requires zero boilerplate for standard HTTP GET requests, and exposes extra signals for response headers, HTTP status codes, and download progress.

Here is a side-by-side comparison of all three fetching the same product:

```typescript
// src/app/services/resource-comparison.ts
import { signal, resource } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { httpResource } from '@angular/common/http';
import { HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';

// --- resource(): Promise-based ---
const productId = signal(1);

const promiseResource = resource({
  params: () => ({ id: productId() }),
  loader: async ({ params, abortSignal }) => {
    const response = await fetch(`/api/products/${params.id}`, {
      signal: abortSignal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json() as Promise<Product>;
  },
});

// --- rxResource(): Observable-based ---
const http = inject(HttpClient);

const observableResource = rxResource({
  params: () => ({ id: productId() }),
  stream: ({ params }) => http.get<Product>(`/api/products/${params.id}`),
});

// --- httpResource(): Zero boilerplate ---
const httpRes = httpResource<Product>(() => `/api/products/${productId()}`);
```

All three produce a `ResourceRef` (or `HttpResourceRef`) with the same core signals. The difference is how much plumbing you write. For HTTP calls, `httpResource` is the clear winner.

## The ResourceRef Interface

Every resource function returns an object that implements `ResourceRef<T>`. Understanding its shape is essential before writing any consuming code.

```typescript
// ResourceRef<T> shape (simplified for clarity)
interface ResourceRef<T> {
  readonly value: Signal<T | undefined>;     // the fetched data
  readonly status: Signal<ResourceStatus>;   // lifecycle state
  readonly error: Signal<unknown>;           // the error, if any
  readonly isLoading: Signal<boolean>;       // true during loading or reloading
  hasValue(): boolean;                       // guard before reading value()
  reload(): boolean;                         // re-fetch with same params
  set(value: T): void;                      // locally override the value
  update(fn: (v: T | undefined) => T): void; // locally update the value
}
```

`ResourceStatus` is a string union with six possible values:

| Status | Meaning | `value()` | Triggered by |
|---|---|---|---|
| `'idle'` | No request issued yet | `undefined` | Params returned `undefined` |
| `'loading'` | First fetch or params changed | `undefined` | New params |
| `'reloading'` | Re-fetching with same params | **Preserved** | `reload()` |
| `'resolved'` | Data arrived successfully | The data | Successful response |
| `'error'` | Request failed | Throws | Failed response |
| `'local'` | Value overridden locally | The local value | `set()` or `update()` |

The critical distinction is between `'loading'` and `'reloading'`. When params change, the status moves to `'loading'` and value resets to `undefined`. When you call `reload()`, the status moves to `'reloading'` and the current value stays in place. This matters for UX: a params change means entirely new data (show a skeleton), while a reload means the same data refreshed (keep showing the stale data with a subtle spinner).

## httpResource in Practice

Let us replace the hardcoded product array from Chapter 5 with a real HTTP-backed service.

### A Product Service with httpResource

```typescript
// src/app/products/product.service.ts
import { Injectable, signal, computed } from '@angular/core';
import { httpResource } from '@angular/common/http';

export interface Product {
  id: number;
  name: string;
  price: number;
  category: string;
}

@Injectable({ providedIn: 'root' })
export class ProductService {
  readonly searchQuery = signal('');
  readonly selectedCategory = signal<string | undefined>(undefined);

  readonly productsResource = httpResource<Product[]>(() => {
    const query = this.searchQuery();
    const category = this.selectedCategory();

    const params: Record<string, string> = {};
    if (query) params['q'] = query;
    if (category) params['category'] = category;

    return {
      url: '/api/products',
      params,
    };
  }, {
    defaultValue: [],
  });

  readonly products = computed(() => this.productsResource.value() ?? []);
  readonly isLoading = computed(() => this.productsResource.isLoading());
  readonly error = computed(() => this.productsResource.error());

  search(query: string): void {
    this.searchQuery.set(query);
  }

  filterByCategory(category: string | undefined): void {
    this.selectedCategory.set(category);
  }

  refresh(): void {
    this.productsResource.reload();
  }
}
```

The URL function reads two signals: `searchQuery` and `selectedCategory`. Every time either changes, `httpResource` cancels any in-flight request and fires a new one with the updated query parameters. The `defaultValue: []` ensures `value()` returns an empty array instead of `undefined` during the initial load, which eliminates null checks in templates.

### Consuming the Resource in a Component

```typescript
// src/app/products/product-list-page.component.ts
import { Component, inject } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { ProductService } from './product.service';
import { SearchBarComponent } from './search-bar.component';

@Component({
  selector: 'app-product-list-page',
  imports: [CurrencyPipe, SearchBarComponent],
  template: `
    <h1>Product Catalog</h1>
    <app-search-bar
      placeholder="Search products..."
      (search)="productService.search($event)"
      (cleared)="productService.search('')"
    />

    @switch (productService.productsResource.status()) {
      @case ('loading') {
        <div class="skeleton-grid">
          @for (i of skeletonSlots; track i) {
            <div class="skeleton-card"></div>
          }
        </div>
      }
      @case ('error') {
        <div class="error-banner">
          <p>Failed to load products.</p>
          <button (click)="productService.refresh()">Retry</button>
        </div>
      }
      @default {
        @if (productService.productsResource.isLoading()) {
          <div class="loading-bar"></div>
        }

        @for (product of productService.products(); track product.id) {
          <div class="product-card">
            <h3>{{ product.name }}</h3>
            <p>{{ product.price | currency }}</p>
            <span class="category">{{ product.category }}</span>
          </div>
        } @empty {
          <p>No products match your search.</p>
        }
      }
    }
  `,
})
export class ProductListPageComponent {
  protected readonly productService = inject(ProductService);
  protected readonly skeletonSlots = [1, 2, 3, 4, 5, 6];
}
```

The template uses `@switch` on the resource status. During the initial `'loading'` phase, it shows skeleton placeholders. On `'error'`, it shows a retry button. In all other states (`'resolved'`, `'reloading'`, `'local'`), it renders the product grid. The `isLoading()` signal inside the `@default` branch catches the `'reloading'` state (triggered by `reload()`), showing a subtle loading bar on top of the existing content instead of replacing it with skeletons.

### Fetching a Single Product

```typescript
// src/app/products/product-detail.service.ts
import { Injectable, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { Product } from './product.service';

@Injectable({ providedIn: 'root' })
export class ProductDetailService {
  readonly productId = signal<number | undefined>(undefined);

  readonly productResource = httpResource<Product>(() =>
    this.productId() !== undefined
      ? `/api/products/${this.productId()}`
      : undefined
  );

  loadProduct(id: number): void {
    this.productId.set(id);
  }
}
```

When `productId` is `undefined`, the URL function returns `undefined`, and `httpResource` stays in the `'idle'` status without making any request. Setting a valid ID triggers the fetch. This pattern prevents requests with incomplete parameters.

## Validating Responses with the parse Option

TypeScript types evaporate at runtime. A `httpResource<Product>` trusts that the server returns an object matching the `Product` interface, but the server might send extra fields, missing fields, or wrong types. The `parse` option intercepts the raw JSON before it becomes the resource value, letting you validate and transform at the API boundary.

```typescript
// src/app/products/validated-product.service.ts
import { Injectable, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { z } from 'zod';

const ProductSchema = z.object({
  id: z.number(),
  name: z.string().min(1),
  price: z.number().positive(),
  category: z.string(),
});

export type Product = z.infer<typeof ProductSchema>;

const ProductListSchema = z.array(ProductSchema);

@Injectable({ providedIn: 'root' })
export class ValidatedProductService {
  readonly productsResource = httpResource<Product[]>({
    url: '/api/products',
    parse: (raw) => ProductListSchema.parse(raw),
    defaultValue: [],
  });
}
```

If the server returns a product with `price: "free"`, Zod throws a `ZodError` and the resource moves to the `'error'` status. You catch malformed data at the boundary instead of discovering it through a `NaN` in the template or a silent logic bug downstream.

The `parse` function receives the raw deserialized JSON (type `unknown`) and must return `T`. This means you can also use it for transforms without a validation library:

```typescript
// src/app/products/transformed-product.service.ts
import { Injectable } from '@angular/core';
import { httpResource } from '@angular/common/http';

interface ProductApiResponse {
  product_id: number;
  product_name: string;
  unit_price: number;
  product_category: string;
}

interface Product {
  id: number;
  name: string;
  price: number;
  category: string;
}

@Injectable({ providedIn: 'root' })
export class TransformedProductService {
  readonly productsResource = httpResource<Product[]>({
    url: '/api/products',
    parse: (raw) =>
      (raw as ProductApiResponse[]).map(item => ({
        id: item.product_id,
        name: item.product_name,
        price: item.unit_price,
        category: item.product_category,
      })),
    defaultValue: [],
  });
}
```

## HttpResourceRef: Extra Signals for HTTP Metadata

`httpResource` returns an `HttpResourceRef<T>`, which extends `ResourceRef<T>` with three additional signals:

```typescript
// src/app/products/product-detail-page.component.ts
import { Component, inject } from '@angular/core';
import { ProductDetailService } from './product-detail.service';

@Component({
  selector: 'app-product-detail-page',
  template: `
    @if (service.productResource.hasValue()) {
      <h2>{{ service.productResource.value()!.name }}</h2>

      <!-- HTTP status code -->
      <p class="debug">
        HTTP {{ service.productResource.statusCode() }}
      </p>

      <!-- Response headers -->
      <p class="debug">
        Cache: {{ service.productResource.headers()?.get('Cache-Control') }}
      </p>
    }
  `,
})
export class ProductDetailPageComponent {
  protected readonly service = inject(ProductDetailService);
}
```

The `statusCode` signal holds the HTTP response status (200, 304, etc.). The `headers` signal provides the full `HttpHeaders` object. The `progress` signal (available when `reportProgress: true` is set in the options) reports `HttpProgressEvent` objects during upload or download. These signals are `undefined` before the first response arrives.

## Debouncing Search Input

`httpResource` fires a new request every time its params change. If the params depend on a search input signal, every keystroke triggers a request. The Angular team intentionally excluded debounce from the Resource API because signals have no concept of time. Debouncing belongs at the signal level.

```typescript
// src/app/products/debounced-product.service.ts
import { Injectable, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { httpResource } from '@angular/common/http';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { Product } from './product.service';

@Injectable({ providedIn: 'root' })
export class DebouncedProductService {
  readonly rawQuery = signal('');

  private readonly debouncedQuery = toSignal(
    toObservable(this.rawQuery).pipe(
      debounceTime(300),
      distinctUntilChanged(),
    ),
    { initialValue: '' },
  );

  readonly productsResource = httpResource<Product[]>(() => {
    const query = this.debouncedQuery();
    return query
      ? { url: '/api/products', params: { q: query } }
      : { url: '/api/products' };
  }, {
    defaultValue: [],
  });
}
```

The `rawQuery` signal updates on every keystroke. `toObservable` converts it to an Observable, `debounceTime(300)` waits 300 milliseconds of silence, and `toSignal` converts the result back to a signal. `httpResource` reads the debounced signal, so requests fire at most once every 300 milliseconds.

## Preserving Previous Data During Loading

When params change, `httpResource` resets `value()` to `undefined` and moves to `'loading'` status. This causes the template to flash from data to a skeleton and back. For search UIs, users expect to see the previous results while new results load.

`linkedSignal` from Chapter 4 solves this:

```typescript
// src/app/products/stable-product.service.ts
import { Injectable, signal, linkedSignal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { Product } from './product.service';

@Injectable({ providedIn: 'root' })
export class StableProductService {
  readonly searchQuery = signal('');

  readonly productsResource = httpResource<Product[]>(() => ({
    url: '/api/products',
    params: this.searchQuery() ? { q: this.searchQuery() } : {},
  }), {
    defaultValue: [],
  });

  readonly stableProducts = linkedSignal<Product[]>(() => {
    const current = this.productsResource.value();
    return current !== undefined ? current : this.stableProducts();
  });
}
```

The `linkedSignal` returns the resource's value when it is available and falls back to its own previous value during loading. The template binds to `stableProducts()` instead of `productsResource.value()`, eliminating the flash.

## Optimistic Updates with set() and update()

Resources support local overrides. Calling `set()` or `update()` changes the value immediately without making a network request. The status moves to `'local'`. This enables optimistic updates: change the UI first, send the write separately, and roll back if the write fails.

```typescript
// src/app/products/optimistic-product.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { httpResource } from '@angular/common/http';
import { Product } from './product.service';

@Injectable({ providedIn: 'root' })
export class OptimisticProductService {
  private readonly http = inject(HttpClient);

  readonly productsResource = httpResource<Product[]>({
    url: '/api/products',
    defaultValue: [],
  });

  deleteProduct(id: number): void {
    const previousProducts = this.productsResource.value() ?? [];

    // Optimistic: remove from UI immediately
    this.productsResource.update(products =>
      (products ?? []).filter(p => p.id !== id)
    );

    // Send the actual delete
    this.http.delete(`/api/products/${id}`).subscribe({
      error: () => {
        // Rollback on failure
        this.productsResource.set(previousProducts);
      },
    });
  }

  updateProduct(id: number, updates: Partial<Product>): void {
    const previousProducts = this.productsResource.value() ?? [];

    this.productsResource.update(products =>
      (products ?? []).map(p =>
        p.id === id ? { ...p, ...updates } : p
      )
    );

    this.http.patch<Product>(`/api/products/${id}`, updates).subscribe({
      next: () => this.productsResource.reload(),
      error: () => this.productsResource.set(previousProducts),
    });
  }
}
```

The pattern is: save the previous value, update locally, send the HTTP mutation, and restore on error. After a successful write, calling `reload()` syncs the resource with the server, and because `reload()` preserves the current value (status becomes `'reloading'`), the UI does not flash.

## resource() for Non-HTTP Async Sources

Not all async data comes from HTTP endpoints. `resource()` accepts any Promise-based loader, making it the right choice for IndexedDB, the File System Access API, Web Workers, or third-party SDKs that return Promises.

```typescript
// src/app/products/favorites.service.ts
import { Injectable, resource, signal, inject } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class FavoritesService {
  private readonly userId = signal<string | undefined>(undefined);

  readonly favoritesResource = resource({
    params: () => {
      const id = this.userId();
      return id ? { userId: id } : undefined;
    },
    loader: async ({ params }) => {
      const db = await this.openDatabase();
      const tx = db.transaction('favorites', 'readonly');
      const store = tx.objectStore('favorites');
      const index = store.index('userId');
      const request = index.getAll(params.userId);
      return new Promise<number[]>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result.map((r: { productId: number }) => r.productId));
        request.onerror = () => reject(request.error);
      });
    },
    defaultValue: [],
  });

  setUser(userId: string): void {
    this.userId.set(userId);
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('productCatalog', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('favorites')) {
          const store = db.createObjectStore('favorites', { keyPath: 'id', autoIncrement: true });
          store.createIndex('userId', 'userId', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}
```

The `params` function returns `undefined` when there is no user ID, keeping the resource in `'idle'` status. Once a user ID is set, the loader opens an IndexedDB database, queries the favorites index, and returns the product IDs. The same `ResourceRef` interface applies: `value()`, `status()`, `error()`, `reload()`, `set()`, and `update()` all work identically to `httpResource`.

## rxResource for Observable Streams

When your data source is naturally Observable-based, `rxResource` avoids the `toObservable`/`toSignal` conversion overhead. The `stream` function returns an Observable, and the resource subscribes internally.

```typescript
// src/app/products/product-price-stream.service.ts
import { Injectable, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';
import { timer, switchMap } from 'rxjs';

interface PriceUpdate {
  productId: number;
  price: number;
  timestamp: string;
}

@Injectable({ providedIn: 'root' })
export class ProductPriceStreamService {
  private readonly http = inject(HttpClient);
  readonly productId = signal<number | undefined>(undefined);

  readonly priceResource = rxResource({
    params: () => {
      const id = this.productId();
      return id !== undefined ? { id } : undefined;
    },
    stream: ({ params }) =>
      timer(0, 5000).pipe(
        switchMap(() =>
          this.http.get<PriceUpdate>(`/api/products/${params.id}/price`)
        ),
      ),
  });

  watchProduct(id: number): void {
    this.productId.set(id);
  }
}
```

This service polls a price endpoint every 5 seconds. Each time the Observable emits a new `PriceUpdate`, the resource's `value()` signal updates and the status moves to `'resolved'`. When `productId` changes, the previous subscription is automatically unsubscribed and a new one starts.

## httpResource and Server-Side Rendering

`httpResource` inherits the transfer cache behavior from `HttpClient`. During server-side rendering, Angular serializes GET and HEAD responses into the HTML payload. When the browser hydrates, it reads the cached response instead of making a duplicate HTTP call. This works automatically with no configuration.

For large datasets, this doubles the initial page weight because the HTML includes both the rendered markup and the JSON payload. You can disable the transfer cache selectively:

```typescript
// src/app/products/large-dataset.service.ts
import { Injectable } from '@angular/core';
import { httpResource } from '@angular/common/http';

interface AnalyticsData {
  date: string;
  revenue: number;
  orders: number;
}

@Injectable({ providedIn: 'root' })
export class LargeDatasetService {
  readonly analyticsResource = httpResource<AnalyticsData[]>({
    url: '/api/analytics/yearly',
    transferCache: false,
    defaultValue: [],
  });
}
```

Setting `transferCache: false` tells Angular to skip caching this response during SSR. The browser will make a fresh request on hydration.

## Common Mistakes

### Mistake 1: Using httpResource for Mutations

```typescript
// WRONG -- httpResource uses switchMap semantics internally
@Injectable({ providedIn: 'root' })
export class OrderService {
  private readonly orderData = signal<CreateOrderDto | undefined>(undefined);

  readonly createOrderResource = httpResource<Order>(() =>
    this.orderData()
      ? {
          url: '/api/orders',
          method: 'POST',
          body: this.orderData(),
        }
      : undefined
  );

  placeOrder(data: CreateOrderDto): void {
    this.orderData.set(data);
  }
}
```

If the user clicks "Place Order" twice quickly, the first POST is cancelled silently because `httpResource` uses switchMap behavior. The order may never reach the server. Mutations (POST, PUT, PATCH, DELETE that modify server state) must use `HttpClient` directly.

```typescript
// CORRECT -- use HttpClient for mutations
@Injectable({ providedIn: 'root' })
export class OrderService {
  private readonly http = inject(HttpClient);

  placeOrder(data: CreateOrderDto): Observable<Order> {
    return this.http.post<Order>('/api/orders', data);
  }
}
```

### Mistake 2: Interpolating Undefined Params into the URL

```typescript
// WRONG -- fires a request to /api/products/undefined
@Injectable({ providedIn: 'root' })
export class ProductDetailService {
  readonly productId = signal<number | undefined>(undefined);

  readonly productResource = httpResource<Product>(
    () => `/api/products/${this.productId()}`
  );
}
```

When `productId()` is `undefined`, the URL becomes the string `"/api/products/undefined"`, which is a valid string, so `httpResource` sends the request. Only the entire URL returning `undefined` prevents a request.

```typescript
// CORRECT -- return undefined to skip the request
@Injectable({ providedIn: 'root' })
export class ProductDetailService {
  readonly productId = signal<number | undefined>(undefined);

  readonly productResource = httpResource<Product>(() =>
    this.productId() !== undefined
      ? `/api/products/${this.productId()}`
      : undefined
  );
}
```

### Mistake 3: Reading value() Without Guarding the Error State

```typescript
// WRONG -- value() throws when status is 'error'
@Component({
  template: `<p>{{ productService.productsResource.value()!.length }} products</p>`,
})
export class ProductCountComponent {
  protected readonly productService = inject(ProductService);
}
```

Since Angular 20, calling `value()` when the resource is in `'error'` status throws an exception. This crashes the component if the HTTP request fails.

```typescript
// CORRECT -- guard with hasValue() or check status
@Component({
  template: `
    @if (productService.productsResource.hasValue()) {
      <p>{{ productService.productsResource.value()!.length }} products</p>
    }
  `,
})
export class ProductCountComponent {
  protected readonly productService = inject(ProductService);
}
```

Alternatively, use `defaultValue` in the resource options so that `value()` returns the default instead of `undefined` (and never throws during loading).

### Mistake 4: Expecting httpResource to Cache Responses

```typescript
// WRONG -- every navigation to this page fires a new request
@Component({ /* ... */ })
export class ProductPageComponent {
  protected readonly productService = inject(ProductService);

  constructor() {
    // Developer assumes the second visit will use cached data
    // It does not. httpResource has no cache layer.
  }
}
```

`httpResource` has no built-in caching, TTL, or stale-while-revalidate mechanism. Every params change and every `reload()` call hits the server. If you need response caching, implement it at the service level, use HTTP cache headers with `HttpClient` interceptors, or evaluate a dedicated caching library.

```typescript
// CORRECT -- implement service-level caching when needed
@Injectable({ providedIn: 'root' })
export class CachedProductService {
  private readonly cache = new Map<string, { data: Product[]; timestamp: number }>();
  private readonly ttl = 60_000; // 1 minute

  readonly productsResource = httpResource<Product[]>({
    url: '/api/products',
    defaultValue: [],
  });

  getProducts(): Product[] {
    const cached = this.cache.get('products');
    if (cached && Date.now() - cached.timestamp < this.ttl) {
      return cached.data;
    }
    const current = this.productsResource.value() ?? [];
    if (current.length > 0) {
      this.cache.set('products', { data: current, timestamp: Date.now() });
    }
    return current;
  }
}
```

### Mistake 5: Forgetting to Debounce Signal Inputs

```typescript
// WRONG -- every keystroke fires an HTTP request
@Injectable({ providedIn: 'root' })
export class SearchService {
  readonly query = signal('');

  readonly resultsResource = httpResource<Product[]>(() =>
    this.query()
      ? { url: '/api/search', params: { q: this.query() } }
      : undefined
  );
}
```

Typing "laptop" fires six requests: "l", "la", "lap", "lapt", "lapto", "laptop". Each one cancels the previous, wasting bandwidth and server resources. The Resource API has no built-in debounce. You must debounce the signal yourself using the `toObservable` + `debounceTime` + `toSignal` pattern shown earlier in this chapter.

## Key Takeaways

- **`httpResource` is a read-only primitive for declarative data fetching.** It replaces the imperative HttpClient subscribe/unsubscribe pattern with a signal-based approach that handles loading state, error state, request cancellation, and cleanup automatically. Never use it for mutations (POST/PUT/DELETE that modify server state).

- **The `'loading'` vs `'reloading'` distinction drives your UX decisions.** Params changes reset value to `undefined` (`'loading'`), showing a skeleton. `reload()` preserves value (`'reloading'`), showing a subtle refresh indicator. Use `linkedSignal` to keep previous data visible during `'loading'` when the UX calls for it.

- **Use the `parse` option for runtime type safety at the API boundary.** Libraries like Zod validate the raw JSON before it enters your application. This catches server contract violations immediately instead of letting bad data propagate through your component tree.

- **Debounce at the signal level, not the resource level.** Angular's Resource API intentionally excludes time-based operators. Convert the input signal to an Observable with `toObservable`, apply `debounceTime`, and convert back with `toSignal`.

- **Choose the right resource tier for your data source.** Use `httpResource` for HTTP calls (most common). Use `rxResource` for Observable-based sources or when you need RxJS operators in the pipeline. Use `resource` for non-HTTP async sources like IndexedDB, Web Workers, or third-party SDKs.
