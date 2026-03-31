# Research: SignalStore Fundamentals

**Date:** 2026-03-31
**Chapter:** Ch 15
**Status:** Ready for chapter generation

## API Surface

### Core APIs from `@ngrx/signals` (v21.1.0)

| API | Import Path | Signature (simplified) | Stability |
|-----|------------|------------------------|-----------|
| `signalStore()` | `@ngrx/signals` | `signalStore(config?, ...features): Type<StoreMembers & StateSource>` | Stable |
| `withState()` | `@ngrx/signals` | `withState<State>(state: State \| (() => State)): SignalStoreFeature` | Stable |
| `withComputed()` | `@ngrx/signals` | `withComputed((store) => Record<string, Signal>): SignalStoreFeature` | Stable |
| `withMethods()` | `@ngrx/signals` | `withMethods((store) => MethodsDictionary): SignalStoreFeature` | Stable |
| `patchState()` | `@ngrx/signals` | `patchState<State>(stateSource: WritableStateSource<State>, ...updaters: Array<Partial<State> \| PartialStateUpdater<State>>): void` | Stable |
| `getState()` | `@ngrx/signals` | `getState<State>(stateSource: StateSource<State>): State` | Stable |
| `watchState()` | `@ngrx/signals` | `watchState<State>(stateSource: StateSource<State>, watcher: StateWatcher<State>, config?: { injector?: Injector }): EffectRef` | Stable |
| `signalState()` | `@ngrx/signals` | `signalState<State>(initialState: State): SignalState<State>` | Stable |
| `deepComputed()` | `@ngrx/signals` | `deepComputed<T extends object>(computation: () => T): DeepSignal<T>` | Stable |
| `signalMethod()` | `@ngrx/signals` | `signalMethod<Input>(processingFn: (value: Input) => void, config?): SignalMethod<Input>` | Stable |

### signalStore Configuration Options

Verified from the installed `@ngrx/signals` v21.1.0 type definitions (`ngrx-signals.d.ts`):

```typescript
type ProvidedInConfig = {
    providedIn?: 'root' | 'platform';
};

// signalStore has 3 sets of overloads:
// 1. No config (state protected by default, no providedIn)
// 2. Config with { providedIn, protectedState?: true } (default)
// 3. Config with { providedIn, protectedState: false } (returns WritableStateSource)
```

- `providedIn: 'root'` -- singleton in root injector
- `providedIn: 'platform'` -- shared across multiple Angular applications (micro-frontends)
- `protectedState: true` (default) -- `patchState` only callable inside store methods
- `protectedState: false` -- `patchState` callable from outside the store (returns `WritableStateSource`)

### signalStore Feature Overload Count

The type definitions support up to **15 features** per `signalStore()` call (verified: overloads go from F1 through F15 for each config variant). This is a TypeScript limitation, not a runtime one.

### DevTools Integration (Community)

| API | Import Path | Stability |
|-----|------------|-----------|
| `withDevtools()` | `@angular-architects/ngrx-toolkit` | Stable (community) |
| `updateState()` | `@angular-architects/ngrx-toolkit` | Stable (community) |
| `withMapper()` | `@angular-architects/ngrx-toolkit` | Stable (community) |
| `withGlitchTracking()` | `@angular-architects/ngrx-toolkit` | Stable (community) |
| `withDevtoolsStub()` | `@angular-architects/ngrx-toolkit` | Stable (community) |
| `renameDevtoolsName()` | `@angular-architects/ngrx-toolkit` | Stable (community) |

### Full Export List (verified from type definitions)

```typescript
export {
  deepComputed,
  getState,
  isWritableStateSource,
  patchState,
  signalMethod,
  signalState,
  signalStore,
  signalStoreFeature,
  type,
  watchState,
  withComputed,
  withFeature,
  withHooks,
  withLinkedState,
  withMethods,
  withProps,
  withState
};
```

## Key Concepts

### Core Mental Model
- SignalStore is a **functional, composable state container** built entirely on Angular Signals
- It generates an injectable Angular **class** (not an instance) via the `signalStore()` factory function
- Features are composed sequentially; each feature can access state/computed/methods from all preceding features
- State is reactive via **DeepSignals** (nested signal proxies created lazily on access)
- No direct dependency on RxJS (RxJS interop is opt-in via `@ngrx/signals/rxjs-interop`)

