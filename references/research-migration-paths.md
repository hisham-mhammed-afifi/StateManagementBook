# Research: Migration Paths -- Classic Store and ComponentStore to SignalStore

**Date:** 2026-04-01
**Chapter:** Ch 22
**Status:** Ready for chapter generation

## API Surface

### SignalStore Core (from `@ngrx/signals`)

| API | Import Path | Stability |
|-----|-------------|-----------|
| `signalStore` | `@ngrx/signals` | Stable |
| `withState` | `@ngrx/signals` | Stable |
| `withComputed` | `@ngrx/signals` | Stable |
| `withMethods` | `@ngrx/signals` | Stable |
| `withHooks` | `@ngrx/signals` | Stable |
| `withProps` | `@ngrx/signals` | Stable |
| `patchState` | `@ngrx/signals` | Stable |
| `getState` | `@ngrx/signals` | Stable |
| `signalStoreFeature` | `@ngrx/signals` | Stable |
| `signalMethod` | `@ngrx/signals` | Stable |
| `type` | `@ngrx/signals` | Stable |

### RxJS Interop (from `@ngrx/signals/rxjs-interop`)

| API | Import Path | Stability |
|-----|-------------|-----------|
| `rxMethod` | `@ngrx/signals/rxjs-interop` | Stable |

### Entities (from `@ngrx/signals/entities`)

| API | Import Path | Stability |
|-----|-------------|-----------|
| `withEntities` | `@ngrx/signals/entities` | Stable |
| `setAllEntities`, `setEntities`, `setEntity` | `@ngrx/signals/entities` | Stable |
| `addEntity`, `addEntities`, `prependEntity` | `@ngrx/signals/entities` | Stable |
| `updateEntity`, `updateEntities`, `updateAllEntities` | `@ngrx/signals/entities` | Stable |
| `removeEntity`, `removeEntities`, `removeAllEntities` | `@ngrx/signals/entities` | Stable |
| `upsertEntity`, `upsertEntities` | `@ngrx/signals/entities` | Stable |
| `entityConfig` | `@ngrx/signals/entities` | Stable |

### Events Plugin (from `@ngrx/signals/events`)

| API | Import Path | Stability |
|-----|-------------|-----------|
| `eventGroup` | `@ngrx/signals/events` | Stable (promoted from experimental in v21) |
| `withReducer` | `@ngrx/signals/events` | Stable |
| `on` | `@ngrx/signals/events` | Stable |
| `withEventHandlers` | `@ngrx/signals/events` | Stable (renamed from `withEffects` in v21) |
| `Events` | `@ngrx/signals/events` | Stable |
| `injectDispatch` | `@ngrx/signals/events` | Stable |
| `provideDispatcher` | `@ngrx/signals/events` | Stable |

### Shared Operators (from `@ngrx/operators`)

| API | Import Path | Stability |
|-----|-------------|-----------|
| `tapResponse` | `@ngrx/operators` | Stable |
| `mapResponse` | `@ngrx/operators` | Stable |

### ComponentStore (from `@ngrx/component-store`) -- Source APIs being migrated from

| API | Import Path | Status |
|-----|-------------|--------|
| `ComponentStore` class | `@ngrx/component-store` | Not officially deprecated, but superseded by SignalStore |
| `tapResponse` re-export | `@ngrx/component-store` | Deprecated in v20; use `@ngrx/operators` instead |
| `provideComponentStore` | `@ngrx/component-store` | Active but superseded |

### Classic Store (from `@ngrx/store`, `@ngrx/effects`, `@ngrx/entity`) -- Source APIs being migrated from

| API | Import Path | Status |
|-----|-------------|--------|
| `Store`, `createAction`, `createReducer`, `on`, `props`, `emptyProps` | `@ngrx/store` | Stable, actively maintained |
| `createActionGroup`, `createFeature`, `createFeatureSelector`, `createSelector` | `@ngrx/store` | Stable |
| `Actions`, `ofType`, `createEffect`, `provideEffects` | `@ngrx/effects` | Stable |
| `EntityAdapter`, `createEntityAdapter` | `@ngrx/entity` | Stable |

