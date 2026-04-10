# Chapter 38: Decision Framework and Golden Rules

Your team just finished the sprint retrospective and the verdict is unanimous: state management is the bottleneck. But nobody agrees on why. One developer says you should rip out NgRx and replace it with plain signals. Another insists you need a global store for everything, including modal visibility and tooltip positioning. A third wants to adopt TanStack Query because that is what they used in React. The codebase has four different patterns for loading data, three different approaches to error handling, and zero documentation on which approach to use when. This chapter gives you the tool your team actually needs: a decision framework that maps every state problem to the right solution, a set of golden rules that prevent the most common architectural mistakes, a code review checklist you can paste into your team wiki today, and an honest comparison of every alternative library worth considering in 2026.

Throughout this book we have explored signals, services, NgRx Classic Store, SignalStore, entity management, caching, SSR, micro-frontends, and testing. This chapter ties it all together. We will not revisit API details covered in earlier chapters. Instead, we will focus on the decision of which tool to reach for, why, and when to stop reaching.

## The First Question You Should Ask

The most common state management mistake happens before a single line of code is written. A team selects a tool and then looks for problems to solve with it. The question "Should we use NgRx?" is backwards. The correct starting question is: "Do we actually have a state problem?"

State becomes a problem when one of these conditions is true:

1. Multiple components need the same data, and prop drilling through five levels of `@Input` has become unmanageable.
2. The same piece of data is fetched in multiple places and gets out of sync.
3. A user action in one part of the application must trigger side effects in an unrelated part.
4. You need an audit trail of every state transition for debugging or compliance.
5. Offline or optimistic update scenarios require careful coordination of client and server state.

If none of these conditions apply, you do not have a state problem. You have components with local data. A `signal()` in the component class is the right answer, and any library would be overhead.

## The Four Tiers of State Management

Think of state management approaches as a staircase. You start at the ground floor and climb only when the current floor runs out of room. Each tier adds structure, and structure has a cost: more indirection, more files, more concepts for the team to learn. The goal is to stay on the lowest tier that solves your actual problem.

### Tier 1: Local Component State

State lives inside the component that owns it. No services, no stores, no shared state. This is the right answer for:

- Form field values before submission
- Toggle state (sidebar open/closed, accordion expanded/collapsed)
- Pagination offsets and sort direction within a single data table
- Animation state

```typescript
// src/app/catalog/product-filters.component.ts
import { Component, signal, computed, output } from '@angular/core';

@Component({
  selector: 'app-product-filters',
  template: `
    <div class="filters">
      <input
        type="text"
        [value]="search()"
        (input)="search.set($any($event.target).value)"
        placeholder="Search products..."
      />
      <select [value]="sortBy()" (change)="sortBy.set($any($event.target).value)">
        <option value="name">Name</option>
        <option value="price">Price</option>
        <option value="date">Date Added</option>
      </select>
      <button (click)="toggleDirection()">
        {{ ascending() ? 'Ascending' : 'Descending' }}
      </button>
      <span class="summary">{{ filterSummary() }}</span>
    </div>
  `,
})
export class ProductFiltersComponent {
  readonly search = signal('');
  readonly sortBy = signal<'name' | 'price' | 'date'>('name');
  readonly ascending = signal(true);

  readonly filterSummary = computed(
    () => `Sorted by ${this.sortBy()}, ${this.ascending() ? 'A-Z' : 'Z-A'}`
  );

  readonly filtersChanged = output<{
    search: string;
    sortBy: string;
    ascending: boolean;
  }>();

  toggleDirection(): void {
    this.ascending.update(v => !v);
    this.emitFilters();
  }

  private emitFilters(): void {
    this.filtersChanged.emit({
      search: this.search(),
      sortBy: this.sortBy(),
      ascending: this.ascending(),
    });
  }
}
```

Notice there is no injectable service, no store, no action. The component owns its state, exposes changes through an output, and lets the parent decide what to do with them. This is the simplest possible architecture, and for local UI concerns it is the correct one.

### Tier 2: Shared State with Services and Signals

When multiple components need the same data, extract state into an injectable service. The service holds private writable signals and exposes public read-only signals. Methods encapsulate mutations. This pattern scales to medium-sized applications and is the recommended default for teams of two to five developers.