### The Builder Pattern
```
signalStore(
  config?,          // Optional: { providedIn, protectedState }
  withState(),      // 1. Define reactive state (DeepSignals)
  withComputed(),   // 2. Derive computed signals from state
  withMethods(),    // 3. Define operations (injection context available)
  withHooks()       // 4. Lifecycle hooks (onInit, onDestroy)
)
```

### DeepSignal Behavior
- `withState({ user: { name: 'John', age: 30 } })` creates:
  - `store.user()` -- `Signal<{ name: string; age: number }>`
  - `store.user.name()` -- `Signal<string>` (nested DeepSignal, lazily created)
  - `store.user.age()` -- `Signal<number>` (nested DeepSignal, lazily created)
- DeepSignals are **read-only** (no `set`/`update` methods)
- Only properties in the initial state get nested signals; dynamically added properties do not

### State Protection (protectedState)
- Default: `true` since NgRx v18
- When `true`: `patchState(store, ...)` only works inside `withMethods` (store is `WritableStateSource` inside, `StateSource` outside)
- When `false`: external code can call `patchState(store, ...)` directly
- Private members: prefix with `_` to hide from public API (uses `OmitPrivate<T>` type)

### Immutability Enforcement
- Since NgRx v19: state values are recursively `Object.freeze()`-d in dev mode
- Mutating state directly throws a runtime error
- This means mutable objects (e.g., `FormGroup`) should NOT be placed in `withState`; use `withProps` instead

### patchState Shallow Merge
- `patchState` performs **shallow merging** of top-level properties only
- Nested objects are **replaced entirely**, not merged
- For nested updates: manually spread, or use Immer's `produce()`
- Accepts partial state objects OR updater functions `(state) => Partial<State>`
- Multiple updaters can be passed in a single call

### Store Provisioning Scopes
| Scope | How | Lifetime |
|-------|-----|----------|
| Global (root) | `signalStore({ providedIn: 'root' }, ...)` | Application lifetime |
| Platform | `signalStore({ providedIn: 'platform' }, ...)` | Platform lifetime (multi-app) |
| Component | No `providedIn`; add to component `providers: [MyStore]` | Component lifetime |
| Route | No `providedIn`; add to route `providers: [MyStore]` | Route lifetime |

### withMethods Injection Context
- The factory function in `withMethods()` runs in an **injection context**
- `inject()` can be called directly inside the factory
- Services are commonly injected as default parameter values: `(store, http = inject(HttpClient)) => ({...})`

### signalState vs signalStore
- `signalState` is a lighter-weight alternative: creates a `SignalState` with `patchState` support but without feature composition
- Use `signalState` for simple component-level state; use `signalStore` for structured, scalable state management
- `signalState` returns an instance directly (not a class); no DI provisioning

## Code Patterns

### Pattern 1: Basic Counter Store
```typescript
// stores/counter.store.ts
import { computed } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';

export const CounterStore = signalStore(
  { providedIn: 'root' },
  withState({ count: 0 }),
  withComputed(({ count }) => ({
    doubleCount: computed(() => count() * 2),
    isPositive: computed(() => count() > 0),
  })),
  withMethods((store) => ({
    increment(): void {
      patchState(store, (state) => ({ count: state.count + 1 }));
    },
    decrement(): void {
      patchState(store, (state) => ({ count: state.count - 1 }));
    },
    reset(): void {
      patchState(store, { count: 0 });
    },
  })),
);
```

### Pattern 2: Store with Nested State and DeepSignals
```typescript
// stores/user-profile.store.ts
import { computed } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';

interface UserProfile {
  user: {
    firstName: string;
    lastName: string;
    address: { city: string; country: string };
  };
  preferences: { theme: 'light' | 'dark'; language: string };
}

const initialState: UserProfile = {
  user: {
    firstName: 'John',
    lastName: 'Doe',
    address: { city: 'London', country: 'UK' },
  },
  preferences: { theme: 'light', language: 'en' },
};

export const UserProfileStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed(({ user }) => ({
    fullName: computed(() => `${user.firstName()} ${user.lastName()}`),
  })),
  withMethods((store) => ({
    updateCity(city: string): void {
      // MUST spread nested objects (shallow merge)
      patchState(store, (state) => ({
        user: {
          ...state.user,
          address: { ...state.user.address, city },
        },
      }));
    },
    setTheme(theme: 'light' | 'dark'): void {
      patchState(store, (state) => ({
        preferences: { ...state.preferences, theme },
      }));
    },
  })),
);
```

