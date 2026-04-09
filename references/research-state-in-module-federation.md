# Research: State in Module Federation

**Date:** 2026-04-09
**Chapter:** Ch 33
**Status:** Ready for chapter generation

## API Surface

### Webpack Module Federation (`ModuleFederationPlugin`)
- **Import path:** `webpack/lib/container/ModuleFederationPlugin`
- **Key config:** `shared: { singleton, strictVersion, requiredVersion, eager, shareScope }`
- **Stability:** Stable (Webpack 5)

### @module-federation/enhanced/runtime
- **Import path:** `@module-federation/enhanced/runtime`
- **Key functions:**
  - `loadRemote(id: string): Promise<Module>` -- loads a remote module at runtime
  - `registerRemotes(remotes: RemoteConfig[])` -- registers remote configurations dynamically
  - `init(options: InitOptions)` -- initializes the runtime with shared scope configuration
  - `getInstance()` -- gets the MF runtime instance
- **Stability:** Stable

### @angular-architects/module-federation
- **Import path:** `@angular-architects/module-federation`
- **Key functions:**
  - `share(config)` -- helper for shared config with `requiredVersion: 'auto'`
  - `shareAll(config)` -- shares all package.json dependencies (performance warning)
  - `withModuleFederationPlugin(config)` -- webpack config wrapper
- **Stability:** Stable (maintenance mode; Native Federation is the successor)

### Nx Module Federation
- **Import path:** `@nx/angular/module-federation`
- **Key functions:**
  - `withModuleFederation(config)` -- auto-discovers and shares dependencies from project graph
- **Stability:** Stable

### NgRx Classic Store (Standalone API)
- **Import path:** `@ngrx/store`
- **Key functions for MFE:**
  - `provideStore(reducers, config?)` -- initializes root store (host MUST call this)
  - `provideState(featureKey, reducer)` -- registers feature state (remotes use this)
- **Stability:** Stable

### NgRx Effects (Standalone API)
- **Import path:** `@ngrx/effects`
- **Key functions:**
  - `provideEffects(EffectsClasses)` -- registers effects (both host and remotes)
- **Stability:** Stable

### NgRx Store DevTools
- **Import path:** `@ngrx/store-devtools`
- **Key functions:**
  - `provideStoreDevtools(config)` -- host calls once; remotes must NOT call again
- **Stability:** Stable

### NgRx SignalStore
- **Import path:** `@ngrx/signals`
- **Key functions:**
  - `signalStore({ providedIn: 'root' }, ...)` -- global singleton (shared across MFEs)
  - `signalStore(...)` with route-level providers -- feature-scoped (isolated per remote)
  - `withDevtools(name)` -- DevTools integration per store instance
- **Stability:** Stable

## Key Concepts

### The Root Injector Problem
- Angular creates one root injector per bootstrapped application
- In Module Federation, if a remote bootstraps its own app, it creates a SEPARATE root injector
- Services with `providedIn: 'root'` become separate instances in shell and remote
- **Solution:** Remotes must expose lazy feature routes, NOT root components. The shell bootstraps the single Angular application, and remotes load into the shell's router/injector tree.

### Singleton Sharing is Mandatory for State Libraries
- `@angular/core`, `@ngrx/store`, `@ngrx/signals`, `rxjs` MUST be configured as `singleton: true`
- Without singleton sharing, each federated app loads its own copy, creating independent state trees
- `strictVersion: true` catches version mismatches at runtime (fails fast vs. silent bugs)
- `requiredVersion: 'auto'` reads from package.json

### Three Architectural Patterns for State Boundaries

**Pattern A: Fully Isolated State Per Remote**
- Each remote owns its entire state, no shared store
- Cross-MFE communication via browser APIs (CustomEvent, BroadcastChannel)
- Best for: multi-framework MFEs, maximum team autonomy
- Drawback: no shared auth/user state through the store

**Pattern B: Shared Global State**
- Host initializes root store; all remotes register feature states into it
- Single unified state tree visible in DevTools
- Best for: tightly integrated teams, single Angular version
- Drawback: tight coupling, version lock-in, one remote's bug can corrupt shared state