```typescript
// src/app/cart/cart.store.ts
import { Injectable, signal, computed } from '@angular/core';

export interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
}

@Injectable({ providedIn: 'root' })
export class CartStore {
  private readonly state = signal<CartItem[]>([]);

  readonly items = this.state.asReadonly();
  readonly itemCount = computed(() =>
    this.state().reduce((sum, item) => sum + item.quantity, 0)
  );
  readonly totalPrice = computed(() =>
    this.state().reduce((sum, item) => sum + item.price * item.quantity, 0)
  );
  readonly isEmpty = computed(() => this.state().length === 0);

  addItem(product: Omit<CartItem, 'quantity'>): void {
    this.state.update(items => {
      const existing = items.find(i => i.productId === product.productId);
      if (existing) {
        return items.map(i =>
          i.productId === product.productId
            ? { ...i, quantity: i.quantity + 1 }
            : i
        );
      }
      return [...items, { ...product, quantity: 1 }];
    });
  }

  removeItem(productId: string): void {
    this.state.update(items => items.filter(i => i.productId !== productId));
  }

  clear(): void {
    this.state.set([]);
  }
}
```

```typescript
// src/app/shell/header.component.ts
import { Component, inject } from '@angular/core';
import { CartStore } from '../cart/cart.store';

@Component({
  selector: 'app-header',
  template: `
    <header>
      <h1>Product Catalog</h1>
      <span class="cart-badge">Cart ({{ cartStore.itemCount() }})</span>
    </header>
  `,
})
export class HeaderComponent {
  protected readonly cartStore = inject(CartStore);
}
```

The header reads from the cart store. The product detail page writes to it. Neither knows about the other. The service is the single owner of cart state. This is Tier 2, and for many applications it is the ceiling you will never need to exceed.

### Tier 3: NgRx SignalStore

When your application grows to five or more developers, you need enforceable conventions. Different developers writing signal services will produce subtly different patterns: some will forget `asReadonly()`, others will put HTTP calls inside the store, and a third group will create circular dependencies between services. NgRx SignalStore solves this by providing a standardized, composable API that enforces structure through its plugin system.

SignalStore is the right choice when:

- The team exceeds four to five developers and needs consistent patterns
- You want built-in entity management (`withEntities`)
- The feature requires DevTools integration for debugging
- You need reusable, composable store features across multiple domains

We covered the full SignalStore API in Chapters 15 through 22. Here is a concise example showing how the same cart from Tier 2 looks as a SignalStore:

```typescript
// src/app/cart/cart.signal-store.ts
import { computed } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';

interface CartState {
  items: Array<{
    productId: string;
    name: string;
    price: number;
    quantity: number;
  }>;
}

export const CartSignalStore = signalStore(
  { providedIn: 'root' },
  withState<CartState>({ items: [] }),
  withComputed(({ items }) => ({
    itemCount: computed(() =>
      items().reduce((sum, item) => sum + item.quantity, 0)
    ),
    totalPrice: computed(() =>
      items().reduce((sum, item) => sum + item.price * item.quantity, 0)
    ),
    isEmpty: computed(() => items().length === 0),
  })),
  withMethods((store) => ({
    addItem(product: { productId: string; name: string; price: number }): void {
      const existing = store.items().find(
        i => i.productId === product.productId
      );
      if (existing) {
        patchState(store, {
          items: store.items().map(i =>
            i.productId === product.productId
              ? { ...i, quantity: i.quantity + 1 }
              : i
          ),
        });
      } else {
        patchState(store, {
          items: [...store.items(), { ...product, quantity: 1 }],
        });
      }
    },
    removeItem(productId: string): void {
      patchState(store, {
        items: store.items().filter(i => i.productId !== productId),
      });
    },
    clear(): void {
      patchState(store, { items: [] });
    },
  }))
);
```

The API is nearly identical to the plain service, but the structure is enforced by the framework. Every SignalStore follows the same `withState`, `withComputed`, `withMethods` progression. New developers joining the team know exactly where to look for state shape, derived values, and mutation logic.

### Tier 4: NgRx Classic Store

The Classic Store (covered in Chapters 8 through 14) is the right choice when:

- The application requires strict separation between state transitions (reducers) and side effects (effects)
- You need full time-travel debugging with Redux DevTools
- Regulatory or compliance requirements demand an audit trail of every state change
- Complex async orchestration (WebSocket streams, polling, multi-step sagas) benefits from RxJS-heavy effect pipelines
- The existing codebase already uses Classic Store and a migration is not justified

