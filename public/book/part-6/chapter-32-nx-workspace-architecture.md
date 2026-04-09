# Chapter 32: Nx Workspace Architecture for State

Three developers on three squads ship three features in the same Angular app. The products team puts its NgRx actions in `src/app/products/state/`. The orders team puts its SignalStore in `src/app/orders/stores/`. The admin team scatters services, selectors, and random helpers across `src/shared/` with no barrel files and no access rules. Within six months, every feature imports from every other feature, the dependency graph looks like a plate of spaghetti, and a one-line change to a product model interface triggers a full rebuild of the entire application. Nobody can move fast because nobody knows what depends on what.

This is the problem Nx solves. By splitting a single Angular application into dozens of small, focused libraries inside a monorepo, Nx gives you a file-system structure that maps to your architecture. Each library declares what it exposes, what it depends on, and which architectural layer it belongs to. An ESLint rule enforces those rules at lint time so illegal imports fail the CI build, not a code review six weeks later. In this chapter we will set up an Nx workspace from scratch, organize state management code across library types, tag every library with scope and type metadata, configure the `@nx/enforce-module-boundaries` rule, and visualize the result with the Nx dependency graph.

## The Anatomy of an Nx Angular Workspace

An Nx workspace has two top-level directories: `apps/` and `libs/`. Applications in `apps/` are thin deployment shells. They contain bootstrap code, top-level routing, and the root layout component. Everything else lives in `libs/`.

```
my-workspace/
  apps/
    shop/                           # The deployable shell
      src/
        app/
          app.config.ts             # provideStore, provideRouter
          app.component.ts          # Layout shell
          app.routes.ts             # Top-level lazy routes
  libs/
    products/                       # Domain: products
      data-access/                  # State + HTTP services
      feature/                      # Smart components, pages
    orders/                         # Domain: orders
      data-access/
      feature/
    shared/                         # Cross-cutting concerns
      data-access-auth/             # Authentication state
      models/                       # Interfaces, enums, types
      ui/                           # Presentational components
      utils/                        # Helpers, validators, pipes
  nx.json                           # Workspace-wide config
  tsconfig.base.json                # Path aliases for libraries
```

The structure is vertical first. We group by business domain (products, orders) and then slice horizontally by library type (data-access, feature, ui, util). This aligns with Domain-Driven Design bounded contexts: each domain directory is a self-contained area of responsibility that can be owned by a single team.

The `tsconfig.base.json` file maps every library to an import path so that consumers never write relative paths across library boundaries:

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "paths": {
      "@shop/products-data-access": ["libs/products/data-access/src/index.ts"],
      "@shop/products-feature": ["libs/products/feature/src/index.ts"],
      "@shop/orders-data-access": ["libs/orders/data-access/src/index.ts"],
      "@shop/orders-feature": ["libs/orders/feature/src/index.ts"],
      "@shop/shared-models": ["libs/shared/models/src/index.ts"],
      "@shop/shared-data-access-auth": ["libs/shared/data-access-auth/src/index.ts"],
      "@shop/shared-ui": ["libs/shared/ui/src/index.ts"],
      "@shop/shared-utils": ["libs/shared/utils/src/index.ts"]
    }
  }
}
```

Every path points at the library's `index.ts` barrel file. That barrel file is the library's public API. Code inside the library uses relative imports. Code outside the library uses the `@shop/` alias and can only reach symbols that the barrel explicitly exports.

## The Five Library Types

Every library in the workspace belongs to one of five types. The type determines what the library is allowed to contain and what it is allowed to import.

**feature** libraries contain smart components, page-level containers, and route configurations. A feature library orchestrates a use case. It imports data-access libraries to read and write state, ui libraries for presentational components, and util libraries for helpers. Feature libraries never contain HTTP calls or store definitions directly.

**data-access** libraries are where state management lives. NgRx actions, reducers, effects, and selectors go here. SignalStore definitions go here. HTTP services that talk to backend APIs go here. A data-access library may import other data-access libraries (for shared state) and util libraries, but never feature or ui libraries.

**ui** libraries contain presentational (dumb) components. They receive data through inputs and emit events through outputs. They never inject services, never import HttpClient, and never touch stores. A ui library may import other ui libraries and util libraries.

**util** libraries hold pure functions, constants, validators, pipes, interfaces, and type definitions. They sit at the bottom of the dependency hierarchy and may only import other util libraries.

**shell** libraries act as the entry point for a domain or application. They define route configurations and top-level layout components. They wire features together through lazy-loaded routes.

Here is the dependency matrix:

```
                  Can depend on
