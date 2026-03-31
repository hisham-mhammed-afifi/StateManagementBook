# Chapter 15: SignalStore Fundamentals

Your product catalog works. The Classic Store from Part 3 manages products with actions, reducers, selectors, effects, and entity adapters. The architecture is solid but verbose. Adding a simple "toggle featured" capability required creating an action group, updating a reducer, writing a selector, and wiring an effect. That is four files touched for one boolean flip. Now the team wants to build a product comparison widget: a self-contained UI where users select up to three products and see them side by side. It needs its own isolated state (selected product IDs, comparison mode toggle, sort preference), it should be destroyed when the user navigates away, and it should not pollute the global Store. The Classic Store can do this with a feature state, but the boilerplate feels disproportionate for component-scoped state that lives and dies with a single route. NgRx SignalStore was built for exactly this problem. It gives you structured state management with the composition and encapsulation you need, powered entirely by Angular Signals, and with a fraction of the ceremony.

## A Quick Recap

In Part 2 (Chapters 4-7), we explored Angular Signals: `signal()` for reactive primitives, `computed()` for derived values, `effect()` for side effects, and `linkedSignal()` for dependent writeable state. In Part 3 (Chapters 8-14), we built a product catalog with the Classic Store using `createActionGroup`, `createFeature`, `@ngrx/entity`, and functional effects. The `Product` model has `id`, `name`, `price`, `category`, `description`, and `featured` properties. The product service (`ProductService`) exposes `getAll()`, `getById()`, `create()`, `update()`, and `delete()` methods returning Observables. This chapter introduces NgRx SignalStore, the signal-native state management solution from the NgRx team. Everything here uses `@ngrx/signals` v21, which has no dependency on `@ngrx/store`, `@ngrx/effects`, or RxJS.

## What Is SignalStore?

SignalStore is a functional, composable state container built on Angular Signals. Unlike the Classic Store's Redux-inspired architecture (actions in, state out, selectors to read), SignalStore uses a builder pattern: you compose features sequentially, and each feature adds state, computed signals, or methods to the store.

The `signalStore()` factory function returns an injectable Angular class. It is not an instance; Angular's dependency injection creates the instance when a component or service requests it. This means you control the store's lifetime through standard DI scoping: root-level for singletons, component-level for isolated state, route-level for feature-scoped state.

The core building blocks covered in this chapter are:

```
signalStore(
  config?,          // { providedIn?, protectedState? }
  withState(),      // Reactive state (produces DeepSignals)
  withComputed(),   // Derived signals from state
  withMethods(),    // Operations that update state or call services
)
```

Additional features like `withHooks()`, `withProps()`, and `withEntities()` are covered in Chapters 16-18. The event-driven architecture with `withEventHandlers()` is covered in Chapter 19.

## Defining State with withState

The `withState()` function defines the store's initial state. It accepts either an object literal or a factory function that returns the state.

```typescript
// src/app/products/state/product-comparison.store.ts
import { signalStore, withState } from '@ngrx/signals';

interface ComparisonState {
  selectedProductIds: string[];
  sortBy: 'name' | 'price';
  showDifferencesOnly: boolean;
}

const initialState: ComparisonState = {
  selectedProductIds: [],
  sortBy: 'price',
  showDifferencesOnly: false,
};

export const ProductComparisonStore = signalStore(
  withState(initialState),
);
```

This produces a store with three signal properties: `selectedProductIds`, `sortBy`, and `showDifferencesOnly`. Each is a reactive signal that components can read in templates or track in `computed()` and `effect()` calls.

### DeepSignals: Nested Property Access

When state contains nested objects, `withState` creates DeepSignals. A DeepSignal is a signal that also exposes each nested property as its own signal, created lazily on first access.

```typescript
// src/app/products/state/product-detail.store.ts
import { signalStore, withState } from '@ngrx/signals';

interface ProductDetailState {
  product: {
    id: string;
    name: string;
    pricing: { base: number; discount: number };
  } | null;
  loading: boolean;
}

const initialState: ProductDetailState = {
  product: null,
  loading: false,
};

export const ProductDetailStore = signalStore(
  withState(initialState),
);
```

When the `product` value is a non-null object, you can access nested properties as signals:

