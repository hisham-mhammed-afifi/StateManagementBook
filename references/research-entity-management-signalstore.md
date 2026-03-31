# Research: Entity Management in SignalStore (withEntities)

**Date:** 2026-03-31
**Chapter:** Ch 16
**Status:** Ready for chapter generation

## API Surface

All imports from `@ngrx/signals/entities` (v21.1.0). All APIs are **Stable**.

### Store Feature

| API | Signature | Stability |
|-----|-----------|-----------|
| `withEntities<Entity>()` | `withEntities<Entity>(): SignalStoreFeature` | Stable |
| `withEntities(config)` | `withEntities<Entity, Collection>(config: { entity: Entity; collection: Collection }): SignalStoreFeature` | Stable |

### Configuration

| API | Signature | Stability |
|-----|-----------|-----------|
| `entityConfig()` | `entityConfig<Entity, Collection>(config: { entity: Entity; collection?: Collection; selectId?: SelectEntityId<Entity> }): EntityConfig` | Stable |
| `type<T>()` | `type<T>(): T` (TypeScript type marker) | Stable |

### Entity Updater Functions (used with `patchState()`)

| API | Signature | Stability |
|-----|-----------|-----------|
| `addEntity` | `addEntity<Entity>(entity: Entity, config?): PartialStateUpdater` | Stable |
| `addEntities` | `addEntities<Entity>(entities: Entity[], config?): PartialStateUpdater` | Stable |
| `prependEntity` | `prependEntity<Entity>(entity: Entity, config?): PartialStateUpdater` (v20+) | Stable |
| `prependEntities` | `prependEntities<Entity>(entities: Entity[], config?): PartialStateUpdater` (v20+) | Stable |
| `setEntity` | `setEntity<Entity>(entity: Entity, config?): PartialStateUpdater` | Stable |
| `setEntities` | `setEntities<Entity>(entities: Entity[], config?): PartialStateUpdater` | Stable |
| `setAllEntities` | `setAllEntities<Entity>(entities: Entity[], config?): PartialStateUpdater` | Stable |
| `updateEntity` | `updateEntity<Entity>(update: { id: EntityId; changes: Partial<Entity> \| ((e: Entity) => Partial<Entity>) }, config?): PartialStateUpdater` | Stable |
| `updateEntities` | `updateEntities<Entity>(update: { ids: EntityId[] \| predicate: (e: Entity) => boolean; changes: Partial<Entity> \| ((e: Entity) => Partial<Entity>) }, config?): PartialStateUpdater` | Stable |
| `updateAllEntities` | `updateAllEntities<Entity>(changes: Partial<Entity> \| ((e: Entity) => Partial<Entity>), config?): PartialStateUpdater` | Stable |
| `removeEntity` | `removeEntity(id: EntityId, config?): PartialStateUpdater` | Stable |
| `removeEntities` | `removeEntities(ids: EntityId[], config?): PartialStateUpdater` | Stable |
| `removeAllEntities` | `removeAllEntities(config?): PartialStateUpdater` | Stable |
| `upsertEntity` | `upsertEntity<Entity>(entity: Entity, config?): PartialStateUpdater` | Stable |
| `upsertEntities` | `upsertEntities<Entity>(entities: Entity[], config?): PartialStateUpdater` | Stable |

### Generated Store Members

**Without collection name** (`withEntities<Product>()`):
- State signals: `entityMap: Signal<Record<EntityId, Entity>>`, `ids: Signal<EntityId[]>`
- Computed signals: `entities: Signal<Entity[]>`

**With collection name** (`withEntities({ entity: type<Product>(), collection: 'products' })`):
- State signals: `productsEntityMap`, `productsIds`
- Computed signals: `productsEntities`

### Core Types

| Type | Definition |
|------|-----------|
| `EntityId` | `string \| number` |
| `EntityMap<Entity>` | `Record<EntityId, Entity>` |
| `EntityState<Entity>` | `{ entityMap: EntityMap<Entity>; ids: EntityId[] }` |
| `NamedEntityState<Entity, Collection>` | Prefixed version of EntityState |
| `SelectEntityId<Entity>` | `(entity: Entity) => EntityId` |