## Key Concepts

### Three Migration Paths

1. **ComponentStore to SignalStore** -- The most natural migration. Both are local/component-level stores. API surface maps closely: `updater` -> `withMethods` + `patchState`, `select` -> auto-signals + `withComputed`, `effect` -> `rxMethod`.

2. **Classic Store to SignalStore (Method-Driven)** -- Drop Redux boilerplate entirely. Actions become direct method calls, reducers become `patchState` calls inside methods, selectors become computed signals, effects become `rxMethod` inside `withMethods`.

3. **Classic Store to SignalStore (Event-Driven via Events Plugin)** -- Preserve action/reducer/effect separation using the Events Plugin. `createActionGroup` -> `eventGroup`, `createReducer` + `on` -> `withReducer` + `on`, `createEffect` -> `withEventHandlers`.

### Migration Strategy: Incremental (Recommended)

- **Coexistence is fully supported.** Classic Store, ComponentStore, and SignalStore can live side by side.
- **New features use SignalStore.** All greenfield development should use `signalStore()`.
- **Migrate on enhancement.** When significantly modifying an existing feature, evaluate migration.
- **Do not migrate stable, well-tested code** purely for the sake of using new technology.

### ComponentStore Deprecation Status

- ComponentStore is **NOT officially deprecated** as of NgRx 21.
- The NgRx team has signaled that SignalStore **supersedes** ComponentStore.
- No formal deprecation date has been announced.
- ComponentStore continues to receive version-aligned releases.
- The `tapResponse` re-export from `@ngrx/component-store` was deprecated in v20; it must now be imported from `@ngrx/operators`.

## Code Patterns

### Pattern 1: ComponentStore to SignalStore

**Before (ComponentStore):**
```typescript
// products.store.ts
import { Injectable } from '@angular/core';
import { ComponentStore } from '@ngrx/component-store';
import { tapResponse } from '@ngrx/component-store'; // deprecated import
import { switchMap, tap } from 'rxjs';

interface ProductsState {
  products: Product[];
  loading: boolean;
  error: string | null;
}

@Injectable()
export class ProductsStore extends ComponentStore<ProductsState> {
  constructor(private productsService: ProductsService) {
    super({ products: [], loading: false, error: null });
  }

  // Selectors (return Observables)
  readonly products$ = this.select(s => s.products);
  readonly loading$ = this.select(s => s.loading);
  readonly productCount$ = this.select(this.products$, p => p.length);

  // Updaters
  readonly setLoading = this.updater((state, loading: boolean) => ({
    ...state, loading
  }));

  readonly setProducts = this.updater((state, products: Product[]) => ({
    ...state, products, loading: false, error: null
  }));

  // Effects
  readonly loadProducts = this.effect<void>(trigger$ =>
    trigger$.pipe(
      tap(() => this.setLoading(true)),
      switchMap(() => this.productsService.getAll().pipe(
        tapResponse(
          products => this.setProducts(products),
          error => this.patchState({ error: String(error), loading: false })
        )
      ))
    )
  );
}
```

**After (SignalStore):**
```typescript
// products.store.ts
import { computed, inject } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { tapResponse } from '@ngrx/operators';
import { pipe, switchMap, tap } from 'rxjs';

interface ProductsState {
  products: Product[];
  loading: boolean;
  error: string | null;
}

const initialState: ProductsState = {
  products: [],
  loading: false,
  error: null,
};

export const ProductsStore = signalStore(
  withState(initialState),
  withComputed(({ products }) => ({
    productCount: computed(() => products().length),
  })),
  withMethods((store, productsService = inject(ProductsService)) => ({
    setLoading(loading: boolean): void {
      patchState(store, { loading });
    },
    loadProducts: rxMethod<void>(
      pipe(
        tap(() => patchState(store, { loading: true })),
        switchMap(() => productsService.getAll().pipe(
          tapResponse({
            next: (products) => patchState(store, { products, loading: false, error: null }),
            error: (e) => patchState(store, { error: String(e), loading: false }),
          })
        ))
      )
    ),
  }))
);
```

