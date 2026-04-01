# Research: Lifecycle, Hooks, and Props (withHooks, withProps)

**Date:** 2026-03-31
**Chapter:** Ch 17
**Status:** Ready for chapter generation

## API Surface

### `withHooks` -- Stable (since NgRx 17)

- **Import path:** `@ngrx/signals`
- **Two overloads:**

```typescript
// Overload 1: Object form (shorthand)
withHooks(hooks: {
  onInit?: (store: Store) => void;
  onDestroy?: (store: Store) => void;
}): SignalStoreFeature

// Overload 2: Factory function form
withHooks(
  hooksFactory: (store: Store) => {
    onInit?: () => void;
    onDestroy?: () => void;
  }
): SignalStoreFeature
```

- **Key difference between overloads:**
  - Object form: `onInit` and `onDestroy` receive the store as a parameter
  - Factory form: the factory receives the store; `onInit`/`onDestroy` use closure access (no parameter)
  - Factory form runs within injection context, enabling `inject()` calls before returning hooks
  - Object form also runs in injection context (the entire `withHooks` call does)

- **Stability:** Stable
- **Lifecycle behavior:**
  - `onInit` fires when the store is first instantiated (when Angular's DI creates the instance)
  - `onDestroy` fires when the store's injector is destroyed
  - For `providedIn: 'root'` stores: `onInit` fires once at app startup, `onDestroy` fires at app teardown
  - For component-level stores: `onInit` fires when component is created, `onDestroy` fires when component is destroyed
  - Multiple `withHooks` calls are allowed; hooks are chained (all `onInit` run in order, all `onDestroy` run in order)

### `withProps` -- Stable (since NgRx 19)

- **Import path:** `@ngrx/signals`
- **Two overloads:**

```typescript
// Overload 1: Static object (no access to existing store)
withProps<Props extends object>(props: Props): SignalStoreFeature

// Overload 2: Factory function (access to existing store members)
withProps<Props extends object>(
  propsFactory: (store: Store) => Props
): SignalStoreFeature
```

- **Stability:** Stable
- **Key characteristics:**
  - Properties added by `withProps` are NOT reactive signals (unlike `withState`)
  - Properties are NOT frozen by Angular's dev mode `Object.freeze` (unlike `withState` in v19+)
  - Prefixing property names with `_` makes them private (not exposed on the store's public API)
  - `withComputed`, `withMethods`, and `withHooks` can all access properties defined by `withProps`
  - Multiple `withProps` calls can be chained; later ones access earlier props
  - Factory runs within injection context, so `inject()` works

## Key Concepts

- **withHooks provides lifecycle management** for SignalStore: `onInit` for initialization logic (data loading, subscriptions) and `onDestroy` for cleanup (logging, teardown)
- **withProps fills the gap** between state (reactive, frozen), computed (derived, reactive), and methods (actions). It handles: injected services, observables, resources, static configuration, and any non-reactive property
- **Injection context**: Both `withHooks` and `withProps` run within Angular's injection context, enabling `inject()` for DI. This is a core design principle of SignalStore features
- **Feature ordering matters**: `withHooks` can only access members defined by features declared BEFORE it. If `onInit` calls a method from `withMethods`, that `withMethods` must appear before `withHooks`
- **Private properties convention**: Properties prefixed with `_` in `withProps` are excluded from the store's public API, creating a clean encapsulation pattern for internal dependencies
- **Store provision scope affects lifecycle**: Root-provided stores are singletons with app-level lifecycle; component-provided stores have per-instance lifecycle tied to the component
- **withProps + Resource API pattern**: `withProps` is the recommended way to hold `resource()`, `rxResource()`, or `httpResource()` instances in a store, since resources are not simple state values

## Code Patterns

### Pattern 1: Basic withHooks -- Object Form

```typescript
// src/app/stores/todo.store.ts
import { signalStore, withState, withMethods, withHooks } from '@ngrx/signals';
import { patchState } from '@ngrx/signals';
import { inject } from '@angular/core';
import { TodoService } from '../services/todo.service';

export const TodoStore = signalStore(
  { providedIn: 'root' },
  withState({ todos: [] as Todo[], loading: false }),
  withMethods((store) => {
    const todoService = inject(TodoService);
    return {
      async loadTodos() {
        patchState(store, { loading: true });
        const todos = await todoService.getAll();
        patchState(store, { todos, loading: false });
      },
    };
  }),
  withHooks({
    onInit(store) {
      store.loadTodos();
    },
    onDestroy(store) {
      console.log('TodoStore destroyed');
    },
  })
);
```

### Pattern 2: withHooks -- Factory Form with Injection Context

```typescript
// src/app/stores/notification.store.ts
import { signalStore, withState, withMethods, withHooks } from '@ngrx/signals';
import { inject } from '@angular/core';
import { interval } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

export const NotificationStore = signalStore(
  withState({ count: 0 }),
  withMethods((store) => ({
    increment() {
      patchState(store, { count: store.count() + 1 });
    },
  })),
  withHooks((store) => {
    // Injection context is available here
    const destroyRef = inject(DestroyRef);

    return {
      onInit() {
        // Set up a subscription that auto-cleans on destroy
        interval(5000)
          .pipe(takeUntilDestroyed(destroyRef))
          .subscribe(() => store.increment());
      },
      onDestroy() {
        console.log('Final count:', store.count());
      },
    };
  })
);
```

### Pattern 3: withProps for Dependency Injection

```typescript
// src/app/stores/customer.store.ts
import { signalStore, withState, withProps, withMethods, withHooks } from '@ngrx/signals';
import { inject } from '@angular/core';

export const CustomerStore = signalStore(
  withState({ customers: [] as Customer[], filter: '' }),
  withProps(() => ({
    _customerService: inject(CustomerService),
    _snackBar: inject(SnackBarService),
    _logger: inject(LoggerService),
  })),
  withMethods(({ _customerService, _snackBar, ...store }) => ({
    async loadCustomers() {
      const customers = await _customerService.getAll();
      patchState(store, { customers });
    },
    async deleteCustomer(id: string) {
      await _customerService.delete(id);
      _snackBar.open('Customer deleted');
    },
  })),
  withHooks(({ loadCustomers, _logger }) => ({
    onInit() {
      _logger.log('CustomerStore initialized');
      loadCustomers();
    },
  }))
);
```

### Pattern 4: withProps for Observables (toObservable bridge)

```typescript
// src/app/stores/search.store.ts
import { signalStore, withState, withProps, withMethods } from '@ngrx/signals';
import { toObservable } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged } from 'rxjs';

export const SearchStore = signalStore(
  withState({ query: '' }),
  withProps(({ query }) => ({
    query$: toObservable(query).pipe(
      debounceTime(300),
      distinctUntilChanged()
    ),
  })),
  withMethods((store) => ({
    // Methods can subscribe to query$ for debounced search
  }))
);
```

### Pattern 5: withProps for Resource API Integration

```typescript
// src/app/stores/dessert.store.ts
import { signalStore, withState, withProps, withComputed, withMethods } from '@ngrx/signals';
import { inject } from '@angular/core';
import { resource } from '@angular/core';

export const DessertStore = signalStore(
  withState({ filter: '' }),
  withProps(() => ({
    _dessertService: inject(DessertService),
  })),
  withProps((store) => ({
    _dessertsResource: resource({
      params: () => ({ filter: store.filter() }),
      loader: async ({ params }) => {
        return store._dessertService.findAll(params.filter);
      },
    }),
  })),
  withProps((store) => ({
    dessertsResource: store._dessertsResource.asReadonly(),
  })),
  withComputed((store) => ({
    desserts: () => store._dessertsResource.value() ?? [],
    isLoading: () => store._dessertsResource.isLoading(),
  }))
);
```

### Pattern 6: Grouped Dependencies with _deps Pattern

```typescript
// src/app/stores/order.store.ts
import { signalStore, withState, withProps, withMethods } from '@ngrx/signals';
import { inject } from '@angular/core';

export const OrderStore = signalStore(
  withState({ orders: [] as Order[] }),
  withProps(() => ({
    _deps: {
      orderService: inject(OrderService),
      paymentService: inject(PaymentService),
      notificationService: inject(NotificationService),
      logger: inject(LoggerService),
    },
  })),
  withMethods(({ _deps, ...store }) => ({
    async placeOrder(order: Order) {
      await _deps.paymentService.charge(order);
      await _deps.orderService.save(order);
      _deps.notificationService.success('Order placed!');
      _deps.logger.info('Order placed', order.id);
    },
  }))
);
```

### Pattern 7: Multiple withHooks Chaining

```typescript
// Multiple withHooks calls are merged, not overwritten
const MyStore = signalStore(
  withState({ data: [] }),
  withHooks({
    onInit(store) {
      console.log('First onInit');
    },
  }),
  withHooks({
    onInit(store) {
      console.log('Second onInit'); // Both run, in order
    },
  })
);
```

## Breaking Changes and Gotchas

### withState Freezing in v19+ (affects withProps migration)
- NgRx v19 introduced recursive `Object.freeze` on `withState` values in development mode
- Mutable objects (e.g., `FormGroup`, DOM references, third-party class instances) must move from `withState` to `withProps`
- `withProps` values are NOT frozen, so they can hold mutable objects safely

### Feature Ordering is Critical
- `withHooks` can only access store members defined by features BEFORE it in the `signalStore()` call
- If `onInit` calls `loadData()`, the `withMethods` defining `loadData` must come before `withHooks`
- Same applies to `withProps`: later features can access props, but props cannot access later features

### Unintentional Property Overriding
- If `withProps` defines a property with the same name as an existing state slice, computed, or method, it will override it
- NgRx shows a development-mode warning when this happens
- Use unique, descriptive names; use `_` prefix for private dependencies

### onDestroy Does NOT Have Direct Injection Context
- While the `withHooks` factory function runs in injection context (allowing `inject()` before returning hooks), the `onDestroy` callback itself runs outside injection context
- Use the factory form to capture injected services in closure scope, then use them in `onDestroy`
- This was resolved in PR #4208 by switching to factory form where DI is in the outer scope

### Store Lifecycle Depends on Provision Scope
- `providedIn: 'root'`: store is a singleton, `onInit` fires once at app boot, `onDestroy` at app teardown
- Component-level `providers: [MyStore]`: `onInit` fires per component instance, `onDestroy` when component is destroyed
- Testing implication: `onInit` always fires on instantiation, which can trigger unintended side effects in tests

### withProps Values Are Not Tracked by Change Detection
- Unlike `withState` (signals) or `withComputed` (computed signals), `withProps` values are plain objects
- Changing a property on a `withProps` object does NOT trigger change detection or re-render
- Use `withProps` for static dependencies and configuration, not for reactive state

### withProps Object Form Has No Store Access
- `withProps({ key: value })` (object literal, not factory) does NOT receive the store
- Only `withProps((store) => ({ ... }))` (factory form) can access existing store members
- Use the object form only for static values that don't depend on other store features

## Sources

### Official Documentation
- [NgRx SignalStore Guide](https://ngrx.io/guide/signals/signal-store)
- [NgRx Lifecycle Hooks Guide](https://ngrx.io/guide/signals/signal-store/lifecycle-hooks)
- [withHooks API Reference](https://ngrx.io/api/signals/withHooks)
- [withProps API Reference](https://ngrx.io/api/signals/withProps)
- [Custom Store Features Guide](https://ngrx.io/guide/signals/signal-store/custom-store-features)

### Blog Posts and Articles
- [NgRx SignalStore: withProps -- Wojciech Trawinski](https://medium.com/javascript-everyday/ngrx-signalstore-withprops-f17eb1a89da8)
- [The new NGRX Signal Store for Angular: 3+1 Flavors -- Angular Architects](https://www.angulararchitects.io/blog/the-new-ngrx-signal-store-for-angular-2-1-flavors/)
- [Using Angular's Resource API with the NGRX Signal Store -- Angular Architects](https://www.angulararchitects.io/blog/using-the-resource-api-with-the-ngrx-signal-store/)
- [All you need to know to get started with the NgRx Signal Store -- Stefanos Lignos](https://www.stefanos-lignos.dev/posts/ngrx-signals-store)
- [Announcing NgRx 19 -- NgRx Team](https://dev.to/ngrx/announcing-ngrx-19-ngrx-signals-features-action-signals-and-more-2b35)
- [Configure lifecycle hooks for an NGRX Signal Store using withHooks -- egghead.io](https://egghead.io/lessons/angular-configure-lifecycle-hooks-for-an-ngrx-signal-store-using-withhooks)

### GitHub Issues and RFCs
- [RFC: Add withProps feature -- Issue #4504](https://github.com/ngrx/platform/issues/4504)
- [Provide injection context to onDestroy -- Issue #4201](https://github.com/ngrx/platform/issues/4201)
- [SignalStore v19 Breaking Changes Discussion -- #4664](https://github.com/ngrx/platform/discussions/4664)
- [withProps PR #4607 (merged Nov 2024)](https://github.com/ngrx/platform/pull/4607)
- [withHooks injection context PR #4208](https://github.com/ngrx/platform/pull/4208)

### Source Code
- [withHooks source](https://github.com/ngrx/platform/blob/main/modules/signals/src/with-hooks.ts)
- [withProps source](https://github.com/ngrx/platform/blob/main/modules/signals/src/with-props.ts)

## Open Questions

1. **withProps and signalStoreFeature**: Need to verify exact behavior when `withProps` is used inside a `signalStoreFeature()` -- does the private `_` convention still apply when the feature is composed into a store? (Likely yes, but should verify against v21 source.)

2. **Multiple onInit ordering guarantee**: The source shows hooks are merged/chained, but verify whether this is a documented guarantee or an implementation detail that could change.

3. **withProps + resource() stability**: The `resource()` API is experimental in Angular 21. While using it inside `withProps` works, the overall pattern may shift as `resource()` stabilizes. An RFC for a dedicated `withResource` feature exists (Issue #4833) but has not been merged as of this research date.

4. **linkedSignal inside withProps**: While `linkedSignal` can technically be placed in `withProps`, it may be more appropriate in `withComputed` or `withState` depending on reactivity needs. Needs clarification on best practice for v21.