## Key Concepts

- **Normalized entity state**: Same concept as @ngrx/entity (Ch 11), stored as `entityMap` (dictionary) + `ids` (ordered array), with a derived `entities` computed signal
- **Functional updaters**: Entity operations are standalone functions (not adapter methods) used with `patchState()`, composable via multiple updaters in a single call
- **Named collections**: Multiple entity types in one store via `collection` property, auto-prefixing all generated members
- **Custom ID selection**: `selectId` function (replaced `idKey` in v18) for entities with non-standard ID properties or composite keys
- **Configuration reuse**: `entityConfig()` defines entity type, collection, and selectId once, reusable across all updater calls
- **Silent duplicate handling**: `addEntity`/`prependEntity` silently skip if ID already exists (no error thrown)
- **Upsert semantics**: `upsertEntity`/`upsertEntities` add if missing, replace if existing
- **Prepend operations**: `prependEntity`/`prependEntities` (v20+) for newest-first UX patterns
- **Predicate-based updates**: `updateEntities` accepts either `ids` array or `predicate` function
- **Functional changes**: Update operations accept either `Partial<Entity>` or `(entity) => Partial<Entity>` for derived updates

## Code Patterns

### Basic Entity Store

```typescript
// src/app/products/product.store.ts
import { signalStore, withMethods, withComputed } from '@ngrx/signals';
import {
  withEntities,
  addEntity,
  removeEntity,
  updateEntity,
  setAllEntities,
} from '@ngrx/signals/entities';
import { Product } from './product.model';
import { computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export const ProductStore = signalStore(
  { providedIn: 'root' },
  withEntities<Product>(),
  withComputed(({ entities }) => ({
    productCount: computed(() => entities().length),
    inStockProducts: computed(() => entities().filter(p => p.inStock)),
  })),
  withMethods((store) => {
    const http = inject(HttpClient);

    return {
      async loadProducts(): Promise<void> {
        const products = await firstValueFrom(http.get<Product[]>('/api/products'));
        patchState(store, setAllEntities(products));
      },
      addProduct(product: Product): void {
        patchState(store, addEntity(product));
      },
      updatePrice(id: number, price: number): void {
        patchState(store, updateEntity({ id, changes: { price } }));
      },
      removeProduct(id: number): void {
        patchState(store, removeEntity(id));
      },
    };
  })
);
```

### Custom Entity ID with entityConfig

```typescript
// src/app/flights/flight.store.ts
import { signalStore, withMethods } from '@ngrx/signals';
import {
  withEntities,
  entityConfig,
  addEntity,
  updateEntity,
  removeEntity,
} from '@ngrx/signals/entities';
import { type } from '@ngrx/signals';

interface Flight {
  flightNumber: string;
  airlineId: string;
  departure: string;
  arrival: string;
}

const flightConfig = entityConfig({
  entity: type<Flight>(),
  collection: 'flights',
  selectId: (flight) => `${flight.airlineId}-${flight.flightNumber}`,
});

export const FlightStore = signalStore(
  withEntities(flightConfig),
  withMethods((store) => ({
    addFlight(flight: Flight): void {
      patchState(store, addEntity(flight, flightConfig));
    },
    removeFlight(airlineId: string, flightNumber: string): void {
      patchState(store, removeEntity(`${airlineId}-${flightNumber}`, flightConfig));
    },
  }))
);
```

### Multiple Named Collections

