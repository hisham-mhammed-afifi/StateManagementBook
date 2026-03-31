# Chapter 16: Entity Management in SignalStore

Look at the product comparison store we built in Chapter 15. Products live in a plain array inside `withState`. Every time we need to find a product by ID, we call `Array.find()`, scanning the entire list. Every time we update a single product's price, we `map()` the whole array, check each element's ID, spread the match, and return the rest unchanged. With 20 products in a comparison widget, this is fine. With 500 products in a catalog store, it is the same O(n) lookup cost, the same fragile spread-inside-map pattern, and the same mutation risk we eliminated in Chapter 11 when we moved the Classic Store to `@ngrx/entity`. SignalStore has its own answer: `withEntities` from `@ngrx/signals/entities`. It gives us the same normalized state shape (an ID-keyed dictionary plus an ordered `ids` array) with signal-based reactivity and zero boilerplate reducers.

## A Quick Recap

In Chapter 11, we learned that normalized state solves three problems with array-based collections: O(n) lookups, fragile immutable updates, and duplication risk. The `@ngrx/entity` adapter gave us fourteen CRUD methods and four auto-generated selectors, all operating on an `{ ids, entities }` shape. In Chapter 15, we built SignalStore fundamentals: `withState` for reactive state, `withComputed` for derived signals, `withMethods` for operations, and `patchState` for updates. Our product catalog used a `Product[]` array in the store's state. This chapter replaces that array with `withEntities`, the SignalStore equivalent of `@ngrx/entity`. The same `Product` model from earlier chapters carries forward: `id`, `name`, `price`, `category`, `description`, and `featured`.

## What withEntities Provides

The `withEntities` feature from `@ngrx/signals/entities` is a store feature that plugs into the `signalStore()` builder. It adds three things to the store:

1. **State**: an `entityMap` (a dictionary mapping IDs to entities) and an `ids` array (preserving insertion order)
2. **Computed**: an `entities` signal that derives the full entity array from `entityMap` and `ids`
3. **Updater functions**: standalone functions like `addEntity`, `updateEntity`, and `removeEntity` that you pass to `patchState`

The simplest usage takes a single type parameter:

```typescript
// src/app/products/state/product-catalog.store.ts
import { signalStore } from '@ngrx/signals';
import { withEntities } from '@ngrx/signals/entities';
import { Product } from '../product.model';

export const ProductCatalogStore = signalStore(
  { providedIn: 'root' },
  withEntities<Product>(),
);
```

This store now has three signals accessible from any component that injects it:

```typescript
const store = inject(ProductCatalogStore);

store.ids();         // Signal<Array<string | number>> - ordered IDs
store.entityMap();   // Signal<Record<string | number, Product>> - dictionary
store.entities();    // Signal<Product[]> - derived array in ids order
```

By default, `withEntities` expects each entity to have an `id` property. We will cover custom ID selection shortly.

## Entity Updater Functions

Unlike `@ngrx/entity`'s adapter methods (which are methods on an adapter object called inside reducers), SignalStore's entity operations are standalone functions imported from `@ngrx/signals/entities`. You pass them to `patchState` to modify the entity collection. This is a fundamental difference: there is no adapter object to create. You import the functions you need and compose them freely.

All imports come from `@ngrx/signals/entities`:

```typescript
import {
  addEntity,
  addEntities,
  prependEntity,
  prependEntities,
  setEntity,
  setEntities,
  setAllEntities,
  updateEntity,
  updateEntities,
  updateAllEntities,
  removeEntity,
  removeEntities,
  removeAllEntities,
  upsertEntity,
  upsertEntities,
} from '@ngrx/signals/entities';
```

That is fifteen updater functions. Let us walk through each group by building a product catalog store step by step.

### Adding Entities

```typescript
// src/app/products/state/product-catalog.store.ts
import { signalStore, withMethods, patchState } from '@ngrx/signals';
import { withEntities, addEntity, addEntities } from '@ngrx/signals/entities';
import { Product } from '../product.model';

export const ProductCatalogStore = signalStore(
  { providedIn: 'root' },
  withEntities<Product>(),
  withMethods((store) => ({
    addProduct(product: Product): void {
      patchState(store, addEntity(product));
    },
    addProducts(products: Product[]): void {
      patchState(store, addEntities(products));
    },
  })),
);
```

