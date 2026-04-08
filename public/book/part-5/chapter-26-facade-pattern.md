# Chapter 26: The Facade Pattern: When It Helps, When It Hurts

A new developer joins your team. On day three, they open a pull request that adds an item to the cart by writing `this.store.dispatch(CartActions.addItem({ sku, quantity }))` directly inside a button click handler. A reviewer leaves a comment: "Please go through the facade." The developer asks what a facade is. Three other reviewers chime in with three different answers. One says it is a service that hides NgRx. Another says it is a coordinator across multiple stores. The third says facades are an anti-pattern and the team should delete the existing ones.

All three are partially right, and that is the problem this chapter solves. The facade pattern is the most contested convention in Angular state management. It was the right answer in 2018, became dogma by 2020, and is now mostly redundant in 2026 because NgRx SignalStore quietly absorbed it. We are going to walk through the historical motivation, show why most facades today are dead abstractions, and identify the few places where the pattern still earns its keep.

## A Brief Recap

Earlier chapters established two things this chapter relies on. First, NgRx Classic Store exposes state through `Store<T>`, action creators, selectors, and `dispatch`, and components consume that vocabulary directly unless something hides it. Second, NgRx SignalStore (`@ngrx/signals`) replaces all of that with a single injectable class built from `withState`, `withComputed`, `withMethods`, and `withEventHandlers`. State is signals. Mutations are methods. There is no `dispatch` site to hide.

Hold those two pictures in mind. The facade pattern was invented to fix a problem that exists in the first picture and does not exist in the second.

## What a Facade Actually Is

The Gang of Four defined a facade as "a unified interface to a set of interfaces in a subsystem." The point is to give clients one object to talk to instead of several. In Angular, Thomas Burleson popularized the pattern for NgRx around 2018 with a more specific goal: hide the entire NgRx vocabulary behind one injectable service per feature.

A canonical 2018 facade looked like this.

