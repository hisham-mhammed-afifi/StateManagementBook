# Chapter 23: State Design Principles

Your team's e-commerce application has grown to forty components and a dozen stores. The product catalog store has a `products` array, the order detail page has an `order` object with a nested `customer` that includes a nested `address`, and the cart duplicates product objects so it can display names and prices. When a product price changes, the catalog updates but the cart still shows the old price until the user refreshes the page. An intern adds `isLoading`, `hasError`, and `isSuccess` as three separate booleans to the order store, and within a week a bug report arrives: the order page simultaneously shows a loading spinner and an error message. The search feature stores a `filteredProducts` array alongside the full `products` array, and after a sorting change someone forgets to update the filter, leaving stale results on screen. These are not library bugs. They are state design bugs, and no amount of NgRx or SignalStore sophistication will prevent them.

This chapter introduces four principles that, taken together, eliminate entire categories of state bugs before they happen: normalization, derived state, status patterns, and error state patterns. We will apply each principle to a product catalog feature, showing implementations in both Classic Store and SignalStore so you can adopt them regardless of which tool your team uses.

## A Brief Recap

Part 4 covered SignalStore's APIs in detail: `withState` for reactive state, `withComputed` for derived values, `withEntities` for normalized collections, and `patchState` for immutable updates (Chapters 15 through 22). Part 3 covered Classic Store: actions, reducers, selectors via `createSelector`, and `@ngrx/entity` for entity management (Chapters 8 through 14). This chapter builds on both foundations. If you have not read those sections, the quick-reference code blocks below include enough context to follow along, but you may want to revisit Chapter 9 (Selectors and Memoization) and Chapter 15 (SignalStore Fundamentals) for the full API walkthroughs.

## Principle 1: Normalize Your Entity Collections

### The Problem with Nested State

Consider an order management feature where the API returns deeply nested objects:

```typescript
// src/app/orders/models/order-api-response.ts
export interface OrderApiResponse {
  id: string;
  customer: {
    id: string;
    name: string;
    email: string;
    address: {
      street: string;
      city: string;
      zip: string;
    };
  };
  items: Array<{
    product: {
      id: string;
      name: string;
      price: number;
      category: string;
    };
    quantity: number;
  }>;
  total: number;
  status: 'pending' | 'shipped' | 'delivered';
}
```

If we store this structure as-is and customer "Alice" appears in five orders, she exists five times in memory. Update her email address and we need to find and patch every occurrence. Miss one and we show stale data. Worse, immutable updates on nested objects require copying every level of the tree:

```typescript
// Updating a nested customer email requires four spread operations
const updated = {
  ...state,
  orders: state.orders.map(order =>
    order.id === targetOrderId
      ? {
          ...order,
          customer: {
            ...order.customer,
            email: newEmail,
          },
        }
      : order
  ),
};
```

This is fragile, verbose, and error-prone.

### Normalized State Shape

Normalization treats your store like a relational database. Each entity type lives in its own flat dictionary, keyed by ID. Relationships are expressed through ID references, never nested objects.

```
┌───────────────────────────────────────┐
│           Normalized Store            │
├───────────────┬───────────────────────┤
│   customers   │ { ids, entities }     │
├───────────────┼───────────────────────┤
│   products    │ { ids, entities }     │
├───────────────┼───────────────────────┤
│   orders      │ { ids, entities }     │
│               │ (references customer  │
│               │  and product by ID)   │
└───────────────┴───────────────────────┘
```

Each entity appears exactly once. Updates happen in one place. Lookups by ID are O(1) instead of O(n).

### Normalized Models

```typescript
// src/app/shared/models/customer.model.ts
export interface Customer {
  id: string;
  name: string;
  email: string;
  street: string;
  city: string;
  zip: string;
}
```

```typescript
// src/app/shared/models/order.model.ts
export interface Order {
  id: string;
  customerId: string;
  itemIds: string[];
  total: number;
  status: 'pending' | 'shipped' | 'delivered';
}
```

```typescript
// src/app/shared/models/order-item.model.ts
export interface OrderItem {
  id: string;
  productId: string;
  quantity: number;
}
```

```typescript
// src/app/shared/models/product.model.ts
export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
}
```

Notice: `Order` holds `customerId`, not a `Customer` object. `OrderItem` holds `productId`, not a `Product` object. Every relationship is an ID reference.

