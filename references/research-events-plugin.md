# Research: The Events Plugin -- Event-Driven SignalStore

**Date:** 2026-04-01
**Chapter:** Ch 19
**Status:** Ready for chapter generation

## API Surface

### eventGroup

- **Import:** `import { eventGroup } from '@ngrx/signals/events';`
- **Signature:** `eventGroup(config: { source: string; events: Record<string, EventCreator> })`
- **Purpose:** Creates a group of related events under a common source identifier. The `source` string aids debugging by identifying which application component triggered events.
- **Stability:** Stable (promoted from experimental in NgRx v21)
- **Payload helpers:** Use `type<T>()` from `@ngrx/signals` for typed payloads, `type<void>()` for no payload.

```typescript
// products/events/product-page.events.ts
import { eventGroup } from '@ngrx/signals/events';
import { type } from '@ngrx/signals';

export const productPageEvents = eventGroup({
  source: 'Product Page',
  events: {
    opened: type<void>(),
    refreshed: type<void>(),
    searchChanged: type<{ query: string }>(),
  },
});

export const productApiEvents = eventGroup({
  source: 'Product API',
  events: {
    loadSuccess: type<{ products: Product[] }>(),
    loadFailure: type<{ error: string }>(),
  },
});
```

### withReducer

- **Import:** `import { withReducer } from '@ngrx/signals/events';`
- **Signature:** `withReducer(...cases: ReturnType<typeof on>[])`
- **Purpose:** Defines case reducers that map events to state updates. Accepts one or more `on()` calls.
- **Return values:** Reducers can return three forms:
  1. Partial state object: `({ payload }) => ({ loading: false })`
  2. Partial state updater function: `({ payload }) => (state) => ({ items: state.items.filter(...) })`
  3. Array of partial state objects and/or updaters: `({ payload }) => [setEntities(payload.items), { loading: false }]`
- **Stability:** Stable

```typescript
import { on, withReducer } from '@ngrx/signals/events';

withReducer(
  on(productPageEvents.opened, productPageEvents.refreshed, () => ({
    loading: true,
    error: null,
  })),
  on(productApiEvents.loadSuccess, ({ payload }) => ({
    products: payload.products,
    loading: false,
  })),
  on(productApiEvents.loadFailure, ({ payload }) => ({
    loading: false,
    error: payload.error,
  }))
)
```

### on

- **Import:** `import { on } from '@ngrx/signals/events';`
- **Signature:** `on(...eventCreators: EventCreator[], reducerFn: (event: { payload: T }) => StateUpdate)`
- **Purpose:** Maps one or more event types to a single reducer function. Multiple events can share the same handler.
- **Stability:** Stable

### withEventHandlers (formerly withEffects)

- **Import:** `import { withEventHandlers } from '@ngrx/signals/events';`
- **Signature:** `withEventHandlers(effectsFactory: (store: Store, ...injected: any[]) => Record<string, Observable>)`
- **Purpose:** Handles side effects through reactive event streams. Effects that emit events trigger automatic dispatching.
- **Stability:** Stable
- **BREAKING CHANGE (v21):** Renamed from `withEffects` to `withEventHandlers`. See Breaking Changes section.

```typescript
import { Events, withEventHandlers } from '@ngrx/signals/events';
import { mapResponse } from '@ngrx/operators';
import { switchMap } from 'rxjs/operators';

withEventHandlers((store) => ({
  loadProducts$: store._events.on(productPageEvents.opened).pipe(
    switchMap(() =>
      store._productService.getAll().pipe(
        mapResponse({
          next: (products) => productApiEvents.loadSuccess({ products }),
          error: (error) => productApiEvents.loadFailure({ error: String(error) }),
        }),
      ),
    ),
  ),
}))
```

### Events Service

- **Import:** `import { Events } from '@ngrx/signals/events';`
- **Injection:** `inject(Events)`
- **Key method:** `events.on(...eventCreators): Observable<Event>` -- provides a reactive event stream within effects.
- **Stability:** Stable
- **Note:** Uses RxJS Subject internally. Events are not buffered or replayed; if a subscriber isn't listening when an event fires, it's missed.

### Dispatcher Service

- **Import:** `import { Dispatcher } from '@ngrx/signals/events';`
- **Injection:** `inject(Dispatcher)`
- **Method:** `dispatcher.dispatch(event: Event): void`
- **Purpose:** Manually triggers event dispatch from stores or services. Useful for cross-store communication.
- **Stability:** Stable

### injectDispatch

