# Research: Entity Management with @ngrx/entity

**Date:** 2026-03-30
**Chapter:** Ch 11
**Status:** Ready for chapter generation

## API Surface

### Package: `@ngrx/entity`

All imports from `@ngrx/entity`.

#### `createEntityAdapter<T>(options?)`

```typescript
import { createEntityAdapter } from '@ngrx/entity';

function createEntityAdapter<T>(options?: {
  selectId?: (entity: T) => string | number;  // defaults to (e) => e.id
  sortComparer?: false | ((a: T, b: T) => number);  // false = unsorted (better perf)
}): EntityAdapter<T>;
```

- **Stability:** Stable (since v4, unchanged through v21)

#### `EntityState<T>`

```typescript
import { EntityState } from '@ngrx/entity';

interface EntityState<T> {
  ids: string[] | number[];
  entities: Dictionary<T>;
}
```

- **Stability:** Stable

#### `Dictionary<T>`

```typescript
interface DictionaryNum<T> { [id: number]: T | undefined; }
abstract class Dictionary<T> implements DictionaryNum<T> { [id: string]: T | undefined; }
```

- **Stability:** Stable

#### `Update<T>`

```typescript
import { Update } from '@ngrx/entity';

interface UpdateStr<T> { id: string; changes: Partial<T>; }
interface UpdateNum<T> { id: number; changes: Partial<T>; }
type Update<T> = UpdateStr<T> | UpdateNum<T>;
```

- **Stability:** Stable

#### `EntityMap<T>` and `EntityMapOne<T>`

```typescript
type EntityMap<T> = (entity: T) => T;
type EntityMapOne<T> = { id: string | number; map: EntityMap<T> };
```

- **Stability:** Stable

#### `Predicate<T>`

```typescript
type Predicate<T> = (entity: T) => boolean;
```

- **Stability:** Stable

#### `EntityAdapter<T>` (extends `EntityStateAdapter<T>`)

```typescript
interface EntityAdapter<T> extends EntityStateAdapter<T> {
  selectId: IdSelector<T>;
  sortComparer: false | Comparer<T>;

  getInitialState(): EntityState<T>;
  getInitialState<S extends EntityState<T>>(state: Omit<S, keyof EntityState<T>>): S;

  getSelectors(): EntitySelectors<T, EntityState<T>>;
  getSelectors<V>(selectState: (state: V) => EntityState<T>): MemoizedEntitySelectors<T, V>;
}
```

- **Stability:** Stable

#### `EntityStateAdapter<T>` -- All CRUD Methods (14 total)

```typescript
interface EntityStateAdapter<T> {
  addOne<S extends EntityState<T>>(entity: T, state: S): S;
  addMany<S extends EntityState<T>>(entities: T[], state: S): S;
  setAll<S extends EntityState<T>>(entities: T[], state: S): S;
  setOne<S extends EntityState<T>>(entity: T, state: S): S;
  setMany<S extends EntityState<T>>(entities: T[], state: S): S;
  removeOne<S extends EntityState<T>>(key: string | number, state: S): S;
  removeMany<S extends EntityState<T>>(keys: string[] | number[], state: S): S;
  removeMany<S extends EntityState<T>>(predicate: Predicate<T>, state: S): S;
  removeAll<S extends EntityState<T>>(state: S): S;
  updateOne<S extends EntityState<T>>(update: Update<T>, state: S): S;
  updateMany<S extends EntityState<T>>(updates: Update<T>[], state: S): S;
  upsertOne<S extends EntityState<T>>(entity: T, state: S): S;
  upsertMany<S extends EntityState<T>>(entities: T[], state: S): S;
  mapOne<S extends EntityState<T>>(map: EntityMapOne<T>, state: S): S;
  map<S extends EntityState<T>>(map: EntityMap<T>, state: S): S;
}
```

- **Stability:** Stable

#### Generated Selectors

```typescript
// From adapter.getSelectors()
type EntitySelectors<T, V> = {
  selectIds: (state: V) => string[] | number[];
  selectEntities: (state: V) => Dictionary<T>;
  selectAll: (state: V) => T[];
  selectTotal: (state: V) => number;
};

// From adapter.getSelectors(featureSelector)
type MemoizedEntitySelectors<T, V> = {
  selectIds: MemoizedSelector<V, string[] | number[]>;
  selectEntities: MemoizedSelector<V, Dictionary<T>>;
  selectAll: MemoizedSelector<V, T[]>;
  selectTotal: MemoizedSelector<V, number>;
};
```