```typescript
// src/app/orders/order.store.ts
import { signalStore, withComputed, withMethods } from '@ngrx/signals';
import {
  withEntities,
  entityConfig,
  setAllEntities,
  addEntity,
  removeEntities,
} from '@ngrx/signals/entities';
import { type } from '@ngrx/signals';
import { computed } from '@angular/core';

const orderConfig = entityConfig({
  entity: type<Order>(),
  collection: 'orders',
});

const lineItemConfig = entityConfig({
  entity: type<LineItem>(),
  collection: 'lineItems',
});

export const OrderStore = signalStore(
  withEntities(orderConfig),
  withEntities(lineItemConfig),
  withComputed((store) => ({
    orderTotal: computed(() =>
      store.lineItemsEntities().reduce((sum, item) => sum + item.price * item.quantity, 0)
    ),
  })),
  withMethods((store) => ({
    loadOrder(order: Order, lineItems: LineItem[]): void {
      patchState(
        store,
        setAllEntities([order], orderConfig),
        setAllEntities(lineItems, lineItemConfig)
      );
    },
  }))
);
```

### Predicate-Based and Functional Updates

```typescript
// Predicate-based: mark all completed tasks as archived
patchState(store, updateEntities({
  predicate: (task) => task.completed,
  changes: { archived: true },
}));

// Functional changes: increment a counter
patchState(store, updateEntity({
  id: taskId,
  changes: (task) => ({ completionCount: task.completionCount + 1 }),
}));

// Composing multiple updaters in one patchState call
patchState(
  store,
  removeEntities(expiredIds),
  addEntities(newTasks),
  updateAllEntities((task) => ({ lastRefreshed: Date.now() }))
);
```

### Prepend Pattern (Newest First)

```typescript
// Add new notification at the top of the list
patchState(store, prependEntity({
  id: crypto.randomUUID(),
  message: 'New order received',
  timestamp: Date.now(),
  read: false,
}));
```

### Upsert Pattern (Add or Replace)

```typescript
// WebSocket handler: insert new entities, replace existing ones
handleMessage(entities: Product[]): void {
  patchState(store, upsertEntities(entities));
}
```

## Breaking Changes and Gotchas

### Renamed/Changed APIs
- **v18**: `idKey` property replaced by `selectId` function in entity configuration. `selectId` is more flexible (supports composite keys, computed IDs)
- **v18**: `withEntities` graduated from developer preview to stable
- **v20**: `prependEntity` and `prependEntities` added
- **v20**: `upsertEntity` and `upsertEntities` added
- **v21**: `withEffects` renamed to `withEventHandlers` in `@ngrx/signals/events` (not directly in entities, but relevant when combining entities with side effects). Migration schematics available.
- **v21**: Production bundle optimizations dropped `assertInInjectionContext` and `assertUniqueStoreMembers` assertions, removed symbol descriptions

### Behavioral Gotchas
- **Silent duplicate skipping**: `addEntity` and `prependEntity` silently skip if an entity with the same ID already exists. No error, no warning, no replacement. Use `upsertEntity` if you want add-or-replace semantics.
- **Config required for named collections**: When using named collections, you MUST pass the config to every updater function call. Forgetting it causes a compile error (type mismatch on state shape).
- **Entity updaters are pure functions**: They return `PartialStateUpdater` objects, they do not mutate state directly. They must be passed to `patchState()`.
- **Order matters in `ids` array**: The `ids` array determines the order of entities in the `entities` computed signal. `addEntity` appends, `prependEntity` prepends.
- **No built-in sorting**: Unlike `@ngrx/entity`'s `sortComparer`, `withEntities` does not support automatic sorting. Sort in `withComputed` instead.
- **Shallow entity comparison**: Signal equality uses reference comparison. Updating an entity always triggers recomputation of `entities` even if values are identical.

### Comparison with @ngrx/entity
| Feature | @ngrx/entity | @ngrx/signals/entities |
|---------|-------------|----------------------|
| State shape | `{ ids: [], entities: {} }` | `{ ids: [], entityMap: {} }` |
| Operations | Adapter methods on state | Standalone updater functions with `patchState()` |
| Sorting | Built-in `sortComparer` | Manual via `withComputed` |
| Selectors | `getSelectors()` generates memoized selectors | `entities` computed signal auto-generated |
| Reactivity | Observable-based (store.select) | Signal-based (direct signal access) |
| Named collections | Not supported natively | Built-in `collection` property |
| Custom IDs | `selectId` on adapter creation | `selectId` via `entityConfig()` |
| Upsert | `upsertOne`/`upsertMany` on adapter | `upsertEntity`/`upsertEntities` standalone |
| Prepend | Not available | `prependEntity`/`prependEntities` |

