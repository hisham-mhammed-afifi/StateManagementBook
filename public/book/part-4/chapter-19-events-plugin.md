# Chapter 19: The Events Plugin -- Event-Driven SignalStore

Your product catalog store has grown. The `ProductCatalogStore` handles product loading, the `CartStore` tracks items in the shopping cart, and the `InventoryStore` monitors stock levels. When a customer places an order, three things need to happen: the cart clears, the inventory decrements, and an analytics event fires. Right now, your `OrderStore` calls methods on all three stores directly: `cartStore.clear()`, `inventoryStore.decrement(items)`, `analyticsService.track('order_placed')`. The `OrderStore` has become a coordinator that knows about every other store in the system. Add a `NotificationStore` next week? You edit `OrderStore` again. Add a `LoyaltyPointsStore` the week after? Another edit. Each new requirement widens the blast radius of a single store.

The Events plugin for NgRx SignalStore solves this by inverting the dependency. Instead of the `OrderStore` calling every downstream store, it announces "an order was placed" as an event. Each downstream store independently subscribes to that event and reacts. The `OrderStore` never learns about `NotificationStore` or `LoyaltyPointsStore`. This is the Flux architecture brought to SignalStore: a "quantum of Redux" that you can apply selectively where event-driven patterns add value, without imposing them globally.

## A Quick Recap

In Chapters 15 through 18, we built SignalStore knowledge from the ground up. `withState` holds reactive state. `withComputed` derives signals. `withMethods` defines operations that modify state through `patchState`. `withEntities` (Chapter 16) normalizes collections. `withHooks` (Chapter 17) manages lifecycle. `withProps` centralizes injected dependencies. `signalStoreFeature` (Chapter 18) extracts reusable store logic into composable functions, with `type<T>()` constraints ensuring type safety. This chapter introduces a new dimension: event-driven state updates that replace direct method calls with a dispatcher/reducer/handler architecture.

## The Four Building Blocks

The Events plugin implements a focused version of the Flux pattern with four building blocks:

1. **Event** -- a typed declaration of something that happened. "The product page opened." "The API returned products." Events carry an optional payload.
2. **Dispatcher** -- an event bus that forwards events to all registered handlers. Components dispatch events; they do not call store methods directly.
3. **Store** -- contains reducers (synchronous state updates) and event handlers (asynchronous side effects) that react to dispatched events.
4. **View** -- the component template. It reads state from the store and dispatches events in response to user interaction.

The key insight is separation of "what" from "how." Events describe what happened. Reducers and event handlers decide how to react. A component that dispatches `productPageEvents.opened()` does not know whether that triggers an HTTP call, a cache lookup, or nothing at all. That decision lives in the store.

## Defining Events with eventGroup

The `eventGroup` function creates a collection of related events under a common source identifier. The source string appears in DevTools and logging, making it easy to trace which part of the application triggered an event.

```typescript
// src/app/products/events/product-page.events.ts
import { eventGroup } from '@ngrx/signals/events';
import { type } from '@ngrx/signals';
import { Product } from '../product.model';

export const productPageEvents = eventGroup({
  source: 'Product Page',
  events: {
    opened: type<void>(),
    refreshed: type<void>(),
    searchChanged: type<{ query: string }>(),
  },
});
```

```typescript
// src/app/products/events/product-api.events.ts
import { eventGroup } from '@ngrx/signals/events';
import { type } from '@ngrx/signals';
import { Product } from '../product.model';

export const productApiEvents = eventGroup({
  source: 'Product API',
  events: {
    loadSuccess: type<{ products: Product[] }>(),
    loadFailure: type<{ error: string }>(),
  },
});
```

Notice the organizational pattern: events are grouped by origin, not by target. `productPageEvents` represents what happens in the UI. `productApiEvents` represents what comes back from the server. This makes it clear where each event originates without coupling events to specific stores.

The `type<T>()` helper from `@ngrx/signals` creates a phantom type for the event payload. Use `type<void>()` for events with no payload. For events with data, pass the payload shape as the type parameter: `type<{ query: string }>()`.