- **Import:** `import { injectDispatch } from '@ngrx/signals/events';`
- **Signature:** `injectDispatch(eventGroup, options?: { scope: 'self' | 'parent' | 'global' }): Record<string, (...args) => void>`
- **Purpose:** Convenience utility that generates self-dispatching event methods from an event group. Provides a fluent API.
- **Stability:** Stable

```typescript
// In a component
protected readonly dispatch = injectDispatch(productPageEvents);

onSearch(query: string) {
  this.dispatch.searchChanged({ query });
}
```

### provideDispatcher

- **Import:** `import { provideDispatcher } from '@ngrx/signals/events';`
- **Purpose:** Configures the event dispatcher at a specific injection scope.
- **Stability:** Stable

### Scoped Events (v21 Feature)

- **API:** `injectDispatch(eventGroup, { scope: 'self' | 'parent' | 'global' })`
- **Scope options:**
  - `'self'` (default): Events stay within the local injector scope
  - `'parent'`: Events bubble up to parent injector level
  - `'global'`: Events broadcast application-wide
- **Purpose:** Controls event broadcast radius. Critical for micro-frontend architectures and feature isolation.
- **Stability:** Stable (new in v21)

```typescript
// Local scope -- events only within this component/feature
const dispatch = injectDispatch(featureEvents, { scope: 'self' });

// Global scope -- events reach the entire application
const dispatch = injectDispatch(featureEvents, { scope: 'global' });
```

## Key Concepts

- **Flux Architecture in SignalStore:** The Events plugin brings four Flux building blocks: Event, Dispatcher, Store (reducers + event handlers), View. This is the "quantum of Redux" -- selective application of Redux patterns where they add value.
- **Separation of "what" from "how":** Events describe what happened (user clicked, API responded). Reducers and event handlers define how the system reacts. This decoupling improves maintainability.
- **Event groups as domain boundaries:** Group events by source (e.g., "Product Page", "Product API") to organize by origin, not by target.
- **Cross-store communication:** Stores can react to events from other stores without direct dependencies. Store A emits an event; Store B has a reducer that handles it.
- **Composability with signalStoreFeature:** Reducers and event handlers can be extracted into reusable features using `signalStoreFeature()`, building on Chapter 18's patterns.
- **Local vs global stores:** `providedIn: 'root'` for application-wide singletons; component-level `providers: [Store]` for isolated, component-scoped state.
- **When to use events vs methods:** Events shine for complex chains (one action triggers multiple independent updates), cross-store coordination, and audit trails. Methods are simpler for straightforward CRUD.

## Code Patterns

### Pattern 1: Complete Event-Driven Store

```typescript
// products/events/product-page.events.ts
import { eventGroup } from '@ngrx/signals/events';
import { type } from '@ngrx/signals';

export const productPageEvents = eventGroup({
  source: 'Product Page',
  events: {
    opened: type<void>(),
    searchChanged: type<{ query: string }>(),
  },
});

export const productApiEvents = eventGroup({
  source: 'Product API',
  events: {
    loadSuccess: type<{ products: Product[] }>(),
    loadFailure: type<{ error: string }>(),
  },
});
```

```typescript
// products/store/products.store.ts
import { signalStore, withState, withProps } from '@ngrx/signals';
import { withEntities, setAllEntities } from '@ngrx/signals/entities';
import { on, withReducer, withEventHandlers, Events } from '@ngrx/signals/events';
import { mapResponse } from '@ngrx/operators';
import { switchMap } from 'rxjs';

export const ProductsStore = signalStore(
  { providedIn: 'root' },
  withState({ loading: false, error: null as string | null }),
  withEntities<Product>(),
  withProps(() => ({
    _productService: inject(ProductService),
    _events: inject(Events),
  })),
  withReducer(
    on(productPageEvents.opened, () => ({ loading: true, error: null })),
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
    loadProducts$: store._events.on(productPageEvents.opened).pipe(
      switchMap(() =>
        store._productService.getAll().pipe(
          mapResponse({
            next: (products) => productApiEvents.loadSuccess({ products }),
            error: (error) => productApiEvents.loadFailure({ error: String(error) }),
          }),
        ),
      ),
    ),
  })),
);
```

### Pattern 2: Extracting Reducers and Event Handlers into Features

```typescript
// products/store/products-reducer.feature.ts
import { signalStoreFeature } from '@ngrx/signals';
import { type as signalType } from '@ngrx/signals';
import { EntityState } from '@ngrx/signals/entities';
import { on, withReducer } from '@ngrx/signals/events';

export function withProductsReducer() {
  return signalStoreFeature(
    { state: signalType<EntityState<Product> & { loading: boolean; error: string | null }>() },
    withReducer(
      on(productPageEvents.opened, () => ({ loading: true, error: null })),
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

### Pattern 3: Cross-Store Communication via Events

```typescript
// Store A emits an event
export const orderEvents = eventGroup({
  source: 'Order Store',
  events: {
    orderPlaced: type<{ productId: number; quantity: number }>(),
  },
});