### Pattern 2: Classic Store to SignalStore (Method-Driven)

**Before (Classic Store -- 4 files):**
```typescript
// products.actions.ts
import { createActionGroup, props, emptyProps } from '@ngrx/store';

export const ProductsActions = createActionGroup({
  source: 'Products',
  events: {
    'Load Products': emptyProps(),
    'Load Products Success': props<{ products: Product[] }>(),
    'Load Products Failure': props<{ error: string }>(),
  },
});

// products.reducer.ts
import { createReducer, on } from '@ngrx/store';

export const productsReducer = createReducer(
  initialState,
  on(ProductsActions.loadProducts, (state) => ({ ...state, loading: true })),
  on(ProductsActions.loadProductsSuccess, (state, { products }) => ({
    ...state, products, loading: false,
  })),
  on(ProductsActions.loadProductsFailure, (state, { error }) => ({
    ...state, error, loading: false,
  })),
);

// products.selectors.ts
import { createFeatureSelector, createSelector } from '@ngrx/store';

export const selectProductsState = createFeatureSelector<ProductsState>('products');
export const selectProducts = createSelector(selectProductsState, s => s.products);
export const selectLoading = createSelector(selectProductsState, s => s.loading);
export const selectProductCount = createSelector(selectProducts, p => p.length);

// products.effects.ts
import { createEffect } from '@ngrx/effects';

export const loadProducts = createEffect(
  (actions$ = inject(Actions), service = inject(ProductsService)) =>
    actions$.pipe(
      ofType(ProductsActions.loadProducts),
      exhaustMap(() => service.getAll().pipe(
        map(products => ProductsActions.loadProductsSuccess({ products })),
        catchError(e => of(ProductsActions.loadProductsFailure({ error: String(e) })))
      ))
    ),
  { functional: true }
);
```

**After (SignalStore -- 1 file):**
```typescript
// products.store.ts
import { computed, inject } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { tapResponse } from '@ngrx/operators';
import { pipe, exhaustMap, tap } from 'rxjs';

export const ProductsStore = signalStore(
  { providedIn: 'root' },
  withState<ProductsState>({ products: [], loading: false, error: null }),
  withComputed(({ products }) => ({
    productCount: computed(() => products().length),
  })),
  withMethods((store, productsService = inject(ProductsService)) => ({
    loadProducts: rxMethod<void>(
      pipe(
        tap(() => patchState(store, { loading: true })),
        exhaustMap(() => productsService.getAll().pipe(
          tapResponse({
            next: (products) => patchState(store, { products, loading: false, error: null }),
            error: (e) => patchState(store, { error: String(e), loading: false }),
          })
        ))
      )
    ),
  }))
);
```

### Pattern 3: Classic Store to SignalStore (Event-Driven)

**After (SignalStore with Events Plugin -- 2 files):**
```typescript
// products.events.ts
import { eventGroup } from '@ngrx/signals/events';
import { type } from '@ngrx/signals';

export const productsEvents = eventGroup({
  source: 'Products',
  events: {
    loadProducts: type<void>(),
    loadProductsSuccess: type<{ products: Product[] }>(),
    loadProductsFailure: type<{ error: string }>(),
  },
});

// products.store.ts
import { computed, inject } from '@angular/core';
import { signalStore, withState, withComputed, patchState } from '@ngrx/signals';
import { withReducer, on, withEventHandlers, Events } from '@ngrx/signals/events';
import { mapResponse } from '@ngrx/operators';
import { exhaustMap } from 'rxjs';

export const ProductsStore = signalStore(
  { providedIn: 'root' },
  withState<ProductsState>({ products: [], loading: false, error: null }),
  withComputed(({ products }) => ({
    productCount: computed(() => products().length),
  })),
  withReducer(
    on(productsEvents.loadProducts, () => ({ loading: true })),
    on(productsEvents.loadProductsSuccess, ({ payload }) => ({
      products: payload.products, loading: false, error: null,
    })),
    on(productsEvents.loadProductsFailure, ({ payload }) => ({
      error: payload.error, loading: false,
    })),
  ),
  withEventHandlers(
    (store, events = inject(Events), service = inject(ProductsService)) => ({
      loadProducts$: events.on(productsEvents.loadProducts).pipe(
        exhaustMap(() => service.getAll().pipe(
          mapResponse({
            next: (products) => productsEvents.loadProductsSuccess({ products }),
            error: (e) => productsEvents.loadProductsFailure({ error: String(e) }),
          })
        ))
      ),
    })
  ),
);
```

