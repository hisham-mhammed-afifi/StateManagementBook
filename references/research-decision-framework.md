# Research: Decision Framework and Golden Rules

**Date:** 2026-04-10
**Chapter:** Ch 38
**Status:** Ready for chapter generation

## API Surface

### Angular Core (Signals + Services Pattern)

| API | Import Path | Stability |
|-----|-------------|-----------|
| `signal()` | `@angular/core` | Stable |
| `computed()` | `@angular/core` | Stable |
| `effect()` | `@angular/core` | Stable |
| `linkedSignal()` | `@angular/core` | Stable |
| `resource()` | `@angular/core` | Stable |
| `httpResource()` | `@angular/common/http` | **Experimental** |
| `rxResource()` | `@angular/core/rxjs-interop` | Stable |
| `toSignal()` | `@angular/core/rxjs-interop` | Stable |
| `toObservable()` | `@angular/core/rxjs-interop` | Stable |

### NgRx SignalStore (`@ngrx/signals` v21.1.0)

| API | Import Path | Stability |
|-----|-------------|-----------|
| `signalState()` | `@ngrx/signals` | Stable |
| `signalStore()` | `@ngrx/signals` | Stable |
| `patchState()` | `@ngrx/signals` | Stable |
| `withState()` | `@ngrx/signals` | Stable |
| `withComputed()` | `@ngrx/signals` | Stable |
| `withMethods()` | `@ngrx/signals` | Stable |
| `withHooks()` | `@ngrx/signals` | Stable |
| `withEntities()` | `@ngrx/signals/entities` | Stable |
| `withEventHandlers()` | `@ngrx/signals/events` | Stable (graduated in v21) |
| `eventGroup()` | `@ngrx/signals/events` | Stable |
| `withReducer()` | `@ngrx/signals/events` | Stable |
| `on()` | `@ngrx/signals/events` | Stable |

### NgRx Classic Store (`@ngrx/store` v21)

| API | Import Path | Stability |
|-----|-------------|-----------|
| `createAction()` | `@ngrx/store` | Stable |
| `createReducer()` | `@ngrx/store` | Stable |
| `createSelector()` | `@ngrx/store` | Stable |
| `createEffect()` | `@ngrx/effects` | Stable |
| `Store` | `@ngrx/store` | Stable |
| `StoreModule` | `@ngrx/store` | Stable (legacy) |
| `provideStore()` | `@ngrx/store` | Stable |
| `provideEffects()` | `@ngrx/effects` | Stable |
| `EntityAdapter` | `@ngrx/entity` | Stable |

### TanStack Query Angular (`@tanstack/angular-query-experimental` v5.97.0)

| API | Import Path | Stability |
|-----|-------------|-----------|
| `injectQuery()` | `@tanstack/angular-query-experimental` | **Experimental** |
| `injectMutation()` | `@tanstack/angular-query-experimental` | **Experimental** |
| `injectInfiniteQuery()` | `@tanstack/angular-query-experimental` | **Experimental** |
| `QueryClient` | `@tanstack/angular-query-experimental` | **Experimental** |
| `provideTanStackQuery()` | `@tanstack/angular-query-experimental` | **Experimental** |

### NGXS (`@ngxs/store` v21.0.0)

| API | Import Path | Stability |
|-----|-------------|-----------|
| `@State()` | `@ngxs/store` | Stable |
| `@Action()` | `@ngxs/store` | Stable |
| `@Selector()` | `@ngxs/store` | Stable |
| `store.selectSignal()` | `@ngxs/store` | Stable |
| `select()` | `@ngxs/store` | Stable |
| `createSelectMap()` | `@ngxs/store` | Stable |
| `createDispatchMap()` | `@ngxs/store` | Stable |

### Elf (`@ngneat/elf` v2.5.1 -- effectively maintenance mode)

| API | Import Path | Stability |
|-----|-------------|-----------|
| `createStore()` | `@ngneat/elf` | Stable (unmaintained) |
| `withProps()` | `@ngneat/elf` | Stable (unmaintained) |
| Entity APIs | `@ngneat/elf-entities` | Stable (unmaintained) |
| Request APIs | `@ngneat/elf-requests` | Stable (unmaintained) |