### Pattern 3: Store with HTTP Service (withMethods injection context)
```typescript
// stores/product.store.ts
import { computed, inject } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { ProductService } from '../services/product.service';

interface ProductState {
  products: Product[];
  loading: boolean;
  error: string | null;
}

const initialState: ProductState = {
  products: [],
  loading: false,
  error: null,
};

export const ProductStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed(({ products, loading, error }) => ({
    productCount: computed(() => products().length),
    hasError: computed(() => error() !== null),
    isEmpty: computed(() => !loading() && products().length === 0),
  })),
  withMethods((store, productService = inject(ProductService)) => ({
    async loadProducts(): Promise<void> {
      patchState(store, { loading: true, error: null });
      try {
        const products = await productService.getAll();
        patchState(store, { products, loading: false });
      } catch (e) {
        patchState(store, { loading: false, error: (e as Error).message });
      }
    },
    async deleteProduct(id: string): Promise<void> {
      await productService.delete(id);
      patchState(store, (state) => ({
        products: state.products.filter((p) => p.id !== id),
      }));
    },
  })),
);
```

### Pattern 4: Component-Level Store
```typescript
// stores/todo-list.store.ts
import { signalStore, withState, withMethods, patchState } from '@ngrx/signals';

// No providedIn -- must be provided at component or route level
export const TodoListStore = signalStore(
  withState({ todos: [] as Todo[], filter: 'all' as 'all' | 'active' | 'completed' }),
  withMethods((store) => ({
    addTodo(text: string): void {
      patchState(store, (state) => ({
        todos: [...state.todos, { id: crypto.randomUUID(), text, completed: false }],
      }));
    },
    toggleTodo(id: string): void {
      patchState(store, (state) => ({
        todos: state.todos.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t)),
      }));
    },
    setFilter(filter: 'all' | 'active' | 'completed'): void {
      patchState(store, { filter });
    },
  })),
);

// components/todo-list.component.ts
import { Component, inject } from '@angular/core';
import { TodoListStore } from '../stores/todo-list.store';

@Component({
  selector: 'app-todo-list',
  standalone: true,
  providers: [TodoListStore], // New instance per component
  template: `
    @for (todo of store.todos(); track todo.id) {
      <div (click)="store.toggleTodo(todo.id)">{{ todo.text }}</div>
    }
  `,
})
export class TodoListComponent {
  readonly store = inject(TodoListStore);
}
```

### Pattern 5: patchState Updater Functions
```typescript
// Partial object (direct)
patchState(store, { loading: true });

// Updater function
patchState(store, (state) => ({ count: state.count + 1 }));

// Multiple updaters in one call
patchState(store, { loading: false }, (state) => ({ products: [...state.products, newProduct] }));

// With entity updaters (from @ngrx/signals/entities)
import { setAllEntities, addEntity, removeEntity } from '@ngrx/signals/entities';
patchState(store, setAllEntities(products));
patchState(store, addEntity(newProduct));
patchState(store, removeEntity(productId));
```

### Pattern 6: getState and watchState
```typescript
import { getState, watchState } from '@ngrx/signals';

// Get a snapshot (non-reactive)
const currentState = getState(store);
console.log(currentState); // { count: 5, ... }

// Watch state changes (reactive, runs in effect)
const effectRef = watchState(store, (state) => {
  console.log('State changed:', state);
});
```

### Pattern 7: DevTools Integration
```typescript
// stores/flight.store.ts
import { signalStore, withState, withMethods, patchState } from '@ngrx/signals';
import { withDevtools } from '@angular-architects/ngrx-toolkit';

export const FlightStore = signalStore(
  { providedIn: 'root' },
  withDevtools('flights'), // Name shown in Redux DevTools
  withState({ flights: [] as Flight[], loading: false }),
  withMethods((store) => ({
    setFlights(flights: Flight[]): void {
      patchState(store, { flights, loading: false });
    },
  })),
);
```

### Pattern 8: DevTools with Custom Action Names
```typescript
import { updateState } from '@angular-architects/ngrx-toolkit';

// Instead of patchState, use updateState for labeled actions in DevTools
withMethods((store) => ({
  loadFlightsSuccess(flights: Flight[]): void {
    updateState(store, 'load flights success', { flights, loading: false });
  },
  setLoading(): void {
    updateState(store, 'set loading', { loading: true });
  },
})),
```

