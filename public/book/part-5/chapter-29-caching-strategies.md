# Chapter 29: Caching Strategies

A sales rep opens the product catalog, clicks into a pump, hits back, clicks into the next pump, hits back, and clicks into a third. Three navigations, three identical `GET /api/products` calls, three spinners, three flashes of empty list. The data did not change between clicks. The user knows it did not change. Your store fetched it anyway because the feature component was destroyed and recreated, and on init it called `load()` like a good citizen. The fix is not to keep the component alive. The fix is to teach the store the difference between "I have no data" and "I have data that is still good enough."

This chapter is about that distinction. We will look at where a cache can live in an Angular 21 application, how to express time-to-live and stale-while-revalidate without writing a framework, and how to invalidate entries when a mutation makes them lie. The previous chapter handled data that pushes itself into the store. This chapter handles data that you have to ask for, and the question is how often.

## A Brief Recap

Two things from earlier chapters carry into this one. First, a SignalStore declared with `{ providedIn: 'root' }` outlives any component, which means state placed there survives navigation. Second, NgRx 21's `withEntities` gives us a normalized, id-keyed collection that is the natural home for a per-entity cache. We will lean on both.

## Where a Cache Can Live

There are four reasonable places to put a cache in an Angular 21 app. They are not alternatives, they are layers, and most production apps use two or three at once.

**The HTTP layer.** A `HttpInterceptorFn` sits between every `HttpClient` call and the network. A cache here is transparent: components and stores never know it exists. That is its strength and its weakness. It is easy to add and impossible to reason about from the store's point of view, because the store cannot tell whether a response came from the wire or from memory.

**The resource scope.** Angular's `resource` and `httpResource` cache their last successful value for as long as the resource instance is alive. If the resource is created inside a component, the cache dies with the component. If it is created inside a `providedIn: 'root'` service, it lives forever. There is no TTL knob; you express staleness by changing the params signal or calling `reload()`.

**The feature SignalStore.** This is the layer where you have full control. You record `fetchedAt`, you compute `isStale`, you skip the load when the data is fresh, you expose `invalidate()` for mutations to call. The store is the cache.

**The root SignalStore.** Same shape as a feature store, but `providedIn: 'root'` and shared across the whole app. Use this for reference data: countries, warehouses, currencies, the kind of list that thirty different features need and nobody wants to refetch.

The rule of thumb: cache as close to the consumer as you can without duplicating the cache. Reference data goes in a root store. Feature data goes in a feature store. Per-component, per-route, ephemeral data goes in a `resource`. The HTTP interceptor is for last-resort backstops, never for primary caching.

## TTL: The Simplest Useful Strategy

Time-to-live caching is two facts plus one question. The facts are `fetchedAt` (when the data arrived) and `ttl` (how long it stays acceptable). The question, asked on every load attempt, is `Date.now() - fetchedAt > ttl`. If yes, refetch. If no, return what we have.

Here is the pattern as a SignalStore. We continue with the products catalog from earlier chapters.

```ts
// libs/products/data-access/src/lib/products-cache.store.ts
import { computed, inject } from '@angular/core';
import {
  signalStore,
  withState,
  withMethods,
  withComputed,
  patchState,
} from '@ngrx/signals';
import { withEntities, setAllEntities } from '@ngrx/signals/entities';
import { ProductsApi, type Product } from './products.api';

const TTL_MS = 60_000;

type CacheState = {
  fetchedAt: number | null;
  status: 'idle' | 'loading' | 'success' | 'error';
  error: string | null;
};

const initial: CacheState = {
  fetchedAt: null,
  status: 'idle',
  error: null,
};

export const ProductsCacheStore = signalStore(
  { providedIn: 'root' },
  withEntities<Product>(),
  withState(initial),
  withComputed(({ fetchedAt }) => ({
    isStale: computed(() => {
      const t = fetchedAt();
      return t === null || Date.now() - t > TTL_MS;
    }),
  })),
  withMethods((store, api = inject(ProductsApi)) => ({
    async load(force = false) {
      if (!force && !store.isStale() && store.status() === 'success') {
        return;
      }
      patchState(store, { status: 'loading', error: null });
      try {
        const products = await api.list();
        patchState(store, setAllEntities(products));
        patchState(store, { status: 'success', fetchedAt: Date.now() });
      } catch (e) {
        patchState(store, {
          status: 'error',
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },
    invalidate(): void {
      patchState(store, { fetchedAt: null });
    },
  })),
);
```

The component does not need to know any of this. It calls `load()` on init, and the store decides whether to hit the network.

```ts
// libs/products/feature/src/lib/products-list.component.ts
import { Component, OnInit, inject } from '@angular/core';
import { ProductsCacheStore } from '@products/data-access';

@Component({
  selector: 'app-products-list',
  template: `
    @if (store.status() === 'loading' && store.entities().length === 0) {
      <p>Loading…</p>
    } @else {
      <ul>
        @for (p of store.entities(); track p.id) {
          <li>{{ p.name }}</li>
        }
      </ul>
    }
  `,
})
export class ProductsListComponent implements OnInit {
  protected readonly store = inject(ProductsCacheStore);
  ngOnInit(): void { this.store.load(); }
}
```