Classic Store and SignalStore can coexist in the same application. You do not need to choose one or the other for the entire codebase. Use Classic Store for the domains that benefit from strict Redux patterns and SignalStore for everything else.

## Server State: A Separate Axis

Server state is data that originates from an API and must be cached, synchronized, invalidated, and refetched. It follows different rules than client state. The decision about how to handle server state is orthogonal to the four tiers above.

### httpResource (Angular Built-In)

For straightforward data fetching where caching requirements are simple, Angular's built-in `httpResource` handles the job without external dependencies. It provides signal-based loading, error, and data states out of the box.

> **API Status: Experimental**
> `httpResource` is marked as `@experimental` in Angular 21.0.0. Core concepts are stable but method signatures may change in future versions.

```typescript
// src/app/catalog/product-detail.component.ts
import { Component, input } from '@angular/core';
import { httpResource } from '@angular/common/http';

interface Product {
  id: string;
  name: string;
  price: number;
  description: string;
}

@Component({
  selector: 'app-product-detail',
  template: `
    @if (product.isLoading()) {
      <div class="skeleton">Loading...</div>
    }
    @if (product.error()) {
      <div class="error">Failed to load product</div>
    }
    @if (product.value(); as p) {
      <h2>{{ p.name }}</h2>
      <p>{{ p.description }}</p>
      <span class="price">{{ p.price | currency }}</span>
    }
  `,
})
export class ProductDetailComponent {
  readonly productId = input.required<string>();

  readonly product = httpResource<Product>(() => ({
    url: `/api/products/${this.productId()}`,
  }));
}
```

### TanStack Query Angular

> **API Status: Experimental**
> The Angular adapter for TanStack Query (`@tanstack/angular-query-experimental`) carries the `-experimental` suffix. Breaking changes may occur in minor or patch releases.

When server-state requirements go beyond simple fetching, such as stale-while-revalidate caching, background refetch on window focus, query deduplication across components, optimistic mutations, or pagination with prefetching, TanStack Query is the most capable option available.

```typescript
// src/app/catalog/product-list.component.ts
import { Component, inject } from '@angular/core';
import {
  injectQuery,
  injectMutation,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { HttpClient } from '@angular/common/http';
import { lastValueFrom } from 'rxjs';

interface Product {
  id: string;
  name: string;
  price: number;
}

@Component({
  selector: 'app-product-list',
  template: `
    @if (products.isPending()) {
      <p>Loading products...</p>
    }
    @if (products.error(); as err) {
      <p class="error">{{ err.message }}</p>
    }
    @if (products.data(); as items) {
      @for (item of items; track item.id) {
        <div class="product-card">
          <span>{{ item.name }}</span>
          <span>{{ item.price | currency }}</span>
          <button (click)="deleteProduct(item.id)">Delete</button>
        </div>
      }
    }
  `,
})
export class ProductListComponent {
  private readonly http = inject(HttpClient);
  private readonly queryClient = inject(QueryClient);

  readonly products = injectQuery(() => ({
    queryKey: ['products'] as const,
    queryFn: () =>
      lastValueFrom(this.http.get<Product[]>('/api/products')),
    staleTime: 5 * 60 * 1000,
  }));

  private readonly deleteMutation = injectMutation(() => ({
    mutationFn: (id: string) =>
      lastValueFrom(this.http.delete(`/api/products/${id}`)),
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  }));

  deleteProduct(id: string): void {
    this.deleteMutation.mutate(id);
  }
}
```

TanStack Query manages only server state. You still need one of the four tiers above for client state like cart contents, UI preferences, or form drafts.

## The Decision Flowchart

When a new state requirement arrives, walk through these questions in order:

**Step 1: Is this local to one component?**
Yes: Use `signal()` and `computed()` inside the component. Stop here.

**Step 2: Is this server data that needs caching, background sync, or deduplication?**
Yes, simple case: Use `httpResource`. Stop here.
Yes, complex case (stale-while-revalidate, pagination, optimistic updates): Use TanStack Query. Stop here.

**Step 3: Do multiple components in the same feature need this data?**
Yes, team of fewer than five: Use an injectable service with signals (Tier 2). Stop here.
Yes, team of five or more: Use NgRx SignalStore (Tier 3). Stop here.

**Step 4: Does this state cross feature boundaries, require time-travel debugging, or need a strict action/reducer audit trail?**
Yes: Use NgRx Classic Store (Tier 4). Stop here.

**Step 5: None of the above?**
Re-read Step 1. You probably do not have a state problem.