```typescript
// In a component
const store = inject(ProductDetailStore);

store.product();                    // Signal<{ id, name, pricing } | null>
store.product.pricing();            // Signal<{ base, discount } | null> (DeepSignal)
store.product.pricing.base();       // Signal<number | null> (DeepSignal)
store.loading();                    // Signal<boolean>
```

DeepSignals are read-only. You cannot call `set()` or `update()` on them. State changes go through `patchState()`, which we cover next.

### State Immutability

In development mode, NgRx recursively calls `Object.freeze()` on every state value after each update. If you accidentally mutate state directly, the runtime throws an error immediately rather than causing subtle bugs. This protection is removed in production builds for performance.

## Updating State with patchState

The `patchState()` function is the only way to update state in a SignalStore. It accepts the store reference as the first argument, followed by one or more partial state objects or updater functions.

```typescript
import { patchState } from '@ngrx/signals';

// Partial object: set specific properties
patchState(store, { loading: true });

// Updater function: compute new values from current state
patchState(store, (state) => ({
  selectedProductIds: [...state.selectedProductIds, newId],
}));

// Multiple updaters in one call
patchState(store, { loading: false }, (state) => ({
  selectedProductIds: state.selectedProductIds.filter((id) => id !== removedId),
}));
```

### Shallow Merge Behavior

A critical detail: `patchState` performs a **shallow merge** at the top level only. Nested objects are replaced entirely, not merged. This distinction matters when your state has nested structures.

```typescript
// Given state: { product: { id: '1', name: 'Widget', pricing: { base: 10, discount: 0 } } }

// WRONG: replaces the entire product object, losing id and pricing
patchState(store, { product: { name: 'Updated Widget' } });

// CORRECT: spread the nested object to preserve other properties
patchState(store, (state) => ({
  product: state.product
    ? { ...state.product, name: 'Updated Widget' }
    : state.product,
}));
```

This is a deliberate design choice. Shallow merging is predictable and fast. Deep merging introduces ambiguity around arrays (append or replace?) and null values (clear or skip?). If you frequently update deeply nested state, consider flattening your state shape or using a library like Immer for complex updates.

### Getting a State Snapshot

Sometimes you need the entire state as a plain object, for logging, serialization, or passing to a function that expects a non-reactive value. The `getState()` function provides this:

```typescript
// src/app/products/state/product-comparison.store.ts
import { getState } from '@ngrx/signals';

// Inside a method or external code
const snapshot = getState(store);
console.log(snapshot); // { selectedProductIds: ['1', '2'], sortBy: 'price', showDifferencesOnly: false }
```

## Deriving State with withComputed

The `withComputed()` function defines derived signals. Its factory receives the store (all state and computed values defined by preceding features) and returns an object of `computed()` signals.

```typescript
// src/app/products/state/product-comparison.store.ts
import { computed, inject } from '@angular/core';
import { signalStore, withState, withComputed } from '@ngrx/signals';

interface ComparisonState {
  selectedProductIds: string[];
  sortBy: 'name' | 'price';
  showDifferencesOnly: boolean;
}

const initialState: ComparisonState = {
  selectedProductIds: [],
  sortBy: 'price',
  showDifferencesOnly: false,
};

export const ProductComparisonStore = signalStore(
  withState(initialState),
  withComputed(({ selectedProductIds }) => ({
    selectionCount: computed(() => selectedProductIds().length),
    canCompare: computed(() => selectedProductIds().length >= 2),
    isMaxSelected: computed(() => selectedProductIds().length >= 3),
  })),
);
```

Computed signals automatically track their dependencies. When `selectedProductIds` changes, all three computed signals recompute. When `sortBy` changes, none of them recompute because they do not read `sortBy`. This granularity is built into Angular's signal system.

### Composing Computed from Computed

Because features are applied sequentially, a later `withComputed` can reference computed signals from an earlier one:

```typescript
// src/app/products/state/product-comparison.store.ts
import { computed } from '@angular/core';
import { signalStore, withState, withComputed } from '@ngrx/signals';

export const ProductComparisonStore = signalStore(
  withState({
    selectedProductIds: [] as string[],
    sortBy: 'price' as 'name' | 'price',
    showDifferencesOnly: false,
  }),
  withComputed(({ selectedProductIds }) => ({
    selectionCount: computed(() => selectedProductIds().length),
    canCompare: computed(() => selectedProductIds().length >= 2),
    isMaxSelected: computed(() => selectedProductIds().length >= 3),
  })),
  withComputed(({ canCompare, showDifferencesOnly }) => ({
    statusMessage: computed(() => {
      if (!canCompare()) {
        return 'Select at least 2 products to compare';
      }
      return showDifferencesOnly()
        ? 'Showing differences only'
        : 'Showing all attributes';
    }),
  })),
);
```

