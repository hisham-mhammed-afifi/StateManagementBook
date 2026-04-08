# Research: State Design Principles

**Date:** 2026-04-06
**Chapter:** Ch 23
**Status:** Ready for chapter generation

## API Surface

### Angular Core Signals (`@angular/core`)

| API | Import Path | Signature | Stability |
|-----|-------------|-----------|-----------|
| `signal` | `@angular/core` | `signal<T>(initialValue: T, options?: SignalOptions<T>): WritableSignal<T>` | Stable |
| `computed` | `@angular/core` | `computed<T>(computation: () => T, options?: { equal?: (a: T, b: T) => boolean }): Signal<T>` | Stable |
| `linkedSignal` | `@angular/core` | `linkedSignal<T>(options: { source: Signal, computation: () => T }): WritableSignal<T>` | Stable |
| `effect` | `@angular/core` | `effect(fn: () => void, options?: CreateEffectOptions): EffectRef` | Stable |
| `ResourceStatus` | `@angular/core` | `enum: Idle, Loading, Reloading, Resolved, Error, Local` | Stable |

### NgRx Classic Store -- Entity Adapter (`@ngrx/entity`)

| API | Import Path | Signature | Stability |
|-----|-------------|-----------|-----------|
| `EntityState<T>` | `@ngrx/entity` | `interface { ids: string[] \| number[]; entities: Dictionary<T> }` | Stable |
| `createEntityAdapter` | `@ngrx/entity` | `createEntityAdapter<T>(options?: { selectId?, sortComparer? }): EntityAdapter<T>` | Stable |
| `EntityAdapter.getInitialState` | `@ngrx/entity` | `getInitialState(additionalState?: S): EntityState<T> & S` | Stable |
| `EntityAdapter.getSelectors` | `@ngrx/entity` | `getSelectors(featureSelector?): { selectIds, selectEntities, selectAll, selectTotal }` | Stable |
| `EntityAdapter.addOne` | `@ngrx/entity` | `addOne(entity: T, state: S): S` | Stable |
| `EntityAdapter.addMany` | `@ngrx/entity` | `addMany(entities: T[], state: S): S` | Stable |
| `EntityAdapter.setOne` | `@ngrx/entity` | `setOne(entity: T, state: S): S` | Stable |
| `EntityAdapter.setMany` | `@ngrx/entity` | `setMany(entities: T[], state: S): S` | Stable |
| `EntityAdapter.setAll` | `@ngrx/entity` | `setAll(entities: T[], state: S): S` | Stable |
| `EntityAdapter.removeOne` | `@ngrx/entity` | `removeOne(id: string \| number, state: S): S` | Stable |
| `EntityAdapter.removeMany` | `@ngrx/entity` | `removeMany(ids: (string \| number)[] \| predicate: (e: T) => boolean, state: S): S` | Stable |
| `EntityAdapter.removeAll` | `@ngrx/entity` | `removeAll(state: S): S` | Stable |
| `EntityAdapter.updateOne` | `@ngrx/entity` | `updateOne(update: Update<T>, state: S): S` | Stable |
| `EntityAdapter.updateMany` | `@ngrx/entity` | `updateMany(updates: Update<T>[], state: S): S` | Stable |
| `EntityAdapter.upsertOne` | `@ngrx/entity` | `upsertOne(entity: T, state: S): S` | Stable |
| `EntityAdapter.upsertMany` | `@ngrx/entity` | `upsertMany(entities: T[], state: S): S` | Stable |
| `EntityAdapter.mapOne` | `@ngrx/entity` | `mapOne(map: { id, map: (e) => e }, state: S): S` | Stable |
| `EntityAdapter.map` | `@ngrx/entity` | `map(mapFn: (e: T) => T, state: S): S` | Stable |

### NgRx Classic Store -- Selectors (`@ngrx/store`)

| API | Import Path | Signature | Stability |
|-----|-------------|-----------|-----------|
| `createSelector` | `@ngrx/store` | `createSelector(...selectors, projector): MemoizedSelector` | Stable |
| `createFeatureSelector` | `@ngrx/store` | `createFeatureSelector<T>(featureName: string): MemoizedSelector<object, T>` | Stable |

### NgRx SignalStore -- State and Computed (`@ngrx/signals`)