## The Ten Golden Rules

These rules apply regardless of which tier or library you choose. Violating any one of them creates technical debt that compounds over time.

**1. Start local, escalate only when forced.** Every piece of state begins as a local signal. Promote it to a service only when a second consumer appears. Promote it to a store only when the service pattern becomes insufficient.

**2. One owner per piece of state.** If the same data lives in two places, it will diverge. Designate one service or store as the single source of truth. Every other consumer reads from it.

**3. Expose read-only, mutate through methods.** Components should never hold a reference to a writable signal from a service. Expose `.asReadonly()` or `computed()`. Mutations happen exclusively through the service's public methods.

**4. Keep state immutable.** Always create new object references on update. Use the spread operator, `Array.prototype.map`, `Array.prototype.filter`, or `patchState()`. Never mutate in place.

**5. Separate server state from client state.** Server state has a lifecycle tied to HTTP requests: loading, success, error, stale, refetching. Client state has a lifecycle tied to user interaction. Mixing them in the same store creates unnecessary coupling.

**6. Memoize every derived value.** If a value can be computed from other state, compute it with `computed()` or an NgRx selector. Never store derived data alongside source data.

**7. Normalize entity collections.** When your state contains lists of objects with IDs, store them in a dictionary keyed by ID with a separate array of IDs for ordering. This prevents duplication and makes lookups O(1). Use `@ngrx/entity` or `withEntities()`.

**8. Model every possible status.** A data fetch has at least four states: idle, loading, loaded, and error. Model them explicitly. If you only model the happy path, your UI will show stale data, broken spinners, or silent failures.

**9. Keep components dumb.** Components read state and call methods. They do not fetch data, transform responses, manage subscriptions, or decide what to cache. That logic lives in services or stores.

**10. Design data structures before choosing tools.** Sketch the shape of your state on paper. Identify which pieces are local, shared, or global. Map the relationships. Then pick the tool that fits the shape. If you pick the tool first, you will bend your data to fit the tool.

## Alternative Libraries: An Honest Comparison

Angular's ecosystem includes libraries beyond NgRx. If your team is evaluating alternatives, here is what you need to know.

### NGXS

NGXS (`@ngxs/store` v21.0.0) uses a decorator-based, class-centric API. You define state with `@State()`, handle actions with `@Action()`, and derive values with `@Selector()`. It offers a plugin ecosystem covering storage, forms, router integration, and WebSockets.

NGXS has partial signal support through `selectSignal()` and `createSelectMap()`, but there is no signal-native store definition. The NGXS team has explicitly chosen not to build their own signal store, instead providing bridge utilities that connect `@ngxs/store` with NgRx SignalStore.

**When NGXS makes sense:** Your team is already deeply invested in NGXS and a migration is not justified. The decorator-based API aligns with your team's mental model.

**When NGXS does not make sense:** New projects starting from scratch. Angular's direction is functional and signal-native. NGXS's class-and-decorator approach sits at odds with that trajectory.

### Elf

Elf (`@ngneat/elf` v2.5.1) is an RxJS-based, modular state management library. It offers separate tree-shakeable packages for entities, requests, pagination, persistence, and state history. The design philosophy is minimalist: a store is a `BehaviorSubject` with helper operators layered on top.

The core package has not been updated in approximately two years. There is no native signal support. Developers must bridge to signals manually with `toSignal()`.

**When Elf makes sense:** Your existing codebase uses Elf and works fine. You are not planning a major rewrite.

**When Elf does not make sense:** Any new project. The library is effectively in maintenance mode, and its RxJS-first design is misaligned with Angular's signal-first direction. If you are on Elf today, plan a gradual migration to NgRx SignalStore, which shares a similar philosophy of modular, composable store features.

### TanStack Query Angular

We covered TanStack Query earlier in this chapter as a server-state solution. It is not a general-purpose state management library. It does not manage client state. Use it in combination with one of the four tiers for client state.

### Plain Services with Signals (No Library)

This is Tier 2 of our framework and deserves emphasis because many teams overlook it. A well-structured injectable service with signals provides zero-dependency state management that is perfectly aligned with Angular's direction. You get full control, minimal bundle impact, and no learning curve beyond Angular's core API.

The trade-off is enforcement. Without a framework constraining patterns, teams must self-enforce consistency through code reviews and conventions. For teams of two to five developers who communicate well, this is often the best choice. For larger teams, the lack of enforced structure typically leads to drift.