### Pattern 4: Entity Migration (@ngrx/entity to @ngrx/signals/entities)

**Before (Classic entity adapter):**
```typescript
// products.reducer.ts
import { createEntityAdapter, EntityState } from '@ngrx/entity';

export interface ProductsState extends EntityState<Product> {
  loading: boolean;
}

const adapter = createEntityAdapter<Product>();
const initialState: ProductsState = adapter.getInitialState({ loading: false });

export const productsReducer = createReducer(
  initialState,
  on(ProductsActions.loadProductsSuccess, (state, { products }) =>
    adapter.setAll(products, { ...state, loading: false })
  ),
  on(ProductsActions.addProduct, (state, { product }) =>
    adapter.addOne(product, state)
  ),
  on(ProductsActions.removeProduct, (state, { id }) =>
    adapter.removeOne(id, state)
  ),
);

// products.selectors.ts
const { selectAll, selectTotal } = adapter.getSelectors(selectProductsState);
export { selectAll as selectAllProducts, selectTotal as selectProductTotal };
```

**After (SignalStore entities):**
```typescript
// products.store.ts
import { computed, inject } from '@angular/core';
import { signalStore, withComputed, withMethods, patchState } from '@ngrx/signals';
import {
  withEntities, setAllEntities, addEntity, removeEntity
} from '@ngrx/signals/entities';

export const ProductsStore = signalStore(
  withEntities<Product>(),
  withComputed(({ entities }) => ({
    productCount: computed(() => entities().length),
  })),
  withMethods((store) => ({
    setProducts(products: Product[]): void {
      patchState(store, setAllEntities(products));
    },
    addProduct(product: Product): void {
      patchState(store, addEntity(product));
    },
    removeProduct(id: number): void {
      patchState(store, removeEntity(id));
    },
  }))
);
```

### Pattern 5: Component Template Migration

**Before (Classic Store in component):**
```typescript
// products.component.ts
@Component({
  template: `
    @if (loading$ | async) {
      <loading-spinner />
    }
    @for (product of products$ | async; track product.id) {
      <product-card [product]="product" />
    }
  `,
})
export class ProductsComponent {
  private store = inject(Store);
  products$ = this.store.select(selectProducts);
  loading$ = this.store.select(selectLoading);

  ngOnInit() {
    this.store.dispatch(ProductsActions.loadProducts());
  }
}
```

**After (SignalStore in component):**
```typescript
// products.component.ts
@Component({
  providers: [ProductsStore], // or omit if providedIn: 'root'
  template: `
    @if (store.loading()) {
      <loading-spinner />
    }
    @for (product of store.products(); track product.id) {
      <product-card [product]="product" />
    }
  `,
})
export class ProductsComponent {
  readonly store = inject(ProductsStore);

  constructor() {
    this.store.loadProducts();
  }
}
```

### Pattern 6: ComponentStore Lifecycle to SignalStore withHooks

**Before (ComponentStore):**
```typescript
@Injectable()
export class ProductsStore extends ComponentStore<ProductsState> implements OnStoreInit, OnStoreDestroy {
  ngrxOnStoreInit() {
    this.loadProducts();
  }

  ngrxOnStoreDestroy() {
    console.log('Store destroyed');
  }
}
```