`addEntity` appends the entity to the end of the `ids` array and adds it to the `entityMap`. If an entity with the same ID already exists, the call is silently skipped. No error, no replacement. This is the same behavior as `@ngrx/entity`'s `addOne`.

### Prepending Entities

Sometimes the newest items should appear first. A notification feed, a chat message list, or a recently-added products section all need newest-first ordering. The `prependEntity` and `prependEntities` functions insert at the beginning of the `ids` array:

```typescript
// src/app/products/state/product-catalog.store.ts
import { prependEntity } from '@ngrx/signals/entities';

// Inside withMethods
addProductToTop(product: Product): void {
  patchState(store, prependEntity(product));
},
```

Like `addEntity`, `prependEntity` silently skips if the ID already exists.

### Setting Entities (Replace Semantics)

The `set` family replaces entities. `setEntity` adds or fully replaces a single entity. `setEntities` does the same for multiple entities. `setAllEntities` clears the entire collection first, then inserts the provided entities:

```typescript
// src/app/products/state/product-catalog.store.ts
import { setAllEntities, setEntity } from '@ngrx/signals/entities';

// Inside withMethods
loadProducts(products: Product[]): void {
  patchState(store, setAllEntities(products));
},
replaceProduct(product: Product): void {
  patchState(store, setEntity(product));
},
```

Use `setAllEntities` after fetching a full list from the API. It mirrors the server's response exactly, removing any stale entities that the server no longer returns. This is the SignalStore equivalent of `@ngrx/entity`'s `setAll`.

### Updating Entities

Update operations apply partial changes to existing entities. They come in three forms:

```typescript
// src/app/products/state/product-catalog.store.ts
import { updateEntity, updateEntities, updateAllEntities } from '@ngrx/signals/entities';

// Inside withMethods

// Update one entity by ID with a partial object
updatePrice(id: string, price: number): void {
  patchState(store, updateEntity({ id, changes: { price } }));
},

// Update one entity with a function that receives the current entity
toggleFeatured(id: string): void {
  patchState(store, updateEntity({
    id,
    changes: (product) => ({ featured: !product.featured }),
  }));
},

// Update multiple entities by ID array
applyDiscount(ids: string[], discountPercent: number): void {
  patchState(store, updateEntities({
    ids,
    changes: (product) => ({
      price: Math.round(product.price * (1 - discountPercent / 100) * 100) / 100,
    }),
  }));
},

// Update entities matching a predicate
markCategoryFeatured(category: string): void {
  patchState(store, updateEntities({
    predicate: (product) => product.category === category,
    changes: { featured: true },
  }));
},

// Update every entity in the collection
clearAllFeatured(): void {
  patchState(store, updateAllEntities({ featured: false }));
},
```

The `changes` parameter accepts either a `Partial<Entity>` object or a function `(entity: Entity) => Partial<Entity>`. Use the function form when the new value depends on the current value, like toggling a boolean or computing a price from the existing price.

The `updateEntities` function accepts either `ids` (an array of entity IDs) or `predicate` (a function that returns true for entities to update), but not both. TypeScript enforces this through discriminated union types.

### Upserting Entities

Upsert means "update if it exists, insert if it does not." This is ideal when receiving data from a source like a WebSocket where you cannot know whether the entity is already in the store:

```typescript
// src/app/products/state/product-catalog.store.ts
import { upsertEntity, upsertEntities } from '@ngrx/signals/entities';

// Inside withMethods
handleRealtimeUpdate(product: Product): void {
  patchState(store, upsertEntity(product));
},
handleBatchUpdate(products: Product[]): void {
  patchState(store, upsertEntities(products));
},
```

When the entity exists, upsert replaces it entirely with the provided object (not a partial merge). When it does not exist, upsert adds it. This matches `@ngrx/entity`'s `upsertOne` behavior.

### Removing Entities

```typescript
// src/app/products/state/product-catalog.store.ts
import { removeEntity, removeEntities, removeAllEntities } from '@ngrx/signals/entities';

// Inside withMethods
removeProduct(id: string): void {
  patchState(store, removeEntity(id));
},
removeProducts(ids: string[]): void {
  patchState(store, removeEntities(ids));
},
clearCatalog(): void {
  patchState(store, removeAllEntities());
},
```