- **Stability:** Stable
- **v21.1.0 change:** `EntitySelectors` and `MemoizedEntitySelectors` types are now exported from the public API (previously internal-only)

## Key Concepts

### Normalized State Shape
- Entity state stores data as a dictionary (`{ [id]: entity }`) plus an ordered `ids` array
- Provides O(1) lookups by ID while preserving insertion/sort order
- The `selectAll` selector reconstructs the ordered array on demand by mapping over `ids`

### The Entity Adapter Pattern
- `createEntityAdapter` generates a reusable adapter with pre-built CRUD operations and selectors
- Eliminates hand-written reducer logic for collections, preventing common bugs (mutation, incorrect ID handling, sort corruption)
- Adapter methods return new state references (immutable updates)

### Sorted vs. Unsorted Collections
- `sortComparer: (a, b) => number` maintains automatic sort order on every mutation
- `sortComparer: false` (or omitted) yields better CRUD performance -- no re-sorting on add/upsert
- For large collections with frequent writes, sort in selectors instead of the adapter

### Extending EntityState with Custom Properties
- `getInitialState({ loading: false, error: null, selectedId: null })` adds extra state properties
- The extended interface should extend `EntityState<T>` with the additional fields

### Selector Composition
- `adapter.getSelectors()` (no args) returns root-level selectors
- `adapter.getSelectors(selectFeatureState)` returns memoized selectors scoped to a feature slice
- Entity selectors compose with custom selectors via `createSelector`

### CRUD Operation Semantics (Critical Distinction)

| Operation | Entity exists? | Entity missing? |
|---|---|---|
| `addOne` | No-op (silently skipped) | Adds entity |
| `setOne` | Full replacement (lossy) | Adds entity |
| `upsertOne` | Shallow merge (preserves unmentioned properties) | Adds entity |
| `updateOne` | Partial update | No-op |

### Integration with `createFeature`
- Use `extraSelectors` in `createFeature` to spread entity adapter selectors
- `extraSelectors` receives auto-generated feature selectors as its argument

### Normalization Over Nesting
- Each entity type should have its own adapter and state slice
- Related entities linked by IDs, not nested objects
- Avoids exponentially complex reducer logic for parent-child relationships

## Code Patterns

### Basic Adapter Setup

```typescript
// products/state/product.reducer.ts
import { createEntityAdapter, EntityState } from '@ngrx/entity';
import { createReducer, on } from '@ngrx/store';
import { Product } from '../models/product.model';
import { ProductActions } from './product.actions';

export interface ProductState extends EntityState<Product> {
  selectedProductId: string | null;
  loading: boolean;
  error: string | null;
}

export const productAdapter = createEntityAdapter<Product>({
  selectId: (product) => product.sku,
  sortComparer: (a, b) => a.name.localeCompare(b.name),
});

const initialState: ProductState = productAdapter.getInitialState({
  selectedProductId: null,
  loading: false,
  error: null,
});
```

### Reducer with Adapter Methods

```typescript
// products/state/product.reducer.ts
export const productReducer = createReducer(
  initialState,
  on(ProductActions.loadProductsSuccess, (state, { products }) =>
    productAdapter.setAll(products, { ...state, loading: false })
  ),
  on(ProductActions.addProduct, (state, { product }) =>
    productAdapter.addOne(product, state)
  ),
  on(ProductActions.updateProduct, (state, { update }) =>
    productAdapter.updateOne(update, state)
  ),
  on(ProductActions.deleteProduct, (state, { id }) =>
    productAdapter.removeOne(id, state)
  ),
  on(ProductActions.upsertProduct, (state, { product }) =>
    productAdapter.upsertOne(product, state)
  )
);
```

### Integration with createFeature and extraSelectors

```typescript
// products/state/product.feature.ts
import { createFeature, createSelector } from '@ngrx/store';

export const productsFeature = createFeature({
  name: 'products',
  reducer: productReducer,
  extraSelectors: ({ selectProductsState, selectSelectedProductId }) => {
    const entitySelectors = productAdapter.getSelectors(selectProductsState);
    return {
      ...entitySelectors,
      selectSelectedProduct: createSelector(
        entitySelectors.selectEntities,
        selectSelectedProductId,
        (entities, selectedId) => selectedId ? entities[selectedId] ?? null : null
      ),
    };
  },
});
```

### Composing Custom Selectors from Entity Selectors

```typescript
// products/state/product.selectors.ts
import { createSelector } from '@ngrx/store';
import { productsFeature } from './product.feature';

export const selectExpensiveProducts = createSelector(
  productsFeature.selectAll,
  (products) => products.filter(p => p.price > 100)
);

export const selectProductCount = productsFeature.selectTotal;

export const selectProductsByCategory = (category: string) =>
  createSelector(
    productsFeature.selectAll,
    (products) => products.filter(p => p.category === category)
  );
```