**Pattern C: Hybrid (Recommended)**
- Shared global state for cross-cutting concerns (auth, theme, feature flags)
- Isolated feature state per remote (product catalog, order workflow, form state)
- Balances team autonomy with shared cross-cutting concerns
- Best for: most real-world MFE architectures

### NgRx Classic Store in MFE
- Host calls `provideStore({})` to initialize the root store
- Each remote calls `provideState(featureKey, reducer)` in its route providers
- Feature states merge into the single store when the remote is lazy-loaded
- Feature reducers persist even after the remote is navigated away (NgRx intentional design)
- Dispatch a cleanup action to reset feature state on navigation away

### NgRx SignalStore in MFE
- No centralized root/feature model like Classic Store
- Each SignalStore is an independent service
- `providedIn: 'root'` makes it a singleton within the root injector tree (shared across MFEs when singleton-shared)
- Route-level providers create isolated instances per remote (safer for MFEs)
- Naturally suited to the Hybrid pattern: shared auth SignalStore + isolated feature SignalStores

### Cross-MFE Communication Patterns
1. **Shared Singleton Service** (RxJS Subject or NgRx Store) -- best type safety, requires singleton config
2. **Custom DOM Events** (`window.dispatchEvent(new CustomEvent(...))`) -- zero dependencies, no type safety
3. **BroadcastChannel API** -- works across tabs, payloads must be serializable
4. **Shell Orchestration** -- shell subscribes to Remote A events and passes data to Remote B via inputs
5. **NgRx Events Plugin** (`withEventHandlers`) -- event-driven SignalStore, good for decoupled MFEs

### The Transitive Dependency Problem
- If library A is shared as singleton but its dependency B is NOT shared, state splits
- Example: `auth-lib` (shared) depends on `utils-lib` (not shared) -- state set via auth-lib in shell is invisible when reading utils-lib directly in remote
- **Solution:** Share ALL transitive dependencies. Nx's `withModuleFederation` auto-discovers from project graph.

## Code Patterns

### Host Bootstrap Configuration
```typescript
// apps/shell/src/main.ts
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent, appConfig);
```

```typescript
// apps/shell/src/app/app.config.ts
import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideStore } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { authReducer } from '@myorg/shared/data-access-auth';
import { AuthEffects } from '@myorg/shared/data-access-auth';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideStore({ auth: authReducer }),
    provideEffects(AuthEffects),
    provideStoreDevtools({ maxAge: 25 }),
  ],
};
```

### Shell Routes with Dynamic Remotes
```typescript
// apps/shell/src/app/app.routes.ts
import { loadRemote } from '@module-federation/enhanced/runtime';
import { Route } from '@angular/router';

export const routes: Route[] = [
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

### Remote Feature State Registration (Classic Store)
```typescript
// libs/products/data-access/src/lib/products.state.ts
import { createFeature, createReducer, on } from '@ngrx/store';
import { ProductsActions } from './products.actions';
import { Product } from '@myorg/shared/models';

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

export const productsFeature = createFeature({
  name: 'products',
  reducer: createReducer(
    initialState,
    on(ProductsActions.loadProducts, (state) => ({
      ...state,
      loading: true,
    })),
    on(ProductsActions.loadProductsSuccess, (state, { products }) => ({
      ...state,
      products,
      loading: false,
    })),
    on(ProductsActions.loadProductsFailure, (state, { error }) => ({
      ...state,
      error,
      loading: false,
    }))
  ),
});
```

```typescript
// apps/mfe_products/src/app/remote-entry/entry.routes.ts
import { Route } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { productsFeature } from '@myorg/products/data-access';
import { ProductsEffects } from '@myorg/products/data-access';

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

### Shared SignalStore (Global Auth State)
```typescript
// libs/shared/data-access-auth/src/lib/auth.store.ts
import { signalStore, withState, withComputed, withMethods } from '@ngrx/signals';
import { computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { User } from '@myorg/shared/models';

interface AuthState {
  user: User | null;
  token: string;
  loading: boolean;
}

const initialState: AuthState = {
  user: null,
  token: '',
  loading: false,
};

export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed((store) => ({
    isAuthenticated: computed(() => !!store.token()),
    userName: computed(() => store.user()?.name ?? 'Guest'),
  })),
  withMethods((store, http = inject(HttpClient)) => ({
    // login, logout, etc.
  }))
);
```