## The Code Review Checklist

Paste this checklist into your team's pull request template. Every state-related PR should pass every applicable item.

**Architecture**
- [ ] State scope is appropriate (local signal, feature service, or global store)
- [ ] State has a single, clearly identified owner
- [ ] No duplicate state across multiple stores or services
- [ ] Server state is separated from client state
- [ ] Feature stores are provided at the feature level, not at root

**Immutability and Encapsulation**
- [ ] All state updates create new references (no in-place mutation)
- [ ] Mutations happen only inside the store or service, never in components
- [ ] State is exposed as read-only (`asReadonly()`, `computed()`)
- [ ] `patchState()` or spread operators are used for updates

**Derived State and Reactivity**
- [ ] Derived values use `computed()` or memoized selectors
- [ ] No manual subscriptions in components (use signals or `async` pipe)
- [ ] No nested `subscribe()` calls
- [ ] Side effects are isolated in `withEventHandlers()`, `createEffect()`, or service methods

**Performance**
- [ ] Ephemeral UI state (tooltips, modals) is not in a global store
- [ ] Entity collections are normalized (ID-indexed dictionary + ID array)
- [ ] Custom signal equality functions are specified where default reference equality is too aggressive

**Error Handling**
- [ ] Every async operation tracks loading, success, and error states
- [ ] Error state is cleared when the operation is retried
- [ ] Optimistic updates include rollback logic

## Common Mistakes

### Mistake 1: Putting Everything in a Global Store

```typescript
// src/app/state/app.state.ts
// WRONG: Global store managing local UI concerns
interface AppState {
  sidebarOpen: boolean;
  tooltipVisible: boolean;
  modalStack: string[];
  currentDropdownId: string | null;
  products: Product[];
  cart: CartItem[];
  user: User | null;
}
```

Sidebar visibility, tooltip state, and dropdown tracking are local UI concerns that belong in the components that own them. Putting them in a global store means every sidebar toggle dispatches an action, passes through a reducer, notifies all subscribers, and shows up in DevTools. This is overhead with zero benefit.

```typescript
// CORRECT: Global store manages only truly shared state
// src/app/state/app.state.ts
interface AppState {
  products: Product[];
  cart: CartItem[];
  user: User | null;
}

// Sidebar state stays in the sidebar component
// src/app/shell/sidebar.component.ts
export class SidebarComponent {
  readonly isOpen = signal(false);

  toggle(): void {
    this.isOpen.update(v => !v);
  }
}
```

**Why this matters:** Global state is a shared dependency. Every piece of data you add to it increases the coupling surface. Local UI state changes frequently, often on every mouse event. Routing those changes through a global store creates unnecessary noise in DevTools and can trigger unrelated recomputation.

### Mistake 2: Exposing Writable Signals from Services

```typescript
// src/app/auth/auth.service.ts
// WRONG: Writable signal is public
@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly currentUser = signal<User | null>(null);

  login(credentials: Credentials): void {
    // ...
    this.currentUser.set(user);
  }
}
```

Any component can now call `authService.currentUser.set(null)` and log the user out without going through the proper logout flow. The service has lost ownership of its state.

```typescript
// src/app/auth/auth.service.ts
// CORRECT: Private writable, public read-only
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly _currentUser = signal<User | null>(null);
  readonly currentUser = this._currentUser.asReadonly();

  login(credentials: Credentials): void {
    // ...
    this._currentUser.set(user);
  }

  logout(): void {
    // Proper cleanup logic
    this._currentUser.set(null);
  }
}
```

**Why this matters:** Encapsulation is the foundation of predictable state. When any consumer can write to state, you lose the ability to reason about when and why state changes. Debugging becomes a search through the entire codebase for `.set()` and `.update()` calls.

### Mistake 3: Storing Derived Data Alongside Source Data

```typescript
// src/app/cart/cart.store.ts
// WRONG: Derived data stored in state
interface CartState {
  items: CartItem[];
  totalPrice: number;    // derived from items
  itemCount: number;     // derived from items
  hasDiscount: boolean;  // derived from totalPrice
}
```

Every mutation must now update four fields instead of one. Miss one and the state is inconsistent. The `totalPrice` field will inevitably get out of sync with `items` after a late-night bug fix that updates items but forgets to recalculate the total.