## Handling State Changes with withReducer

Reducers are pure, synchronous functions that update state in response to events. The `withReducer` feature accepts one or more `on()` calls, each mapping events to state transformations.

```typescript
// src/app/products/store/products.store.ts
import { inject } from '@angular/core';
import { signalStore, withState, withProps } from '@ngrx/signals';
import { withEntities, setAllEntities } from '@ngrx/signals/entities';
import { on, withReducer, withEventHandlers, Events } from '@ngrx/signals/events';
import { mapResponse } from '@ngrx/operators';
import { switchMap } from 'rxjs';
import { Product } from '../product.model';
import { ProductService } from '../product.service';
import { productPageEvents } from '../events/product-page.events';
import { productApiEvents } from '../events/product-api.events';

type ProductState = {
  loading: boolean;
  error: string | null;
  query: string;
};

const initialState: ProductState = {
  loading: false,
  error: null,
  query: '',
};

export const ProductsStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withEntities<Product>(),
  withProps(() => ({
    _productService: inject(ProductService),
    _events: inject(Events),
  })),
  withReducer(
    on(productPageEvents.opened, productPageEvents.refreshed, () => ({
      loading: true,
      error: null,
    })),
    on(productPageEvents.searchChanged, ({ payload }) => ({
      query: payload.query,
      loading: true,
      error: null,
    })),
    on(productApiEvents.loadSuccess, ({ payload }) => [
      setAllEntities(payload.products),
      { loading: false },
    ]),
    on(productApiEvents.loadFailure, ({ payload }) => ({
      loading: false,
      error: payload.error,
    }))
  ),
  withEventHandlers((store) => ({
    loadProducts$: store._events
      .on(productPageEvents.opened, productPageEvents.refreshed)
      .pipe(
        switchMap(() =>
          store._productService.getAll().pipe(
            mapResponse({
              next: (products) =>
                productApiEvents.loadSuccess({ products }),
              error: (error) =>
                productApiEvents.loadFailure({ error: String(error) }),
            })
          )
        )
      ),
    searchProducts$: store._events.on(productPageEvents.searchChanged).pipe(
      switchMap(({ payload }) =>
        store._productService.search(payload.query).pipe(
          mapResponse({
            next: (products) =>
              productApiEvents.loadSuccess({ products }),
            error: (error) =>
              productApiEvents.loadFailure({ error: String(error) }),
          })
        )
      ),
    ),
  }))
);
```

Several details matter here. First, `on()` accepts multiple event creators as arguments. The `on(productPageEvents.opened, productPageEvents.refreshed, ...)` call means both events trigger the same reducer. Second, reducers can return three different shapes:

- **Partial state object:** `() => ({ loading: true })` merges the returned object into the store state.
- **State updater function:** `({ payload }) => (state) => ({ items: state.items.filter(...) })` receives the current state and returns a partial update. Use this when the new state depends on the previous state.
- **Array of updates:** `({ payload }) => [setAllEntities(payload.products), { loading: false }]` applies multiple updates in sequence. This is how you combine entity adapter operations with plain state changes.

## Managing Side Effects with withEventHandlers

While reducers handle synchronous state transitions, `withEventHandlers` manages asynchronous operations like HTTP calls, WebSocket messages, and navigation. Each event handler is a named Observable that listens for specific events and optionally emits new events in response.

In the store above, `loadProducts$` listens for `opened` and `refreshed` events, calls the product service, and emits either `loadSuccess` or `loadFailure`. The Events plugin automatically dispatches any events emitted by event handler Observables. You do not call `dispatch` manually inside event handlers.

The `Events` service provides the `.on()` method, which returns an Observable stream filtered to the specified event types. Inject it via `inject(Events)` inside `withProps`.

> **Migration Note:** `withEventHandlers` was named `withEffects` in NgRx v19.2 and v20. It was renamed in v21 to avoid confusion with Angular's `effect()` function from `@angular/core`. If you are upgrading from an earlier version, run `ng update @ngrx/signals@21` to apply the automatic migration schematic.

