# Research: Shared State Across Micro-Frontends

**Date:** 2026-04-09
**Chapter:** Ch 35
**Status:** Ready for chapter generation

## API Surface

### Module Federation Enhanced Runtime (`@module-federation/enhanced/runtime`)

| API | Signature | Stability |
|-----|-----------|-----------|
| `createInstance` | `createInstance(options: InitOptions): ModuleFederation` | Stable |
| `getInstance` | `getInstance(): ModuleFederation` | Stable |
| `loadRemote` | `loadRemote<T>(id: string): Promise<T \| null>` | Stable |
| `registerRemotes` | `registerRemotes(remotes: Remote[], options?: { force?: boolean }): void` | Stable |
| `registerShared` | `registerShared(shared: { [pkgName: string]: ShareArgs \| ShareArgs[] }): void` | Stable |
| `preloadRemote` | `preloadRemote(options: PreloadRemoteArgs[]): Promise<void>` | Stable |
| `loadShare` | `loadShare(pkgName: string, extraOptions?): Promise<() => Module>` | Stable |
| `init` | `init(options: InitOptions): ModuleFederation` | **Deprecated** -- use `createInstance` or `getInstance` + `registerRemotes` |

**Note:** `init` is deprecated. Migration: with build plugin use `getInstance()` + `registerRemotes/Shared/Plugins`; pure runtime use `createInstance()`.

### SharedConfig Interface (Webpack / Module Federation)

```typescript
interface SharedConfig {
  singleton?: boolean;           // Single instance across remotes
  requiredVersion: false | string; // Version constraint ('auto' reads package.json)
  eager?: boolean;               // Load before app initialization (avoid for shared deps)
  strictVersion?: boolean;       // Enforce exact version match (throws vs warns)
  layer?: string | null;         // Sharing scope layer
  shareScope?: string;           // Named share scope
}
```

### NgRx SignalStore (from `@ngrx/signals`)

| API | Import Path | Stability |
|-----|-------------|-----------|
| `signalStore` | `@ngrx/signals` | Stable |
| `withState` | `@ngrx/signals` | Stable |
| `withComputed` | `@ngrx/signals` | Stable |
| `withMethods` | `@ngrx/signals` | Stable |
| `patchState` | `@ngrx/signals` | Stable |
| `signalStoreFeature` | `@ngrx/signals` | Stable |
| `withHooks` | `@ngrx/signals` | Stable |

### NgRx SignalStore Events Plugin (from `@ngrx/signals/events`)

| API | Import Path | Stability |
|-----|-------------|-----------|
| `eventGroup` | `@ngrx/signals/events` | **Stable (promoted in NgRx 21)** |
| `withReducer` | `@ngrx/signals/events` | Stable |
| `on` | `@ngrx/signals/events` | Stable |
| `withEventHandlers` | `@ngrx/signals/events` | Stable |
| `Events` | `@ngrx/signals/events` | Stable |
| `injectDispatch` | `@ngrx/signals/events` | Stable |

**Scoped Events (NgRx 21):**
```typescript
const dispatch = injectDispatch(SomeEvents, { scope: 'self' });
// scope: 'self' (default) -- local to component
// scope: 'parent' -- propagates to parent injector
// scope: 'global' -- application-wide broadcasting
```

### NgRx Classic Store (from `@ngrx/store`)

| API | Import Path | Stability |
|-----|-------------|-----------|
| `provideStore` | `@ngrx/store` | Stable |
| `provideState` | `@ngrx/store` | Stable |
| `provideEffects` | `@ngrx/effects` | Stable |
| `provideStoreDevtools` | `@ngrx/store-devtools` | Stable |
| `Store` | `@ngrx/store` | Stable |

## Key Concepts

### 1. The Fundamental Tension
- Micro-frontends want **independence** (deploy separately, own their tech stack)
- Shared state creates **coupling** (coordinated versions, shared contracts)
- The goal is minimal, well-defined shared state with maximum feature-level autonomy

### 2. Three Patterns for Shared State