### Using map and mapOne for Transformations

```typescript
// Toggle a boolean on one entity
on(ProductActions.toggleFeatured, (state, { id }) =>
  productAdapter.mapOne(
    { id, map: (product) => ({ ...product, featured: !product.featured }) },
    state
  )
),

// Apply discount to all entities
on(ProductActions.applyDiscount, (state, { percentage }) =>
  productAdapter.map(
    (product) => ({ ...product, price: product.price * (1 - percentage / 100) }),
    state
  )
),
```

### removeMany with Predicate

```typescript
on(ProductActions.removeOutOfStock, (state) =>
  productAdapter.removeMany(
    (product) => product.stock === 0,
    state
  )
),
```

### Multiple Entity Adapters for Related Entities

```typescript
// orders/state/order.reducer.ts
import { createEntityAdapter, EntityState } from '@ngrx/entity';

interface Order {
  id: string;
  customerId: string;
  lineItemIds: string[];
  total: number;
}

interface LineItem {
  id: string;
  orderId: string;
  productId: string;
  quantity: number;
}

interface OrderState {
  orders: EntityState<Order>;
  lineItems: EntityState<LineItem>;
}

const orderAdapter = createEntityAdapter<Order>();
const lineItemAdapter = createEntityAdapter<LineItem>();

const initialState: OrderState = {
  orders: orderAdapter.getInitialState(),
  lineItems: lineItemAdapter.getInitialState(),
};

export const orderReducer = createReducer(
  initialState,
  on(OrderActions.loadOrderSuccess, (state, { order, lineItems }) => ({
    orders: orderAdapter.upsertOne(order, state.orders),
    lineItems: lineItemAdapter.upsertMany(lineItems, state.lineItems),
  })),
  on(OrderActions.removeOrder, (state, { orderId }) => {
    const order = state.orders.entities[orderId];
    return {
      orders: orderAdapter.removeOne(orderId, state.orders),
      lineItems: order
        ? lineItemAdapter.removeMany(order.lineItemIds, state.lineItems)
        : state.lineItems,
    };
  })
);
```

## Breaking Changes and Gotchas

### Renamed/Removed APIs
- **`addAll` removed, use `setAll`**: `addAll` was deprecated in v10 and removed in later versions. `setAll` is the replacement that replaces the entire collection.
- **`setOne` added in v10**: Complements `setAll` for single entity full replacement.
- **`setMany` added in v12**: Batch version of `setOne`.
- **`mapOne` added in v10**: Allows transforming a single entity by ID.

### v21-Specific Changes
- **`EntitySelectors` and `MemoizedEntitySelectors` types now exported** (v21.1.0): Previously internal types, now available for typing selector references in consuming code.
- **No breaking changes** to the core `@ngrx/entity` adapter API in v21.

### Common Gotchas

1. **`addOne` silently no-ops if ID exists**: No error thrown, no update applied. If you need to update-or-insert, use `upsertOne`. If you need to fully replace, use `setOne`.

2. **`setOne` is lossy**: It replaces the entire entity object. Properties present in the old entity but absent in the new one are lost. Use `upsertOne` for merge behavior.

3. **`sortComparer` performance cost**: With a sort comparer, every add/upsert/update triggers a re-sort of the `ids` array. For large collections (1000+ entities) with frequent writes, prefer unsorted adapter + sorted selectors.

4. **`removeMany` overloads**: Accepts either `string[] | number[]` (IDs) or `Predicate<T>` (filter function). TypeScript resolves the overload, but passing the wrong type can cause silent failures.

5. **Mutating entities in reducers**: Directly mutating entity properties (e.g., `state.entities[id].name = 'new'`) breaks immutability and causes change detection failures, especially in zoneless Angular. Always use adapter methods.

6. **Storing derived state alongside entities**: Storing filtered/sorted/aggregated data in entity state creates synchronization bugs. Use selectors to derive these values.

7. **Using `addMany` after API fetch instead of `setAll`**: `addMany` only adds new entities; it does not remove entities that no longer exist on the server. Use `setAll` after full API fetches to replace the collection.

8. **Nested entity state complexity**: Embedding child `EntityState` inside parent entities is possible but exponentially increases reducer complexity. Prefer flat normalization with separate adapters linked by IDs.

