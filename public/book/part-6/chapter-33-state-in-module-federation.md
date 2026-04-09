# Chapter 33: State in Module Federation

Your Nx monorepo from Chapter 32 is organized beautifully. Libraries are tagged, boundaries are enforced, and every domain owns its own `data-access/` directory. Then the platform team announces that the products catalog, the orders workflow, and the admin dashboard will ship as independently deployed micro-frontends using Webpack Module Federation. Three teams, three CI pipelines, three deployable artifacts, one shell application stitching them together at runtime. The first question every team asks: "What happens to the NgRx store?"

The answer depends on how you configure the webpack shared scope and how you structure your Angular dependency injection tree. Get it right, and the shell hosts a single NgRx store where each remote registers its own feature slice on demand, with a shared `AuthStore` accessible everywhere. Get it wrong, and each remote boots its own Angular instance, creates its own root injector, instantiates its own copy of `@ngrx/store`, and wonders why the user appears logged out every time they navigate between features. This chapter explains the rules that govern state boundaries in Module Federation and walks through a complete implementation using both NgRx Classic Store and SignalStore.

## How Module Federation Shares Dependencies

In Chapter 32, we set up Nx libraries with TypeScript path aliases so that `@shop/products-data-access` resolves at build time to a local directory. Module Federation adds a runtime layer on top of this. When the shell loads a remote entry file, webpack's runtime checks which npm packages the remote needs and whether the shell has already loaded a compatible version. If a package is declared as `shared` in both the shell and the remote, the runtime reuses the shell's copy instead of loading a second one.

The key configuration properties are:

- **`singleton: true`** tells the runtime that only one copy of this package may exist. If the remote requests a different version, the runtime either falls back to the shell's version (with a console warning) or throws a runtime error.
- **`strictVersion: true`** turns that console warning into a hard error. This is essential in CI so version drift surfaces immediately instead of causing mysterious state bugs in production.
- **`requiredVersion: 'auto'`** reads the expected version from `package.json` instead of hardcoding it.
- **`eager: true`** bundles the dependency into the entry chunk synchronously. Avoid this for shared dependencies because it bloats the `remoteEntry.js` file and prevents version negotiation.

Here is a minimal webpack configuration for the shell that shares Angular core packages and NgRx as singletons:

```javascript
// apps/shell/webpack.config.js
const {
  share,
  withModuleFederationPlugin,
} = require('@angular-architects/module-federation/webpack');

module.exports = withModuleFederationPlugin({
  remotes: {},
  shared: share({
    '@angular/core': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@angular/common': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@angular/common/http': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@angular/router': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@ngrx/store': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@ngrx/effects': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@ngrx/signals': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@ngrx/store-devtools': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    rxjs: { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  }),
});
```

Note that `@angular/common/http` is listed explicitly. Secondary entry points like `@angular/common/http` are separate packages in webpack's eyes. Sharing `@angular/common` alone does not cover them.

If you use Nx's `withModuleFederation(config)` wrapper, it auto-discovers dependencies from the project graph and applies singleton sharing for Angular packages. The explicit `share()` call above is what happens under the hood, and understanding it is essential for debugging state-related bugs in federation.

## The Root Injector Problem

Angular creates one root injector per call to `bootstrapApplication()`. Every service with `providedIn: 'root'` is a singleton within that injector tree. In a standard Angular app, there is exactly one root injector, so every `providedIn: 'root'` service has exactly one instance.

Module Federation breaks this assumption when remotes bootstrap their own Angular application. If the shell calls `bootstrapApplication(ShellComponent, shellConfig)` and a remote also calls `bootstrapApplication(RemoteComponent, remoteConfig)`, two root injectors exist. A `SignalStore` with `{ providedIn: 'root' }` now has two instances: one in the shell's injector and one in the remote's. The shell's instance knows about the logged-in user; the remote's instance does not. State appears to "reset" when the user navigates from the shell into the remote.

The solution is structural: remotes must never bootstrap a second Angular application. Instead, they expose lazy route configurations that the shell loads into its own router. When a remote's routes are lazy-loaded via `loadChildren`, the components and services within those routes resolve against the shell's injector hierarchy. A `providedIn: 'root'` service in the remote resolves to the same instance the shell uses, as long as the package containing that service is shared as a singleton.

Here is the pattern. The shell defines a route that loads the remote dynamically:

```typescript
// apps/shell/src/app/app.routes.ts
import { Route } from '@angular/router';
import { loadRemote } from '@module-federation/enhanced/runtime';

export const routes: Route[] = [
  { path: '', redirectTo: 'products', pathMatch: 'full' },
  {
    path: 'products',
    loadChildren: () =>
      loadRemote('mfe_products/Routes').then((m) => m.remoteRoutes),
  },
  {
    path: 'orders',
    loadChildren: () =>
      loadRemote('mfe_orders/Routes').then((m) => m.remoteRoutes),
  },
];
```

The remote exposes a route array, not a component or a module:

```typescript
// apps/mfe_products/src/app/remote-entry/entry.routes.ts
import { Route } from '@angular/router';

export const remoteRoutes: Route[] = [
  {
    path: '',
    loadComponent: () =>
      import('./product-shell.component').then((m) => m.ProductShellComponent),
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./product-detail.component').then((m) => m.ProductDetailComponent),
  },
];
```

Because these routes load into the shell's `<router-outlet>`, they participate in the shell's injector tree. No second `bootstrapApplication` call is needed.

## Three Patterns for State Boundaries

Not every micro-frontend architecture needs the same degree of state sharing. The right pattern depends on team structure, deployment independence, and product requirements.

### Pattern 1: Fully Isolated State

Each remote owns all of its state. No NgRx store or SignalStore is shared between the shell and remotes. The shell provides only the router and a thin layout. Communication between remotes happens through browser-native mechanisms like `CustomEvent` or `BroadcastChannel`.

This pattern suits organizations where each micro-frontend might use a different framework or a different Angular version. The trade-off is that cross-cutting state like authentication, theming, and user preferences must be communicated through non-Angular channels, losing type safety and signal reactivity.

### Pattern 2: Shared Global State

The shell initializes a single NgRx store and all remotes register feature slices into it. Every action dispatched in any remote flows through the same reducer pipeline. DevTools shows a unified state tree.

This pattern suits tightly coordinated teams that share the same Angular version, the same NgRx version, and the same release cadence. The trade-off is coupling: a change to the shared store contract requires coordination across all teams, and a bug in one remote's reducer can corrupt the global state.

### Pattern 3: Hybrid (Recommended)

Cross-cutting state (authentication, feature flags, user preferences) is shared globally. Domain-specific state (product catalog, order workflow, form state) is isolated per remote. The shell initializes the root store and provides shared SignalStores. Each remote registers its own feature slices and provides its own route-scoped SignalStores.

This balances team autonomy with product coherence. The shared surface area is small and changes infrequently. Feature state is owned entirely by the team that builds the feature. The rest of this chapter implements this pattern.

## Implementing the Hybrid Pattern with Classic Store

The shell initializes the global store with shared reducers and configures DevTools:

```typescript
// apps/shell/src/app/app.config.ts
import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideStore } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { authReducer, AuthEffects } from '@shop/shared-data-access-auth';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideHttpClient(),
    provideStore({ auth: authReducer }),
    provideEffects(AuthEffects),
    provideStoreDevtools({ maxAge: 25 }),
  ],
};
```

The `provideStore()` call is the foundation. It initializes the `Store` service, the `ReducerManager`, and the root state tree. Without it, no remote can register feature state.

The products remote registers its feature state in its route configuration:

```typescript
// apps/mfe_products/src/app/remote-entry/entry.routes.ts
import { Route } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import {
  productsFeature,
  ProductsEffects,
} from '@shop/products-data-access';

export const remoteRoutes: Route[] = [
  {
    path: '',
    providers: [
      provideState(productsFeature),
      provideEffects(ProductsEffects),
    ],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./product-list.component').then(
            (m) => m.ProductListComponent
          ),
      },
      {
        path: ':id',
        loadComponent: () =>
          import('./product-detail.component').then(
            (m) => m.ProductDetailComponent
          ),
      },
    ],
  },
];
```

When the user navigates to `/products`, the shell lazy-loads the remote's routes. The `provideState(productsFeature)` call registers the `products` slice in the global store. The `provideEffects(ProductsEffects)` call starts the products effects pipeline. Both integrate with the single store instance from the shell because `@ngrx/store` is a shared singleton.

A component inside this remote can select from both the shared auth state and the local products state:

```typescript
// apps/mfe_products/src/app/remote-entry/product-list.component.ts
import { Component, inject, OnInit } from '@angular/core';
import { Store } from '@ngrx/store';
import { CurrencyPipe } from '@angular/common';
import {
  selectAllProducts,
  selectProductsLoading,
  ProductsPageActions,
} from '@shop/products-data-access';
import { selectAuthUser } from '@shop/shared-data-access-auth';

@Component({
  selector: 'app-product-list',
  standalone: true,
  imports: [CurrencyPipe],
  template: `
    <h2>Products</h2>
    @if (user()) {
      <p>Welcome back, {{ user()!.name }}</p>
    }
    @if (loading()) {
      <p>Loading...</p>
    } @else {
      @for (product of products(); track product.id) {
        <div class="product-card">
          <h3>{{ product.name }}</h3>
          <span>{{ product.price | currency }}</span>
        </div>
      }
    }
  `,
})
export class ProductListComponent implements OnInit {
  private readonly store = inject(Store);

  protected readonly products = this.store.selectSignal(selectAllProducts);
  protected readonly loading = this.store.selectSignal(selectProductsLoading);
  protected readonly user = this.store.selectSignal(selectAuthUser);

  ngOnInit() {
    this.store.dispatch(ProductsPageActions.opened());
  }
}
```

The `selectAuthUser` selector reads from the `auth` slice that the shell registered. The `selectAllProducts` selector reads from the `products` slice that this remote registered. Both resolve from the same `Store` instance.

### Feature State Cleanup

NgRx intentionally does not remove feature reducers when lazy routes are destroyed. The rationale is that unused reducers simply pass state through without side effects. However, the data remains in the store and in DevTools, consuming memory. For micro-frontends where remotes may load and unload frequently, it is good practice to dispatch a cleanup action when leaving a feature area:

```typescript
// apps/mfe_products/src/app/remote-entry/product-shell.component.ts
import { Component, inject, DestroyRef } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Store } from '@ngrx/store';
import { ProductsPageActions } from '@shop/products-data-access';

@Component({
  selector: 'app-product-shell',
  standalone: true,
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
export class ProductShellComponent {
  private readonly store = inject(Store);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.store.dispatch(ProductsPageActions.clearState());
    });
  }
}
```

The reducer handles the cleanup by resetting to initial state:

```typescript
// libs/products/data-access/src/lib/+state/products.reducer.ts (excerpt)
on(ProductsPageActions.clearState, () => initialState)
```

## Implementing the Hybrid Pattern with SignalStore

SignalStore does not have a centralized root/feature registration model. Each SignalStore is an independent service resolved through Angular's dependency injection. This makes it naturally suited to the hybrid pattern: shared stores use `providedIn: 'root'`, and feature stores are provided at the route level.

The shared auth store lives in a shared library and is a root singleton:

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
import { withDevtools } from '@ngrx/signals/devtools';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { tapResponse } from '@ngrx/operators';
import { HttpClient } from '@angular/common/http';
import { pipe, switchMap } from 'rxjs';

export interface AuthUser {
  id: string;
  name: string;
  roles: string[];
}