Source            feature   data-access   ui   util   shell
---------         -------   -----------   --   ----   -----
feature           yes       yes           yes  yes    no
data-access       no        yes           no   yes    no
ui                no        no            yes  yes    no
util              no        no            no   yes    no
shell             yes       no            no   yes    no
```

The most important row is data-access. It may depend on other data-access libraries and on util libraries, nothing else. This guarantees that your state layer is decoupled from your component layer. A store never knows which component renders its data, and a component never knows how a store talks to the server.

## Where State Management Code Lives

### Classic Store in a Data-Access Library

When using NgRx Classic Store, the Nx convention is to place all store files in a `+state/` subdirectory inside the data-access library. The `+` prefix sorts the directory to the top and signals "framework plumbing" to anyone browsing the tree.

```
libs/products/data-access/src/
  index.ts                          # Barrel: public API
  lib/
    +state/
      products.actions.ts
      products.reducer.ts
      products.effects.ts
      products.selectors.ts
    product.service.ts              # HTTP service
```

The barrel file controls visibility. External consumers need actions (to dispatch), selectors (to read), and the HTTP service. They do not need the reducer or effects directly because those are registered through providers in the application config.

```typescript
// libs/products/data-access/src/index.ts
export * from './lib/+state/products.actions';
export * from './lib/+state/products.selectors';
export { productsFeature } from './lib/+state/products.reducer';
export { ProductService } from './lib/product.service';
```

The reducer is exported only as the `productsFeature` object so the shell can register it with `provideState(productsFeature)`. Individual reducer functions stay internal.

Let us build the files. First, the shared model that both domains use:

```typescript
// libs/shared/models/src/lib/product.interface.ts
export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
}
```

```typescript
// libs/shared/models/src/index.ts
export { Product } from './lib/product.interface';
```

Now the data-access library:

```typescript
// libs/products/data-access/src/lib/product.service.ts
import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Product } from '@shop/shared-models';

@Injectable({ providedIn: 'root' })
export class ProductService {
  private readonly http = inject(HttpClient);

  loadAll() {
    return this.http.get<Product[]>('/api/products');
  }

  loadOne(id: string) {
    return this.http.get<Product>(`/api/products/${id}`);
  }
}
```

```typescript
// libs/products/data-access/src/lib/+state/products.actions.ts
import { createActionGroup, emptyProps, props } from '@ngrx/store';
import { Product } from '@shop/shared-models';

export const ProductsPageActions = createActionGroup({
  source: 'Products Page',
  events: {
    'Opened': emptyProps(),
    'Product Selected': props<{ productId: string }>(),
  },
});

export const ProductsApiActions = createActionGroup({
  source: 'Products API',
  events: {
    'Products Loaded Successfully': props<{ products: Product[] }>(),
    'Products Loaded Failure': props<{ error: string }>(),
  },
});
```

```typescript
// libs/products/data-access/src/lib/+state/products.reducer.ts
import { createFeature, createReducer, on } from '@ngrx/store';
import { EntityState, EntityAdapter, createEntityAdapter } from '@ngrx/entity';
import { Product } from '@shop/shared-models';
import { ProductsPageActions, ProductsApiActions } from './products.actions';

export interface ProductsState extends EntityState<Product> {
  selectedProductId: string | null;
  loading: boolean;
  error: string | null;
}

export const productsAdapter: EntityAdapter<Product> =
  createEntityAdapter<Product>();

const initialState: ProductsState = productsAdapter.getInitialState({
  selectedProductId: null,
  loading: false,
  error: null,
});

export const productsFeature = createFeature({
  name: 'products',
  reducer: createReducer(
    initialState,
    on(ProductsPageActions.opened, (state) => ({
      ...state,
      loading: true,
      error: null,
    })),
    on(ProductsApiActions.productsLoadedSuccessfully, (state, { products }) =>
      productsAdapter.setAll(products, { ...state, loading: false })
    ),
    on(ProductsApiActions.productsLoadedFailure, (state, { error }) => ({
      ...state,
      loading: false,
      error,
    })),
    on(ProductsPageActions.productSelected, (state, { productId }) => ({
      ...state,
      selectedProductId: productId,
    }))
  ),
});
```

```typescript
// libs/products/data-access/src/lib/+state/products.selectors.ts
import { createSelector } from '@ngrx/store';
import { productsFeature, productsAdapter } from './products.reducer';

