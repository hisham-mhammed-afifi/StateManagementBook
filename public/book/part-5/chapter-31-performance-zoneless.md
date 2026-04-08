# Chapter 31: Performance and Zoneless Change Detection

A products dashboard renders a 2,000 row table with a search box, a sort header, and a sidebar that shows the currently selected row. Typing a single character in the search box freezes the tab for 180ms. The flame chart shows three culprits stacked on top of each other: a `computed` that rebuilds the entire filtered array because its source signal returns a new reference on every keystroke, an NgRx selector that recomputes for every component instance because each one constructed its own selector factory, and a hot template that iterates `selectAll` from an entity adapter without memoizing the projection. None of this code is wrong in isolation. Together, in a zoneless app where every signal write schedules a render, they make the page unusable.

This chapter is about the performance model of Angular 21 with zoneless change detection turned on, and the specific things you can do at the state layer to keep renders cheap. We will look at how the scheduler decides when to run, how signal equality controls propagation, how NgRx selectors and entity adapters memoize their work, and how to spot the patterns that quietly defeat all of the above.

## What Zoneless Actually Changes

Angular 21 ships with zoneless change detection as the default for new applications. The mental model is the inverse of the zone.js era. Under zone.js, Angular ran change detection after every async task the browser fired, on the assumption that something might have changed. Under zoneless, Angular runs change detection only when a known framework entry point tells it to. Those entry points are: a signal write that has a template consumer, an `AsyncPipe` emission, a template event handler, a router navigation, an `httpResource` response, and a manual `markForCheck()` call.

The scheduler that sits behind those entry points is glitch-free and coalescing. Glitch-free means that when a `computed` reads two signals that both change in the same tick, the consumer never sees an inconsistent intermediate value. Coalescing means that a burst of writes inside a single microtask produces exactly one render pass. If a real-time handler calls `patchState` ten times in response to a WebSocket message, the dashboard re-renders once, not ten times.

This is the upside. The downside is that anything Angular does not know about is invisible. A third-party charting library that mutates a component property from a `requestAnimationFrame` callback no longer triggers a render. A `setTimeout` that updates a class field will not paint until something else wakes the scheduler. The fix is always the same: route the update through a signal write or call `markForCheck()` from an injection context.

```ts
// src/app/realtime/price-ticker.bridge.ts
import { Injectable, inject, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class PriceTickerBridge {
  readonly price = signal(0);

  connect(socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const tick = JSON.parse(event.data) as { price: number };
      // Writing to a signal is enough. The scheduler will coalesce
      // a burst of ticks into a single render in the next microtask.
      this.price.set(tick.price);
    });
  }
}
```

In this snippet, the WebSocket callback runs outside any Angular entry point. We do not need to wrap it in `NgZone.run` (there is no zone), and we do not need `markForCheck`. Writing to the signal is the entry point. If we had instead assigned to `this._price = tick.price` on a plain field bound in the template, the screen would never update.

> A historical aside: in the zone.js era you would have wrapped this callback in `ngZone.runOutsideAngular` to avoid spurious change detection, then called `ngZone.run` only when you wanted to commit. Under zoneless, both calls are no-ops. Delete them.

## Signal Equality Is the Main Lever

Every signal has an `equal` comparator. The default is `Object.is`. When you call `set` or `update`, the new value is compared to the current value with the comparator. If they are equal, nothing happens: no notification, no recompute, no render. If they are not, every consumer is invalidated.

`Object.is` is the right default because it is fast and predictable. It is also the source of the most common performance bug in signal-based code. The moment a signal holds an object or an array, `Object.is` will say "not equal" for any fresh reference even when the contents are identical. A reducer that returns `{ ...state }` whenever it runs will invalidate every downstream `computed` whether or not anything actually changed.

There are two ways to handle this. The first is to be careful about reference stability in your writes: if nothing changed, do not return a new object. The second is to override `equal` for signals where you can prove cheap value equality.