### Pattern 9: signalState for Lightweight State
```typescript
// In a component (no separate store file needed)
import { Component } from '@angular/core';
import { signalState, patchState } from '@ngrx/signals';

@Component({
  selector: 'app-counter',
  standalone: true,
  template: `
    <span>{{ state.count() }}</span>
    <button (click)="increment()">+</button>
  `,
})
export class CounterComponent {
  readonly state = signalState({ count: 0 });

  increment(): void {
    patchState(this.state, (s) => ({ count: s.count + 1 }));
  }
}
```

## Breaking Changes and Gotchas

### Version History (v17 through v21)

| Version | Change | Impact |
|---------|--------|--------|
| v17 | Initial release: `signalStore`, `withState`, `withComputed`, `withMethods`, `withHooks`, `patchState` | N/A (first release) |
| v18 | `protectedState: true` becomes the default | External `patchState` calls fail. Fix: add methods to the store or set `protectedState: false` |
| v18 | Private members: `_` prefix convention hides from public API | Properties prefixed with `_` are omitted from the store type via `OmitPrivate<T>` |
| v19 | Deep `Object.freeze()` on state in dev mode | Mutable objects (FormGroup, Date, etc.) in `withState` throw errors. Fix: use `withProps()` |
| v19 | `withProps()` promoted to base feature | Use for non-reactive, mutable properties (services, Observables, Resources) |
| v19 | `signalMethod` introduced | Side effects without RxJS dependency |
| v20 | `withLinkedState()` for derived mutable state | Uses `linkedSignal` under the hood |
| v20 | `withFeature()` factory pattern | Type-safe access to full store inside nested features |
| v20 | `@ngrx/signals/testing` with `unprotected()` helper | Bypass state protection in tests for direct state setup |
| v20 | patchState on deepSignal with partial objects removes unmentioned properties | Known issue (#4907). Always provide complete nested objects |
| v21 | Events plugin promoted to stable (`@ngrx/signals/events`) | Full Flux-style architecture available |
| v21 | `withEffects()` renamed to `withEventHandlers()` | Migration schematic available via `ng update @ngrx/signals@21` |
| v21 | `signalMethod`/`rxMethod` accept computation functions | Aligns with `resource()` and `linkedSignal` patterns |
| v21 | Calling `rxMethod`/`signalMethod` outside injection context deprecated | Wrap in `runInInjectionContext()` or move to `withMethods` |
| v21 | `providedIn: 'platform'` support | For micro-frontend shared state across Angular applications |

### Common Mistakes

1. **Shallow merge surprise with nested objects**: `patchState(store, { user: { firstName: 'Jane' } })` replaces the entire `user` object, losing `lastName` and `address`. Must spread: `patchState(store, (s) => ({ user: { ...s.user, firstName: 'Jane' } }))`

2. **Mutable objects in withState**: Placing `FormGroup`, `Date`, or other mutable objects in `withState()` causes `Object.freeze` errors in dev mode (v19+). Use `withProps()` instead.

3. **Feature ordering**: `withComputed` cannot access methods from a subsequent `withMethods`. `withHooks` that calls a method must appear after that method's `withMethods`. Features are composed sequentially.

4. **Forgetting providers for component-level stores**: Stores without `providedIn: 'root'` must be added to the component's or route's `providers` array.

5. **Calling patchState externally with protectedState (default)**: Since v18, state is protected by default. External `patchState` calls on a protected store fail at compile time.

6. **TypeScript overload limit**: `signalStore` supports up to 15 features (verified from type definitions). Composing more causes type errors. Solution: consolidate features using `signalStoreFeature()`.

7. **Store-to-store direct injection**: Avoid stores injecting other stores directly. Use a facade service or the Events plugin for decoupled communication.

8. **Not using getState for snapshots**: When you need the entire current state as a plain object (e.g., for logging, serialization), use `getState(store)` rather than accessing individual signals.

## Sources

### Official Documentation
- NgRx SignalStore Guide: https://ngrx.io/guide/signals/signal-store
- NgRx Signal State Guide: https://ngrx.io/guide/signals/signal-state
- NgRx SignalStore FAQ: https://ngrx.io/guide/signals/faq
- NgRx Testing Guide: https://ngrx.io/guide/signals/signal-store/testing
- NgRx Lifecycle Hooks: https://ngrx.io/guide/signals/signal-store/lifecycle-hooks
- NgRx Custom Store Features: https://ngrx.io/guide/signals/signal-store/custom-store-features

### Version Announcements
- NgRx v19 Announcement: https://dev.to/ngrx/announcing-ngrx-19-ngrx-signals-features-action-signals-and-more-2b35
- NgRx v20 Announcement: https://dev.to/ngrx/announcing-ngrx-v20-the-power-of-events-enhanced-dx-and-a-mature-signalstore-2fdm
- NgRx v21 Announcement: https://dev.to/ngrx/announcing-ngrx-21-celebrating-a-10-year-journey-with-a-fresh-new-look-and-ngrxsignalsevents-5ekp

### Expert Blog Posts and Articles
- Stefanos Lignos -- All You Need to Know About NgRx Signal Store: https://www.stefanos-lignos.dev/posts/ngrx-signals-store
- Rainer Hahnekamp -- NgRx Signal Store: The Missing Piece to Signals: https://medium.com/ngconf/ngrx-signal-store-the-missing-piece-to-signals-ac125d804026
- Angular Architects -- The NGRX Signal Store and Your Architecture: https://www.angulararchitects.io/blog/the-ngrx-signal-store-and-your-architecture/
- Angular Architects -- 3+1 Flavors of SignalStore: https://www.angulararchitects.io/blog/the-new-ngrx-signal-store-for-angular-2-1-flavors/
- Angular Architects -- Smarter Not Harder: Custom Features: https://www.angulararchitects.io/blog/smarter-not-harder-simplifying-your-application-with-ngrx-signal-store-and-custom-features/
- Angular Architects -- ngrx-toolkit withDevtools: https://ngrx-toolkit.angulararchitects.io/docs/with-devtools
- Angular Addicts -- How to Mock NgRx Signal Stores: https://www.angularaddicts.com/p/how-to-mock-ngrx-signal-stores
- Egghead -- Provide SignalStore at component, route, or globally: https://egghead.io/lessons/angular-provide-the-ngrx-signal-store-within-a-component-a-route-or-globally
- Egghead -- Simplify patchState with Immer: https://egghead.io/lessons/angular-simplify-ngrx-signal-store-advanced-patchstate-usecases-with-immer-immutable-utility

### GitHub Issues and Discussions
- DevTools RFC: https://github.com/ngrx/platform/discussions/4040
- Feature Overload Limit: https://github.com/ngrx/platform/issues/4314
- patchState DeepSignal Bug: https://github.com/ngrx/platform/issues/4907
- v19 Breaking Changes Discussion: https://github.com/ngrx/platform/discussions/4664
- mockSignalStore RFC: https://github.com/ngrx/platform/issues/4256
- Read-Only Signal Regression: https://github.com/ngrx/platform/issues/4958

### Podcasts and Talks
- Angular Master Podcast (AMP 66): Alex Okrushko & Marko Stanimirovic on SignalStore
- Angular Show S6 E19: Mastering NgRx SignalStore

## Open Questions

1. **withDevtools exact compatibility with NgRx 21**: The `@angular-architects/ngrx-toolkit` package version that supports NgRx 21 should be verified. The API is expected stable but version alignment needs checking.

2. **patchState DeepSignal bug (#4907) status**: This was reported in NgRx 20. Verify if it has been fixed in v21.1.0 by checking the changelog or testing.

3. **signalStore overload count**: The type definitions show up to F15 in the overloads. Earlier community discussions reference 10-16. The current v21.1.0 supports 15 features per store (verified from source). Confirm whether this has changed.

4. **Events plugin scope in this chapter**: The outline scopes chapter 15 to fundamentals (withState, withComputed, withMethods, patchState, DevTools). The Events plugin has its own chapter (Ch 19). Only briefly mention that event-driven patterns exist, with a forward reference to Ch 19.

5. **withHooks, withProps, withLinkedState scope**: The outline lists Ch 17 for "Lifecycle, Hooks, and Props." This chapter should introduce withHooks minimally (perhaps in context of store initialization) but defer deep coverage to Ch 17. Similarly, withLinkedState is covered in Ch 18.