## Key Concepts

### Decision Framework (Tiered Strategy)

The community has converged on a tiered progression for Angular state management:

- **Tier 1 -- Local Component State:** `signal()`, `computed()`, `@Input`/`@Output`. For UI toggles, form state, modal visibility, component-scoped data.
- **Tier 2 -- Shared Feature State:** Injectable service with private writable signals, public readonly signals, and methods. Recommended default for most apps. Scales to medium-large apps with disciplined teams.
- **Tier 3 -- Structured Shared State:** NgRx SignalStore with `withState`, `withComputed`, `withMethods`, custom features. For complex feature state needing enforced patterns, entity management, DevTools. Recommended when team size exceeds 4-5 developers.
- **Tier 4 -- Global Enterprise State:** NgRx Classic Store with actions, reducers, effects/event handlers. For massive enterprise apps needing strict separation of concerns, full DevTools, time-travel debugging, audit trails.
- **Server State (orthogonal):** Simple needs use `httpResource()` (built-in, experimental). Complex needs use TanStack Query (caching, invalidation, optimistic updates).

### Decision Criteria Table

| Factor | Plain Signals | Services + Signals | signalState | signalStore | Classic NgRx | TanStack Query |
|--------|--------------|-------------------|-------------|-------------|-------------|----------------|
| Team Size | 1-2 | 2-5 | 2-5 | 5+ | 5+ | Any |
| State Complexity | Simple, local | Shared features | Structured local | Complex features | Global, interconnected | Server state |
| Async Operations | Basic | Moderate | Basic | Moderate | Complex orchestration | Built-in |
| Debugging | Console | Console | DevTools | DevTools | Time-travel | DevTools |
| Learning Curve | Minimal | Low | Low | Moderate | High | Moderate |
| Boilerplate | None | Low | Low | Low-Medium | High | Low |
| State Scope | Component | Feature | Component/Feature | Feature/Global | Global | Server cache |

### The Starting Question

The right question is NOT "Should I use NgRx?" but "Do I actually have a state problem?" Teams often introduce NgRx prematurely without understanding actual requirements.

### Golden Rules of State Management

1. **Match your tool to the problem, not the other way around.** Don't over-engineer; sometimes a simple signal beats a global store.
2. **Always prefer local state unless you have a good reason to go global.** Local state should bind to component lifecycle. Global state offers indirection benefits valuable only for complex scenarios.
3. **State ownership must be explicit.** Every piece of state needs one and only one owner.
4. **Encapsulate state mutations.** Expose read-only signals (`.asReadonly()`) or observables (`.asObservable()`). Components call public methods only.
5. **State is immutable.** Reducers create new state objects, never mutate. Use spread operators, `map()`, and `filter()`.
6. **Separate stateful and stateless services.** Don't mix HTTP/API logic with state management.
7. **Keep components presentation-only.** Move business logic, state manipulation, and side effects to services/stores.
8. **Normalize relational data.** Store entities in dictionaries indexed by ID.
9. **Memoize derived state.** Use `computed()` signals or NgRx selectors.
10. **Design data structures first, pick tools second.** Plan what and how, then decide on the tool.

### Code Review Checklist

**Architecture:**
- State scope is appropriate (local vs feature vs global)
- State has a single, clearly identified owner
- No duplicate state across multiple stores/services
- Server state and client state are separated
- Feature stores are lazy-loaded with their feature

**Immutability & Updates:**
- All state updates are immutable (no direct mutation)
- State mutations happen only inside the store/service, never in components
- `patchState()` or spread operators used for updates
- State is exposed as read-only (`asReadonly()`, `computed()`)

**Reactive Patterns:**
- Derived state uses `computed()` signals or memoized selectors
- No manual subscriptions in components (use `async` pipe or signals)
- No nested subscriptions; use RxJS operators for composition
- Effects/side effects are isolated from state transitions

**Performance:**
- No unnecessary global state for ephemeral UI state
- Selectors are memoized and granular
- Entity collections use normalized structures
- Signal equality functions specified where needed

**Error & Loading States:**
- Loading/error/success status tracked per operation
- Optimistic updates have rollback handling
- Error state is cleared appropriately

