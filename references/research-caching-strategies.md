---
chapter: 29
title: Caching Strategies (stale-while-revalidate, TTL, invalidation)
date: 2026-04-08
status: Ready for chapter generation
---

# Research: Caching Strategies

**Date:** 2026-04-08
**Chapter:** Ch 29
**Status:** Ready for chapter generation

## Scope (from outline)

Stale-while-revalidate, TTL, invalidation. Targeted at Angular 21 / NgRx 21 with
emphasis on signal-based primitives (`resource`, `httpResource`, SignalStore)
and how cache lifetimes interact with state stores.

## API Surface

### Angular core
- `resource({ params, loader })` -- `@angular/core` -- **Stable in v21**.
  Re-runs `loader` when `params` signal changes; exposes `value`, `status`,
  `error`, `reload()`. Cache lives as long as the resource instance lives
  (component / store scope).
- `httpResource(() => url | request)` -- `@angular/common/http` --
  **Experimental in v21**. Wraps `HttpClient` in a `resource`. No built-in TTL
  or SWR; caching must be layered via interceptors or wrapper stores.
- `linkedSignal({ source, computation })` -- `@angular/core` -- Stable.
  Useful for "previous value while loading" SWR-style UI.
- `HttpInterceptorFn` -- `@angular/common/http` -- Stable. The standard hook
  for implementing a global HTTP cache (memory map keyed by URL + method).

### NgRx
- `signalStore`, `withState`, `withMethods`, `withHooks`, `withProps` --
  `@ngrx/signals` v21. Used to build cache-aware feature stores.
- `withEntities` -- `@ngrx/signals/entities`. Entity adapter for normalized
  caches keyed by id.
- `rxMethod` -- `@ngrx/signals/rxjs-interop`. Useful for debounced revalidation
  pipelines.
- NgRx classic: `createFeature`, `createReducer`, `createSelector`,
  `createEffect`. The "cache + load status" pattern (Rainer Hahnekamp) lives
  here too.

### Third-party (mention only)
- TanStack Query Angular adapter -- still **developer preview** in 2026
  (`@tanstack/angular-query-experimental`). Has built-in `staleTime`, `gcTime`,
  query invalidation, and SWR semantics. Worth a comparison sidebar.

## Key Concepts

- **Why cache at all in a state store world.** Stores already deduplicate
  reads; caching is about *not refetching* across navigations and *not
  blocking* the user when data is "good enough".
- **Freshness vs liveness.** TTL = how long cached data is acceptable.
  SWR = serve stale immediately, revalidate in background, swap when fresh
  arrives.
- **Cache keys.** URL is rarely enough. Include query params, auth scope,
  tenant id. Normalize to a deterministic string.
- **Where the cache lives.**
  1. HTTP layer (interceptor) -- transparent, but invisible to stores.
  2. Resource scope -- automatic via `resource`/`httpResource`, dies with the
     consumer.
  3. Feature SignalStore -- explicit, supports invalidation tags.
  4. Root SignalStore (providedIn: 'root') -- app-wide cache.
- **Invalidation strategies.**
  - Time-based (TTL) -- store `fetchedAt`, recompute `isStale`.
  - Tag-based -- mutations declare which tags they invalidate.
  - Event-based -- websocket/SSE pushes drop entries.
  - Manual -- `reload()` on a resource, `invalidate(id)` on a store.
- **The cache + load status pattern.** Track per-key `status:
  'idle' | 'loading' | 'success' | 'error'` and `fetchedAt`. Selectors expose
  `isStale(key)` derived from `Date.now() - fetchedAt > ttl`.
- **SWR with `linkedSignal`.** Keep the last successful value visible while
  the next request runs.
- **Pitfalls.** Caching auth-scoped data without scoping the key. Forgetting
  to invalidate after a mutation. Stale data after route reuse. Memory leaks
  from unbounded LRU. Caching POSTs.

## Code Patterns

### 1. HTTP interceptor with TTL + SWR

```ts
// libs/shared/http-cache/src/lib/http-cache.interceptor.ts
import { HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { of, tap } from 'rxjs';

interface CacheEntry {
  response: HttpResponse<unknown>;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const TTL = 30_000;
const SWR_WINDOW = 5 * 60_000;

export const httpCacheInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.method !== 'GET') return next(req);

  const key = req.urlWithParams;
  const entry = cache.get(key);
  const now = Date.now();

  if (entry && now - entry.fetchedAt < TTL) {
    return of(entry.response.clone());
  }

  const stream = next(req).pipe(
    tap(event => {
      if (event instanceof HttpResponse) {
        cache.set(key, { response: event.clone(), fetchedAt: now });
      }
    })
  );

  if (entry && now - entry.fetchedAt < SWR_WINDOW) {
    stream.subscribe();
    return of(entry.response.clone());
  }

  return stream;
};
```