**Pattern A: Shared Singleton Store (via DI)**
- Host provides `provideStore({})` or a root-level `signalStore({ providedIn: 'root' })`
- Remotes register feature slices via `provideState()` or component-level SignalStores
- Requires: singleton sharing of `@ngrx/store`, `@ngrx/signals`, `@angular/core` in webpack config
- Requires: remotes NEVER call `bootstrapApplication()` -- they expose route arrays, not standalone apps
- The single Angular injector tree ensures `providedIn: 'root'` services are truly singleton

**Pattern B: Shared Services via Public API (Anti-Corruption Layer)**
- Each MFE exposes a `public-api.ts` with facades/adapters
- Internal state management is hidden (could be SignalStore, Classic Store, or plain signals)
- Consumers interact only through the public API contract
- Decouples internal implementation from external consumers
- Recommended by Manfred Steyer / Angular Architects for large-scale MFE platforms

**Pattern C: Event-Based Communication (Loose Coupling)**
- MFEs communicate via CustomEvents on `window`, BroadcastChannel, or a shared message bus
- No shared DI context required
- Works across frameworks (Angular + React MFEs)
- Best for: notifications, navigation events, user-action signals
- Worst for: shared CRUD state, real-time synchronized data

### 3. NgRx Scoped Events for MFE Architecture (NgRx 21)
- `scope: 'self'` -- events stay within the local store (feature MFE isolation)
- `scope: 'parent'` -- events bubble to parent injector (feature-to-shell communication)
- `scope: 'global'` -- events broadcast application-wide (cross-MFE coordination)
- This is the NgRx-native solution for controlling event visibility across MFE boundaries

### 4. Webpack Shared Scope Configuration
- `singleton: true` + `strictVersion: true` is mandatory for Angular core, NgRx, and RxJS
- `requiredVersion: 'auto'` reads from package.json to avoid hardcoded version drift
- Secondary entry points (`@angular/common/http`, `@ngrx/signals/events`) must be listed explicitly
- `eager: true` should be avoided -- it bloats remoteEntry.js and prevents version negotiation
- All monorepo libraries used across MFE boundaries must be registered in `sharedMappings`

### 5. The Root Injector Rule
- Each call to `bootstrapApplication()` creates a new root injector
- If shell and remote each bootstrap, `providedIn: 'root'` services get duplicated
- **Rule:** Remotes expose lazy route arrays; only the shell bootstraps
- When remotes are lazy-loaded via `loadChildren`, their services resolve in the shell's injector tree

### 6. Dynamic Remotes and State Registration
- With `@module-federation/enhanced/runtime`, remotes can appear at runtime
- State slices must be registered lazily (via `provideState()` in route providers or component-level stores)
- The shell cannot know at build time which feature states will exist
- `registerRemotes()` + `loadRemote()` handle the runtime discovery
- State cleanup when a remote is unloaded is the team's responsibility (no automatic teardown)

## Code Patterns

### Pattern 1: Shared AuthStore as Singleton SignalStore

```typescript
// libs/shared/data-access-auth/src/lib/auth.store.ts
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { pipe, switchMap, tap } from 'rxjs';
import { rxMethod } from '@ngrx/signals/rxjs-interop';

interface AuthState {
  user: User | null;
  status: 'idle' | 'loading' | 'authenticated' | 'error';
}

export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState<AuthState>({ user: null, status: 'idle' }),
  withComputed(({ user }) => ({
    isAuthenticated: computed(() => user() !== null),
    displayName: computed(() => {
      const u = user();
      return u ? `${u.firstName} ${u.lastName}` : 'Guest';
    }),
  })),
  withMethods((store, http = inject(HttpClient)) => ({
    login: rxMethod<LoginRequest>(
      pipe(
        tap(() => patchState(store, { status: 'loading' })),
        switchMap((creds) =>
          http.post<User>('/api/auth/login', creds).pipe(
            tap((user) => patchState(store, { user, status: 'authenticated' })),
          )
        ),
      )
    ),
    logout() {
      patchState(store, { user: null, status: 'idle' });
    },
  })),
);
```

### Pattern 2: Remote Registering Feature State (Classic Store)

```typescript
// apps/mfe_products/src/app/remote-entry/entry.routes.ts
import { Route } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { productsFeature } from '@mfe-platform/products-data-access';
import { ProductsEffects } from '@mfe-platform/products-data-access';

export const remoteRoutes: Route[] = [
  {
    path: '',
    providers: [
      provideState(productsFeature),
      provideEffects(ProductsEffects),
    ],
    children: [
      { path: '', loadComponent: () => import('./product-list.component').then(m => m.ProductListComponent) },
      { path: ':id', loadComponent: () => import('./product-detail.component').then(m => m.ProductDetailComponent) },
    ],
  },
];
```

