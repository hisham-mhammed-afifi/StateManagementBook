# Research: SSR, Hydration, and State Transfer

**Date:** 2026-04-08
**Chapter:** Ch 30
**Status:** Ready for chapter generation

## API Surface

| API | Import | Stability |
|---|---|---|
| `provideClientHydration()` | `@angular/platform-browser` | Stable |
| `withEventReplay()` | `@angular/platform-browser` | Stable |
| `withIncrementalHydration()` | `@angular/platform-browser` | Stable (Angular 21) |
| `withHttpTransferCacheOptions(opts)` | `@angular/platform-browser` | Stable |
| `withI18nSupport()` | `@angular/platform-browser` | Stable |
| `withNoHttpTransferCache()` | `@angular/platform-browser` | Stable |
| `TransferState` (service) | `@angular/core` | Stable |
| `makeStateKey<T>(key)` | `@angular/core` | Stable |
| `provideServerRendering()` | `@angular/ssr` | Stable |
| `httpResource(() => url)` | `@angular/common/http` | **Experimental** (Angular 21) |
| `isPlatformServer` / `isPlatformBrowser` | `@angular/common` | Stable |
| `afterNextRender` / `afterEveryRender` | `@angular/core` | Stable |

`HttpTransferCacheOptions` shape:
- `includeHeaders?: string[]`
- `filter?: (req: HttpRequest<unknown>) => boolean`
- `includePostRequests?: boolean`
- `includeRequestsWithAuthHeaders?: boolean`

## Key Concepts

- **The double-fetch problem**: SSR fetches data, server renders HTML, browser bootstraps Angular, then refetches the same data. Wasted API calls, layout flicker, hydration mismatch risk.
- **Two transfer mechanisms**:
  1. **HTTP transfer cache** — automatic. `HttpClient` GET/HEAD calls on the server are serialized into `<script type="ng/state">` and replayed on the client without a network call. Configure via `withHttpTransferCacheOptions`.
  2. **`TransferState`** — manual key/value store for non-HTTP data (computed values, env config, store snapshots).
- **Hydration model**: Angular reuses server DOM rather than re-rendering. DOM structure between server and client must match or hydration mismatch errors fire.
- **Incremental hydration** (Angular 21, stable): pairs with `@defer` blocks using `hydrate on idle | viewport | interaction | timer | never` triggers. Built on event replay (which is enabled automatically). Reduces initial JS.
- **Serialization constraints**: TransferState values are passed through `JSON.stringify` / `JSON.parse`. No class instances, no `Date`, no `Map`/`Set`, no functions. Reconstruct on the client.
- **Platform guards**: Use `isPlatformBrowser(inject(PLATFORM_ID))` for browser-only APIs (localStorage, window, IntersectionObserver) inside store factories.
- **State stores under SSR**:
  - **NgRx Classic Store**: feed initial state via `TransferState` in an `APP_INITIALIZER` or `provideAppInitializer`.
  - **SignalStore**: hydrate inside `withHooks({ onInit })` by reading a `TransferState` key on the client and calling `patchState`. On server, write to `TransferState` after the data loads.
  - **`httpResource`**: when used during SSR, its underlying `HttpClient` request flows through the transfer cache, so the resource resolves on the client without re-fetching. **Experimental.**
- **Auth-bearing requests**: by default the transfer cache skips requests with `Authorization`/`Proxy-Authorization` headers. Opt in with `includeRequestsWithAuthHeaders: true` only when safe.
- **Zoneless interaction**: Angular 21 is zoneless by default. Hydration still works zoneless; signal updates from `patchState` trigger CD without zone microtasks.

## Code Patterns

### 1. Enable hydration + transfer cache + incremental hydration

```ts
// apps/web/src/app/app.config.ts
import { ApplicationConfig } from '@angular/core';
import {
  provideClientHydration,
  withEventReplay,
  withIncrementalHydration,
  withHttpTransferCacheOptions,
} from '@angular/platform-browser';
import { provideHttpClient, withFetch } from '@angular/common/http';

export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(withFetch()),
    provideClientHydration(
      withIncrementalHydration(),
      withHttpTransferCacheOptions({
        filter: (req) => req.method === 'GET' && !req.url.includes('/internal/'),
        includeHeaders: ['x-locale'],
      }),
    ),
  ],
};
```