### Classic Store: Normalization with @ngrx/entity

The `@ngrx/entity` adapter stores each collection in the `{ ids, entities }` shape automatically:

```typescript
// src/app/orders/state/order.reducer.ts
import { createEntityAdapter, EntityState } from '@ngrx/entity';
import { createReducer, on } from '@ngrx/store';
import { Order } from '../../shared/models/order.model';
import { OrderApiActions } from './order.actions';

export interface OrderState extends EntityState<Order> {
  selectedOrderId: string | null;
}

const adapter = createEntityAdapter<Order>();

const initialState: OrderState = adapter.getInitialState({
  selectedOrderId: null,
});

export const orderReducer = createReducer(
  initialState,
  on(OrderApiActions.loadOrdersSuccess, (state, { orders }) =>
    adapter.setAll(orders, state)
  ),
  on(OrderApiActions.selectOrder, (state, { orderId }) => ({
    ...state,
    selectedOrderId: orderId,
  })),
  on(OrderApiActions.updateOrderStatus, (state, { orderId, status }) =>
    adapter.updateOne({ id: orderId, changes: { status } }, state)
  )
);

export const { selectAll: selectAllOrders, selectEntities: selectOrderEntities } =
  adapter.getSelectors();
```

The adapter's `setAll`, `addOne`, `updateOne`, and `removeOne` methods handle the dictionary bookkeeping. `updateOne` takes an `Update<T>` object with `{ id, changes }` for partial updates, so you never need to spread nested objects.

### SignalStore: Normalization with withEntities

SignalStore provides the same normalized structure through `withEntities`:

```typescript
// src/app/orders/store/order.store.ts
import { computed, inject } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';
import {
  withEntities,
  setAllEntities,
  updateEntity,
} from '@ngrx/signals/entities';
import { Order } from '../../shared/models/order.model';

export const OrderStore = signalStore(
  { providedIn: 'root' },
  withEntities<Order>(),
  withState({ selectedOrderId: null as string | null }),
  withComputed((store) => ({
    selectedOrder: computed(() => {
      const id = store.selectedOrderId();
      return id ? store.entityMap()[id] ?? null : null;
    }),
  })),
  withMethods((store) => ({
    selectOrder(orderId: string): void {
      patchState(store, { selectedOrderId: orderId });
    },
    setOrders(orders: Order[]): void {
      patchState(store, setAllEntities(orders));
    },
    updateStatus(orderId: string, status: Order['status']): void {
      patchState(store, updateEntity({ id: orderId, changes: { status } }));
    },
  }))
);
```

`withEntities<Order>()` provides three signals: `entities()` (the full array), `entityMap()` (the ID-keyed dictionary), and `ids()` (the ordered ID array). The entity updater functions (`setAllEntities`, `updateEntity`, `removeEntity`) handle the normalized structure internally.

### When to Normalize

Normalize when:

- A collection has more than a handful of items.
- The same entity appears in multiple places (a customer across orders, a product across a catalog and a cart).
- Entities are frequently updated in place.
- You have many-to-many relationships (tags on products, users in teams).

Skip normalization for:

- Small, read-only lookup data (a list of country codes, a set of status labels).
- Ephemeral UI state that does not involve entities.
- Data scoped to a single component that is never shared.

### The Normalization Rule

Normalize when data enters the store. Denormalize when data leaves the store. Effects and store methods transform API responses into flat, ID-keyed structures. Selectors and computed signals reassemble related entities for the UI. The store itself stays flat, fast, and free of duplication.

## Principle 2: Derive, Don't Store

### The Minimal State Rule

Store only the irreducible minimum: raw data from the server, user selections, and form inputs. Everything else should be computed at read time.

Consider a product catalog where the user can filter by category and search by name. A tempting state shape looks like this:

```typescript
// WRONG: storing derived values
interface ProductState {
  products: Product[];
  selectedCategory: string | null;
  searchTerm: string;
  filteredProducts: Product[];  // derived from products + category + search
  productCount: number;         // derived from filteredProducts
  isEmpty: boolean;             // derived from productCount
}
```

Three of these six properties are fully determined by the other three. Storing them creates synchronization bugs. Forget to update `filteredProducts` after changing `searchTerm` and the UI shows stale results. Store `isEmpty` alongside `productCount` and they can contradict each other.

### The Correct Approach: computed() and Selectors