```typescript
// libs/products/data-access/src/lib/products.facade.ts
import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { ProductsActions } from './products.actions';
import {
  selectAllProducts,
  selectProductsLoading,
  selectSelectedProduct,
} from './products.selectors';

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

A component then talks only to the facade.

```typescript
// libs/products/feature/src/lib/products-page.component.ts
import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
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
  ngOnInit(): void {
    this.facade.loadProducts();
  }
}
```

What this buys you in a Classic Store world is real. The component never imports `Store`, never sees an action creator, never composes a selector. If you rename `loadProducts` to `fetchCatalog` in the facade, you change one file. If you swap the underlying store entirely, the component does not know.

What it costs is also real. Every selector and every action lives in two places now: where it is defined, and where the facade exposes it. Adding a feature means editing the store, the actions file, the selectors file, and the facade. The facade has no logic of its own. It is a forwarder.

## The Critique

By 2020, most of the NgRx core team and several prominent voices in the community had pushed back hard. The arguments are worth understanding because they apply directly to whether you should add a facade today.

Mike Ryan and Alex Okrushko, both NgRx core maintainers, argued that facades obscure the redux data flow. Once a developer thinks of `facade.addToCart(id)` as the entry point, they stop thinking of `addToCart` as an event that describes what happened in the system. Actions become commands the facade issues. The mental model that makes redux scale, "actions are events, reducers react to events, effects react to events," collapses into "the facade does stuff."

Tim Deschryver pointed out that facades become dumping grounds. Every new feature adds a method. The facade balloons. Then one facade needs to call another, and you discover circular dependencies that the underlying stores never had, because stores typically depend on data sources, not on each other.

Michael Hladky from push-based.io noted that facades hide where streams are consumed. With reactive state, knowing the lifetime of a subscription matters. A facade method that returns `Observable<X>` flattens that visibility and makes back-pressure invisible.

Manfred Steyer landed in the middle, and his framing has held up best. Facades are useful at architectural seams, the public API of an Nx library, the boundary of a micro-frontend, the surface of a published npm package. Facades are harmful as a default inside a single feature.

## What SignalStore Changed

Here is the central observation of this chapter, and the answer to "should I add a facade?" for any code written against `@ngrx/signals`. SignalStore *is* the facade. The pattern moved from a separate file into a builder block.

Look at what `withMethods` produces. A method defined inside `withMethods` is, by construction:

- Named after intent.
- Co-located with the state it mutates.
- Type-safe end to end with no manual generic plumbing.
- Reachable as a single injectable class.
- The only public mutation surface, because there is no `dispatch` to call from elsewhere.

That list is the definition of a facade method. Here is the same products example written as a SignalStore.

```typescript
// libs/products/data-access/src/lib/products.store.ts
import { computed, inject } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  withEventHandlers,
  patchState,
} from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap } from 'rxjs';
import { ProductsApi, Product } from './products.api';

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
        switchMap(() =>
          api.getAll().pipe(
            tap(products => patchState(store, { products, loading: false })),
          ),
        ),
      ),
    ),
  })),
  withEventHandlers(),
);
```

The component imports the store and uses it directly.

```typescript
// libs/products/feature/src/lib/products-page.component.ts
import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
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
  ngOnInit(): void {
    this.store.loadProducts();
  }
}
```

Count the files. The Classic version had a store, actions, reducer, selectors, effects, and a facade, then the component. The SignalStore version has a store and the component. There is no `dispatch` to hide because there is no `dispatch`. There are no action creators to abstract because there are no action creators. The facade had a job in 2018. That job no longer exists for code written this way.

> Adding a `ProductsFacade` on top of `ProductsStore` would forward `loadProducts` to `loadProducts`, `selectProduct` to `selectProduct`, and `products` to `products`. That is the textbook definition of a dead abstraction layer.

## Where Facades Still Earn Their Keep

This is not a "facades are bad" chapter. The pattern still has three legitimate uses in 2026, and recognizing them is the difference between an architect and someone who memorized a rule.

### Cross-Store Coordination

When a single user intent must touch multiple independent stores, a thin coordinating service is justified. It has actual logic. It is not forwarding calls one-to-one.

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

  readonly canCheckout = computed(
    () =>
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

`CheckoutFacade` derives state across three stores, sequences async work, and centralizes a workflow that does not belong to any single store. This is the GoF definition of a facade applied correctly: a unified interface to a subsystem of multiple objects. There is no SignalStore primitive that replaces this, because the coordination crosses store boundaries.

### Nx Library and Public-API Boundaries

If you publish a feature as an Nx library, the `index.ts` of that library is a contract with the rest of the monorepo. Exposing `ProductsStore` directly leaks the fact that you use `@ngrx/signals`, leaks the state shape, and forces consumers to import the same NgRx version. A facade lets you expose only what you intend to be public and rewrite the internals freely.

The same applies to npm packages you ship to other teams. The facade is the stable contract; the store is the implementation.

### Micro-Frontend Boundaries

A remote micro-frontend that exposes state to the shell should not export a `signalStore` instance directly. The store's generic type would force the shell to import `@ngrx/signals` and pin the same version, which defeats one of the main reasons for using module federation. A plain class with signal-typed properties is portable across version skews.

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
  loadProducts(): void {
    this.store.loadProducts();
  }
  selectProduct(id: string): void {
    this.store.selectProduct(id);
  }
}
```

The shell or a sibling MFE depends on `ProductsContract`, which does not import NgRx at all. The providing MFE binds the implementation in its providers. The contract is a facade in the architectural sense: it decouples consumers from the version of `@ngrx/signals` used inside the remote. Part 6 returns to this when we wire actual remotes together.

## Common Mistakes

### Mistake 1: Adding a facade on top of a SignalStore "for consistency"

```typescript
// Wrong: libs/products/data-access/src/lib/products.facade.ts
@Injectable({ providedIn: 'root' })
export class ProductsFacade {
  private readonly store = inject(ProductsStore);
  readonly products = this.store.products;
  readonly loading = this.store.loading;
  loadProducts(): void { this.store.loadProducts(); }
  selectProduct(id: string): void { this.store.selectProduct(id); }
}
```

