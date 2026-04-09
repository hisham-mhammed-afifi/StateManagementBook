# Chapter 35: Shared State Across Micro-Frontends

Two teams on your platform ship independently. The Products team owns a catalog MFE. The Orders team owns a checkout MFE. A user adds a product to their cart from the catalog, then navigates to checkout. The cart count in the shell header should update instantly. The checkout page should show the item that was just added. Both teams deploy on different schedules, and neither wants to import the other's code. How does the product selection in one remote reach the cart state owned by another remote, without coupling the two teams together?

This is the central tension of shared state in micro-frontends: independence vs coordination. Chapters 33 and 34 established the foundation. We set up a single Angular injector tree, shared NgRx and Angular packages as singletons via webpack, and built dynamic remote loading with `@module-federation/enhanced/runtime`. This chapter goes deeper. We will classify which state deserves to be shared, implement three distinct patterns for cross-MFE state sharing, introduce NgRx 21's scoped events for controlling event visibility across boundaries, and catalog the anti-patterns that turn shared state into a liability.

## The Shared State Spectrum

Not all state is equal. The first decision in any MFE architecture is drawing the line between what is shared and what stays local. Get this wrong and you either build a distributed monolith (everything shared) or a disconnected set of apps that cannot coordinate (nothing shared).

State falls into three categories in an MFE platform:

**Global state** is owned by the shell and consumed by every remote. Authentication tokens, the current user profile, theme preferences, feature flags, and navigation state belong here. This state changes infrequently and has a single owner. Every remote reads it; only the shell writes it.

**Cross-feature state** is produced by one remote and consumed by another. The cart is the classic example: the Products MFE adds items, the Orders MFE reads them, and the shell header displays a count. This state has a clear owner but multiple consumers. It needs a contract, not direct access.

**Feature state** is owned and consumed entirely within one remote. Product filters, pagination cursors, form drafts, and UI toggle state belong here. No other remote needs this data, and exposing it creates unnecessary coupling.

The hybrid pattern from Chapter 33 handles global and feature state. Global state lives in a `providedIn: 'root'` store. Feature state lives in route-scoped providers. Cross-feature state is the hard problem, and it is the focus of this chapter.

## Pattern 1: Shared Singleton Stores via Dependency Injection

When both the producer and consumer of state live inside the same Angular injector tree (which they do in a properly configured Module Federation setup), a singleton store is the simplest solution. The store lives in a shared Nx library, is provided at the root level, and any remote can inject it.

We covered the `AuthStore` singleton in Chapter 33. Let us now build a `CartStore` that the Products MFE writes to and the Orders MFE reads from:

```typescript
// libs/shared/data-access-cart/src/lib/cart.store.ts
import { computed } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { withEntities, addEntity, removeEntity, removeAllEntities, updateEntity } from '@ngrx/signals/entities';

export interface CartItem {
  id: number;
  productId: number;
  title: string;
  price: number;
  quantity: number;
}

export const CartStore = signalStore(
  { providedIn: 'root' },
  withEntities<CartItem>(),
  withComputed(({ entities }) => ({
    totalItems: computed(() =>
      entities().reduce((sum, item) => sum + item.quantity, 0)
    ),
    totalPrice: computed(() =>
      entities().reduce((sum, item) => sum + item.price * item.quantity, 0)
    ),
  })),
  withMethods((store) => ({
    addItem(product: { productId: number; title: string; price: number }): void {
      const existing = store.entities().find((e) => e.productId === product.productId);
      if (existing) {
        patchState(
          store,
          updateEntity({ id: existing.id, changes: { quantity: existing.quantity + 1 } })
        );
      } else {
        patchState(
          store,
          addEntity({
            id: Date.now(),
            productId: product.productId,
            title: product.title,
            price: product.price,
            quantity: 1,
          })
        );
      }
    },
    removeItem(id: number): void {
      patchState(store, removeEntity(id));
    },
    clear(): void {
      patchState(store, removeAllEntities());
    },
  })),
);
```