```typescript
// src/app/cart/cart.store.ts
// CORRECT: Derive everything from the source
interface CartState {
  items: CartItem[];
}

// In a SignalStore:
withComputed(({ items }) => ({
  totalPrice: computed(() =>
    items().reduce((sum, i) => sum + i.price * i.quantity, 0)
  ),
  itemCount: computed(() =>
    items().reduce((sum, i) => sum + i.quantity, 0)
  ),
  hasDiscount: computed(() =>
    items().reduce((sum, i) => sum + i.price * i.quantity, 0) > 100
  ),
}))
```

**Why this matters:** Derived values computed lazily via `computed()` are always consistent with their source. Stored derived values require manual synchronization, which is a bug waiting to happen. Memoization ensures the computation only runs when the source changes.

### Mistake 4: Choosing a Library Before Designing the Data

A team decides to use NgRx Classic Store on day one of a new project. They create actions, reducers, selectors, and effects for a simple CRUD feature. The feature has three entities, no cross-feature dependencies, and two developers. After two weeks, they have written 14 files for what could have been one service with three signals.

**Why this matters:** Premature adoption of heavy patterns creates drag on every feature. The code review checklist gets longer, onboarding takes longer, and developers spend more time satisfying the framework than solving business problems. Start at Tier 1, climb to Tier 2 when you need to share state, and consider Tier 3 or 4 only when the evidence demands it.

### Mistake 5: Mixing Server Fetching with Client State Logic

```typescript
// src/app/products/products.store.ts
// WRONG: HTTP call inside state update logic
@Injectable({ providedIn: 'root' })
export class ProductStore {
  private readonly http = inject(HttpClient);
  private readonly _products = signal<Product[]>([]);
  private readonly _loading = signal(false);

  readonly products = this._products.asReadonly();

  loadAndFilterByCategory(category: string): void {
    this._loading.set(true);
    this.http.get<Product[]>('/api/products').subscribe(all => {
      this._products.set(all.filter(p => p.category === category));
      this._loading.set(false);
    });
  }
}
```

This method fetches data and applies a client-side filter in the same operation. If the user switches categories, a new HTTP request fires even though the data is already available. The filtering logic is entangled with the fetching logic.

```typescript
// src/app/products/product-api.service.ts
// CORRECT: Separate data access from state
@Injectable({ providedIn: 'root' })
export class ProductApiService {
  private readonly http = inject(HttpClient);

  getAll(): Observable<Product[]> {
    return this.http.get<Product[]>('/api/products');
  }
}

// src/app/products/products.store.ts
@Injectable({ providedIn: 'root' })
export class ProductStore {
  private readonly api = inject(ProductApiService);
  private readonly _allProducts = signal<Product[]>([]);
  private readonly _selectedCategory = signal<string>('all');

  readonly selectedCategory = this._selectedCategory.asReadonly();
  readonly filteredProducts = computed(() => {
    const cat = this._selectedCategory();
    const all = this._allProducts();
    return cat === 'all' ? all : all.filter(p => p.category === cat);
  });

  selectCategory(category: string): void {
    this._selectedCategory.set(category);
  }

  async loadProducts(): Promise<void> {
    const products = await firstValueFrom(this.api.getAll());
    this._allProducts.set(products);
  }
}
```

**Why this matters:** Separating data access from state management lets you change the fetching strategy (add caching, switch to `httpResource`, adopt TanStack Query) without touching your state logic. It also means filtering is instant because it operates on already-loaded data.

## Key Takeaways

- **Start at the lowest tier that solves your problem.** A `signal()` in a component is not a compromise. It is the architecturally correct choice for local state. Climb to services, SignalStore, or Classic Store only when the evidence demands it.

- **Server state and client state require different tools.** Use `httpResource` or TanStack Query for server data. Use services or stores for client data. Never conflate the two in a single abstraction.

- **The ten golden rules apply to every tier.** Regardless of whether you use plain signals or a global Redux store, the principles of single ownership, read-only exposure, immutable updates, and memoized derived state are non-negotiable.

- **Paste the code review checklist into your team wiki today.** Architectural rules that exist only as tribal knowledge will erode. A concrete checklist in every PR template enforces consistency without requiring a senior architect to review every change.

- **Evaluate alternative libraries honestly.** NGXS is viable for existing codebases but is not the best choice for new Angular 21 projects. Elf is effectively unmaintained. TanStack Query excels at server state but does not replace a client state solution. NgRx SignalStore is the closest match to Angular's signal-first direction for structured state management.