**After (SignalStore):**
```typescript
export const ProductsStore = signalStore(
  withState(initialState),
  withMethods((store, service = inject(ProductsService)) => ({
    loadProducts: rxMethod<void>(/* ... */),
  })),
  withHooks({
    onInit(store) {
      store.loadProducts();
    },
    onDestroy() {
      console.log('Store destroyed');
    },
  })
);
```

## Complete API Mapping Tables

### ComponentStore -> SignalStore

| ComponentStore API | SignalStore Equivalent | Notes |
|---|---|---|
| `extends ComponentStore<State>` | `signalStore(withState<State>(initialState))` | Class-based vs functional factory |
| `constructor() { super(initialState) }` | `withState(initialState)` | State init moves to `withState` |
| `this.state$` (Observable) | `getState(store)` or individual signal properties | Each root property becomes a signal automatically |
| `this.select(fn)` | Auto-generated signals + `withComputed()` | Root properties are signals automatically; derived state uses `computed()` |
| `this.select(s => s.prop)` | `store.prop()` (auto-signal) | No explicit selector needed for root properties |
| `this.select(obs1$, obs2$, combinerFn)` | `withComputed(() => ({ derived: computed(() => ...) }))` | Combiner selectors become `computed` signals |
| `this.selectSignal(fn)` | `store.prop()` (auto-signal) | Direct equivalent |
| `this.setState(newState)` | `patchState(store, newState)` | `patchState` accepts partial state |
| `this.setState(fn)` | `patchState(store, (state) => ...)` | Callback form supported |
| `this.patchState(partial)` | `patchState(store, partial)` | Nearly identical API |
| `this.updater(fn)` | Method inside `withMethods()` calling `patchState` | No direct `updater` factory |
| `this.effect(fn)` (RxJS-based) | `rxMethod<T>(pipe(...))` inside `withMethods()` | Import from `@ngrx/signals/rxjs-interop` |
| `this.effect(fn)` (simple) | `signalMethod<T>(processorFn)` inside `withMethods()` | For non-RxJS side effects |
| `tapResponse` from `@ngrx/component-store` | `tapResponse` from `@ngrx/operators` | Import path changed |
| `provideComponentStore(MyStore)` | `providers: [MyStore]` or `signalStore({ providedIn: 'root' })` | Scoping via DI |
| `OnStoreInit` / `OnStoreDestroy` | `withHooks({ onInit, onDestroy })` | Lifecycle hooks |

### Classic Store -> SignalStore

| Classic Store Concept | SignalStore Equivalent | Notes |
|---|---|---|
| `createAction` / `createActionGroup` | Direct method calls OR `eventGroup()` | Two approaches available |
| `createReducer()` + `on()` | `patchState()` in methods OR `withReducer()` + `on()` | Method-driven or event-driven |
| `createSelector` / `createFeatureSelector` | Auto-signals + `withComputed()` | Root properties auto-signal |
| `createEffect` / functional effects | `rxMethod()` in methods OR `withEventHandlers()` | Method-driven or event-driven |
| `Actions` service + `ofType()` | `Events` service + `.on(event)` | Events Plugin only |
| `Store.dispatch(action)` | `store.method()` OR `injectDispatch(eventGroup)` | Depends on approach |
| `Store.select(selector)` (Observable) | `store.prop()` (Signal) | Signals replace Observables |
| `StoreModule.forRoot()` / `provideStore()` | `signalStore({ providedIn: 'root' })` | No module registration |
| `StoreModule.forFeature()` / `provideState()` | Component/route-level `providers: [MyStore]` | Feature isolation via DI |
| `EffectsModule.forRoot()` / `provideEffects()` | Built into `withMethods` or `withEventHandlers` | No separate registration |
| Meta-reducers | Custom `signalStoreFeature()` or `withHooks` | No direct equivalent |
| `@ngrx/store-devtools` | `withDevtools()` from `@angular-architects/ngrx-toolkit` | Community package |
| `@ngrx/router-store` | Angular Router signal APIs directly | No direct equivalent |

