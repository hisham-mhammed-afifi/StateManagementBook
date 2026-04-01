# Chapter 22: Migration Paths -- Classic Store and ComponentStore to SignalStore

Your team adopted NgRx Classic Store three years ago. Dozens of feature slices, hundreds of actions, thousands of lines of reducer and effect code power the product catalog, shopping cart, order management, and user preferences. It all works. The tests pass. The DevTools show clean event logs. But new features take longer to ship because every feature demands four files: actions, reducer, selectors, and effects. Meanwhile, the team that owns the dashboard module adopted `ComponentStore` two years ago and moves faster, but their stores lack DevTools support and they rely on patterns the rest of the company does not recognize. Now the organization wants to standardize on SignalStore. The question is not whether to migrate, but how to do it without breaking production, without rewriting everything at once, and without losing the architectural benefits each approach already provides.

This chapter walks through three migration paths: ComponentStore to SignalStore, Classic Store to SignalStore using the method-driven approach, and Classic Store to SignalStore using the Events Plugin to preserve Redux-style separation. We will migrate a real product catalog feature end to end, covering state, computed values, side effects, entity management, and component templates.

## A Quick Recap

SignalStore (Chapters 15 through 20) is a functional, composable store built on Angular signals. `withState` declares reactive state. `withComputed` derives values. `withMethods` exposes operations. `withEntities` normalizes collections. `withHooks` manages lifecycle. `withEventHandlers` and `eventGroup` enable event-driven flows. `rxMethod` bridges RxJS pipelines.

ComponentStore (from `@ngrx/component-store`) is a class-based, component-scoped store built on RxJS. It uses `this.select()` for derived state, `this.updater()` for state mutations, and `this.effect()` for side effects.

Classic Store (from `@ngrx/store`, `@ngrx/effects`, `@ngrx/entity`) follows the Redux pattern: actions describe what happened, reducers produce new state, selectors read state, and effects handle side effects.

All three can coexist in the same application. Angular's dependency injection system does not care whether a service is a class extending `ComponentStore`, a global Redux store, or a `signalStore()` factory result. This coexistence is the foundation of every migration strategy in this chapter.

## The Migration Strategy: Incremental, Not Big-Bang

Before touching any code, establish the rules your team will follow:

1. **New features use SignalStore.** Every greenfield feature, starting today, uses `signalStore()`. No new `ComponentStore` classes. No new Classic Store feature slices.
2. **Existing code stays until you touch it.** A working, tested Classic Store feature slice does not need migration. Migrate only when you are already making significant changes to a feature.
3. **Migrate one feature at a time.** Never migrate multiple features in a single pull request. Each migration is its own commit, its own review, its own deployment.
4. **Keep tests green throughout.** If the existing tests cover the feature's behavior, write the SignalStore version, point the component at it, and verify that all existing tests pass before deleting the old code.

This incremental approach avoids the "rewrite" trap where teams spend months migrating code that already works, introducing regressions along the way.

## Path 1: ComponentStore to SignalStore

ComponentStore is the most natural starting point because both ComponentStore and SignalStore serve the same purpose: component-scoped state management. The API mapping is nearly one-to-one.

### The Rosetta Stone

| ComponentStore | SignalStore | Notes |
|---|---|---|
| `extends ComponentStore<State>` | `signalStore(withState(initialState))` | Class to factory function |
| `this.select(fn)` | Auto-generated signals or `withComputed()` | No explicit selector needed for root properties |
| `this.updater(fn)` | Method in `withMethods()` calling `patchState()` | No `updater` factory; partial state only |
| `this.effect(fn)` | `rxMethod()` in `withMethods()` | Import from `@ngrx/signals/rxjs-interop` |
| `this.patchState(partial)` | `patchState(store, partial)` | Nearly identical |
| `tapResponse` from `@ngrx/component-store` | `tapResponse` from `@ngrx/operators` | Import path changed in v20 |
| `OnStoreInit` / `OnStoreDestroy` | `withHooks({ onInit, onDestroy })` | Lifecycle hooks |
| `provideComponentStore(Store)` | `providers: [Store]` | Standard DI |