### Error Handling Is Not Optional

Event handler Observables must handle errors internally. If an Observable throws without a `catchError` or `mapResponse`, the stream closes permanently. Subsequent events of that type will never trigger the handler again. The `mapResponse` operator from `@ngrx/operators` is the recommended approach because it handles both success and error paths in a single call and re-subscribes automatically.

## Dispatching Events from Components

Components interact with the event system through `injectDispatch`. This function takes an event group and returns an object with methods matching the event names. Each method dispatches the corresponding event when called.

```typescript
// src/app/products/product-list.component.ts
import { Component, inject, OnInit } from '@angular/core';
import { ProductsStore } from './store/products.store';
import { injectDispatch } from '@ngrx/signals/events';
import { productPageEvents } from './events/product-page.events';

@Component({
  selector: 'app-product-list',
  standalone: true,
  template: `
    <div class="search-bar">
      <input
        type="text"
        placeholder="Search products..."
        (input)="onSearch($event)"
      />
    </div>

    @if (store.loading()) {
      <div class="spinner">Loading products...</div>
    } @else if (store.error(); as error) {
      <div class="error">
        <p>{{ error }}</p>
        <button (click)="dispatch.refreshed()">Retry</button>
      </div>
    } @else {
      <div class="product-grid">
        @for (product of store.entities(); track product.id) {
          <div class="product-card">
            <h3>{{ product.name }}</h3>
            <p>{{ product.price | currency }}</p>
          </div>
        } @empty {
          <p>No products found.</p>
        }
      </div>
    }
  `,
})
export class ProductListComponent implements OnInit {
  protected readonly store = inject(ProductsStore);
  protected readonly dispatch = injectDispatch(productPageEvents);

  ngOnInit(): void {
    this.dispatch.opened();
  }

  onSearch(event: Event): void {
    const query = (event.target as HTMLInputElement).value;
    this.dispatch.searchChanged({ query });
  }
}
```

The component does not call `store.loadProducts()` or `store.search(query)`. It dispatches events and lets the store decide how to handle them. This is the decoupling at the heart of the Events plugin.

## Cross-Store Communication

The strongest argument for events is loose coupling between stores. Consider what happens when an order is placed and multiple stores need to react.

```typescript
// src/app/orders/events/order.events.ts
import { eventGroup } from '@ngrx/signals/events';
import { type } from '@ngrx/signals';

export interface OrderItem {
  productId: string;
  quantity: number;
  price: number;
}

export const orderEvents = eventGroup({
  source: 'Order',
  events: {
    placed: type<{ items: OrderItem[]; total: number }>(),
    confirmed: type<{ orderId: string }>(),
    failed: type<{ error: string }>(),
  },
});
```

```typescript
// src/app/cart/store/cart.store.ts
import { signalStore, withState } from '@ngrx/signals';
import { on, withReducer } from '@ngrx/signals/events';
import { orderEvents } from '../../orders/events/order.events';
import { CartItem } from '../cart.model';

export const CartStore = signalStore(
  { providedIn: 'root' },
  withState({ items: [] as CartItem[] }),
  withReducer(
    on(orderEvents.placed, () => ({ items: [] }))
  )
);
```

```typescript
// src/app/inventory/store/inventory.store.ts
import { signalStore, withState } from '@ngrx/signals';
import { on, withReducer } from '@ngrx/signals/events';
import { orderEvents } from '../../orders/events/order.events';

interface StockLevel {
  productId: string;
  available: number;
}

export const InventoryStore = signalStore(
  { providedIn: 'root' },
  withState({ stockLevels: [] as StockLevel[] }),
  withReducer(
    on(orderEvents.placed, ({ payload }) => (state) => ({
      stockLevels: state.stockLevels.map((stock) => {
        const ordered = payload.items.find(
          (item) => item.productId === stock.productId
        );
        if (!ordered) return stock;
        return {
          ...stock,
          available: stock.available - ordered.quantity,
        };
      }),
    }))
  )
);
```