### Pattern 3: Webpack Config for Shared NgRx Singleton

```javascript
// apps/shell/webpack.config.js
const { share, withModuleFederationPlugin } = require('@angular-architects/module-federation/webpack');

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
    '@ngrx/signals/events': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@ngrx/store-devtools': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    rxjs: { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  }),
});
```

### Pattern 4: Anti-Corruption Layer (Public API Facade)

```typescript
// apps/mfe_products/public-api.ts
// This is what the remote exposes -- a stable contract
import { InjectionToken } from '@angular/core';
import { Signal } from '@angular/core';

export interface ProductsCatalogApi {
  readonly featuredProducts: Signal<ProductSummary[]>;
  readonly selectedProduct: Signal<ProductSummary | null>;
  selectProduct(id: number): void;
}

export interface ProductSummary {
  id: number;
  title: string;
  price: number;
  thumbnail: string;
}

export const PRODUCTS_CATALOG_API = new InjectionToken<ProductsCatalogApi>('ProductsCatalogApi');
```

```typescript
// libs/products/feature/src/lib/products-catalog-adapter.ts
// Internal implementation -- hidden from consumers
import { Injectable, inject, computed } from '@angular/core';
import { ProductsCatalogApi, ProductSummary } from '@mfe-products/public-api';
import { ProductsStore } from '@mfe-platform/products-data-access';

@Injectable()
export class ProductsCatalogAdapter implements ProductsCatalogApi {
  private readonly store = inject(ProductsStore);

  readonly featuredProducts = computed(() =>
    this.store.products().map((p) => ({
      id: p.id,
      title: p.title,
      price: p.price,
      thumbnail: p.thumbnail,
    }))
  );

  readonly selectedProduct = computed(() => {
    const p = this.store.selectedProduct();
    return p ? { id: p.id, title: p.title, price: p.price, thumbnail: p.thumbnail } : null;
  });

  selectProduct(id: number): void {
    this.store.loadProduct(id);
  }
}
```

### Pattern 5: Event-Based Cross-MFE Communication

```typescript
// libs/shared/util-event-bus/src/lib/event-bus.service.ts
import { Injectable, signal, computed } from '@angular/core';
import { Subject, filter, map } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';

export interface MfeEvent<T = unknown> {
  type: string;
  source: string;
  payload: T;
  timestamp: number;
}

@Injectable({ providedIn: 'root' })
export class EventBusService {
  private readonly events$ = new Subject<MfeEvent>();

  emit<T>(type: string, source: string, payload: T): void {
    this.events$.next({ type, source, payload, timestamp: Date.now() });
  }

  on<T>(type: string) {
    return this.events$.pipe(
      filter((e) => e.type === type),
      map((e) => e.payload as T),
    );
  }

  onSignal<T>(type: string) {
    return toSignal(this.on<T>(type), { initialValue: undefined });
  }
}
```

### Pattern 6: NgRx Scoped Events for MFE Boundaries

```typescript
// libs/shared/util-mfe-events/src/lib/mfe-events.ts
import { eventGroup, type } from '@ngrx/signals/events';

// Globally scoped events -- all MFEs can listen
export const PlatformEvents = eventGroup({
  source: 'Platform Shell',
  events: {
    userAuthenticated: type<{ userId: number; token: string }>(),
    userLoggedOut: type<void>(),
    themeChanged: type<{ theme: 'light' | 'dark' }>(),
    navigationRequested: type<{ path: string; queryParams?: Record<string, string> }>(),
  },
});

// Feature-scoped events -- stay within the products MFE
export const ProductsEvents = eventGroup({
  source: 'Products MFE',
  events: {
    productSelected: type<{ productId: number }>(),
    filtersChanged: type<{ category: string; priceRange: [number, number] }>(),
    addedToCart: type<{ productId: number; quantity: number }>(),
  },
});
```