**Testing:**
- Store/service logic is tested independently of components
- Reducers tested as pure functions
- Effects tested with mocked dependencies
- Selectors tested with known state inputs

## Code Patterns

### Pattern 1: Plain Signals + Service (Tier 2)

```typescript
// src/app/cart/cart.store.ts
import { Injectable, signal, computed } from '@angular/core';

interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

@Injectable({ providedIn: 'root' })
export class CartStore {
  private readonly _items = signal<CartItem[]>([]);

  readonly items = this._items.asReadonly();
  readonly totalPrice = computed(() =>
    this._items().reduce((sum, item) => sum + item.price * item.quantity, 0)
  );
  readonly itemCount = computed(() =>
    this._items().reduce((sum, item) => sum + item.quantity, 0)
  );

  addItem(item: Omit<CartItem, 'quantity'>) {
    this._items.update(items => {
      const existing = items.find(i => i.id === item.id);
      if (existing) {
        return items.map(i =>
          i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [...items, { ...item, quantity: 1 }];
    });
  }

  removeItem(id: string) {
    this._items.update(items => items.filter(i => i.id !== id));
  }

  clear() {
    this._items.set([]);
  }
}
```

### Pattern 2: signalState for Structured Local State (Tier 2.5)

```typescript
// src/app/filters/filter.state.ts
import { signalState, patchState } from '@ngrx/signals';

interface FilterState {
  search: string;
  category: string;
  sortBy: 'name' | 'price' | 'date';
  ascending: boolean;
}

const initialState: FilterState = {
  search: '',
  category: 'all',
  sortBy: 'name',
  ascending: true,
};

// Use inside a component or service
const state = signalState(initialState);

// Read
state.search(); // ''
state.sortBy(); // 'name'

// Update
patchState(state, { search: 'angular', category: 'books' });
patchState(state, (s) => ({ ascending: !s.ascending }));
```

### Pattern 3: SignalStore (Tier 3)

```typescript
// src/app/products/products.store.ts
import { computed, inject } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  withHooks,
  patchState,
} from '@ngrx/signals';
import { withEntities, setAllEntities, removeEntity } from '@ngrx/signals/entities';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap } from 'rxjs';
import { ProductService } from './product.service';

interface ProductsState {
  loading: boolean;
  error: string | null;
  selectedId: string | null;
}

export const ProductsStore = signalStore(
  { providedIn: 'root' },
  withState<ProductsState>({
    loading: false,
    error: null,
    selectedId: null,
  }),
  withEntities<{ id: string; name: string; price: number }>(),
  withComputed((store) => ({
    selectedProduct: computed(() => {
      const id = store.selectedId();
      return store.entities().find(p => p.id === id) ?? null;
    }),
  })),
  withMethods((store, productService = inject(ProductService)) => ({
    selectProduct(id: string) {
      patchState(store, { selectedId: id });
    },
    loadProducts: rxMethod<void>(
      pipe(
        tap(() => patchState(store, { loading: true, error: null })),
        switchMap(() =>
          productService.getAll().pipe(
            tap({
              next: (products) => {
                patchState(store, setAllEntities(products), { loading: false });
              },
              error: (err: Error) => {
                patchState(store, { loading: false, error: err.message });
              },
            })
          )
        )
      )
    ),
    remove(id: string) {
      patchState(store, removeEntity(id));
    },
  })),
  withHooks({
    onInit(store) {
      store.loadProducts();
    },
  })
);
```

### Pattern 4: TanStack Query for Server State

```typescript
// src/app/products/products.component.ts
import { Component, inject } from '@angular/core';
import {
  injectQuery,
  injectMutation,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { HttpClient } from '@angular/common/http';
import { lastValueFrom } from 'rxjs';

@Component({
  selector: 'app-products',
  template: `
    @if (productsQuery.isPending()) {
      <p>Loading...</p>
    }
    @if (productsQuery.error()) {
      <p>Error: {{ productsQuery.error()?.message }}</p>
    }
    @if (productsQuery.data(); as products) {
      @for (product of products; track product.id) {
        <div>{{ product.name }} - {{ product.price | currency }}</div>
      }
    }
  `,
})
export class ProductsComponent {
  private http = inject(HttpClient);
  private queryClient = inject(QueryClient);

  productsQuery = injectQuery(() => ({
    queryKey: ['products'],
    queryFn: () =>
      lastValueFrom(this.http.get<Product[]>('/api/products')),
    staleTime: 5 * 60 * 1000, // 5 minutes
  }));

  deleteMutation = injectMutation(() => ({
    mutationFn: (id: string) =>
      lastValueFrom(this.http.delete(`/api/products/${id}`)),
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  }));
}
```

