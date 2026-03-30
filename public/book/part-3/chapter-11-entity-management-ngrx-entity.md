# Chapter 11: Entity Management with @ngrx/entity

Our product catalog reducer is growing. Every time we add a new operation, the reducer handler manually spreads arrays, filters by ID, and maps over the collection to apply updates. The `on(ProductAdminApiActions.updateProductSuccess)` handler alone needs a `map()` call that checks every item for a matching ID, spreads the match with the new data, and returns the rest unchanged. Do that for create, update, delete, upsert, and bulk operations, and the reducer is fifty lines of repetitive array gymnastics. Worse, every handler is a potential mutation bug: forget the spread operator inside one `map()` callback and the store silently corrupts. `@ngrx/entity` replaces all of this with a single adapter object that provides fourteen pre-built, immutable CRUD operations and four auto-generated selectors. We will refactor the product catalog to use it and then extend the pattern to handle related entities with separate adapters linked by ID.

## A Quick Recap

In Chapters 8 through 10, we built a product catalog feature with `createActionGroup`, `createReducer`, `createFeature`, selectors composed via `createSelector`, and functional effects that handle API calls. Our `Product` model has `id`, `name`, `price`, `category`, and `description` properties. The reducer stores products as an array inside the state, and selectors derive filtered views from that array. Effects load products from the API and dispatch success or failure actions. This chapter replaces the manual array-based state with a normalized entity state powered by `@ngrx/entity`.

## The Problem with Array-Based State

Storing a collection as `Product[]` introduces three costs that grow with the size of the collection.

**Lookup cost.** Finding a product by ID requires `Array.find()`, which is O(n). If you display a product detail page and need to locate the selected product from the store, every navigation triggers a linear scan.

**Immutable update cost.** Updating one product means mapping the entire array to produce a new one, checking each item's ID along the way:

```typescript
// src/app/products/state/products.reducer.ts (before entity adapter)
on(ProductAdminApiActions.updateProductSuccess, (state, { product }) => ({
  ...state,
  products: state.products.map(p =>
    p.id === product.id ? { ...p, ...product } : p
  ),
})),
```

This is correct but fragile. One missing spread, one wrong comparison, and the state silently breaks.

**Duplication risk.** When multiple parts of the state reference the same product (a cart, a wishlist, a recently-viewed list), storing full objects in each array means updating a product's price requires finding and updating it in every array. If you miss one, the UI shows stale data.

Normalized state solves all three problems. Instead of an array, we store entities in a dictionary keyed by ID, plus an `ids` array that preserves order. Lookups become O(1). Updates touch exactly one dictionary entry. And every part of the state that references a product uses the ID, not a copy of the object.

## Normalized State: The Shape

`@ngrx/entity` defines a standard interface for normalized collections:

```typescript
// From @ngrx/entity
interface EntityState<T> {
  ids: string[] | number[];
  entities: Dictionary<T>;
}
```

`ids` is an ordered array of identifiers. `entities` is a dictionary (a plain JavaScript object) mapping each ID to its entity. Picture the state for three products:

```
{
  ids: ['p1', 'p2', 'p3'],
  entities: {
    'p1': { id: 'p1', name: 'Widget', price: 9.99, category: 'tools' },
    'p2': { id: 'p2', name: 'Gadget', price: 24.99, category: 'electronics' },
    'p3': { id: 'p3', name: 'Gizmo', price: 14.99, category: 'electronics' }
  }
}
```

To look up product `'p2'`, read `entities['p2']` in O(1). To display all products in order, map over `ids` and pull each entity from the dictionary. The `ids` array controls display order while the dictionary provides fast random access.

## The Entity Adapter

The `createEntityAdapter` function generates an adapter object with CRUD methods and selector factories tailored to a specific entity type.

```typescript
// src/app/products/state/products.reducer.ts
import { createEntityAdapter, EntityState } from '@ngrx/entity';
import { Product } from '../product.model';

export const productAdapter = createEntityAdapter<Product>();
```