Neither `CartStore` nor `InventoryStore` imports `OrderStore`. They only import `orderEvents`, the event declaration file. The `OrderStore` dispatches `orderEvents.placed(...)` and does not know who is listening. Tomorrow you can add a `LoyaltyStore` that awards points on every order, and the `OrderStore` never changes.

## Dispatching Events from Inside a Store

Sometimes a store needs to dispatch events programmatically, not from a component. The `Dispatcher` service handles this. Inject it via `withProps` and call `dispatcher.dispatch()`.

```typescript
// src/app/orders/store/order.store.ts
import { inject } from '@angular/core';
import { signalStore, withState, withProps, withMethods, patchState } from '@ngrx/signals';
import { Dispatcher } from '@ngrx/signals/events';
import { firstValueFrom } from 'rxjs';
import { OrderService } from '../order.service';
import { orderEvents, OrderItem } from '../events/order.events';

export const OrderStore = signalStore(
  { providedIn: 'root' },
  withState({ submitting: false, lastOrderId: null as string | null }),
  withProps(() => ({
    _orderService: inject(OrderService),
    _dispatcher: inject(Dispatcher),
  })),
  withMethods((store) => ({
    async placeOrder(items: OrderItem[]): Promise<void> {
      patchState(store, { submitting: true });
      const total = items.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      );

      try {
        const orderId = await firstValueFrom(
          store._orderService.submit(items)
        );
        store._dispatcher.dispatch(
          orderEvents.confirmed({ orderId })
        );
        patchState(store, { submitting: false, lastOrderId: orderId });
      } catch (e) {
        const error = e instanceof Error ? e.message : 'Order failed';
        store._dispatcher.dispatch(orderEvents.failed({ error }));
        patchState(store, { submitting: false });
      }

      store._dispatcher.dispatch(orderEvents.placed({ items, total }));
    },
  }))
);
```

Use `Dispatcher` when dispatching from inside a store or a service. Use `injectDispatch` (the convenience function) when dispatching from a component, as it provides a cleaner API with auto-generated methods.

## Extracting Reducers and Event Handlers into Features

Building on the custom feature patterns from Chapter 18, you can extract reducers and event handlers into `signalStoreFeature` functions. This keeps each store definition concise and makes the event-handling logic independently testable.

```typescript
// src/app/products/store/products-reducer.feature.ts
import { signalStoreFeature } from '@ngrx/signals';
import { type as signalType } from '@ngrx/signals';
import { EntityState, setAllEntities } from '@ngrx/signals/entities';
import { on, withReducer } from '@ngrx/signals/events';
import { Product } from '../product.model';
import { productPageEvents } from '../events/product-page.events';
import { productApiEvents } from '../events/product-api.events';

export function withProductsReducer() {
  return signalStoreFeature(
    {
      state: signalType<
        EntityState<Product> & {
          loading: boolean;
          error: string | null;
          query: string;
        }
      >(),
    },
    withReducer(
      on(productPageEvents.opened, productPageEvents.refreshed, () => ({
        loading: true,
        error: null,
      })),
      on(productPageEvents.searchChanged, ({ payload }) => ({
        query: payload.query,
        loading: true,
        error: null,
      })),
      on(productApiEvents.loadSuccess, ({ payload }) => [
        setAllEntities(payload.products),
        { loading: false },
      ]),
      on(productApiEvents.loadFailure, ({ payload }) => ({
        loading: false,
        error: payload.error,
      }))
    )
  );
}
```

