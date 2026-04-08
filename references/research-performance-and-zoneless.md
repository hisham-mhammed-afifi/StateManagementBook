# Research: Performance and Zoneless Change Detection

**Date:** 2026-04-08
**Chapter:** Ch 31
**Status:** Ready for chapter generation

## API Surface

- `signal<T>(initial, { equal? })` — `@angular/core` — Stable. Custom `equal` comparator controls whether writes trigger downstream notifications.
- `computed<T>(fn, { equal? })` — `@angular/core` — Stable. Memoized derivation; uses `equal` to suppress propagation when result is structurally unchanged.
- `linkedSignal({ source, computation, equal? })` — `@angular/core` — Stable in v21.
- `ChangeDetectionScheduler.notify()` — internal — invoked when a consumed signal updates; coalesces work to a microtask.
- `provideZonelessChangeDetection()` — `@angular/core` — Stable. Not required in v21 (zoneless is the default for new apps); still used for explicit configuration or migrating existing apps.
- `afterNextRender(fn)` / `afterEveryRender(fn)` — `@angular/core` — Stable. Replaces ad-hoc `setTimeout` patterns under zoneless.
- `createSelector` / `createFeatureSelector` — `@ngrx/store` — Stable. Reference-equality memoization (last input + last result).
- `createEntityAdapter<T>()` — `@ngrx/entity` — Stable. Provides `getSelectors()` returning `selectIds`, `selectEntities`, `selectAll`, `selectTotal`, all memoized over the normalized shape.
- `patchState(store, updater)` — `@ngrx/signals` — Stable. Replaces slices by reference; downstream `computed`s rely on signal equality.

## Key Concepts

- Angular 21 is zoneless by default. Change detection is driven by explicit notifications: signal writes, template events, `AsyncPipe` emissions, router navigation, and HTTP responses (via `httpResource`).
- The scheduler coalesces notifications into a single microtask-scheduled CD pass, so a burst of `patchState` calls in a tick produces one render.
- Signal equality is the primary performance lever in a zoneless app. The default comparator is `Object.is`, so a fresh object reference always propagates even if structurally identical. Override `equal` for value objects, ID arrays, and computed derivations whose stability you can prove.
- `computed()` is glitch-free: a downstream consumer never sees an inconsistent intermediate state when multiple of its sources change in the same tick.
- NgRx classic selectors memoize on a length-1 cache keyed by reference equality of inputs. Reusing the same selector instance across components is critical, otherwise each component pays its own first-call recomputation cost.
- Entity adapters keep entities in `{ ids: [], entities: {} }` so that ID-only operations (sorting, filtering by id) can run without touching every record. `selectAll` rebuilds an array on every change to the collection — wrap derived projections in another `createSelector` to memoize them.
- SignalStore performance comes from `withComputed` plus structural sharing in `patchState`. Avoid spreading objects you didn't change.
- Zoneless removes the implicit "run CD after every async task" safety net. Third-party libraries that mutate component state from outside Angular's notification surface will silently fail to render. Wrap such updates in a signal write or call `ChangeDetectorRef.markForCheck()` from a component injector context.
- `OnPush` is effectively the default behavior in zoneless mode. Do not prescribe it as a separate optimization step.

## Code Patterns

```ts
// libs/shared/state/src/lib/equality.ts
import { signal } from '@angular/core';

// Without custom equality, every fetch produces a new array reference
// and every downstream computed re-runs even if the IDs are unchanged.
const productIds = signal<string[]>([], {
  equal: (a, b) => a.length === b.length && a.every((id, i) => id === b[i]),
});
```

```ts
// libs/products/data-access/src/lib/products.store.ts
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { computed } from '@angular/core';

export const ProductsStore = signalStore(
  { providedIn: 'root' },
  withState({ items: [] as Product[], filter: '' }),
  withComputed(({ items, filter }) => ({
    // computed memoizes; cheap filter recomputes only when items or filter change.
    visible: computed(() => {
      const f = filter().toLowerCase();
      return f ? items().filter(p => p.name.toLowerCase().includes(f)) : items();
    }),
  })),
  withMethods(store => ({
    setFilter: (filter: string) => patchState(store, { filter }),
  })),
);
```

```ts
// libs/products/data-access/src/lib/products.selectors.ts
import { createSelector, createFeatureSelector } from '@ngrx/store';
import { adapter, ProductsState } from './products.reducer';

export const selectProductsState = createFeatureSelector<ProductsState>('products');
const { selectAll, selectEntities } = adapter.getSelectors();

export const selectAllProducts = createSelector(selectProductsState, selectAll);
export const selectProductEntities = createSelector(selectProductsState, selectEntities);

// Parameterized selector factory: one memoized instance per id keeps the cache hot.
export const selectProductById = (id: string) =>
  createSelector(selectProductEntities, entities => entities[id]);
```

```ts
// libs/shared/realtime/src/lib/socket.bridge.ts
import { inject, Injector, runInInjectionContext } from '@angular/core';

// Third-party callback fires outside Angular's notification surface.
socket.on('tick', payload => {
  // Writing to a signal is enough to schedule CD under zoneless.
  store.applyTick(payload);
});
```

## Breaking Changes and Gotchas

- Zoneless is the v21 default; do not call `provideZoneChangeDetection()` in new apps. Use `provideZonelessChangeDetection()` only when explicitly migrating an existing app.
- `setTimeout`, `setInterval`, and `Promise.then` no longer schedule CD on their own. Translate them to signal writes or `afterNextRender`.
- `NgZone.run()` is a no-op pattern under zoneless and should be removed from new code.
- NgRx selectors memoize a single result. If a component subscribes to two parameterized selectors with different ids, they thrash the cache. Build a selector factory and cache the instance per id.
- `selectAll` from an entity adapter creates a new array every time the collection changes. Don't put it directly in a hot template loop; wrap a downstream projection in `createSelector`.
- Custom `equal` comparators must be pure and cheap. A deep-equal comparator on a large array can cost more than the re-render it saves.
- Effects (`effect()`) run after CD. Writing signals inside an effect requires `allowSignalWrites: true` and is almost always a smell — prefer `linkedSignal` or `computed`.

## Sources

- [Zoneless guide — angular.dev](https://angular.dev/guide/zoneless)
- [Angular v21 Goes Zoneless by Default — Push-Based](https://push-based.io/article/angular-v21-goes-zoneless-by-default-what-changes-why-its-faster-and-how-to)
- [The Latest in Angular Change Detection — angular.love](https://angular.love/the-latest-in-angular-change-detection-zoneless-signals/)
- [A change detection, zone.js, zoneless story — justangular.com](https://justangular.com/blog/a-change-detection-zone-js-zoneless-local-change-detection-and-signals-story/)
- [NgRx Selectors guide — ngrx.io](https://ngrx.io/guide/store/selectors)
- [Parameterized NgRx Selectors — Tim Deschryver](https://timdeschryver.dev/blog/parameterized-selectors)
- [NgRx Selector Performance — dev.to/angular](https://dev.to/angular/ngrx-selector-performance-46fo)
- [Sub-RFC 1: Signals for Angular Reactivity — GitHub discussion #49684](https://github.com/angular/angular/discussions/49684)
- [Angular 21 release coverage — InfoQ](https://www.infoq.com/news/2025/11/angular-21-released/)

## Open Questions

- Confirm whether `linkedSignal` accepts an `equal` option in the final v21.x signature before showing it in a code sample.
- Verify NgRx v21 ships any new selector debugging helpers (e.g., memoization stats) worth mentioning.
