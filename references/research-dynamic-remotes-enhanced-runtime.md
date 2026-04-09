# Research: Dynamic Remotes with @module-federation/enhanced/runtime

**Date:** 2026-04-09
**Chapter:** Ch 34
**Status:** Ready for chapter generation

## API Surface

### @module-federation/enhanced/runtime (v0.21.6+)

All imports from `@module-federation/enhanced/runtime`:

#### `createInstance(options: UserOptions): ModuleFederation`
- Creates a new Module Federation runtime instance
- Replaces the deprecated `init()` function
- **Stability: Stable**

#### `getInstance(): ModuleFederation | null`
- Returns the current MF runtime instance (or null if not initialized)
- **Stability: Stable**

#### ~~`init(options: UserOptions): ModuleFederation`~~
- **DEPRECATED** -- use `createInstance()` or `getInstance()` instead
- Still works but will be removed in a future major version

#### `loadRemote<T>(id: string, options?: { loadFactory?: boolean; from: CallFrom }): Promise<T | null>`
- Loads a module exposed by a remote
- `id` format: `"remoteName/exposedModule"` (e.g., `"mfe_products/Routes"`)
- Returns `null` if the remote is unavailable (NOT a thrown error by default)
- **Stability: Stable**

#### `registerRemotes(remotes: Remote[], options?: { force?: boolean }): void`
- Registers remote definitions at runtime
- `force: true` overwrites previously registered remotes (clears cached modules, logs a warning)
- Can be called multiple times to add new remotes incrementally
- **Stability: Stable**

#### `preloadRemote(preloadOptions: Array<PreloadRemoteArgs>): Promise<void>`
- Prefetches remote entry files and optionally specific exposed modules
- Improves perceived load time for routes the user is likely to visit
- **Stability: Stable**

#### `registerPlugins(plugins: UserOptions['plugins']): void`
- Adds runtime plugins after instance creation
- **Stability: Stable**

#### `registerShared(shared: UserOptions['shared']): void`
- Registers shared dependencies after instance creation
- **Stability: Stable**

#### `loadShare<T>(pkgName: string, ...): Promise<false | (() => T | undefined)>`
- Manually loads a shared dependency
- Rarely needed directly (the runtime handles sharing automatically)
- **Stability: Stable**

#### `loadShareSync<T>(pkgName: string, ...): () => T | never`
- Synchronous variant of `loadShare`
- **Stability: Stable**

### Key Types

```typescript
// Remote definition
type Remote = (RemoteWithEntry | RemoteWithVersion) & RemoteInfoCommon;

interface RemoteWithEntry {
  name: string;
  entry: string; // URL to mf-manifest.json or remoteEntry.js
}

interface RemoteWithVersion {
  name: string;
  version: string; // For version-based resolution (MF 2.0 feature)
}

interface RemoteInfoCommon {
  alias?: string;
  shareScope?: string | string[];
  type?: RemoteEntryType;
  entryGlobalName?: string;
}

// Instance configuration
type UserOptions = {
  name: string;
  version?: string;
  remotes?: Array<Remote>;
  plugins?: Array<ModuleFederationRuntimePlugin>;
  shareStrategy?: 'version-first' | 'loaded-first';
  shared?: { [pkgName: string]: ShareArgs | ShareArgs[] };
};

// Preload configuration
interface PreloadRemoteArgs {
  nameOrAlias: string;
  exposes?: Array<string>;
  resourceCategory?: 'all' | 'sync';
  share?: boolean;
  depsRemote?: boolean | Array<depsPreloadArg>;
  filter?: (assetUrl: string) => boolean;
  prefetchInterface?: boolean;
}

// Shared dependency configuration
interface SharedConfig {
  singleton?: boolean;
  requiredVersion: false | string;
  eager?: boolean;
  strictVersion?: boolean;
  layer?: string | null;
}
```

### Runtime Plugin Hooks

Plugins follow a lifecycle hook model. Key hooks:

**Initialization:**
- `beforeInit` (SyncWaterfallHook) -- modify options before initialization
- `init` (SyncHook) -- after initialization

**Container:**
- `beforeInitContainer` (AsyncWaterfallHook) -- before remote container init
- `initContainer` (AsyncWaterfallHook) -- after remote container init

**Loading:**
- `beforeRequest` -- called after resolving remote path, can modify resolved info
- `afterResolve` -- called after resolution, provides access to package name, alias, expose, remote details
- `errorLoadRemote` -- triggered on remote module loading failure, supports fallback components
- `loadEntryError` -- handle entry loading errors