```ts
// libs/products/data-access/src/lib/filter.signals.ts
import { signal } from '@angular/core';

// A list of selected category ids. Two arrays with the same ids in the same
// order are equal for our purposes. The comparator is O(n) but n is small,
// and it saves a full table re-render every time the toolbar republishes.
export const selectedCategoryIds = signal<string[]>([], {
  equal: (a, b) => a.length === b.length && a.every((id, i) => id === b[i]),
});
```

The rule for custom comparators is: pure, cheap, and provably correct. A deep-equal comparator on a 10,000 element array is slower than the render it is trying to avoid. If you cannot bound the cost, do not write the comparator. Fix the upstream code so it does not produce gratuitous new references in the first place.

`computed()` accepts the same `equal` option, and this is where it earns its keep. A `computed` that derives a count or a flag should be cheap to recompute, but if its result feeds a heavy template subtree, you want downstream consumers to skip work when the count did not actually change.

```ts
// libs/products/data-access/src/lib/products.store.ts
import { computed } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';

type ProductsState = {
  items: ReadonlyArray<Product>;
  query: string;
  sort: 'name' | 'price';
};

export const ProductsStore = signalStore(
  { providedIn: 'root' },
  withState<ProductsState>({ items: [], query: '', sort: 'name' }),
  withComputed(({ items, query, sort }) => ({
    visible: computed(() => {
      const q = query().trim().toLowerCase();
      const filtered = q
        ? items().filter((p) => p.name.toLowerCase().includes(q))
        : items();
      return sort() === 'price'
        ? [...filtered].sort((a, b) => a.price - b.price)
        : [...filtered].sort((a, b) => a.name.localeCompare(b.name));
    }),
    visibleCount: computed(() => items().length, {
      equal: (a, b) => a === b,
    }),
  })),
  withMethods((store) => ({
    setQuery: (query: string) => patchState(store, { query }),
    setSort: (sort: ProductsState['sort']) => patchState(store, { sort }),
  })),
);
```

`visibleCount` reads `items()` and returns a number. With the default comparator a count of `42` followed by another count of `42` would still be equal under `Object.is`, so the explicit comparator here is redundant. The interesting case is the next one up: a `computed` that returns an object summary like `{ total, inStock, outOfStock }`. Without a custom `equal`, every recomputation produces a new object reference and every consumer recomputes. Compare the three numeric fields and you keep the propagation localized.

## The SignalStore Performance Model

`patchState` writes a slice into the store by spreading the previous state with the patch. This is structural sharing: any slice that was not in the patch keeps its previous reference, and any `computed` that depends only on untouched slices skips work. This is why `patchState(store, { query })` does not invalidate a `computed` that reads only `items`.

The pattern that breaks structural sharing is patching a slice you did not actually change. `patchState(store, { items: [...store.items()] })` produces a new array reference on every call and forces every consumer of `items` to recompute. The fix is to write the slice only when it is genuinely new, or to attach a custom `equal` to the field.

`withComputed` is where most of your derived state lives. Treat each `computed` as a cache: cheap inputs, deterministic output, no side effects. Do not call `effect()` to derive state, and do not write signals from inside an effect. If you find yourself reaching for `effect`, you almost certainly want `linkedSignal` or another `computed`.

## NgRx Classic Selectors

`createSelector` produces a memoized selector with a single-entry cache. It stores the last argument list and the last result. If you call it again with arguments that are reference-equal to the previous call, you get the cached result. If anything changed, the projector runs and the cache is replaced.

Two consequences follow. First, selector instances must be shared. If two components each call `createSelector(...)` at the top of their file with the same projector, they get two independent caches and neither benefits from the other's work. Define selectors once in a `*.selectors.ts` file and import them.

Second, parameterized selectors need a factory pattern that caches the instance per parameter. The naive version creates a fresh selector on every call and throws away memoization.