By default, the adapter reads the `id` property from each entity. If your entity uses a different property as its identifier, pass a `selectId` function:

```typescript
// src/app/products/state/products.reducer.ts
export const productAdapter = createEntityAdapter<Product>({
  selectId: (product) => product.sku,
});
```

The adapter also supports automatic sorting. Pass a `sortComparer` function and the adapter will maintain the `ids` array in sorted order after every mutation:

```typescript
// src/app/products/state/products.reducer.ts
export const productAdapter = createEntityAdapter<Product>({
  sortComparer: (a, b) => a.name.localeCompare(b.name),
});
```

Omitting `sortComparer` (or passing `false`) keeps the collection unsorted, which is more performant for large collections with frequent writes. We will discuss the trade-off in detail later.

## Extending EntityState with Custom Properties

Most features need more than just the entity collection. You typically need loading flags, error messages, and a selected entity ID. Extend `EntityState` with an interface that adds these properties, then generate the initial state with `getInitialState`:

```typescript
// src/app/products/state/products.reducer.ts
import { createEntityAdapter, EntityState } from '@ngrx/entity';
import { Product } from '../product.model';

export interface ProductsState extends EntityState<Product> {
  selectedProductId: string | null;
  loading: boolean;
  error: string | null;
}

export const productAdapter = createEntityAdapter<Product>();

const initialState: ProductsState = productAdapter.getInitialState({
  selectedProductId: null,
  loading: false,
  error: null,
});
```

`getInitialState()` without arguments returns `{ ids: [], entities: {} }`. When you pass additional properties, it merges them into the initial state and returns the extended type. The generic constraint ensures TypeScript enforces that your extra properties match the extended interface.

## The Fourteen Adapter Methods

The adapter provides fourteen methods that cover every CRUD operation you need. Each method takes the relevant data and the current state, and returns a new state object. They never mutate.

### Adding Entities

```typescript
// src/app/products/state/products.reducer.ts
import { createReducer, on } from '@ngrx/store';
import { ProductAdminApiActions, ProductsApiActions } from './products.actions';

export const productsReducer = createReducer(
  initialState,

  // addOne: add a single entity. No-op if the ID already exists.
  on(ProductAdminApiActions.createProductSuccess, (state, { product }) =>
    productAdapter.addOne(product, state)
  ),

  // addMany: add multiple entities. Skips any whose IDs already exist.
  on(ProductsApiActions.productsLoadedSuccessfully, (state, { products }) =>
    productAdapter.addMany(products, { ...state, loading: false, error: null })
  ),
);
```

Notice the critical behavior: `addOne` silently skips the entity if its ID is already in the collection. It does not throw an error or update the existing entity. If you need update-or-insert semantics, use `upsertOne` instead.

### Replacing Entities

```typescript
// src/app/products/state/products.reducer.ts

// setOne: add or fully replace a single entity.
on(ProductAdminApiActions.updateProductSuccess, (state, { product }) =>
  productAdapter.setOne(product, state)
),

// setMany: add or fully replace multiple entities.
on(SomeAction, (state, { products }) =>
  productAdapter.setMany(products, state)
),

// setAll: replace the entire collection. All previous entities are removed.
on(ProductsApiActions.productsLoadedSuccessfully, (state, { products }) =>
  productAdapter.setAll(products, { ...state, loading: false, error: null })
),
```

`setAll` is the right choice after fetching a full list from the API. It clears any stale entities that the server no longer returns, then inserts the fresh set. Using `addMany` instead would leave deleted entities in the store.

### Updating Entities

```typescript
// src/app/products/state/products.reducer.ts
import { Update } from '@ngrx/entity';

// updateOne: partial update. No-op if the ID does not exist.
on(ProductAdminApiActions.updateProductSuccess, (state, { product }) =>
  productAdapter.updateOne(
    { id: product.id, changes: { price: product.price, name: product.name } },
    state
  )
),

// updateMany: batch partial updates.
on(BulkPriceUpdateSuccess, (state, { updates }) =>
  productAdapter.updateMany(
    updates.map(u => ({ id: u.id, changes: { price: u.newPrice } })),
    state
  )
),
```