### Isolated Feature SignalStore (Route-Scoped)
```typescript
// libs/products/data-access/src/lib/product.store.ts
import { signalStore, withState, withMethods } from '@ngrx/signals';
import { withEntities } from '@ngrx/signals/entities';
import { inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AuthStore } from '@myorg/shared/data-access-auth';
import { Product } from '@myorg/shared/models';

export const ProductStore = signalStore(
  // No providedIn -- will be provided at route level
  withEntities<Product>(),
  withState({ loading: false, error: null as string | null }),
  withMethods((store, http = inject(HttpClient), authStore = inject(AuthStore)) => ({
    async loadProducts() {
      // Can READ from shared AuthStore
      // Product state is isolated to this remote's route tree
    },
  }))
);
```

```typescript
// apps/mfe_products/src/app/remote-entry/entry.routes.ts
import { Route } from '@angular/router';
import { ProductStore } from '@myorg/products/data-access';

export const remoteRoutes: Route[] = [
  {
    path: '',
    providers: [ProductStore],
    loadComponent: () =>
      import('./product-list.component').then((m) => m.ProductListComponent),
  },
];
```

### Webpack Shared Configuration
```javascript
// webpack.config.js (host or remote)
const { share, withModuleFederationPlugin } = require('@angular-architects/module-federation/webpack');

module.exports = withModuleFederationPlugin({
  shared: share({
    '@angular/core': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@angular/common': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@angular/router': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@ngrx/store': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@ngrx/effects': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@ngrx/signals': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@ngrx/store-devtools': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    rxjs: { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  }),
});
```

### Feature State Cleanup on Navigation
```typescript
// libs/products/data-access/src/lib/products.actions.ts
import { createActionGroup, emptyProps } from '@ngrx/store';

export const ProductsActions = createActionGroup({
  source: 'Products',
  events: {
    'Load Products': emptyProps(),
    'Load Products Success': props<{ products: Product[] }>(),
    'Load Products Failure': props<{ error: string }>(),
    'Clear Products State': emptyProps(),
  },
});
```

```typescript
// In the reducer
on(ProductsActions.clearProductsState, () => initialState)
```

```typescript
// In a route guard or component
import { DestroyRef, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { ProductsActions } from '@myorg/products/data-access';

export class ProductShellComponent {
  private store = inject(Store);
  private destroyRef = inject(DestroyRef);

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.store.dispatch(ProductsActions.clearProductsState());
    });
  }
}
```

### Cross-MFE Communication via Custom Events
```typescript
// libs/shared/util-events/src/lib/mfe-events.ts
export interface CartItemAddedEvent {
  productId: number;
  quantity: number;
}

export function emitCartItemAdded(detail: CartItemAddedEvent): void {
  window.dispatchEvent(
    new CustomEvent('cart:item-added', { detail })
  );
}

export function onCartItemAdded(
  callback: (event: CartItemAddedEvent) => void
): () => void {
  const handler = (e: Event) => callback((e as CustomEvent).detail);
  window.addEventListener('cart:item-added', handler);
  return () => window.removeEventListener('cart:item-added', handler);
}
```

### The bootstrap.ts Async Boundary Pattern
```typescript
// apps/shell/src/main.ts
import('./bootstrap').catch((err) => console.error(err));

// apps/shell/src/bootstrap.ts
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent, appConfig);
```

## Breaking Changes and Gotchas

### Critical Gotchas

1. **Not sharing `@angular/core` as singleton** -- Multiple Angular instances, broken DI, `inject() must be called from an injection context` errors.

2. **Exposing AppModule/AppComponent from remote as root** -- Creates duplicate root injectors. Remote must expose lazy feature routes only, not a bootstrappable root.

3. **Incomplete transitive sharing** -- Shared lib's dependencies not shared causes state split. If `auth-lib` (shared) depends on `utils-lib` (not shared), each app gets its own `utils-lib` instance.