```ts
// libs/products/data-access/src/lib/products.selectors.ts
import { createSelector, createFeatureSelector } from '@ngrx/store';
import { adapter, ProductsState } from './products.reducer';

export const selectProductsState = createFeatureSelector<ProductsState>('products');

const entitySelectors = adapter.getSelectors();
export const selectAllProducts = createSelector(selectProductsState, entitySelectors.selectAll);
export const selectProductEntities = createSelector(
  selectProductsState,
  entitySelectors.selectEntities,
);

// Cached factory: one memoized selector per id, reused across components.
const byIdCache = new Map<string, ReturnType<typeof buildSelectorById>>();
function buildSelectorById(id: string) {
  return createSelector(selectProductEntities, (entities) => entities[id]);
}
export function selectProductById(id: string) {
  let selector = byIdCache.get(id);
  if (!selector) {
    selector = buildSelectorById(id);
    byIdCache.set(id, selector);
  }
  return selector;
}
```

The cache is intentionally a `Map` keyed on the parameter. In most apps the set of ids in flight at any moment is small and bounded by the number of mounted components. If you are worried about leaks in a long-running session, swap the `Map` for a size-bounded LRU. Do not skip the cache entirely.

## Entity Adapter Performance

`createEntityAdapter` stores entities as `{ ids: string[], entities: Record<string, T> }`. This shape exists for performance. Operations that touch only the order, like `setAll` followed by a re-sort, can mutate the `ids` array without rebuilding `entities`. Operations that touch a single record, like `updateOne`, replace one entry in `entities` and leave the rest of the references intact, which keeps downstream selectors hot.

`getSelectors()` returns four selectors: `selectIds`, `selectEntities`, `selectAll`, and `selectTotal`. Of these, `selectAll` is the trap. It builds a fresh array by mapping `ids` over `entities` every time the collection changes. A template that iterates `selectAll | async` directly is fine for a hundred rows. At a few thousand, the array build itself starts showing up in the profiler, and any downstream `*ngFor` (use `@for`) with a non-trivial template re-renders the world.

The fix is to layer another `createSelector` between `selectAll` and the template, projecting only the data the view needs and memoizing the projection.

```ts
// libs/products/data-access/src/lib/products.view.ts
import { createSelector } from '@ngrx/store';
import { selectAllProducts } from './products.selectors';

// Projects to the minimal row shape the table needs. Memoized: when an
// unrelated slice of state changes, this selector returns the previous
// reference and @for skips its diff.
export const selectProductRows = createSelector(selectAllProducts, (products) =>
  products.map((p) => ({ id: p.id, name: p.name, price: p.price, inStock: p.stock > 0 })),
);
```

Pair this with `track` in your `@for` block so the view diffing has a stable identity to work with:

```html
<!-- src/app/products/products-table.component.html -->
@for (row of rows(); track row.id) {
  <tr>
    <td>{{ row.name }}</td>
    <td>{{ row.price | currency }}</td>
    <td>{{ row.inStock ? 'Yes' : 'No' }}</td>
  </tr>
}
```

Without `track row.id`, Angular falls back to identity tracking on the row object, and the moment your projection produces new objects (which it will, because `map` returns a new array of new objects), every row remounts. With `track row.id`, only rows whose data changed update.

## Putting It Together

Here is the dashboard fragment from the opening, rebuilt with all of the rules in place. It is a single component that injects a SignalStore, exposes a memoized projection, and renders the table with a tracked `@for`.

```ts
// src/app/products/products-dashboard.component.ts
import { Component, computed, inject } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { ProductsStore } from '@my-org/products/data-access';

@Component({
  selector: 'app-products-dashboard',
  standalone: true,
  imports: [CurrencyPipe],
  template: `
    <input
      type="search"
      [value]="store.query()"
      (input)="store.setQuery($any($event.target).value)"
      placeholder="Search products"
    />
    <p>Showing {{ rows().length }} of {{ store.visibleCount() }}</p>
    <table>
      <tbody>
        @for (row of rows(); track row.id) {
          <tr>
            <td>{{ row.name }}</td>
            <td>{{ row.price | currency }}</td>
          </tr>
        }
      </tbody>
    </table>
  `,
})
export class ProductsDashboardComponent {
  protected readonly store = inject(ProductsStore);

  // Local memoized projection. Recomputes only when `visible` changes,
  // which itself only changes when items, query, or sort change.
  protected readonly rows = computed(() =>
    this.store.visible().map((p) => ({ id: p.id, name: p.name, price: p.price })),
  );
}
```