The `Update<T>` type requires an `id` and a `changes` object with `Partial<T>`. Only the specified properties are changed; the rest of the entity is preserved.

### Upserting Entities

```typescript
// src/app/products/state/products.reducer.ts

// upsertOne: if the entity exists, shallow merge. If not, add it.
on(WebSocketProductUpdate, (state, { product }) =>
  productAdapter.upsertOne(product, state)
),

// upsertMany: batch upsert.
on(WebSocketBatchUpdate, (state, { products }) =>
  productAdapter.upsertMany(products, state)
),
```

Upsert is the best choice when you receive data from a source (like a WebSocket) and do not know whether the entity is already in the store. It merges properties into existing entities and adds new ones.

### Removing Entities

```typescript
// src/app/products/state/products.reducer.ts

// removeOne: remove by ID.
on(ProductAdminApiActions.deleteProductSuccess, (state, { productId }) =>
  productAdapter.removeOne(productId, state)
),

// removeMany with IDs: remove a list of entities by their IDs.
on(BulkDeleteSuccess, (state, { ids }) =>
  productAdapter.removeMany(ids, state)
),

// removeMany with predicate: remove entities matching a condition.
on(RemoveDiscontinued, (state) =>
  productAdapter.removeMany(
    (product) => product.discontinued === true,
    state
  )
),

// removeAll: clear the entire collection.
on(ProductsPageActions.clearAll, (state) =>
  productAdapter.removeAll(state)
),
```

The predicate overload of `removeMany` is powerful but easy to misuse. TypeScript resolves the correct overload, but be explicit about your intent. Passing an empty array `[]` is a valid no-op. Passing a function that always returns `true` is equivalent to `removeAll`.

### Mapping Entities

```typescript
// src/app/products/state/products.reducer.ts

// mapOne: transform a single entity by ID.
on(ToggleFeatured, (state, { productId }) =>
  productAdapter.mapOne(
    { id: productId, map: (product) => ({ ...product, featured: !product.featured }) },
    state
  )
),

// map: transform every entity in the collection.
on(ApplyGlobalDiscount, (state, { percentage }) =>
  productAdapter.map(
    (product) => ({
      ...product,
      price: Math.round(product.price * (1 - percentage / 100) * 100) / 100,
    }),
    state
  )
),
```

The `map` and `mapOne` methods are useful when the update depends on the current value of the entity. Instead of reading the entity, computing the new value, and passing it to `updateOne`, you provide a function that receives the entity and returns the updated version.

## Adapter Selectors

The adapter generates four selectors that extract data from the entity state shape. There are two ways to retrieve them.

**Without a feature selector** (returns plain functions):

```typescript
const { selectAll, selectEntities, selectIds, selectTotal } =
  productAdapter.getSelectors();
```

These work directly on `EntityState<Product>`. You compose them with a feature selector manually:

```typescript
// src/app/products/state/products.selectors.ts
import { createSelector } from '@ngrx/store';
import { productAdapter, ProductsState } from './products.reducer';

const selectProductsState = (state: { products: ProductsState }) => state.products;

const { selectAll, selectEntities, selectIds, selectTotal } =
  productAdapter.getSelectors();

export const selectAllProducts = createSelector(selectProductsState, selectAll);
export const selectProductEntities = createSelector(selectProductsState, selectEntities);
export const selectProductIds = createSelector(selectProductsState, selectIds);
export const selectProductTotal = createSelector(selectProductsState, selectTotal);
```

**With a feature selector** (returns memoized selectors directly):