In SignalStore, derived values belong in `withComputed`:

```typescript
// src/app/products/store/product-catalog.store.ts
import { computed, inject } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';
import { withEntities } from '@ngrx/signals/entities';
import { Product } from '../../shared/models/product.model';

export const ProductCatalogStore = signalStore(
  { providedIn: 'root' },
  withEntities<Product>(),
  withState({
    selectedCategory: null as string | null,
    searchTerm: '',
  }),
  withComputed((store) => ({
    filteredProducts: computed(() => {
      const category = store.selectedCategory();
      const term = store.searchTerm().toLowerCase();
      let result = store.entities();
      if (category) {
        result = result.filter((p) => p.category === category);
      }
      if (term) {
        result = result.filter((p) => p.name.toLowerCase().includes(term));
      }
      return result;
    }),
  })),
  withComputed((store) => ({
    productCount: computed(() => store.filteredProducts().length),
    isEmpty: computed(() => store.filteredProducts().length === 0),
  })),
  withMethods((store) => ({
    setCategory(category: string | null): void {
      patchState(store, { selectedCategory: category });
    },
    setSearchTerm(term: string): void {
      patchState(store, { searchTerm: term });
    },
  }))
);
```

The state only holds `selectedCategory` and `searchTerm`. Everything else is derived. When `selectedCategory` changes, `filteredProducts` recomputes automatically. `productCount` and `isEmpty` follow. No synchronization code, no stale values.

Notice the two separate `withComputed` calls. Order matters: `filteredProducts` must be defined before `productCount` and `isEmpty` can reference it. Each `withComputed` adds its signals to the store for subsequent features to consume.

In Classic Store, the same principle applies through composed selectors:

```typescript
// src/app/products/state/product.selectors.ts
import { createFeatureSelector, createSelector } from '@ngrx/store';
import { ProductState } from './product.reducer';

const selectProductState = createFeatureSelector<ProductState>('products');
const selectAllProducts = createSelector(selectProductState, (s) => s.products);
const selectCategory = createSelector(selectProductState, (s) => s.selectedCategory);
const selectSearchTerm = createSelector(selectProductState, (s) => s.searchTerm);

export const selectFilteredProducts = createSelector(
  selectAllProducts,
  selectCategory,
  selectSearchTerm,
  (products, category, term) => {
    let result = products;
    if (category) {
      result = result.filter((p) => p.category === category);
    }
    if (term) {
      const lower = term.toLowerCase();
      result = result.filter((p) => p.name.toLowerCase().includes(lower));
    }
    return result;
  }
);

export const selectProductCount = createSelector(
  selectFilteredProducts,
  (products) => products.length
);

export const selectIsEmpty = createSelector(
  selectProductCount,
  (count) => count === 0
);
```

Both `computed()` and `createSelector()` are memoized. They only recompute when their inputs actually change. This means derived state is not just correct, it is efficient.

### computed() vs effect() for Derived State

The single most common mistake with Angular signals is using `effect()` to derive state instead of `computed()`. The rule is simple: if you are calculating a value from other state, use `computed()`. If you are causing a side effect (writing to localStorage, logging, manipulating the DOM), use `effect()`.

`computed()` is synchronous, memoized, and glitch-free. Angular guarantees that when you read a computed signal, all of its dependencies reflect the latest values. `effect()` is asynchronous. It runs after the current change detection cycle, which means intermediate reads during the same microtask may see stale derived values. It also has no memoization and no return value.

### linkedSignal for Writable Derived State

Sometimes you need derived state that the user can override. For example, a selected page size that resets to a default when the dataset changes, but the user can choose a different size.

```typescript
// src/app/products/components/product-table.component.ts
import { Component, computed, inject, signal } from '@angular/core';
import { linkedSignal } from '@angular/core';
import { ProductCatalogStore } from '../store/product-catalog.store';

@Component({
  selector: 'app-product-table',
  template: `
    <select (change)="onPageSizeChange($event)">
      @for (size of pageSizeOptions; track size) {
        <option [value]="size" [selected]="size === pageSize()">{{ size }}</option>
      }
    </select>
    <p>Showing page size {{ pageSize() }} of {{ store.productCount() }} products</p>
  `,
})
export class ProductTableComponent {
  readonly store = inject(ProductCatalogStore);
  readonly pageSizeOptions = [10, 25, 50, 100];

  readonly pageSize = linkedSignal({
    source: this.store.productCount,
    computation: (count) => (count > 50 ? 25 : 10),
  });

  onPageSizeChange(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);
    this.pageSize.set(value);
  }
}
```