| API | Import Path | Signature | Stability |
|-----|-------------|-----------|-----------|
| `signalStore` | `@ngrx/signals` | `signalStore(...features): Type<SignalStore>` | Stable |
| `withState` | `@ngrx/signals` | `withState<T>(state: T \| () => T): SignalStoreFeature` | Stable |
| `withComputed` | `@ngrx/signals` | `withComputed<T>(factory: (store) => T): SignalStoreFeature` | Stable |
| `withMethods` | `@ngrx/signals` | `withMethods<T>(factory: (store) => T): SignalStoreFeature` | Stable |
| `patchState` | `@ngrx/signals` | `patchState(store, ...updaters): void` | Stable |
| `signalStoreFeature` | `@ngrx/signals` | `signalStoreFeature(...features): SignalStoreFeature` | Stable |
| `type` | `@ngrx/signals` | `type<T>(): T` (type helper for feature constraints) | Stable |

### NgRx SignalStore -- Entity Management (`@ngrx/signals/entities`)

| API | Import Path | Signature | Stability |
|-----|-------------|-----------|-----------|
| `withEntities` | `@ngrx/signals/entities` | `withEntities<T>(config?: { entity?, collection?, selectId? }): SignalStoreFeature` | Stable |
| `addEntity` | `@ngrx/signals/entities` | `addEntity(entity, config?): EntityUpdater` | Stable |
| `addEntities` | `@ngrx/signals/entities` | `addEntities(entities, config?): EntityUpdater` | Stable |
| `setEntity` | `@ngrx/signals/entities` | `setEntity(entity, config?): EntityUpdater` | Stable |
| `setEntities` | `@ngrx/signals/entities` | `setEntities(entities, config?): EntityUpdater` | Stable |
| `setAllEntities` | `@ngrx/signals/entities` | `setAllEntities(entities, config?): EntityUpdater` | Stable |
| `updateEntity` | `@ngrx/signals/entities` | `updateEntity({ id, changes }, config?): EntityUpdater` | Stable |
| `updateEntities` | `@ngrx/signals/entities` | `updateEntities({ predicate \| ids, changes }, config?): EntityUpdater` | Stable |
| `updateAllEntities` | `@ngrx/signals/entities` | `updateAllEntities(changes, config?): EntityUpdater` | Stable |
| `removeEntity` | `@ngrx/signals/entities` | `removeEntity(id, config?): EntityUpdater` | Stable |
| `removeEntities` | `@ngrx/signals/entities` | `removeEntities(ids \| predicate, config?): EntityUpdater` | Stable |
| `removeAllEntities` | `@ngrx/signals/entities` | `removeAllEntities(config?): EntityUpdater` | Stable |

### Community Package -- NgRx Toolkit (`@angular-architects/ngrx-toolkit`)

| API | Import Path | Signature | Stability |
|-----|-------------|-----------|-----------|
| `withCallState` | `@angular-architects/ngrx-toolkit` | `withCallState(config?: { prop?: string; collection?: string }): SignalStoreFeature` | Community (not core NgRx) |
| `setLoading` | `@angular-architects/ngrx-toolkit` | `setLoading(prop?: string): PartialStateUpdater` | Community |
| `setLoaded` | `@angular-architects/ngrx-toolkit` | `setLoaded(prop?: string): PartialStateUpdater` | Community |
| `setError` | `@angular-architects/ngrx-toolkit` | `setError(error: unknown, prop?: string): PartialStateUpdater` | Community |

## Key Concepts

### 1. State Normalization

- **Definition**: Organizing state like a relational database: flat dictionaries keyed by ID, relationships expressed through ID references, not nested objects.
- **Canonical structure**: `{ ids: string[], entities: { [id: string]: T } }` -- used by both `@ngrx/entity` (Classic Store) and `withEntities()` (SignalStore).
- **Rule**: Normalize in effects/methods (before data enters the store), denormalize in selectors/computed (before data leaves the store for the UI).
- **When to normalize**: Collections with more than a handful of items, entities referenced from multiple places, entities that are frequently updated, many-to-many relationships.
- **When NOT to normalize**: Simple read-only data, data never shared across features, ephemeral UI state.
- **Benefit**: O(1) lookups, no data duplication, simpler immutable updates (no deep cloning of nested trees).

### 2. Derived State (Store Only What You Cannot Compute)