**Script/Resource:**
- `createScript` -- customize script tag creation (e.g., add nonce for CSP)
- `createLink` -- customize link tag creation
- `fetch` (AsyncHook) -- intercept fetch calls (e.g., add auth headers to manifest requests)

**Shared Dependencies:**
- `beforeLoadShare` -- before loading a shared dependency
- `loadShare` -- during shared dep loading
- `resolveShare` -- shared dep resolution

**Preloading:**
- `handlePreloadModule`, `beforePreloadRemote`, `afterPreloadRemote`

**Module Resolution:**
- `getModuleFactory` -- customize module resolution

## Key Concepts

### What Chapter 34 Must Convey

- **Dynamic vs static remotes**: Static remotes are defined in webpack config at build time; dynamic remotes are registered at runtime via `registerRemotes()`, enabling the shell to discover remotes from a manifest/API without redeployment.

- **The two-manifest pattern**: A custom `module-federation.manifest.json` maps remote names to their auto-generated `mf-manifest.json` URLs. The shell fetches the custom manifest, registers remotes, then bootstraps.

- **mf-manifest.json (MF 2.0) vs remoteEntry.js (MF 1.0)**: MF 2.0's manifest provides granular asset metadata, enables resource preloading, supports Chrome DevTools integration, and provides type hints. Remotes should point `entry` to `mf-manifest.json`.

- **Runtime initialization flow**: Fetch manifest -> `registerRemotes()` -> `import('./bootstrap')` -> routes use `loadRemote()`. The async bootstrap boundary is critical so webpack can resolve shared deps before app code runs.

- **`loadRemote()` in Angular routes**: Used inside `loadChildren` or `loadComponent` to dynamically load remote modules. The return type is `Promise<T | null>`, requiring null handling.

- **State implications of dynamic remotes**: Because remotes are registered at runtime, state management must also be dynamic. Feature stores (NgRx `provideState()` or route-scoped SignalStores) are registered when the remote's routes activate, not at app bootstrap.

- **Preloading strategy**: `preloadRemote()` can prefetch remote assets during idle time or on hover, improving navigation speed. Especially important when combined with state prefetching.

- **Error handling and resilience**: Dynamic remotes can be unavailable. The chapter must cover: `errorLoadRemote` plugin hook, try/catch around `loadRemote()`, fallback components for unavailable remotes.

- **Runtime plugins for cross-cutting concerns**: Auth headers on manifest fetches, CSP nonce injection, logging/monitoring, and fallback strategies are all implemented via the plugin system.

- **`force: true` for hot-swapping remotes**: Useful for A/B testing, canary deployments, or switching remote versions without page reload.

- **Share strategies**: `'version-first'` (default) prioritizes matching versions; `'loaded-first'` uses whatever is already loaded. The latter is more resilient in heterogeneous deployments.

### Relationship to Previous Chapters

- **Ch 32** established: Nx monorepo structure, state in data-access libs, boundary enforcement via tags
- **Ch 33** established: Shared singletons for state packages, the hybrid pattern (shared global + isolated feature state), async bootstrap boundary, root injector problem and solution (expose routes not root components)
- **Ch 34** builds on both: shows how to make remotes truly dynamic (discovered at runtime, not hardcoded), and how state management adapts to this dynamic loading model

## Code Patterns

### Pattern 1: Basic Dynamic Remote Registration

```typescript
// apps/shell/src/main.ts
import { registerRemotes } from '@module-federation/enhanced/runtime';

fetch('/module-federation.manifest.json')
  .then((res) => res.json())
  .then((remotes: Record<string, string>) =>
    Object.entries(remotes).map(([name, entry]) => ({ name, entry }))
  )
  .then((remotes) => registerRemotes(remotes))
  .then(() => import('./bootstrap').catch((err) => console.error(err)));
```

```json
// apps/shell/public/module-federation.manifest.json
{
  "mfe_products": "http://localhost:4201/mf-manifest.json",
  "mfe_orders": "http://localhost:4202/mf-manifest.json"
}
```

### Pattern 2: loadRemote in Angular Routes

```typescript
// apps/shell/src/app/app.routes.ts
import { Route } from '@angular/router';
import { loadRemote } from '@module-federation/enhanced/runtime';

export const appRoutes: Route[] = [
  {
    path: 'products',
    loadChildren: () =>
      loadRemote<typeof import('mfe_products/Routes')>('mfe_products/Routes')
        .then((m) => m!.remoteRoutes),
  },
  {
    path: 'orders',
    loadChildren: () =>
      loadRemote<typeof import('mfe_orders/Routes')>('mfe_orders/Routes')
        .then((m) => m!.remoteRoutes),
  },
];
```