When `productCount` changes (because the user changed a filter), `pageSize` resets to the computed default. But the user can override it via the dropdown, and that override persists until the source changes again. This is writable derived state: `computed()` cannot do it because it is read-only, and a plain `signal()` would not reset when the dataset changes.

## Principle 3: Status Patterns with Discriminated Unions

### The Boolean Flag Trap

Independent boolean flags for async status create impossible state combinations:

```typescript
// WRONG: boolean flag soup
interface ProductState {
  products: Product[];
  isLoading: boolean;
  hasError: boolean;
  errorMessage: string | null;
}
```

With three booleans and a nullable string, this interface allows states that make no sense: `isLoading: true` and `hasError: true` simultaneously, or `hasError: true` with `errorMessage: null`. Each new flag doubles the number of possible combinations. Four booleans produce sixteen states, and your UI needs to handle all of them.

### The CallState Discriminated Union

Replace the booleans with a single property that can only hold one status at a time:

```typescript
// src/app/shared/models/call-state.model.ts
export type CallState = 'init' | 'loading' | 'loaded' | { error: string };
```

This type has exactly four states, all mutually exclusive. TypeScript's type narrowing enforces correctness: if `callState` is `'loading'`, it cannot simultaneously be `{ error: string }`. The state machine is encoded in the type system.

Angular's own `resource()` and `httpResource()` APIs follow this same principle. The `ResourceStatus` enum uses `Idle`, `Loading`, `Reloading`, `Resolved`, `Error`, and `Local` as distinct, non-overlapping states.

### Building a Reusable withCallState Feature

We can encapsulate the CallState pattern as a reusable SignalStore feature:

```typescript
// src/app/shared/state/call-state.feature.ts
import { computed, Signal } from '@angular/core';
import { signalStoreFeature, withComputed, withState } from '@ngrx/signals';

export type CallState = 'init' | 'loading' | 'loaded' | { error: string };

export function setLoading(): { callState: CallState } {
  return { callState: 'loading' };
}

export function setLoaded(): { callState: CallState } {
  return { callState: 'loaded' };
}

export function setError(error: string): { callState: CallState } {
  return { callState: { error } };
}

export function withCallState() {
  return signalStoreFeature(
    withState<{ callState: CallState }>({ callState: 'init' }),
    withComputed(({ callState }) => ({
      loading: computed(() => callState() === 'loading'),
      loaded: computed(() => callState() === 'loaded'),
      error: computed(() => {
        const state = callState();
        return typeof state === 'object' ? state.error : null;
      }),
    }))
  );
}
```

This feature adds a `callState` property to the store's state and exposes three derived signals: `loading()`, `loaded()`, and `error()`. The updater functions (`setLoading`, `setLoaded`, `setError`) return partial state objects compatible with `patchState`.

### Using withCallState in a Store

```typescript
// src/app/products/store/product-api.store.ts
import { inject } from '@angular/core';
import { signalStore, withMethods, withHooks, patchState } from '@ngrx/signals';
import { withEntities, setAllEntities } from '@ngrx/signals/entities';
import { Product } from '../../shared/models/product.model';
import { ProductService } from '../services/product.service';
import {
  withCallState,
  setLoading,
  setLoaded,
  setError,
} from '../../shared/state/call-state.feature';

export const ProductApiStore = signalStore(
  { providedIn: 'root' },
  withEntities<Product>(),
  withCallState(),
  withMethods((store) => {
    const productService = inject(ProductService);
    return {
      async loadProducts(): Promise<void> {
        patchState(store, setLoading());
        try {
          const products = await productService.getAll();
          patchState(store, setAllEntities(products), setLoaded());
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : 'Failed to load products';
          patchState(store, setError(message));
        }
      },
    };
  }),
  withHooks({
    onInit(store) {
      store.loadProducts();
    },
  })
);
```

When `loadProducts` is called, the state transitions from `'init'` to `'loading'`. On success, it transitions to `'loaded'` and the entities are populated. On failure, it transitions to `{ error: 'message' }`. At no point can the store be in both `'loading'` and `{ error }` states simultaneously.