```typescript
// src/app/products/state/products.selectors.ts
import { createSelector } from '@ngrx/store';
import { productAdapter, ProductsState } from './products.reducer';

const selectProductsState = (state: { products: ProductsState }) => state.products;

export const {
  selectAll: selectAllProducts,
  selectEntities: selectProductEntities,
  selectIds: selectProductIds,
  selectTotal: selectProductTotal,
} = productAdapter.getSelectors(selectProductsState);
```

This second form is more concise and is the preferred approach. The adapter wraps each selector in `createSelector` internally, so they are memoized out of the box.

## Integration with createFeature

The cleanest integration uses `createFeature` with `extraSelectors` to merge adapter selectors into the feature:

```typescript
// src/app/products/state/products.feature.ts
import { createFeature, createSelector } from '@ngrx/store';
import { productAdapter, productsReducer } from './products.reducer';

export const productsFeature = createFeature({
  name: 'products',
  reducer: productsReducer,
  extraSelectors: ({ selectProductsState, selectSelectedProductId }) => {
    const entitySelectors = productAdapter.getSelectors(selectProductsState);
    return {
      ...entitySelectors,
      selectSelectedProduct: createSelector(
        entitySelectors.selectEntities,
        selectSelectedProductId,
        (entities, selectedId) =>
          selectedId ? (entities[selectedId] ?? null) : null
      ),
      selectProductsByCategory: (category: string) =>
        createSelector(
          entitySelectors.selectAll,
          (products) => products.filter(p => p.category === category)
        ),
    };
  },
});
```

`extraSelectors` receives the auto-generated feature selectors (like `selectProductsState` and `selectSelectedProductId`) as its argument. We pass `selectProductsState` to `adapter.getSelectors()` to scope the entity selectors to the products feature slice. Then we spread them into the return object alongside any custom selectors. The result is a single `productsFeature` object that exports everything: `productsFeature.selectAll`, `productsFeature.selectEntities`, `productsFeature.selectSelectedProduct`, and so on.

## The Complete Refactored Feature

Let us put together the full product catalog using `@ngrx/entity`. We will reuse the actions and effects from Chapters 8 through 10 and update the reducer, feature, and component.

### The Model

```typescript
// src/app/products/product.model.ts
export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  description: string;
  featured: boolean;
}
```

### The Reducer

```typescript
// src/app/products/state/products.reducer.ts
import { createEntityAdapter, EntityState } from '@ngrx/entity';
import { createReducer, on } from '@ngrx/store';
import { Product } from '../product.model';
import {
  ProductsPageActions,
  ProductsApiActions,
  ProductAdminActions,
  ProductAdminApiActions,
} from './products.actions';

export interface ProductsState extends EntityState<Product> {
  selectedProductId: string | null;
  loading: boolean;
  error: string | null;
}

export const productAdapter = createEntityAdapter<Product>({
  sortComparer: (a, b) => a.name.localeCompare(b.name),
});

const initialState: ProductsState = productAdapter.getInitialState({
  selectedProductId: null,
  loading: false,
  error: null,
});

export const productsReducer = createReducer(
  initialState,

  on(ProductsPageActions.opened, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(ProductsPageActions.productSelected, (state, { productId }) => ({
    ...state,
    selectedProductId: productId,
  })),

  on(ProductsApiActions.productsLoadedSuccessfully, (state, { products }) =>
    productAdapter.setAll(products, {
      ...state,
      loading: false,
      error: null,
    })
  ),

  on(ProductsApiActions.productsLoadedFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(ProductAdminApiActions.createProductSuccess, (state, { product }) =>
    productAdapter.addOne(product, state)
  ),

  on(ProductAdminApiActions.updateProductSuccess, (state, { product }) =>
    productAdapter.upsertOne(product, state)
  ),

  on(ProductAdminApiActions.deleteProductSuccess, (state, { productId }) =>
    productAdapter.removeOne(productId, state)
  ),
);
```

Compare this to the array-based reducer from earlier chapters. Every collection operation is now a single adapter method call. No `map`, no `filter`, no spread inside a spread. The adapter handles immutability internally.

### The Feature with Selectors

