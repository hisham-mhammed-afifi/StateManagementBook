# Chapter 30: SSR, Hydration, and State Transfer

A product detail page renders on the server in 80ms. The HTML reaches the browser, paints, and looks instant. Then Angular bootstraps, the `ProductsStore` initializes, and immediately re-fetches the same product the server just loaded. The price field flickers from `$49.00` to `$49.00` as the DOM is replaced. Lighthouse logs a layout shift. The API team notices their request volume just doubled.

This chapter is about closing that gap. We will use Angular 21's hydration features and `TransferState` to ship the server's data to the client so that stores, resources, and HTTP calls all resolve from the cache during hydration. We will hydrate both an NgRx Classic Store and a SignalStore, configure the HTTP transfer cache, opt into incremental hydration, and walk through the patterns that prevent the hydration mismatch errors that bite every team writing SSR for the first time.

## The Double Fetch Problem

Server-side rendering in Angular has three phases. The server renders the component tree to a string. The string is sent to the browser, which paints it as plain HTML. Angular then bootstraps in the browser and hydrates the existing DOM, reusing the nodes the server produced rather than recreating them.

Without help, every state container in the app treats the browser bootstrap as a cold start. A `ProductsStore` with `onInit` calls `loadAll()`. An `httpResource` re-issues its GET. A facade calls a service that calls `HttpClient`. The data is already on the page, but the runtime does not know that. We pay for it twice in API calls and once in DOM churn.

There are two mechanisms in Angular for sending state across the SSR boundary. The HTTP transfer cache handles `HttpClient` GETs automatically. `TransferState` is a manual key/value store for everything else: derived values, store snapshots, environment configuration, anything we computed on the server and want to reuse on the client.

## Enabling Hydration

Hydration is opt-in through `provideClientHydration`. In Angular 21 we layer three features onto it: incremental hydration, configurable HTTP transfer cache, and event replay (which incremental hydration enables for us).

```ts
// src/app/app.config.ts
import { ApplicationConfig } from '@angular/core';
import {
  provideClientHydration,
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

`provideHttpClient(withFetch())` is required for the transfer cache to work. The `fetch` backend is what the SSR runtime uses to issue requests, and it is what writes the responses into the cache that the browser later reads.

`withIncrementalHydration()` automatically enables event replay, so do not also pass `withEventReplay()`. Angular will warn if you do.

The `filter` callback is your escape hatch for endpoints you do not want cached: anything tenant-scoped to the user, anything containing a session token in the URL, anything you intend to invalidate aggressively on the client. Returning `false` keeps the request out of the transfer cache and forces the client to re-fetch.

## How the HTTP Transfer Cache Works

When `HttpClient` issues a GET on the server, the response is stored under a key derived from the URL, method, and any headers listed in `includeHeaders`. Before the response HTML is flushed, Angular serializes the cache into a `<script type="ng/state">` tag at the end of the document. On the browser, the `HttpClient` interceptor checks that cache first; a hit short-circuits the network call and emits the cached response synchronously.

This means any code path that goes through `HttpClient`, including `httpResource`, NgRx effects calling a service, and SignalStore methods, picks up the cached value automatically. You do not need to write any glue code for it.

```ts
// libs/products/data-access/products.api.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Product } from './product.model';

@Injectable({ providedIn: 'root' })
export class ProductsApi {
  private http = inject(HttpClient);

  list(): Observable<Product[]> {
    return this.http.get<Product[]>('/api/products');
  }
}
```

The first SSR call to `list()` hits the API. The browser bootstrap calls `list()` again and the response comes from the cache. No code change in the service.

By default the cache excludes requests with `Authorization` or `Proxy-Authorization` headers, because caching auth-bearing responses in HTML reachable by anyone with a view-source command is a credential leak. If a particular authenticated endpoint is genuinely safe to cache, opt in explicitly:

```ts
withHttpTransferCacheOptions({
  includeRequestsWithAuthHeaders: true,
  filter: (req) => req.url.startsWith('/api/public/'),
});
```

Combine `includeRequestsWithAuthHeaders` with a tight `filter` so the relaxation only applies to a known list of routes.

## TransferState for Non-HTTP Data

`TransferState` is the manual lane. Use it when the value did not come from an `HttpClient` call: an environment flag computed on the server, a feature toggle resolved from a header, the rendered timestamp, or a snapshot of an entire store.

```ts
// libs/shared/feature-flags/feature-flags.service.ts
import { inject, Injectable, PLATFORM_ID, TransferState, makeStateKey } from '@angular/core';
import { isPlatformServer } from '@angular/common';