`withIncrementalHydration()` implies `withEventReplay()` — drop the latter if both are present.

### 2. Manual TransferState for non-HTTP data

```ts
// libs/shared/state/feature-flags.service.ts
import { inject, Injectable, PLATFORM_ID, TransferState, makeStateKey } from '@angular/core';
import { isPlatformServer } from '@angular/common';

const FLAGS_KEY = makeStateKey<Record<string, boolean>>('feature-flags');

@Injectable({ providedIn: 'root' })
export class FeatureFlagsService {
  private state = inject(TransferState);
  private platformId = inject(PLATFORM_ID);

  load(serverFlags?: Record<string, boolean>) {
    if (isPlatformServer(this.platformId) && serverFlags) {
      this.state.set(FLAGS_KEY, serverFlags);
      return serverFlags;
    }
    return this.state.get(FLAGS_KEY, {});
  }
}
```

### 3. Hydrating a SignalStore from TransferState

```ts
// libs/products/data-access/products.store.ts
import { inject, TransferState, makeStateKey, PLATFORM_ID } from '@angular/core';
import { isPlatformServer } from '@angular/common';
import { signalStore, withState, withMethods, withHooks, patchState } from '@ngrx/signals';
import { ProductsApi, Product } from './products.api';

type ProductsState = { items: Product[]; loaded: boolean };
const PRODUCTS_KEY = makeStateKey<ProductsState>('products-store');

export const ProductsStore = signalStore(
  { providedIn: 'root' },
  withState<ProductsState>({ items: [], loaded: false }),
  withMethods((store, api = inject(ProductsApi)) => ({
    async loadAll() {
      const items = await api.list();
      patchState(store, { items, loaded: true });
    },
  })),
  withHooks({
    onInit(store) {
      const ts = inject(TransferState);
      const isServer = isPlatformServer(inject(PLATFORM_ID));

      if (!isServer) {
        const cached = ts.get(PRODUCTS_KEY, null);
        if (cached) {
          patchState(store, cached);
          return;
        }
      }

      store.loadAll().then(() => {
        if (isServer) {
          ts.set(PRODUCTS_KEY, { items: store.items(), loaded: store.loaded() });
        }
      });
    },
  }),
);
```

### 4. httpResource under SSR (experimental)

```ts
// libs/products/data-access/products.resource.ts
import { httpResource } from '@angular/common/http';
import { signal } from '@angular/core';

export const productsResource = () => {
  const page = signal(1);
  // Server fetch is auto-cached via HttpTransferCache,
  // so the client resolves synchronously after hydration.
  const resource = httpResource<Product[]>(() => `/api/products?page=${page()}`);
  return { page, resource };
};
```

> **API Status: Experimental**
> `httpResource` is marked `@experimental` in Angular 21.0.0. Behaviour during SSR + hydration is stable but the signature may shift.

### 5. Hydrating NgRx Classic Store

```ts
// apps/web/src/app/state/hydrate.provider.ts
import { provideAppInitializer, inject, TransferState, makeStateKey, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Store } from '@ngrx/store';
import { hydrateState } from './app.actions';

const STATE_KEY = makeStateKey<unknown>('ngrx-state');

export const hydrateProviders = [
  provideAppInitializer(() => {
    const ts = inject(TransferState);
    const store = inject(Store);
    if (isPlatformBrowser(inject(PLATFORM_ID))) {
      const snapshot = ts.get(STATE_KEY, null);
      if (snapshot) store.dispatch(hydrateState({ snapshot }));
    }
  }),
];
```

Pair with a meta-reducer that merges `hydrateState.snapshot` into the root state on the client and serializes it on the server.

### 6. Avoiding hydration mismatches