```typescript
// src/app/products/state/products.feature.ts
import { createFeature, createSelector } from '@ngrx/store';
import { productAdapter, productsReducer } from './products.reducer';

export const productsFeature = createFeature({
  name: 'products',
  reducer: productsReducer,
  extraSelectors: ({
    selectProductsState,
    selectSelectedProductId,
    selectLoading,
    selectError,
  }) => {
    const { selectAll, selectEntities, selectTotal } =
      productAdapter.getSelectors(selectProductsState);
    return {
      selectAll,
      selectEntities,
      selectTotal,
      selectSelectedProduct: createSelector(
        selectEntities,
        selectSelectedProductId,
        (entities, selectedId) =>
          selectedId ? (entities[selectedId] ?? null) : null
      ),
      selectViewModel: createSelector(
        selectAll,
        selectLoading,
        selectError,
        (products, loading, error) => ({ products, loading, error })
      ),
    };
  },
});
```

### The Component

```typescript
// src/app/products/products-list.component.ts
import { Component, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { productsFeature } from './state/products.feature';
import { ProductsPageActions } from './state/products.actions';
import { ProductCardComponent } from './product-card.component';

@Component({
  selector: 'app-products-list',
  standalone: true,
  imports: [ProductCardComponent],
  template: `
    @if (vm().loading) {
      <div class="loading-spinner">Loading products...</div>
    } @else if (vm().error) {
      <div class="error-message">{{ vm().error }}</div>
    } @else {
      <h2>Products ({{ vm().products.length }})</h2>
      @for (product of vm().products; track product.id) {
        <app-product-card
          [product]="product"
          (selected)="onSelect(product.id)"
        />
      }
      @empty {
        <p>No products found.</p>
      }
    }
  `,
})
export class ProductsListComponent {
  private readonly store = inject(Store);

  protected readonly vm = this.store.selectSignal(productsFeature.selectViewModel);

  constructor() {
    this.store.dispatch(ProductsPageActions.opened());
  }

  onSelect(productId: string): void {
    this.store.dispatch(ProductsPageActions.productSelected({ productId }));
  }
}
```

The component has not changed structurally from the array-based version. It dispatches the same actions and reads the same selectors. The entire refactoring to `@ngrx/entity` happened in the reducer and feature files. The component is completely unaware that the underlying state shape changed from an array to a normalized dictionary.

## Sorted vs. Unsorted: When to Choose Each

When you pass a `sortComparer` to `createEntityAdapter`, every call to `addOne`, `addMany`, `upsertOne`, `upsertMany`, or `setOne` inserts the entity at the correct position in the `ids` array using binary search. This keeps `selectAll` permanently sorted without any extra work in selectors.

The cost is that every write operation pays for the sort. For a catalog of 50 products that changes rarely, this cost is negligible. For a real-time feed of 10,000 events arriving via WebSocket, the cumulative cost of sorting on every insert becomes measurable.

**Use a sorted adapter when:**
- The collection is small (hundreds of entities or fewer)
- Writes are infrequent relative to reads
- The sort order rarely changes

**Use an unsorted adapter when:**
- The collection is large (thousands of entities)
- Writes are frequent (real-time data, polling)
- You need different sort orders in different views

For unsorted adapters, apply sorting in a selector:

```typescript
// src/app/products/state/products.feature.ts
selectProductsSortedByPrice: createSelector(
  selectAll,
  (products) => [...products].sort((a, b) => a.price - b.price)
),
```

The selector is memoized, so the sort only runs when the entity collection actually changes.

## Multiple Adapters for Related Entities

Real applications manage relationships between entities. An order has line items. A line item references a product. Embedding line items inside the order object as a nested array makes reducer logic exponentially more complex. Instead, create separate adapters for each entity type and link them by ID.

