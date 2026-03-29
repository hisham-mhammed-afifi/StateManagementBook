# Research: The Mental Model

**Date:** 2026-03-28
**Chapter:** Ch 2
**Status:** Ready for chapter generation

> **Builds on Chapter 1:** This chapter assumes the reader knows `signal()`, `computed()`, and basic services from Chapter 1. Code patterns here use these APIs without re-explaining them. The writable-inside/read-only-outside service pattern from Chapter 1's ThemeService is revisited as a formal UDF pattern.

## API Surface

This is a principles chapter. APIs appear in the context of enforcing mental model rules, not as primary teaching targets.

| API | Import Path | Stability | Chapter 2 Context |
|-----|-------------|-----------|-------------------|
| `signal()` with `equal` option | `@angular/core` | Stable | Custom equality for immutability-aware signals |
| `computed()` | `@angular/core` | Stable | SSOT enforcement (deeper than Ch1; the primary tool for derived state) |
| `linkedSignal()` | `@angular/core` | Stable (Angular 21) | Writable dependent state that respects SSOT |
| `.asReadonly()` | Method on `WritableSignal` | Stable | Preventing unauthorized external mutations; UDF enforcement |
| `patchState()` | `@ngrx/signals` | Stable | Immutable updates in SignalStore |
| `createReducer()` / `on()` | `@ngrx/store` | Stable | Immutable state transitions in Classic NgRx (teaser) |
| `createSelector()` | `@ngrx/store` | Stable | SSOT read layer in Classic NgRx (teaser) |
| Runtime checks config | `@ngrx/store` | Stable | `strictStateImmutability`, `strictActionImmutability` |
| `Object.freeze()` | Built-in JS | N/A | Development-time shallow immutability enforcement |
| `structuredClone()` | Built-in JS | N/A | Deep cloning for immutable snapshot operations |
| `output()` | `@angular/core` | Stable | Child-to-parent event emission in UDF |
| `input()` | `@angular/core` | Stable | Parent-to-child data binding in UDF |

## Key Concepts

### 1. Unidirectional Data Flow (UDF)

**Definition:** Data flows in one predictable direction: from state to the UI. Users cannot directly modify application data through the UI; changes flow through a controlled process (event handler, action dispatch, service method call) before becoming new state.

**Angular's Enforcement Mechanism:**
- Change detection runs top-down: parent components are checked before children
- In development mode, Angular performs a second verification pass to catch violations
- If an expression's value changes between the two passes, Angular throws `ExpressionChangedAfterItHasBeenCheckedError` (NG0100)
- This error still exists in zoneless Angular 21 and is actually more visible without Zone.js's implicit retry mechanisms
- Performance benefit: application state stabilizes after a single pass of change detection

**The Signal Graph as UDF:**
- Producer signals (`signal()`) push changes to consumer signals (`computed()`, `effect()`)
- Dependencies are explicit and tracked automatically
- No implicit global change detection cycles (unlike zone.js model)
- Angular 21's push-based reactivity makes data flow direction visible in the code

**NgRx Classic UDF Cycle:**
```
Component dispatches Action
  -> Reducer (pure function) produces new State
    -> Store holds the single state tree
      -> Selector extracts a slice
        -> Component reads via Observable/Signal
          -> User interacts -> Component dispatches Action (cycle repeats)
```

**NgRx SignalStore UDF Cycle:**
```
Component calls store method
  -> Store method executes sync/async task
    -> patchState() creates new state
      -> Signals propagate to computed values
        -> View reflects new state
          -> User interacts -> Component calls store method (cycle repeats)
```

**Two-Way Binding as Controlled Exception:**
- `ngModel` and `model()` provide syntactic sugar for two-way binding
- Under the hood, they are still input + output (data down, events up)
- Not a UDF violation when used correctly; the component still owns the state
- Excessive use can mask data flow and cause performance issues; modern Angular prefers explicit patterns