```typescript
// src/app/products/store/products-event-handlers.feature.ts
import { inject } from '@angular/core';
import { signalStoreFeature, withProps } from '@ngrx/signals';
import { Events, withEventHandlers } from '@ngrx/signals/events';
import { mapResponse } from '@ngrx/operators';
import { switchMap } from 'rxjs';
import { ProductService } from '../product.service';
import { productPageEvents } from '../events/product-page.events';
import { productApiEvents } from '../events/product-api.events';

export function withProductsEventHandlers() {
  return signalStoreFeature(
    withProps(() => ({
      _productService: inject(ProductService),
      _events: inject(Events),
    })),
    withEventHandlers((store) => ({
      loadProducts$: store._events
        .on(productPageEvents.opened, productPageEvents.refreshed)
        .pipe(
          switchMap(() =>
            store._productService.getAll().pipe(
              mapResponse({
                next: (products) =>
                  productApiEvents.loadSuccess({ products }),
                error: (error) =>
                  productApiEvents.loadFailure({ error: String(error) }),
              })
            )
          )
        ),
      searchProducts$: store._events
        .on(productPageEvents.searchChanged)
        .pipe(
          switchMap(({ payload }) =>
            store._productService.search(payload.query).pipe(
              mapResponse({
                next: (products) =>
                  productApiEvents.loadSuccess({ products }),
                error: (error) =>
                  productApiEvents.loadFailure({ error: String(error) }),
              })
            )
          )
        ),
    }))
  );
}
```

The store definition becomes a clean assembly of features:

```typescript
// src/app/products/store/products-composed.store.ts
import { signalStore, withState } from '@ngrx/signals';
import { withEntities } from '@ngrx/signals/entities';
import { withDevtools } from '@angular-architects/ngrx-toolkit';
import { Product } from '../product.model';
import { withProductsReducer } from './products-reducer.feature';
import { withProductsEventHandlers } from './products-event-handlers.feature';

export const ProductsStore = signalStore(
  { providedIn: 'root' },
  withState({ loading: false, error: null as string | null, query: '' }),
  withEntities<Product>(),
  withProductsReducer(),
  withProductsEventHandlers(),
  withDevtools('ProductsStore')
);
```

## Local vs Global Stores

All the stores shown so far use `providedIn: 'root'`, making them application-wide singletons. But the Events plugin works equally well with component-scoped stores. Omit `providedIn` and add the store to the component's `providers` array instead.

```typescript
// src/app/products/store/product-form.store.ts
import { signalStore, withState } from '@ngrx/signals';
import { eventGroup } from '@ngrx/signals/events';
import { type } from '@ngrx/signals';
import { on, withReducer } from '@ngrx/signals/events';

export const formEvents = eventGroup({
  source: 'Product Form',
  events: {
    nameChanged: type<{ name: string }>(),
    priceChanged: type<{ price: number }>(),
    submitted: type<void>(),
    reset: type<void>(),
  },
});

export const ProductFormStore = signalStore(
  withState({ name: '', price: 0, dirty: false, submitted: false }),
  withReducer(
    on(formEvents.nameChanged, ({ payload }) => ({
      name: payload.name,
      dirty: true,
    })),
    on(formEvents.priceChanged, ({ payload }) => ({
      price: payload.price,
      dirty: true,
    })),
    on(formEvents.submitted, () => ({ submitted: true, dirty: false })),
    on(formEvents.reset, () => ({
      name: '',
      price: 0,
      dirty: false,
      submitted: false,
    }))
  )
);
```

```typescript
// src/app/products/product-form.component.ts
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { injectDispatch } from '@ngrx/signals/events';
import { ProductFormStore, formEvents } from './store/product-form.store';

@Component({
  selector: 'app-product-form',
  standalone: true,
  imports: [FormsModule],
  providers: [ProductFormStore],
  template: `
    <form (ngSubmit)="dispatch.submitted()">
      <label>
        Name:
        <input
          [ngModel]="store.name()"
          (ngModelChange)="dispatch.nameChanged({ name: $event })"
          name="name"
        />
      </label>
      <label>
        Price:
        <input
          type="number"
          [ngModel]="store.price()"
          (ngModelChange)="dispatch.priceChanged({ price: $event })"
          name="price"
        />
      </label>
      <button type="submit" [disabled]="!store.dirty()">Save</button>
      <button type="button" (click)="dispatch.reset()">Reset</button>
    </form>

    @if (store.submitted()) {
      <p class="success">Product saved successfully.</p>
    }
  `,
})
export class ProductFormComponent {
  protected readonly store = inject(ProductFormStore);
  protected readonly dispatch = injectDispatch(formEvents);
}
```