The second `withComputed` reads `canCompare` and `showDifferencesOnly`, which come from the first `withComputed` and `withState` respectively. Order matters: you cannot reference something defined in a later feature.

## Adding Operations with withMethods

The `withMethods()` function defines the store's public API. Its factory receives the full store (state signals, computed signals, and any previously defined methods) and returns an object of methods.

A key feature: the `withMethods` factory runs in an **injection context**. This means you can call `inject()` directly inside it to access Angular services.

```typescript
// src/app/products/state/product-comparison.store.ts
import { computed, inject } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';
import { ProductService } from '../../services/product.service';
import { Product } from '../../models/product.model';

interface ComparisonState {
  selectedProductIds: string[];
  products: Product[];
  sortBy: 'name' | 'price';
  showDifferencesOnly: boolean;
  loading: boolean;
  error: string | null;
}

const initialState: ComparisonState = {
  selectedProductIds: [],
  products: [],
  sortBy: 'price',
  showDifferencesOnly: false,
  loading: false,
  error: null,
};

export const ProductComparisonStore = signalStore(
  withState(initialState),
  withComputed(({ selectedProductIds, products, sortBy }) => ({
    selectionCount: computed(() => selectedProductIds().length),
    canCompare: computed(() => selectedProductIds().length >= 2),
    isMaxSelected: computed(() => selectedProductIds().length >= 3),
    selectedProducts: computed(() => {
      const ids = selectedProductIds();
      const all = products();
      const selected = all.filter((p) => ids.includes(p.id));
      return sortBy() === 'price'
        ? selected.sort((a, b) => a.price - b.price)
        : selected.sort((a, b) => a.name.localeCompare(b.name));
    }),
  })),
  withMethods((store, productService = inject(ProductService)) => ({
    async loadProducts(): Promise<void> {
      patchState(store, { loading: true, error: null });
      try {
        const products = await productService.getAll();
        patchState(store, { products, loading: false });
      } catch (e) {
        patchState(store, { error: (e as Error).message, loading: false });
      }
    },
    toggleProduct(productId: string): void {
      patchState(store, (state) => {
        const ids = state.selectedProductIds;
        const exists = ids.includes(productId);
        if (exists) {
          return { selectedProductIds: ids.filter((id) => id !== productId) };
        }
        if (ids.length >= 3) {
          return {};
        }
        return { selectedProductIds: [...ids, productId] };
      });
    },
    setSortBy(sortBy: 'name' | 'price'): void {
      patchState(store, { sortBy });
    },
    toggleDifferencesOnly(): void {
      patchState(store, (state) => ({
        showDifferencesOnly: !state.showDifferencesOnly,
      }));
    },
    clearSelection(): void {
      patchState(store, { selectedProductIds: [] });
    },
  })),
);
```

Notice the service injection pattern: `productService = inject(ProductService)` as a default parameter. This is the idiomatic way to inject dependencies in SignalStore methods. The `inject()` call works because the factory runs during store construction, which happens inside Angular's injection context.

### State Protection

By default, `patchState` only works inside `withMethods`. The store instance exposed to components is a `StateSource` (read-only), not a `WritableStateSource`. This prevents components from bypassing the store's methods and mutating state directly.

If you need to allow external `patchState` calls (useful during prototyping), you can opt out:

```typescript
export const ProductComparisonStore = signalStore(
  { protectedState: false },  // Allows external patchState calls
  withState(initialState),
);
```

For production code, keep the default (`protectedState: true`). It enforces that all state changes go through named methods, making the store's behavior predictable and auditable.

## Store Provisioning: Controlling Lifetime and Scope

SignalStore supports four provisioning scopes through standard Angular DI.

### Global (Root) Scope

Add `providedIn: 'root'` for singletons that live for the entire application:

```typescript
// src/app/products/state/product-catalog.store.ts
import { signalStore, withState, withMethods, patchState } from '@ngrx/signals';

export const ProductCatalogStore = signalStore(
  { providedIn: 'root' },
  withState({ products: [] as Product[], loading: false }),
  withMethods((store) => ({
    setProducts(products: Product[]): void {
      patchState(store, { products, loading: false });
    },
  })),
);
```

No `providers` array needed. Inject it anywhere and get the same instance.

### Component Scope

Omit `providedIn` and add the store to a component's `providers` array. Each component instance gets its own store, and the store is destroyed when the component is destroyed:

```typescript
// src/app/products/comparison/product-comparison.component.ts
import { Component, inject } from '@angular/core';
import { ProductComparisonStore } from '../state/product-comparison.store';

@Component({
  selector: 'app-product-comparison',
  standalone: true,
  providers: [ProductComparisonStore],
  template: `
    <h2>Compare Products ({{ store.selectionCount() }} selected)</h2>

    @if (store.loading()) {
      <p>Loading products...</p>
    }

    @if (store.canCompare()) {
      <div class="comparison-grid">
        @for (product of store.selectedProducts(); track product.id) {
          <div class="comparison-card">
            <h3>{{ product.name }}</h3>
            <p>\${{ product.price }}</p>
            <p>{{ product.category }}</p>
            <button (click)="store.toggleProduct(product.id)">Remove</button>
          </div>
        }
      </div>
      <label>
        <input
          type="checkbox"
          [checked]="store.showDifferencesOnly()"
          (change)="store.toggleDifferencesOnly()"
        />
        Show differences only
      </label>
    } @else {
      <p>{{ store.statusMessage() }}</p>
    }
  `,
})
export class ProductComparisonComponent {
  readonly store = inject(ProductComparisonStore);

  constructor() {
    this.store.loadProducts();
  }
}
```

When the user navigates away and this component is destroyed, Angular destroys the injector, which destroys the store instance. All state is gone. Navigate back and a fresh store with `initialState` is created.

### Route Scope

Provide the store in a route's `providers` array to share it among all components in that route subtree:

```typescript
// src/app/products/products.routes.ts
import { Routes } from '@angular/router';
import { ProductComparisonStore } from './state/product-comparison.store';

export const productRoutes: Routes = [
  {
    path: 'compare',
    providers: [ProductComparisonStore],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./comparison/product-comparison.component').then(
            (m) => m.ProductComparisonComponent,
          ),
      },
      {
        path: 'details/:id',
        loadComponent: () =>
          import('./comparison/comparison-detail.component').then(
            (m) => m.ComparisonDetailComponent,
          ),
      },
    ],
  },
];
```

Both `ProductComparisonComponent` and `ComparisonDetailComponent` share the same store instance. When the user navigates outside the `compare` route, the store is destroyed.

## DevTools Integration

NgRx SignalStore does not include built-in Redux DevTools support. The recommended approach uses the `withDevtools()` feature from the community library `@angular-architects/ngrx-toolkit`.

### Setup

Install the toolkit:

```bash
npm install @angular-architects/ngrx-toolkit
```

Add `withDevtools()` to any store. The string argument is the name that appears in the Redux DevTools browser extension:

```typescript
// src/app/products/state/product-comparison.store.ts
import { signalStore, withState, withMethods, patchState } from '@ngrx/signals';
import { withDevtools } from '@angular-architects/ngrx-toolkit';

export const ProductComparisonStore = signalStore(
  withDevtools('product-comparison'),
  withState({
    selectedProductIds: [] as string[],
    sortBy: 'price' as 'name' | 'price',
    showDifferencesOnly: false,
    loading: false,
    error: null as string | null,
  }),
  withMethods((store) => ({
    toggleProduct(productId: string): void {
      patchState(store, (state) => {
        const ids = state.selectedProductIds;
        return ids.includes(productId)
          ? { selectedProductIds: ids.filter((id) => id !== productId) }
          : { selectedProductIds: [...ids, productId] };
      });
    },
  })),
);
```

Open the Redux DevTools panel in your browser. You will see a "product-comparison" node with the current state tree. Every `patchState` call updates the DevTools display.

### Custom Action Names

By default, DevTools shows state changes but without meaningful action names. Replace `patchState` with `updateState` from the toolkit to label each state transition:

```typescript
// src/app/products/state/product-comparison.store.ts
import { signalStore, withState, withMethods } from '@ngrx/signals';
import { withDevtools, updateState } from '@angular-architects/ngrx-toolkit';

export const ProductComparisonStore = signalStore(
  withDevtools('product-comparison'),
  withState({
    selectedProductIds: [] as string[],
    loading: false,
  }),
  withMethods((store) => ({
    addProduct(productId: string): void {
      updateState(
        store,
        'add product to comparison',
        (state) => ({
          selectedProductIds: [...state.selectedProductIds, productId],
        }),
      );
    },
    removeProduct(productId: string): void {
      updateState(
        store,
        'remove product from comparison',
        (state) => ({
          selectedProductIds: state.selectedProductIds.filter(
            (id) => id !== productId,
          ),
        }),
      );
    },
    setLoading(loading: boolean): void {
      updateState(store, 'set loading', { loading });
    },
  })),
);
```

Now DevTools shows "add product to comparison", "remove product from comparison", and "set loading" as distinct actions, making it easy to trace what happened and when.

### Production Builds

The DevTools feature adds overhead you do not want in production. Use the stub replacement to tree-shake it away:

```typescript
// src/app/shared/devtools.ts
import { isDevMode } from '@angular/core';
import {
  withDevtools as withDevtoolsDev,
  withDevtoolsStub,
} from '@angular-architects/ngrx-toolkit';

export const withDevtools = isDevMode() ? withDevtoolsDev : withDevtoolsStub;
```

```typescript
// src/app/products/state/product-comparison.store.ts
import { withDevtools } from '../../shared/devtools';

export const ProductComparisonStore = signalStore(
  withDevtools('product-comparison'),
  // ... features
);
```

In production, `withDevtoolsStub` is a no-op feature that adds nothing to the store. The DevTools code never makes it into the production bundle.

## The Full Picture: signalStore vs Classic Store

To see the difference in structure, here is a side-by-side comparison for managing a filtered product list. The Classic Store version (from Part 3):

```
Actions:          ProductListActions.filterChanged({ category })
                  ProductListActions.sortChanged({ sortBy })
Reducer:          on(filterChanged, (state, { category }) => ({ ...state, category }))
                  on(sortChanged, (state, { sortBy }) => ({ ...state, sortBy }))
Selectors:        selectFilteredProducts (memoized)
                  selectActiveCategory
Effects:          (none for pure UI state)
Files touched:    product-list.actions.ts, product-list.reducer.ts, product-list.selectors.ts
```

The SignalStore version:

```typescript
// src/app/products/state/product-list.store.ts
import { computed } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';
import { Product } from '../../models/product.model';

interface ProductListState {
  products: Product[];
  category: string;
  sortBy: 'name' | 'price';
}

const initialState: ProductListState = {
  products: [],
  category: 'all',
  sortBy: 'name',
};

export const ProductListStore = signalStore(
  withState(initialState),
  withComputed(({ products, category, sortBy }) => ({
    filteredProducts: computed(() => {
      const cat = category();
      const sort = sortBy();
      const filtered =
        cat === 'all'
          ? products()
          : products().filter((p) => p.category === cat);
      return sort === 'price'
        ? [...filtered].sort((a, b) => a.price - b.price)
        : [...filtered].sort((a, b) => a.name.localeCompare(b.name));
    }),
    activeCategory: computed(() => category()),
  })),
  withMethods((store) => ({
    setProducts(products: Product[]): void {
      patchState(store, { products });
    },
    filterByCategory(category: string): void {
      patchState(store, { category });
    },
    setSortBy(sortBy: 'name' | 'price'): void {
      patchState(store, { sortBy });
    },
  })),
);
```

One file. State, derived values, and operations are co-located. No action classes, no reducer switch logic, no separate selector file. The computed signals serve the same role as memoized selectors, and the methods serve the same role as dispatched actions.

This does not make the Classic Store wrong. For large applications where multiple teams dispatch actions and audit trails matter, the indirection of actions and effects is valuable. But for component-scoped or feature-scoped state that does not need that indirection, SignalStore removes the ceremony while keeping the structure.

## Common Mistakes

### Mistake 1: Shallow-Patching Nested Objects Without Spreading

```typescript
// WRONG: replaces the entire product object, losing id, category, description, and featured
patchState(store, { product: { name: 'New Name', price: 29.99 } });
```