### Composing Multiple Updaters

A powerful feature of the functional updater design: you can pass multiple updaters to a single `patchState` call. They execute in order, and the store emits a single update:

```typescript
// src/app/products/state/product-catalog.store.ts
refreshCatalog(freshProducts: Product[], expiredIds: string[]): void {
  patchState(
    store,
    removeEntities(expiredIds),
    upsertEntities(freshProducts),
  );
},
```

This atomically removes expired products and upserts fresh ones. Components see one state change, not two.

## Custom Entity IDs

Not every entity has a property called `id`. Some use `_id`, `sku`, `uuid`, or a composite of multiple fields. The `entityConfig` function lets you define a reusable configuration that includes a custom `selectId` function:

```typescript
// src/app/products/state/product-catalog.store.ts
import { signalStore, withMethods, patchState } from '@ngrx/signals';
import {
  withEntities,
  entityConfig,
  addEntity,
  updateEntity,
  removeEntity,
  setAllEntities,
} from '@ngrx/signals/entities';
import { type } from '@ngrx/signals';

interface InventoryItem {
  sku: string;
  warehouseId: string;
  name: string;
  quantity: number;
}

const inventoryConfig = entityConfig({
  entity: type<InventoryItem>(),
  selectId: (item) => item.sku,
});

export const InventoryStore = signalStore(
  withEntities(inventoryConfig),
  withMethods((store) => ({
    addItem(item: InventoryItem): void {
      patchState(store, addEntity(item, inventoryConfig));
    },
    updateQuantity(sku: string, quantity: number): void {
      patchState(store, updateEntity({ id: sku, changes: { quantity } }, inventoryConfig));
    },
    removeItem(sku: string): void {
      patchState(store, removeEntity(sku, inventoryConfig));
    },
    loadItems(items: InventoryItem[]): void {
      patchState(store, setAllEntities(items, inventoryConfig));
    },
  })),
);
```

The `type<T>()` helper from `@ngrx/signals` is a TypeScript type marker. It carries no runtime value but tells the entity system what type of entity this configuration manages.

When using a custom `selectId`, you must pass the config as the second argument to every updater function call. This is not optional. Without it, the updater does not know how to extract the ID from your entity. TypeScript will enforce this with a type error if you forget.

### Composite Identifiers

For entities identified by a combination of fields, the `selectId` function can compute a composite key:

```typescript
// src/app/flights/state/flight.store.ts
import { entityConfig } from '@ngrx/signals/entities';
import { type } from '@ngrx/signals';

interface FlightSegment {
  airlineCode: string;
  flightNumber: number;
  departureDate: string;
  origin: string;
  destination: string;
}

const flightConfig = entityConfig({
  entity: type<FlightSegment>(),
  selectId: (segment) => `${segment.airlineCode}-${segment.flightNumber}-${segment.departureDate}`,
});
```

The returned ID must be a `string` or `number`. All entity updater functions use this computed key for lookups and deduplication.

## Named Collections: Multiple Entity Types in One Store

A single store often manages more than one entity type. An order management store needs orders and line items. A CMS store needs articles and comments. The `collection` property in `entityConfig` creates a namespace that prefixes all generated signals:

```typescript
// src/app/orders/state/order.store.ts
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
  entityConfig,
  setAllEntities,
  addEntity,
  updateEntity,
  removeEntity,
  removeEntities,
} from '@ngrx/signals/entities';
import { type } from '@ngrx/signals';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

interface Order {
  id: string;
  customerId: string;
  status: 'pending' | 'confirmed' | 'shipped';
  createdAt: string;
}

interface LineItem {
  id: string;
  orderId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
}

const orderConfig = entityConfig({
  entity: type<Order>(),
  collection: 'orders',
});

const lineItemConfig = entityConfig({
  entity: type<LineItem>(),
  collection: 'lineItems',
});

export const OrderStore = signalStore(
  { providedIn: 'root' },
  withEntities(orderConfig),
  withEntities(lineItemConfig),
  withState({ selectedOrderId: null as string | null }),
  withComputed((store) => ({
    selectedOrder: computed(() => {
      const id = store.selectedOrderId();
      return id ? store.ordersEntityMap()[id] ?? null : null;
    }),
    selectedOrderLineItems: computed(() => {
      const id = store.selectedOrderId();
      if (!id) return [];
      return store.lineItemsEntities().filter((item) => item.orderId === id);
    }),
    orderTotal: computed(() => {
      const id = store.selectedOrderId();
      if (!id) return 0;
      return store.lineItemsEntities()
        .filter((item) => item.orderId === id)
        .reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    }),
  })),
  withMethods((store) => {
    const http = inject(HttpClient);

    return {
      async loadOrder(orderId: string): Promise<void> {
        const response = await firstValueFrom(
          http.get<{ order: Order; lineItems: LineItem[] }>(`/api/orders/${orderId}`)
        );
        patchState(
          store,
          setAllEntities([response.order], orderConfig),
          setAllEntities(response.lineItems, lineItemConfig),
          { selectedOrderId: orderId },
        );
      },
      addLineItem(lineItem: LineItem): void {
        patchState(store, addEntity(lineItem, lineItemConfig));
      },
      updateLineItemQuantity(lineItemId: string, quantity: number): void {
        patchState(store, updateEntity(
          { id: lineItemId, changes: { quantity } },
          lineItemConfig,
        ));
      },
      removeLineItem(lineItemId: string): void {
        patchState(store, removeEntity(lineItemId, lineItemConfig));
      },
      deleteOrder(orderId: string): void {
        const lineItemIds = store.lineItemsEntities()
          .filter((item) => item.orderId === orderId)
          .map((item) => item.id);
        patchState(
          store,
          removeEntity(orderId, orderConfig),
          removeEntities(lineItemIds, lineItemConfig),
          (state) => ({
            selectedOrderId: state.selectedOrderId === orderId ? null : state.selectedOrderId,
          }),
        );
      },
      selectOrder(orderId: string): void {
        patchState(store, { selectedOrderId: orderId });
      },
    };
  }),
);
```

With named collections, the generated signals are prefixed:

- `store.ordersEntityMap()`, `store.ordersIds()`, `store.ordersEntities()`
- `store.lineItemsEntityMap()`, `store.lineItemsIds()`, `store.lineItemsEntities()`

Each collection is independent. Updating a line item does not recompute the orders signals.

Compare this with Chapter 11's approach, where we needed two separate `createEntityAdapter` instances, a combined `OrdersState` interface, and nested state slices within the reducer. The SignalStore version co-locates everything in a single file with named collections, and the `patchState` call in `deleteOrder` atomically removes the order, its line items, and resets the selection in one update.

## Deriving State from Entities

The `withComputed` feature pairs naturally with `withEntities` for filtered, sorted, and aggregated views:

```typescript
// src/app/products/state/product-catalog.store.ts
import { computed } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';
import { withEntities, setAllEntities, updateEntity } from '@ngrx/signals/entities';
import { Product } from '../product.model';

type SortField = 'name' | 'price';
type SortDirection = 'asc' | 'desc';

interface CatalogFilters {
  category: string;
  searchTerm: string;
  sortField: SortField;
  sortDirection: SortDirection;
}

const initialFilters: CatalogFilters = {
  category: 'all',
  searchTerm: '',
  sortField: 'name',
  sortDirection: 'asc',
};

export const ProductCatalogStore = signalStore(
  { providedIn: 'root' },
  withEntities<Product>(),
  withState(initialFilters),
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
            p.description.toLowerCase().includes(searchTerm),
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
    featuredProducts: computed(() =>
      store.entities().filter((p) => p.featured),
    ),
    categories: computed(() => {
      const cats = new Set(store.entities().map((p) => p.category));
      return ['all', ...Array.from(cats).sort()];
    }),
  })),
  withMethods((store) => ({
    setProducts(products: Product[]): void {
      patchState(store, setAllEntities(products));
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
    toggleFeatured(id: string): void {
      patchState(store, updateEntity({
        id,
        changes: (product) => ({ featured: !product.featured }),
      }));
    },
  })),
);
```