### Pattern 3: API-Driven Manifest (No Static JSON)

```typescript
// apps/shell/src/main.ts
import { registerRemotes } from '@module-federation/enhanced/runtime';

interface RemoteConfig {
  name: string;
  entry: string;
  routePath: string;
  enabled: boolean;
}

fetch('https://api.example.com/mfe-registry')
  .then((res) => res.json())
  .then((configs: RemoteConfig[]) =>
    configs
      .filter((c) => c.enabled)
      .map(({ name, entry }) => ({ name, entry }))
  )
  .then((remotes) => registerRemotes(remotes))
  .then(() => import('./bootstrap').catch((err) => console.error(err)));
```

### Pattern 4: Dynamic Route Building from Manifest

```typescript
// apps/shell/src/app/app.routes.ts
import { Route } from '@angular/router';
import { loadRemote } from '@module-federation/enhanced/runtime';

export function buildRemoteRoutes(
  registry: Array<{ name: string; routePath: string; exposedModule: string }>
): Route[] {
  return registry.map(({ name, routePath, exposedModule }) => ({
    path: routePath,
    loadChildren: () =>
      loadRemote<{ remoteRoutes: Route[] }>(`${name}/${exposedModule}`)
        .then((m) => {
          if (!m) {
            console.error(`Remote ${name} unavailable`);
            return [];
          }
          return m.remoteRoutes;
        }),
  }));
}
```

### Pattern 5: Preloading Remotes

```typescript
// apps/shell/src/app/app.component.ts
import { preloadRemote } from '@module-federation/enhanced/runtime';

@Component({
  selector: 'app-root',
  template: `<nav>...</nav><router-outlet />`,
})
export class AppComponent {
  constructor() {
    // Preload likely-needed remotes after shell renders
    setTimeout(() => {
      preloadRemote([
        { nameOrAlias: 'mfe_products', exposes: ['./Routes'], resourceCategory: 'all' },
      ]);
    }, 2000);
  }
}
```

### Pattern 6: Error Handling with Runtime Plugin

```typescript
// apps/shell/src/mf-plugins/fallback.plugin.ts
import type { FederationRuntimePlugin } from '@module-federation/enhanced/runtime';

export const fallbackPlugin: () => FederationRuntimePlugin = () => ({
  name: 'fallback-plugin',
  errorLoadRemote({ id, error, from, origin }) {
    console.error(`Failed to load remote module: ${id}`, error);
    // Return a fallback module shape
    if (id === 'mfe_products/Routes') {
      return {
        remoteRoutes: [
          {
            path: '',
            loadComponent: () =>
              import('../fallback/remote-unavailable.component')
                .then((m) => m.RemoteUnavailableComponent),
          },
        ],
      };
    }
    return null;
  },
});
```

### Pattern 7: Registering Runtime Plugins in Webpack Config

```typescript
// apps/shell/module-federation.config.ts
import { ModuleFederationConfig } from '@nx/module-federation';

const config: ModuleFederationConfig = {
  name: 'shell',
  remotes: [], // Empty -- remotes registered dynamically at runtime
  runtimePlugins: ['./src/mf-plugins/fallback.plugin.ts'],
  shared: (libraryName, sharedConfig) => {
    if (libraryName === '@angular/core' || libraryName === '@ngrx/store') {
      return { ...sharedConfig, singleton: true, strictVersion: true };
    }
    return sharedConfig;
  },
};

export default config;
```

### Pattern 8: Hot-Swapping Remotes (A/B Testing)

```typescript
// apps/shell/src/app/services/remote-switcher.service.ts
import { registerRemotes } from '@module-federation/enhanced/runtime';

export function switchRemoteVersion(
  remoteName: string,
  newEntry: string
): void {
  registerRemotes(
    [{ name: remoteName, entry: newEntry }],
    { force: true } // Overwrites existing registration, clears cache
  );
}

// Usage: switch mfe_products to canary version
switchRemoteVersion('mfe_products', 'https://canary.example.com/mfe_products/mf-manifest.json');
```

### Pattern 9: Adding Auth Headers to Manifest Fetches

```typescript
// apps/shell/src/mf-plugins/auth-fetch.plugin.ts
import type { FederationRuntimePlugin } from '@module-federation/enhanced/runtime';

export const authFetchPlugin: () => FederationRuntimePlugin = () => ({
  name: 'auth-fetch-plugin',
  async fetch(url: string, options: RequestInit) {
    const token = localStorage.getItem('access_token');
    return globalThis.fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  },
});
```