- **Principle**: If a value can be calculated from other state, it should be a `computed()` signal or a memoized selector, never stored directly.
- **`computed()` characteristics**: Read-only, lazy evaluation, cached, auto-invalidated when dependencies change, glitch-free reads, dynamic dependency tracking.
- **`linkedSignal()`**: For writable derived state that resets when its source changes but can be overridden locally.
- **`withComputed()` in SignalStore**: Accepts a factory returning a dictionary of computed signals; order matters (dependencies must be defined first).
- **Classic Store**: `createSelector()` provides memoized derived state.
- **Anti-pattern**: Never use `effect()` for derived state. Use `computed()` for derivation, `effect()` only for side effects (DOM, logging, localStorage).

### 3. Status Patterns (Discriminated Unions over Boolean Flags)

- **Problem**: Independent booleans (`isLoading`, `hasError`, `isSuccess`) create impossible state combinations.
- **Solution**: A single discriminated union type representing all possible states:
  ```typescript
  type CallState = 'init' | 'loading' | 'loaded' | { error: string };
  ```
- **Benefits**: Makes invalid states unrepresentable at the type level, single property controls the state machine, TypeScript narrowing works with `@switch` in templates.
- **Angular's ResourceStatus**: The `resource()` and `httpResource()` APIs use a similar enum (`Idle`, `Loading`, `Reloading`, `Resolved`, `Error`, `Local`).
- **CallState pattern**: Community standard from Angular Architects; available via `@angular-architects/ngrx-toolkit` as `withCallState()` custom SignalStore feature.
- **Named collections**: Track multiple async operations independently within one store (e.g., `flightsCallState`, `passengersCallState`).

### 4. Error State Patterns

- **Strategy A (Recommended) -- State-driven errors**: Error becomes part of the store state via `CallState`. Errors clear naturally when a new request starts. UI reads error from the store.
- **Strategy B -- Component-local errors**: Listen to failure actions in the component via `Actions` + `ofType`. Error lives locally, cleaned up on destroy. Drawback: side-effect logic in components.
- **Key principle (Alex Okrushko)**: If error becomes part of the state, it must be encompassed within a single property alongside loading state, not scattered across separate booleans.
- **Common mistake**: Forgetting to reset loading state on error, causing infinite spinners.
- **Stale errors**: Error state persisting after navigation. Fix: reset on `withHooks({ onInit })` or on new load requests.

### 5. Minimal State Principle

- Store only the irreducible minimum: raw data from the server, user selections, form inputs.
- Everything else (filtered lists, aggregations, formatting, counts, "isEmpty") should be derived.
- Example: Store `selectedCustomerId: string`, not `selectedCustomer: Customer` (avoids duplication with the entity collection).

### 6. State Shape Best Practices

- **Flat over nested**: Deep nesting forces expensive immutable update chains.
- **Feature-scoped stores**: Multiple smaller, cohesive stores rather than one monolithic global store.
- **Separation of concerns**: Domain state (`entities`), UI state (`selectedId`, `filterTerm`), and status state (`callState`) as distinct slices.
- **No view-model coupling**: Do not design store shape to match a specific component's template needs. Compose view models from selectors/computed.

## Code Patterns

### Pattern 1: Normalized State in Classic Store

```typescript
// models/order.model.ts
export interface Order {
  id: string;
  customerId: string;   // reference by ID, not nested object
  productIds: string[];  // reference by IDs
  total: number;
  status: 'pending' | 'shipped' | 'delivered';
}

// state/orders.reducer.ts
import { createEntityAdapter, EntityState } from '@ngrx/entity';
import { createReducer, on } from '@ngrx/store';
import { OrderActions } from './orders.actions';
import { Order } from '../models/order.model';

export interface OrdersState extends EntityState<Order> {
  selectedOrderId: string | null;
}

const adapter = createEntityAdapter<Order>({
  sortComparer: (a, b) => a.id.localeCompare(b.id),
});

const initialState: OrdersState = adapter.getInitialState({
  selectedOrderId: null,
});

export const ordersReducer = createReducer(
  initialState,
  on(OrderActions.loadOrdersSuccess, (state, { orders }) =>
    adapter.setAll(orders, state)
  ),
  on(OrderActions.selectOrder, (state, { orderId }) => ({
    ...state,
    selectedOrderId: orderId,
  })),
);

// Selectors that denormalize for the UI
const { selectAll, selectEntities } = adapter.getSelectors();
```

### Pattern 2: Derived State with Selectors (Classic Store)