### Before: ComponentStore

Here is a typical ComponentStore managing a product catalog:

```typescript
// src/app/products/store/product-catalog.store.ts (BEFORE)
import { Injectable } from '@angular/core';
import { ComponentStore } from '@ngrx/component-store';
import { tapResponse } from '@ngrx/operators';
import { inject } from '@angular/core';
import { switchMap, tap } from 'rxjs';
import { Product } from '../product.model';
import { ProductService } from '../product.service';

export interface ProductCatalogState {
  products: Product[];
  selectedCategory: string | null;
  loading: boolean;
  error: string | null;
}

const initialState: ProductCatalogState = {
  products: [],
  selectedCategory: null,
  loading: false,
  error: null,
};

@Injectable()
export class ProductCatalogStore extends ComponentStore<ProductCatalogState> {
  private readonly productService = inject(ProductService);

  constructor() {
    super(initialState);
  }

  readonly products$ = this.select((s) => s.products);
  readonly loading$ = this.select((s) => s.loading);
  readonly error$ = this.select((s) => s.error);
  readonly selectedCategory$ = this.select((s) => s.selectedCategory);

  readonly filteredProducts$ = this.select(
    this.products$,
    this.selectedCategory$,
    (products, category) =>
      category ? products.filter((p) => p.category === category) : products
  );

  readonly productCount$ = this.select(this.filteredProducts$, (products) => products.length);

  readonly setCategory = this.updater(
    (state, category: string | null) => ({ ...state, selectedCategory: category })
  );

  readonly loadProducts = this.effect<void>((trigger$) =>
    trigger$.pipe(
      tap(() => this.patchState({ loading: true, error: null })),
      switchMap(() =>
        this.productService.getAll().pipe(
          tapResponse({
            next: (products) => this.patchState({ products, loading: false }),
            error: (err: Error) => this.patchState({ error: err.message, loading: false }),
          })
        )
      )
    )
  );
}
```

### After: SignalStore

The same feature, migrated:

```typescript
// src/app/products/store/product-catalog.store.ts (AFTER)
import { computed, inject } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { tapResponse } from '@ngrx/operators';
import { pipe, switchMap, tap } from 'rxjs';
import { Product } from '../product.model';
import { ProductService } from '../product.service';

export interface ProductCatalogState {
  products: Product[];
  selectedCategory: string | null;
  loading: boolean;
  error: string | null;
}

const initialState: ProductCatalogState = {
  products: [],
  selectedCategory: null,
  loading: false,
  error: null,
};

export const ProductCatalogStore = signalStore(
  withState(initialState),
  withComputed(({ products, selectedCategory }) => ({
    filteredProducts: computed(() => {
      const category = selectedCategory();
      const all = products();
      return category ? all.filter((p) => p.category === category) : all;
    }),
  })),
  withComputed(({ filteredProducts }) => ({
    productCount: computed(() => filteredProducts().length),
  })),
  withMethods((store, productService = inject(ProductService)) => ({
    setCategory(category: string | null): void {
      patchState(store, { selectedCategory: category });
    },
    loadProducts: rxMethod<void>(
      pipe(
        tap(() => patchState(store, { loading: true, error: null })),
        switchMap(() =>
          productService.getAll().pipe(
            tapResponse({
              next: (products) => patchState(store, { products, loading: false }),
              error: (err: Error) => patchState(store, { error: err.message, loading: false }),
            })
          )
        )
      )
    ),
  }))
);
```

Key differences to notice:

- **No class.** The store is a factory function result, not a class that extends `ComponentStore`.
- **No explicit selectors for root properties.** `store.products()`, `store.loading()`, `store.error()`, and `store.selectedCategory()` are auto-generated signals. No `this.select(s => s.products)` needed.
- **Derived state uses `computed()`.** The combiner selector `this.select(obs1$, obs2$, fn)` becomes a `computed()` signal inside `withComputed()`.
- **Updaters become methods.** Instead of `this.updater((state, value) => ({...state, ...}))`, we write a method that calls `patchState(store, partial)`. Notice that `patchState` accepts partial state, so there is no manual spread operator.
- **Effects become `rxMethod`.** The RxJS pipeline is identical, but it lives inside `withMethods` and uses `rxMethod<void>(pipe(...))`.
- **`tapResponse` import path changed.** Import from `@ngrx/operators`, not `@ngrx/component-store`.