```typescript
// src/app/orders/state/orders.reducer.ts
import { createEntityAdapter, EntityState } from '@ngrx/entity';
import { createReducer, on } from '@ngrx/store';

export interface Order {
  id: string;
  customerId: string;
  lineItemIds: string[];
  status: 'pending' | 'confirmed' | 'shipped';
  createdAt: string;
}

export interface LineItem {
  id: string;
  orderId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
}

export interface OrdersState {
  orders: EntityState<Order>;
  lineItems: EntityState<LineItem>;
  selectedOrderId: string | null;
}

const orderAdapter = createEntityAdapter<Order>({
  sortComparer: (a, b) => b.createdAt.localeCompare(a.createdAt),
});

const lineItemAdapter = createEntityAdapter<LineItem>();

const initialState: OrdersState = {
  orders: orderAdapter.getInitialState(),
  lineItems: lineItemAdapter.getInitialState(),
  selectedOrderId: null,
};

export const ordersReducer = createReducer(
  initialState,

  on(OrdersApiActions.orderLoadedSuccess, (state, { order, lineItems }) => ({
    ...state,
    orders: orderAdapter.upsertOne(order, state.orders),
    lineItems: lineItemAdapter.upsertMany(lineItems, state.lineItems),
  })),

  on(OrdersApiActions.deleteOrderSuccess, (state, { orderId }) => {
    const order = state.orders.entities[orderId];
    return {
      ...state,
      orders: orderAdapter.removeOne(orderId, state.orders),
      lineItems: order
        ? lineItemAdapter.removeMany(order.lineItemIds, state.lineItems)
        : state.lineItems,
      selectedOrderId:
        state.selectedOrderId === orderId ? null : state.selectedOrderId,
    };
  }),

  on(OrdersPageActions.orderSelected, (state, { orderId }) => ({
    ...state,
    selectedOrderId: orderId,
  })),
);
```

Then compose selectors that join the data back together for the view:

```typescript
// src/app/orders/state/orders.feature.ts
import { createFeature, createSelector } from '@ngrx/store';
import { ordersReducer, orderAdapter, lineItemAdapter } from './orders.reducer';

const selectOrdersSlice = (state: OrdersState) => state.orders;
const selectLineItemsSlice = (state: OrdersState) => state.lineItems;

export const ordersFeature = createFeature({
  name: 'orders',
  reducer: ordersReducer,
  extraSelectors: ({ selectOrdersState, selectSelectedOrderId }) => {
    const orderSelectors = orderAdapter.getSelectors(
      createSelector(selectOrdersState, (s) => s.orders)
    );
    const lineItemSelectors = lineItemAdapter.getSelectors(
      createSelector(selectOrdersState, (s) => s.lineItems)
    );
    return {
      ...orderSelectors,
      selectSelectedOrder: createSelector(
        orderSelectors.selectEntities,
        selectSelectedOrderId,
        (entities, id) => (id ? (entities[id] ?? null) : null)
      ),
      selectLineItemsForSelectedOrder: createSelector(
        selectSelectedOrderId,
        orderSelectors.selectEntities,
        lineItemSelectors.selectEntities,
        (selectedId, orders, lineItems) => {
          if (!selectedId) return [];
          const order = orders[selectedId];
          if (!order) return [];
          return order.lineItemIds
            .map(id => lineItems[id])
            .filter((item): item is LineItem => item != null);
        }
      ),
    };
  },
});
```

The key insight is that the reducers stay flat and simple. Each adapter manages its own slice independently. The complexity of joining related data lives entirely in selectors, which are memoized and only recompute when their inputs change.

## Common Mistakes

### Mistake 1: Using addMany After an API Fetch

```typescript
// WRONG: stale entities remain in the store
on(ProductsApiActions.productsLoadedSuccessfully, (state, { products }) =>
  productAdapter.addMany(products, { ...state, loading: false })
),
```

`addMany` only inserts entities whose IDs do not already exist. If the server removed a product since the last fetch, that product stays in the store. If the server updated a product's name, the old name stays because `addMany` skips existing IDs.