```typescript
// state/orders.selectors.ts
import { createFeatureSelector, createSelector } from '@ngrx/store';
import { OrdersState } from './orders.reducer';

const selectOrdersState = createFeatureSelector<OrdersState>('orders');

const { selectAll, selectEntities } = adapter.getSelectors(selectOrdersState);

export const selectSelectedOrder = createSelector(
  selectEntities,
  selectOrdersState,
  (entities, state) =>
    state.selectedOrderId ? entities[state.selectedOrderId] ?? null : null
);

export const selectPendingOrders = createSelector(
  selectAll,
  (orders) => orders.filter(o => o.status === 'pending')
);

export const selectPendingCount = createSelector(
  selectPendingOrders,
  (pending) => pending.length
);
```

### Pattern 3: Normalized State in SignalStore

```typescript
// orders.store.ts
import { computed, inject } from '@angular/core';
import { signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { withEntities, setAllEntities, updateEntity, removeEntity } from '@ngrx/signals/entities';
import { Order } from '../models/order.model';
import { OrderService } from '../services/order.service';

export const OrderStore = signalStore(
  { providedIn: 'root' },
  withEntities<Order>(),
  withState({ selectedOrderId: null as string | null }),
  withComputed(store => ({
    selectedOrder: computed(() => {
      const id = store.selectedOrderId();
      return id ? store.entityMap()[id] ?? null : null;
    }),
    pendingOrders: computed(() =>
      store.entities().filter(o => o.status === 'pending')
    ),
    pendingCount: computed(() =>
      store.entities().filter(o => o.status === 'pending').length
    ),
  })),
  withMethods(store => {
    const orderService = inject(OrderService);
    return {
      selectOrder(orderId: string): void {
        patchState(store, { selectedOrderId: orderId });
      },
    };
  }),
);
```

### Pattern 4: CallState Discriminated Union (Build Your Own)

```typescript
// shared/call-state.feature.ts
import { computed } from '@angular/core';
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
    })),
  );
}
```

### Pattern 5: Using CallState in a Store

```typescript
// products.store.ts
import { computed, inject } from '@angular/core';
import { signalStore, withMethods } from '@ngrx/signals';
import { withEntities, setAllEntities } from '@ngrx/signals/entities';
import { Product } from '../models/product.model';
import { ProductService } from '../services/product.service';
import { withCallState, setLoading, setLoaded, setError } from '../shared/call-state.feature';

export const ProductStore = signalStore(
  { providedIn: 'root' },
  withEntities<Product>(),
  withCallState(),
  withMethods(store => {
    const productService = inject(ProductService);
    return {
      async loadProducts(): Promise<void> {
        patchState(store, setLoading());
        try {
          const products = await productService.getAll();
          patchState(store, setAllEntities(products), setLoaded());
        } catch (e: unknown) {
          patchState(store, setError(e instanceof Error ? e.message : 'Unknown error'));
        }
      },
    };
  }),
);
```

### Pattern 6: Template with Status Pattern (@switch)

```typescript
// products.component.ts
@Component({
  selector: 'app-products',
  template: `
    @switch (true) {
      @case (store.loading()) {
        <app-spinner />
      }
      @case (store.error()) {
        <app-error-banner [message]="store.error()!" />
      }
      @case (store.loaded()) {
        @for (product of store.entities(); track product.id) {
          <app-product-card [product]="product" />
        }
      }
      @default {
        <p>Select a category to browse products.</p>
      }
    }
  `,
})
export class ProductsComponent {
  readonly store = inject(ProductStore);
}
```

### Pattern 7: Derived State Anti-pattern vs Correct Approach

```typescript
// WRONG: Using effect() for derived state
export class PricingComponent {
  price = signal(100);
  discount = signal(0.2);
  finalPrice = signal(0); // stored, not derived

  constructor() {
    effect(() => {
      // Anti-pattern: async, can cause timing issues, no memoization
      this.finalPrice.set(this.price() * (1 - this.discount()));
    });
  }
}

// CORRECT: Using computed() for derived state
export class PricingComponent {
  price = signal(100);
  discount = signal(0.2);
  finalPrice = computed(() => this.price() * (1 - this.discount()));
  // Synchronous, memoized, glitch-free
}
```

### Pattern 8: Named CallState Collections for Multiple Async Operations