The Products MFE injects this store and calls `addItem()`:

```typescript
// libs/products/feature/src/lib/product-card.component.ts
import { Component, inject, input } from '@angular/core';
import { CartStore } from '@mfe-platform/shared-data-access-cart';

@Component({
  selector: 'lib-product-card',
  standalone: true,
  template: `
    <div class="product-card">
      <h3>{{ product().title }}</h3>
      <p>{{ product().price | currency }}</p>
      <button (click)="addToCart()">Add to Cart</button>
    </div>
  `,
})
export class ProductCardComponent {
  product = input.required<{ productId: number; title: string; price: number }>();

  private readonly cartStore = inject(CartStore);

  addToCart(): void {
    this.cartStore.addItem(this.product());
  }
}
```

The shell header reads the same store instance:

```typescript
// apps/shell/src/app/cart-badge.component.ts
import { Component, inject } from '@angular/core';
import { CartStore } from '@mfe-platform/shared-data-access-cart';

@Component({
  selector: 'app-cart-badge',
  standalone: true,
  template: `
    <span class="cart-badge">
      @if (cartStore.totalItems() > 0) {
        {{ cartStore.totalItems() }}
      }
    </span>
  `,
})
export class CartBadgeComponent {
  protected readonly cartStore = inject(CartStore);
}
```

This works because both `ProductCardComponent` and `CartBadgeComponent` resolve `CartStore` from the same root injector. The webpack shared config from Chapter 33 ensures `@ngrx/signals` is loaded once, so the `signalStore` factory creates exactly one instance.

### When Singleton Stores Work Well

Singleton stores are appropriate when the shared state has a clear owner, a stable shape, and all consumers live in the same Angular application. Authentication, cart, notification counts, and user preferences fit this pattern. The shared library provides a clean barrel export, and Nx's `enforce-module-boundaries` rule prevents remotes from reaching into each other's internals.

### When They Break Down

Singleton stores create problems when the state shape changes frequently, when multiple teams modify the same slices concurrently, or when the shared library becomes a bottleneck in the CI pipeline. If every PR touches the cart store, every team's build is affected. The next two patterns address these scenarios.

## Pattern 2: The Anti-Corruption Layer

When direct store access across MFE boundaries creates too much coupling, insert a contract between the producer and consumer. The Anti-Corruption Layer pattern (borrowed from Domain-Driven Design) defines a stable interface that the producer implements and the consumer depends on. The consumer never sees the producer's internal state shape.

Define the contract as an `InjectionToken` in a shared library:

```typescript
// libs/shared/contracts/src/lib/cart-api.contract.ts
import { InjectionToken, Signal } from '@angular/core';

export interface CartItemSummary {
  productId: number;
  title: string;
  price: number;
  quantity: number;
}

export interface CartApi {
  readonly items: Signal<CartItemSummary[]>;
  readonly totalItems: Signal<number>;
  readonly totalPrice: Signal<number>;
  addItem(product: { productId: number; title: string; price: number }): void;
  removeItem(productId: number): void;
}

export const CART_API = new InjectionToken<CartApi>('CartApi');
```

The owning team (say, the Orders team) provides the implementation. Internally they use a SignalStore, but the contract hides this:

```typescript
// libs/orders/data-access/src/lib/cart-api.adapter.ts
import { Injectable, Signal, inject, computed } from '@angular/core';
import { CartApi, CartItemSummary } from '@mfe-platform/shared-contracts';
import { CartStore } from './internal/cart.store';

@Injectable()
export class CartApiAdapter implements CartApi {
  private readonly store = inject(CartStore);

  readonly items: Signal<CartItemSummary[]> = computed(() =>
    this.store.entities().map((e) => ({
      productId: e.productId,
      title: e.title,
      price: e.price,
      quantity: e.quantity,
    }))
  );

  readonly totalItems = this.store.totalItems;
  readonly totalPrice = this.store.totalPrice;

  addItem(product: { productId: number; title: string; price: number }): void {
    this.store.addItem(product);
  }

  removeItem(productId: number): void {
    const entity = this.store.entities().find((e) => e.productId === productId);
    if (entity) {
      this.store.removeItem(entity.id);
    }
  }
}
```