### Lifecycle Migration

If your ComponentStore implements `OnStoreInit` or `OnStoreDestroy`, move that logic to `withHooks`:

```typescript
// src/app/products/store/product-catalog.store.ts (lifecycle migration)
import { signalStore, withState, withMethods, withHooks, patchState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { tapResponse } from '@ngrx/operators';
import { computed, inject } from '@angular/core';
import { pipe, switchMap, tap } from 'rxjs';
import { Product } from '../product.model';
import { ProductService } from '../product.service';

export const ProductCatalogStore = signalStore(
  withState({
    products: [] as Product[],
    loading: false,
    error: null as string | null,
  }),
  withMethods((store, productService = inject(ProductService)) => ({
    loadProducts: rxMethod<void>(
      pipe(
        tap(() => patchState(store, { loading: true, error: null })),
        switchMap(() =>
          productService.getAll().pipe(
            tapResponse({
              next: (products) => patchState(store, { products, loading: false }),
              error: (err: Error) => patchState(store, { error: err.message, loading: false }),
            })
          )
        )
      )
    ),
  })),
  withHooks({
    onInit(store) {
      store.loadProducts();
    },
    onDestroy() {
      console.log('ProductCatalogStore destroyed');
    },
  })
);
```

The `onInit` callback runs when the store is first injected. The `onDestroy` callback runs when the store's injection context is destroyed (typically when the component providing it is destroyed).

## Path 2: Classic Store to SignalStore (Method-Driven)

The method-driven approach eliminates the Redux ceremony entirely. Actions disappear. Reducers disappear. Selectors become computed signals. Effects become methods. Four files collapse into one.

### The Rosetta Stone

| Classic Store | SignalStore (Method-Driven) |
|---|---|
| `createActionGroup(...)` | Direct method calls on the store |
| `createReducer(initialState, on(...))` | `patchState()` inside methods |
| `createSelector(...)` | Auto-signals + `withComputed()` |
| `createEffect(() => actions$.pipe(...))` | `rxMethod()` inside `withMethods()` |
| `store.dispatch(action)` | `store.method()` |
| `store.select(selector)` | `store.signal()` |
| `@ngrx/entity` adapter | `withEntities()` from `@ngrx/signals/entities` |

### Before: Classic Store (Four Files)

```typescript
// src/app/products/state/product.actions.ts (BEFORE)
import { createActionGroup, props, emptyProps } from '@ngrx/store';
import { Product } from '../product.model';

export const ProductActions = createActionGroup({
  source: 'Products Page',
  events: {
    'Load Products': emptyProps(),
    'Load Products Success': props<{ products: Product[] }>(),
    'Load Products Failure': props<{ error: string }>(),
    'Set Category': props<{ category: string | null }>(),
  },
});
```

```typescript
// src/app/products/state/product.reducer.ts (BEFORE)
import { createReducer, on } from '@ngrx/store';
import { ProductActions } from './product.actions';
import { Product } from '../product.model';

export interface ProductState {
  products: Product[];
  selectedCategory: string | null;
  loading: boolean;
  error: string | null;
}

const initialState: ProductState = {
  products: [],
  selectedCategory: null,
  loading: false,
  error: null,
};

export const productReducer = createReducer(
  initialState,
  on(ProductActions.loadProducts, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(ProductActions.loadProductsSuccess, (state, { products }) => ({
    ...state,
    products,
    loading: false,
  })),
  on(ProductActions.loadProductsFailure, (state, { error }) => ({
    ...state,
    error,
    loading: false,
  })),
  on(ProductActions.setCategory, (state, { category }) => ({
    ...state,
    selectedCategory: category,
  }))
);
```