const { selectProductsState } = productsFeature;
const { selectAll, selectEntities } = productsAdapter.getSelectors(selectProductsState);

export const selectAllProducts = selectAll;
export const selectProductEntities = selectEntities;

export const selectSelectedProduct = createSelector(
  selectEntities,
  productsFeature.selectSelectedProductId,
  (entities, selectedId) => (selectedId ? entities[selectedId] ?? null : null)
);

export const selectProductsLoading = productsFeature.selectLoading;
export const selectProductsError = productsFeature.selectError;
```

```typescript
// libs/products/data-access/src/lib/+state/products.effects.ts
import { inject, Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, exhaustMap, map, of } from 'rxjs';
import { ProductService } from '../product.service';
import { ProductsPageActions, ProductsApiActions } from './products.actions';

@Injectable()
export class ProductsEffects {
  private readonly actions$ = inject(Actions);
  private readonly productService = inject(ProductService);

  readonly loadProducts$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ProductsPageActions.opened),
      exhaustMap(() =>
        this.productService.loadAll().pipe(
          map((products) =>
            ProductsApiActions.productsLoadedSuccessfully({ products })
          ),
          catchError((err) =>
            of(ProductsApiActions.productsLoadedFailure({ error: err.message }))
          )
        )
      )
    )
  );
}
```

### SignalStore in a Data-Access Library

SignalStore does not split into actions, reducers, and selectors. The entire store lives in one file, so the `+state/` directory is unnecessary.

```
libs/products/data-access/src/
  index.ts
  lib/
    products.store.ts               # The SignalStore
    product.service.ts              # HTTP service (same as above)
```

```typescript
// libs/products/data-access/src/lib/products.store.ts
import { computed, inject } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';
import { withEntities, setAllEntities } from '@ngrx/signals/entities';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { tapResponse } from '@ngrx/operators';
import { pipe, switchMap } from 'rxjs';
import { Product } from '@shop/shared-models';
import { ProductService } from './product.service';

export const ProductsStore = signalStore(
  withEntities<Product>(),
  withState({
    selectedProductId: null as string | null,
    loading: false,
    error: null as string | null,
  }),
  withComputed(({ entities, selectedProductId }) => ({
    selectedProduct: computed(() => {
      const id = selectedProductId();
      return id ? entities().find((p) => p.id === id) ?? null : null;
    }),
  })),
  withMethods((store, productService = inject(ProductService)) => ({
    selectProduct(productId: string) {
      patchState(store, { selectedProductId: productId });
    },
    loadAll: rxMethod<void>(
      pipe(
        switchMap(() => {
          patchState(store, { loading: true, error: null });
          return productService.loadAll().pipe(
            tapResponse({
              next: (products) => {
                patchState(store, setAllEntities(products));
                patchState(store, { loading: false });
              },
              error: (err: Error) => {
                patchState(store, { loading: false, error: err.message });
              },
            })
          );
        })
      )
    ),
  }))
);
```

The barrel for the SignalStore variant exports the store and the service:

```typescript
// libs/products/data-access/src/index.ts
export { ProductsStore } from './lib/products.store';
export { ProductService } from './lib/product.service';
```

## Creating Libraries with Nx Generators

You do not create these directories by hand. The `@nx/angular:library` generator scaffolds the directory structure, the `project.json`, the barrel file, and the tsconfig path alias in one command.

```bash
# Create the products data-access library
nx g @nx/angular:library libs/products/data-access \
  --tags="scope:products,type:data-access" \
  --prefix=products

# Create the products feature library
nx g @nx/angular:library libs/products/feature \
  --tags="scope:products,type:feature" \
  --prefix=products

# Create the shared models library
nx g @nx/angular:library libs/shared/models \
  --tags="scope:shared,type:util" \
  --prefix=shared

# Create the shared auth data-access library
nx g @nx/angular:library libs/shared/data-access-auth \
  --tags="scope:shared,type:data-access" \
  --prefix=shared