9. **Forgetting to spread extra state**: When combining adapter operations with extra state properties, remember to spread or include the extra properties:
   ```typescript
   // Correct
   productAdapter.setAll(products, { ...state, loading: false })
   // Incorrect -- loses loading, error, selectedId
   productAdapter.setAll(products, state) // Only ok if no extra state needs changing
   ```

## Sources

### Official Documentation
- https://ngrx.io/guide/entity
- https://ngrx.io/guide/entity/adapter
- https://ngrx.io/guide/entity/recipes/entity-adapter-with-feature-creator
- https://ngrx.io/guide/signals/signal-store/entity-management

### Blog Posts and Articles
- https://blog.angular-university.io/ngrx-entity/ -- NgRx Entity Complete Practical Guide
- https://timdeschryver.dev/blog/normalizing-state -- Tim Deschryver on normalizing state
- https://timdeschryver.dev/blog/nested-ngrx-entity-state -- Tim Deschryver on nested entity state
- https://www.angulararchitects.io/blog/smarter-not-harder-simplifying-your-application-with-ngrx-signal-store-and-custom-features/ -- Angular Architects: SignalStore custom features with entities
- https://www.angulararchitects.io/en/blog/the-new-ngrx-signal-store-for-angular-2-1-flavors/ -- Angular Architects: SignalStore flavors
- https://angular.schule/blog/2020-01-ngrx-data-views/ -- De-normalizing entities in views
- https://medium.com/ngrx/introducing-ngrx-entity-598176456e15 -- Mike Ryan's original @ngrx/entity announcement
- https://www.thinktecture.com/en/angular/ngrx-entity-managing-your-collections-with-the-entityadapter/ -- Thinktecture on EntityAdapter
- https://ultimatecourses.com/blog/entity-pattern-in-angular-state-management -- Entity pattern overview
- https://christianlydemann.com/top-5-ngrx-mistakes/ -- Common NgRx mistakes (includes entity pitfalls)
- https://blog.briebug.com/blog/3-ways-youre-using-ngrx-wrong -- BrieBug on NgRx anti-patterns
- https://angular.love/ngrx-bad-practices/ -- NgRx bad practices
- https://dev.to/ngrx/announcing-ngrx-21-celebrating-a-10-year-journey-with-a-fresh-new-look-and-ngrxsignalsevents-5ekp -- NgRx 21 announcement
- https://dev.to/ngrx/announcing-ngrx-v20-the-power-of-events-enhanced-dx-and-a-mature-signalstore-2fdm -- NgRx 20 announcement
- https://dev.to/ngrx/announcing-ngrx-signals-v18-state-encapsulation-private-store-members-enhanced-entity-management-and-more-2lo6 -- NgRx Signals v18

### GitHub Issues and RFCs
- https://github.com/ngrx/platform/pull/2348 -- addAll deprecated for setAll
- https://github.com/ngrx/platform/issues/2369 -- setOne method request
- https://github.com/ngrx/platform/issues/2538 -- mapOne method request
- https://github.com/ngrx/platform/issues/3026 -- setMany request
- https://github.com/ngrx/platform/issues/3719 -- RFC: extraSelectors in createFeature
- https://github.com/ngrx/platform/issues/898 -- Ability to change sortComparer
- https://github.com/ngrx/platform/issues/4235 -- updateEntity entityMap bug in SignalStore (fixed v18)
- https://github.com/ngrx/platform/blob/main/CHANGELOG.md -- Full changelog

### NPM Package
- https://www.npmjs.com/package/@ngrx/entity

## Relationship to Other Chapters

- **Ch 16 (Entity Management in SignalStore with `withEntities`)**: Covers the SignalStore equivalent. This chapter should focus exclusively on `@ngrx/entity` with Classic Store, but may briefly foreshadow the SignalStore approach.
- **Ch 8 (Actions, Reducers, and the Store)**: Prerequisites -- assumes reader understands `createReducer`, `on()`, and `createFeature`.
- **Ch 9 (Selectors and Memoization)**: Prerequisites -- assumes reader understands `createSelector` and memoization.
- **Ch 23 (State Design Principles)**: Normalization concepts introduced here are expanded in Ch 23.

## Open Questions

1. **Verify `EntitySelectors`/`MemoizedEntitySelectors` export in v21.1.0**: Confirm these types are indeed newly exported by checking the installed package's public API (index.d.ts).
2. **Confirm `addAll` removal status**: Verify whether `addAll` still exists as a deprecated alias or has been fully removed from v21.
3. **Check if `@ngrx/entity` has any v21.1.0 schematics**: Verify whether migration schematics exist for entity-related changes (likely none since the API is stable).