Provide the adapter at the shell level so it is available to all remotes:

```typescript
// apps/shell/src/app/app.config.ts
import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideStore } from '@ngrx/store';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { CART_API } from '@mfe-platform/shared-contracts';
import { CartApiAdapter } from '@mfe-platform/orders-data-access';
import { appRoutes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(appRoutes),
    provideStore({}),
    provideStoreDevtools({ maxAge: 25, connectInZone: false }),
    { provide: CART_API, useClass: CartApiAdapter },
  ],
};
```

Consumers inject the token, not the concrete store:

```typescript
// libs/products/feature/src/lib/add-to-cart.component.ts
import { Component, inject, input } from '@angular/core';
import { CART_API } from '@mfe-platform/shared-contracts';

@Component({
  selector: 'lib-add-to-cart',
  standalone: true,
  template: `
    <button (click)="add()">
      Add to Cart ({{ cartApi.totalItems() }} items)
    </button>
  `,
})
export class AddToCartComponent {
  product = input.required<{ productId: number; title: string; price: number }>();

  protected readonly cartApi = inject(CART_API);

  add(): void {
    this.cartApi.addItem(this.product());
  }
}
```

The Products team depends only on `@mfe-platform/shared-contracts`, a library containing interfaces and tokens with no implementation code. The Orders team can refactor their internal `CartStore` from SignalStore to Classic Store or even raw signals without breaking any consumer. The contract is the boundary.

### When to Use Anti-Corruption Layers

Use this pattern when multiple teams consume cross-feature state and the producing team needs freedom to refactor internals. It adds a layer of indirection, which costs a small amount of code, but it dramatically reduces coordination overhead. For platforms with more than three teams, this is the recommended default for cross-feature state.

## Pattern 3: Event-Based Communication

Sometimes shared DI is not available. Perhaps one MFE uses a different framework, or the communication is fire-and-forget (notifications, analytics pings, navigation requests). Event-based communication decouples the sender from the receiver entirely.

### NgRx Scoped Events

NgRx 21 introduced scoped events in the `@ngrx/signals/events` package. The `injectDispatch` function accepts a `scope` option that controls how far an event propagates through the injector hierarchy:

- `'self'` (the default): the event stays within the local store's injector. Feature MFE isolation.
- `'parent'`: the event propagates to the parent injector. Useful for feature-to-shell communication.
- `'global'`: the event broadcasts to every listener in the application. Cross-MFE coordination.

Define a shared event group:

```typescript
// libs/shared/util-mfe-events/src/lib/platform.events.ts
import { eventGroup, type } from '@ngrx/signals/events';

export const CartEvents = eventGroup({
  source: 'Cart',
  events: {
    itemAdded: type<{ productId: number; title: string; price: number }>(),
    itemRemoved: type<{ productId: number }>(),
    cleared: type<void>(),
  },
});

export const PlatformEvents = eventGroup({
  source: 'Platform',
  events: {
    userAuthenticated: type<{ userId: number; roles: string[] }>(),
    userLoggedOut: type<void>(),
    themeChanged: type<{ theme: 'light' | 'dark' }>(),
  },
});
```

The Products MFE dispatches a cart event globally when the user adds an item:

```typescript
// libs/products/feature/src/lib/product-actions.component.ts
import { Component, inject, input } from '@angular/core';
import { injectDispatch } from '@ngrx/signals/events';
import { CartEvents } from '@mfe-platform/shared-mfe-events';

@Component({
  selector: 'lib-product-actions',
  standalone: true,
  template: `
    <button (click)="addToCart()">Add to Cart</button>
  `,
})
export class ProductActionsComponent {
  product = input.required<{ productId: number; title: string; price: number }>();

  private readonly dispatch = injectDispatch(CartEvents, { scope: 'global' });

  addToCart(): void {
    this.dispatch.itemAdded(this.product());
  }
}
```

The shell's cart store reacts to this event with a reducer:

```typescript
// libs/shared/data-access-cart/src/lib/cart-event.store.ts
import { computed } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
} from '@ngrx/signals';
import { withEntities, addEntity, removeEntity } from '@ngrx/signals/entities';
import { withReducer, on } from '@ngrx/signals/events';
import { CartEvents } from '@mfe-platform/shared-mfe-events';

export interface CartItem {
  id: number;
  productId: number;
  title: string;
  price: number;
  quantity: number;
}

export const CartEventStore = signalStore(
  { providedIn: 'root' },
  withEntities<CartItem>(),
  withComputed(({ entities }) => ({
    totalItems: computed(() =>
      entities().reduce((sum, item) => sum + item.quantity, 0)
    ),
    totalPrice: computed(() =>
      entities().reduce((sum, item) => sum + item.price * item.quantity, 0)
    ),
  })),
  withReducer(
    on(CartEvents.itemAdded, (state, { payload }) => {
      const existing = state.entities[state.ids.find(
        (id) => state.entities[id].productId === payload.productId
      )!];
      if (existing) {
        return {
          ...state,
          entities: {
            ...state.entities,
            [existing.id]: { ...existing, quantity: existing.quantity + 1 },
          },
        };
      }
      const newId = Date.now();
      return {
        ...state,
        ids: [...state.ids, newId],
        entities: {
          ...state.entities,
          [newId]: { id: newId, ...payload, quantity: 1 },
        },
      };
    }),
    on(CartEvents.itemRemoved, (state, { payload }) => {
      const idToRemove = state.ids.find(
        (id) => state.entities[id].productId === payload.productId
      );
      if (!idToRemove) return state;
      const { [idToRemove]: removed, ...remainingEntities } = state.entities;
      return {
        ...state,
        ids: state.ids.filter((id) => id !== idToRemove),
        entities: remainingEntities,
      };
    }),
    on(CartEvents.cleared, () => ({
      ids: [] as number[],
      entities: {} as Record<number, CartItem>,
    })),
  ),
);
```

The Products MFE never imports `CartEventStore`. It only dispatches events. The cart store listens and reacts. Neither team depends on the other's code. The shared `CartEvents` event group is the only contract.

### Custom Event Bus for Framework-Agnostic Communication

When MFEs span frameworks (Angular and React on the same page) or when you need to communicate across browser tabs, a framework-agnostic event bus is necessary. Here is a lightweight implementation using `BroadcastChannel` for cross-tab support and a `Subject` for same-tab delivery:

```typescript
// libs/shared/util-event-bus/src/lib/event-bus.service.ts
import { Injectable, OnDestroy } from '@angular/core';
import { Subject, Observable, filter, map } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';

export interface MfeEvent<T = unknown> {
  type: string;
  source: string;
  payload: T;
  timestamp: number;
}

@Injectable({ providedIn: 'root' })
export class EventBusService implements OnDestroy {
  private readonly localEvents$ = new Subject<MfeEvent>();
  private readonly channel = new BroadcastChannel('mfe-platform');

  constructor() {
    this.channel.onmessage = (event: MessageEvent<MfeEvent>) => {
      this.localEvents$.next(event.data);
    };
  }

  emit<T>(type: string, source: string, payload: T): void {
    const event: MfeEvent<T> = { type, source, payload, timestamp: Date.now() };
    this.localEvents$.next(event);
    this.channel.postMessage(event);
  }

  on<T>(type: string): Observable<T> {
    return this.localEvents$.pipe(
      filter((e) => e.type === type),
      map((e) => e.payload as T),
    );
  }

  onSignal<T>(type: string, initialValue: T) {
    return toSignal(this.on<T>(type), { initialValue });
  }

  ngOnDestroy(): void {
    this.channel.close();
  }
}
```