### Consuming Status in a Template

```typescript
// src/app/products/components/product-page.component.ts
import { Component, inject } from '@angular/core';
import { ProductApiStore } from '../store/product-api.store';
import { ProductCardComponent } from './product-card.component';

@Component({
  selector: 'app-product-page',
  imports: [ProductCardComponent],
  template: `
    @if (store.loading()) {
      <div class="loading-indicator" role="status">
        <span>Loading products...</span>
      </div>
    }
    @if (store.error(); as errorMessage) {
      <div class="error-banner" role="alert">
        <p>{{ errorMessage }}</p>
        <button (click)="store.loadProducts()">Retry</button>
      </div>
    }
    @if (store.loaded()) {
      @for (product of store.entities(); track product.id) {
        <app-product-card [product]="product" />
      } @empty {
        <p>No products found.</p>
      }
    }
  `,
})
export class ProductPageComponent {
  readonly store = inject(ProductApiStore);
}
```

Because `loading`, `loaded`, and `error` are mutually exclusive derived signals, the template never shows contradictory UI.

### Classic Store: Status Pattern with Enum State

The same principle works in Classic Store. Replace boolean flags with a status property:

```typescript
// src/app/products/state/product.reducer.ts
import { createEntityAdapter, EntityState } from '@ngrx/entity';
import { createReducer, on } from '@ngrx/store';
import { Product } from '../../shared/models/product.model';
import { ProductApiActions } from './product.actions';

export type LoadStatus = 'init' | 'loading' | 'loaded' | 'error';

export interface ProductState extends EntityState<Product> {
  status: LoadStatus;
  error: string | null;
}

const adapter = createEntityAdapter<Product>();

const initialState: ProductState = adapter.getInitialState({
  status: 'init' as LoadStatus,
  error: null,
});

export const productReducer = createReducer(
  initialState,
  on(ProductApiActions.loadProducts, (state) => ({
    ...state,
    status: 'loading' as LoadStatus,
    error: null,
  })),
  on(ProductApiActions.loadProductsSuccess, (state, { products }) =>
    adapter.setAll(products, { ...state, status: 'loaded' as LoadStatus })
  ),
  on(ProductApiActions.loadProductsFailure, (state, { error }) => ({
    ...state,
    status: 'error' as LoadStatus,
    error,
  }))
);
```

```typescript
// src/app/products/state/product.selectors.ts
import { createFeatureSelector, createSelector } from '@ngrx/store';
import { ProductState } from './product.reducer';

const selectProductState = createFeatureSelector<ProductState>('products');

export const selectProductStatus = createSelector(
  selectProductState,
  (state) => state.status
);
export const selectProductError = createSelector(
  selectProductState,
  (state) => state.error
);
export const selectProductLoading = createSelector(
  selectProductStatus,
  (status) => status === 'loading'
);
export const selectProductLoaded = createSelector(
  selectProductStatus,
  (status) => status === 'loaded'
);
```

The Classic Store version uses a string union `LoadStatus` for the status and a separate `error` property. The transition from `'loading'` to `'error'` always sets the error message. The transition to `'loading'` always clears it. These invariants are enforced in the reducer, which is the single place where state transitions happen.

## Principle 4: Error State Patterns

### Errors as State, Not Exceptions

In a well-designed store, errors are values. They live in state, not in `catch` blocks that log to the console and swallow the problem. The CallState pattern from Principle 3 already handles the most common case: an error from an API call that replaces the loading state.

But real applications have multiple async operations happening concurrently. A page might load products, load categories, and load user preferences in parallel. Each operation has its own lifecycle and its own potential failure mode.

### Named CallState for Multiple Operations

When a single store manages multiple async operations, give each operation its own CallState property:

```typescript
// src/app/dashboard/store/dashboard.store.ts
import { computed, inject } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';
import { withEntities, setAllEntities } from '@ngrx/signals/entities';
import { Product } from '../../shared/models/product.model';
import { Order } from '../../shared/models/order.model';
import { ProductService } from '../../products/services/product.service';
import { OrderService } from '../../orders/services/order.service';

type CallState = 'init' | 'loading' | 'loaded' | { error: string };

export const DashboardStore = signalStore(
  { providedIn: 'root' },
  withEntities<Product>({ collection: 'product' }),
  withEntities<Order>({ collection: 'order' }),
  withState({
    productsCallState: 'init' as CallState,
    ordersCallState: 'init' as CallState,
  }),
  withComputed((store) => ({
    productsLoading: computed(() => store.productsCallState() === 'loading'),
    productsError: computed(() => {
      const s = store.productsCallState();
      return typeof s === 'object' ? s.error : null;
    }),
    ordersLoading: computed(() => store.ordersCallState() === 'loading'),
    ordersError: computed(() => {
      const s = store.ordersCallState();
      return typeof s === 'object' ? s.error : null;
    }),
    anyLoading: computed(
      () =>
        store.productsCallState() === 'loading' ||
        store.ordersCallState() === 'loading'
    ),
  })),
  withMethods((store) => {
    const productService = inject(ProductService);
    const orderService = inject(OrderService);
    return {
      async loadProducts(): Promise<void> {
        patchState(store, { productsCallState: 'loading' });
        try {
          const products = await productService.getAll();
          patchState(store, setAllEntities(products, { collection: 'product' }), {
            productsCallState: 'loaded',
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : 'Failed to load products';
          patchState(store, { productsCallState: { error: msg } });
        }
      },
      async loadOrders(): Promise<void> {
        patchState(store, { ordersCallState: 'loading' });
        try {
          const orders = await orderService.getRecent();
          patchState(store, setAllEntities(orders, { collection: 'order' }), {
            ordersCallState: 'loaded',
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : 'Failed to load orders';
          patchState(store, { ordersCallState: { error: msg } });
        }
      },
    };
  })
);
```

Products and orders each have independent status tracking. A failure in `loadOrders` does not affect the `productsCallState`, so the product grid continues to display normally while the orders section shows an error. The `anyLoading` computed signal provides a single flag for a global progress indicator.

### Resetting Stale Errors

A common bug: the user triggers a load, it fails, they navigate away, then return. The store still holds the old error from the previous visit because nothing reset it. The fix is to clear status on initialization:

```typescript
// src/app/dashboard/store/dashboard.store.ts (add withHooks)
import { withHooks } from '@ngrx/signals';

// Add to the signalStore chain:
withHooks({
  onInit(store) {
    patchState(store, {
      productsCallState: 'init',
      ordersCallState: 'init',
    });
    store.loadProducts();
    store.loadOrders();
  },
})
```

Every time the store initializes (for component-scoped stores, this means every time the component mounts), it resets to `'init'` and starts fresh. For `providedIn: 'root'` stores, you reset at the point where the feature page loads, typically in the component that owns the feature.

### The Loading-to-Error Transition

The most common error state bug is forgetting to transition out of `'loading'` when an error occurs. This produces an infinite spinner. The CallState pattern helps because every path through the code must end in either `'loaded'` or `{ error }`. But the pattern does not enforce this. You must ensure that every `try/catch` block handles both branches:

```typescript
// ALWAYS transition out of 'loading'
async loadProducts(): Promise<void> {
  patchState(store, { productsCallState: 'loading' });
  try {
    const products = await productService.getAll();
    patchState(store, setAllEntities(products, { collection: 'product' }), {
      productsCallState: 'loaded',  // success path
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    patchState(store, {
      productsCallState: { error: msg },  // error path
    });
  }
  // No code path leaves callState stuck at 'loading'
}
```

If your method has early returns or conditional branches, trace every path to confirm it ends with a status transition.

## Common Mistakes

### Mistake 1: Storing Derived State Alongside Source State

```typescript
// WRONG: filteredProducts and productCount are derived
withState({
  products: [] as Product[],
  selectedCategory: null as string | null,
  filteredProducts: [] as Product[],   // derived!
  productCount: 0,                      // derived!
})
```

When `selectedCategory` changes, you must manually update `filteredProducts` and `productCount` in every method that modifies them. Miss one path and the UI shows stale data.

```typescript
// CORRECT: store source state, derive the rest
withState({
  selectedCategory: null as string | null,
}),
withEntities<Product>(),
withComputed((store) => ({
  filteredProducts: computed(() => {
    const cat = store.selectedCategory();
    return cat ? store.entities().filter((p) => p.category === cat) : store.entities();
  }),
})),
withComputed((store) => ({
  productCount: computed(() => store.filteredProducts().length),
}))
```

### Mistake 2: Using effect() to Synchronize Derived Values