**Writable-Inside, Read-Only-Outside Pattern:**
- Services expose private writable signals as public read-only via `asReadonly()`
- Components call service methods for state changes; they cannot `.set()` or `.update()` the signal directly
- This guarantees controlled state mutations and a single entry point for changes

**Expert Consensus (Manfred Steyer, Angular Architects):**
- Signals are the modern vehicle for implementing UDF, not an alternative to it
- RxJS handles async event streams; Signals handle synchronous state transport to views
- The combination of both creates a robust UDF architecture

### 2. Immutability

**Definition:** Once a value is created, it is never changed in place. Instead, a new value is produced with the desired changes. The original remains untouched.

**Why Signals Need Immutability:**
- Signals use referential equality (`Object.is()`) by default to determine whether to notify consumers
- If you mutate an object or array in place, the reference stays the same
- The signal does not detect any change; consumers (templates, `computed()`, `effect()`) are never notified
- This is the most common source of "my UI won't update" bugs in Angular signals

**The Mutation Bug (Arrays):**
- `.push()`, `.splice()`, `.sort()` (in-place) mutate the array without changing its reference
- Signal detects no change; template does not re-render
- Fix: use `.update(arr => [...arr, newItem])` to create a new array reference

**The Mutation Bug (Objects):**
- Direct property assignment (`user().name = 'Jane'`) mutates the object without changing its reference
- Fix: use `.update(u => ({ ...u, name: 'Jane' }))` to create a new object reference

**TypeScript Compile-Time Enforcement:**
- `readonly` modifier on interface properties prevents reassignment at compile time
- `Readonly<T>` utility type makes all properties readonly (shallow)
- `ReadonlyArray<T>` or `readonly T[]` prevents array mutation methods (`.push()`, `.splice()`)
- `as const` makes all properties readonly with literal types (recursive)
- None of these enforce immutability at runtime; they are compile-time-only guards
- `DeepReadonly<T>` can be defined as a custom recursive mapped type for nested readonly enforcement

**Runtime Enforcement:**
- `Object.freeze()`: prevents property addition, removal, and modification, but is shallow only; nested objects remain mutable
- `structuredClone()`: creates a deep copy (handles Map, Set, Date, RegExp, typed arrays); useful for snapshot operations; cannot clone functions or DOM nodes

**NgRx Classic Store Enforcement:**
- `strictStateImmutability: true`: throws if state is mutated directly (enabled by default in dev mode since NgRx 9)
- `strictActionImmutability: true`: throws if actions are mutated after dispatch (enabled by default in dev mode since NgRx 9)
- `ngrx-store-freeze` meta-reducer: recursively freezes state, actions, and new state; now largely superseded by built-in runtime checks
- Reducers are pure functions: `(state, action) => newState`; they must always return new references, never mutate inputs

**NgRx SignalStore Enforcement:**
- `patchState()` is the primary update mechanism; it creates new references via spread (`...nextState`) internally
- `patchState()` performs shallow spread: the caller must still create new references for nested properties
- For deeply nested state, combine `patchState()` with Immer.js's `produce()` for ergonomic mutable-syntax-but-immutable-result updates

**Custom Equality Functions:**
- `signal(initialValue, { equal: (a, b) => ... })` overrides the default `Object.is()` comparison
- `computed(() => ..., { equal: (a, b) => ... })` also supports custom equality
- Use case: domain-specific equality (e.g., `(a, b) => a.id === b.id`) to avoid unnecessary re-renders when only irrelevant properties change
- Important caveat: Angular ignores the custom equality function if the object reference is the same; custom equality only applies when the reference changes

**Immer.js (Mention, Not Deep Dive):**
- `produce(currentState, draft => { draft.nested.prop = 'new' })` returns a new immutable object
- The draft is a Proxy; mutations are tracked and converted to immutable updates
- Structural sharing: unchanged branches keep their original references
- Useful for complex reducers and `patchState` with deeply nested state
- Not required for most Angular state management; spread operators handle the majority of cases

### 3. Single Source of Truth (SSOT)