```typescript
// CORRECT: setAll replaces the entire collection with fresh data
on(ProductsApiActions.productsLoadedSuccessfully, (state, { products }) =>
  productAdapter.setAll(products, { ...state, loading: false })
),
```

`setAll` clears the collection first, then inserts every entity from the server response. The store now mirrors the server exactly.

### Mistake 2: Confusing setOne and upsertOne

```typescript
// WRONG: setOne replaces the entire entity, losing properties not in the payload
on(ProductAdminApiActions.priceUpdated, (state, { productId, newPrice }) =>
  productAdapter.setOne({ id: productId, price: newPrice } as Product, state)
),
```

`setOne` does a full replacement. The entity in the store becomes `{ id: 'p1', price: 19.99 }`, losing `name`, `category`, `description`, and every other property. The `as Product` cast hides the type error but does not prevent data loss.

```typescript
// CORRECT: updateOne applies a partial update, preserving unmentioned properties
on(ProductAdminApiActions.priceUpdated, (state, { productId, newPrice }) =>
  productAdapter.updateOne(
    { id: productId, changes: { price: newPrice } },
    state
  )
),
```

Use `updateOne` when you have partial data to merge into an existing entity. Use `setOne` only when you have the complete entity object and want to replace it entirely. Use `upsertOne` when you have a complete entity and want to merge it if it exists or add it if it does not.

### Mistake 3: Forgetting Extra State When Spreading

```typescript
// WRONG: the adapter returns a new EntityState but the loading flag is lost
on(ProductsApiActions.productsLoadedSuccessfully, (state, { products }) =>
  productAdapter.setAll(products, state)
),
```

This is technically correct if you do not need to change the `loading` flag. But in most cases, a successful load should set `loading: false`. The adapter only manages `ids` and `entities`. It passes through any extra properties from the state you provide, but it will not change them for you.

```typescript
// CORRECT: spread extra state changes alongside the adapter operation
on(ProductsApiActions.productsLoadedSuccessfully, (state, { products }) =>
  productAdapter.setAll(products, { ...state, loading: false, error: null })
),
```

The second argument to every adapter method is the current state. When you spread `{ ...state, loading: false }`, the adapter receives the updated loading flag and preserves it in the returned state.

### Mistake 4: Mutating Entities Directly

```typescript
// WRONG: direct mutation bypasses immutability
on(ToggleFeatured, (state, { productId }) => {
  const product = state.entities[productId];
  if (product) {
    product.featured = !product.featured;  // MUTATION!
  }
  return state;  // same reference, change detection does not fire
}),
```

This mutates the entity in place and returns the same state reference. Angular's signal-based change detection (and the Store's distinctUntilChanged check) will not detect the change because the state object reference has not changed. The UI will not update.

```typescript
// CORRECT: use mapOne for value-dependent updates
on(ToggleFeatured, (state, { productId }) =>
  productAdapter.mapOne(
    {
      id: productId,
      map: (product) => ({ ...product, featured: !product.featured }),
    },
    state
  )
),
```

`mapOne` creates a new entity object with the spread operator inside the mapping function, updates the dictionary entry, and returns a new state reference. Change detection fires correctly.

## Key Takeaways

- **Use `@ngrx/entity` for any collection larger than two or three items.** The adapter eliminates hand-written array operations, prevents mutation bugs, and provides O(1) lookups via normalized state.

- **Choose the right CRUD method.** `addOne` skips duplicates. `setOne` replaces entirely. `upsertOne` merges. `updateOne` patches. Misusing these causes silent data loss or stale entries.

- **Use `setAll` after full API fetches, not `addMany`.** `setAll` clears stale entities. `addMany` leaves them behind.

- **Prefer unsorted adapters with sorted selectors for large or frequently-updated collections.** Reserve `sortComparer` for small, rarely-changing collections where the convenience outweighs the per-write sort cost.

- **Normalize related entities into separate adapters linked by ID.** Keep reducers flat and join data in memoized selectors. This scales to complex domain models without exponential reducer complexity.
