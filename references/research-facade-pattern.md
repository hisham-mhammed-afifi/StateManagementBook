# Research: The Facade Pattern
**Date:** 2026-04-08
**Chapter:** Ch 26
**Status:** Ready for chapter generation

## API Surface

The "facade pattern" is not an Angular or NgRx API. It is an architectural convention layered on top of existing primitives. Relevant primitives in the Angular 21 / NgRx 21 era:

- `@ngrx/store` — `Store`, `createSelector`, `createAction`, `createReducer` (Classic Store, still supported in v21).
- `@ngrx/signals` — `signalStore`, `withState`, `withComputed`, `withMethods`, `withHooks`, `withEventHandlers` (renamed from `withEffects` in NgRx v21), `eventGroup`, `withReducer`, `on`, `patchState`, `rxMethod`.
- Angular 21 — `inject()`, `signal()`, `computed()`, `effect()`, `linkedSignal()`, `resource()`, standalone components, zoneless change detection by default.
- TypeScript 5.9 — improved inference of generic constraints; relevant because facades historically lose inference when wrapping `Store<T>`.

No facade-specific API has shipped or been deprecated in Angular 21 or NgRx 21. The pattern itself is unaffected by version bumps; what has changed is the surrounding ecosystem that often makes a manual facade redundant.

## Key Concepts

### Origin

Thomas Burleson popularized the facade pattern for NgRx around 2018 in his article "NgRx + Facades: Better State Management" (Medium, Nrwl/Nx era). The motivation was concrete:

1. Hide `Store` and the entire NgRx vocabulary (`select`, `dispatch`, action creators) from components.
2. Give feature teams a single injectable service per feature with a small, intention-revealing API.
3. Allow the underlying state library to be swapped without touching consumers.
4. Provide a natural seam for testing: components depend on the facade interface, not on `Store`.

A canonical 2018-era facade looked like a service exposing `vm$: Observable<ViewModel>` plus methods like `loadProducts()`, `selectProduct(id)`. Internally it called `this.store.dispatch(...)` and composed selectors with `this.store.select(...)`.

### The Burleson Argument (Pro)

- Components stay framework-agnostic with respect to state.
- Action creators become an internal implementation detail; refactoring them does not ripple to templates.
- Selectors are co-located with the actions that depend on them.
- Onboarding is faster because juniors call `facade.addToCart(id)` instead of learning `Store`, actions, effects, reducers, and selectors at once.

### The Counter-Argument (Con)

The NgRx core team and several prominent voices pushed back, mostly between 2019 and 2022:

- **Mike Ryan** (NgRx core lead) and **Alex Okrushko** (NgRx core, ex-Google/Cisco) argued that facades obscure the redux data flow. New developers stop seeing actions as events and start seeing them as commands the facade issues, which breaks the mental model of "actions describe what happened, not what to do."
- **Tim Deschryver** wrote multiple posts (timdeschryver.dev, 2019-2021) showing that facades become a dumping ground: every new feature adds another method, the facade balloons, and circular dependencies appear when one facade wants to call another. He argued for injecting `Store` directly and treating selectors and actions as the public API.
- **Michael Hladky** (push-based.io, RxAngular author) emphasized that facades hide back-pressure and subscription lifetimes. With reactive state, knowing where a stream is consumed matters; a facade method that returns `Observable<X>` flattens that visibility.
- **Manfred Steyer** (Angular Architects) took a more nuanced position: facades are useful at architectural seams (libraries, micro-frontends, public APIs of an Nx lib), but harmful as a default inside a single feature. His "strategic vs tactical" framing is the most cited middle ground today.

### What SignalStore Changed

`@ngrx/signals` collapses the layers a facade was invented to hide. A `signalStore` already exposes:

- State as signals (no `select`, no `Observable`, no `async` pipe).
- `withComputed` — derived state, equivalent to selectors.
- `withMethods` — imperative entry points that call `patchState` or trigger `rxMethod`. **These methods are exactly what a facade method is**: a named, intention-revealing function on an injectable service.
- `withEventHandlers` (v21, renamed from `withEffects`) — side effects.

When you call `inject(ProductsStore)` and write `productsStore.loadProducts()` in a component, you are already calling a facade method. Wrapping that store in another service named `ProductsFacade` adds a layer that forwards calls one-to-one. This is the "dead abstraction" critique: the facade has no logic, only delegation.