// Store B reacts to Store A's event without direct dependency
export const InventoryStore = signalStore(
  { providedIn: 'root' },
  withEntities<InventoryItem>(),
  withReducer(
    on(orderEvents.orderPlaced, ({ payload }) => (state) => ({
      entityMap: {
        ...state.entityMap,
        [payload.productId]: {
          ...state.entityMap[payload.productId],
          quantity: state.entityMap[payload.productId].quantity - payload.quantity,
        },
      },
    }))
  ),
);
```

### Pattern 4: Component with injectDispatch

```typescript
// products/components/product-list.component.ts
@Component({
  selector: 'app-product-list',
  standalone: true,
  template: `
    @if (store.loading()) {
      <app-spinner />
    } @else {
      @for (product of store.entities(); track product.id) {
        <app-product-card [product]="product" />
      }
    }
  `,
})
export class ProductListComponent implements OnInit {
  protected readonly store = inject(ProductsStore);
  protected readonly dispatch = injectDispatch(productPageEvents);

  ngOnInit() {
    this.dispatch.opened();
  }
}
```

### Pattern 5: Local (Component-Scoped) Store with Events

```typescript
// No providedIn -- must be provided at component level
export const ProductFormStore = signalStore(
  withState({ name: '', price: 0, dirty: false }),
  withReducer(
    on(formEvents.fieldChanged, ({ payload }) => ({
      [payload.field]: payload.value,
      dirty: true,
    })),
    on(formEvents.reset, () => ({ name: '', price: 0, dirty: false }))
  ),
);

@Component({
  providers: [ProductFormStore], // Each instance gets its own store
  template: `...`,
})
export class ProductFormComponent {
  readonly store = inject(ProductFormStore);
  readonly dispatch = injectDispatch(formEvents);
}
```

### Pattern 6: Scoped Events in Micro-Frontends

```typescript
// Remote MFE -- events scoped locally
@Component({
  providers: [provideDispatcher()], // Local dispatcher scope
  template: `...`,
})
export class RemoteEntryComponent {
  readonly dispatch = injectDispatch(remoteEvents, { scope: 'self' });

  onAction() {
    this.dispatch.actionTriggered(); // Only handlers in this scope react
  }
}

// Shell -- can listen globally
@Component({
  template: `...`,
})
export class ShellComponent {
  readonly dispatch = injectDispatch(shellEvents, { scope: 'global' });
}
```

### Pattern 7: DevTools Integration

```typescript
import { withDevtools } from '@angular-architects/ngrx-toolkit';