Notice that sorting happens in `withComputed`, not in the entity state itself. Unlike `@ngrx/entity`'s `sortComparer`, `withEntities` does not support automatic sorting. This is a deliberate simplification. Sorting in computed signals means you can have multiple sort orders for different views without paying the cost of re-sorting on every write. The computed signal only recalculates when its dependencies change, giving you the same memoization benefit as Classic Store selectors.

## A Complete Working Example

Let us wire the catalog store to a component that displays products with filtering and sorting:

```typescript
// src/app/products/product-catalog.component.ts
import { Component, inject, OnInit } from '@angular/core';
import { ProductCatalogStore } from './state/product-catalog.store';
import { ProductService } from '../services/product.service';

@Component({
  selector: 'app-product-catalog',
  standalone: true,
  template: `
    <h2>Product Catalog ({{ store.totalProducts() }} products)</h2>

    <div class="filters">
      <select
        [value]="store.category()"
        (change)="store.setCategory($any($event.target).value)"
      >
        @for (cat of store.categories(); track cat) {
          <option [value]="cat">{{ cat }}</option>
        }
      </select>

      <input
        type="text"
        placeholder="Search..."
        [value]="store.searchTerm()"
        (input)="store.setSearchTerm($any($event.target).value)"
      />

      <button (click)="store.setSorting('name', 'asc')">Name A-Z</button>
      <button (click)="store.setSorting('price', 'asc')">Price Low-High</button>
      <button (click)="store.setSorting('price', 'desc')">Price High-Low</button>
    </div>

    <div class="product-grid">
      @for (product of store.filteredProducts(); track product.id) {
        <div class="product-card">
          <h3>{{ product.name }}</h3>
          <p class="price">\${{ product.price }}</p>
          <p class="category">{{ product.category }}</p>
          <p>{{ product.description }}</p>
          <label>
            <input
              type="checkbox"
              [checked]="product.featured"
              (change)="store.toggleFeatured(product.id)"
            />
            Featured
          </label>
        </div>
      } @empty {
        <p>No products match your filters.</p>
      }
    </div>

    @if (store.featuredProducts().length > 0) {
      <h3>Featured Products</h3>
      <ul>
        @for (product of store.featuredProducts(); track product.id) {
          <li>{{ product.name }} - \${{ product.price }}</li>
        }
      </ul>
    }
  `,
})
export class ProductCatalogComponent implements OnInit {
  readonly store = inject(ProductCatalogStore);
  private readonly productService = inject(ProductService);

  async ngOnInit(): Promise<void> {
    const products = await this.productService.getAll();
    this.store.setProducts(products);
  }
}
```

The component reads entity-derived signals (`filteredProducts`, `totalProducts`, `featuredProducts`, `categories`) and calls store methods to filter, sort, and toggle. The store handles all state transitions. The component has zero state management logic.

## Comparison with @ngrx/entity

If you worked through Chapter 11, you already know the normalized entity pattern. Here is how the two approaches compare:

| Aspect | @ngrx/entity (Ch 11) | withEntities (Ch 16) |
|--------|---------------------|---------------------|
| State shape | `{ ids: [], entities: {} }` | `{ ids: [], entityMap: {} }` |
| Setup | `createEntityAdapter<T>()` | `withEntities<T>()` |
| Operations | Adapter methods: `adapter.addOne(entity, state)` | Standalone updaters: `patchState(store, addEntity(entity))` |
| Custom IDs | `selectId` on adapter creation | `selectId` in `entityConfig()` |
| Sorting | Built-in `sortComparer` | Manual via `withComputed` |
| Selectors | `adapter.getSelectors()` generates memoized selectors | `entities` computed signal auto-generated |
| Reactivity | Observable-based (`store.select(...)`) | Signal-based (direct signal access) |
| Named collections | Manual: separate adapters and state slices | Built-in `collection` property |
| Upsert | `upsertOne` / `upsertMany` | `upsertEntity` / `upsertEntities` |
| Prepend | Not available | `prependEntity` / `prependEntities` |
| File overhead | Actions + reducer + selectors + feature | Single store file |

The mental model is the same: normalize collections into dictionaries for O(1) lookups. The mechanics are different: standalone functions with `patchState` instead of adapter methods inside reducers. If you are migrating from Classic Store to SignalStore (covered in Chapter 22), the entity operations translate almost one-to-one.