interface AuthState {
  user: AuthUser | null;
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
  withDevtools('auth'),
  withState(initialState),
  withComputed(({ user, token }) => ({
    isAuthenticated: computed(() => token() !== null && user() !== null),
    userName: computed(() => user()?.name ?? 'Guest'),
    roles: computed(() => user()?.roles ?? []),
  })),
  withMethods((store, http = inject(HttpClient)) => ({
    setToken(token: string) {
      patchState(store, { token });
    },
    logout() {
      patchState(store, initialState);
    },
    loadProfile: rxMethod<void>(
      pipe(
        switchMap(() => {
          patchState(store, { loading: true });
          return http.get<AuthUser>('/api/auth/profile').pipe(
            tapResponse({
              next: (user) => patchState(store, { user, loading: false }),
              error: () => patchState(store, { user: null, loading: false }),
            })
          );
        })
      )
    ),
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

Because `@ngrx/signals` is shared as a singleton and the remote loads into the shell's injector tree, `inject(AuthStore)` in any remote resolves the same instance.

The products remote defines a feature-scoped store with no `providedIn`:

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
import { withDevtools } from '@ngrx/signals/devtools';
import { withEntities, setAllEntities } from '@ngrx/signals/entities';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { tapResponse } from '@ngrx/operators';
import { pipe, switchMap } from 'rxjs';
import { Product } from '@shop/shared-models';
import { ProductService } from './product.service';
import { AuthStore } from '@shop/shared-data-access-auth';

export const ProductsStore = signalStore(
  withDevtools('products'),
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
  withMethods(
    (
      store,
      productService = inject(ProductService),
      authStore = inject(AuthStore)
    ) => ({
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
      isAdmin: computed(() => authStore.roles().includes('admin')),
    })
  )
);
```

The store injects `AuthStore` to check user roles. This works because `AuthStore` is `providedIn: 'root'` and `@ngrx/signals` is a shared singleton. The `ProductsStore` itself is provided at the route level:

```typescript
// apps/mfe_products/src/app/remote-entry/entry.routes.ts
import { Route } from '@angular/router';
import { ProductsStore } from '@shop/products-data-access';

export const remoteRoutes: Route[] = [
  {
    path: '',
    providers: [ProductsStore],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./product-list.component').then(
            (m) => m.ProductListComponent
          ),
      },
      {
        path: ':id',
        loadComponent: () =>
          import('./product-detail.component').then(
            (m) => m.ProductDetailComponent
          ),
      },
    ],
  },
];
```

When the user navigates away from `/products`, Angular destroys the route's environment injector, and the `ProductsStore` instance is garbage collected. No manual cleanup action is needed. This is a significant advantage of SignalStore over Classic Store in micro-frontend architectures.

A component inside the remote uses both stores through injection:

```typescript
// apps/mfe_products/src/app/remote-entry/product-list.component.ts
import { Component, inject, OnInit } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { ProductsStore } from '@shop/products-data-access';
import { AuthStore } from '@shop/shared-data-access-auth';

@Component({
  selector: 'app-product-list',
  standalone: true,
  imports: [CurrencyPipe],
  template: `
    <h2>Products</h2>
    @if (authStore.isAuthenticated()) {
      <p>Welcome back, {{ authStore.userName() }}</p>
    }
    @if (productsStore.loading()) {
      <p>Loading...</p>
    } @else {
      @for (product of productsStore.entities(); track product.id) {
        <div class="product-card">
          <h3>{{ product.name }}</h3>
          <span>{{ product.price | currency }}</span>
        </div>
      }
    }
  `,
})
export class ProductListComponent implements OnInit {
  protected readonly productsStore = inject(ProductsStore);
  protected readonly authStore = inject(AuthStore);

  ngOnInit() {
    this.productsStore.loadAll();
  }
}
```

## The Async Boundary

Module Federation requires an async boundary so the runtime can negotiate shared dependency versions before any application code executes. Without this boundary, shared packages are loaded synchronously and version negotiation cannot happen.

The standard pattern moves the bootstrap call into a dynamically imported file:

```typescript
// apps/shell/src/main.ts
import('./bootstrap').catch((err) => console.error(err));
```

```typescript
// apps/shell/src/bootstrap.ts
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent, appConfig);
```

The dynamic `import()` in `main.ts` creates the async boundary. By the time `bootstrap.ts` executes, webpack's runtime has already resolved which version of each shared package to use. Both the shell and every remote must follow this pattern.

## Common Mistakes

### Mistake 1: Bootstrapping a Second Angular App in the Remote

```typescript
// apps/mfe_products/src/main.ts
// WRONG: this creates a second root injector
import { bootstrapApplication } from '@angular/platform-browser';
import { RemoteAppComponent } from './app/app.component';

bootstrapApplication(RemoteAppComponent, {
  providers: [provideStore({}), provideEffects()],
});
```

This creates a second Angular application with its own root injector. Every `providedIn: 'root'` service, including NgRx's `Store`, gets a second instance. The remote's store is empty because its `provideStore({})` does not include the shell's `auth` reducer. Actions dispatched in the shell never reach the remote's store.

The remote should expose routes only. When it needs to run standalone during development, use a separate `main.ts` entry point that is not exposed through Module Federation:

```typescript
// apps/mfe_products/src/app/remote-entry/entry.routes.ts
// CORRECT: export routes that load into the shell's router
import { Route } from '@angular/router';