```typescript
// src/app/products/state/product.selectors.ts (BEFORE)
import { createFeatureSelector, createSelector } from '@ngrx/store';
import { ProductState } from './product.reducer';

export const selectProductState = createFeatureSelector<ProductState>('products');
export const selectProducts = createSelector(selectProductState, (s) => s.products);
export const selectLoading = createSelector(selectProductState, (s) => s.loading);
export const selectError = createSelector(selectProductState, (s) => s.error);
export const selectSelectedCategory = createSelector(selectProductState, (s) => s.selectedCategory);

export const selectFilteredProducts = createSelector(
  selectProducts,
  selectSelectedCategory,
  (products, category) =>
    category ? products.filter((p) => p.category === category) : products
);

export const selectProductCount = createSelector(
  selectFilteredProducts,
  (products) => products.length
);
```

```typescript
// src/app/products/state/product.effects.ts (BEFORE)
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, exhaustMap, map, of } from 'rxjs';
import { ProductActions } from './product.actions';
import { ProductService } from '../product.service';

export const loadProducts = createEffect(
  (actions$ = inject(Actions), productService = inject(ProductService)) =>
    actions$.pipe(
      ofType(ProductActions.loadProducts),
      exhaustMap(() =>
        productService.getAll().pipe(
          map((products) => ProductActions.loadProductsSuccess({ products })),
          catchError((err) =>
            of(ProductActions.loadProductsFailure({ error: err.message }))
          )
        )
      )
    ),
  { functional: true }
);
```

### After: SignalStore (One File)

```typescript
// src/app/products/store/product-catalog.store.ts (AFTER - method-driven)
import { computed, inject } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { tapResponse } from '@ngrx/operators';
import { pipe, exhaustMap, tap } from 'rxjs';
import { Product } from '../product.model';
import { ProductService } from '../product.service';

export interface ProductCatalogState {
  products: Product[];
  selectedCategory: string | null;
  loading: boolean;
  error: string | null;
}

const initialState: ProductCatalogState = {
  products: [],
  selectedCategory: null,
  loading: false,
  error: null,
};

export const ProductCatalogStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed(({ products, selectedCategory }) => ({
    filteredProducts: computed(() => {
      const category = selectedCategory();
      const all = products();
      return category ? all.filter((p) => p.category === category) : all;
    }),
  })),
  withComputed(({ filteredProducts }) => ({
    productCount: computed(() => filteredProducts().length),
  })),
  withMethods((store, productService = inject(ProductService)) => ({
    setCategory(category: string | null): void {
      patchState(store, { selectedCategory: category });
    },
    loadProducts: rxMethod<void>(
      pipe(
        tap(() => patchState(store, { loading: true, error: null })),
        exhaustMap(() =>
          productService.getAll().pipe(
            tapResponse({
              next: (products) => patchState(store, { products, loading: false }),
              error: (err: Error) => patchState(store, { error: err.message, loading: false }),
            })
          )
        )
      )
    ),
  }))
);
```

What disappeared:

- **Actions file.** No more `createActionGroup`. Methods on the store replace dispatched actions.
- **Reducer file.** No more `createReducer` with `on()` handlers. State updates happen directly in methods via `patchState`.
- **Selectors file.** Root properties become auto-generated signals. Derived values move to `withComputed`.
- **Effects file.** No more `createEffect` with `Actions` injection. Side effects live inside `rxMethod` within `withMethods`.
- **Module registration.** No `provideStore`, `provideState`, or `provideEffects`. The store is either `providedIn: 'root'` or provided at the component level.

What you lose:

- **DevTools action log.** Without actions, Redux DevTools cannot show a log of discrete events. If this matters to your team, use the event-driven approach in Path 3 or add `withDevtools()` from `@angular-architects/ngrx-toolkit` for basic state snapshots.
- **Action indirection.** Multiple effects or reducers can no longer react to a single action. Each state change is a direct method call. If you need one event to trigger multiple independent reactions, use the Events Plugin.

## Path 3: Classic Store to SignalStore (Event-Driven)