```

Each command generates a `project.json` that records the library's metadata:

```json
// libs/products/data-access/project.json
{
  "name": "products-data-access",
  "$schema": "../../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "libs/products/data-access/src",
  "prefix": "products",
  "projectType": "library",
  "tags": ["scope:products", "type:data-access"],
  "targets": {
    "test": {
      "executor": "@nx/vitest:test"
    },
    "lint": {
      "executor": "@nx/eslint:lint"
    }
  }
}
```

The `tags` array is the key. It marks this library as belonging to the `products` scope and the `data-access` type. These tags mean nothing until we wire up the ESLint rule that reads them.

## Enforcing Module Boundaries

The `@nx/enforce-module-boundaries` ESLint rule reads every library's tags and compares them against a set of constraints you define. When a developer writes an import that violates a constraint, the lint fails with a clear error message.

```javascript
// eslint.config.mjs
import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            {
              sourceTag: 'type:feature',
              onlyDependOnLibsWithTags: [
                'type:feature',
                'type:data-access',
                'type:ui',
                'type:util',
              ],
            },
            {
              sourceTag: 'type:data-access',
              onlyDependOnLibsWithTags: ['type:data-access', 'type:util'],
            },
            {
              sourceTag: 'type:ui',
              onlyDependOnLibsWithTags: ['type:ui', 'type:util'],
            },
            {
              sourceTag: 'type:util',
              onlyDependOnLibsWithTags: ['type:util'],
            },
            {
              sourceTag: 'scope:products',
              onlyDependOnLibsWithTags: ['scope:products', 'scope:shared'],
            },
            {
              sourceTag: 'scope:orders',
              onlyDependOnLibsWithTags: ['scope:orders', 'scope:shared'],
            },
            {
              sourceTag: 'scope:shared',
              onlyDependOnLibsWithTags: ['scope:shared'],
            },
          ],
        },
      ],
    },
  },
];
```

This configuration encodes two dimensions of constraints simultaneously. The type constraints prevent a ui library from importing a data-access library. The scope constraints prevent the products domain from importing the orders domain. Both dimensions are checked independently, and both must pass.

If a developer on the orders team writes this import inside `libs/orders/feature/`:

```typescript
// This import will fail lint
import { selectAllProducts } from '@shop/products-data-access';
```

The lint output will say:

```
A project tagged with "scope:orders" can only depend on libs tagged with
"scope:orders" or "scope:shared".
```

The fix is architectural, not syntactical. If orders genuinely needs product data, the right answer is to create a `@shop/shared-data-access-catalog` library that provides a read-only slice of product information and is tagged with `scope:shared`.

### Multi-Dimensional Constraints with allSourceTags

For large workspaces where the basic two-dimensional model is not granular enough, you can combine scope and type in a single constraint using `allSourceTags`:

```javascript
// eslint.config.mjs (excerpt)
{
  allSourceTags: ['scope:products', 'type:feature'],
  onlyDependOnLibsWithTags: [
    'scope:products',
    'scope:shared',
    'type:data-access',
    'type:ui',
    'type:util',
  ],
}
```

This says: a library that is both `scope:products` and `type:feature` may only import libraries whose tags fall into the listed set. This is stricter than separate rules because it narrows the intersection.

## Shared State Libraries

Chapter 25 introduced the principle that state is shared only when multiple independently owned features read it. In an Nx workspace, shared state has a physical home: `libs/shared/data-access-<name>/`.

A shared data-access library must satisfy three rules:

1. It is tagged with `scope:shared` so the boundary rule allows all domains to import it.
2. It never imports from a domain-specific scope. The dependency is always one-way: features depend on shared, never the reverse.
3. It exports only the public contract through its barrel file. Internal implementation details stay private.

Here is a shared auth store that every feature in our shop application can use:

```typescript
// libs/shared/data-access-auth/src/lib/auth.store.ts
import { computed, inject } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
  withHooks,
} from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { tapResponse } from '@ngrx/operators';
import { HttpClient } from '@angular/common/http';
import { pipe, switchMap } from 'rxjs';

interface User {
  id: string;
  name: string;
  roles: string[];
}

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
}

const initialState: AuthState = {
  user: null,
  token: null,
  loading: false,
};