4. **`eager: true` on shared deps** -- Bloats `remoteEntry.js` and prevents version negotiation. Use the `bootstrap.ts` async boundary pattern instead.

5. **Missing `provideStore()` in host** -- `NullInjectorError: No provider for ReducerManager!` when remotes use `provideState()`.

6. **Multiple SignalStore instances** -- `providedIn: 'root'` creates separate instances if `@ngrx/signals` is not shared as singleton.

7. **NgRx feature state persists after navigation** -- Feature reducers are NOT removed when lazy routes are destroyed. State slice remains in store and DevTools. Dispatch a cleanup action to reset.

8. **`shareAll()` performance penalty** -- Shares every package.json dependency as separate chunks. Use explicit `share()` with only needed libraries.

9. **Race condition with parallel remote loading** -- When 10+ remotes load simultaneously via `loadRemote()`, singleton shared dependencies may load multiple times due to incomplete share scope at initialization.

10. **DevTools duplication** -- Host must call `provideStoreDevtools()` once. If a remote also calls it, behavior is undefined.

11. **Secondary entry point sharing** -- `@angular/common/http` must be explicitly declared in shared config; it is not automatically covered by sharing `@angular/common`.

12. **ChunkLoadError after redeployment** -- Stale `remoteEntry.js` cache causes 404s for chunk files with new hashes. Use `@module-federation/retry-plugin` or implement version-checking reload.

13. **InjectionToken instances cannot cross MFE boundaries** -- Each boundary creates a new token instance. Share the library containing the token definition as a singleton instead.

### NgRx v21 Specific
- `withEffects()` renamed to `withEventHandlers()` in NgRx v21. This affects the Events Plugin chapter (Ch 19) but is relevant here when discussing event-driven cross-MFE patterns.
- All `@ngrx/signals` imports should be verified against the installed v21.1.0 package.

### Module Federation 2.0 (Stable April 2026)
- Dynamic TypeScript type hints: auto-generates types for remote modules, eliminating `declare module 'remote/Routes'` hacks
- Runtime is now bundler-agnostic (webpack, Rspack, Rollup, Vite)
- Side Effect Scanner: CLI tool that detects global variable pollution (critical for state management)
- `mf-manifest.json` standardized protocol for deployment platforms

### Native Federation Transition
- `@angular-architects/module-federation-plugin` is in maintenance mode
- **Native Federation** (`@angular-architects/native-federation`) uses browser-native ESM imports via esbuild
- Same mental model (shared singletons, remote entries, host/remote boundaries)
- All state management patterns apply equally

## Sources