For teams that value the Redux pattern's explicitness, indirection, and DevTools support, the Events Plugin preserves that architecture inside SignalStore. Actions become events. Reducers become `withReducer`. Effects become `withEventHandlers`.

### Before and After Mapping

| Classic Store | Events Plugin |
|---|---|
| `createActionGroup({ source, events })` | `eventGroup({ source, events })` |
| `props<T>()` | `type<T>()` from `@ngrx/signals` |
| `createReducer(init, on(action, fn))` | `withReducer(on(event, fn))` |
| `on(action, (state, props) => fullState)` | `on(event, ({ payload }) => partialState)` |
| `createEffect(() => actions$.pipe(ofType(...)))` | `withEventHandlers((_, events) => ({ $: events.on(...).pipe(...) }))` |
| `store.dispatch(action())` | `dispatcher.eventName()` via `injectDispatch` |

A critical difference: in Classic Store's `on()`, you return the **full** state object (using the spread operator). In the Events Plugin's `on()`, you return **partial** state, just like `patchState`. This is a common source of bugs during migration.

### Migrated Event-Driven Store

```typescript
// src/app/products/events/product-page.events.ts
import { eventGroup } from '@ngrx/signals/events';
import { type } from '@ngrx/signals';
import { Product } from '../product.model';

export const ProductPageEvents = eventGroup({
  source: 'Products Page',
  events: {
    opened: type<void>(),
    productsLoaded: type<{ products: Product[] }>(),
    productsLoadFailed: type<{ error: string }>(),
    categorySelected: type<{ category: string | null }>(),
  },
});
```

```typescript
// src/app/products/store/product-page.store.ts
import { computed, inject } from '@angular/core';
import { signalStore, withState, withComputed } from '@ngrx/signals';
import { withReducer, on, withEventHandlers, Events } from '@ngrx/signals/events';
import { mapResponse } from '@ngrx/operators';
import { exhaustMap } from 'rxjs';
import { Product } from '../product.model';
import { ProductService } from '../product.service';
import { ProductPageEvents } from '../events/product-page.events';

export interface ProductPageState {
  products: Product[];
  selectedCategory: string | null;
  loading: boolean;
  error: string | null;
}

const initialState: ProductPageState = {
  products: [],
  selectedCategory: null,
  loading: false,
  error: null,
};

export const ProductPageStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed(({ products, selectedCategory }) => ({
    filteredProducts: computed(() => {
      const category = selectedCategory();
      const all = products();
      return category ? all.filter((p) => p.category === category) : all;
    }),
  })),
  withComputed(({ filteredProducts }) => ({
    productCount: computed(() => filteredProducts().length),
  })),
  withReducer(
    on(ProductPageEvents.opened, () => ({ loading: true, error: null })),
    on(ProductPageEvents.productsLoaded, ({ payload }) => ({
      products: payload.products,
      loading: false,
    })),
    on(ProductPageEvents.productsLoadFailed, ({ payload }) => ({
      error: payload.error,
      loading: false,
    })),
    on(ProductPageEvents.categorySelected, ({ payload }) => ({
      selectedCategory: payload.category,
    }))
  ),
  withEventHandlers((store, events = inject(Events), productService = inject(ProductService)) => ({
    loadOnOpen$: events.on(ProductPageEvents.opened).pipe(
      exhaustMap(() =>
        productService.getAll().pipe(
          mapResponse({
            next: (products) => ProductPageEvents.productsLoaded({ products }),
            error: (err: Error) =>
              ProductPageEvents.productsLoadFailed({ error: err.message }),
          })
        )
      )
    ),
  }))
);
```

Notice the use of `mapResponse` instead of `tapResponse` inside `withEventHandlers`. The `mapResponse` operator maps the HTTP result to an event that gets dispatched back into the store. This is the Events Plugin equivalent of Classic Store effects returning new actions. Use `tapResponse` when you want to produce side effects (like `patchState` calls). Use `mapResponse` when you want to emit events.

### Component with Event Dispatch

The component dispatches events instead of calling methods directly:

```typescript
// src/app/products/components/product-page.component.ts
import { Component, inject } from '@angular/core';
import { injectDispatch } from '@ngrx/signals/events';
import { ProductPageStore } from '../store/product-page.store';
import { ProductPageEvents } from '../events/product-page.events';
import { ProductCardComponent } from './product-card.component';

@Component({
  selector: 'app-product-page',
  imports: [ProductCardComponent],
  template: `
    @if (store.loading()) {
      <div data-testid="loading">Loading products...</div>
    }
    @if (store.error(); as error) {
      <div data-testid="error" class="error">{{ error }}</div>
    }
    <select
      data-testid="category-select"
      (change)="onCategoryChange($event)">
      <option [value]="''">All Categories</option>
      <option value="tools">Tools</option>
      <option value="electronics">Electronics</option>
    </select>
    <div class="product-grid">
      @for (product of store.filteredProducts(); track product.id) {
        <app-product-card [product]="product" />
      }
    </div>
    <p>Showing {{ store.productCount() }} products</p>
  `,
})
export class ProductPageComponent {
  readonly store = inject(ProductPageStore);
  private readonly dispatch = injectDispatch(ProductPageEvents);

  constructor() {
    this.dispatch.opened();
  }

  onCategoryChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const category = select.value || null;
    this.dispatch.categorySelected({ category });
  }
}
```

The `injectDispatch(ProductPageEvents)` call returns an object with a typed method for each event in the group. Calling `this.dispatch.opened()` dispatches the `opened` event, which triggers both the reducer (setting `loading: true`) and the event handler (calling the API).

## Migrating Entity State

Classic Store uses `@ngrx/entity` with an `EntityAdapter`. SignalStore uses `withEntities()` from `@ngrx/signals/entities`. The entity operations become functional updaters passed to `patchState`.

### Before: Classic Entity Adapter

```typescript
// src/app/products/state/product.reducer.ts (BEFORE - entity)
import { createEntityAdapter, EntityAdapter, EntityState } from '@ngrx/entity';
import { createReducer, on } from '@ngrx/store';
import { ProductActions } from './product.actions';
import { Product } from '../product.model';

export interface ProductEntityState extends EntityState<Product> {
  loading: boolean;
  error: string | null;
}

const adapter: EntityAdapter<Product> = createEntityAdapter<Product>();
const initialState: ProductEntityState = adapter.getInitialState({
  loading: false,
  error: null,
});

export const productEntityReducer = createReducer(
  initialState,
  on(ProductActions.loadProductsSuccess, (state, { products }) =>
    adapter.setAll(products, { ...state, loading: false })
  ),
  on(ProductActions.addProduct, (state, { product }) =>
    adapter.addOne(product, state)
  ),
  on(ProductActions.updateProduct, (state, { product }) =>
    adapter.updateOne({ id: product.id, changes: product }, state)
  ),
  on(ProductActions.removeProduct, (state, { id }) =>
    adapter.removeOne(id, state)
  )
);

const { selectAll, selectTotal } = adapter.getSelectors();
```

### After: SignalStore Entities

```typescript
// src/app/products/store/product-entity.store.ts (AFTER)
import { computed, inject } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import {
  withEntities,
  setAllEntities,
  addEntity,
  updateEntity,
  removeEntity,
} from '@ngrx/signals/entities';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { tapResponse } from '@ngrx/operators';
import { pipe, exhaustMap, tap } from 'rxjs';
import { Product } from '../product.model';
import { ProductService } from '../product.service';

export const ProductEntityStore = signalStore(
  { providedIn: 'root' },
  withEntities<Product>(),
  withState({ loading: false, error: null as string | null }),
  withComputed(({ entities }) => ({
    productCount: computed(() => entities().length),
  })),
  withMethods((store, productService = inject(ProductService)) => ({
    addProduct(product: Product): void {
      patchState(store, addEntity(product));
    },
    updateProduct(product: Product): void {
      patchState(store, updateEntity({ id: product.id, changes: product }));
    },
    removeProduct(id: string): void {
      patchState(store, removeEntity(id));
    },
    loadProducts: rxMethod<void>(
      pipe(
        tap(() => patchState(store, { loading: true, error: null })),
        exhaustMap(() =>
          productService.getAll().pipe(
            tapResponse({
              next: (products) =>
                patchState(store, setAllEntities(products), { loading: false }),
              error: (err: Error) =>
                patchState(store, { error: err.message, loading: false }),
            })
          )
        )
      )
    ),
  }))
);
```