Use the event bus when NgRx scoped events are not an option. Prefer scoped events within an all-Angular platform because they integrate with the NgRx DevTools and follow the same patterns as the rest of your state management.

## Choosing the Right Pattern

The three patterns are not mutually exclusive. Most platforms use all three:

| Scenario | Pattern | Why |
|---|---|---|
| Auth, user profile, theme | Singleton store | Single owner, read by all, rarely changes |
| Cart, notifications | Anti-Corruption Layer | Multiple consumers, producer needs refactoring freedom |
| Analytics pings, navigation events | Event bus | Fire-and-forget, no shared state needed |
| Cross-MFE commands ("add to cart") | NgRx scoped events (global) | Typed contract, DevTools integration, no direct coupling |
| Feature-internal UI state | Route-scoped store | No sharing needed, garbage collected on navigation |

A rule of thumb: start with the simplest pattern that meets the requirement. Singleton stores are simpler than anti-corruption layers, which are simpler than event buses. Only escalate when the simpler pattern creates a problem you can measure (build coupling, deployment coordination, breaking changes).

## The Webpack Shared Config Checklist

Every pattern above depends on packages being shared as singletons. Chapter 33 covered the basics. Here is the complete list, including secondary entry points that are easy to miss:

```javascript
// apps/shell/webpack.config.js
const { share, withModuleFederationPlugin } = require('@angular-architects/module-federation/webpack');

module.exports = withModuleFederationPlugin({
  remotes: {},
  shared: share({
    '@angular/core': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@angular/common': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@angular/common/http': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@angular/router': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@angular/forms': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@ngrx/store': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@ngrx/effects': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@ngrx/signals': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@ngrx/signals/entities': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@ngrx/signals/events': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@ngrx/signals/rxjs-interop': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    '@ngrx/store-devtools': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
    rxjs: { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  }),
});
```

Every remote must have an identical `shared` block. If the shell shares `@ngrx/signals/events` but a remote does not, the remote loads its own copy. Now two `Events` services exist, and events dispatched in the remote never reach the shell's store. This is the single most common cause of "my shared state is not updating" bugs in MFE architectures.

## Common Mistakes

### Mistake 1: Sharing All State Globally

```typescript
// libs/products/data-access/src/lib/products.store.ts
// WRONG: feature store is providedIn: 'root'
export const ProductsStore = signalStore(
  { providedIn: 'root' },
  withState<ProductsState>(initialState),
  withEntities<Product>(),
  withMethods((store) => ({
    loadProducts: rxMethod<void>(/* ... */),
    setFilter: (filter: string) => patchState(store, { filter }),
  })),
);
```

Making every store a root singleton means every team's state lives in the same scope. When the Products team renames a property, the Orders team's CI breaks even though they never use products state directly. Feature state should be provided at the route level, not at root:

```typescript
// libs/products/data-access/src/lib/products.store.ts
// CORRECT: feature store provided at route level
export const ProductsStore = signalStore(
  withState<ProductsState>(initialState),
  withEntities<Product>(),
  withMethods((store) => ({
    loadProducts: rxMethod<void>(/* ... */),
    setFilter: (filter: string) => patchState(store, { filter }),
  })),
);
```

```typescript
// apps/mfe_products/src/app/remote-entry/entry.routes.ts
export const remoteRoutes: Route[] = [
  {
    path: '',
    providers: [ProductsStore],
    children: [/* ... */],
  },
];
```

### Mistake 2: Missing Secondary Entry Points in Shared Config