```typescript
// flight-booking.store.ts
import { signalStoreFeature, withComputed, withState } from '@ngrx/signals';
import { computed } from '@angular/core';

type CallState = 'init' | 'loading' | 'loaded' | { error: string };

export function withNamedCallState<Prop extends string>(prop: Prop) {
  return signalStoreFeature(
    withState({ [`${prop}CallState`]: 'init' as CallState }),
    withComputed((state: Record<string, unknown>) => {
      const callState = state[`${prop}CallState`] as Signal<CallState>;
      return {
        [`${prop}Loading`]: computed(() => callState() === 'loading'),
        [`${prop}Loaded`]: computed(() => callState() === 'loaded'),
        [`${prop}Error`]: computed(() => {
          const s = callState();
          return typeof s === 'object' ? s.error : null;
        }),
      };
    }),
  );
}

// Usage: track flights and passengers independently
export const BookingStore = signalStore(
  { providedIn: 'root' },
  withEntities<Flight>({ collection: 'flight' }),
  withEntities<Passenger>({ collection: 'passenger' }),
  withNamedCallState('flights'),
  withNamedCallState('passengers'),
);
```

## Breaking Changes and Gotchas

### NgRx v21 Renames
- `withEffects()` renamed to `withEventHandlers()` in `@ngrx/signals/events`. Migration schematic available. Not directly relevant to this chapter but mentioned for completeness.

### Angular 21 Zoneless Default
- Angular 21 is zoneless by default. Signals provide fine-grained reactivity without zone.js.
- `OnPush` change detection strategy is effectively the default behavior. Do not prescribe `OnPush` as an optimization.
- No `provideZoneChangeDetection()` or `provideZonelessChangeDetection()` needed in bootstrapping.

### Computed Signal Gotchas
- `computed()` is **lazy**: the derivation function does NOT run until the signal is first read. If nothing reads it, it never computes.
- `computed()` uses `Object.is()` for equality by default. For object/array values, provide a custom `equal` function to prevent unnecessary re-renders.
- Dependency tracking is **dynamic**: if a branch condition changes which signals are read, the dependency set changes accordingly.

### Entity Adapter Gotchas
- `upsertOne`/`upsertMany` replace the entire entity, not partial updates. Use `updateOne` for partial changes.
- `sortComparer` on `createEntityAdapter` affects the `ids` array ordering, which in turn affects `selectAll` ordering.
- When using `selectId`, ensure the ID property is always present and unique.

### CallState Pattern Gotchas
- **Forgotten error transition**: The most common bug is failing to transition from 'loading' to `{ error }` in the catch path, causing infinite spinners.
- **Stale error after navigation**: Error state persists if users navigate away and return. Reset error state in `withHooks({ onInit })` or when starting a new load.
- **UI flickering**: Components briefly flash error from a previous request before showing loading for new request. Fix: transition to 'loading' always clears the previous error (inherent in the CallState pattern since states are mutually exclusive).

### Anti-patterns to Highlight
1. **Boolean flag soup**: `isLoading`, `hasError`, `isSuccess` as independent booleans create impossible states.
2. **Storing derived state**: `totalCount`, `isEmpty`, `filteredItems` in the store when they can be computed.
3. **Duplicated entities**: Storing `selectedCustomer: Customer` alongside the entity collection.
4. **Using effect() for derivation**: Causes async timing issues, no memoization, possible infinite loops.
5. **Deep nesting**: Storing `order.customer.address.city` instead of normalizing to flat references.
6. **One giant global store**: Instead of feature-scoped stores with clear boundaries.
7. **View-model-shaped store**: Coupling store shape to a specific component's needs.

## Sources