**Definition:** Every piece of application data should exist in exactly one authoritative location. All other representations of that data are derived from the source, never stored independently.

**computed() as SSOT Enforcer:**
- `computed()` creates a read-only signal that derives its value from other signals
- There is no way for a `computed` to become stale: it recomputes automatically when dependencies change
- It stores no independent copy of the data; it is a live transformation of the source
- Rule from Chapter 1 (reinforced): if a value can be calculated from other state, use `computed()`, never a writable `signal()`

**linkedSignal() for Writable Dependent State:**
- `linkedSignal()` creates a signal linked to source signals; unlike `computed()`, it is writable (can be manually overridden via `.set()` or `.update()`)
- Automatically resets to the computation result when the source signal changes
- Replaces awkward `effect()`-based state synchronization
- Two calling conventions: shorthand (computation function) and options-object (`{ source, computation }`)
- Use case: page number resets to 1 when the search query changes, but the user can manually navigate to other pages
- Use sparingly; the Angular team warns that writable dependent state is less declarative and less safe than pure derivation

**Service Pattern as SSOT:**
- One service owns one domain's state
- The service exposes read-only signals via `asReadonly()`
- Components never store their own copy of domain data
- All mutations go through service methods, ensuring a single entry point

**NgRx Classic Store as SSOT:**
- The Store is the single source of truth for global application state
- Selectors are the read layer: pure functions that extract and transform state slices
- `createSelector()` provides memoization: computations only run when inputs change
- Components must never read state directly from the Store object; they must always go through selectors
- This ensures that state structure changes are isolated from component logic

**NgRx SignalStore as SSOT:**
- `withState()` defines the source data; automatically creates one signal per state property
- `withComputed()` defines derived data from state signals
- `withMethods()` provides the only way to modify state
- Can be scoped globally (`{ providedIn: 'root' }`) or locally (provided in a route/component)
- Each SignalStore is a self-contained SSOT for its domain

**Anti-Patterns:**
1. **Entity duplication**: Storing a `selectedProduct` object alongside a `products` array. When the product updates in one place but not the other, the UI shows stale data. Fix: store only `selectedProductId` and derive the selected product with `computed()`.
2. **Implicit state duplication**: Keeping a `totalItems` counter separate from the items array. Fix: derive with `computed(() => items().length)`.
3. **Effect-based state synchronization**: Using `effect()` to keep two signals in sync. Creates timing issues and hidden dependencies. Fix: use `computed()` or `linkedSignal()`.
4. **Multiple state management solutions without boundaries**: Using NgRx, services, and component state for the same data without clear ownership rules.

**Tiered Approach (Community Consensus):**
- **Tier 1 (Local)**: `signal()` in a component for UI-only state (modal open, tooltip visible)
- **Tier 2 (Feature/Shared)**: Service with signals for feature-level data shared between components
- **Tier 3 (Global)**: NgRx SignalStore or Classic NgRx for application-wide state requiring DevTools, time-travel, or complex async flows
- Each tier is a single source of truth for its scope; data flows from higher tiers to lower tiers, never the reverse

**URL as SSOT:**
- Route and query parameters are the source of truth for navigation/view-configuration state
- Use for filters, sorting, pagination that should survive refresh and be shareable
- The URL should drive the store/service, not the other way around
- If the same data exists in both URL and a signal, the URL wins (it is the more durable source)

## Code Patterns

### Pattern 1: Parent-to-Child UDF with Signals

```typescript
// src/app/components/product-card.component.ts
import { Component, input, output } from '@angular/core';

interface Product {
  id: number;
  name: string;
  price: number;
}

@Component({
  selector: 'app-product-card',
  template: `
    <div class="card">
      <h3>{{ product().name }}</h3>
      <p>{{ product().price | currency }}</p>
      <button (click)="addToCart.emit(product())">Add to Cart</button>
    </div>
  `,
})
export class ProductCardComponent {
  product = input.required<Product>();  // Data flows DOWN
  addToCart = output<Product>();         // Events flow UP
}
```