Why it is wrong: every member is a one-to-one forward. There is no abstraction, only indirection. You doubled the surface area to maintain and you broke the type inference that `withMethods` and `withComputed` provide for free. If a teammate adds a method to the store, it silently does not exist on the facade until someone notices.

Corrected version: delete the facade. Inject `ProductsStore` directly in the component. The store is already a single injectable class with intention-revealing methods. That is the facade.

### Mistake 2: Exposing `Observable<T>` from a facade in 2026

```typescript
// Wrong
@Injectable({ providedIn: 'root' })
export class ProductsFacade {
  private readonly store = inject(Store);
  readonly products$ = this.store.select(selectAllProducts);
}
```

Why it is wrong: components in zoneless Angular 21 should consume signals, not raw observables. A facade that returns `Observable<T>` pushes subscription management into every consumer and forces `async` pipes throughout templates. Worse, mixing `products$` and `products` (signal) on the same facade is the most common source of subscription leaks we see in code review.

Corrected version: convert at the boundary with `toSignal` and provide an `initialValue`, or migrate the underlying state to SignalStore.

```typescript
@Injectable({ providedIn: 'root' })
export class ProductsFacade {
  private readonly store = inject(Store);
  readonly products = toSignal(this.store.select(selectAllProducts), { initialValue: [] });
}
```

### Mistake 3: A facade that calls another facade

```typescript
// Wrong
@Injectable({ providedIn: 'root' })
export class CartFacade {
  private readonly products = inject(ProductsFacade);
  addBySku(sku: string): void {
    const product = this.products.products().find(p => p.sku === sku);
    if (product) this.dispatchAdd(product);
  }
}
```

Why it is wrong: facades that depend on facades create circular import risk and tangle features that should be independent. The underlying stores typically have no such cycle, because stores depend on data sources and not on each other. The facade layer invented the cycle.

Corrected version: do the cross-store coordination in a single, explicitly named coordinator (`CheckoutFacade`, `OnboardingFlow`) that depends on multiple stores directly. Do not chain facades.

### Mistake 4: `providedIn: 'root'` on a facade that depends on a feature-scoped store

```typescript
// Wrong
@Injectable({ providedIn: 'root' })
export class WizardFacade {
  private readonly store = inject(WizardStore); // provided only inside the wizard route
}
```

Why it is wrong: Angular tries to construct `WizardFacade` at the root injector and cannot find `WizardStore`, which lives in a child injector. You get a runtime `NullInjectorError` the first time anything reads the facade.

Corrected version: provide the facade at the same scope as the store, typically inside the route's `providers` array, not at root.

### Mistake 5: Treating the facade as the testing seam

```typescript
// Wrong: a component test that mocks the facade
TestBed.configureTestingModule({
  providers: [{ provide: ProductsFacade, useValue: mockFacade }],
});
```

Why it is wrong: SignalStore is trivially testable on its own. `TestBed.inject(ProductsStore)` returns a working store, signals are synchronous, and `patchState` is a public function in tests. Mocking a facade that wraps a SignalStore adds a second test surface and tests the mock, not the system. The original justification for facades, "they make components easier to test," does not survive contact with `@ngrx/signals`.

Corrected version: test the store directly with `TestBed.inject`, and let the component test use the real store with a mocked HTTP layer.

## Key Takeaways

- The facade pattern was invented in 2018 to hide the NgRx Classic vocabulary (`Store`, actions, selectors, `dispatch`) behind a single injectable service. That problem is real in Classic Store code.
- In NgRx SignalStore, `withMethods` already produces a named, type-safe, intention-revealing, single-class API. The store *is* the facade. Adding another facade on top is a dead abstraction.
- Facades still earn their keep in three places: cross-store coordination with real logic, the public API of an Nx library where you want to hide internals from the rest of the monorepo, and the contract surface of a micro-frontend where exposing a store would couple consumers to your `@ngrx/signals` version.
- Never expose `Observable<T>` from a new facade in 2026. If a facade exists, it should expose `Signal<T>`, and you should convert at the boundary with `toSignal` plus an `initialValue`.
- Test stores directly. The "facade makes testing easier" argument predates SignalStore and does not survive it.