Key differences:

- **No adapter factory.** `withEntities<Product>()` replaces `createEntityAdapter<Product>()`. It automatically provides `entities`, `entityMap`, and `ids` signals.
- **No `getInitialState()`.** Entity state is initialized automatically by `withEntities`.
- **No `getSelectors()`.** `store.entities()` replaces `selectAll`. `store.ids()` replaces `selectIds`. `store.entityMap()` replaces `selectEntities`. For `selectTotal`, use `withComputed` to derive `entities().length`.
- **Functional updaters with `patchState`.** Instead of `adapter.addOne(entity, state)`, you write `patchState(store, addEntity(entity))`. Multiple updaters can be passed to a single `patchState` call: `patchState(store, setAllEntities(products), { loading: false })`.

## Migrating Component Templates

The template changes are straightforward: replace `async` pipe with signal reads, and replace `store.dispatch()` with direct method calls (or `injectDispatch` for event-driven stores).

### Before: Classic Store Template

```typescript
// src/app/products/components/product-list.component.ts (BEFORE)
import { Component, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { AsyncPipe } from '@angular/common';
import { selectFilteredProducts, selectLoading, selectProductCount } from '../state/product.selectors';
import { ProductActions } from '../state/product.actions';
import { ProductCardComponent } from './product-card.component';

@Component({
  selector: 'app-product-list',
  imports: [AsyncPipe, ProductCardComponent],
  template: `
    @if (loading$ | async) {
      <div data-testid="loading">Loading...</div>
    }
    @for (product of filteredProducts$ | async; track product.id) {
      <app-product-card [product]="product" />
    }
    <p>{{ productCount$ | async }} products</p>
  `,
})
export class ProductListComponent {
  private readonly store = inject(Store);

  readonly filteredProducts$ = this.store.select(selectFilteredProducts);
  readonly loading$ = this.store.select(selectLoading);
  readonly productCount$ = this.store.select(selectProductCount);

  constructor() {
    this.store.dispatch(ProductActions.loadProducts());
  }
}
```

### After: SignalStore Template

```typescript
// src/app/products/components/product-list.component.ts (AFTER)
import { Component, inject } from '@angular/core';
import { ProductCatalogStore } from '../store/product-catalog.store';
import { ProductCardComponent } from './product-card.component';

@Component({
  selector: 'app-product-list',
  imports: [ProductCardComponent],
  template: `
    @if (store.loading()) {
      <div data-testid="loading">Loading...</div>
    }
    @for (product of store.filteredProducts(); track product.id) {
      <app-product-card [product]="product" />
    }
    <p>{{ store.productCount() }} products</p>
  `,
})
export class ProductListComponent {
  readonly store = inject(ProductCatalogStore);

  constructor() {
    this.store.loadProducts();
  }
}
```

What changed:

- **No `AsyncPipe` import.** Signals are read synchronously in the template with `()`.
- **No `Store` from `@ngrx/store`.** The component injects the specific `ProductCatalogStore`.
- **No `select()` calls.** Direct signal access replaces Observable selectors.
- **No `dispatch()`.** Direct method call replaces action dispatch.

## Available Migration Schematics

NgRx provides automated schematics for specific API renames, but not for architectural migrations:

| Command | What It Does |
|---|---|
| `ng update @ngrx/signals@21` | Renames `withEffects` to `withEventHandlers` |
| `ng update @ngrx/store@20` | Migrates `tapResponse` to observer object signature |
| `ng update @ngrx/component-store@20` | Migrates `tapResponse` import to `@ngrx/operators` |

There is no schematic that converts a Classic Store feature slice or a ComponentStore class into a SignalStore. These are architectural changes that require understanding the feature's intent, deciding on method-driven vs. event-driven, and choosing the right granularity. Automated tools cannot make those decisions.