export const ProductsStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withEntities<Product>(),
  withProductsReducer(),
  withProductsEventHandlers(),
  withDevtools('ProductsStore') // Enables Redux DevTools inspection
);
```

## Breaking Changes and Gotchas

### Breaking Change: withEffects renamed to withEventHandlers (NgRx v21)

| Version | API Name | Status |
|---------|----------|--------|
| v19.2 | `withEffects` | Experimental (initial introduction) |
| v20 | `withEffects` | Experimental (enhanced DX) |
| v21 | `withEventHandlers` | **Stable** (renamed) |

**Reason:** Avoids confusion with Angular's `effect()` API from `@angular/core`. The NgRx team considered `withHandlers` as an alternative but chose `withEventHandlers` for clarity.

**Migration:**
- Automatic schematic: `ng update @ngrx/signals@21` handles the rename
- PR: [ngrx/platform#5009](https://github.com/ngrx/platform/pull/5009)
- Issue: [ngrx/platform#4976](https://github.com/ngrx/platform/issues/4976)

### Events Plugin Stability Timeline

| Version | Status |
|---------|--------|
| v19.2 | Experimental (initial release) |
| v20 | Experimental (improved DX) |
| v21 | **Stable** (production-ready, API cleaned up) |

### Gotcha: No Event Buffering/Replay

Events use an RxJS Subject internally. If no subscriber is listening when an event fires, it is lost. There is no buffering or replay. This means:
- Effects must be set up before events are dispatched
- Store initialization order matters
- Late subscribers won't receive past events

### Gotcha: Error Handling in Event Handlers

If an Observable in `withEventHandlers` throws without error handling, the stream closes permanently. Subsequent events of that type will never trigger the handler again. Always use `catchError` or `mapResponse` from `@ngrx/operators`.

### Gotcha: Provider Scope Mismatches

- `providedIn: 'root'` creates a singleton. All components share the same state.
- `providers: [Store]` at component level creates a new instance per component. If you expect shared state but provide at component level, each component gets its own isolated copy.

### Gotcha: Mixing Methods and Events

Avoid mixing `withMethods` direct state mutations and `withReducer` event-driven updates in the same store for the same state slice. Choose one pattern per store to maintain predictability.

### Gotcha: Scoped Event Leakage

In micro-frontend scenarios, if `provideDispatcher()` is not configured at the remote entry, events may leak to the shell's global scope. Always explicitly set up dispatcher scope boundaries.

## Sources

### Official Documentation
- [NgRx Guide: SignalStore Events](https://ngrx.io/guide/signals/signal-store/events)
- [NgRx API: @ngrx/signals/events](https://ngrx.io/api/signals/events)
- [NgRx Migration Guide v21](https://ngrx.io/guide/migration/v21)

### Official Announcements
- [Announcing NgRx v20: The Power of Events](https://dev.to/ngrx/announcing-ngrx-v20-the-power-of-events-enhanced-dx-and-a-mature-signalstore-2fdm)
- [Announcing NgRx 21](https://dev.to/ngrx/announcing-ngrx-21-celebrating-a-10-year-journey-with-a-fresh-new-look-and-ngrxsignalsevents-5ekp)
- [Announcing Events Plugin for NgRx SignalStore](https://dev.to/ngrx/announcing-events-plugin-for-ngrx-signalstore-a-modern-take-on-flux-architecture-4dhn)

### Community Articles
- [Angular Architects: The New Event API in NgRx Signal Store](https://www.angulararchitects.io/blog/the-new-event-api-in-ngrx-signal-store/)
- [Angular Architects: The New Event API -- A Quantum of Redux](https://www.angulararchitects.io/blog/the-new-event-api-for-the-ngrx-signal-store-a-quantum-of-redux/)
- [Dimeloper: Event-Driven State Management with NgRx Signal Store](https://dev.to/dimeloper/event-driven-state-management-with-ngrx-signal-store-j8i)
- [Arcadio Quintero: NgRx SignalStore Events Plugin](https://arcadioquintero.com/en/blog/ngrx-signalstore-events-plugin/)
- [Dusko Peric: NgRx Signal Store Event API](https://dev.to/duskoperic/ngrx-signal-store-event-api-a-modern-take-on-event-driven-architecture-189m)

### GitHub References
- [RFC: Events Plugin (#4580)](https://github.com/ngrx/platform/issues/4580)
- [RFC: Reactivity Layer (#4408)](https://github.com/ngrx/platform/issues/4408)
- [Rename withEffects to withEventHandlers (#4976)](https://github.com/ngrx/platform/issues/4976)
- [Migration schematic (#5010)](https://github.com/ngrx/platform/issues/5010)
- [PR: feat(signals): rename withEffects to withEventHandlers (#5009)](https://github.com/ngrx/platform/pull/5009)
- [Support array of observables from withEventHandlers (#5000)](https://github.com/ngrx/platform/issues/5000)
- [Events prototype repo](https://github.com/markostanimirovic/ngrx-signals-events-prototype)

### Other Resources
- [egghead.io: Provide SignalStore at Different Scopes](https://egghead.io/lessons/angular-provide-the-ngrx-signal-store-within-a-component-a-route-or-globally)

## Open Questions

1. **Exact `provideDispatcher` API in v21:** The scoped events feature uses `provideDispatcher()` and `injectDispatch(..., { scope })`. The exact configuration options and how `provideDispatcher` interacts with Angular's injector hierarchy need verification against the installed v21.1.0 package source code before writing. The blog posts show slightly different APIs across versions.

2. **Array of observables from withEventHandlers:** Issue #5000 discusses support for returning an array of observables from `withEventHandlers`. Verify whether this landed in v21.0 or v21.1.

3. **type<void>() vs emptyProps():** Earlier research mentions `emptyProps()` as an alternative to `type<void>()` for events without payloads. Verify which one is the canonical API in v21 -- the Angular Architects blog uses `type<void>()` while some community posts reference `emptyProps()`.

4. **Events service injection pattern in v21:** Verify whether `inject(Events)` is still the pattern for accessing the event stream inside `withEventHandlers`, or if the store parameter provides it directly in v21.

5. **Dispatcher vs injectDispatch:** Clarify when to use `inject(Dispatcher)` (the service) vs `injectDispatch()` (the convenience function). The blogs show both patterns but the distinction in v21 needs verification.