### Pattern 10: State Registration on Remote Load

```typescript
// apps/mfe_products/src/app/remote-entry/entry.routes.ts
import { Route } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEventHandlers } from '@ngrx/effects';
import { productsFeature } from '@mfe-platform/products-data-access';
import { ProductsEventHandlers } from '@mfe-platform/products-data-access';

export const remoteRoutes: Route[] = [
  {
    path: '',
    providers: [
      provideState(productsFeature),
      provideEventHandlers(ProductsEventHandlers),
    ],
    loadComponent: () =>
      import('@mfe-platform/products-feature').then(
        (m) => m.ProductListComponent
      ),
  },
];
```

## Breaking Changes and Gotchas

### Breaking Changes

1. **`init()` deprecated in favor of `createInstance()`/`getInstance()`**: The `init()` function still works in v0.21.6 but is marked deprecated in type definitions. The modular approach (`registerRemotes`, `registerShared`, `registerPlugins`) is preferred over passing everything to `init()`.

2. **Nx 19.5+ migrated from `@nx/angular/mf` to `@module-federation/enhanced`**: The old `setRemoteDefinitions` from `@nx/angular/mf` is replaced by `registerRemotes` from `@module-federation/enhanced/runtime`. Nx's `withModuleFederationForSSR` and related utilities were also updated.

3. **NgRx v21: `withEffects()` renamed to `withEventHandlers()`**: Relevant when state is loaded alongside dynamic remotes. Migration schematics available.

4. **Module Federation 2.0 stable release (April 2026)**: Runtime fully decoupled from webpack. The `mf-manifest.json` format is now the canonical entry format over `remoteEntry.js`.

### Gotchas

1. **`loadRemote()` returns `null`, not an error, for unavailable remotes**: The `!` non-null assertion commonly used in route loading (`m!.remoteRoutes`) will throw a runtime error if the remote is down. Always handle the null case.

2. **`errorLoadRemote` hook may not trigger for all failure modes**: GitHub issue #2817 reports cases where pointing to a non-existing URL does not trigger the hook. Wrapping `loadRemote()` in try/catch is more reliable.

3. **Manifest fetch failures are hard to catch**: If `mf-manifest.json` is unreachable, the runtime throws an error that may not be caught by `errorLoadRemote`. Wrap the initial `registerRemotes()` call and `loadRemote()` calls in error handling.

4. **Multiple Angular platform instances**: If `@angular/core` is not shared as a singleton, each remote bootstraps its own Angular platform. This is catastrophic -- services, DI, and change detection all break.

5. **Secondary entry points need explicit sharing**: `@angular/common/http`, `@angular/router`, `@angular/forms` etc. are separate packages for Module Federation. Each needs explicit shared singleton configuration.

6. **`force: true` clears all cached modules**: Using `registerRemotes` with `force: true` invalidates every previously loaded module from that remote, not just the remote entry. Use carefully.

7. **Angular 21 zoneless advantage**: Angular 21 is zoneless by default, eliminating the classic pitfall of multiple Zone.js instances across remotes. No need for Zone.js sharing workarounds.

8. **Feature state persists after navigation**: When using NgRx Classic Store, feature reducers registered via `provideState()` persist in the store even after navigating away from the remote's routes. This is by design but can be surprising. SignalStores provided at route level are garbage collected when the route is destroyed.

9. **Share strategy matters**: `'version-first'` (default) prioritizes version matching and may load duplicate packages if versions differ. `'loaded-first'` uses whatever is already in memory, which is more resilient but risks subtle version incompatibilities.

10. **Webpack Dev Server and CORS**: During development, remotes served on different ports need CORS headers. Nx's `withModuleFederation` handles this automatically, but custom setups may need explicit `Access-Control-Allow-Origin` headers.

## mf-manifest.json vs remoteEntry.js

| Feature | mf-manifest.json (MF 2.0) | remoteEntry.js (MF 1.0) |
|---|---|---|
| Dynamic type hints | Yes | No |
| Resource preloading | Yes | No |
| Chrome DevTools plugin | Yes | No |
| Granular asset metadata | Yes | No |
| Legacy compatibility | MF 2.0+ only | All versions |

The `mf-manifest.json` is auto-generated at build time and provides a JSON description of all exposed modules, shared dependencies, and chunk assets. When `entry` in `registerRemotes` points to an `mf-manifest.json`, the runtime fetches it first, then loads only the needed chunks on demand.

## @module-federation/enhanced vs @angular-architects/module-federation