### Entity API Mapping (@ngrx/entity -> @ngrx/signals/entities)

| @ngrx/entity (Classic) | @ngrx/signals/entities | Notes |
|---|---|---|
| `createEntityAdapter<T>()` | `withEntities<T>()` | Feature-level, no adapter factory needed |
| `adapter.getInitialState()` | Automatic via `withEntities` | Creates `entityMap`, `ids`, `entities` signals |
| `adapter.addOne(entity, state)` | `patchState(store, addEntity(entity))` | Functional updater |
| `adapter.addMany(entities, state)` | `patchState(store, addEntities(entities))` | Functional updater |
| `adapter.setAll(entities, state)` | `patchState(store, setAllEntities(entities))` | Functional updater |
| `adapter.setOne(entity, state)` | `patchState(store, setEntity(entity))` | Add or replace |
| `adapter.updateOne({id, changes})` | `patchState(store, updateEntity({id, changes}))` | Supports callback for changes |
| `adapter.updateMany(updates)` | `patchState(store, updateEntities({ids, changes}))` | Also supports predicate |
| `adapter.removeOne(id)` | `patchState(store, removeEntity(id))` | Direct equivalent |
| `adapter.removeMany(ids)` | `patchState(store, removeEntities(ids))` | Also supports predicate |
| `adapter.removeAll()` | `patchState(store, removeAllEntities())` | Direct equivalent |
| `adapter.upsertOne(entity)` | `patchState(store, upsertEntity(entity))` | Added in v20 |
| `adapter.upsertMany(entities)` | `patchState(store, upsertEntities(entities))` | Added in v20 |
| No equivalent | `patchState(store, prependEntity(entity))` | New: adds to beginning |
| No equivalent | `patchState(store, updateAllEntities({changes}))` | New: update every entity |
| `adapter.getSelectors()` | Auto-generated: `store.entities()`, `store.entityMap()`, `store.ids()` | No selector factory needed |
| `selectId` option | `entityConfig({ entity: type<T>(), selectId })` | Reusable config object |

### APIs with No Direct SignalStore Equivalent

| API | Recommended Approach |
|---|---|
| Meta-reducers | Custom `signalStoreFeature()` for cross-cutting concerns; `withHooks({ onInit })` for init-time logic |
| `@ngrx/router-store` | Use Angular Router's signal-based APIs directly |
| `@ngrx/store-devtools` | Use `withDevtools()` from `@angular-architects/ngrx-toolkit` |
| `ComponentStore.state$` (Observable of full state) | `getState(store)` for snapshot; `toObservable()` from `@angular/core/rxjs-interop` for individual signals |
| `vm$` pattern (combined Observable) | Not needed; signals compose naturally in templates |
| `resubscribeOnError` (ComponentStore effect config) | Handle error recovery manually in `rxMethod` pipes or use `tapResponse`/`mapResponse` |
| Functional standalone effects (`createEffect` outside store) | Use store-level `withEventHandlers` or standalone services with `rxMethod` |

## Breaking Changes and Gotchas

### NgRx v21 Breaking Changes

1. **`withEffects` renamed to `withEventHandlers`** in `@ngrx/signals/events`. Migration schematic available via `ng update @ngrx/signals@21`. The schematic automatically renames imports and usages.

2. **Events Plugin promoted to stable** from experimental status (was experimental since v19). No API stability label needed.

3. **Scoped Events** added in v21: `provideDispatcher()` and `injectDispatch()` support `'self'`, `'parent'`, and `'global'` scope for event isolation.

### NgRx v20 Changes (Still Relevant)

4. **`tapResponse` moved** from `@ngrx/component-store` to `@ngrx/operators`. The `@ngrx/component-store` re-export is deprecated. Migration schematic: `ng update @ngrx/component-store@20`.