`patchState` only merges at the top level. The `product` key is replaced with an object that has only `name` and `price`. Every other property on `product` is gone.

```typescript
// CORRECT: spread to preserve all existing properties
patchState(store, (state) => ({
  product: state.product
    ? { ...state.product, name: 'New Name', price: 29.99 }
    : state.product,
}));
```

### Mistake 2: Placing Mutable Objects in withState

```typescript
// WRONG: Object.freeze in dev mode will throw when Angular tries to update the FormGroup
import { FormGroup, FormControl } from '@angular/forms';

export const FormStore = signalStore(
  withState({
    form: new FormGroup({
      name: new FormControl(''),
    }),
  }),
);
```

Since NgRx v19, state values are recursively frozen with `Object.freeze()` in development mode. `FormGroup` is a mutable object that Angular's forms module needs to update internally. Freezing it causes runtime errors.

```typescript
// CORRECT: use withProps for mutable objects (covered in Chapter 17)
import { withProps } from '@ngrx/signals';
import { FormGroup, FormControl } from '@angular/forms';

export const FormStore = signalStore(
  withState({ submitted: false }),
  withProps(() => ({
    form: new FormGroup({
      name: new FormControl(''),
    }),
  })),
);
```

`withProps` attaches properties that are not part of the reactive state. They are not frozen and not tracked by `patchState`. Chapter 17 covers `withProps` in detail.

### Mistake 3: Referencing a Later Feature in an Earlier One

```typescript
// WRONG: withComputed runs before withMethods, so loadProducts does not exist yet
export const BrokenStore = signalStore(
  withState({ products: [] as Product[] }),
  withComputed((store) => ({
    // Type error: 'loadProducts' does not exist
    hasLoader: computed(() => typeof store.loadProducts === 'function'),
  })),
  withMethods((store) => ({
    loadProducts(): void {
      // ...
    },
  })),
);
```

Features are composed in order. `withComputed` at position 2 can only access what `withState` at position 1 provided. Methods from `withMethods` at position 3 are not available yet.

```typescript
// CORRECT: reorder so methods come before computed that references them,
// or (more commonly) keep computed independent of methods
export const FixedStore = signalStore(
  withState({ products: [] as Product[], loading: false }),
  withComputed(({ products, loading }) => ({
    isEmpty: computed(() => !loading() && products().length === 0),
  })),
  withMethods((store) => ({
    loadProducts(): void {
      patchState(store, { loading: true });
    },
  })),
);
```

### Mistake 4: Forgetting to Provide a Component-Level Store

```typescript
// WRONG: no providedIn and no providers entry
export const LocalStore = signalStore(
  withState({ count: 0 }),
);

@Component({
  selector: 'app-widget',
  standalone: true,
  // Missing: providers: [LocalStore]
  template: `{{ store.count() }}`,
})
export class WidgetComponent {
  readonly store = inject(LocalStore); // Runtime error: No provider for LocalStore
}
```

Stores without `providedIn: 'root'` must be explicitly provided. Angular cannot create an instance without a provider.

```typescript
// CORRECT: add the store to the component's providers
@Component({
  selector: 'app-widget',
  standalone: true,
  providers: [LocalStore],
  template: `{{ store.count() }}`,
})
export class WidgetComponent {
  readonly store = inject(LocalStore);
}
```

## Key Takeaways

- **SignalStore is a functional, composable state container built on Angular Signals.** The `signalStore()` factory composes features sequentially: `withState` for reactive state, `withComputed` for derived signals, and `withMethods` for operations. Each feature can access everything defined by preceding features.

- **`patchState` performs shallow merging.** Top-level properties are merged; nested objects are replaced entirely. Always spread nested objects when updating a subset of their properties.

- **Store lifetime is controlled by Angular DI.** Use `providedIn: 'root'` for global singletons, component `providers` for component-scoped state, and route `providers` for feature-scoped state. Component-level stores are destroyed when the component is destroyed.

- **State is protected by default.** Components cannot call `patchState` directly on a protected store. All mutations go through methods defined in `withMethods`, making the store's behavior predictable and its public API explicit.

- **DevTools integration uses `@angular-architects/ngrx-toolkit`.** Add `withDevtools('name')` to any store for Redux DevTools support. Use `updateState` instead of `patchState` for labeled action names. Use `withDevtoolsStub` in production to tree-shake the DevTools code.