```typescript
// src/app/pages/product-list.component.ts
import { Component, signal } from '@angular/core';
import { ProductCardComponent } from '../components/product-card.component';

@Component({
  selector: 'app-product-list',
  imports: [ProductCardComponent],
  template: `
    @for (product of products(); track product.id) {
      <app-product-card
        [product]="product"
        (addToCart)="onAddToCart($event)"
      />
    }
    <p>Cart items: {{ cartCount() }}</p>
  `,
})
export class ProductListComponent {
  products = signal([
    { id: 1, name: 'Laptop', price: 999 },
    { id: 2, name: 'Mouse', price: 29 },
  ]);

  cartCount = signal(0);

  onAddToCart(product: { id: number; name: string; price: number }) {
    this.cartCount.update(count => count + 1);
  }
}
```

### Pattern 2: Writable-Inside, Read-Only-Outside Service

```typescript
// src/app/services/notification.service.ts
import { Injectable, signal, computed } from '@angular/core';

interface Notification {
  id: number;
  message: string;
  read: boolean;
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private notifications = signal<Notification[]>([]);

  // Public read-only API: consumers cannot .set() or .update()
  all = this.notifications.asReadonly();
  unreadCount = computed(() =>
    this.notifications().filter(n => !n.read).length
  );

  add(message: string) {
    this.notifications.update(list => [
      ...list,
      { id: Date.now(), message, read: false },
    ]);
  }

  markAsRead(id: number) {
    this.notifications.update(list =>
      list.map(n => (n.id === id ? { ...n, read: true } : n))
    );
  }
}
```

### Pattern 3: NgRx Classic Store UDF Cycle (Teaser)

```typescript
// src/app/state/counter.actions.ts
import { createActionGroup, emptyProps } from '@ngrx/store';

export const CounterActions = createActionGroup({
  source: 'Counter',
  events: {
    Increment: emptyProps(),
    Decrement: emptyProps(),
    Reset: emptyProps(),
  },
});
```

```typescript
// src/app/state/counter.reducer.ts
import { createReducer, on } from '@ngrx/store';
import { CounterActions } from './counter.actions';

export interface CounterState {
  value: number;
}

const initialState: CounterState = { value: 0 };

export const counterReducer = createReducer(
  initialState,
  on(CounterActions.increment, (state) => ({ ...state, value: state.value + 1 })),
  on(CounterActions.decrement, (state) => ({ ...state, value: state.value - 1 })),
  on(CounterActions.reset, () => initialState)
);
// Every handler returns a NEW object. The original state is never mutated.
```

```typescript
// src/app/state/counter.selectors.ts
import { createFeatureSelector, createSelector } from '@ngrx/store';
import { CounterState } from './counter.reducer';

const selectCounterState = createFeatureSelector<CounterState>('counter');
export const selectCount = createSelector(selectCounterState, (state) => state.value);
export const selectIsPositive = createSelector(selectCount, (value) => value > 0);
```

```typescript
// src/app/components/counter.component.ts
import { Component, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { selectCount, selectIsPositive } from '../state/counter.selectors';
import { CounterActions } from '../state/counter.actions';

@Component({
  selector: 'app-counter',
  template: `
    <p>Count: {{ count() }}</p>
    @if (isPositive()) {
      <p>The count is positive.</p>
    }
    <button (click)="increment()">+</button>
    <button (click)="decrement()">-</button>
    <button (click)="reset()">Reset</button>
  `,
})
export class CounterComponent {
  private store = inject(Store);

  count = this.store.selectSignal(selectCount);
  isPositive = this.store.selectSignal(selectIsPositive);

  increment() { this.store.dispatch(CounterActions.increment()); }
  decrement() { this.store.dispatch(CounterActions.decrement()); }
  reset() { this.store.dispatch(CounterActions.reset()); }
}
```

### Pattern 4: NgRx SignalStore UDF Cycle (Teaser)