5. **`tapResponse` signature change**: Deprecated callback-based form `tapResponse(nextFn, errorFn)` replaced by observer object form `tapResponse({ next, error })`. Migration schematic: `ng update @ngrx/store@20`.

6. **`mapResponse`** operator added in `@ngrx/operators` for use in event handlers (maps to events instead of side-effecting).

### Available Migration Schematics

| Command | What It Does |
|---|---|
| `ng update @ngrx/signals@21` | Renames `withEffects` to `withEventHandlers` |
| `ng update @ngrx/store@20` | Migrates `tapResponse` signature to observer object form |
| `ng update @ngrx/component-store@20` | Migrates `tapResponse` import to `@ngrx/operators` |

**No automated schematic exists** for migrating from Classic Store to SignalStore or from ComponentStore to SignalStore. These are architectural migrations requiring manual, feature-by-feature work.

### Common Pitfalls

1. **Attempting to override store features**: SignalStore uses composition over inheritance. Features cannot be overridden like class properties. Design features as composable units using `signalStoreFeature()`.

2. **Mutating state directly**: State is immutable. Since v19, `Object.freeze` is applied recursively. Direct mutations silently fail or throw in strict mode. Always use `patchState()`.

3. **Using withMethods for selector-like logic**: Derived/computed state belongs in `withComputed()`, not `withMethods()`. Misplacing it prevents memoization and signal dependency tracking.

4. **Not separating service logic from store logic**: HTTP calls and business logic should live in dedicated services. The store should orchestrate, not implement.

5. **Confusing withState vs withProps**: `withState()` creates reactive, deeply frozen signal state tracked by `patchState()`. `withProps()` creates properties NOT managed by `patchState()`. Use `withProps()` for injected services, observables, or non-state properties.

6. **Feature ordering in signalStore()**: Features execute in declaration order. If `withHooks()` needs a method from `withMethods()`, the `withMethods()` call must come first.

7. **Over-migrating stable code**: The biggest strategic mistake is migrating well-tested Classic Store code purely for technology novelty. Community consensus: if it works and is well-tested, leave it alone.

8. **One-to-one mapping of feature slices**: Do not blindly map each Classic Store feature slice to one SignalStore. SignalStores should follow single responsibility; split large slices into focused stores.

9. **Forgetting the `tapResponse` import change**: The `@ngrx/component-store` re-export is deprecated. Must use `@ngrx/operators`.

10. **Ignoring the `on()` return type difference**: In Classic Store's `on()`, you return the full state. In Events Plugin's `on()`, you return a partial state (like `patchState`).

## Sources