The corollary: **with SignalStore, the facade pattern collapses into the store itself**. The store *is* the facade. There is no `Store<T>` to hide, no action creators to abstract, no selectors to memoize manually.

### Where Facades Still Earn Their Keep in 2026

1. **Cross-store coordination.** When a user action must touch three independent SignalStores (e.g., `CartStore`, `InventoryStore`, `AnalyticsStore`), a thin coordinating service is justified. It is a facade in the strict GoF sense: a unified interface to a subsystem of multiple objects.
2. **Nx library boundaries.** A `feature-products` lib that depends on a `data-access-products` lib can expose a facade as the only public symbol from `index.ts`. This enforces module boundaries via lint rules and lets the data-access internals (store shape, effects, HTTP) change freely.
3. **Micro-frontend boundaries.** A remote MFE that exposes state to the shell should expose a facade-typed contract, not a `signalStore` instance, because the store's generic type would force the shell to import `@ngrx/signals` and pin the same version. A plain class with signal-typed properties is portable across version skews.
4. **Legacy Classic Store features being migrated incrementally.** A facade lets you hide a Classic Store behind a SignalStore-shaped API, then swap the implementation later without touching consumers.
5. **Public-API libraries (npm packages).** If you ship `@acme/products-state` to other teams, a facade is the stable contract; the store is the implementation.

### Where Facades Hurt

1. **Indirection without value.** A facade that only forwards `loadX`, `selectX`, `clearX` to a SignalStore adds a file, a test, and a DI registration with zero abstraction gain.
2. **Boilerplate tax.** Every new method must be added in two places. Refactors double in cost.
3. **Lost type inference.** Hand-typed facade methods almost always under-specify generics that SignalStore would have inferred (e.g., return types of `computed` chains, narrowed entity shapes from `withEntities`).
4. **Harder testing, not easier.** Conventional wisdom said facades make components easier to test by mocking the facade. In practice, SignalStore is trivially testable in isolation (`TestBed.inject(ProductsStore)` works, signals are synchronous), and the facade adds a second test surface.
5. **Mental-model damage.** Developers stop thinking in terms of state transitions and start thinking in terms of "what method do I call." The facade becomes a god-service.
6. **Circular dependency risk.** Facades that call other facades create cycles that the underlying stores would not have, because stores typically only depend on data sources, not on each other.

### The "withMethods is the Facade" Insight

This is the central point of the chapter. In Classic Store the dispatch site was scattered: components, effects, guards, and resolvers all called `store.dispatch(...)`. A facade unified them. In SignalStore there is no dispatch site. The only way to mutate state is through a method defined inside `withMethods`. That method is, by construction:

- Named after intent.
- Co-located with the state it mutates.
- Type-safe end to end.
- Injectable as a single class.
- The only public mutation surface.

That is the definition of a facade. The pattern moved from a separate file (`products.facade.ts`) into a builder block (`withMethods(...)`). The chapter should make this explicit and use it to defuse the "should I add a facade?" question for SignalStore users: you already did.

## Code Patterns

### Pattern 1 — Classic Store facade (the historical baseline)

```typescript
// libs/products/data-access/src/lib/products.facade.ts
import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { ProductsActions } from './products.actions';
import { selectAllProducts, selectProductsLoading, selectSelectedProduct } from './products.selectors';

@Injectable({ providedIn: 'root' })
export class ProductsFacade {
  private readonly store = inject(Store);

  readonly products = toSignal(this.store.select(selectAllProducts), { initialValue: [] });
  readonly loading = toSignal(this.store.select(selectProductsLoading), { initialValue: false });
  readonly selected = toSignal(this.store.select(selectSelectedProduct), { initialValue: null });

  loadProducts(): void {
    this.store.dispatch(ProductsActions.loadProducts());
  }

  selectProduct(id: string): void {
    this.store.dispatch(ProductsActions.selectProduct({ id }));
  }
}
```