```typescript
// src/app/state/counter.store.ts
import { computed } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';

export const CounterStore = signalStore(
  withState({ count: 0 }),
  withComputed(({ count }) => ({
    isPositive: computed(() => count() > 0),
    doubleCount: computed(() => count() * 2),
  })),
  withMethods((store) => ({
    increment() { patchState(store, { count: store.count() + 1 }); },
    decrement() { patchState(store, { count: store.count() - 1 }); },
    reset() { patchState(store, { count: 0 }); },
  }))
);
```

```typescript
// src/app/components/counter.component.ts
import { Component, inject } from '@angular/core';
import { CounterStore } from '../state/counter.store';

@Component({
  selector: 'app-counter',
  providers: [CounterStore],
  template: `
    <p>Count: {{ store.count() }}</p>
    <p>Double: {{ store.doubleCount() }}</p>
    <button (click)="store.increment()">+</button>
    <button (click)="store.decrement()">-</button>
    <button (click)="store.reset()">Reset</button>
  `,
})
export class CounterComponent {
  store = inject(CounterStore);
}
```

### Pattern 5: The Mutation Bug (Array)

```typescript
// src/app/examples/mutation-bug.ts

// WRONG: mutating the array in place
import { signal } from '@angular/core';

const items = signal<string[]>(['Apple', 'Banana']);

// This adds 'Cherry' to the array, but the signal reference is unchanged.
// Templates, computed(), and effect() will NOT be notified.
items().push('Cherry');

// The array now contains ['Apple', 'Banana', 'Cherry'],
// but every consumer still sees the old value because
// Object.is(oldRef, newRef) returns true.
```

```typescript
// CORRECT: creating a new array reference
items.update(list => [...list, 'Cherry']);
// Object.is(oldRef, newRef) returns false. Consumers are notified.
```

### Pattern 6: The Mutation Bug (Object)

```typescript
// src/app/examples/mutation-bug-object.ts

// WRONG: mutating the object in place
import { signal } from '@angular/core';

interface User {
  name: string;
  email: string;
}

const user = signal<User>({ name: 'Alice', email: 'alice@example.com' });

// Direct mutation: the reference does not change.
user().name = 'Bob';
// The signal still holds the same object reference.
// Consumers are NOT notified.
```

```typescript
// CORRECT: creating a new object reference
user.update(u => ({ ...u, name: 'Bob' }));
// New reference created. Consumers are notified.
```

### Pattern 7: Custom Equality Function

```typescript
// src/app/examples/custom-equality.ts
import { signal, computed } from '@angular/core';

interface Product {
  id: number;
  name: string;
  price: number;
  lastUpdated: string; // changes on every API response
}

// Default behavior: any new object triggers update, even if meaningful data is the same.
// Custom equality: only trigger when id, name, or price change.
const selectedProduct = signal<Product>(
  { id: 1, name: 'Laptop', price: 999, lastUpdated: '2026-03-28T10:00:00Z' },
  {
    equal: (a, b) => a.id === b.id && a.name === b.name && a.price === b.price,
  }
);

// This will NOT trigger an update because id, name, and price are the same.
selectedProduct.set({
  id: 1, name: 'Laptop', price: 999, lastUpdated: '2026-03-28T11:00:00Z',
});

// This WILL trigger an update because the price changed.
selectedProduct.set({
  id: 1, name: 'Laptop', price: 899, lastUpdated: '2026-03-28T12:00:00Z',
});
```

### Pattern 8: Entity Duplication Anti-Pattern (SSOT)

```typescript
// src/app/examples/entity-duplication.ts

// WRONG: duplicating the selected product
import { signal } from '@angular/core';

interface Product {
  id: number;
  name: string;
  price: number;
}

const products = signal<Product[]>([
  { id: 1, name: 'Laptop', price: 999 },
  { id: 2, name: 'Mouse', price: 29 },
]);

// BUG: selectedProduct is a COPY. When products updates, selectedProduct is stale.
const selectedProduct = signal<Product | null>(null);
// Somewhere: selectedProduct.set(products()[0]);
// Later: products change from an API refresh, but selectedProduct still holds the old copy.
```