```ts
// apps/web/src/app/components/clock.component.ts
import { Component, signal, afterNextRender } from '@angular/core';

@Component({
  selector: 'app-clock',
  template: `<time>{{ now() ?? '--:--' }}</time>`,
})
export class ClockComponent {
  now = signal<string | null>(null);
  constructor() {
    afterNextRender(() => {
      this.now.set(new Date().toLocaleTimeString());
      setInterval(() => this.now.set(new Date().toLocaleTimeString()), 1000);
    });
  }
}
```

Server renders `--:--`; client hydrates the same DOM, then `afterNextRender` activates the clock — no mismatch.

### 7. Incremental hydration boundary

```html
@defer (hydrate on viewport) {
  <app-recommendations />
} @placeholder {
  <div class="skeleton"></div>
}
```

## Breaking Changes and Gotchas

- **Auth headers excluded from transfer cache by default**. Tokens stay on the server. Opt in only for non-sensitive responses.
- **Two serializations of the same state** — if you both call `TransferState.set` and use the HTTP transfer cache for the same data you'll double-pay payload size. See angular/angular#63524.
- **`Date`, `Map`, `Set`, class instances** lose their prototypes through TransferState. Convert to ISO strings / plain objects and rebuild on the client.
- **Hydration mismatch on `localStorage`** — never read storage during render; use `afterNextRender` or guard with `isPlatformBrowser`.
- **`withEventReplay` redundant** with `withIncrementalHydration` — Angular logs a warning.
- **SignalStore lifecycle on the server**: `onInit` runs in both contexts. Use platform guards to avoid setting up browser-only side effects (intervals, listeners, IntersectionObserver) on the server.
- **Lazy SignalStore in lazy components**: a `providedIn: 'root'` SignalStore created during a server render needs its TransferState write to happen before the response is flushed. Prefer awaited promises in `onInit`, or pre-load via `provideAppInitializer`.
- **Zoneless + SSR**: works, but ensure no library you depend on calls `NgZone.run` — it'll throw under zoneless bootstrap.
- **`httpResource` SSR**: only the first GET is cached. Reactive re-fetches triggered after hydration go to the network.

## Sources

- [Angular Hydration guide](https://angular.dev/guide/hydration)
- [Angular Incremental Hydration guide](https://angular.dev/guide/incremental-hydration)
- [`withIncrementalHydration` API](https://angular.dev/api/platform-browser/withIncrementalHydration)
- [`withHttpTransferCacheOptions` API](https://angular.dev/api/platform-browser/withHttpTransferCacheOptions)
- [`HttpTransferCacheOptions` API](https://angular.dev/api/common/http/HttpTransferCacheOptions)
- [`TransferState` API](https://angular.dev/api/core/TransferState)
- [Angular SSR guide](https://angular.dev/guide/ssr)
- [angular/angular#63524 — duplicate serialization warning](https://github.com/angular/angular/issues/63524)
- [angular/angular#54745 — Authorization header caching](https://github.com/angular/angular/issues/54745)
- [NgRx Signals guide](https://ngrx.io/guide/signals)
- [larscom/ngrx-signals-storage (SSR-aware persistence)](https://github.com/larscom/ngrx-signals-storage)
- [House of Angular — Optimizing Angular SSR with Incremental Hydration](https://houseofangular.io/optimizing-angular-ssr-with-incremental-hydration-experimental/)
- [Push-Based — Implementing Incremental Hydration in Angular](https://push-based.io/article/implementing-incremental-hydration-in-angular-part-3-3)
- [Angular Architects — Updated SSR guide](https://www.angulararchitects.io/blog/guide-for-ssr/)

## Open Questions

- Confirm whether `httpResource` writes its response into the same `ng/state` cache used by `HttpClient` or a separate channel — official docs are thin. Verify by inspecting the rendered HTML in an Angular 21 sample app before publishing.
- Confirm `withIncrementalHydration` is fully stable (not developer preview) in Angular 21 GA — sources are mixed; some refer to "experimental" copy from the v19 era.