### Pattern 5: NGXS (Decorator-Based)

```typescript
// src/app/todos/todos.state.ts
import { Injectable } from '@angular/core';
import { State, Action, Selector, StateContext } from '@ngxs/store';
import { patch, append, removeItem } from '@ngxs/store/operators';

export class AddTodo {
  static readonly type = '[Todos] Add';
  constructor(public payload: { title: string }) {}
}

export class RemoveTodo {
  static readonly type = '[Todos] Remove';
  constructor(public payload: { id: string }) {}
}

interface TodosStateModel {
  items: Array<{ id: string; title: string; done: boolean }>;
  loading: boolean;
}

@State<TodosStateModel>({
  name: 'todos',
  defaults: { items: [], loading: false },
})
@Injectable()
export class TodosState {
  @Selector()
  static items(state: TodosStateModel) {
    return state.items;
  }

  @Selector()
  static pendingCount(state: TodosStateModel) {
    return state.items.filter(i => !i.done).length;
  }

  @Action(AddTodo)
  addTodo(ctx: StateContext<TodosStateModel>, action: AddTodo) {
    ctx.setState(
      patch({
        items: append([{ id: crypto.randomUUID(), title: action.payload.title, done: false }]),
      })
    );
  }

  @Action(RemoveTodo)
  removeTodo(ctx: StateContext<TodosStateModel>, action: RemoveTodo) {
    ctx.setState(
      patch({
        items: removeItem<{ id: string }>(item => item.id === action.payload.id),
      })
    );
  }
}
```

## Alternative Libraries Comparison

### Summary Table

| Library | Version | Maintained | Signal-Native | Bundle Size | Learning Curve | DevTools | Recommended For |
|---------|---------|------------|--------------|-------------|---------------|----------|-----------------|
| Plain Signals | Angular 21 built-in | Yes (Angular team) | Yes | 0 kB | Minimal | No | Small-medium apps, starting point |
| NgRx SignalStore | 21.1.0 | Yes (active) | Yes | ~1.2 kB gzip | Low-Moderate | Yes | Medium-large apps, enforced patterns |
| NgRx Classic Store | 21.0.0 | Yes (active) | Via `selectSignal` | ~15 kB gzip | High | Full (time-travel) | Large enterprise, complex async |
| TanStack Query | 5.97.0 | Yes (active) | Yes | ~12 kB gzip | Moderate | Yes | Server-state caching and sync |
| NGXS | 21.0.0 | Yes (active) | Partial (`selectSignal`) | ~10 kB gzip | Moderate | Yes (plugin) | Existing NGXS projects |
| Elf | 2.5.1 | Low activity | No | ~2 kB gzip | Low | Yes (plugin) | **Not recommended for new projects** |
| Signalstory | 20.0.0 | Yes (small team) | Yes | ~3 kB gzip | Low | Yes (plugin) | Small projects, exploration |

### Detailed Assessment

**TanStack Query Angular:**
- Strengths: Best-in-class server-state management, smart caching, stale-while-revalidate, background refetch, query deduplication, offline support, optimistic updates
- Weaknesses: Still experimental (`-experimental` suffix), Angular adapter less mature than React, focused only on server state
- Signal support: First-class (returns signals, not observables)
- Verdict: Best choice when server-state caching is the primary concern. Pair with SignalStore or plain signals for client state.