## Common Mistakes

### Mistake 1: Forgetting the Config When Using Named Collections

```typescript
// WRONG: no config passed to addEntity
const config = entityConfig({ entity: type<Product>(), collection: 'products' });

export const BrokenStore = signalStore(
  withEntities(config),
  withMethods((store) => ({
    addProduct(product: Product): void {
      patchState(store, addEntity(product)); // Type error!
    },
  })),
);
```

When using named collections or custom IDs, the config must be passed to every updater function. Without it, the updater does not know which collection to target or how to extract the entity's ID. TypeScript catches this with a type mismatch on the state shape.

```typescript
// CORRECT: pass the config as the second argument
addProduct(product: Product): void {
  patchState(store, addEntity(product, config));
},
```

### Mistake 2: Expecting addEntity to Replace Existing Entities

```typescript
// WRONG: assuming addEntity updates an existing product
handleProductUpdate(product: Product): void {
  patchState(store, addEntity(product)); // Silently skipped if ID exists!
}
```

`addEntity` silently skips the operation if an entity with the same ID already exists. The existing entity is not updated. There is no error, no warning, and no replacement. This behavior is intentional: "add" means "add if new."

```typescript
// CORRECT: use upsertEntity for add-or-replace semantics
handleProductUpdate(product: Product): void {
  patchState(store, upsertEntity(product));
}
```

Use `upsertEntity` when you want to insert a new entity or fully replace an existing one. Use `updateEntity` when you have partial changes to merge into an existing entity.

### Mistake 3: Using setAllEntities for Incremental Updates

```typescript
// WRONG: replaces the entire collection, losing entities not in the response
handlePageLoaded(pageProducts: Product[]): void {
  patchState(store, setAllEntities(pageProducts)); // Wipes previous pages!
}
```

`setAllEntities` clears the collection before inserting. If you are loading paginated data, each page load wipes the products from previous pages.

```typescript
// CORRECT: use addEntities or upsertEntities for incremental additions
handlePageLoaded(pageProducts: Product[]): void {
  patchState(store, upsertEntities(pageProducts));
}
```

Use `setAllEntities` only when you want to replace the entire collection (full API fetch, cache refresh). Use `addEntities` or `upsertEntities` for incremental additions like pagination or real-time updates.

### Mistake 4: Mutating Entity Objects Before Passing to Updaters

```typescript
// WRONG: mutating the entity object directly
toggleFeatured(id: string): void {
  const product = store.entityMap()[id];
  if (product) {
    product.featured = !product.featured; // Mutation!
    patchState(store, setEntity(product));
  }
}
```

In development mode, NgRx freezes entity objects with `Object.freeze()`. Mutating a frozen object throws a runtime error. Even if it did not throw, the `entityMap` signal's reference has not changed, so the store would not detect the update.

```typescript
// CORRECT: use updateEntity with a functional change
toggleFeatured(id: string): void {
  patchState(store, updateEntity({
    id,
    changes: (product) => ({ featured: !product.featured }),
  }));
}
```

The `changes` function receives the current entity and returns a partial update. The updater creates a new entity object internally. No mutation needed.

## Key Takeaways

- **`withEntities` provides the same normalized state pattern as `@ngrx/entity`, but with signal-based reactivity and standalone updater functions.** The state shape (`entityMap` + `ids` + derived `entities` signal) gives O(1) lookups and ordered iteration without manual array management.

- **Entity updaters are composable.** Pass multiple updaters to a single `patchState` call to batch operations atomically. The store emits one signal update, not one per operation.

- **Use `entityConfig` with `selectId` for custom IDs and `collection` for named collections.** The config must be passed to every updater function call when using either feature. TypeScript enforces this at compile time.

- **Sort in `withComputed`, not in the entity state.** Unlike `@ngrx/entity`'s `sortComparer`, `withEntities` keeps insertion order. Sorting in computed signals is more flexible (multiple sort orders) and only recalculates when dependencies change.

- **Choose the right operation: `addEntity` skips duplicates, `setEntity` replaces entirely, `upsertEntity` adds or replaces, and `updateEntity` patches.** Misusing these leads to silent data loss or stale entries, the same lesson from Chapter 11 applied to a new API.