```typescript
// In shell component -- dispatch globally
import { injectDispatch } from '@ngrx/signals/events';
import { PlatformEvents } from '@mfe-platform/shared-mfe-events';

export class ShellComponent {
  private readonly dispatch = injectDispatch(PlatformEvents, { scope: 'global' });

  onLogin(userId: number, token: string) {
    this.dispatch.userAuthenticated({ userId, token });
  }
}
```

```typescript
// In products MFE store -- listen globally, dispatch locally
import { withEventHandlers, Events, injectDispatch } from '@ngrx/signals/events';
import { PlatformEvents, ProductsEvents } from '@mfe-platform/shared-mfe-events';

export const ProductsStore = signalStore(
  withState<ProductsState>(initialState),
  withReducer(
    on(PlatformEvents.userAuthenticated, (state) => ({
      ...state,
      canPurchase: true,
    })),
  ),
  withEventHandlers((store, events = inject(Events)) => ({
    onProductSelected$: events
      .on(ProductsEvents.productSelected)
      .pipe(
        switchMap(({ payload }) => productService.getById(payload.productId)),
      ),
  })),
);
```

### Pattern 7: BroadcastChannel for Cross-Tab State Sync

```typescript
// libs/shared/util-cross-tab/src/lib/cross-tab-sync.service.ts
import { Injectable, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';

export interface CrossTabMessage<T = unknown> {
  type: string;
  payload: T;
}

@Injectable({ providedIn: 'root' })
export class CrossTabSyncService implements OnDestroy {
  private readonly channel = new BroadcastChannel('mfe-platform-sync');
  private readonly messages$ = new Subject<CrossTabMessage>();

  constructor() {
    this.channel.onmessage = (event: MessageEvent<CrossTabMessage>) => {
      this.messages$.next(event.data);
    };
  }

  broadcast<T>(type: string, payload: T): void {
    this.channel.postMessage({ type, payload });
  }

  on<T>(type: string) {
    return this.messages$.pipe(
      filter((msg) => msg.type === type),
      map((msg) => msg.payload as T),
    );
  }

  ngOnDestroy(): void {
    this.channel.close();
  }
}
```

## Anti-Patterns and Common Mistakes

### Anti-Pattern 1: Exposing AppModule/AppComponent from Remote
- **Problem:** Creates a second root injector, duplicating all `providedIn: 'root'` services
- **Symptom:** User appears logged out when navigating to remote; store has no data
- **Fix:** Expose route arrays only, never the remote's root component

### Anti-Pattern 2: Direct Store Access Across MFE Boundaries
- **Problem:** Remote directly injects shell's store and selects from it
- **Symptom:** Tight coupling; changing the shell's state shape breaks all remotes
- **Fix:** Use a facade/adapter (Anti-Corruption Layer) or scoped events

### Anti-Pattern 3: Sharing Too Much State
- **Problem:** Putting all state in a global store so every MFE can access it
- **Symptom:** Unclear ownership; race conditions; one team's refactor breaks another's feature
- **Fix:** Minimize shared state to authentication, theme, and navigation. Feature state stays local.

### Anti-Pattern 4: Missing Shared Dependency Configuration
- **Problem:** Forgetting to add `@ngrx/signals` or secondary entry points to webpack shared config
- **Symptom:** Two copies of NgRx load; store appears empty in remote
- **Fix:** Explicitly share all NgRx packages and secondary entry points with `singleton: true`

### Anti-Pattern 5: Using `eager: true` for Shared Dependencies
- **Problem:** Bloats remoteEntry.js; prevents version negotiation at runtime
- **Symptom:** Larger initial bundles; version conflicts not caught until runtime
- **Fix:** Never use `eager: true` for shared dependencies

### Anti-Pattern 6: Chatty Inter-MFE Communication
- **Problem:** MFEs emit events for every state change, creating a noisy event bus
- **Symptom:** Hard to debug; performance degradation; cascade failures
- **Fix:** Only emit events when there are known subscribers; use coarse-grained events

### Anti-Pattern 7: No Version Contract on Shared Libraries
- **Problem:** Teams update shared libs independently without version pinning
- **Symptom:** Runtime errors from incompatible API changes; `strictVersion` errors in production
- **Fix:** Use `strictVersion: true` + `requiredVersion: 'auto'`; enforce version alignment in CI