**NGXS:**
- Strengths: Less boilerplate than classic NgRx, decorator-based (familiar to OOP developers), rich plugin ecosystem (storage, forms, router, websocket)
- Weaknesses: Decorator-based API is at odds with Angular's functional direction, signal support is read-only, smaller community than NgRx, class-based patterns feel dated
- Signal support: `selectSignal()`, `createSelectMap()`, `createDispatchMap()` for reading; no signal-native store creation
- Verdict: Viable for existing NGXS codebases. Not recommended for new projects -- NgRx SignalStore is more aligned with Angular's direction.

**Elf:**
- Strengths: Extremely modular, tree-shakeable, rich feature set (entities, pagination, requests, persistence, history)
- Weaknesses: Core package unmaintained (~2 years without release), no native signal support, RxJS-first design misaligned with Angular's signal direction, small community
- Signal support: None (requires manual `toSignal()` bridging)
- Verdict: **Not recommended for new projects.** Existing Elf users should plan migration to NgRx SignalStore.

**Signalstory:**
- Strengths: Signal-native from inception, flexible architecture, undo/redo, DevTools
- Weaknesses: Very small community (50 GitHub stars), single-maintainer risk, less battle-tested
- Verdict: Interesting for exploration; too risky for enterprise. Mention as a noteworthy alternative.

## Breaking Changes and Gotchas

- **NgRx v21:** `withEffects()` renamed to `withEventHandlers()`. Migration schematic available via `ng update @ngrx/signals@21`.
- **NgRx v21:** Events Plugin (`@ngrx/signals/events`) graduated from experimental to stable.
- **NgRx v21:** `signalMethod` and `rxMethod` now accept computation functions (aligning with `resource` and `linkedSignal` patterns).
- **Angular 21:** Zoneless by default. `OnPush` is effectively the default behavior.
- **httpResource:** Still experimental in Angular 21. Core concepts stable but method signatures may change.
- **TanStack Query Angular:** The `-experimental` suffix means breaking changes can occur in minor AND patch releases. No stable release date announced.
- **NGXS v21.0.0:** Aligns with Angular 21 but signal support remains limited to read-only selectors.
- **Elf:** Core package last updated ~2024. Users on Elf should plan migration.
- **signalState vs signalStore:** `patchState()` only accepts object/record values in `signalState`. Both share nearly identical mutation APIs, making migration from one to the other straightforward.
- **Anti-pattern:** Using NgRx Classic Store for a simple CRUD app is the most commonly cited over-engineering mistake.
- **Anti-pattern:** Exposing writable signals directly from services (always use `.asReadonly()` or `computed()`).
- **Anti-pattern:** Not handling loading/error states -- only modeling the happy path.

## Expert Opinions

- **Manfred Steyer (Angular Architects, GDE):** Advocates "full-cycle reactivity" combining Signal Forms, Signal Store, Resources, and Mutation API. Signal-based architecture from day one. Recent talks (March 2026) at Angular Days Munich.
- **Marko Stanimirovic (NgRx core team, SignalStore creator):** SignalStore is "the natural extension to Angular's reactive primitives." Emphasizes clean code and declarative programming.
- **Alex Okrushko (NgRx core team, GDE):** SignalStore "eliminates boilerplate while scaling from a simple service with signals to a full-fledged, enterprise-grade solution." Both Classic Store and SignalStore are officially supported and can coexist.
- **Brandon Roberts (NgRx core team):** Co-leads workshops on enterprise Angular architectures using NgRx, Signals, and AI Assistants.
- **Rainer Hahnekamp (NgRx team, GDE):** SignalStore "extends Signals with patchState and Slices, adds support for async operations, optionally integrates RxJS, brings Logic and Data together in a structured way."
- **Kevin Kreuzer (Angular Experts, GDE):** Deep expertise on signal primitives. Published eBook on Angular Signals. Advocates understanding signal internals. Recently covered zoneless Angular (Jan 2026).
- **Alfredo Perez (ngconf):** "Skip using Resource and go directly to TanStack" if you need caching and server state management.

## Sources

### Official Documentation
- Angular Signals: https://angular.dev/guide/signals
- Angular httpResource: https://angular.dev/guide/http/http-resource
- NgRx SignalStore: https://ngrx.io/guide/signals/signal-store
- NgRx Classic Store: https://ngrx.io/guide/store
- NgRx Migration Guide v21: https://ngrx.io/guide/migration/v21
- TanStack Query Angular: https://tanstack.com/query/v5/docs/framework/angular/overview
- NGXS: https://www.ngxs.io
- Elf: https://ngneat.github.io/elf/

