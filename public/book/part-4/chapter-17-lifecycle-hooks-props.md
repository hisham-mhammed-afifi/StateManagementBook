# Chapter 17: Lifecycle, Hooks, and Props

Look at the `ProductCatalogComponent` we built at the end of Chapter 16. The component injects the store and a `ProductService`, then wires up an `ngOnInit` to fetch products and load them into the store. Every component that uses that store repeats the same pattern: inject the store, inject the service, call the load method on init. That is three moving parts living in the wrong place. The component should not know how products are loaded. It should not hold a reference to `ProductService`. And it certainly should not be responsible for triggering the store's initial data fetch.

SignalStore solves this with two features: `withHooks` moves lifecycle logic into the store itself, and `withProps` gives the store a place to hold the services it needs without scattering `inject()` calls across `withMethods` and `withHooks`. Together, they turn the store into a self-contained unit that initializes its own data, manages its own subscriptions, and cleans up after itself. The component's only job is to read signals and call methods.

## A Quick Recap

In Chapter 15, we covered the four core SignalStore features: `withState` for reactive state, `withComputed` for derived signals, `withMethods` for operations, and `patchState` for immutable updates. In Chapter 16, we replaced array-based collections with `withEntities`, gaining normalized `entityMap`/`ids` state and fifteen standalone updater functions. Our product catalog store defined methods like `setProducts`, `toggleFeatured`, and `setCategory`, but the component was still responsible for fetching data and calling `store.setProducts()` inside its own `ngOnInit`. This chapter eliminates that responsibility by moving initialization into the store with `withHooks` and centralizing dependency injection with `withProps`.

## withHooks: Store Lifecycle Management

The `withHooks` feature attaches lifecycle callbacks to a SignalStore. It supports two hooks: `onInit`, which fires when Angular's dependency injection system first creates the store instance, and `onDestroy`, which fires when the store's injector is destroyed.

Think of `onInit` and `onDestroy` as the store's equivalent of a component's constructor and `ngOnDestroy`. The store becomes responsible for its own setup and teardown.

### The Object Form

The simplest way to use `withHooks` passes an object with `onInit` and/or `onDestroy` methods. Each method receives the store as its argument:

```typescript
// src/app/products/state/product-catalog.store.ts
import { inject } from '@angular/core';
import { signalStore, withMethods, withHooks, patchState } from '@ngrx/signals';
import { withEntities, setAllEntities } from '@ngrx/signals/entities';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Product } from '../product.model';

export const ProductCatalogStore = signalStore(
  { providedIn: 'root' },
  withEntities<Product>(),
  withMethods((store) => {
    const http = inject(HttpClient);

    return {
      async loadProducts(): Promise<void> {
        const products = await firstValueFrom(
          http.get<Product[]>('/api/products')
        );
        patchState(store, setAllEntities(products));
      },
    };
  }),
  withHooks({
    onInit(store) {
      store.loadProducts();
    },
    onDestroy(store) {
      console.log('ProductCatalogStore destroyed, had', store.ids().length, 'products');
    },
  })
);
```

Now the component simplifies to just reading signals:

```typescript
// src/app/products/product-catalog.component.ts
import { Component, inject } from '@angular/core';
import { ProductCatalogStore } from './state/product-catalog.store';

@Component({
  selector: 'app-product-catalog',
  standalone: true,
  template: `
    @for (product of store.entities(); track product.id) {
      <div class="product-card">
        <h3>{{ product.name }}</h3>
        <p>{{ product.price | currency }}</p>
      </div>
    } @empty {
      <p>Loading products...</p>
    }
  `,
})
export class ProductCatalogComponent {
  readonly store = inject(ProductCatalogStore);
}
```

No `ngOnInit`. No `ProductService` import. The store loads its own data.

### The Factory Form

The object form has a limitation: if `onDestroy` needs access to an injected service (say, a logger), there is no clean place to call `inject()` inside the hook itself. The `onDestroy` callback runs outside Angular's injection context, so calling `inject()` directly inside it throws a runtime error.

The factory form solves this. Instead of passing an object, you pass a function. The function receives the store and returns the hooks object. Because the function body runs within Angular's injection context, you can call `inject()` before returning:

```typescript
// src/app/products/state/product-catalog.store.ts
import { inject, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { signalStore, withState, withMethods, withHooks, patchState } from '@ngrx/signals';
import { interval } from 'rxjs';

export const PriceTickerStore = signalStore(
  withState({ tickCount: 0 }),
  withMethods((store) => ({
    tick(): void {
      patchState(store, (state) => ({ tickCount: state.tickCount + 1 }));
    },
  })),
  withHooks((store) => {
    const destroyRef = inject(DestroyRef);

    return {
      onInit() {
        interval(10_000)
          .pipe(takeUntilDestroyed(destroyRef))
          .subscribe(() => store.tick());
      },
      onDestroy() {
        console.log('PriceTickerStore stopped after', store.tickCount(), 'ticks');
      },
    };
  })
);
```

The factory function captures `destroyRef` in its closure. The `onInit` hook uses it to auto-cancel the interval subscription when the store is destroyed. The `onDestroy` hook reads the final tick count from the store via the same closure. No `inject()` call inside either hook.

### When onInit and onDestroy Fire

The timing of lifecycle hooks depends on how the store is provided:

**Root-level stores** (`providedIn: 'root'`): The store is a singleton. `onInit` fires once, the first time any component or service injects the store. `onDestroy` fires when the application shuts down (rarely relevant in production, but useful in tests).