Notice the `status === 'loading' && entities.length === 0` guard in the template. That is the seed of stale-while-revalidate: if we have any data at all, we show it, even while a fresh request is in flight. We will make that explicit next.

## Stale-While-Revalidate

TTL alone is binary: either the data is fresh and you trust it, or it is stale and you block the user on a spinner. SWR adds a middle band. Inside the SWR window, return the cached value immediately *and* kick off a background refresh, then patch the store when the refresh lands. The user sees instant content, and the data heals itself.

The change to `load()` is small. We add a second window and rearrange the order of operations.

```ts
// libs/products/data-access/src/lib/products-cache.store.ts (excerpt)
const FRESH_MS = 30_000;
const SWR_MS = 5 * 60_000;

withMethods((store, api = inject(ProductsApi)) => {
  const fetchAndPatch = async () => {
    try {
      const products = await api.list();
      patchState(store, setAllEntities(products));
      patchState(store, { status: 'success', fetchedAt: Date.now() });
    } catch (e) {
      patchState(store, {
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  return {
    async load(force = false): Promise<void> {
      const t = store.fetchedAt();
      const age = t === null ? Infinity : Date.now() - t;

      if (!force && age < FRESH_MS) return;

      if (!force && age < SWR_MS && store.status() === 'success') {
        void fetchAndPatch();
        return;
      }

      patchState(store, { status: 'loading', error: null });
      await fetchAndPatch();
    },
    invalidate(): void {
      patchState(store, { fetchedAt: null });
    },
  };
});
```

Three branches. Inside the fresh window, do nothing. Inside the SWR window, return immediately and revalidate in the background without flipping `status` to `loading`. Outside both windows, fall back to a normal blocking load. The component code does not change at all.

## SWR in the View Layer with `linkedSignal`

There is a second flavor of SWR that lives in the component, not the store. When you use `httpResource` or `resource` directly, the resource clears its `value` to `undefined` between requests. That is what causes the empty flash. `linkedSignal` lets you remember the previous good value while the next one loads.

```ts
// libs/products/feature/src/lib/product-detail.component.ts
import { Component, input, linkedSignal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import type { Product } from '@products/data-access';

@Component({
  selector: 'app-product-detail',
  template: `
    @if (lastGood(); as p) {
      <article [class.refreshing]="product.isLoading()">
        <h1>{{ p.name }}</h1>
        <p>{{ p.description }}</p>
      </article>
    } @else if (product.isLoading()) {
      <p>Loading…</p>
    } @else if (product.error()) {
      <p class="error">Could not load product.</p>
    }
  `,
  styles: `.refreshing { opacity: 0.7; transition: opacity 150ms; }`,
})
export class ProductDetailComponent {
  readonly id = input.required<string>();

  protected readonly product = httpResource<Product>(
    () => `/api/products/${this.id()}`,
  );

  protected readonly lastGood = linkedSignal<Product | undefined, Product | undefined>({
    source: this.product.value,
    computation: (next, previous) => next ?? previous?.value,
  });
}
```

> **API Status: Experimental**
> `httpResource` is marked as `@experimental` in Angular 21.0.0. The reactive shape is stable but the request configuration object may grow new fields in future minor releases.

When the `id` input changes, `httpResource` re-runs, `value` briefly becomes `undefined`, and `linkedSignal`'s computation falls back to the previous value. The CSS class `refreshing` dims the panel so the user knows the screen is updating, but they never see an empty container.

## Tag-Based Invalidation

TTL handles the case where data goes stale on its own. Tags handle the case where *you* know it just went stale because you mutated it. The pattern: a mutation declares a list of tags, a bus broadcasts those tags, and any store that cares about a tag invalidates the matching part of its cache.

```ts
// libs/shared/cache/src/lib/cache-bus.ts
import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class CacheBus {
  private readonly lastInvalidated = signal<{ tag: string; at: number } | null>(null);
  readonly event = this.lastInvalidated.asReadonly();

  invalidate(tag: string): void {
    this.lastInvalidated.set({ tag, at: Date.now() });
  }
}
```

Stores subscribe through `withHooks` and an effect. We extend `ProductsCacheStore` to listen for the `'products'` tag.

```ts
// libs/products/data-access/src/lib/products-cache.store.ts (excerpt)
import { effect } from '@angular/core';
import { withHooks, getState } from '@ngrx/signals';
import { CacheBus } from '@shared/cache';

withHooks({
  onInit(store, bus = inject(CacheBus)) {
    effect(() => {
      const e = bus.event();
      if (e?.tag === 'products') {
        patchState(store, { fetchedAt: null });
        void store.load();
      }
    });
  },
});
```