```typescript
// libs/products/feature/src/lib/products-page.component.ts
import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { ProductsFacade } from '@acme/products/data-access';

@Component({
  selector: 'acme-products-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (facade.loading()) {
      <p>Loading...</p>
    } @else {
      @for (product of facade.products(); track product.id) {
        <button (click)="facade.selectProduct(product.id)">{{ product.name }}</button>
      }
    }
  `,
})
export class ProductsPageComponent implements OnInit {
  protected readonly facade = inject(ProductsFacade);
  ngOnInit() { this.facade.loadProducts(); }
}
```

What this buys: components never import `Store`, action creators, or selectors. What it costs: one extra file, one extra layer, and every selector or action change requires editing the facade as well.

### Pattern 2 — SignalStore makes the facade redundant

```typescript
// libs/products/data-access/src/lib/products.store.ts
import { computed, inject } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, withEventHandlers, patchState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap } from 'rxjs';
import { ProductsApi } from './products.api';

type ProductsState = {
  products: Product[];
  selectedId: string | null;
  loading: boolean;
};

const initial: ProductsState = { products: [], selectedId: null, loading: false };

export const ProductsStore = signalStore(
  { providedIn: 'root' },
  withState(initial),
  withComputed(({ products, selectedId }) => ({
    selected: computed(() => products().find(p => p.id === selectedId()) ?? null),
    count: computed(() => products().length),
  })),
  withMethods((store, api = inject(ProductsApi)) => ({
    selectProduct(id: string): void {
      patchState(store, { selectedId: id });
    },
    loadProducts: rxMethod<void>(
      pipe(
        tap(() => patchState(store, { loading: true })),
        switchMap(() => api.getAll().pipe(
          tap(products => patchState(store, { products, loading: false })),
        )),
      ),
    ),
  })),
  withEventHandlers(/* side effects, analytics, logging */),
);
```

```typescript
// libs/products/feature/src/lib/products-page.component.ts
import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { ProductsStore } from '@acme/products/data-access';