export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed(({ user }) => ({
    isAuthenticated: computed(() => user() !== null),
    userName: computed(() => user()?.name ?? ''),
    roles: computed(() => user()?.roles ?? []),
  })),
  withMethods((store, http = inject(HttpClient)) => ({
    loadProfile: rxMethod<void>(
      pipe(
        switchMap(() => {
          patchState(store, { loading: true });
          return http.get<User>('/api/auth/profile').pipe(
            tapResponse({
              next: (user) => patchState(store, { user, loading: false }),
              error: () => patchState(store, { user: null, loading: false }),
            })
          );
        })
      )
    ),
    setToken(token: string) {
      patchState(store, { token });
    },
    logout() {
      patchState(store, initialState);
    },
  })),
  withHooks({
    onInit(store) {
      if (typeof localStorage !== 'undefined') {
        const token = localStorage.getItem('auth_token');
        if (token) {
          store.setToken(token);
          store.loadProfile();
        }
      }
    },
  })
);
```

```typescript
// libs/shared/data-access-auth/src/index.ts
export { AuthStore } from './lib/auth.store';
```

The products feature imports the shared auth store to check permissions, and it imports its own domain data-access library for product state:

```typescript
// libs/products/feature/src/lib/product-list.component.ts
import { Component, inject, OnInit } from '@angular/core';
import { ProductsStore } from '@shop/products-data-access';
import { AuthStore } from '@shop/shared-data-access-auth';

@Component({
  selector: 'products-list',
  standalone: true,
  template: `
    @if (productsStore.loading()) {
      <p>Loading products...</p>
    } @else {
      @for (product of productsStore.entities(); track product.id) {
        <div class="product-card">
          <h3>{{ product.name }}</h3>
          <p>{{ product.price | currency }}</p>
          @if (authStore.isAuthenticated()) {
            <button (click)="productsStore.selectProduct(product.id)">
              View Details
            </button>
          }
        </div>
      }
    }
  `,
  providers: [ProductsStore],
})
export class ProductListComponent implements OnInit {
  protected readonly productsStore = inject(ProductsStore);
  protected readonly authStore = inject(AuthStore);