const FLAGS_KEY = makeStateKey<Record<string, boolean>>('feature-flags');

@Injectable({ providedIn: 'root' })
export class FeatureFlagsService {
  private state = inject(TransferState);
  private platformId = inject(PLATFORM_ID);

  initialize(serverFlags?: Record<string, boolean>): Record<string, boolean> {
    if (isPlatformServer(this.platformId) && serverFlags) {
      this.state.set(FLAGS_KEY, serverFlags);
      return serverFlags;
    }
    return this.state.get(FLAGS_KEY, {});
  }
}
```

`makeStateKey<T>` is the type-safe handle. The string passed to it must be unique across the app; namespace it with a prefix if you have multiple modules writing to TransferState.

The values stored under those keys travel through `JSON.stringify` on the server and `JSON.parse` on the client. Anything that does not survive that round trip will arrive broken. `Date` becomes a string, `Map` becomes `{}`, class instances lose their prototypes and methods. If your state shape contains any of those, normalize it to plain objects before writing to TransferState and reconstruct it after reading.

## Hydrating a SignalStore

A SignalStore that loads data in `onInit` is the most common shape we have used in earlier chapters. Hydrating it means writing its state to TransferState on the server after the load completes, and reading it on the client before the load fires.

```ts
// libs/products/data-access/products.store.ts
import { computed, inject, makeStateKey, PLATFORM_ID, TransferState } from '@angular/core';
import { isPlatformServer } from '@angular/common';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  withHooks,
  patchState,
} from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import { ProductsApi } from './products.api';
import { Product } from './product.model';

type ProductsState = {
  items: Product[];
  status: 'idle' | 'loading' | 'loaded' | 'error';
  error: string | null;
};

const initialState: ProductsState = { items: [], status: 'idle', error: null };
const PRODUCTS_KEY = makeStateKey<ProductsState>('products-store');