### Official Documentation
- [Signals Overview -- angular.dev](https://angular.dev/guide/signals)
- [computed() API -- angular.dev](https://angular.dev/api/core/computed)
- [linkedSignal API -- angular.dev](https://angular.dev/api/core/linkedSignal)
- [ResourceStatus -- angular.dev](https://angular.dev/api/core/ResourceStatus)
- [Entity Adapter -- ngrx.io](https://ngrx.io/guide/entity/adapter)
- [Entity Interfaces -- ngrx.io](https://ngrx.io/guide/entity/interfaces)
- [Entity Management in SignalStore -- ngrx.io](https://ngrx.io/guide/signals/signal-store/entity-management)
- [Custom Store Features -- ngrx.io](https://ngrx.io/guide/signals/signal-store/custom-store-features)
- [SignalStore -- ngrx.io](https://ngrx.io/guide/signals/signal-store)
- [V21 Migration Guide -- ngrx.io](https://ngrx.io/guide/migration/v21)

### Expert Articles and Blog Posts
- [Normalizing State -- Tim Deschryver](https://timdeschryver.dev/blog/normalizing-state)
- [NgRx: How and Where to Handle Loading and Error States -- Alex Okrushko (Angular In Depth)](https://medium.com/angular-in-depth/ngrx-how-and-where-to-handle-loading-and-error-states-of-ajax-calls-6613a14f902d)
- [Stop Using isLoading Booleans -- Kent C. Dodds](https://kentcdodds.com/blog/stop-using-isloading-booleans)
- [NGRX Signal Store Deep Dive: Custom Extensions -- Angular Architects](https://www.angulararchitects.io/en/blog/ngrx-signal-store-deep-dive-flexible-and-type-safe-custom-extensions/)
- [Smarter Not Harder: Custom SignalStore Features -- Angular Architects](https://www.angulararchitects.io/blog/smarter-not-harder-simplifying-your-application-with-ngrx-signal-store-and-custom-features/)
- [The New NgRx Signal Store: Patterns for Architecture -- Angular Architects](https://www.angulararchitects.io/en/the-new-ngrx-signal-store-paterns-for-your-architecture/)
- [withCallState() -- NgRx Toolkit Docs](https://ngrx-toolkit.angulararchitects.io/docs/with-call-state)
- [Stop Misusing Effects! Linked Signals Are the Better Alternative -- Angular Experts](https://angularexperts.io/blog/stop-misusing-effects/)
- [Angular Signals Effect(): Why 90% of Developers Use It Wrong -- dev.to](https://dev.to/codewithrajat/angular-signals-effect-why-90-of-developers-use-it-wrong-4pl4)
- [Angular State Management for 2025 -- Nx Blog](https://nx.dev/blog/angular-state-management-2025)

### Community Patterns and Anti-patterns
- [Top 5 NgRx Mistakes -- Christian Lydemann](https://christianlydemann.com/top-5-ngrx-mistakes/)
- [3 Ways You're Using NgRx Wrong -- Briebug](https://blog.briebug.com/blog/3-ways-youre-using-ngrx-wrong)
- [State Management Anti-Patterns -- Source Allies](https://www.sourceallies.com/2020/11/state-management-anti-patterns/)
- [Better Loading and Error-handling in Angular -- Eyas Sharaiha](https://blog.eyas.sh/2020/05/better-loading-and-error-handling-in-angular/)
- [A Single State for Loading/Success/Error in NgRx -- Yura Khomitsky](https://medium.com/@yura.khomitsky8/a-single-state-for-loading-success-error-in-ngrx-e50c5d782478)
- [Handling Error States with NgRx -- Angular In Depth](https://medium.com/angular-in-depth/handling-error-states-with-ngrx-6b16f6d12a08)
- [Handle API Call State Nicely -- Angular In Depth](https://medium.com/angular-in-depth/handle-api-call-state-nicely-445ab37cc9f8)

### Architecture Guides
- [Angular Architecture Patterns and Best Practices -- dev-academy.com](https://dev-academy.com/angular-architecture-best-practices/)
- [Normalizing State Shape -- Redux Docs](https://redux.js.org/usage/structuring-reducers/normalizing-state-shape)
- [Angular Best Practices 2026: The Architect's Playbook -- One Horizon](https://onehorizon.ai/blog/angular-best-practices-2026-the-architects-playbook)

### GitHub Issues and RFCs
- [Feature Request: withCallState in core @ngrx/signals -- ngrx/platform #4707](https://github.com/ngrx/platform/issues/4707)
- [RFC: Selectable Entities by Default -- ngrx/platform Discussion #4722](https://github.com/ngrx/platform/discussions/4722)
- [httpResource DX Improvements and Error Handling -- angular/angular #61789](https://github.com/angular/angular/issues/61789)
- [PSA: Angular v21 and NgRx v21 -- ngrx/platform #5005](https://github.com/ngrx/platform/issues/5005)

## Open Questions

1. **`withCallState` in core NgRx**: There is an open feature request (ngrx/platform #4707) to add `withCallState` to core `@ngrx/signals`. Verify whether this has landed in v21.1.x before the chapter goes to print. As of research date, it remains in `@angular-architects/ngrx-toolkit` only.

2. **Selectable entities**: There is an RFC (ngrx/platform #4722) about adding `selectEntity` as a default feature of `withEntities`. Verify current status before writing.

3. **Named CallState type safety**: The typed mapped types approach for named collections (`flightsCallState`, `passengersCallState`) works well in practice but the exact generic type signatures in `@angular-architects/ngrx-toolkit` should be verified against the latest package version before including in the chapter.

4. **Angular 21 `linkedSignal` overloads**: Verify exact overload signatures (shorthand vs options object form) against angular.dev before including in the derived state section.