## Sources

### Official Documentation
- Entity Management Guide: https://ngrx.io/guide/signals/signal-store/entity-management
- withEntities API Reference: https://ngrx.io/api/signals/entities/withEntities
- entityConfig API Reference: https://ngrx.io/api/signals/entities/entityConfig
- Custom Store Features: https://ngrx.io/guide/signals/signal-store/custom-store-features
- NgRx v21 Migration Guide: https://ngrx.io/guide/migration/v21
- NgRx v20 Migration Guide: https://ngrx.io/guide/migration/v20

### Release Announcements
- NgRx v21 Announcement: https://dev.to/ngrx/announcing-ngrx-21-celebrating-a-10-year-journey-with-a-fresh-new-look-and-ngrxsignalsevents-5ekp
- NgRx v20 Announcement: https://dev.to/ngrx/announcing-ngrx-v20-the-power-of-events-enhanced-dx-and-a-mature-signalstore-2fdm
- NgRx Signals v18 Announcement: https://dev.to/ngrx/announcing-ngrx-signals-v18-state-encapsulation-private-store-members-enhanced-entity-management-and-more-2lo6

### Expert Blog Posts
- Manfred Steyer - The NGRX Signal Store and Your Architecture: https://www.angulararchitects.io/en/blog/the-ngrx-signal-store-and-your-architecture/
- Manfred Steyer - Smarter, Not Harder: Simplifying with NGRX Signal Store and Custom Features: https://www.angulararchitects.io/en/blog/smarter-not-harder-simplifying-your-application-with-ngrx-signal-store-and-custom-features/
- Manfred Steyer - The new NGRX Signal Store: 3+n Flavors: https://www.angulararchitects.io/en/blog/the-new-ngrx-signal-store-for-angular-2-1-flavors/
- Manfred Steyer - Using the Resource API with the NGRX Signal Store: https://www.angulararchitects.io/blog/using-the-resource-api-with-the-ngrx-signal-store/
- Rainer Hahnekamp - NgRx Signal Store: The Missing Piece to Signals: https://medium.com/ngconf/ngrx-signal-store-the-missing-piece-to-signals-ac125d804026

### Community Resources
- NgRx Signal Store Best Practices: https://www.codingrules.ai/rules/ngrx-signal-store-best-practices
- Stefanos Lignos - All you need to know about NgRx Signal Store: https://www.stefanos-lignos.dev/posts/ngrx-signals-store
- Angular Love - Breakthrough in State Management with Signal Store: https://angular.love/breakthrough-in-state-management-discover-the-simplicity-of-signal-store-part-1/
- NgRx Toolkit (Angular Architects): https://ngrx-toolkit.angulararchitects.io/docs/with-entity-resources

### GitHub
- NgRx Platform Repository: https://github.com/ngrx/platform
- Allow generics in withEntities: https://github.com/ngrx/platform/issues/4339
- entityConfig function proposal: https://github.com/ngrx/platform/issues/4393
- selectId vs idKey discussion: https://github.com/ngrx/platform/issues/4392

## Open Questions

- **No built-in sorting**: Confirm there is still no `sortComparer` equivalent in v21.1.0. The recommendation is to sort in `withComputed`. Verify this is still the case.
- **removeEntities with predicate**: Some sources suggest `removeEntities` may also accept a predicate (like `updateEntities`). Verify the exact overload in v21.1.0 type definitions.
- **Entity change detection granularity**: When one entity in a large collection is updated, does the `entities` computed signal recompute the entire array or is there any optimization? Likely recomputes the full array since it derives from `entityMap` and `ids`. Confirm.