### Blog Posts and Articles
- Nx Blog -- Angular State Management for 2025: https://nx.dev/blog/angular-state-management-2025
- NgRx 21 Announcement: https://dev.to/ngrx/announcing-ngrx-21-celebrating-a-10-year-journey-with-a-fresh-new-look-and-ngrxsignalsevents-5ekp
- Skip Angular Resource (Alfredo Perez, ngconf): https://medium.com/ngconf/skip-angular-resource-ff3441e8b2ba
- Signal Store & NGXS Integration: https://angular.love/signal-store-ngxs-elevating-flexibility-in-state-management/
- NgRx vs Signal Store Comparison (Stackademic): https://blog.stackademic.com/ngrx-vs-signal-store-which-one-should-you-use-in-2025-d7c9c774b09d
- NgRx Classic to Signal Store (Fabio Cabi): https://medium.com/@fabio.cabi/ngrx-from-the-classic-store-to-the-signal-store-what-changes-for-angular-developers-816c8d05f18d
- State Management Without NgRx (Signals): https://medium.com/@differofeveryone/state-management-without-ngrx-clean-scalable-patterns-with-angular-signals-41712f79b020
- Practical Guide to Services + Signals (Telerik): https://www.telerik.com/blogs/practical-guide-state-management-using-angular-services-signals
- Comprehensive Guide to Vanilla Angular State Management: https://dev.to/this-is-angular/a-comprehensive-guide-to-state-management-with-vanilla-angular-5a59
- Best Practices for Angular State Management: https://dev.to/devin-rosario/best-practices-for-angular-state-management-2pm1
- Angular State Management Best Practices (Infragistics): https://www.infragistics.com/blogs/angular-state-management
- Mastering State Management with NgRx and Signals: https://angular.love/mastering-state-management-in-angular-with-ngrx-and-signals-scalable-predictable-performant/
- TanStack Query Angular Data Fetching (Telerik): https://www.telerik.com/blogs/data-fetching-angular-using-tanstack-query
- Angular in 2025: Less RxJS, More Flexibility: https://medium.com/@nicolas.turchi/angular-in-2025-less-rxjs-more-flexibility-for-application-server-state-management-425d80f294ff

### GitHub
- NgRx Platform: https://github.com/ngrx/platform
- NGXS Store: https://github.com/ngxs/store
- Elf: https://github.com/ngneat/elf
- Signalstory: https://github.com/zuriscript/signalstory
- TanStack Query: https://github.com/TanStack/query
- withEventHandlers rename issue: https://github.com/ngrx/platform/issues/4976
- Elf Signals Discussion: https://github.com/ngneat/elf/discussions/440
- NGXS Signals RFC: https://github.com/ngxs/store/discussions/1977

### npm
- @tanstack/angular-query-experimental: https://www.npmjs.com/package/@tanstack/angular-query-experimental
- @ngxs/store: https://www.npmjs.com/package/@ngxs/store
- @ngneat/elf: https://www.npmjs.com/package/@ngneat/elf

## Open Questions

1. **TanStack Query Angular stable release date:** No confirmed timeline for removing the `-experimental` suffix. Verify before publication whether this has changed.
2. **httpResource graduation:** Check if `httpResource` has moved from experimental to stable by publication time. Angular 22 (expected mid-2026) may promote it.
3. **Signalstory longevity:** Single-maintainer project. Verify it's still maintained at publication time before including as an alternative.
4. **NGXS signal-native store:** The NGXS team chose not to build their own signal store. Verify this hasn't changed by publication.
5. **Elf status:** Confirm whether Elf has been formally deprecated or just abandoned. Check for any fork or successor project.
6. **NgRx SignalStore DevTools:** The level of DevTools integration for SignalStore vs Classic Store should be verified. Classic Store has full time-travel; SignalStore has basic DevTools.
7. **Bundle size claims:** The ~1.2 kB gzip figure for SignalStore and other bundle sizes should be independently verified with bundlephobia or similar tools.