Each instance of `ProductFormComponent` gets its own `ProductFormStore`. Opening two product forms means two independent stores with separate state. Events dispatched in one form do not affect the other because each store instance has its own reducer subscriptions.

## Scoped Events

NgRx v21 introduced scoped events, which control how far an event propagates through the injector hierarchy. This is particularly important in micro-frontend architectures where multiple independently deployed applications share a page.

The `injectDispatch` function accepts an optional scope parameter:

- `'self'` (default) -- events are handled only within the current injector scope
- `'parent'` -- events bubble up to the parent injector
- `'global'` -- events broadcast to every handler in the application

```typescript
// src/app/remote-entry/remote-entry.component.ts
import { Component } from '@angular/core';
import { provideDispatcher, injectDispatch } from '@ngrx/signals/events';
import { remoteFeatureEvents } from './events/remote-feature.events';

@Component({
  selector: 'app-remote-entry',
  standalone: true,
  providers: [provideDispatcher()],
  template: `
    <h2>Remote Feature</h2>
    <button (click)="onAction()">Do Something</button>
  `,
})
export class RemoteEntryComponent {
  private readonly dispatch = injectDispatch(remoteFeatureEvents, {
    scope: 'self',
  });

  onAction(): void {
    this.dispatch.actionTriggered();
  }
}
```

The `provideDispatcher()` call in `providers` creates a new dispatcher boundary. Events dispatched with `scope: 'self'` stay within this boundary. Without `provideDispatcher()`, events would leak to the shell application's global dispatcher, potentially triggering unintended handlers.

Use `scope: 'global'` sparingly and intentionally. A global event like `authEvents.sessionExpired` makes sense because every feature in the application may need to react. A local form event like `formEvents.fieldChanged` should stay scoped to avoid cross-feature interference.

## When to Use Events vs Methods

Not every store needs events. Here is a decision guide:

**Use `withMethods` (direct method calls) when:**
- The store has a single consumer (one component, one feature)
- State changes are straightforward CRUD operations
- You do not need an audit trail of what happened
- The store does not need to coordinate with other stores

**Use the Events plugin when:**
- Multiple stores need to react to the same occurrence
- You want to decouple the "what happened" from the "how to react"
- You need Redux DevTools integration for time-travel debugging
- Complex async chains involve multiple events (load, success, failure)
- You are migrating from NgRx Classic Store and want a familiar pattern

You can also mix the two patterns across different stores in the same application. Use events for stores that coordinate complex flows and methods for simple, self-contained stores. The Events plugin is the "quantum of Redux": apply it precisely where it adds value.

## Common Mistakes

### Mistake 1: Missing Error Handling in Event Handlers

```typescript
// WRONG: no error handling, stream dies on first HTTP error
withEventHandlers((store) => ({
  loadProducts$: store._events.on(productPageEvents.opened).pipe(
    switchMap(() => store._productService.getAll()),
    map((products) => productApiEvents.loadSuccess({ products }))
  ),
}))
```

When the HTTP call fails, the Observable throws, the stream completes, and all future `opened` events are silently ignored. The component keeps dispatching events that nothing handles.

```typescript
// CORRECT: use mapResponse to handle both success and error
withEventHandlers((store) => ({
  loadProducts$: store._events.on(productPageEvents.opened).pipe(
    switchMap(() =>
      store._productService.getAll().pipe(
        mapResponse({
          next: (products) => productApiEvents.loadSuccess({ products }),
          error: (error) => productApiEvents.loadFailure({ error: String(error) }),
        })
      )
    ),
  ),
}))
```

The `mapResponse` operator from `@ngrx/operators` catches errors inside the inner Observable, preventing the outer stream from dying. It also re-subscribes automatically.

### Mistake 2: Mixing withMethods and withReducer for the Same State

```typescript
// WRONG: two mutation paths for 'loading'
export const ProductsStore = signalStore(
  withState({ loading: false }),
  withReducer(
    on(productPageEvents.opened, () => ({ loading: true }))
  ),
  withMethods((store) => ({
    setLoading(value: boolean): void {
      patchState(store, { loading: value });
    },
  }))
);
```