```typescript
// WRONG: effect() for derived state
export class ProductFilterComponent {
  readonly products = signal<Product[]>([]);
  readonly category = signal<string | null>(null);
  readonly filtered = signal<Product[]>([]);

  syncEffect = effect(() => {
    const cat = this.category();
    const all = this.products();
    this.filtered.set(cat ? all.filter((p) => p.category === cat) : all);
  });
}
```

`effect()` runs asynchronously after the current microtask. This means there is a window where `filtered` holds stale data while `category` has already changed. Templates that read both signals during this window see inconsistent state.

```typescript
// CORRECT: computed() for derived state
export class ProductFilterComponent {
  readonly products = signal<Product[]>([]);
  readonly category = signal<string | null>(null);
  readonly filtered = computed(() => {
    const cat = this.category();
    const all = this.products();
    return cat ? all.filter((p) => p.category === cat) : all;
  });
}
```

`computed()` is synchronous, memoized, and glitch-free. The template always sees a consistent snapshot.

### Mistake 3: Duplicating Entities Instead of Referencing by ID

```typescript
// WRONG: selected product duplicated from the collection
withState({
  products: [] as Product[],
  selectedProduct: null as Product | null,  // duplicated!
})
```

If a product's price updates in the collection, the `selectedProduct` still shows the old price.

```typescript
// CORRECT: reference by ID, derive the full object
withEntities<Product>(),
withState({ selectedProductId: null as string | null }),
withComputed((store) => ({
  selectedProduct: computed(() => {
    const id = store.selectedProductId();
    return id ? store.entityMap()[id] ?? null : null;
  }),
}))
```

### Mistake 4: Independent Boolean Flags for Async Status

```typescript
// WRONG: three booleans allow impossible states
withState({
  isLoading: false,
  isLoaded: false,
  hasError: false,
  errorMessage: null as string | null,
})
```

Nothing prevents `isLoading: true` and `hasError: true` from coexisting.

```typescript
// CORRECT: single CallState discriminated union
withState({ callState: 'init' as CallState }),
withComputed(({ callState }) => ({
  loading: computed(() => callState() === 'loading'),
  loaded: computed(() => callState() === 'loaded'),
  error: computed(() => {
    const s = callState();
    return typeof s === 'object' ? s.error : null;
  }),
}))
```

The discriminated union makes `loading` and `error` physically mutually exclusive.

### Mistake 5: Forgetting to Transition Out of Loading on Error

```typescript
// WRONG: error path does not reset callState
async loadProducts(): Promise<void> {
  patchState(store, setLoading());
  try {
    const products = await productService.getAll();
    patchState(store, setAllEntities(products), setLoaded());
  } catch (e: unknown) {
    console.error('Failed to load products', e);
    // callState is still 'loading' - infinite spinner!
  }
}
```

```typescript
// CORRECT: always transition to a terminal state
async loadProducts(): Promise<void> {
  patchState(store, setLoading());
  try {
    const products = await productService.getAll();
    patchState(store, setAllEntities(products), setLoaded());
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    patchState(store, setError(msg));
  }
}
```

## Key Takeaways

- **Normalize entity collections.** Store each entity type in a flat `{ ids, entities }` dictionary. Reference related entities by ID, not by nesting. Use `@ngrx/entity` (Classic Store) or `withEntities` (SignalStore) to manage the normalized shape. Normalize when data enters the store; denormalize in selectors or computed signals.

- **Store only what you cannot compute.** If a value is determined by other state, it belongs in `computed()` or `createSelector()`, not in the store. This eliminates an entire class of synchronization bugs and keeps the state surface area minimal.

- **Replace boolean flags with a discriminated union.** A single `CallState` property (`'init' | 'loading' | 'loaded' | { error: string }`) makes impossible states unrepresentable. Build a reusable `withCallState()` feature so every store in your application follows the same pattern.

- **Every async operation must reach a terminal state.** Trace every code path through your loading methods and confirm that each one transitions `callState` to either `'loaded'` or `{ error }`. A missing transition produces an infinite spinner that is invisible in unit tests until a network call fails.

- **Use `computed()` for derived state, never `effect()`.** `computed()` is synchronous, memoized, and glitch-free. `effect()` is asynchronous and produces timing windows where derived values are stale. Reserve `effect()` for true side effects: DOM manipulation, logging, and external system synchronization.