### 2. SignalStore with TTL + tag invalidation

```ts
// libs/products/data-access/src/lib/products.store.ts
import { computed, inject } from '@angular/core';
import { signalStore, withState, withMethods, withComputed, patchState } from '@ngrx/signals';
import { withEntities, setAllEntities } from '@ngrx/signals/entities';
import { ProductsApi } from './products.api';

const TTL = 60_000;

type CacheState = {
  fetchedAt: number | null;
  status: 'idle' | 'loading' | 'success' | 'error';
  error: string | null;
};

export const ProductsStore = signalStore(
  { providedIn: 'root' },
  withEntities<Product>(),
  withState<CacheState>({ fetchedAt: null, status: 'idle', error: null }),
  withComputed(({ fetchedAt }) => ({
    isStale: computed(() => {
      const t = fetchedAt();
      return t === null || Date.now() - t > TTL;
    }),
  })),
  withMethods((store, api = inject(ProductsApi)) => ({
    async load(force = false) {
      if (!force && !store.isStale()) return;
      patchState(store, { status: 'loading', error: null });
      try {
        const products = await api.list();
        patchState(store, setAllEntities(products));
        patchState(store, { status: 'success', fetchedAt: Date.now() });
      } catch (e) {
        patchState(store, { status: 'error', error: String(e) });
      }
    },
    invalidate() {
      patchState(store, { fetchedAt: null });
    },
  })),
);
```

### 3. SWR UI with `linkedSignal` + `httpResource`

```ts
// libs/products/feature/src/lib/product-detail.component.ts
import { Component, input, linkedSignal } from '@angular/core';
import { httpResource } from '@angular/common/http';

@Component({
  selector: 'app-product-detail',
  template: `
    @if (lastGood()) {
      <article [class.refreshing]="product.isLoading()">
        <h1>{{ lastGood()!.name }}</h1>
      </article>
    } @else if (product.isLoading()) {
      <p>Loading…</p>
    }
  `,
})
export class ProductDetailComponent {
  id = input.required<string>();

  product = httpResource<Product>(() => `/api/products/${this.id()}`);

  lastGood = linkedSignal<Product | undefined, Product | undefined>({
    source: this.product.value,
    computation: (next, prev) => next ?? prev?.value,
  });
}
```

> **API Status: Experimental**
> `httpResource` is marked as `@experimental` in Angular 21.0.0.

### 4. Tag-based invalidation across stores

```ts
// libs/shared/cache/src/lib/cache-bus.ts
import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class CacheBus {
  private readonly tick = signal(0);
  readonly version = this.tick.asReadonly();
  invalidate(_tag: string) { this.tick.update(v => v + 1); }
}
```

Stores subscribe via a `withHooks` `onInit` that watches `bus.version` and
calls `invalidate()` for matching tags.

## Breaking Changes and Gotchas

- `httpResource` is still `@experimental` in Angular 21 -- API may shift.
- Angular 21 is zoneless by default; `setTimeout`-based TTL refresh still
  works but does not trigger CD on its own. Wrap state mutations in signal
  writes (which we already do).
- `withEffects` was renamed to `withEventHandlers` in NgRx v21 -- relevant if
  the chapter cross-references the Events Plugin for invalidation events.
- `Map` based caches are not SSR-safe across requests if the module is
  shared -- see Ch 30. Always scope to a request token in SSR.
- Don't cache responses with `Authorization` headers without keying on user
  identity.
- TanStack Angular Query is still `@tanstack/angular-query-experimental` --
  label as developer preview.

## Sources

- [Angular Service Worker -- stale-while-revalidate](https://angular.dev/ecosystem/service-workers/devops)
- [web.dev: Keeping things fresh with stale-while-revalidate](https://web.dev/articles/stale-while-revalidate)
- [Rainer Hahnekamp -- NgRx Best Practices: Cache & LoadStatus](https://www.rainerhahnekamp.com/en/ngrx-best-practices-series-1-cache-loadstatus/)
- [NgRx SignalStore docs](https://ngrx.io/guide/signals/signal-store)
- [TanStack Query Angular -- Query Invalidation](https://tanstack.com/query/latest/docs/framework/angular/guides/query-invalidation)
- [Tomasz Ducin -- Angular Query Core Concepts](https://ducin.dev/angular-query-core-concepts)
- [DebugBear -- Understanding stale-while-revalidate](https://www.debugbear.com/docs/stale-while-revalidate)

## Open Questions

- Confirm `httpResource` exposes a `reload()` method in v21.0 (vs `refresh()`).
- Verify the exact `linkedSignal` signature for the "previous value" pattern
  in v21.0 -- the `computation` `previous` argument shape changed once
  during developer preview.
- Decide whether to include a TanStack Angular Query sidebar or defer the
  full comparison to Ch 38 (Decision Framework).