### Official Documentation
- [NgRx V21 Migration Guide](https://ngrx.io/guide/migration/v21)
- [NgRx V20 Migration Guide](https://ngrx.io/guide/migration/v20)
- [NgRx SignalStore Official Guide](https://ngrx.io/guide/signals/signal-store)
- [NgRx Events Plugin Documentation](https://ngrx.io/guide/signals/signal-store/events)
- [NgRx SignalStore Lifecycle Hooks](https://ngrx.io/guide/signals/signal-store/lifecycle-hooks)
- [NgRx ComponentStore Documentation](https://ngrx.io/guide/component-store)
- [NgRx Entity Management (SignalStore)](https://ngrx.io/guide/signals/signal-store/entity-management)
- [NgRx Operators (tapResponse)](https://ngrx.io/guide/operators/operators)
- [NgRx signalMethod Guide](https://ngrx.io/guide/signals/signal-method)
- [NgRx Entity Adapter (Classic)](https://ngrx.io/guide/entity/adapter)

### Blog Posts and Articles
- [Announcing NgRx v20 (DEV Community)](https://dev.to/ngrx/announcing-ngrx-v20-the-power-of-events-enhanced-dx-and-a-mature-signalstore-2fdm)
- [Announcing NgRx 21 (DEV Community)](https://dev.to/ngrx/announcing-ngrx-21-celebrating-a-10-year-journey-with-a-fresh-new-look-and-ngrxsignalsevents-5ekp)
- [From NgRx ComponentStore to SignalStore (Angular Addicts)](https://www.angularaddicts.com/p/from-ngrx-componentstore-to-signalstore)
- [NgRx: From Classic Store to Signal Store (Fabio Cabiddu, Medium)](https://medium.com/@fabio.cabi/ngrx-from-the-classic-store-to-the-signal-store-what-changes-for-angular-developers-816c8d05f18d)
- [The NGRX Signal Store and Your Architecture (Angular Architects)](https://www.angulararchitects.io/blog/the-ngrx-signal-store-and-your-architecture/)
- [The New Event API in NgRx Signal Store (Angular Architects)](https://www.angulararchitects.io/blog/the-new-event-api-in-ngrx-signal-store/)
- [Migration to Signals, Signal Forms, Resource API, and NgRx Signal Store (Manfred Steyer, Speaker Deck, March 2026)](https://speakerdeck.com/manfredsteyer/2026-munich)
- [Angular State Management for 2025 (Nx Blog)](https://nx.dev/blog/angular-state-management-2025)
- [Migrating from NgRx Observable Store to Signal Store (Pierre Machaux, Medium)](https://medium.com/@pierre.machaux/migrating-from-ngrx-observable-store-to-the-new-signal-store-d3657c72ffad)
- [Comparing Angular State Management: NgRx Classic vs SignalStore vs Events Plugin (Offering Solutions)](https://offering.solutions/blog/articles/2025/05/13/comparing-angular-state-management-ngrx-classic-signal-store-and-the-events-plugin/)
- [Event-Driven State Management with NgRx Signal Store (Dimeloper, DEV)](https://dev.to/dimeloper/event-driven-state-management-with-ngrx-signal-store-j8i)
- [Enhancing Side Effects with NgRx signalMethod (Daniel Sogl, Medium)](https://danielsogl.medium.com/enhancing-side-effects-in-angular-with-ngrxs-signalmethod-54877e757686)
- [SignalStore Complete Guide (Stefanos Lignos)](https://www.stefanos-lignos.dev/posts/ngrx-signals-store)

### GitHub Issues and RFCs
- [Issue #5010: Migration Schematic for withEventHandlers](https://github.com/ngrx/platform/issues/5010)
- [Issue #4976: Rename withEffects to withEventHandlers](https://github.com/ngrx/platform/issues/4976)
- [Issue #5017: v21 Migration Guide](https://github.com/ngrx/platform/issues/5017)
- [Discussion #4664: SignalStore V19 Breaking Changes](https://github.com/ngrx/platform/discussions/4664)
- [Discussion #4520: SignalStore Members Cannot Be Overridden](https://github.com/ngrx/platform/discussions/4520)

## Open Questions

1. **Exact `injectDispatch` signature and scoped events API**: The scoped events feature in v21 is new. Verify the exact API for `provideDispatcher()` scope options and `injectDispatch()` usage against the installed package before writing the chapter.

2. **`signalMethod` vs `rxMethod` guidance**: The chapter should clarify when to use `signalMethod` (non-RxJS side effects) vs `rxMethod` (RxJS pipelines) during migration. Verify `signalMethod` accepts computation functions in v21.

3. **DevTools integration path**: Verify whether `@angular-architects/ngrx-toolkit` `withDevtools()` is still the recommended path or if NgRx has added built-in devtools support for SignalStore in v21. The Chapter 15 research may have covered this.

4. **`mapResponse` vs `tapResponse` in event handlers**: Clarify the guidance on when to use `mapResponse` (returns events) vs `tapResponse` (side-effects) in `withEventHandlers`. The chapter should give clear guidance since this is a common confusion point during migration.

5. **Partial state return in Events Plugin `on()`**: Verify that the `on()` handler in `withReducer` returns partial state (like `patchState`) rather than full state (like Classic Store's `on()`). This is a subtle but critical difference that will trip up migrating developers.