Now `loading` can change via an event (dispatching `opened`) or via a direct method call (`setLoading(false)`). This creates two competing mutation paths for the same state slice. When debugging, you cannot tell which path changed the value by looking at DevTools alone.

```typescript
// CORRECT: use one pattern per state slice
export const ProductsStore = signalStore(
  withState({ loading: false }),
  withReducer(
    on(productPageEvents.opened, () => ({ loading: true })),
    on(productApiEvents.loadSuccess, () => ({ loading: false })),
    on(productApiEvents.loadFailure, () => ({ loading: false }))
  )
);
```

All mutations to `loading` flow through events. Every state change is traceable.

### Mistake 3: Forgetting provideDispatcher in Micro-Frontend Remotes

```typescript
// WRONG: no dispatcher boundary, events leak to the shell
@Component({
  selector: 'app-remote-entry',
  standalone: true,
  template: `<button (click)="dispatch.save()">Save</button>`,
})
export class RemoteEntryComponent {
  readonly dispatch = injectDispatch(remoteEvents, { scope: 'self' });

  // 'self' scope has no effect without provideDispatcher()!
  // Events still reach the shell's global dispatcher.
}
```

The `scope: 'self'` option only works when there is a dispatcher boundary established by `provideDispatcher()`. Without it, `'self'` resolves to the nearest ancestor dispatcher, which is typically the shell's global one.

```typescript
// CORRECT: establish a dispatcher boundary
@Component({
  selector: 'app-remote-entry',
  standalone: true,
  providers: [provideDispatcher()],
  template: `<button (click)="dispatch.save()">Save</button>`,
})
export class RemoteEntryComponent {
  readonly dispatch = injectDispatch(remoteEvents, { scope: 'self' });
}
```

### Mistake 4: Dispatching Events Before Stores Initialize

```typescript
// WRONG: dispatching in the constructor, before event handlers are ready
@Component({
  selector: 'app-product-list',
  standalone: true,
  template: `...`,
})
export class ProductListComponent {
  readonly store = inject(ProductsStore);
  readonly dispatch = injectDispatch(productPageEvents);

  constructor() {
    this.dispatch.opened(); // Store's event handlers may not be ready!
  }
}
```

Events use an RxJS Subject internally. If no subscriber is listening when the event fires, it is lost. There is no buffering or replay. Store initialization happens during injection, but event handler subscriptions may not be active during the constructor of a sibling injectable.

```typescript
// CORRECT: dispatch in ngOnInit or afterNextRender
@Component({
  selector: 'app-product-list',
  standalone: true,
  template: `...`,
})
export class ProductListComponent implements OnInit {
  readonly store = inject(ProductsStore);
  readonly dispatch = injectDispatch(productPageEvents);

  ngOnInit(): void {
    this.dispatch.opened();
  }
}
```

Dispatching in `ngOnInit` ensures the component (and its injected stores) are fully initialized before events flow.

## Key Takeaways

- **Events decouple "what happened" from "how to react."** Components dispatch events like `productPageEvents.opened()`. Stores independently decide whether to load data, update state, or trigger side effects. Adding a new reactor never changes the dispatcher.

- **`withReducer` handles synchronous state, `withEventHandlers` handles async side effects.** Reducers return partial state or updater functions. Event handlers return Observables that may emit new events, which the plugin dispatches automatically.

- **Always handle errors in event handler Observables.** Use `mapResponse` from `@ngrx/operators` inside `switchMap` to prevent stream termination. An unhandled error permanently kills the handler.

- **Use scoped events with `provideDispatcher()` for micro-frontend isolation.** Without an explicit dispatcher boundary, events leak across application boundaries. Scope options (`'self'`, `'parent'`, `'global'`) control propagation radius.

- **Events are not always the right choice.** Simple stores with one consumer and straightforward CRUD are better served by `withMethods`. Reserve the Events plugin for cross-store coordination, complex async flows, and scenarios where an audit trail of state changes matters.
