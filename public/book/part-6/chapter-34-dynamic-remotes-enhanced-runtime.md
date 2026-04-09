# Chapter 34: Dynamic Remotes with @module-federation/enhanced/runtime

Your micro-frontend platform from Chapter 33 works. The shell loads three remotes, shared singletons keep one NgRx store and one Angular injector tree, and the hybrid pattern gives each team autonomy over feature state. Then the product owner asks: "Can we add a new micro-frontend without redeploying the shell?" The answer today is no. Every remote is hardcoded in the shell's webpack config. Adding one means changing the config, rebuilding the shell, and redeploying it. For an enterprise platform with a dozen teams shipping on independent cadences, that coupling defeats the purpose of micro-frontends.

Dynamic remotes solve this. Instead of declaring remotes at build time, the shell fetches a manifest at runtime, a JSON file or an API response that says "these remotes exist and here is where to find them." The shell registers them with `@module-federation/enhanced/runtime`, then loads their routes on demand through `loadRemote()`. Adding a new remote means updating the manifest. No shell rebuild. No coordinated deployment. This chapter walks through the full runtime API, builds an API-driven remote registry, implements preloading and error resilience, and shows how state management adapts when remotes appear and disappear at runtime.

## Static vs Dynamic Remotes

In Chapter 33, we declared remotes in the webpack configuration:

```typescript
// apps/shell/module-federation.config.ts (static approach from Ch 33)
import { ModuleFederationConfig } from '@nx/module-federation';

const config: ModuleFederationConfig = {
  name: 'shell',
  remotes: ['mfe_products', 'mfe_orders', 'mfe_account'],
};

export default config;
```

Webpack resolves these remote names at build time. The compiled shell contains references to `mfe_products`, `mfe_orders`, and `mfe_account`. To add `mfe_analytics`, you must edit this file, rebuild, and redeploy the shell.

Dynamic remotes flip this. The webpack config declares zero remotes. The shell fetches a manifest before bootstrapping, calls `registerRemotes()` to teach the runtime where each remote lives, then boots normally. Routes use `loadRemote()` instead of webpack's built-in remote resolution.

```typescript
// apps/shell/module-federation.config.ts (dynamic approach)
import { ModuleFederationConfig } from '@nx/module-federation';

const config: ModuleFederationConfig = {
  name: 'shell',
  remotes: [],
  runtimePlugins: ['./src/mf-plugins/fallback.plugin.ts'],
};

export default config;
```

The `remotes` array is empty. The shell no longer has any build-time knowledge of which remotes exist. Everything is resolved at runtime.

## The Runtime API

The `@module-federation/enhanced/runtime` package provides the runtime layer for Module Federation 2.0. It is framework-agnostic and works alongside the webpack plugin. Nx includes it automatically when you use `withModuleFederation()`. Here are the functions this chapter uses:

**`registerRemotes(remotes: Remote[], options?: { force?: boolean }): void`** registers remote definitions. Each `Remote` needs a `name` and an `entry` (a URL pointing to the remote's `mf-manifest.json` or `remoteEntry.js`). Call it before the app bootstraps so routes can resolve remotes. Calling it again with new remotes adds them incrementally. Passing `{ force: true }` overwrites previously registered remotes and clears cached modules.

**`loadRemote<T>(id: string): Promise<T | null>`** loads an exposed module from a registered remote. The `id` follows the format `"remoteName/exposedModule"`. It returns `null` if the remote is unavailable, rather than throwing an error.

**`preloadRemote(options: PreloadRemoteArgs[]): Promise<void>`** prefetches remote entry files and optionally specific exposed modules. This is useful for warming caches before the user navigates.

## The Two-Manifest Pattern

Module Federation 2.0 introduces `mf-manifest.json`, an auto-generated file that each remote produces at build time. It contains metadata about every exposed module, every shared dependency, and every chunk asset. When the runtime fetches an `mf-manifest.json`, it knows exactly which JavaScript files to load for a given exposed module, without downloading unnecessary code.

The shell needs its own manifest that maps remote names to their `mf-manifest.json` URLs. This creates a two-layer system:

1. **Shell manifest** (`module-federation.manifest.json`): a simple JSON file mapping remote names to entry URLs. This is what you update when adding or removing a remote.
2. **Remote manifests** (`mf-manifest.json`): auto-generated per remote at build time. Contains chunk-level asset metadata.

```json
// apps/shell/public/module-federation.manifest.json
{
  "mfe_products": "http://localhost:4201/mf-manifest.json",
  "mfe_orders": "http://localhost:4202/mf-manifest.json",
  "mfe_account": "http://localhost:4203/mf-manifest.json"
}
```

The shell fetches this file, converts it into `Remote[]` objects, and registers them:

```typescript
// apps/shell/src/main.ts
import { registerRemotes } from '@module-federation/enhanced/runtime';

fetch('/module-federation.manifest.json')
  .then((res) => res.json())
  .then((manifest: Record<string, string>) =>
    Object.entries(manifest).map(([name, entry]) => ({ name, entry }))
  )
  .then((remotes) => registerRemotes(remotes))
  .then(() => import('./bootstrap').catch((err) => console.error(err)));
```

The `import('./bootstrap')` call is the async boundary from Chapter 33. It must come after `registerRemotes()` so the runtime knows about all remotes before any application code attempts to load one.

## From Static JSON to an API-Driven Registry

A static JSON file is a good starting point, but it still requires a file deployment to change the manifest. For true independence, the manifest should come from an API that each team's CI pipeline updates when they deploy a new version.

```typescript
// apps/shell/src/main.ts
import { registerRemotes } from '@module-federation/enhanced/runtime';

interface RemoteRegistryEntry {
  name: string;
  entry: string;
  routePath: string;
  exposedModule: string;
  enabled: boolean;
}

fetch('https://platform-api.example.com/mfe-registry')
  .then((res) => {
    if (!res.ok) throw new Error(`Registry returned ${res.status}`);
    return res.json();
  })
  .then((entries: RemoteRegistryEntry[]) => {
    const remotes = entries
      .filter((e) => e.enabled)
      .map(({ name, entry }) => ({ name, entry }));
    registerRemotes(remotes);
    return entries.filter((e) => e.enabled);
  })
  .then((entries) => {
    (globalThis as Record<string, unknown>)['__MFE_REGISTRY__'] = entries;
    return import('./bootstrap');
  })
  .catch((err) => {
    console.error('Failed to load MFE registry:', err);
    import('./bootstrap');
  });
```

The registry response includes `routePath` and `exposedModule` so the shell can build routes dynamically. We stash the registry on `globalThis` so application code can access it after bootstrap. The `catch` block ensures the shell still boots even if the registry is down, just without any remotes.

## Dynamic Route Building

With static remotes, routes are hardcoded in `app.routes.ts`. With dynamic remotes, routes must be built from the registry at bootstrap time:

```typescript
// apps/shell/src/app/app.routes.ts
import { Route } from '@angular/router';
import { loadRemote } from '@module-federation/enhanced/runtime';

interface RegistryEntry {
  name: string;
  routePath: string;
  exposedModule: string;
}

function getRegistry(): RegistryEntry[] {
  return ((globalThis as Record<string, unknown>)['__MFE_REGISTRY__'] as RegistryEntry[]) ?? [];
}

function buildRemoteRoute(entry: RegistryEntry): Route {
  return {
    path: entry.routePath,
    loadChildren: () =>
      loadRemote<{ remoteRoutes: Route[] }>(`${entry.name}/${entry.exposedModule}`)
        .then((m) => {
          if (!m) {
            return [{ path: '**', loadComponent: () => import('./fallback.component').then((c) => c.RemoteUnavailableComponent) }];
          }
          return m.remoteRoutes;
        }),
  };
}

export const appRoutes: Route[] = [
  { path: '', redirectTo: 'products', pathMatch: 'full' },
  ...getRegistry().map(buildRemoteRoute),
  { path: '**', redirectTo: '' },
];
```

Each registry entry becomes a lazy route. The `loadRemote()` call fetches the remote's exposed module at navigation time. If the remote is down, the route falls back to a placeholder component instead of crashing the entire application.

```typescript
// apps/shell/src/app/fallback.component.ts
import { Component } from '@angular/core';

@Component({
  selector: 'app-remote-unavailable',
  standalone: true,
  template: `
    <div class="fallback-container">
      <h2>Feature Unavailable</h2>
      <p>This section is temporarily unavailable. Please try again later.</p>
    </div>
  `,
})
export class RemoteUnavailableComponent {}
```

## Preloading Remotes for Faster Navigation

When the user is on the products page, they are likely to navigate to orders next. Waiting until they click to start loading the orders remote adds latency. `preloadRemote()` solves this by fetching the remote's manifest and optionally its exposed module chunks in advance.

```typescript
// apps/shell/src/app/shell.component.ts
import { Component, inject, AfterViewInit } from '@angular/core';
import { RouterOutlet, RouterLink } from '@angular/router';
import { preloadRemote } from '@module-federation/enhanced/runtime';

interface RegistryEntry {
  name: string;
  routePath: string;
  exposedModule: string;
}

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink],
  template: `
    <nav>
      @for (entry of registry; track entry.name) {
        <a [routerLink]="entry.routePath">{{ entry.routePath }}</a>
      }
    </nav>
    <main>
      <router-outlet />
    </main>
  `,
})
export class ShellComponent implements AfterViewInit {
  protected readonly registry: RegistryEntry[] =
    ((globalThis as Record<string, unknown>)['__MFE_REGISTRY__'] as RegistryEntry[]) ?? [];

  ngAfterViewInit(): void {
    const preloadTargets = this.registry.map((entry) => ({
      nameOrAlias: entry.name,
      exposes: [`./${entry.exposedModule}`],
      resourceCategory: 'all' as const,
    }));

    preloadRemote(preloadTargets);
  }
}
```

After the shell renders, `preloadRemote()` fetches the manifest and associated chunks for every registered remote. By the time the user clicks a navigation link, the remote's code is already in the browser cache. The `resourceCategory: 'all'` option downloads all assets (JS, CSS). Use `'sync'` to download only the synchronous entry chunks if you want to minimize bandwidth.

## Runtime Plugins for Cross-Cutting Concerns

The Module Federation runtime exposes a plugin system with hooks at every stage of the remote loading lifecycle. Plugins are registered in the webpack config via the `runtimePlugins` array and are loaded before the application bootstraps.

### Fallback Plugin

The `errorLoadRemote` hook fires when `loadRemote()` fails. You can return a fallback module to prevent the route from breaking:

```typescript
// apps/shell/src/mf-plugins/fallback.plugin.ts
import type { FederationRuntimePlugin } from '@module-federation/enhanced/runtime';

export const fallbackPlugin: () => FederationRuntimePlugin = () => ({
  name: 'fallback-plugin',
  errorLoadRemote({ id, error }) {
    console.error(`Remote module failed to load: ${id}`, error);
    return {
      remoteRoutes: [
        {
          path: '**',
          loadComponent: () =>
            import('../app/fallback.component').then(
              (m) => m.RemoteUnavailableComponent
            ),
        },
      ],
    };
  },
});
```

Register this plugin in the webpack config:

```typescript
// apps/shell/module-federation.config.ts
import { ModuleFederationConfig } from '@nx/module-federation';

const config: ModuleFederationConfig = {
  name: 'shell',
  remotes: [],
  runtimePlugins: ['./src/mf-plugins/fallback.plugin.ts'],
};

export default config;
```

### Auth Header Plugin

When remote manifests are served from authenticated CDN endpoints, you need to attach authorization headers to the fetch calls the runtime makes:

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

Register both plugins by adding the file path to the `runtimePlugins` array:

```typescript
// apps/shell/module-federation.config.ts
import { ModuleFederationConfig } from '@nx/module-federation';

const config: ModuleFederationConfig = {
  name: 'shell',
  remotes: [],
  runtimePlugins: [
    './src/mf-plugins/fallback.plugin.ts',
    './src/mf-plugins/auth-fetch.plugin.ts',
  ],
};

export default config;
```

## Hot-Swapping Remotes

The `registerRemotes()` function accepts a `force` option that overwrites a previously registered remote and clears its cached modules. This enables scenarios like A/B testing, canary deployments, or switching a remote from a stable CDN to a preview environment without reloading the page.

```typescript
// apps/shell/src/app/services/remote-switcher.service.ts
import { Injectable, signal } from '@angular/core';
import { registerRemotes } from '@module-federation/enhanced/runtime';

interface RemoteVersion {
  name: string;
  entry: string;
  label: string;
}

@Injectable({ providedIn: 'root' })
export class RemoteSwitcherService {
  readonly activeVersions = signal<Record<string, string>>({});

  switchVersion(remote: RemoteVersion): void {
    registerRemotes(
      [{ name: remote.name, entry: remote.entry }],
      { force: true }
    );

    this.activeVersions.update((versions) => ({
      ...versions,
      [remote.name]: remote.label,
    }));
  }
}
```

When `force: true` is used, the runtime clears the module cache for that remote. The next `loadRemote()` call fetches fresh code from the new entry URL. Be aware that any Angular components or services already instantiated from the old version remain in memory until their injector is destroyed. For a clean switch, navigate the user away from the remote's routes before calling `switchVersion`, then navigate back.

## State Management with Dynamic Remotes

Dynamic remotes do not change the state management patterns from Chapter 33. The hybrid pattern still applies: shared global state for authentication and feature flags, isolated feature state per remote. What changes is the timing. With static remotes, the shell knows at build time which feature states exist. With dynamic remotes, feature state registers itself when the remote's routes activate.

### NgRx Classic Store

The shell still initializes the root store in its `app.config.ts`. Each remote registers feature state in its route providers. The difference is that the shell has no import-time reference to the remote's reducer or effects. Everything happens through `provideState()` and `provideEffects()` inside the remote's exposed routes:

```typescript
// apps/mfe_products/src/app/remote-entry/entry.routes.ts
import { Route } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import {
  productsFeature,
  ProductsEffects,
} from '@mfe-platform/products-data-access';

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
          import('@mfe-platform/products-feature').then(
            (m) => m.ProductListComponent
          ),
      },
      {
        path: ':id',
        loadComponent: () =>
          import('@mfe-platform/products-feature').then(
            (m) => m.ProductDetailComponent
          ),
      },
    ],
  },
];
```

The shell never imports `productsFeature` or `ProductsEffects`. It only calls `loadRemote('mfe_products/Routes')`, and the returned route configuration brings the state registration with it. This is what makes the decoupling complete: the shell does not know what state a remote manages, only that the remote provides routes.

### NgRx SignalStore

SignalStore integrates even more cleanly with dynamic remotes. A feature-scoped `SignalStore` is provided at the route level and garbage collected when the user navigates away:

```typescript
// apps/mfe_orders/src/app/remote-entry/entry.routes.ts
import { Route } from '@angular/router';
import { OrdersStore } from '@mfe-platform/orders-data-access';

export const remoteRoutes: Route[] = [
  {
    path: '',
    providers: [OrdersStore],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('@mfe-platform/orders-feature').then(
            (m) => m.OrderListComponent
          ),
      },
      {
        path: ':id',
        loadComponent: () =>
          import('@mfe-platform/orders-feature').then(
            (m) => m.OrderDetailComponent
          ),
      },
    ],
  },
];
```

When the orders remote loads dynamically, `OrdersStore` is instantiated. When the user navigates to a different remote, Angular destroys the route's environment injector and the store is garbage collected. No cleanup actions, no leftover state in DevTools.

Shared stores like `AuthStore` (with `providedIn: 'root'`) remain accessible to all dynamically loaded remotes through the shell's root injector, exactly as in Chapter 33. The key requirement is that `@ngrx/signals` is shared as a singleton in the webpack config so every remote resolves the same `signalStore` factory.

## Putting It All Together

Here is the complete initialization flow, from page load to rendered remote:

1. The browser loads `main.ts`, which fetches the remote registry from an API.
2. `registerRemotes()` teaches the MF runtime where each remote lives.
3. `import('./bootstrap')` creates the async boundary and starts the Angular app.
4. The router matches the current URL against dynamically built routes.
5. `loadRemote()` fetches the matched remote's `mf-manifest.json`, then loads only the chunks needed for the exposed module.
6. The remote's route configuration registers its feature state (via `provideState` or route-scoped `SignalStore`).
7. The component renders, accessing both shared global state and its own feature state.

If step 1 fails, the shell boots without remotes. If step 5 fails, the fallback plugin returns a placeholder component. At no point does a failure in one remote prevent the rest of the application from working.

## Common Mistakes

### Mistake 1: Using the Non-Null Assertion on loadRemote

```typescript
// apps/shell/src/app/app.routes.ts
// WRONG: m! throws if the remote is unavailable
{
  path: 'products',
  loadChildren: () =>
    loadRemote<typeof import('mfe_products/Routes')>('mfe_products/Routes')
      .then((m) => m!.remoteRoutes),
}
```

`loadRemote()` returns `Promise<T | null>`. When the remote is down, `m` is `null`, and `m!.remoteRoutes` throws `TypeError: Cannot read properties of null`. In a static setup where remotes are always available during development, this works. In a dynamic setup where remotes may be registered but offline, it crashes the router.

Handle the null case explicitly:

```typescript
// apps/shell/src/app/app.routes.ts
// CORRECT: provide fallback routes when remote is unavailable
{
  path: 'products',
  loadChildren: () =>
    loadRemote<{ remoteRoutes: Route[] }>('mfe_products/Routes')
      .then((m) => {
        if (!m) {
          return [{ path: '**', loadComponent: () => import('./fallback.component').then((c) => c.RemoteUnavailableComponent) }];
        }
        return m.remoteRoutes;
      }),
}
```

### Mistake 2: Calling registerRemotes After Bootstrap

```typescript
// apps/shell/src/main.ts
// WRONG: bootstrap happens before remotes are registered
import('./bootstrap').then(() => {
  fetch('/module-federation.manifest.json')
    .then((res) => res.json())
    .then((manifest: Record<string, string>) =>
      Object.entries(manifest).map(([name, entry]) => ({ name, entry }))
    )
    .then((remotes) => registerRemotes(remotes));
});
```

If `registerRemotes()` runs after the app bootstraps, the router has already resolved its initial routes. Any route that calls `loadRemote()` will fail because the runtime does not know about any remotes yet. The user sees a blank page or a router error on first load.

Always register remotes before importing the bootstrap file:

```typescript
// apps/shell/src/main.ts
// CORRECT: register remotes first, then bootstrap
fetch('/module-federation.manifest.json')
  .then((res) => res.json())
  .then((manifest: Record<string, string>) =>
    Object.entries(manifest).map(([name, entry]) => ({ name, entry }))
  )
  .then((remotes) => registerRemotes(remotes))
  .then(() => import('./bootstrap').catch((err) => console.error(err)));
```

### Mistake 3: Using force: true Without Navigating Away First

```typescript
// WRONG: hot-swap while the user is viewing the remote
switchVersion({ name: 'mfe_products', entry: 'https://canary.example.com/mf-manifest.json', label: 'canary' });
// User is still on /products -- stale component instances remain in the DOM
```

Calling `registerRemotes` with `force: true` clears the module cache, but Angular components already instantiated from the old version remain alive in the DOM. The old component instances still reference the old services and state. This creates a split state where some code runs old logic and some runs new logic.

Navigate the user away first, then switch, then navigate back:

```typescript
// CORRECT: navigate away, swap, navigate back
import { Router } from '@angular/router';

function hotSwap(router: Router, remote: RemoteVersion): void {
  router.navigateByUrl('/').then(() => {
    registerRemotes(
      [{ name: remote.name, entry: remote.entry }],
      { force: true }
    );
    router.navigateByUrl(`/${remote.name}`);
  });
}
```

### Mistake 4: Forgetting to Handle Registry Fetch Failures

```typescript
// apps/shell/src/main.ts
// WRONG: if the registry API is down, the app never boots
fetch('https://platform-api.example.com/mfe-registry')
  .then((res) => res.json())
  .then((entries) => {
    registerRemotes(entries.map((e: { name: string; entry: string }) => ({ name: e.name, entry: e.entry })));
    return import('./bootstrap');
  });
// No .catch -- a network error leaves the user on a blank page
```

The registry API is an external dependency. If it is slow or down, the shell must still boot. Without a `.catch`, the promise chain breaks silently and `import('./bootstrap')` never executes.

Always provide a fallback path:

```typescript
// apps/shell/src/main.ts
// CORRECT: boot the shell even if the registry is unavailable
fetch('https://platform-api.example.com/mfe-registry')
  .then((res) => {
    if (!res.ok) throw new Error(`Registry returned ${res.status}`);
    return res.json();
  })
  .then((entries: Array<{ name: string; entry: string; enabled: boolean }>) => {
    const remotes = entries
      .filter((e) => e.enabled)
      .map(({ name, entry }) => ({ name, entry }));
    registerRemotes(remotes);
  })
  .catch((err) => {
    console.error('MFE registry unavailable, booting shell-only mode:', err);
  })
  .then(() => import('./bootstrap').catch((err) => console.error(err)));
```

The `.then(() => import('./bootstrap'))` at the end runs regardless of whether the registry fetch succeeded. The shell boots in "shell-only mode" with no remote routes, which is better than a blank page.

## Key Takeaways

- **Dynamic remotes decouple the shell from its remotes at deployment time.** The shell fetches a manifest or calls a registry API at runtime, registers remotes with `registerRemotes()`, and loads them on demand with `loadRemote()`. Adding or removing a remote requires no shell rebuild.

- **Always register remotes before the async bootstrap boundary.** The sequence is: fetch manifest, call `registerRemotes()`, then `import('./bootstrap')`. Reversing this order causes `loadRemote()` calls in routes to fail because the runtime has no remote definitions.

- **`loadRemote()` returns `null` for unavailable remotes, not an error.** Always handle the null case in route definitions. Combine this with the `errorLoadRemote` plugin hook for comprehensive resilience. Both layers are needed because the hook does not catch all failure modes.

- **Runtime plugins handle cross-cutting concerns without coupling remotes to the shell.** Use the `fetch` hook for auth headers, `errorLoadRemote` for fallback components, and `createScript` for CSP nonce injection. Register plugins via the `runtimePlugins` array in your module federation config.

- **State management patterns do not change with dynamic remotes.** The hybrid pattern from Chapter 33 applies identically. What changes is timing: feature state registers when the remote's routes activate, not at build time. SignalStore's route-scoped lifecycle is particularly well suited because stores are created on navigation and garbage collected on departure, with no coordination needed from the shell.