Type a character: `setQuery` writes the `query` slice. `patchState` leaves `items` and `sort` referentially unchanged. `visible` recomputes because `query` changed. `rows` recomputes because `visible` changed. The scheduler coalesces the write into a single microtask and runs change detection once. The table diffs by `row.id` and only updates the rows whose membership flipped. No selector cache misses, no spurious recomputes, no third-party callbacks involved.

## Common Mistakes

### 1. Returning a fresh object from a reducer when nothing changed

```ts
// Wrong
on(ProductsActions.refreshTick, (state) => ({ ...state }))
```

The spread produces a new top-level reference even though no field is different. Every selector that reads `state` will be invalidated. Either return `state` unchanged when there is nothing to do, or do not dispatch the action at all.

```ts
// Right
on(ProductsActions.refreshTick, (state, { items }) => {
  if (items === state.items) return state;
  return { ...state, items };
})
```

### 2. Building parameterized selectors inline

```ts
// Wrong
@Component({ ... })
export class ProductCard {
  readonly product = this.store.selectSignal(
    createSelector(selectProductEntities, (e) => e[this.id])
  );
}
```

Each component instance constructs its own selector and pays for its own first-call computation. Worse, the closure captures `this.id`, so the cache is keyed on the component's identity rather than the id. Use the cached factory pattern from `selectProductById` above.

### 3. Iterating `selectAll` directly in a hot template

```ts
// Wrong
readonly products = this.store.selectSignal(selectAllProducts);
```

```html
@for (p of products(); track p.id) {
  <app-product-row [product]="p" />
}
```

`selectAll` rebuilds its array on every collection change. For 50 rows nobody notices. For 5,000 rows the array build dominates the frame. Project to the minimal row shape with a downstream `createSelector` and let memoization keep the array stable when nothing the row cares about changed.

### 4. Writing signals from inside an effect

```ts
// Wrong
effect(() => {
  const items = this.store.items();
  this.count.set(items.length);
}, { allowSignalWrites: true });
```

This is a `computed` wearing a costume. It schedules an extra microtask, runs after the consumer, and breaks glitch-free propagation. Replace it with a `computed`, or with `linkedSignal` if you need a writable derived value.

```ts
// Right
readonly count = computed(() => this.store.items().length);
```

### 5. Reaching for `NgZone` in new code

```ts
// Wrong (and, under zoneless, useless)
constructor(private zone: NgZone) {}
ngOnInit() {
  this.zone.runOutsideAngular(() => {
    this.socket.on('tick', (data) => {
      this.zone.run(() => this.store.update(data));
    });
  });
}
```

There is no zone. `runOutsideAngular` returns immediately and `run` is a passthrough. Delete both. Use `inject()` to get the store and call its update method directly. Signal writes will schedule the render.

## Key Takeaways

- Zoneless change detection runs only when a known entry point notifies the scheduler. Signal writes, template events, `httpResource` responses, and router navigation are the entry points. Anything that mutates state outside them must route through a signal write.
- Signal equality is your primary performance lever. The default `Object.is` comparator forces propagation on every new object reference. Override `equal` for value-shaped signals when the comparator is cheap and provably correct, and stop producing gratuitous new references upstream.
- NgRx selectors memoize a single result by reference equality of inputs. Share selector instances across components and use a cached factory pattern for parameterized selectors so they actually benefit from memoization.
- Entity adapters store data in a normalized shape for a reason. Do not iterate `selectAll` directly in hot templates: project to a minimal row shape with a downstream `createSelector` and pair every `@for` with `track`.
- Treat `effect()` as the wrong tool for derived state. `computed` and `linkedSignal` give you glitch-free propagation and one fewer microtask hop. If you find yourself enabling `allowSignalWrites`, the design is fighting you.