export const ProductsStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed(({ items }) => ({
    count: computed(() => items().length),
  })),
  withMethods((store, api = inject(ProductsApi)) => ({
    async loadAll(): Promise<void> {
      patchState(store, { status: 'loading', error: null });
      try {
        const items = await firstValueFrom(api.list());
        patchState(store, { items, status: 'loaded' });
      } catch (e) {
        patchState(store, { status: 'error', error: (e as Error).message });
      }
    },
  })),
  withHooks({
    async onInit(store) {
      const ts = inject(TransferState);
      const isServer = isPlatformServer(inject(PLATFORM_ID));

      if (!isServer) {
        const cached = ts.get(PRODUCTS_KEY, null);
        if (cached) {
          patchState(store, cached);
          return;
        }
      }

      await store.loadAll();

      if (isServer) {
        ts.set(PRODUCTS_KEY, {
          items: store.items(),
          status: store.status(),
          error: store.error(),
        });
      }
    },
  }),
);
```

The hook runs in both contexts. On the server it calls `loadAll()` and snapshots the resulting state into `TransferState`. On the client it checks for that snapshot first and short-circuits the load if it is present. The snapshot must be a plain object, which is why we read each signal explicitly rather than passing the store itself.

Notice that the hook is `async` and the server flow `await`s the load. Angular's SSR runtime waits for pending microtasks before serializing the response, so the `TransferState.set` call lands in the rendered HTML. If you fire-and-forget the load with `.then()`, the server may flush the response before the data arrives.

## Hydrating an NgRx Classic Store

The Classic Store hydrates differently because it is not constructed inside a `withHooks` callback. We use `provideAppInitializer` to write the snapshot on the server and merge it on the client, plus a meta-reducer that listens for a hydrate action.

```ts
// apps/web/src/app/state/hydrate.ts
import {
  inject,
  makeStateKey,
  PLATFORM_ID,
  provideAppInitializer,
  TransferState,
} from '@angular/core';
import { isPlatformBrowser, isPlatformServer } from '@angular/common';
import { ActionReducer, createAction, props, Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';
import { AppState } from './app.state';

const STATE_KEY = makeStateKey<AppState>('ngrx-root-state');

export const hydrateState = createAction(
  '[Hydration] Apply',
  props<{ snapshot: AppState }>(),
);

export function hydrationMetaReducer(
  reducer: ActionReducer<AppState>,
): ActionReducer<AppState> {
  return (state, action) => {
    if (action.type === hydrateState.type) {
      return { ...state, ...(action as ReturnType<typeof hydrateState>).snapshot };
    }
    return reducer(state, action);
  };
}

export const hydrateProviders = [
  provideAppInitializer(async () => {
    const ts = inject(TransferState);
    const store = inject(Store<AppState>);
    const platformId = inject(PLATFORM_ID);

    if (isPlatformBrowser(platformId)) {
      const snapshot = ts.get(STATE_KEY, null);
      if (snapshot) {
        store.dispatch(hydrateState({ snapshot }));
      }
      return;
    }

    if (isPlatformServer(platformId)) {
      const snapshot = await firstValueFrom(store.select((s) => s).pipe(take(1)));
      ts.set(STATE_KEY, snapshot);
    }
  }),
];
```

Register `hydrationMetaReducer` in your `provideStore` configuration so the dispatched action actually merges into state, and add `hydrateProviders` to the app providers. The meta-reducer pattern was introduced in Chapter 14, and this is the canonical case where it earns its complexity.

For the server snapshot to be useful, the store must already contain the data you want to send. In practice that means dispatching whatever load actions the route resolver or component would dispatch, and waiting for the resulting effect chains to settle before the initializer reads state. If your effects use `switchMap` to call HTTP services, those calls flow through the transfer cache automatically, so the client gets both the merged state action and the cached HTTP responses.

## httpResource Under SSR

`httpResource` is the signal-native way to fetch data, and it integrates with the transfer cache without any extra wiring.

> **API Status: Experimental**
> `httpResource` is marked `@experimental` in Angular 21.0.0. SSR behavior is stable but the signature may shift in future versions.

```ts
// libs/products/feature/products-page.component.ts
import { Component, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { Product } from '@app/products/data-access';

@Component({
  selector: 'app-products-page',
  template: `
    @if (products.isLoading()) {
      <p>Loading...</p>
    } @else if (products.error()) {
      <p>Failed to load.</p>
    } @else {
      <ul>
        @for (p of products.value() ?? []; track p.id) {
          <li>{{ p.name }} - {{ p.price | currency }}</li>
        }
      </ul>
    }
  `,
})
export class ProductsPageComponent {
  protected page = signal(1);
  protected products = httpResource<Product[]>(
    () => `/api/products?page=${this.page()}`,
  );
}
```

On the server the resource issues a GET, the transfer cache stores the response, and the rendered HTML includes both the product list and the cache entry. On the client `httpResource` re-evaluates its URL, hits the cache, and resolves synchronously. The user sees no loading state on first load. Only when `page` changes does a real network call happen.

## Avoiding Hydration Mismatches

Hydration reuses the server DOM rather than rebuilding it. If the client renders different markup than the server did, Angular logs a hydration mismatch error and falls back to a full re-render, which negates the benefit of SSR.

The most common cause is rendering values that are different on the server and client: timestamps, random numbers, anything from `localStorage`, anything from `window`. The fix is to render a stable placeholder during the initial pass and only activate the dynamic value after hydration.

```ts
// src/app/components/clock.component.ts
import { afterNextRender, Component, signal } from '@angular/core';

@Component({
  selector: 'app-clock',
  template: `<time>{{ now() ?? '--:--:--' }}</time>`,
})
export class ClockComponent {
  protected now = signal<string | null>(null);

  constructor() {
    afterNextRender(() => {
      this.now.set(new Date().toLocaleTimeString());
      setInterval(() => this.now.set(new Date().toLocaleTimeString()), 1000);
    });
  }
}
```

`afterNextRender` runs only in the browser and only after hydration completes. The server renders `--:--:--`, the client hydrates the same DOM, and then the timer kicks in. No mismatch, no flicker.

The same pattern applies to `localStorage`-backed state. Read storage inside `afterNextRender` and `patchState` the result into your store. Never read it during a `computed` or template expression that runs on the server.

## Incremental Hydration

Incremental hydration delays hydrating parts of the page until they are needed. It piggybacks on `@defer` blocks: instead of hydrating the entire component tree at bootstrap, Angular leaves deferred blocks dehydrated and only wakes them when their trigger fires.

```html
<!-- libs/products/feature/product-detail.component.html -->
<app-product-summary [product]="product()" />

@defer (hydrate on viewport) {
  <app-recommendations [productId]="product().id" />
} @placeholder {
  <div class="skeleton-card"></div>
}

@defer (hydrate on interaction) {
  <app-reviews [productId]="product().id" />
} @placeholder {
  <button>Show reviews</button>
}
```

The summary hydrates immediately. The recommendations stay dehydrated until they scroll into view. The reviews stay dehydrated until the user clicks. Each block pulls in its JavaScript only when triggered, so the initial bundle shrinks.

Stores referenced inside a deferred block follow the same rule: their `onInit` runs when the block hydrates, not at bootstrap. If you rely on a store's TransferState snapshot in a deferred block, the snapshot must still be present when the block wakes up. TransferState is read-once per key by default, so if two deferred blocks both read `PRODUCTS_KEY`, store the result in a service-level cache rather than reading TransferState twice.

## Common Mistakes

**Storing class instances in TransferState.** A `Date` object travels as a string and arrives as a string. A `Money` class loses its `format()` method. Anything that depends on the prototype breaks silently.

```ts
// Wrong
ts.set(ORDER_KEY, { id: '42', placedAt: new Date(), total: new Money(49, 'USD') });

// Right
ts.set(ORDER_KEY, { id: '42', placedAt: new Date().toISOString(), total: { amount: 49, currency: 'USD' } });
// then on the client:
const raw = ts.get(ORDER_KEY, null);
const order = raw && { ...raw, placedAt: new Date(raw.placedAt), total: new Money(raw.total.amount, raw.total.currency) };
```

TransferState is a JSON channel. Treat it like one.

**Reading `localStorage` during render.** The server has no `localStorage`, so the value is always `null` on the server and the real value on the client. Hydration mismatches and a `ReferenceError` if you do not guard.

```ts
// Wrong
@Component({ template: `<p>Theme: {{ theme }}</p>` })
export class ThemeBadge {
  protected theme = localStorage.getItem('theme') ?? 'light';
}

// Right
export class ThemeBadge {
  protected theme = signal<'light' | 'dark'>('light');
  constructor() {
    afterNextRender(() => {
      this.theme.set((localStorage.getItem('theme') as 'light' | 'dark') ?? 'light');
    });
  }
}
```

The server renders `light`, the client hydrates `light`, and then the real preference is applied as a normal signal update.

**Fire-and-forget loads in a server `onInit`.** The store starts loading, the SSR runtime sees no pending microtasks, and the response is flushed before `loadAll()` resolves. The TransferState write happens after the HTML has already gone out the door.

```ts
// Wrong
withHooks({
  onInit(store) {
    store.loadAll().then(() => {
      if (isPlatformServer(inject(PLATFORM_ID))) {
        inject(TransferState).set(KEY, snapshot(store));
      }
    });
  },
});

// Right
withHooks({
  async onInit(store) {
    await store.loadAll();
    if (isPlatformServer(inject(PLATFORM_ID))) {
      inject(TransferState).set(KEY, snapshot(store));
    }
  },
});
```

`async`/`await` keeps the microtask alive until the snapshot lands.

**Caching authenticated endpoints by default.** Opting all auth-bearing requests into the transfer cache leaks one user's data to anyone who views the page source.

```ts
// Wrong
withHttpTransferCacheOptions({ includeRequestsWithAuthHeaders: true });

// Right
withHttpTransferCacheOptions({
  includeRequestsWithAuthHeaders: true,
  filter: (req) =>
    req.url.startsWith('/api/public/') || req.url.startsWith('/api/catalog/'),
});
```

Always pair the relaxation with an explicit allowlist.

**Combining `withEventReplay` and `withIncrementalHydration`.** Incremental hydration enables event replay automatically. Passing both makes Angular log a warning and is a sign the config was copy-pasted without reading the docs.

```ts
// Wrong
provideClientHydration(withEventReplay(), withIncrementalHydration());

// Right
provideClientHydration(withIncrementalHydration());
```

## Key Takeaways

- The HTTP transfer cache handles `HttpClient` GETs automatically once `provideClientHydration` and `provideHttpClient(withFetch())` are in place. Anything that calls a service that calls `HttpClient` benefits without code changes.
- Use `TransferState` and `makeStateKey` for non-HTTP state: store snapshots, computed values, environment configuration. Treat it as a JSON channel and normalize away `Date`, `Map`, and class instances before writing.
- Hydrate a SignalStore inside `withHooks({ onInit })` with platform guards and `await`ed loads. Hydrate a Classic Store with `provideAppInitializer` plus a meta-reducer that merges a `hydrateState` action.
- Anything that differs between server and client (timestamps, `localStorage`, `window`) must render a stable placeholder during SSR and update inside `afterNextRender`. Otherwise you get hydration mismatches and lose the benefit of SSR.
- Incremental hydration with `withIncrementalHydration()` and `@defer (hydrate on ...)` shrinks the initial JavaScript by leaving below-the-fold blocks dehydrated until a trigger fires. Stores referenced inside deferred blocks initialize when the block hydrates, not at bootstrap.
