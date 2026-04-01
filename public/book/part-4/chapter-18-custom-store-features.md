# Chapter 18: Custom Store Features and Advanced Composition

By the end of Chapter 17, our `ProductCatalogStore` was self-contained: it loaded its own data in `onInit`, injected its own dependencies via `withProps`, and cleaned up its own subscriptions in `onDestroy`. The component became a pure template consumer. But now imagine you are building a second store for an `OrderManagementStore`, a third for `CustomerStore`, and a fourth for `InventoryStore`. Each one needs loading indicators. Each one needs error handling. Each one needs entity CRUD operations backed by an HTTP service. You find yourself copy-pasting the same `loading`, `loaded`, `error` state pattern across every store. When you fix a bug in the loading logic, you have to remember every store that duplicated it.

This is the problem custom store features solve. Instead of repeating the same `withState` + `withComputed` + `withMethods` blocks, you extract them into a single reusable function. That function slots into any `signalStore()` call just like the built-in features you already know. This chapter covers `signalStoreFeature` for building those reusable blocks, type-safe input constraints for declaring what a feature requires from its host store, `withFeature` for bridging store-specific logic into generic features, and `withLinkedState` for derived state that resets automatically when its source changes.

## A Quick Recap

In Chapters 15 through 17, we built SignalStore knowledge incrementally. `withState` holds reactive state. `withComputed` derives signals from that state. `withMethods` defines operations that modify state through `patchState`. `withEntities` (Chapter 16) normalizes collections into `entityMap` and `ids`. `withHooks` (Chapter 17) moves lifecycle logic into the store with `onInit` and `onDestroy`. `withProps` centralizes dependency injection and holds non-reactive properties like services and observables. Every feature in a `signalStore()` call can access members defined by features above it, creating a top-to-bottom dependency chain. This chapter builds on all of those concepts.

## signalStoreFeature: The Composition Primitive

The `signalStoreFeature` function lets you group multiple built-in features into a single reusable unit. Think of it as extracting a chunk of store definition into a function that returns a feature you can plug into any store.

### A Basic Custom Feature

The most common cross-cutting concern is call state: tracking whether an async operation is loading, has loaded, or has failed. Here is how to extract that into a reusable feature:

```typescript
// src/app/shared/state/call-state.feature.ts
import { computed } from '@angular/core';
import { signalStoreFeature, withComputed, withState } from '@ngrx/signals';

export type CallState = 'init' | 'loading' | 'loaded' | { error: string };

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

The function returns the result of `signalStoreFeature(...)`, which itself is a `SignalStoreFeature`. That return value plugs directly into a `signalStore()` call:

```typescript
// src/app/products/state/product-catalog.store.ts
import { inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { signalStore, withMethods, withHooks, patchState } from '@ngrx/signals';
import { withEntities, setAllEntities } from '@ngrx/signals/entities';
import { firstValueFrom } from 'rxjs';
import { Product } from '../product.model';
import { withCallState } from '../../shared/state/call-state.feature';

export const ProductCatalogStore = signalStore(
  { providedIn: 'root' },
  withEntities<Product>(),
  withCallState(),
  withMethods((store) => {
    const http = inject(HttpClient);

    return {
      async loadProducts(): Promise<void> {
        patchState(store, { callState: 'loading' });
        try {
          const products = await firstValueFrom(
            http.get<Product[]>('/api/products')
          );
          patchState(store, setAllEntities(products), { callState: 'loaded' });
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Unknown error';
          patchState(store, { callState: { error: message } });
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

The component reads `store.loading()`, `store.loaded()`, and `store.error()` without knowing or caring that those signals came from a reusable feature. The `withCallState` feature is a black box that contributes state and computed signals to the store's public API.

### How signalStoreFeature Works Internally

Under the hood, `signalStoreFeature` receives one or more feature functions and composes them into a single feature function. Each feature in the list receives the accumulated store from all previous features and returns an extended store. The implementation is a simple `reduce`:

```
signalStoreFeature(f1, f2, f3)
  => (inputStore) => f3(f2(f1(inputStore)))
```

This is the same pipeline that `signalStore` itself uses internally. A custom feature is just a pre-packaged segment of that pipeline.

## Type-Safe Input Constraints

The basic `withCallState` feature works on any store because it does not require anything from the host. But many useful features need specific state or methods to already exist. A `withCrudOperations` feature, for example, needs the store to have entity state. A `withPagination` feature needs a method that fetches a page of results.

The `type<T>()` helper and the constraint object let you declare these requirements at compile time.

### The type() Helper

```typescript
import { type } from '@ngrx/signals';
```

`type<T>()` is a phantom-type utility. At runtime it returns `undefined`. At compile time it carries the type `T`. You use it in the first argument of `signalStoreFeature` to declare the shape the host store must satisfy.

### Declaring Required State

Here is a feature that provides pagination controls. It requires the host store to have an `items` array and a `loading` boolean:

```typescript
// src/app/shared/state/pagination.feature.ts
import { computed } from '@angular/core';
import {
  signalStoreFeature,
  type,
  withComputed,
  withMethods,
  withState,
  patchState,
} from '@ngrx/signals';

export function withPagination<Item>(config: { pageSize: number }) {
  return signalStoreFeature(
    {
      state: type<{ items: Item[]; loading: boolean }>(),
    },
    withState({ currentPage: 1, pageSize: config.pageSize }),
    withComputed((store) => ({
      totalPages: computed(() =>
        Math.max(1, Math.ceil(store.items().length / store.pageSize()))
      ),
      paginatedItems: computed(() => {
        const start = (store.currentPage() - 1) * store.pageSize();
        return store.items().slice(start, start + store.pageSize());
      }),
      hasNextPage: computed(() => {
        const total = Math.ceil(store.items().length / store.pageSize());
        return store.currentPage() < total;
      }),
      hasPreviousPage: computed(() => store.currentPage() > 1),
    })),
    withMethods((store) => ({
      nextPage(): void {
        if (store.hasNextPage()) {
          patchState(store, (s) => ({ currentPage: s.currentPage + 1 }));
        }
      },
      previousPage(): void {
        if (store.hasPreviousPage()) {
          patchState(store, (s) => ({ currentPage: s.currentPage - 1 }));
        }
      },
      goToPage(page: number): void {
        const clamped = Math.max(1, Math.min(page, store.totalPages()));
        patchState(store, { currentPage: clamped });
      },
      resetPagination(): void {
        patchState(store, { currentPage: 1 });
      },
    }))
  );
}
```

The first argument `{ state: type<{ items: Item[]; loading: boolean }>() }` is the constraint object. If a store tries to use `withPagination` without having `items` and `loading` in its state, TypeScript produces a compile error. The constraint acts as a contract between the feature and its consumer.

Here is a store that satisfies the contract:

```typescript
// src/app/products/state/paginated-product.store.ts
import { inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { signalStore, withState, withMethods, withHooks, patchState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import { Product } from '../product.model';
import { withPagination } from '../../shared/state/pagination.feature';

export const PaginatedProductStore = signalStore(
  { providedIn: 'root' },
  withState({
    items: [] as Product[],
    loading: false,
  }),
  withPagination<Product>({ pageSize: 10 }),
  withMethods((store) => {
    const http = inject(HttpClient);

    return {
      async loadProducts(): Promise<void> {
        patchState(store, { loading: true });
        const items = await firstValueFrom(
          http.get<Product[]>('/api/products')
        );
        patchState(store, { items, loading: false });
        store.resetPagination();
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

And here is what happens when the contract is not met:

```typescript
// This fails at compile time
const BrokenStore = signalStore(
  withState({ products: [] as Product[] }),  // 'items' is missing, 'loading' is missing
  withPagination<Product>({ pageSize: 10 }), // TypeScript error
);
```

TypeScript reports that the store's state does not extend `{ items: Product[]; loading: boolean }`.

### Constraining Props and Methods

The constraint object can also require computed signals (via `props`) and methods:

```typescript
// src/app/shared/state/auto-refresh.feature.ts
import { inject, DestroyRef, Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { signalStoreFeature, type, withHooks } from '@ngrx/signals';
import { interval } from 'rxjs';

export function withAutoRefresh(intervalMs: number) {
  return signalStoreFeature(
    {
      props: type<{ loaded: Signal<boolean> }>(),
      methods: type<{ loadProducts: () => Promise<void> }>(),
    },
    withHooks((store) => {
      const destroyRef = inject(DestroyRef);

      return {
        onInit() {
          interval(intervalMs)
            .pipe(takeUntilDestroyed(destroyRef))
            .subscribe(() => {
              if (store.loaded()) {
                store.loadProducts();
              }
            });
        },
      };
    })
  );
}
```

This feature requires the host store to have a `loaded` computed signal and a `loadProducts` method. It refreshes data on an interval, but only after the initial load has completed.

## Dynamic Property Names with Mapped Types

The basic `withCallState()` adds `callState`, `loading`, `loaded`, and `error` to the store. That works until you need two independent call states in the same store: one for loading products and another for loading categories. The property names would collide.

The solution is dynamic property naming using TypeScript template literal types. This pattern requires two signatures: an external one that carries the precise types, and an internal one that handles the dynamic key construction at runtime.

```typescript
// src/app/shared/state/named-call-state.feature.ts
import { Signal, computed } from '@angular/core';
import {
  SignalStoreFeature,
  signalStoreFeature,
  withComputed,
  withState,
} from '@ngrx/signals';

export type CallState = 'init' | 'loading' | 'loaded' | { error: string };

type NamedCallStateSlice<Prop extends string> = {
  [K in Prop as `${K}CallState`]: CallState;
};

type NamedCallStateSignals<Prop extends string> = {
  [K in Prop as `${K}Loading`]: Signal<boolean>;
} & {
  [K in Prop as `${K}Loaded`]: Signal<boolean>;
} & {
  [K in Prop as `${K}Error`]: Signal<string | null>;
};

// External signature: precise types for consumers
export function withNamedCallState<Prop extends string>(
  prop: Prop
): SignalStoreFeature<
  { state: {}; props: {}; methods: {} },
  { state: NamedCallStateSlice<Prop>; props: NamedCallStateSignals<Prop>; methods: {} }
>;

// Internal implementation: dynamic keys at runtime
export function withNamedCallState<Prop extends string>(
  prop: Prop
): SignalStoreFeature {
  return signalStoreFeature(
    withState({ [`${prop}CallState`]: 'init' as CallState }),
    withComputed((state: Record<string, Signal<unknown>>) => {
      const callState = state[`${prop}CallState`] as Signal<CallState>;
      return {
        [`${prop}Loading`]: computed(() => callState() === 'loading'),
        [`${prop}Loaded`]: computed(() => callState() === 'loaded'),
        [`${prop}Error`]: computed(() => {
          const s = callState();
          return typeof s === 'object' ? s.error : null;
        }),
      };
    })
  );
}
```

Now the same feature can be applied multiple times without conflicts:

```typescript
// src/app/products/state/product-dashboard.store.ts
import { signalStore, withState, withMethods, patchState } from '@ngrx/signals';
import { withEntities, setAllEntities } from '@ngrx/signals/entities';
import { inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Product } from '../product.model';
import { withNamedCallState } from '../../shared/state/named-call-state.feature';

interface Category {
  id: string;
  name: string;
}

export const ProductDashboardStore = signalStore(
  { providedIn: 'root' },
  withEntities<Product>(),
  withState({ categories: [] as Category[] }),
  withNamedCallState('products'),
  withNamedCallState('categories'),
  withMethods((store) => {
    const http = inject(HttpClient);

    return {
      async loadProducts(): Promise<void> {
        patchState(store, { productsCallState: 'loading' });
        try {
          const products = await firstValueFrom(
            http.get<Product[]>('/api/products')
          );
          patchState(store, setAllEntities(products), {
            productsCallState: 'loaded',
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Failed to load';
          patchState(store, { productsCallState: { error: msg } });
        }
      },
      async loadCategories(): Promise<void> {
        patchState(store, { categoriesCallState: 'loading' });
        try {
          const categories = await firstValueFrom(
            http.get<Category[]>('/api/categories')
          );
          patchState(store, {
            categories,
            categoriesCallState: 'loaded',
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Failed to load';
          patchState(store, { categoriesCallState: { error: msg } });
        }
      },
    };
  })
);
```

The store has `productsLoading`, `productsLoaded`, `productsError`, `categoriesLoading`, `categoriesLoaded`, and `categoriesError` as separate, non-colliding signals. The dual-signature pattern (explicit external types, dynamic internal implementation) is the standard approach for features with computed property names. The NgRx ESLint plugin includes a rule encouraging explicit return type annotations on custom features for exactly this reason: without them, TypeScript inference can break down with dynamic keys.

## withFeature: Bridging Store-Specific Logic

Custom features are generic by design. A `withEntityLoader` feature should work with any entity type and any loading mechanism. But what if the feature needs to call a method that is specific to the host store? A constraint can declare the method, but the feature author may not know the exact method signature ahead of time.

`withFeature` solves this by providing the feature factory with the current store instance. The factory receives the store (with all its state signals, props, and methods) and returns a feature that can use them.

```typescript
// src/app/shared/state/entity-loader.feature.ts
import {
  signalStoreFeature,
  withMethods,
  withState,
  patchState,
} from '@ngrx/signals';

export function withEntityLoader<T>(loadFn: (id: string) => Promise<T>) {
  return signalStoreFeature(
    withState({ selectedEntity: null as T | null, entityLoading: false }),
    withMethods((store) => ({
      async loadEntity(id: string): Promise<void> {
        patchState(store, { entityLoading: true, selectedEntity: null });
        try {
          const entity = await loadFn(id);
          patchState(store, {
            selectedEntity: entity,
            entityLoading: false,
          });
        } catch {
          patchState(store, { entityLoading: false });
        }
      },
    }))
  );
}
```

The `loadFn` parameter is a plain function. The question is: how does the consuming store pass its own method as `loadFn`? The `withFeature` function bridges this gap:

```typescript
// src/app/products/state/product-detail.store.ts
import { inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { signalStore, withFeature, withMethods } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import { Product } from '../product.model';
import { withEntityLoader } from '../../shared/state/entity-loader.feature';

export const ProductDetailStore = signalStore(
  withMethods(() => {
    const http = inject(HttpClient);

    return {
      async fetchProduct(id: string): Promise<Product> {
        return firstValueFrom(http.get<Product>(`/api/products/${id}`));
      },
    };
  }),
  withFeature((store) =>
    withEntityLoader<Product>((id) => store.fetchProduct(id))
  )
);
```

Inside the `withFeature` callback, `store` has full, type-safe access to every member defined by features above it, including `fetchProduct`. The callback returns a feature (`withEntityLoader`), and `withFeature` applies that feature to the store. The result is a store with `selectedEntity`, `entityLoading`, `loadEntity`, and `fetchProduct` on its public API.

Without `withFeature`, you would need to either hardcode the HTTP call inside the generic feature (making it not generic) or use a type constraint that forces every consumer to name their fetch method identically. `withFeature` is the clean solution.

## withLinkedState: Derived State That Resets

Angular 21 introduced `linkedSignal`, a signal whose value is derived from a source signal but can also be set manually. When the source changes, the linked signal recomputes. When set manually, it holds the manual value until the source changes again.

`withLinkedState` brings this concept into SignalStore. It creates state slices that are derived from existing store state but remain writable via `patchState`.

### Simple Computation Form

The simplest form passes a factory that returns computation functions:

```typescript
// src/app/products/state/product-filter.store.ts
import { signalStore, withState, withLinkedState, withMethods, patchState } from '@ngrx/signals';

interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
}

export const ProductFilterStore = signalStore(
  withState({
    products: [] as Product[],
    categories: ['Electronics', 'Books', 'Clothing'],
  }),
  withLinkedState(({ categories }) => ({
    selectedCategory: () => categories()[0],
  })),
  withMethods((store) => ({
    setProducts(products: Product[]): void {
      patchState(store, { products });
    },
    selectCategory(category: string): void {
      patchState(store, { selectedCategory: category });
    },
    addCategory(category: string): void {
      patchState(store, (s) => ({
        categories: [...s.categories, category],
      }));
    },
  }))
);
```

When `categories` changes (e.g., a new category is added and it shifts which element is at index 0), `selectedCategory` automatically resets to the new first category. But the user can also manually select a category via `selectCategory`, and that manual selection persists until `categories` changes again.

This is different from `withComputed`, where the value is always derived and never manually settable. And it is different from `withState`, where the value never auto-resets. `withLinkedState` occupies the space between the two.

### Explicit linkedSignal Form

For more complex derivation logic, pass an explicit `linkedSignal` instance:

```typescript
// src/app/products/state/product-selection.store.ts
import { linkedSignal } from '@angular/core';
import { signalStore, withState, withLinkedState, withMethods, patchState } from '@ngrx/signals';

interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
}

export const ProductSelectionStore = signalStore(
  withState({ products: [] as Product[] }),
  withLinkedState(({ products }) => ({
    selectedProduct: linkedSignal<Product[], Product | null>({
      source: products,
      computation: (
        currentProducts: Product[],
        previous?: { value: Product | null }
      ) => {
        if (!previous?.value) {
          return currentProducts[0] ?? null;
        }
        const stillExists = currentProducts.find(
          (p) => p.id === previous.value!.id
        );
        return stillExists ?? currentProducts[0] ?? null;
      },
    }),
  })),
  withMethods((store) => ({
    setProducts(products: Product[]): void {
      patchState(store, { products });
    },
    selectProduct(product: Product): void {
      patchState(store, { selectedProduct: product });
    },
  }))
);
```

When the product list changes (e.g., after a server refresh), the computation tries to preserve the currently selected product. If that product still exists in the new list, it stays selected. If it was removed, selection falls back to the first product. The `previous` parameter gives you access to the previously computed or manually set value, enabling this "preserve if possible, reset if necessary" pattern.

### Using withLinkedState in a Component

```typescript
// src/app/products/product-selection.component.ts
import { Component, inject } from '@angular/core';
import { ProductSelectionStore } from './state/product-selection.store';

@Component({
  selector: 'app-product-selection',
  standalone: true,
  providers: [ProductSelectionStore],
  template: `
    <div class="product-list">
      @for (product of store.products(); track product.id) {
        <button
          [class.selected]="product.id === store.selectedProduct()?.id"
          (click)="store.selectProduct(product)"
        >
          {{ product.name }} - {{ product.price | currency }}
        </button>
      } @empty {
        <p>No products available</p>
      }
    </div>

    @if (store.selectedProduct(); as selected) {
      <div class="product-detail">
        <h3>{{ selected.name }}</h3>
        <p>Category: {{ selected.category }}</p>
        <p>Price: {{ selected.price | currency }}</p>
      </div>
    }
  `,
})
export class ProductSelectionComponent {
  readonly store = inject(ProductSelectionStore);
}
```

## Composing Features Together

The real power of custom features emerges when you compose several of them into a single store. Each feature contributes its own slice of state, computed signals, and methods. The store becomes an assembly of well-tested, reusable building blocks.

```typescript
// src/app/products/state/full-product.store.ts
import { inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  signalStore,
  withState,
  withFeature,
  withMethods,
  withHooks,
  patchState,
} from '@ngrx/signals';
import { withEntities, setAllEntities } from '@ngrx/signals/entities';
import { firstValueFrom } from 'rxjs';
import { Product } from '../product.model';
import { withCallState } from '../../shared/state/call-state.feature';
import { withPagination } from '../../shared/state/pagination.feature';
import { withEntityLoader } from '../../shared/state/entity-loader.feature';

export const FullProductStore = signalStore(
  { providedIn: 'root' },
  withEntities<Product>(),
  withState({ items: [] as Product[], loading: false }),
  withCallState(),
  withPagination<Product>({ pageSize: 12 }),
  withMethods((store) => {
    const http = inject(HttpClient);

    return {
      async fetchProduct(id: string): Promise<Product> {
        return firstValueFrom(http.get<Product>(`/api/products/${id}`));
      },
      async loadProducts(): Promise<void> {
        patchState(store, { callState: 'loading', loading: true });
        try {
          const products = await firstValueFrom(
            http.get<Product[]>('/api/products')
          );
          patchState(
            store,
            setAllEntities(products),
            { items: products, loading: false, callState: 'loaded' }
          );
          store.resetPagination();
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Unknown error';
          patchState(store, {
            loading: false,
            callState: { error: msg },
          });
        }
      },
    };
  }),
  withFeature((store) =>
    withEntityLoader<Product>((id) => store.fetchProduct(id))
  ),
  withHooks({
    onInit(store) {
      store.loadProducts();
    },
  })
);
```

This store has entity management from `withEntities`, loading/error tracking from `withCallState`, pagination controls from `withPagination`, single-entity loading from `withEntityLoader` (bridged via `withFeature`), and auto-initialization from `withHooks`. Each feature is independently testable and reusable across the application.

### Grouping Features with Nested signalStoreFeature

When a store uses many features and approaches the TypeScript overload limit (10 features per `signalStore` call), group related features using nested `signalStoreFeature`:

```typescript
// src/app/shared/state/data-table.feature.ts
import { signalStoreFeature, withState } from '@ngrx/signals';
import { withCallState } from './call-state.feature';
import { withPagination } from './pagination.feature';

export function withDataTable<Item>(config: { pageSize: number }) {
  return signalStoreFeature(
    withState({ items: [] as Item[], loading: false }),
    withCallState(),
    withPagination<Item>({ pageSize: config.pageSize })
  );
}
```

Now `withDataTable` bundles three features into one, counting as a single feature in the `signalStore` call.

## Common Mistakes

### Mistake 1: Missing the Constraint Object

```typescript
// WRONG: feature accesses 'items' without declaring it as a requirement
export function withBrokenPagination() {
  return signalStoreFeature(
    withComputed((store) => ({
      pageCount: computed(() => store.items().length), // 'items' might not exist!
    }))
  );
}
```

Without a constraint, TypeScript cannot verify that the host store has an `items` signal. If a store without `items` uses this feature, it fails at runtime with `store.items is not a function`.

```typescript
// CORRECT: declare the requirement with type()
export function withFixedPagination() {
  return signalStoreFeature(
    { state: type<{ items: unknown[] }>() },
    withComputed((store) => ({
      pageCount: computed(() => store.items().length),
    }))
  );
}
```

The constraint object makes the requirement explicit. TypeScript catches the mismatch at compile time.

### Mistake 2: Re-applying withEntities Inside a Custom Feature

```typescript
// WRONG: re-applying withEntities overrides the host store's entity state
export function withEntityAudit<E extends { id: string }>() {
  return signalStoreFeature(
    withEntities<E>(),  // Duplicates entity state! Runtime warning.
    withMethods((store) => ({
      auditEntity(id: string): void {
        const entity = store.entityMap()[id];
        console.log('Auditing:', entity);
      },
    }))
  );
}
```

If the host store already called `withEntities`, this feature re-applies it, triggering a runtime warning about overridden store members and potentially resetting entity state.

```typescript
// CORRECT: use a constraint to require entity state instead
import { EntityState } from '@ngrx/signals/entities';

export function withEntityAudit<E extends { id: string }>() {
  return signalStoreFeature(
    {
      state: type<EntityState<E>>(),
    },
    withMethods((store) => ({
      auditEntity(id: string): void {
        const entity = store.entityMap()[id];
        console.log('Auditing:', entity);
      },
    }))
  );
}
```

Declare the entity state as a constraint. The host store provides it via its own `withEntities` call. No duplication.

### Mistake 3: Using withComputed When You Need withLinkedState

```typescript
// WRONG: selectedCategory is always derived, user cannot override it
const Store = signalStore(
  withState({ categories: ['A', 'B', 'C'] }),
  withComputed(({ categories }) => ({
    selectedCategory: computed(() => categories()[0]),
  }))
);
// store.selectedCategory() is always the first category
// patchState(store, { selectedCategory: 'B' }) does not work
```

`withComputed` creates read-only derived signals. There is no way for the user to manually select a different category.

```typescript
// CORRECT: use withLinkedState for "derived but overridable" state
const Store = signalStore(
  withState({ categories: ['A', 'B', 'C'] }),
  withLinkedState(({ categories }) => ({
    selectedCategory: () => categories()[0],
  }))
);
// Initially 'A'. User can patchState to 'B'.
// When categories changes, resets to new first element.
```

`withLinkedState` gives you the best of both worlds: automatic derivation from source state and manual overridability.

### Mistake 4: Omitting the External Signature on Dynamic Features

```typescript
// WRONG: no external signature, TypeScript loses type information
export function withBrokenNamedState<Prop extends string>(prop: Prop) {
  return signalStoreFeature(
    withState({ [`${prop}Value`]: '' })
  );
}

const Store = signalStore(
  withBrokenNamedState('search')
);
// store.searchValue is typed as Signal<unknown> or missing entirely
```

When property names are computed at runtime using bracket notation, TypeScript's inference breaks down.

```typescript
// CORRECT: explicit external signature with mapped types
type NamedValueState<Prop extends string> = {
  [K in Prop as `${K}Value`]: string;
};

export function withNamedState<Prop extends string>(
  prop: Prop
): SignalStoreFeature<
  { state: {}; props: {}; methods: {} },
  { state: NamedValueState<Prop>; props: {}; methods: {} }
>;
export function withNamedState<Prop extends string>(
  prop: Prop
): SignalStoreFeature {
  return signalStoreFeature(
    withState({ [`${prop}Value`]: '' })
  );
}
// store.searchValue is correctly typed as Signal<string>
```

The dual-signature pattern gives TypeScript the precise types it needs while keeping the runtime implementation flexible.

## Key Takeaways

- **`signalStoreFeature` extracts reusable store logic into composable functions.** Any combination of `withState`, `withComputed`, `withMethods`, `withProps`, and `withHooks` can be bundled into a single feature that plugs into any `signalStore` call.

- **Use `type<T>()` constraints to declare what a feature requires from its host store.** This catches mismatches at compile time instead of runtime. Constrain state, props, and methods as needed.

- **`withFeature` bridges store-specific logic into generic features.** When a reusable feature needs to call a method that only exists on a particular store, `withFeature` provides the store instance to a factory function that returns the configured feature.

- **`withLinkedState` creates derived-but-writable state slices.** Use it when state should auto-reset from a source signal but also accept manual overrides via `patchState`. Use `withComputed` when the value should always be derived. Use `withState` when the value is fully independent.

- **Use the dual-signature pattern for features with dynamic property names.** An explicit external signature with mapped types provides correct TypeScript inference, while the internal implementation uses bracket notation for runtime key construction.