@Component({
  selector: 'acme-products-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.loading()) {
      <p>Loading...</p>
    } @else {
      @for (product of store.products(); track product.id) {
        <button (click)="store.selectProduct(product.id)">{{ product.name }}</button>
      }
    }
  `,
})
export class ProductsPageComponent implements OnInit {
  protected readonly store = inject(ProductsStore);
  ngOnInit() { this.store.loadProducts(); }
}
```

The component imports `ProductsStore` directly. There is no `Store<T>`, no `dispatch`, no `select`, no separate facade file. `withMethods` is the facade. The store *is* the public API of the feature.

### Pattern 3 — Justified facade: cross-store coordination

```typescript
// libs/checkout/data-access/src/lib/checkout.facade.ts
import { Injectable, computed, inject } from '@angular/core';
import { CartStore } from '@acme/cart/data-access';
import { InventoryStore } from '@acme/inventory/data-access';
import { AnalyticsStore } from '@acme/analytics/data-access';

@Injectable({ providedIn: 'root' })
export class CheckoutFacade {
  private readonly cart = inject(CartStore);
  private readonly inventory = inject(InventoryStore);
  private readonly analytics = inject(AnalyticsStore);

  readonly canCheckout = computed(() =>
    this.cart.itemCount() > 0 &&
    this.cart.items().every(item => this.inventory.isAvailable(item.sku)),
  );

  async checkout(): Promise<void> {
    if (!this.canCheckout()) return;
    this.analytics.track('checkout_started', { items: this.cart.itemCount() });
    await this.inventory.reserve(this.cart.items());
    this.cart.clear();
    this.analytics.track('checkout_completed');
  }
}
```

This facade has actual logic. It coordinates three stores, derives state across them, and sequences async operations. It is not a forwarder. This is a legitimate use of the pattern in 2026.

### Pattern 4 — Facade at a micro-frontend boundary

```typescript
// libs/products/public-api/src/lib/products.contract.ts
import { Signal } from '@angular/core';

export abstract class ProductsContract {
  abstract readonly products: Signal<ReadonlyArray<{ id: string; name: string; price: number }>>;
  abstract readonly loading: Signal<boolean>;
  abstract loadProducts(): void;
  abstract selectProduct(id: string): void;
}
```

```typescript
// libs/products/data-access/src/lib/products.contract.impl.ts
import { Injectable, inject } from '@angular/core';
import { ProductsContract } from '@acme/products/public-api';
import { ProductsStore } from './products.store';

@Injectable({ providedIn: 'root' })
export class ProductsContractImpl extends ProductsContract {
  private readonly store = inject(ProductsStore);
  readonly products = this.store.products;
  readonly loading = this.store.loading;
  loadProducts(): void { this.store.loadProducts(); }
  selectProduct(id: string): void { this.store.selectProduct(id); }
}
```

The shell or a sibling MFE depends on `ProductsContract` (an abstract class, no NgRx import), and the providing MFE binds the implementation. The contract is a facade in the architectural sense: it decouples consumers from the version of `@ngrx/signals` used inside the remote.

## Breaking Changes and Gotchas

- **No facade-specific breaking changes** in Angular 21 or NgRx 21. The pattern is convention, not API.
- **`withEffects` -> `withEventHandlers`** (NgRx v21). Older facade tutorials show `withEffects`; readers must use `withEventHandlers`. A migration schematic ships with NgRx v21 and renames usages automatically.
- **`toSignal` initialValue gotcha** in Classic Store facades: forgetting `initialValue` leaks `undefined` into templates and breaks zoneless rendering assumptions.
- **`providedIn: 'root'` on a facade that depends on a feature-scoped `Store`** will throw at runtime. Either provide both at the same scope or move the facade into the feature's providers.
- **Injection context for `inject()` inside facade constructors** is fine because `@Injectable` constructors run in an injection context. The same is not true for facade methods called from outside Angular (e.g., from a web worker bridge); `runInInjectionContext` is required there.
- **Don't expose RxJS `Observable` from a facade in 2026.** If you must use a facade, expose `Signal<T>`. Mixing both APIs in one facade is the most common source of subscription leaks.
- **Lint your boundaries.** If you adopt facades for Nx lib boundaries, configure `@nx/enforce-module-boundaries` to forbid deep imports past the facade. Otherwise the abstraction silently rots.
- **Testing**: SignalStore tests do not need `provideMockStore`. A facade wrapping a SignalStore and then mocked in component tests is strictly more setup than testing the store directly.

## Sources

Primary references compiled from the Angular/NgRx ecosystem (2018-2026):

- Thomas Burleson, "NgRx + Facades: Better State Management" (Medium, 2018) — origin article.
- Thomas Burleson, "Push-based Architectures with RxJS" — facade as part of a presentational/container split.
- Tim Deschryver, "Why I stopped using NgRx facades" (timdeschryver.dev, 2020) and follow-ups on selectors as the public API.
- Mike Ryan, ng-conf and NgConf Hardwired talks on "Good Action Hygiene" — implicit critique of facades that turn actions into commands.
- Alex Okrushko, NgRx workshop materials and Twitter/X threads on selector composition vs facades.
- Michael Hladky / push-based.io articles on reactive primitives and back-pressure visibility.
- Manfred Steyer, Angular Architects blog: "Architecture with Nx, Strategic vs Tactical DDD," and the strategic-design lib boundary articles where facades are recommended only at lib seams.
- NgRx official docs, `@ngrx/signals` guide (ngrx.io) — `withMethods`, `withEventHandlers`, `rxMethod`, custom features.
- NgRx v21 release notes: `withEffects` -> `withEventHandlers` rename, migration schematic.
- Angular 21 release notes: zoneless default, `linkedSignal`, `resource`, signal-based forms (experimental).
- Nx documentation on library boundaries and `@nx/enforce-module-boundaries`.
- GitHub discussions on `ngrx/platform` (issues tagged `signals`, 2024-2025) where the "do I still need a facade?" question is asked and answered by maintainers in the negative for single-feature use.
- Community blog posts (2025) from Angular Architects and push-based.io revisiting the pattern after SignalStore adoption stabilized.

## Open Questions

1. Should the chapter include a side-by-side line count comparison of Classic facade vs SignalStore? Probably yes, it makes the "dead abstraction" point visceral.
2. Is there a clean way to test the cross-store facade pattern (Pattern 3) without mocking three SignalStores? The `unprotected` testing helper from `@ngrx/signals/testing` may be relevant; verify its v21 status before writing.
3. Worth a sidebar on "facade vs adapter vs gateway" terminology? Many devs conflate these. A short box clarifying that an adapter wraps an external system, a gateway is a remote-call facade, and the GoF facade unifies internal subsystems would help.
4. Should Pattern 4 (MFE boundary) use an abstract class or an `InjectionToken<ProductsContract>`? Abstract class is more ergonomic but ties consumers to a class symbol; token is more decoupled but loses the constructor-as-type-shape benefit. The MFE chapter (Part 5) may already make this choice — align with it.
5. Confirm whether `withMethods` still requires an explicit return type for recursive method definitions in TS 5.9; older versions needed a type annotation to break inference cycles.