| Aspect | @module-federation/enhanced | @angular-architects/module-federation |
|---|---|---|
| Maintainer | Zack Jackson / ByteDance | Manfred Steyer / Angular Architects |
| Build tool support | Webpack, Rspack, Rsbuild | Webpack, esbuild (Native Federation) |
| Runtime API | `loadRemote`, `registerRemotes` | `loadRemoteModule` |
| Manifest format | `mf-manifest.json` (MF 2.0) | Custom manifest JSON |
| Nx integration | Official since Nx 19.5+ | Separate plugin |
| Plugin system | Full hook-based plugin architecture | Limited |
| Status | Active development, MF 2.0 stable | Maintained, pivoting to Native Federation |

## Sources

### Official Documentation
- Module Federation Runtime API: https://module-federation.io/guide/runtime/runtime-api
- Module Federation Runtime Hooks: https://module-federation.io/guide/basic/runtime/runtime-hooks
- Module Federation Manifest Configuration: https://module-federation.io/configure/manifest
- Module Federation Shared Configuration: https://module-federation.io/configure/shared
- Module Federation Plugin System: https://module-federation.io/plugin/dev/index.html
- Nx Dynamic Module Federation with Angular: https://nx.dev/recipes/angular/dynamic-module-federation-with-angular

### Blog Posts and Articles
- MF 2.0 Stable Release Announcement (InfoQ, April 2026): https://www.infoq.com/news/2026/04/module-federation-2-stable/
- Manfred Steyer: Dynamic Module Federation with Angular: https://www.angulararchitects.io/en/blog/dynamic-module-federation-with-angular/
- Manfred Steyer: Pitfalls with Module Federation and Angular: https://www.angulararchitects.io/en/blog/pitfalls-with-module-federation-and-angular/
- Manfred Steyer: Version Mismatch Hell: https://www.angulararchitects.io/en/blog/getting-out-of-version-mismatch-hell-with-module-federation/
- Module Federation with Angular Standalone Components: https://www.angulararchitects.io/en/blog/module-federation-with-angulars-standalone-components/
- Module Federation Error Handling: https://module-federation.io/blog/error-load-remote
- Combining Native Federation and Module Federation: https://www.angulararchitects.io/blog/combining-native-federation-and-module-federation/
- Nx + MF Enhanced Runtime Setup (Medium): https://medium.com/havelsan/creating-an-nx-dynamic-module-federation-workspace-with-webpack-enhanced-runtime-in-angular-70a43a2fb875
- NgRx 21 Announcement: https://dev.to/ngrx/announcing-ngrx-21-celebrating-a-10-year-journey-with-a-fresh-new-look-and-ngrxsignalsevents-5ekp
- Building Angular MFE with NgRx + Nx: https://medium.com/@varun.singh_99751/building-angular-micro-frontend-with-ngrx-state-sharing-as-well-as-nx-cli-cffa7b8cd43a

### GitHub
- Module Federation Core Repo: https://github.com/module-federation/core
- npm: @module-federation/enhanced: https://www.npmjs.com/package/@module-federation/enhanced
- Issue #1942: init vs loadRemote different instances: https://github.com/module-federation/core/issues/1942
- Issue #3550: loadRemote manifest resolution: https://github.com/module-federation/core/issues/3550
- Issue #2817: errorLoadRemote not triggering: https://github.com/module-federation/core/issues/2817
- Discussion #3570: Setting up remotes with @module-federation: https://github.com/module-federation/core/discussions/3570

## Open Questions

1. **`createInstance` vs `registerRemotes` flow**: The Nx-generated shell uses `registerRemotes()` directly (which implicitly uses a default instance). Need to verify whether `createInstance()` is needed when using Nx's `withModuleFederation()` preset, or if Nx handles instance creation internally.

2. **Type generation for dynamic remotes**: Module Federation 2.0 supports automatic TypeScript type generation (`@module-federation/typescript`). Need to verify if this works with fully dynamic remotes or only static ones defined in webpack config.

3. **SSR compatibility**: Chapter 30 covers SSR. Need to verify how `loadRemote()` behaves in an SSR context (Node.js environment) and whether `mf-manifest.json` fetching works server-side.

4. **Data Prefetch feature**: MF 2.0 docs mention a "Data Prefetch" capability that can advance remote module interface requests. Need to verify if this is stable and how it integrates with Angular's `httpResource` or NgRx effects.

5. **Chrome DevTools plugin**: MF 2.0 mentions a Chrome DevTools integration. Need to verify current status and whether it provides useful debugging for Angular-specific state issues across remotes.