```javascript
// apps/shell/webpack.config.js
// WRONG: only shares the main entry point
shared: share({
  '@ngrx/signals': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  // Missing: @ngrx/signals/events, @ngrx/signals/entities, @ngrx/signals/rxjs-interop
})
```

Secondary entry points like `@ngrx/signals/events` are separate packages from webpack's perspective. If you share `@ngrx/signals` but not `@ngrx/signals/events`, the shell and a remote each load their own copy of the events module. The `Events` injectable in the remote is a different instance than the one in the shell. Global events dispatched in the remote never reach shell-level listeners.

```javascript
// apps/shell/webpack.config.js
// CORRECT: share all secondary entry points explicitly
shared: share({
  '@ngrx/signals': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  '@ngrx/signals/entities': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  '@ngrx/signals/events': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  '@ngrx/signals/rxjs-interop': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
})
```

### Mistake 3: Dispatching Scoped Events Without Setting the Scope

```typescript
// libs/products/feature/src/lib/product-actions.component.ts
// WRONG: default scope is 'self', event never leaves this component's injector
private readonly dispatch = injectDispatch(CartEvents);

addToCart(): void {
  this.dispatch.itemAdded(this.product());
  // The shell's CartEventStore never receives this event
}
```

The default scope for `injectDispatch` is `'self'`, which means the event is only visible within the component's own injector. For cross-MFE communication, you must explicitly set `scope: 'global'`:

```typescript
// libs/products/feature/src/lib/product-actions.component.ts
// CORRECT: global scope reaches all listeners across all MFEs
private readonly dispatch = injectDispatch(CartEvents, { scope: 'global' });

addToCart(): void {
  this.dispatch.itemAdded(this.product());
  // The shell's CartEventStore receives this event
}
```

### Mistake 4: Broadcasting Sensitive Data Over CustomEvents

```typescript
// WRONG: auth token exposed to any script on the page
eventBus.emit('user.authenticated', 'auth', {
  userId: 42,
  token: 'eyJhbGciOiJIUzI1NiIs...',
  refreshToken: 'dGhpcyBpcyBhIHJlZnJlc2g...',
});
```

`CustomEvent` and `BroadcastChannel` are accessible to any JavaScript running on the page, including third-party scripts. Never broadcast authentication tokens, session secrets, or PII through event channels. Keep sensitive state in DI-scoped services where only Angular code in the same injector tree can access it:

```typescript
// CORRECT: only broadcast non-sensitive identifiers
eventBus.emit('user.authenticated', 'auth', {
  userId: 42,
  roles: ['customer'],
});
// The auth token stays in the AuthStore, accessible only via DI
```

## Key Takeaways

- **Minimize shared state to what actually needs coordination.** Global state (auth, theme) uses singleton stores. Cross-feature state (cart) uses anti-corruption layers or scoped events. Feature state (filters, pagination) stays route-scoped. If you cannot name the consumer, the state should not be shared.

- **NgRx 21 scoped events give you typed, DevTools-integrated cross-MFE communication.** Use `scope: 'global'` to broadcast across all remotes, `scope: 'parent'` for feature-to-shell messaging, and `scope: 'self'` (the default) for local store events. This replaces ad-hoc CustomEvent patterns within all-Angular platforms.

- **The Anti-Corruption Layer decouples internal state from external consumers.** Define interfaces and `InjectionToken`s in a shared contracts library. The producing team implements the interface with whatever store technology they choose. Consumers depend only on the contract, not the implementation.

- **Every secondary entry point must be in the webpack shared config.** Missing `@ngrx/signals/events` or `@ngrx/signals/entities` causes duplicate module loads, creating separate instances of services that should be singletons. This is the most common source of "state not updating across remotes" bugs.

- **Never broadcast sensitive data through event channels.** `CustomEvent`, `BroadcastChannel`, and `window.postMessage` are accessible to any script on the page. Keep tokens and PII in DI-scoped stores. Only broadcast non-sensitive identifiers and commands through event-based patterns.