  ngOnInit() {
    this.productsStore.loadAll();
  }
}
```

Both imports are legal. `@shop/products-data-access` is `scope:products`, and we are inside `scope:products`. `@shop/shared-data-access-auth` is `scope:shared`, which every scope is allowed to import.

## Reusable Store Features in Shared Utils

Chapter 18 introduced `signalStoreFeature()` for composing reusable behaviors. In an Nx workspace, reusable features live in a shared util library because they are pure functions with no domain knowledge.

```typescript
// libs/shared/utils/src/lib/features/with-request-status.ts
import { computed } from '@angular/core';
import {
  signalStoreFeature,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';

type RequestStatus = 'idle' | 'loading' | 'success' | 'error';

export function withRequestStatus() {
  return signalStoreFeature(
    withState<{ requestStatus: RequestStatus }>({ requestStatus: 'idle' }),
    withComputed(({ requestStatus }) => ({
      isPending: computed(() => requestStatus() === 'loading'),
      hasError: computed(() => requestStatus() === 'error'),
    })),
    withMethods((store) => ({
      setLoading() {
        patchState(store, { requestStatus: 'loading' as RequestStatus });
      },
      setSuccess() {
        patchState(store, { requestStatus: 'success' as RequestStatus });
      },
      setError() {
        patchState(store, { requestStatus: 'error' as RequestStatus });
      },
    }))
  );
}
```

```typescript
// libs/shared/utils/src/index.ts
export { withRequestStatus } from './lib/features/with-request-status';
```

Any data-access library in the workspace can now compose this feature into its store, because `type:data-access` is allowed to depend on `type:util`:

```typescript
// libs/orders/data-access/src/lib/orders.store.ts
import { signalStore, withMethods, withHooks } from '@ngrx/signals';
import { withEntities } from '@ngrx/signals/entities';
import { withRequestStatus } from '@shop/shared-utils';
import { Order } from '@shop/shared-models';

export const OrdersStore = signalStore(
  withEntities<Order>(),
  withRequestStatus(),
  withMethods((store) => ({
    // store.setLoading(), store.isPending() are all available
    // from the composed withRequestStatus feature
  }))
);
```

## Visualizing Dependencies

After setting up libraries and constraints, run `nx graph` to open the interactive dependency graph in your browser. The graph shows every library as a node and every import as a directed edge.

```bash
# Open the full workspace graph
nx graph

# Focus on a single project and its dependents/dependencies
nx graph --focus products-data-access

# Show only projects affected by recent changes
nx affected:graph
```

The focused view is particularly useful during code review. If you are reviewing a pull request that modifies `products-data-access`, run `nx graph --focus products-data-access` to see exactly which feature libraries, shell libraries, and applications will be affected.

For CI pipelines, the affected graph drives incremental builds. Nx computes which projects changed since the last successful build and only runs test, lint, and build targets for those projects and their dependents. When state code lives in its own data-access library, a change to a product selector only rebuilds and retests the products data-access library and the feature libraries that depend on it. The orders domain is untouched.

## Common Mistakes

### Mistake 1: Importing from Your Own Barrel File

```typescript
// libs/products/data-access/src/lib/+state/products.effects.ts

// WRONG: importing from the library's own barrel
import { ProductService } from '@shop/products-data-access';
```

This creates a circular dependency. The barrel file at `index.ts` exports from `+state/products.effects.ts`, and now `products.effects.ts` imports from the barrel. Nx will detect this and report a circular reference error. Even when it does not immediately fail, it causes unpredictable import ordering that leads to undefined symbols at runtime.

The fix is to use relative imports inside a library:

```typescript
// libs/products/data-access/src/lib/+state/products.effects.ts

// CORRECT: relative import within the same library
import { ProductService } from '../product.service';
```

Barrel files are the public API for external consumers. Inside the library, you are the producer, not the consumer.

### Mistake 2: Empty Tags

```json
// libs/products/data-access/project.json
{
  "name": "products-data-access",
  "tags": []
}
```

When tags are empty and the ESLint config uses the default wildcard constraint (`sourceTag: '*', onlyDependOnLibsWithTags: ['*']`), every library can import every other library. The boundary rules exist but enforce nothing. This is the default state of a new Nx workspace, and it silently lets architectural violations accumulate.

The fix is to tag every library at creation time using the `--tags` flag, and to replace the wildcard constraint with explicit rules:

```json
{
  "name": "products-data-access",
  "tags": ["scope:products", "type:data-access"]
}
```

### Mistake 3: Exporting Reducers and Effects from the Barrel

```typescript
// libs/products/data-access/src/index.ts

// WRONG: leaking internal registration details
export * from './lib/+state/products.reducer';
export * from './lib/+state/products.effects';
export * from './lib/+state/products.actions';
export * from './lib/+state/products.selectors';
```

When the full reducer and effects are exported, any consumer can import them and register a second copy with `provideState` and `provideEffects`, leading to duplicate state slices and double-fired effects. Worse, consumers start depending on internal state shapes that you did not intend to be part of the public contract.

Export only what consumers need:

```typescript
// libs/products/data-access/src/index.ts

// CORRECT: export the feature object for registration, actions for dispatch,
// and selectors for reading
export { productsFeature } from './lib/+state/products.reducer';
export { ProductsEffects } from './lib/+state/products.effects';
export { ProductsPageActions } from './lib/+state/products.actions';
export {
  selectAllProducts,
  selectSelectedProduct,
  selectProductsLoading,
  selectProductsError,
} from './lib/+state/products.selectors';
export { ProductService } from './lib/product.service';
```

### Mistake 4: Feature Libraries Holding State Definitions

```typescript
// libs/products/feature/src/lib/products.store.ts
// WRONG: SignalStore defined inside a feature library

import { signalStore, withState } from '@ngrx/signals';

export const ProductsStore = signalStore(
  withState({ products: [] })
);
```

When the store lives in the feature library, no other library can import it because `type:data-access` cannot depend on `type:feature`. If a second feature later needs product data, you will have to either break the boundary rules or move the store. Move it to data-access from the start.

```typescript
// libs/products/data-access/src/lib/products.store.ts
// CORRECT: store lives in data-access where any feature can reach it

import { signalStore, withState } from '@ngrx/signals';

export const ProductsStore = signalStore(
  withState({ products: [] })
);
```

## Key Takeaways

- **State management code belongs in data-access libraries.** NgRx actions, reducers, effects, selectors, and SignalStore files all live in `libs/<domain>/data-access/`. Feature libraries consume state; they never define it.

- **Tag every library with scope and type on day one.** The `@nx/enforce-module-boundaries` ESLint rule only works when libraries have tags and the constraint list is explicit. Empty tags mean zero enforcement.

- **Barrel files are the public API contract.** Export only what external consumers need: actions for dispatch, selectors for reading, the feature object for registration, and the store class for injection. Keep reducers, effects, and internal services behind the barrel.

- **Shared state lives in `libs/shared/data-access-<name>/`.** Tag it with `scope:shared` so every domain can reach it. Shared libraries must never import from domain-specific scopes.

- **Use `nx graph` to verify your architecture.** The dependency graph is the ground truth. If an edge exists that should not, the boundary rule will catch it at lint time, and the graph will show you why.