### Anti-Pattern 8: Storing Sensitive Data in CustomEvents/BroadcastChannel
- **Problem:** Broadcasting auth tokens or PII over window events
- **Symptom:** Any script on the page can intercept sensitive data
- **Fix:** Keep auth state in DI-scoped services; only broadcast non-sensitive identifiers

## Breaking Changes and Gotchas

### NgRx 21
- `withEffects()` renamed to `withEventHandlers()` in `@ngrx/signals/events`
- Migration schematic available: `ng update @ngrx/signals --migrate-only`
- `@ngrx/signals/events` promoted from experimental to stable
- Scoped events added (`scope: 'self' | 'parent' | 'global'`) -- new in NgRx 21
- Requires Angular 21.x, TypeScript 5.9.x, RxJS ^6.5.x or ^7.5.x

### Module Federation Enhanced Runtime
- `init()` deprecated in favor of `createInstance()` (same parameters)
- Use `getInstance()` to retrieve the build-plugin-created instance
- `registerRemotes()` replaces the older dynamic remote patterns
- `__FEDERATION__.__INSTANCES__` available in browser console for debugging

### Angular 21
- Zoneless by default -- do not include `provideZoneChangeDetection()`
- `OnPush` is effectively the default behavior in zoneless mode
- Signal-based forms are experimental (not directly MFE-related but affects shared form state)

### Webpack/Module Federation Gotchas
- Secondary entry points (e.g., `@angular/common/http`, `@ngrx/signals/events`) are separate packages and must be shared explicitly
- Even with `singleton: true`, Angular services are only singleton if they resolve in the same injector tree
- `shareAll()` is convenient for prototyping but can cause unexpected version conflicts in production
- Module Federation generates duplicate bundles per shared library per consumer -- only one loads at runtime

## Sources