```typescript
// CORRECT: store only the ID, derive the product
import { signal, computed } from '@angular/core';

const products = signal<Product[]>([
  { id: 1, name: 'Laptop', price: 999 },
  { id: 2, name: 'Mouse', price: 29 },
]);

const selectedProductId = signal<number | null>(1);

const selectedProduct = computed(() => {
  const id = selectedProductId();
  if (id === null) return null;
  return products().find(p => p.id === id) ?? null;
});
// selectedProduct always reflects the current products array. No stale copies.
```

### Pattern 9: linkedSignal for Resettable Dependent State

```typescript
// src/app/examples/linked-signal-pagination.ts
import { signal, linkedSignal } from '@angular/core';

const searchQuery = signal('');

// When searchQuery changes, currentPage automatically resets to 1.
// But the user can still manually navigate to other pages.
const currentPage = linkedSignal({
  source: searchQuery,
  computation: () => 1,
});

// User types a new query:
searchQuery.set('laptop');
console.log(currentPage()); // 1 (auto-reset)

// User navigates to page 3:
currentPage.set(3);
console.log(currentPage()); // 3

// User types a different query:
searchQuery.set('mouse');
console.log(currentPage()); // 1 (auto-reset again)
```

### Pattern 10: TypeScript Readonly Enforcement

```typescript
// src/app/models/app-state.model.ts

// Compile-time immutability for state interfaces
export interface AppState {
  readonly users: readonly User[];
  readonly selectedUserId: number | null;
  readonly loading: boolean;
}

export interface User {
  readonly id: number;
  readonly name: string;
  readonly email: string;
}

// TypeScript prevents accidental mutations:
// state.loading = false;          // Error: Cannot assign to 'loading'
// state.users.push(newUser);      // Error: Property 'push' does not exist on type 'readonly User[]'
// state.users[0].name = 'Bob';    // Error: Cannot assign to 'name'
```

## Breaking Changes and Gotchas

- **Angular 21 is zoneless by default.** Do not reference `provideZoneChangeDetection()` or `zone.js`. The `ExpressionChangedAfterItHasBeenCheckedError` (NG0100) still fires in dev mode as a UDF guardrail.
- **`OnPush` is effectively the default behavior** in zoneless mode. Do not prescribe it as an optimization step in Chapter 2.
- **`linkedSignal()` is stable in Angular 21.** It was developer preview in Angular 19. No need for an experimental API label.
- **`ngrx-store-freeze` is largely superseded** by NgRx's built-in `strictStateImmutability` and `strictActionImmutability` runtime checks (enabled by default since NgRx 9 in dev mode). Mention it for historical context only.
- **`patchState()` performs shallow spread.** It compares top-level keys with `!==`. If a state property is a nested object and only a nested field changes, the caller must create a new reference for the nested object. `patchState` will not detect nested mutations.
- **`Object.freeze()` is shallow.** Nested objects inside a frozen object remain mutable. For deep freeze, use a recursive utility or Immer's auto-freeze.
- **`structuredClone()` cannot clone functions, DOM nodes, or Symbols.** Suitable for data-only state snapshots.
- **Custom equality function caveat:** Angular ignores the custom `equal` function if the same reference is passed. The function is only invoked when a new reference is provided via `.set()` or `.update()`.
- **Two-way binding via `model()` is stable in Angular 21.** It is syntactic sugar for `input()` + `output()`, not a UDF violation. But the chapter should frame it as a controlled exception.

## Sources