export const remoteRoutes: Route[] = [
  {
    path: '',
    loadComponent: () =>
      import('./product-list.component').then(
        (m) => m.ProductListComponent
      ),
  },
];
```

### Mistake 2: Missing Singleton Configuration for State Libraries

```javascript
// webpack.config.js
// WRONG: @ngrx/store is not configured as singleton
module.exports = withModuleFederationPlugin({
  shared: share({
    '@angular/core': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@angular/router': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    // @ngrx/store is missing!
  }),
});
```

When `@ngrx/store` is not shared as a singleton, the shell and the remote each load their own copy. The remote's `provideState()` registers a feature slice in a different `Store` instance than the shell's `provideStore()` created. Selectors in the shell cannot see state from the remote. DevTools shows only the shell's store.

Always share all state-related packages as singletons:

```javascript
// webpack.config.js
// CORRECT: all NgRx packages are shared singletons
module.exports = withModuleFederationPlugin({
  shared: share({
    '@angular/core': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@angular/common': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@angular/common/http': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@angular/router': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@ngrx/store': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@ngrx/effects': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@ngrx/signals': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@ngrx/store-devtools': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    rxjs: { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  }),
});
```

### Mistake 3: Calling provideStoreDevtools in a Remote

```typescript
// apps/mfe_products/src/app/remote-entry/entry.routes.ts
// WRONG: DevTools should only be configured once in the shell
export const remoteRoutes: Route[] = [
  {
    path: '',
    providers: [
      provideState(productsFeature),
      provideEffects(ProductsEffects),
      provideStoreDevtools({ maxAge: 25 }),
    ],
    loadComponent: () =>
      import('./product-list.component').then((m) => m.ProductListComponent),
  },
];
```

The shell already called `provideStoreDevtools()`. Calling it again in a remote can cause duplicate DevTools connections and unpredictable behavior. DevTools configuration belongs exclusively to the shell.

Remove it from the remote:

```typescript
// apps/mfe_products/src/app/remote-entry/entry.routes.ts
// CORRECT: only provideState and provideEffects
export const remoteRoutes: Route[] = [
  {
    path: '',
    providers: [
      provideState(productsFeature),
      provideEffects(ProductsEffects),
    ],
    loadComponent: () =>
      import('./product-list.component').then((m) => m.ProductListComponent),
  },
];
```

### Mistake 4: Forgetting Transitive Dependencies in Shared Config

```javascript
// webpack.config.js
// WRONG: @shop/shared-data-access-auth depends on @ngrx/signals internally,
// but if @ngrx/signals is not shared, the shell and remote get separate copies
module.exports = withModuleFederationPlugin({
  shared: share({
    '@angular/core': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    // @ngrx/signals is missing, even though the shared auth library uses it
  }),
});
```

If `@shop/shared-data-access-auth` uses `signalStore` from `@ngrx/signals`, and `@ngrx/signals` is not in the shared config, the shell and the remote each bundle their own copy. The `AuthStore` singleton splits into two independent instances because the underlying `@ngrx/signals` runtime is different in each app.

The fix is to share every package that any shared library depends on. In Nx, the `withModuleFederation(config)` wrapper auto-discovers these transitive dependencies from the project graph. If you use manual `share()` configuration, audit the dependency chain of every shared library.

## Key Takeaways

- **The shell must call `provideStore()` exactly once.** This initializes the root store. Remotes register feature state with `provideState()` in their route providers, merging into the shell's store. Without the root store, remotes get `NullInjectorError: No provider for ReducerManager`.

- **Share all state libraries as singletons.** `@ngrx/store`, `@ngrx/effects`, `@ngrx/signals`, `rxjs`, and all Angular core packages must have `singleton: true` and `strictVersion: true` in the webpack shared configuration. Missing any one of them can create invisible duplicate state trees.

- **Use the hybrid pattern: shared global state plus isolated feature state.** Put authentication, feature flags, and user preferences in `providedIn: 'root'` stores that every remote can access. Put domain-specific state in route-scoped providers that are created when the remote loads and destroyed when the user navigates away.

- **Remotes expose routes, never root components.** A remote that calls `bootstrapApplication()` creates a second root injector, duplicating every `providedIn: 'root'` service. Expose a `Route[]` array from the remote entry, and let the shell's router load it via `loadChildren`.

- **SignalStore's route-scoped lifecycle is a natural fit for micro-frontends.** Unlike Classic Store, where feature reducers persist in memory after navigation, a SignalStore provided at the route level is garbage collected when the route is destroyed. This eliminates the need for manual state cleanup actions.