## Choosing Between Method-Driven and Event-Driven

Use the method-driven approach when:

- The feature is self-contained and no other store reacts to its state changes.
- You want maximum simplicity and minimum boilerplate.
- DevTools action logging is not critical.

Use the event-driven approach when:

- Multiple stores or components need to react to the same event.
- You want Redux DevTools integration with discrete event logging.
- The team is accustomed to the action/reducer/effect separation and wants to preserve that mental model.
- You are in a micro-frontend architecture where events need scoping (using `provideDispatcher` with scope options introduced in NgRx 21).

Both approaches can coexist in the same application. A simple settings store might use the method-driven approach while a complex order processing flow uses events.

## Common Mistakes

### Mistake 1: Returning Full State from Events Plugin `on()` Handlers

```typescript
// WRONG: Returning full state like Classic Store's on()
withReducer(
  on(ProductPageEvents.opened, (state) => ({
    ...state,
    loading: true,
    error: null,
  }))
)
```

In Classic Store, `on()` expects you to return the full state object. In the Events Plugin, `on()` expects partial state, just like `patchState`. The spread operator is harmless here but misleading. Worse, if you forget a property in the spread, you silently reset it.

```typescript
// CORRECT: Return only the changed properties
withReducer(
  on(ProductPageEvents.opened, () => ({
    loading: true,
    error: null,
  }))
)
```

### Mistake 2: Using the Deprecated tapResponse Import

```typescript
// WRONG: This import is deprecated since NgRx v20
import { tapResponse } from '@ngrx/component-store';
```

The `tapResponse` re-export from `@ngrx/component-store` was deprecated in v20. It still compiles but will be removed in a future version.

```typescript
// CORRECT: Import from @ngrx/operators
import { tapResponse } from '@ngrx/operators';
```

Run `ng update @ngrx/component-store@20` to fix this automatically across your codebase.

### Mistake 3: Mapping One Classic Feature Slice to One SignalStore

```typescript
// WRONG: Cramming everything into one massive store
export const EverythingStore = signalStore(
  withState({ products: [], cart: [], orders: [], user: null, preferences: {} }),
  // 50 methods covering products, cart, orders, user, and preferences
);
```

Classic Store encourages large feature slices because the global store is a single tree. SignalStore is a service. It should follow the single responsibility principle. Split large feature slices into focused stores.

```typescript
// CORRECT: Focused stores with clear responsibilities
export const ProductCatalogStore = signalStore(/* product state */);
export const CartStore = signalStore(/* cart state */);
export const OrderStore = signalStore(/* order state */);
```

### Mistake 4: Migrating Stable, Well-Tested Code Unnecessarily

The most expensive mistake is not technical. It is organizational. A Classic Store feature slice with 95% test coverage, zero bugs, and no planned changes does not need migration. Migration introduces risk. It costs review time. It can introduce subtle behavior changes.

Migrate when you are already modifying a feature significantly. Migrate when adding new capabilities that would be easier to build with SignalStore. Do not migrate for the sake of consistency alone.

## Key Takeaways

- **ComponentStore maps to SignalStore almost one-to-one.** `updater` becomes a method with `patchState`, `select` becomes auto-signals or `withComputed`, `effect` becomes `rxMethod`. This is the easiest migration path.

- **Classic Store offers two migration targets.** The method-driven approach eliminates Redux boilerplate and collapses four files into one. The event-driven approach preserves action/reducer/effect separation using `eventGroup`, `withReducer`, and `withEventHandlers`.

- **The Events Plugin's `on()` returns partial state, not full state.** This is the most common source of bugs when migrating Classic Store reducers. Drop the spread operator and return only the properties that changed.

- **Migrate incrementally, one feature at a time.** All three store types coexist safely. New features use SignalStore. Existing features migrate only when significant changes are already planned.

- **Import `tapResponse` from `@ngrx/operators`, not `@ngrx/component-store`.** The old import path was deprecated in NgRx v20. Run `ng update @ngrx/component-store@20` to fix it automatically.