### Official Documentation
- [Signals Overview - Angular](https://angular.dev/guide/signals)
- [Dependent state with linkedSignal - Angular](https://angular.dev/guide/signals/linked-signal)
- [Deriving state with computed signals - Angular](https://angular.dev/tutorials/signals/2-deriving-state-with-computed-signals)
- [Zoneless Angular Guide](https://angular.dev/guide/zoneless)
- [NG0100: ExpressionChangedAfterItHasBeenCheckedError](https://angular.dev/errors/NG0100)
- [Two-way binding - Angular](https://angular.dev/guide/templates/two-way-binding)
- [NgRx Runtime Checks](https://ngrx.io/guide/store/configuration/runtime-checks)
- [NgRx Selectors](https://ngrx.io/guide/store/selectors)
- [NgRx SignalStore](https://ngrx.io/guide/signals/signal-state)

### Expert Articles (Angular Architects, Push-Based, Angular Experts)
- [Skillfully Using Signals in Angular - Manfred Steyer (Angular Architects)](https://www.angulararchitects.io/blog/skillfully-using-signals-in-angular-selected-hints-for-professional-use/)
- [What's new in Angular 21? - Angular Architects](https://www.angulararchitects.io/blog/whats-new-in-angular-21-signal-forms-zone-less-vitest-angular-aria-cli-with-mcp-server/)
- [Signals in Angular: Building Blocks - Angular Architects](https://www.angulararchitects.io/en/blog/angular-signals/)
- [The new NgRx Signal Store for Angular - Angular Architects](https://www.angulararchitects.io/blog/the-new-ngrx-signal-store-for-angular-2-1-flavors/)
- [Stop Misusing Effects! Linked Signals Are the Better Alternative - Angular Experts](https://angularexperts.io/blog/stop-misusing-effects/)
- [Demystifying the push & pull nature of Angular Signals - Angular Experts](https://angularexperts.io/blog/angular-signals-push-pull/)
- [Angular Signal Forms Essentials - Kevin Kreuzer](https://kevinkreuzer.medium.com/angular-signal-forms-essentials-9a2822438607)
- [Migration to Signals, Signal Forms, Resource API, and NgRx Signal Store - Manfred Steyer (Speaker Deck, Angular Days 03/2026)](https://speakerdeck.com/manfredsteyer/2026-munich)

### Blog Posts and Community
- [Angular Development Mode: Unidirectional Data Flow - Angular University](https://blog.angular-university.io/angular-2-what-is-unidirectional-data-flow-development-mode/)
- [Running change detection in Angular - Unidirectional data flow - angular.love](https://angular.love/change-detection-big-picture-unidirectional-data-flow/)
- [What unidirectional data flow means in Angular - angular.love](https://angular.love/do-you-really-know-what-unidirectional-data-flow-means-in-angular/)
- [Immutability importance in Angular applications - angular.love](https://angular.love/immutability-importance-in-angular-applications/)
- [Angular linkedSignal: Missing Link in Signal Reactivity - Angular University](https://blog.angular-university.io/angular-linkedsignal/)
- [LinkedSignal in Angular 19: Say Goodbye to Effect-Based State Sync - codigotipado](https://www.codigotipado.com/p/linkedsignal-in-angular-19-say-goodbye)
- [Signals and Array Mutability in Angular 18 - Ben Nadel](https://www.bennadel.com/blog/4701-signals-and-array-mutability-in-angular-18.htm)
- [Angular 19 Signals: update() vs .push() - Why Immutability Matters - DEV Community](https://dev.to/cristiansifuentes/angular-19-signals-update-vs-push-why-immutability-matters-2ffg)
- [Optimizing Angular Signals with Smart Equality Checks - DEV Community](https://dev.to/romain_geffrault_10d88369/optimizing-angular-signals-with-smart-equality-checks-3ccf)
- [New Equality Check Function in Angular Signals - Medium](https://medium.com/@eugeniyoz/new-equality-check-function-in-angular-signals-03449c45a0a6)
- [The Angular Signals Revolution: Rethinking Reactivity - AppSignal](https://blog.appsignal.com/2025/09/17/the-angular-signals-revolution-rethinking-reactivity.html)
- [A New Reactive And Declarative Approach to Angular State Management - Modern Angular](https://modernangular.com/articles/state-management-with-rxjs-and-signals)
- [State Management Anti-Patterns - Source Allies](https://www.sourceallies.com/2020/11/state-management-anti-patterns/)
- [A Single Truth: Avoiding Duplicate State in NgRx - Riskified (Medium)](https://medium.com/riskified-technology/a-single-truth-avoiding-a-duplicate-state-in-ngrx-based-applications-5851e6328446)
- [Don't Sync State. Derive It! - Kent C. Dodds](https://kentcdodds.com/blog/dont-sync-state-derive-it)
- [Best Angular Signals Data Sharing Patterns (Zoneless) - DEV Community](https://dev.to/karol_modelski/best-angular-signals-data-sharing-patterns-zoneless-23n2)
- [Angular State Management for 2025 - Nx Blog](https://nx.dev/blog/angular-state-management-2025)
- [Best Practices for Angular State Management - DEV Community](https://dev.to/devin-rosario/best-practices-for-angular-state-management-2pm1)
- [Simplify NgRx Signal Store patchState with Immer - egghead.io](https://egghead.io/lessons/angular-simplify-ngrx-signal-store-advanced-patchstate-usecases-with-immer-immutable-utility)
- [Clean NgRx reducers using Immer - Tim Deschryver](https://timdeschryver.dev/blog/clean-ngrx-reducers-using-immer)
- [Using the URL as Single Source of Truth in Angular - Leonel Ngande](https://www.leonelngande.com/a-simple-example-of-using-the-url-as-the-single-source-of-truth-in-an-angular-application/)

### NgRx-Specific
- [Announcing NgRx Version 9: Immutability out of the box - Medium](https://medium.com/ngrx/announcing-ngrx-version-9-immutability-out-of-the-box-customizable-effects-and-more-e4cf71be1a5b)
- [ngrx-store-freeze - GitHub (Brandon Roberts)](https://github.com/brandonroberts/ngrx-store-freeze)
- [ngrx-immer - GitHub (Tim Deschryver)](https://github.com/timdeschryver/ngrx-immer)
- [Event-Driven State Management with NgRx Signal Store - DEV Community](https://dev.to/dimeloper/event-driven-state-management-with-ngrx-signal-store-j8i)
- [Unidirectional Data Flow in NgRx - Medium](https://medium.com/@louistrinh/unidirectional-data-flow-in-ngrx-94cdebfd778d)

## Open Questions

1. **`ExpressionChangedAfterItHasBeenCheckedError` in zoneless production builds.** In dev mode, Angular 21 performs a second change detection pass and throws NG0100 on violations. Need to verify whether this check is completely absent in production builds with zoneless, or merely suppressed. This affects how the chapter frames the error (dev-only guardrail vs. production concern).

2. **`linkedSignal()` shorthand vs options-object signatures.** The research confirms both forms exist (`linkedSignal(computation)` and `linkedSignal({ source, computation })`), but the exact TypeScript signatures (generics, overloads) should be verified against the Angular 21 source before writing example code.

3. **NgRx v21 runtime checks defaults.** Sources confirm `strictStateImmutability` and `strictActionImmutability` are true by default since NgRx 9 in dev mode. Need to verify whether NgRx 21's `provideStore()` still requires explicit `runtimeChecks` config or if these are automatically enabled without any config.

4. **`patchState()` source-level behavior.** The research says `patchState` uses shallow spread and compares top-level keys with `!==`. This should be verified by reading the actual `@ngrx/signals` v21 source to confirm the exact comparison strategy, especially for entity updates.

5. **Immer.js compatibility with `signal.update()`.** Can `produce()` be used directly inside `signal.update()`? Example: `items.update(produce(draft => { draft[0].name = 'New'; }))`. Need to verify there are no Proxy-vs-signal conflicts.

6. **`DeepReadonly<T>` utility type.** Not a built-in TypeScript type. The chapter needs to decide whether to define it inline, recommend a library, or simply mention the concept and point to Readonly<T> as sufficient for most cases.