### Official Documentation
- [Webpack Module Federation Concepts](https://webpack.js.org/concepts/module-federation/)
- [Module Federation Shared Configuration](https://module-federation.io/configure/shared)
- [Angular MFE Guide - module-federation.io](https://module-federation.io/practice/frameworks/angular/angular-mfe)
- [NgRx Store DevTools Guide](https://ngrx.io/guide/store-devtools)
- [Nx Dynamic Module Federation Guide](https://nx.dev/docs/technologies/angular/guides/dynamic-module-federation-with-angular)
- [Nx Module Federation Concepts](https://nx.dev/concepts/module-federation/module-federation-and-nx)

### Expert Articles (Angular Architects / Manfred Steyer)
- [Pitfalls with Module Federation and Angular](https://www.angulararchitects.io/en/blog/pitfalls-with-module-federation-and-angular/)
- [Getting Out of Version-Mismatch-Hell](https://www.angulararchitects.io/en/blog/getting-out-of-version-mismatch-hell-with-module-federation/)
- [NgRx SignalStore and Your Architecture](https://www.angulararchitects.io/blog/the-ngrx-signal-store-and-your-architecture/)
- [Module Federation with Angular Standalone Components](https://www.angulararchitects.io/en/blog/module-federation-with-angulars-standalone-components/)
- [Free eBook: Micro Frontends & Moduliths with Angular](https://www.angulararchitects.io/en/ebooks/micro-frontends-and-moduliths-with-angular/)
- [withDevtools() - NgRx Toolkit](https://ngrx-toolkit.angulararchitects.io/docs/with-devtools)

### Community Articles
- [Building Angular MFE with NgRx State Sharing](https://medium.com/@varun.singh_99751/building-angular-micro-frontend-with-ngrx-state-sharing-as-well-as-nx-cli-cffa7b8cd43a)
- [Communication Patterns in Microfrontends](https://medium.com/@mfflik/communication-patterns-in-microfrontends-with-webpack-module-federation-shared-store-event-bus-ae2a1ed031a6)
- [Think Twice Before Sharing a Dependency](https://medium.com/@marvusm.mmi/webpack-module-federation-think-twice-before-sharing-a-dependency-18b3b0e352cb)
- [Sharing NgRx state between modules is peanuts - Tim Deschryver](https://timdeschryver.dev/blog/sharing-data-between-modules-is-peanuts)
- [State Management in Module Federation Examples - DeepWiki](https://deepwiki.com/module-federation/module-federation-examples/3.3-state-management)
- [Module Federation 2.0 Stable Release - InfoQ](https://www.infoq.com/news/2026/04/module-federation-2-stable/)
- [NGXS Module Federation Recipe](https://www.ngxs.io/recipes/module-federation)

### GitHub Issues and Discussions
- [Share NgRx store from host to remotes - angular-architects#11](https://github.com/angular-architects/module-federation-plugin/issues/11)
- [Share NgRx store and save to localStorage - angular-architects#715](https://github.com/angular-architects/module-federation-plugin/issues/715)
- [Unable to share NgRx state in multi-version MFE - angular-architects#522](https://github.com/angular-architects/module-federation-plugin/issues/522)
- [NgRx feature state removal RFC - ngrx#972](https://github.com/ngrx/platform/issues/972)
- [NgRx featured store destroyed prematurely - ngrx#3284](https://github.com/ngrx/platform/issues/3284)
- [Remove Reducers - ngrx#3455](https://github.com/ngrx/platform/issues/3455)
- [Enable Signal Store Injection at Module Level - ngrx#4590](https://github.com/ngrx/platform/discussions/4590)
- [Angular singleton service initiated multiple times - mf-examples#904](https://github.com/module-federation/module-federation-examples/issues/904)
- [Singleton Instance Issue with Secondary Entry Points - nx#28194](https://github.com/nrwl/nx/issues/28194)
- [Federation loading singleton multiple times (concurrency) - mf-core#3590](https://github.com/module-federation/core/issues/3590)
- [ChunkLoadError in Angular MFE - angular-architects#737](https://github.com/angular-architects/module-federation-plugin/issues/737)
- [providedIn platform Issue - angular#45403](https://github.com/angular/angular/issues/45403)
- [Shared Dependencies Deep Dive - edumserrano](https://github.com/edumserrano/webpack-module-federation-with-angular/blob/main/docs/shared.md)
- [Native Federation is moving - angular-architects#1044](https://github.com/angular-architects/module-federation-plugin/issues/1044)

### Reference Repositories
- [webpack-module-federation-with-angular](https://github.com/edumserrano/webpack-module-federation-with-angular) -- comprehensive demos including communication patterns
- [mfe-advanced-demo](https://github.com/benorama/mfe-advanced-demo) -- advanced MFE architecture demo

## Open Questions

1. **NgRx official MFE guidance:** There is NO official NgRx documentation on micro-frontends or Module Federation. All guidance comes from community sources. Check ngrx.io periodically for updates.

2. **SignalStore `withDevtools()` across MFEs:** Verify that `withDevtools()` from `@ngrx/signals` (not `@angular-architects/ngrx-toolkit`) works correctly when multiple SignalStores from different remotes register simultaneously in DevTools.

3. **Native Federation maturity:** `@angular-architects/native-federation` is the successor to the webpack-based plugin. Verify its maturity and whether it handles singleton sharing the same way before recommending it in the chapter.

4. **Module Federation 2.0 Side Effect Scanner:** Verify this tool's availability and whether it can detect NgRx-specific global state leaks. The feature was announced but practical usage details may be limited.

5. **`providedIn: 'platform'` status:** Angular docs say it's "intended for Angular-internal use." Verify if this stance has changed in Angular 21. The mfe-platform codebase does not use it, and it should likely remain an anti-pattern recommendation.