### Official Documentation
- [NgRx SignalStore Guide](https://ngrx.io/guide/signals/signal-store)
- [NgRx Custom Store Features](https://ngrx.io/guide/signals/signal-store/custom-store-features)
- [NgRx Events Plugin](https://ngrx.io/guide/signals/signal-store/events)
- [Module Federation Runtime API](https://module-federation.io/guide/runtime/runtime-api)
- [Module Federation Angular Practice](https://module-federation.io/practice/frameworks/angular/angular-mfe)
- [Nx Dynamic Module Federation with Angular](https://nx.dev/docs/technologies/angular/guides/dynamic-module-federation-with-angular)
- [@module-federation/enhanced npm](https://www.npmjs.com/package/@module-federation/enhanced)

### Blog Posts and Articles
- [Pitfalls with Module Federation and Angular - Angular Architects](https://www.angulararchitects.io/en/blog/pitfalls-with-module-federation-and-angular/)
- [The NgRx Signal Store and Your Architecture - Angular Architects](https://www.angulararchitects.io/blog/the-ngrx-signal-store-and-your-architecture/)
- [Dynamic Module Federation with Angular - Angular Architects](https://www.angulararchitects.io/en/blog/dynamic-module-federation-with-angular/)
- [Module Federation with Angular's Standalone Components - Angular Architects](https://www.angulararchitects.io/en/blog/module-federation-with-angulars-standalone-components/)
- [The Micro-Frontend Chaos and How to Solve It - angular.love](https://angular.love/the-micro-frontend-chaos-and-how-to-solve-it/)
- [Top 10 Micro Frontend Anti-Patterns - Florian Rappl](https://dev.to/florianrappl/top-10-micro-frontend-anti-patterns-3809)
- [Cross Micro Frontend Communication - Thoughtworks](https://www.thoughtworks.com/insights/blog/architecture/cross-micro-frontend-communication)
- [Announcing NgRx 21 - NgRx Team](https://dev.to/ngrx/announcing-ngrx-21-celebrating-a-10-year-journey-with-a-fresh-new-look-and-ngrxsignalsevents-5ekp)
- [NgRx SignalStore Events Plugin - Arcadio Quintero](https://arcadioquintero.com/en/blog/ngrx-signalstore-events-plugin/)
- [Micro-frontends 2026: Module Federation 3.0 and Native ESM Federation](https://blog.weskill.org/2026/03/micro-frontends-2026-module-federation_0688468676.html)
- [Angular 21 Micro Frontend using Module Federation](https://www.angularthink.in/2026/03/angular21-micro-frontend-using-module.html)
- [Nx Dynamic MF Workspace with Enhanced Runtime - Erman Enginler](https://medium.com/havelsan/creating-an-nx-dynamic-module-federation-workspace-with-webpack-enhanced-runtime-in-angular-70a43a2fb875)
- [Building Angular Micro Frontend with NgRx State Sharing - Varun Singh](https://medium.com/@varun.singh_99751/building-angular-micro-frontend-with-ngrx-state-sharing-as-well-as-nx-cli-cffa7b8cd43a)
- [A Catalog of Micro Frontends Anti-patterns (Academic)](https://arxiv.org/html/2411.19472v1)
- [Angular State Management for 2025 - Nx Blog](https://nx.dev/blog/angular-state-management-2025)

### GitHub Issues and Discussions
- [Share NgRx store from host to remotes - angular-architects/module-federation-plugin#11](https://github.com/angular-architects/module-federation-plugin/issues/11)
- [Angular singleton service initiated multiple times - module-federation-examples#904](https://github.com/module-federation/module-federation-examples/issues/904)
- [Unable to share singleton from local Angular Library - module-federation-examples#473](https://github.com/module-federation/module-federation-examples/issues/473)
- [Unable to share NgRx state in multi-version Angular MFE - module-federation-plugin#522](https://github.com/angular-architects/module-federation-plugin/issues/522)
- [Share NgRx store and save in LocalStorage from remotes - module-federation-plugin#715](https://github.com/angular-architects/module-federation-plugin/issues/715)
- [Rename withEffects to withEventHandlers - ngrx/platform#4976](https://github.com/ngrx/platform/issues/4976)
- [Add Migration Schematic for withEventHandlers - ngrx/platform#5010](https://github.com/ngrx/platform/issues/5010)
- [RFC: Add events plugin to @ngrx/signals - ngrx/platform#4580](https://github.com/ngrx/platform/issues/4580)
- [Wrong instance of some Angular packages with Module Federation - nrwl/nx#32465](https://github.com/nrwl/nx/issues/32465)
- [No provider for SignalStore - ngrx/platform#4150](https://github.com/ngrx/platform/discussions/4150)

### Books and eBooks
- [Micro Frontends and Moduliths with Angular - Manfred Steyer (free eBook)](https://www.angulararchitects.io/en/ebooks/micro-frontends-and-moduliths-with-angular/)
- [Enterprise Angular - Manfred Steyer (Leanpub)](https://leanpub.com/enterprise-angular)
- [Micro Frontends in Action - Manning](https://livebook.manning.com/book/micro-frontends-in-action/chapter-6)

## Open Questions

1. **NgRx scoped events exact API for `scope: 'global'`**: The NgRx 21 announcement mentions scoped events but official docs page failed to load content. Need to verify exact API against installed `@ngrx/signals` v21.1.0 package before writing code examples. The Arcadio Quintero blog post shows `injectDispatch(Events, { scope: 'self' })` syntax which should be verified.

2. **State cleanup on remote unload**: When a dynamic remote is unloaded (user navigates away, remote is removed from manifest), what happens to its registered feature state in the Classic Store? `provideState()` registers a reducer but there is no documented `removeState()` API. Need to verify if this is a memory leak concern or if Angular's injector cleanup handles it.

3. **`@module-federation/enhanced/runtime` + `@angular-architects/module-federation` compatibility**: Nx 19.5+ uses `@module-federation/enhanced` directly. Need to verify whether projects still using `@angular-architects/module-federation` (Manfred Steyer's plugin) can interop with the enhanced runtime or if migration is required.

4. **SignalStore `providedIn: 'root'` with tree-shaking in MFE context**: Angular docs say unused `providedIn: 'root'` services are tree-shaken. In an MFE context where the shared library is loaded at runtime via Module Federation, does tree-shaking still apply? The shared singleton may need to be explicitly referenced to prevent removal.

5. **Native Federation vs Module Federation**: Angular Architects now recommends Native Federation (ESM + import maps) over webpack Module Federation. The book uses webpack MF per the outline, but should mention Native Federation as the emerging alternative. Need to clarify the scope boundary.