Now any feature that creates, updates, or deletes a product calls `bus.invalidate('products')` after the mutation succeeds, and every store listening to that tag refetches. The mutation code does not need a reference to `ProductsCacheStore`, which keeps cross-feature coupling out of the dependency graph.

## A Last-Resort HTTP Interceptor

Sometimes you do not own the call site. A third-party widget hits an endpoint, or a legacy service spreads `HttpClient` calls across forty files you cannot rewrite. An HTTP interceptor is the right tool for that case, and only that case.

```ts
// libs/shared/http-cache/src/lib/http-cache.interceptor.ts
import { HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { of, tap } from 'rxjs';

interface CacheEntry {
  response: HttpResponse<unknown>;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const FRESH_MS = 30_000;

export const httpCacheInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.method !== 'GET' || req.headers.has('x-no-cache')) {
    return next(req);
  }

  const key = req.urlWithParams;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < FRESH_MS) {
    return of(hit.response.clone());
  }

  return next(req).pipe(
    tap(event => {
      if (event instanceof HttpResponse) {
        cache.set(key, { response: event.clone(), fetchedAt: Date.now() });
      }
    }),
  );
};
```

Wire it via `provideHttpClient(withInterceptors([httpCacheInterceptor]))`. Two things to notice. First, the cache key is `urlWithParams`, not `url`, because `?warehouseId=rotterdam` and `?warehouseId=hamburg` are different responses. Second, there is no per-user scoping. If two users share the same browser tab in dev, or if the app supports user switching, this interceptor will hand user A's data to user B. For anything authenticated, key by user id as well, or do not use this layer at all.

## Common Mistakes

**Caching POST responses.** A surprising number of bugs trace back to an interceptor that "helpfully" cached a `POST /api/orders` response. POSTs are not idempotent. Even if the response body looks like read data, two POSTs with the same body are two distinct events.

```ts
// Wrong
export const cache: HttpInterceptorFn = (req, next) => {
  const hit = store.get(req.urlWithParams);
  if (hit) return of(hit);
  return next(req).pipe(tap(r => store.set(req.urlWithParams, r)));
};

// Right
export const cache: HttpInterceptorFn = (req, next) => {
  if (req.method !== 'GET') return next(req);
  // … rest of the cache logic
};
```

Only `GET` (and arguably `HEAD`) is safe to cache without inspecting semantics.

**Forgetting tenant or user scope in the cache key.** The catalog endpoint returns different data depending on the buyer's contract pricing. Caching by URL alone shows buyer A the prices buyer B negotiated.

```ts
// Wrong
const key = req.urlWithParams;

// Right
const key = `${currentUser.id}::${currentTenant.id}::${req.urlWithParams}`;
```

The same applies to feature stores. If your app supports tenant switching, include the tenant in the cache state and clear `fetchedAt` when the tenant changes.

**Treating `isStale` as "must reload now."** A computed `isStale` signal is convenient, but reading it from a template can trigger a render storm if you also call `load()` from inside a `computed` or `effect` that depends on it. Loads belong in event handlers and `onInit` hooks, not in derived state.

```ts
// Wrong
readonly products = computed(() => {
  if (this.store.isStale()) this.store.load();
  return this.store.entities();
});

// Right
ngOnInit(): void { this.store.load(); }
protected readonly products = this.store.entities;
```

Derived state should be a pure function of inputs. Side effects belong elsewhere.

**Mutating the cached response object.** Returning a shared `HttpResponse` from the interceptor and letting two consumers modify the body breaks both of them. Always `clone()` on the way in and on the way out.

```ts
// Wrong
cache.set(key, { response: event, fetchedAt: now });
return of(hit.response);

// Right
cache.set(key, { response: event.clone(), fetchedAt: now });
return of(hit.response.clone());
```

**No upper bound on the cache.** A `Map` keyed by URL grows forever in a long-lived single-page app. Add an LRU eviction or, simpler, a hard cap with oldest-key eviction.

```ts
// Right
if (cache.size > 200) {
  const oldest = cache.keys().next().value;
  if (oldest !== undefined) cache.delete(oldest);
}
cache.set(key, entry);
```

`Map` preserves insertion order, so the first key is the oldest one inserted.

## Key Takeaways

- Pick the cache layer that matches the consumer: feature stores for feature data, root stores for reference data, `resource`/`httpResource` for component-scoped fetches, HTTP interceptors only as a backstop for code you do not own.
- TTL is two facts and a question: `fetchedAt`, `ttl`, and `Date.now() - fetchedAt > ttl`. Express it as a `computed` `isStale` and gate `load()` on it.
- Stale-while-revalidate is a three-branch `load()`: fresh returns immediately, stale-but-recent returns immediately and revalidates in the background, expired blocks. The view stays steady because `status` only flips to `loading` in the third branch.
- Use `linkedSignal` to keep the last good value visible while a `resource` re-fetches, and dim the UI instead of clearing it.
- Tag-based invalidation through a `CacheBus` keeps mutations from having to know which stores hold which slices, and keeps the dependency graph one-directional.