**Component-level stores** (listed in a component's `providers` array): Angular creates a new store instance for each component instance. `onInit` fires each time the component is created. `onDestroy` fires each time the component is destroyed. This is ideal for stores that manage component-local state, like a form wizard or a multi-step dialog.

```typescript
// src/app/checkout/checkout-wizard.component.ts
import { Component, inject } from '@angular/core';
import { CheckoutStore } from './state/checkout.store';

@Component({
  selector: 'app-checkout-wizard',
  standalone: true,
  providers: [CheckoutStore],
  template: `
    @switch (store.currentStep()) {
      @case ('cart') { <app-cart-step /> }
      @case ('shipping') { <app-shipping-step /> }
      @case ('payment') { <app-payment-step /> }
    }
  `,
})
export class CheckoutWizardComponent {
  readonly store = inject(CheckoutStore);
}
```

```typescript
// src/app/checkout/state/checkout.store.ts
import { signalStore, withState, withMethods, withHooks, patchState } from '@ngrx/signals';

type CheckoutStep = 'cart' | 'shipping' | 'payment';

interface CheckoutState {
  currentStep: CheckoutStep;
  shippingAddress: string;
  paymentMethod: string;
}

const initialState: CheckoutState = {
  currentStep: 'cart',
  shippingAddress: '',
  paymentMethod: '',
};

export const CheckoutStore = signalStore(
  withState(initialState),
  withMethods((store) => ({
    goToStep(step: CheckoutStep): void {
      patchState(store, { currentStep: step });
    },
    setShippingAddress(address: string): void {
      patchState(store, { shippingAddress: address });
    },
    setPaymentMethod(method: string): void {
      patchState(store, { paymentMethod: method });
    },
    reset(): void {
      patchState(store, initialState);
    },
  })),
  withHooks({
    onInit() {
      console.log('Checkout session started');
    },
    onDestroy(store) {
      console.log('Checkout session ended at step:', store.currentStep());
    },
  })
);
```

Every time the user navigates to the checkout page, a fresh `CheckoutStore` is created with clean initial state. When the user navigates away, the store is destroyed. No stale state from a previous checkout leaks through.

### Chaining Multiple withHooks

You can call `withHooks` more than once in a single `signalStore()` declaration. Hooks are merged, not overwritten. All `onInit` callbacks run in declaration order, and all `onDestroy` callbacks run in declaration order:

```typescript
// src/app/analytics/state/analytics.store.ts
import { signalStore, withState, withMethods, withHooks, patchState } from '@ngrx/signals';

export const AnalyticsStore = signalStore(
  withState({ events: [] as string[] }),
  withMethods((store) => ({
    track(event: string): void {
      patchState(store, (state) => ({ events: [...state.events, event] }));
    },
  })),
  withHooks({
    onInit(store) {
      store.track('store_initialized');
    },
  }),
  withHooks({
    onInit(store) {
      store.track('tracking_ready');
    },
  })
);
// On init: events will contain ['store_initialized', 'tracking_ready']
```

This matters most when composing reusable store features (covered in Chapter 18). A custom `signalStoreFeature` can include its own `withHooks`, and those hooks merge cleanly with the consuming store's hooks.

## withProps: The Store's Toolbox

Before `withProps` existed (it arrived in NgRx 19), every `inject()` call lived inside `withMethods` or `withHooks`. A store that needed `HttpClient`, a notification service, and a logger would inject each one separately wherever it was used, duplicating `inject()` calls across features. Worse, two `withMethods` blocks that both needed the same service had no way to share the injected instance without restructuring the store.

`withProps` solves this by giving the store a dedicated place to hold non-reactive properties: injected services, observables derived from signals, configuration objects, or any other value that does not belong in `withState` (reactive, frozen), `withComputed` (reactive, derived), or `withMethods` (operations).

### Centralizing Dependencies

```typescript
// src/app/products/state/product-catalog.store.ts
import { inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  signalStore,
  withState,
  withProps,
  withComputed,
  withMethods,
  withHooks,
  patchState,
} from '@ngrx/signals';
import { withEntities, setAllEntities, updateEntity } from '@ngrx/signals/entities';
import { computed } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Product } from '../product.model';

type SortField = 'name' | 'price';
type SortDirection = 'asc' | 'desc';

interface CatalogFilters {
  category: string;
  searchTerm: string;
  sortField: SortField;
  sortDirection: SortDirection;
  loading: boolean;
}

const initialFilters: CatalogFilters = {
  category: 'all',
  searchTerm: '',
  sortField: 'name',
  sortDirection: 'asc',
  loading: false,
};

export const ProductCatalogStore = signalStore(
  { providedIn: 'root' },
  withEntities<Product>(),
  withState(initialFilters),
  withProps(() => ({
    _http: inject(HttpClient),
    _notificationService: inject(NotificationService),
  })),
  withComputed((store) => ({
    filteredProducts: computed(() => {
      let products = store.entities();
      const category = store.category();
      const searchTerm = store.searchTerm().toLowerCase();

      if (category !== 'all') {
        products = products.filter((p) => p.category === category);
      }
      if (searchTerm) {
        products = products.filter(
          (p) =>
            p.name.toLowerCase().includes(searchTerm) ||
            p.description.toLowerCase().includes(searchTerm)
        );
      }

      const field = store.sortField();
      const direction = store.sortDirection() === 'asc' ? 1 : -1;
      return [...products].sort((a, b) => {
        if (field === 'price') return (a.price - b.price) * direction;
        return a.name.localeCompare(b.name) * direction;
      });
    }),
    totalProducts: computed(() => store.ids().length),
    categories: computed(() => {
      const cats = new Set(store.entities().map((p) => p.category));
      return ['all', ...Array.from(cats).sort()];
    }),
  })),
  withMethods(({ _http, _notificationService, ...store }) => ({
    async loadProducts(): Promise<void> {
      patchState(store, { loading: true });
      const products = await firstValueFrom(
        _http.get<Product[]>('/api/products')
      );
      patchState(store, setAllEntities(products), { loading: false });
    },
    async updatePrice(id: string, price: number): Promise<void> {
      await firstValueFrom(
        _http.patch(`/api/products/${id}`, { price })
      );
      patchState(store, updateEntity({ id, changes: { price } }));
      _notificationService.success('Price updated');
    },
    setCategory(category: string): void {
      patchState(store, { category });
    },
    setSearchTerm(searchTerm: string): void {
      patchState(store, { searchTerm });
    },
    setSorting(sortField: SortField, sortDirection: SortDirection): void {
      patchState(store, { sortField, sortDirection });
    },
  })),
  withHooks({
    onInit(store) {
      store.loadProducts();
    },
  })
);
```

Notice how `_http` and `_notificationService` are injected once in `withProps` and then destructured in `withMethods`. The underscore prefix is not just a naming convention. SignalStore treats any property starting with `_` as private: it will not appear on the store's public API when a component calls `inject(ProductCatalogStore)`. Components can access `store.entities()`, `store.loadProducts()`, and `store.filteredProducts()`, but not `store._http` or `store._notificationService`.

### The Underscore Convention

To be precise about what "private" means in this context: SignalStore strips `_`-prefixed members from the store's TypeScript type when it is used externally. Inside the store's own features (`withComputed`, `withMethods`, `withHooks`), private properties are fully accessible. This gives you encapsulation without needing actual JavaScript private fields.

```typescript
// Inside the store: full access
withMethods(({ _http, ...store }) => ({
  // _http is accessible here
}))

// Outside the store: TypeScript hides it
const store = inject(ProductCatalogStore);
store._http;  // TypeScript error: Property '_http' does not exist
```

### What withProps Can Hold

`withProps` accepts any object. Common use cases:

1. **Injected services**: `inject(HttpClient)`, `inject(Router)`, custom services
2. **Observables derived from signals**: `toObservable(someSignal).pipe(...)`
3. **Static configuration**: `{ apiUrl: '/api/v2', pageSize: 25 }`
4. **Angular resources**: `resource()`, `rxResource()` (experimental)

What it should not hold: reactive state that changes over time. If a value needs to trigger re-renders when it changes, it belongs in `withState` (for writable state) or `withComputed` (for derived state). `withProps` values are not signals. Changing a `withProps` property does not notify consumers.

### Bridging Signals to Observables

Some operations are easier with RxJS operators: debouncing, throttling, complex async coordination. `withProps` can bridge a signal into an observable, giving the rest of the store an RxJS pipeline to work with:

```typescript
// src/app/search/state/product-search.store.ts
import { inject, DestroyRef } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  signalStore,
  withState,
  withProps,
  withMethods,
  withHooks,
  patchState,
} from '@ngrx/signals';
import { withEntities, setAllEntities } from '@ngrx/signals/entities';
import { HttpClient } from '@angular/common/http';
import { debounceTime, distinctUntilChanged, switchMap, tap } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { Product } from '../product.model';

export const ProductSearchStore = signalStore(
  withEntities<Product>(),
  withState({ query: '', searching: false }),
  withProps(() => ({
    _http: inject(HttpClient),
  })),
  withProps(({ query }) => ({
    _debouncedQuery$: toObservable(query).pipe(
      debounceTime(300),
      distinctUntilChanged()
    ),
  })),
  withMethods(({ _http, ...store }) => ({
    setQuery(query: string): void {
      patchState(store, { query });
    },
    async executeSearch(query: string): Promise<void> {
      if (!query.trim()) {
        patchState(store, setAllEntities([] as Product[]), { searching: false });
        return;
      }
      patchState(store, { searching: true });
      const results = await firstValueFrom(
        _http.get<Product[]>('/api/products/search', {
          params: { q: query },
        })
      );
      patchState(store, setAllEntities(results), { searching: false });
    },
  })),
  withHooks((store) => {
    const destroyRef = inject(DestroyRef);

    return {
      onInit() {
        store._debouncedQuery$
          .pipe(takeUntilDestroyed(destroyRef))
          .subscribe((query) => store.executeSearch(query));
      },
    };
  })
);
```

Here, `withProps` creates `_debouncedQuery$`, an observable that debounces the `query` signal. The `withHooks` factory subscribes to it on init, using `takeUntilDestroyed` for automatic cleanup. The component only needs to call `store.setQuery(value)`, and the debounced search happens automatically.

Notice the second `withProps` call. It receives the store (including the `query` signal from `withState`) and derives an observable from it. Multiple `withProps` calls are perfectly valid. Each one can access everything defined by previous features.

### The Grouped Dependencies Pattern

When a store has many injected services, individual `_serviceName` properties can clutter the store's internal API. Grouping dependencies under a single `_deps` property keeps things organized:

```typescript
// src/app/orders/state/order-management.store.ts
import { inject } from '@angular/core';
import { signalStore, withState, withProps, withMethods, patchState } from '@ngrx/signals';
import { withEntities, setAllEntities, updateEntity } from '@ngrx/signals/entities';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

interface Order {
  id: string;
  customerId: string;
  status: 'pending' | 'confirmed' | 'shipped';
  total: number;
}

export const OrderManagementStore = signalStore(
  { providedIn: 'root' },
  withEntities<Order>(),
  withState({ selectedOrderId: null as string | null }),
  withProps(() => ({
    _deps: {
      http: inject(HttpClient),
      router: inject(Router),
      notifications: inject(NotificationService),
      logger: inject(LoggerService),
    },
  })),
  withMethods(({ _deps, ...store }) => ({
    async loadOrders(): Promise<void> {
      const orders = await firstValueFrom(
        _deps.http.get<Order[]>('/api/orders')
      );
      patchState(store, setAllEntities(orders));
      _deps.logger.info('Loaded', orders.length, 'orders');
    },
    async confirmOrder(id: string): Promise<void> {
      await firstValueFrom(
        _deps.http.patch(`/api/orders/${id}`, { status: 'confirmed' })
      );
      patchState(store, updateEntity({ id, changes: { status: 'confirmed' as const } }));
      _deps.notifications.success('Order confirmed');
    },
    selectOrder(id: string): void {
      patchState(store, { selectedOrderId: id });
      _deps.router.navigate(['/orders', id]);
    },
  }))
);
```

The `_deps` object is private (underscore prefix), and its nested properties are plain references to injected services. The destructuring `{ _deps, ...store }` in `withMethods` keeps method bodies clean: `_deps.http` instead of `store._http`.

## withProps vs withState: Choosing the Right Feature

The distinction is simple but critical:

| Aspect | `withState` | `withProps` |
|--------|-------------|-------------|
| Values are signals | Yes | No |
| Values are frozen (dev mode) | Yes (recursive `Object.freeze`) | No |
| Changes trigger re-renders | Yes | No |
| Updated via `patchState` | Yes | Not applicable |
| Use for | Reactive data the template reads | Services, observables, config, resources |

A common mistake is putting a `FormGroup` or an Angular `resource()` in `withState`. In development mode, NgRx v19+ recursively freezes all `withState` values. A `FormGroup` internally mutates its control values, so freezing it throws runtime errors. The fix is to move mutable, non-reactive objects to `withProps`.

## A Complete Working Example

Let us build a product catalog with search, auto-loading, and subscription cleanup. This ties together everything from this chapter:

```typescript
// src/app/products/state/product-catalog-v2.store.ts
import { computed, inject, DestroyRef } from '@angular/core';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import {
  signalStore,
  withState,
  withProps,
  withComputed,
  withMethods,
  withHooks,
  patchState,
} from '@ngrx/signals';
import { withEntities, setAllEntities } from '@ngrx/signals/entities';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { Product } from '../product.model';

interface CatalogState {
  searchTerm: string;
  selectedCategory: string;
  loading: boolean;
  error: string | null;
}

const initialState: CatalogState = {
  searchTerm: '',
  selectedCategory: 'all',
  loading: false,
  error: null,
};

export const ProductCatalogV2Store = signalStore(
  { providedIn: 'root' },
  withEntities<Product>(),
  withState(initialState),
  withProps(() => ({
    _http: inject(HttpClient),
  })),
  withProps(({ searchTerm }) => ({
    _debouncedSearch$: toObservable(searchTerm).pipe(
      debounceTime(300),
      distinctUntilChanged()
    ),
  })),
  withComputed((store) => ({
    filteredProducts: computed(() => {
      let products = store.entities();
      const category = store.selectedCategory();
      const term = store.searchTerm().toLowerCase();

      if (category !== 'all') {
        products = products.filter((p) => p.category === category);
      }
      if (term) {
        products = products.filter((p) =>
          p.name.toLowerCase().includes(term)
        );
      }
      return products;
    }),
    categories: computed(() => {
      const cats = new Set(store.entities().map((p) => p.category));
      return ['all', ...Array.from(cats).sort()];
    }),
    productCount: computed(() => store.ids().length),
  })),
  withMethods(({ _http, ...store }) => ({
    async loadProducts(): Promise<void> {
      patchState(store, { loading: true, error: null });
      try {
        const products = await firstValueFrom(
          _http.get<Product[]>('/api/products')
        );
        patchState(store, setAllEntities(products), { loading: false });
      } catch (err) {
        patchState(store, {
          loading: false,
          error: 'Failed to load products. Please try again.',
        });
      }
    },
    setSearchTerm(searchTerm: string): void {
      patchState(store, { searchTerm });
    },
    setCategory(selectedCategory: string): void {
      patchState(store, { selectedCategory });
    },
  })),
  withHooks((store) => {
    const destroyRef = inject(DestroyRef);

    return {
      onInit() {
        store.loadProducts();

        store._debouncedSearch$
          .pipe(takeUntilDestroyed(destroyRef))
          .subscribe((term) => {
            if (term.length >= 3) {
              store.loadProducts();
            }
          });
      },
    };
  })
);
```

```typescript
// src/app/products/product-catalog-v2.component.ts
import { Component, inject } from '@angular/core';
import { ProductCatalogV2Store } from './state/product-catalog-v2.store';

@Component({
  selector: 'app-product-catalog-v2',
  standalone: true,
  template: `
    <h2>Product Catalog ({{ store.productCount() }} products)</h2>

    @if (store.error(); as error) {
      <div class="error-banner">
        <p>{{ error }}</p>
        <button (click)="store.loadProducts()">Retry</button>
      </div>
    }

    <div class="filters">
      <input
        type="text"
        placeholder="Search products..."
        [value]="store.searchTerm()"
        (input)="store.setSearchTerm($any($event.target).value)"
      />

      <select
        [value]="store.selectedCategory()"
        (change)="store.setCategory($any($event.target).value)"
      >
        @for (cat of store.categories(); track cat) {
          <option [value]="cat">{{ cat }}</option>
        }
      </select>
    </div>

    @if (store.loading()) {
      <div class="loading-spinner">Loading...</div>
    } @else {
      <div class="product-grid">
        @for (product of store.filteredProducts(); track product.id) {
          <div class="product-card">
            <h3>{{ product.name }}</h3>
            <p class="price">{{ product.price | currency }}</p>
            <span class="badge">{{ product.category }}</span>
          </div>
        } @empty {
          <p>No products match your search.</p>
        }
      </div>
    }
  `,
})
export class ProductCatalogV2Component {
  readonly store = inject(ProductCatalogV2Store);
}
```

The component is 40 lines of pure template. No `OnInit`, no service injection, no subscription management. The store handles everything: initial data loading in `onInit`, debounced search via the `_debouncedSearch$` observable in `withProps`, error handling in methods, and automatic cleanup through `takeUntilDestroyed`.

## Feature Ordering: The Dependency Chain

Every SignalStore feature can access store members defined by features that appear before it, but not after. This creates a top-to-bottom dependency chain:

```
signalStore(
  withEntities<Product>(),            // 1. State (entities)
  withState(initialFilters),           // 2. More state (filters)
  withProps(() => ({ ... })),          // 3. Props: can access 1 + 2
  withComputed((store) => ({ ... })), // 4. Computed: can access 1 + 2 + 3
  withMethods((store) => ({ ... })),  // 5. Methods: can access 1 + 2 + 3 + 4
  withHooks((store) => ({ ... })),    // 6. Hooks: can access 1 + 2 + 3 + 4 + 5
)
```

`withHooks` typically appears last because it needs to call methods defined in `withMethods`. If you place `withHooks` before `withMethods`, the hook cannot call any method, because from its position in the chain, methods do not exist yet.

`withProps` typically appears early, right after state, because `withComputed`, `withMethods`, and `withHooks` all need access to the injected dependencies it provides.

## Common Mistakes

### Mistake 1: Calling inject() Inside onDestroy

```typescript
// WRONG: inject() called outside injection context
withHooks({
  onDestroy(store) {
    const logger = inject(LoggerService); // Runtime error!
    logger.info('Store destroyed');
  },
})
```

The `onDestroy` callback runs when Angular's injector is being torn down. At that point, the injection context is no longer available. Calling `inject()` throws `Error: inject() must be called from an injection context`.

```typescript
// CORRECT: use the factory form to capture the service in closure scope
withHooks((store) => {
  const logger = inject(LoggerService);

  return {
    onDestroy() {
      logger.info('Store destroyed');
    },
  };
})
```

The factory function runs within the injection context when the store is created. The `logger` reference is captured in the closure and remains accessible when `onDestroy` fires later.

### Mistake 2: Placing withHooks Before withMethods

```typescript
// WRONG: withHooks cannot see methods defined after it
export const BrokenStore = signalStore(
  withState({ items: [] as string[] }),
  withHooks({
    onInit(store) {
      store.loadItems(); // TypeScript error: 'loadItems' does not exist
    },
  }),
  withMethods((store) => ({
    loadItems(): void {
      patchState(store, { items: ['a', 'b', 'c'] });
    },
  }))
);
```

Features in `signalStore()` build on each other top to bottom. `withHooks` at position 2 can only see `withState` at position 1. It cannot see `withMethods` at position 3.

```typescript
// CORRECT: place withMethods before withHooks
export const FixedStore = signalStore(
  withState({ items: [] as string[] }),
  withMethods((store) => ({
    loadItems(): void {
      patchState(store, { items: ['a', 'b', 'c'] });
    },
  })),
  withHooks({
    onInit(store) {
      store.loadItems();
    },
  })
);
```

### Mistake 3: Putting Mutable Objects in withState Instead of withProps

```typescript
// WRONG: FormGroup in withState gets frozen in dev mode
import { FormGroup, FormControl } from '@angular/forms';

export const FormStore = signalStore(
  withState({
    form: new FormGroup({
      name: new FormControl(''),
      email: new FormControl(''),
    }),
  })
);
// Runtime error in dev: Cannot assign to read-only property 'value'
```

NgRx v19+ recursively freezes `withState` values using `Object.freeze()`. `FormGroup` internally mutates its properties when users type into form controls. Freezing the `FormGroup` makes those mutations throw.

```typescript
// CORRECT: use withProps for mutable objects
export const FormStore = signalStore(
  withProps(() => ({
    form: new FormGroup({
      name: new FormControl(''),
      email: new FormControl(''),
    }),
  })),
  withMethods(({ form }) => ({
    reset(): void {
      form.reset();
    },
  }))
);
```

`withProps` values are not frozen. The `FormGroup` can mutate its internals freely.

### Mistake 4: Using withProps for Reactive State

```typescript
// WRONG: counter is not a signal, template will not update
export const CounterStore = signalStore(
  withProps(() => ({
    counter: { value: 0 },
  })),
  withMethods((store) => ({
    increment(): void {
      store.counter.value++; // Mutates, but no signal update
    },
  }))
);
```

`withProps` values are plain objects. Mutating `store.counter.value` does not trigger change detection. The template will not reflect the new value.

```typescript
// CORRECT: use withState for reactive data
export const CounterStore = signalStore(
  withState({ counter: 0 }),
  withMethods((store) => ({
    increment(): void {
      patchState(store, (state) => ({ counter: state.counter + 1 }));
    },
  }))
);
```

If the value needs to trigger re-renders, it belongs in `withState`. If it is a dependency, configuration, or bridge object, it belongs in `withProps`.

## Key Takeaways

- **`withHooks` moves lifecycle logic from the component into the store.** Use `onInit` for data loading and subscription setup. Use `onDestroy` for cleanup and logging. The component becomes a pure template consumer.

- **Use the factory form of `withHooks` when you need `inject()`.** The factory runs within Angular's injection context, letting you capture services in a closure that both `onInit` and `onDestroy` can access.

- **`withProps` centralizes dependency injection.** Inject services once, prefix them with `_` to keep them private, and destructure them in `withMethods` and `withHooks`. This eliminates scattered `inject()` calls and makes the store's dependencies explicit.

- **Feature ordering defines the dependency chain.** State and entities first, then `withProps` for dependencies, then `withComputed` for derived data, then `withMethods` for operations, then `withHooks` for lifecycle. Each feature can access everything above it, nothing below.

- **`withState` is for reactive data. `withProps` is for everything else.** Services, observables, mutable objects like `FormGroup`, static configuration, and resources all belong in `withProps`. If you need change detection, use `withState`.
