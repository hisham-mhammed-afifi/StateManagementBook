# Chapter 3: State Without Libraries: Services and RxJS

Your product catalog needs a feature: when the user selects a category filter, the product list updates, and the header badge shows the count of filtered results. Three components need the same data at the same time. You could wire signals through input/output chains, but the header is four levels above the product list in the component tree, and the filter sidebar is in a completely different branch. Prop drilling signals through intermediate components that do not care about products is tedious, brittle, and pollutes those components with irrelevant APIs. You need a shared state container that any component can inject, and you do not need a library to build one.

This chapter builds service-based state management from scratch using Angular's dependency injection and RxJS. We will create a reusable pattern using `BehaviorSubject`, consume it with the `async` pipe, add HTTP caching with `shareReplay`, and handle cleanup with `takeUntilDestroyed`. By the end, you will have a state management pattern that handles 80% of real-world feature state. The remaining 20% (complex action/reducer flows, entity normalization, DevTools) is what drives teams to libraries like NgRx, which we cover starting in Part 3.

Chapter 2 established three rules: unidirectional data flow, immutability, and single source of truth. Everything in this chapter applies those rules. Services own state privately and expose it read-only. Every update creates new references. Derived data is computed, never duplicated. The difference is the tool: RxJS Observables instead of signals. We will bridge the two at the end of the chapter with a teaser of `toSignal()`, which gets full coverage in Chapter 4.

## The BehaviorSubject State Service

The foundation of library-free state management is an injectable service that holds a `BehaviorSubject`. A `BehaviorSubject` is an Observable that requires an initial value and always has a current value. It emits its current value to new subscribers immediately, which means components that inject the service will always get data, even if they subscribe after the state was set.

The pattern has three parts:

1. A private `BehaviorSubject` that holds the full state object.
2. Public read-only Observables that expose slices of state.
3. Public methods that produce new state immutably.

This mirrors the writable-inside, read-only-outside pattern from Chapter 2, but with Observables instead of signals.

```typescript
// src/app/products/product-state.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { map, distinctUntilChanged } from 'rxjs';

export interface Product {
  id: number;
  name: string;
  price: number;
  category: string;
}

export interface ProductState {
  products: Product[];
  selectedCategory: string | null;
  loading: boolean;
  error: string | null;
}

const initialState: ProductState = {
  products: [],
  selectedCategory: null,
  loading: false,
  error: null,
};

@Injectable({ providedIn: 'root' })
export class ProductStateService {
  private readonly state$ = new BehaviorSubject<ProductState>(initialState);

  // Read-only selectors
  readonly products$ = this.select(s => s.products);
  readonly selectedCategory$ = this.select(s => s.selectedCategory);
  readonly loading$ = this.select(s => s.loading);
  readonly error$ = this.select(s => s.error);

  readonly filteredProducts$ = this.state$.pipe(
    map(s => {
      if (s.selectedCategory === null) return s.products;
      return s.products.filter(p => p.category === s.selectedCategory);
    }),
    distinctUntilChanged()
  );

  readonly filteredCount$ = this.filteredProducts$.pipe(
    map(products => products.length),
    distinctUntilChanged()
  );

  private select<R>(selector: (state: ProductState) => R): Observable<R> {
    return this.state$.pipe(map(selector), distinctUntilChanged());
  }

  private setState(patch: Partial<ProductState>): void {
    const current = this.state$.getValue();
    this.state$.next({ ...current, ...patch });
  }

  setLoading(): void {
    this.setState({ loading: true, error: null });
  }

  setProducts(products: Product[]): void {
    this.setState({ products, loading: false });
  }

  setError(error: string): void {
    this.setState({ error, loading: false });
  }

  setCategory(category: string | null): void {
    this.setState({ selectedCategory: category });
  }
}
```

Let us walk through the key design decisions.

**Private `BehaviorSubject`, public Observables.** The `state$` field is private. No component can call `state$.next()`. This enforces unidirectional data flow: data flows out through Observables, changes flow in through methods.

**The `select()` helper.** This private method takes a projection function, maps the state stream to a specific slice, and applies `distinctUntilChanged()`. The result is an Observable that only emits when that particular slice actually changes. If a `setLoading()` call does not change the `products` array, the `products$` Observable stays silent. This is the Observable equivalent of `computed()`.

**The `setState()` helper.** This method reads the current state with `getValue()`, spreads the current state with the patch, and pushes a new object via `.next()`. The spread operator guarantees immutability: every call to `setState` produces a new state object.

**Derived state.** `filteredProducts$` and `filteredCount$` are not stored state. They are computed from the state stream. If we stored filtered products separately, we would have two copies of the product data and the synchronization problems Chapter 2 warned about.

## Consuming State with the Async Pipe

The `async` pipe is the primary way to consume Observables in templates. It subscribes when the component renders, unsubscribes when the component is destroyed, and triggers change detection on each emission. In zoneless Angular 21, it works correctly because it calls `markForCheck()` internally.

```typescript
// src/app/products/product-list.component.ts
import { Component, inject } from '@angular/core';
import { AsyncPipe, CurrencyPipe } from '@angular/common';
import { ProductStateService } from './product-state.service';

@Component({
  selector: 'app-product-list',
  standalone: true,
  imports: [AsyncPipe, CurrencyPipe],
  template: `
    @if (loading$ | async) {
      <p>Loading products...</p>
    } @else if (error$ | async; as error) {
      <p class="error">{{ error }}</p>
    } @else {
      <p>{{ filteredCount$ | async }} products found</p>
      @for (product of filteredProducts$ | async; track product.id) {
        <div class="product-card">
          <h3>{{ product.name }}</h3>
          <p>{{ product.price | currency }}</p>
          <span class="category">{{ product.category }}</span>
        </div>
      }
    }
  `,
})
export class ProductListComponent {
  private readonly productState = inject(ProductStateService);

  readonly filteredProducts$ = this.productState.filteredProducts$;
  readonly filteredCount$ = this.productState.filteredCount$;
  readonly loading$ = this.productState.loading$;
  readonly error$ = this.productState.error$;
}
```

```typescript
// src/app/products/category-filter.component.ts
import { Component, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { ProductStateService } from './product-state.service';

@Component({
  selector: 'app-category-filter',
  standalone: true,
  imports: [AsyncPipe],
  template: `
    <div class="filter-bar">
      <button
        [class.active]="(selectedCategory$ | async) === null"
        (click)="selectCategory(null)"
      >
        All
      </button>
      <button
        [class.active]="(selectedCategory$ | async) === 'Electronics'"
        (click)="selectCategory('Electronics')"
      >
        Electronics
      </button>
      <button
        [class.active]="(selectedCategory$ | async) === 'Furniture'"
        (click)="selectCategory('Furniture')"
      >
        Furniture
      </button>
    </div>
  `,
})
export class CategoryFilterComponent {
  private readonly productState = inject(ProductStateService);

  readonly selectedCategory$ = this.productState.selectedCategory$;

  selectCategory(category: string | null): void {
    this.productState.setCategory(category);
  }
}
```

```typescript
// src/app/layout/header.component.ts
import { Component, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { ProductStateService } from '../products/product-state.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [AsyncPipe],
  template: `
    <header>
      <h1>Product Catalog</h1>
      <span class="badge">{{ filteredCount$ | async }} products</span>
    </header>
  `,
})
export class HeaderComponent {
  private readonly productState = inject(ProductStateService);
  readonly filteredCount$ = this.productState.filteredCount$;
}
```

Three components, three different positions in the component tree, all reading from the same state service. When `CategoryFilterComponent` calls `setCategory('Electronics')`, `ProductListComponent` and `HeaderComponent` update automatically. No input chains, no event bubbling, no shared parent orchestrating data flow. The service is the single source of truth, and RxJS propagates changes to every subscriber.

## BehaviorSubject vs ReplaySubject

`BehaviorSubject` requires an initial value. When there is no meaningful initial state, `ReplaySubject` is the better choice.

Consider a user profile that only exists after authentication. Before the user logs in, there is no profile. Using a `BehaviorSubject<UserProfile | null>` with `null` as the initial value works, but every subscriber must handle the `null` case even when the component is guaranteed to render only after login. `ReplaySubject` avoids this problem by not emitting until the first value is set.

```typescript
// src/app/auth/user-profile.service.ts
import { Injectable } from '@angular/core';
import { ReplaySubject } from 'rxjs';

export interface UserProfile {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'editor' | 'viewer';
}

@Injectable({ providedIn: 'root' })
export class UserProfileService {
  private readonly profile$$ = new ReplaySubject<UserProfile>(1);
  readonly profile$ = this.profile$$.asObservable();

  setProfile(profile: UserProfile): void {
    this.profile$$.next(profile);
  }

  clearProfile(): void {
    // ReplaySubject has no "reset." Create a convention:
    // subscribers that need to handle logout should use
    // a separate isAuthenticated$ Observable or combine
    // with a BehaviorSubject<boolean>.
  }
}
```

The `1` in `new ReplaySubject<UserProfile>(1)` is the buffer size: replay the most recent emission to new subscribers. Without this argument, `ReplaySubject` replays its entire history, which is almost never what you want for state management.

**When to use which:**

| Scenario | Subject type |
|---|---|
| State with a known initial value (loading flags, empty arrays, default filters) | `BehaviorSubject` |
| State that has no meaningful value until an async operation completes (user profile, OAuth token) | `ReplaySubject(1)` |
| Event stream where you never need the "current value" (button clicks, WebSocket messages) | `Subject` |

## HTTP Caching with shareReplay

When multiple components subscribe to the same HTTP call, each subscription triggers a separate request by default. The `shareReplay` operator multicasts the Observable and replays the most recent emission, so all subscribers share a single HTTP call.

```typescript
// src/app/categories/category.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { shareReplay } from 'rxjs';

export interface Category {
  id: number;
  name: string;
  productCount: number;
}

@Injectable({ providedIn: 'root' })
export class CategoryService {
  private readonly http = inject(HttpClient);

  readonly categories$ = this.http.get<Category[]>('/api/categories').pipe(
    shareReplay({ bufferSize: 1, refCount: true })
  );
}
```

The `{ bufferSize: 1, refCount: true }` configuration is critical. The shorthand `shareReplay(1)` defaults to `refCount: false`, which means the inner subscription is never cleaned up, even after all subscribers unsubscribe. This is a memory leak that will persist for the lifetime of the application.

With `refCount: true`, the inner subscription is torn down when the subscriber count drops to zero. This is the correct behavior for most cases, but it has one implication: if all components unsubscribe (for example, inside an `@if` block that evaluates to false) and then resubscribe, the HTTP call fires again. If this is unacceptable, you have two options:

1. Keep `refCount: false` and accept the one-time memory cost (appropriate for singleton services that live for the entire application lifetime).
2. Cache the result in a `BehaviorSubject` yourself, which gives you full control over the lifecycle.

```typescript
// src/app/categories/category-cached.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, tap, Observable, of, switchMap } from 'rxjs';

export interface Category {
  id: number;
  name: string;
  productCount: number;
}

@Injectable({ providedIn: 'root' })
export class CategoryCachedService {
  private readonly http = inject(HttpClient);
  private readonly cache$ = new BehaviorSubject<Category[] | null>(null);
  private loading = false;

  readonly categories$: Observable<Category[]> = this.cache$.pipe(
    switchMap(cached => {
      if (cached !== null) {
        return of(cached);
      }
      if (this.loading) {
        return this.cache$.pipe(
          switchMap(val => val !== null ? of(val) : [])
        );
      }
      this.loading = true;
      return this.http.get<Category[]>('/api/categories').pipe(
        tap(categories => {
          this.cache$.next(categories);
          this.loading = false;
        })
      );
    })
  );

  invalidateCache(): void {
    this.cache$.next(null);
    this.loading = false;
  }
}
```

This is more code than `shareReplay`, but it gives you explicit control: you can invalidate the cache, check whether data has been loaded, and avoid re-fetching regardless of subscriber count. For simple caching, `shareReplay({ bufferSize: 1, refCount: true })` is sufficient. For features that need cache invalidation (product lists that change when the user adds a new product), the explicit `BehaviorSubject` approach is more appropriate.

## The scan Operator: Redux in Plain RxJS

The `scan` operator accumulates state over a stream of actions, exactly like a Redux reducer. This pattern bridges the gap between simple service state and the formal action/reducer pattern that NgRx introduces in Chapter 8.

```typescript
// src/app/cart/cart.service.ts
import { Injectable } from '@angular/core';
import { Subject, scan, startWith, map, distinctUntilChanged } from 'rxjs';

export interface CartItem {
  productId: number;
  name: string;
  price: number;
  quantity: number;
}

type CartAction =
  | { type: 'add'; productId: number; name: string; price: number }
  | { type: 'remove'; productId: number }
  | { type: 'updateQuantity'; productId: number; quantity: number }
  | { type: 'clear' };

@Injectable({ providedIn: 'root' })
export class CartService {
  private readonly actions$ = new Subject<CartAction>();

  readonly cart$ = this.actions$.pipe(
    scan((items: CartItem[], action: CartAction) => {
      switch (action.type) {
        case 'add': {
          const existing = items.find(i => i.productId === action.productId);
          if (existing) {
            return items.map(i =>
              i.productId === action.productId
                ? { ...i, quantity: i.quantity + 1 }
                : i
            );
          }
          return [
            ...items,
            {
              productId: action.productId,
              name: action.name,
              price: action.price,
              quantity: 1,
            },
          ];
        }
        case 'remove':
          return items.filter(i => i.productId !== action.productId);
        case 'updateQuantity':
          return items.map(i =>
            i.productId === action.productId
              ? { ...i, quantity: action.quantity }
              : i
          );
        case 'clear':
          return [];
      }
    }, [] as CartItem[]),
    startWith([] as CartItem[])
  );

  readonly totalPrice$ = this.cart$.pipe(
    map(items => items.reduce((sum, i) => sum + i.price * i.quantity, 0)),
    distinctUntilChanged()
  );

  readonly itemCount$ = this.cart$.pipe(
    map(items => items.reduce((sum, i) => sum + i.quantity, 0)),
    distinctUntilChanged()
  );

  addItem(productId: number, name: string, price: number): void {
    this.actions$.next({ type: 'add', productId, name, price });
  }

  removeItem(productId: number): void {
    this.actions$.next({ type: 'remove', productId });
  }

  updateQuantity(productId: number, quantity: number): void {
    this.actions$.next({ type: 'updateQuantity', productId, quantity });
  }

  clear(): void {
    this.actions$.next({ type: 'clear' });
  }
}
```

The `scan` callback is a pure function: given the current state and an action, it returns new state. No side effects, no mutations, no dependencies on external variables. This is exactly the shape of an NgRx reducer. The public methods (`addItem`, `removeItem`, etc.) are equivalent to action creators. The `actions$` Subject is equivalent to the NgRx action stream.

This is not just an academic exercise. If you later decide that your cart needs DevTools support, undo/redo, or persistence across micro-frontends, migrating from this `scan` pattern to NgRx is a mechanical transformation rather than an architectural rewrite. The concepts are identical; only the ceremony changes.

## Managing Subscription Cleanup with takeUntilDestroyed

The `async` pipe handles subscription cleanup automatically. But when you need to subscribe manually in component code (for side effects like logging, analytics, or imperative DOM operations), you must unsubscribe when the component is destroyed. Failing to do so creates memory leaks.

The modern solution is `takeUntilDestroyed()` from `@angular/core/rxjs-interop`. It automatically completes the Observable when the component's `DestroyRef` fires.

```typescript
// src/app/products/product-analytics.component.ts
import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ProductStateService } from './product-state.service';

@Component({
  selector: 'app-product-analytics',
  standalone: true,
  template: `<div>Analytics tracker active</div>`,
})
export class ProductAnalyticsComponent {
  private readonly productState = inject(ProductStateService);

  constructor() {
    this.productState.filteredProducts$
      .pipe(takeUntilDestroyed())
      .subscribe(products => {
        console.log('Product view updated:', products.length, 'items');
        // Send analytics event to tracking service
      });
  }
}
```

`takeUntilDestroyed()` must be called in an injection context: inside a constructor, a field initializer, or a factory function passed to `inject()`. Calling it inside a method that runs after construction throws `NG0203`. If you need to subscribe outside the constructor, inject `DestroyRef` and pass it explicitly:

```typescript
// src/app/products/product-logger.component.ts
import { Component, inject, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ProductStateService } from './product-state.service';

@Component({
  selector: 'app-product-logger',
  standalone: true,
  template: `<button (click)="startLogging()">Start Logging</button>`,
})
export class ProductLoggerComponent {
  private readonly productState = inject(ProductStateService);
  private readonly destroyRef = inject(DestroyRef);

  startLogging(): void {
    this.productState.products$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(products => {
        console.log('Products changed:', products.length);
      });
  }
}
```

## Bridging to Signals: A Teaser

Everything in this chapter uses Observables. But Chapter 2 built all its examples with signals. Which should you use?

The answer, increasingly, is both. RxJS excels at async event streams: HTTP responses, WebSocket messages, user interactions that need debouncing or throttling. Signals excel at synchronous state that templates read directly. The bridge between them is `toSignal()` and `toObservable()` from `@angular/core/rxjs-interop`.

Here is the product list component rewritten to consume the Observable-based state service through signals:

```typescript
// src/app/products/product-list-signals.component.ts
import { Component, inject, computed } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CurrencyPipe } from '@angular/common';
import { ProductStateService } from './product-state.service';

@Component({
  selector: 'app-product-list',
  standalone: true,
  imports: [CurrencyPipe],
  template: `
    @if (loading()) {
      <p>Loading products...</p>
    } @else {
      <p>{{ count() }} products found</p>
      @for (product of filteredProducts(); track product.id) {
        <div class="product-card">
          <h3>{{ product.name }}</h3>
          <p>{{ product.price | currency }}</p>
          <span class="category">{{ product.category }}</span>
        </div>
      }
    }
  `,
})
export class ProductListSignalsComponent {
  private readonly productState = inject(ProductStateService);

  readonly filteredProducts = toSignal(this.productState.filteredProducts$, {
    initialValue: [],
  });
  readonly loading = toSignal(this.productState.loading$, {
    initialValue: false,
  });

  readonly count = computed(() => this.filteredProducts().length);
}
```

Notice what changed. The template no longer uses the `async` pipe. Instead, `toSignal()` converts each Observable into a signal, and the template reads signals directly with function calls (`loading()`, `filteredProducts()`). The `computed()` signal for `count` replaces the `filteredCount$` Observable. No `combineLatest`, no extra `pipe()` chains.

The `initialValue` option provides a synchronous default before the first Observable emission. For Observables backed by `BehaviorSubject` (which always has a current value), you can use `{ requireSync: true }` instead to eliminate the `undefined` type from the signal:

```typescript
// src/app/products/product-list-sync.component.ts
import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ProductStateService } from './product-state.service';

@Component({
  selector: 'app-product-list-sync',
  standalone: true,
  template: `<p>{{ products().length }} products</p>`,
})
export class ProductListSyncComponent {
  private readonly productState = inject(ProductStateService);

  // BehaviorSubject emits synchronously, so requireSync is safe.
  // Signal type is Product[] (not Product[] | undefined).
  readonly products = toSignal(this.productState.products$, {
    requireSync: true,
  });
}
```

We will explore signals in depth in Chapter 4. For now, the key insight is that your Observable-based state services are not throwaway code. They are fully compatible with the signal-based future through `toSignal()`. You do not need to rewrite them; you bridge them.

## When Service State Is Not Enough

The pattern in this chapter is powerful, but it has limits. As your application grows, you may hit these friction points:

- **No DevTools.** You cannot inspect state changes over time, replay actions, or time-travel debug. You are limited to `console.log` and browser breakpoints.
- **No action tracing.** When a bug occurs, you cannot trace which method call caused the state change. Every `setState` call looks the same from the outside.
- **No entity management.** If your state contains collections of items with unique IDs, you will rewrite the same "find by ID, update immutably, remove by ID" logic in every service. NgRx Entity (Chapter 11) and SignalStore's `withEntities` (Chapter 16) eliminate this duplication.
- **Side effect orchestration.** When an API call should trigger a navigation, show a toast, and invalidate a cache, coordinating these side effects in a service method becomes tangled. NgRx Effects (Chapter 10) and SignalStore's `withEventHandlers` (Chapter 19) formalize this coordination.

None of these limitations make service-based state wrong. They make it insufficient for specific complexity thresholds. The progression is natural: start with services, and reach for a library only when you hit a concrete pain point that the library solves. Chapter 38 provides a decision framework for exactly this question.

## Common Mistakes

### Mistake 1: Exposing the BehaviorSubject Directly

```typescript
// WRONG
@Injectable({ providedIn: 'root' })
export class ProductService {
  readonly state$ = new BehaviorSubject<ProductState>(initialState);
}
```

Any component can call `productService.state$.next(...)`, bypassing all validation and logging. This breaks unidirectional data flow. Any component becomes a state producer, and debugging becomes a hunt through every file that injects the service.

```typescript
// CORRECT
@Injectable({ providedIn: 'root' })
export class ProductService {
  private readonly state$ = new BehaviorSubject<ProductState>(initialState);
  readonly products$ = this.state$.pipe(map(s => s.products), distinctUntilChanged());

  setProducts(products: Product[]): void {
    const current = this.state$.getValue();
    this.state$.next({ ...current, products, loading: false });
  }
}
```

The `BehaviorSubject` is private. State flows out through derived Observables. Changes flow in through methods.

### Mistake 2: Using shareReplay Without refCount

```typescript
// WRONG: memory leak
readonly data$ = this.http.get<Data[]>('/api/data').pipe(
  shareReplay(1)
);
```

The shorthand `shareReplay(1)` sets `refCount` to `false`. The inner subscription persists forever, even after all components that used this data are destroyed.

```typescript
// CORRECT
readonly data$ = this.http.get<Data[]>('/api/data').pipe(
  shareReplay({ bufferSize: 1, refCount: true })
);
```

Always use the object form with `refCount: true` unless you have a specific reason to keep the subscription alive indefinitely.

### Mistake 3: Mutating State Retrieved from getValue()

```typescript
// WRONG
addProduct(product: Product): void {
  const state = this.state$.getValue();
  state.products.push(product); // mutates the existing array
  this.state$.next(state);      // same reference, distinctUntilChanged ignores it
}
```

This mutates the existing array in place. Because the state object reference is the same, `distinctUntilChanged` in any `select()` chain sees no change. Derived Observables stay silent, and the UI is stale.

```typescript
// CORRECT
addProduct(product: Product): void {
  const current = this.state$.getValue();
  this.state$.next({
    ...current,
    products: [...current.products, product],
  });
}
```

Every update must produce new references for both the state object and any nested arrays or objects that changed.

### Mistake 4: Forgetting Cleanup on Manual Subscriptions

```typescript
// WRONG: memory leak
export class DashboardComponent {
  private readonly analytics = inject(AnalyticsService);

  ngOnInit(): void {
    this.analytics.events$.subscribe(event => {
      console.log(event);
    });
  }
}
```

The subscription lives on after the component is destroyed. If this component is inside a route that the user navigates away from and back to, each visit creates a new subscription without cleaning up the old one.

```typescript
// CORRECT
export class DashboardComponent {
  private readonly analytics = inject(AnalyticsService);

  constructor() {
    this.analytics.events$
      .pipe(takeUntilDestroyed())
      .subscribe(event => {
        console.log(event);
      });
  }
}
```

Use `takeUntilDestroyed()` for every manual subscription. Prefer the `async` pipe in templates whenever possible, as it handles cleanup automatically.

## Key Takeaways

- **A BehaviorSubject state service is the simplest shared state pattern in Angular.** Private subject, public read-only Observables, controlled mutation through methods. This enforces all three principles from Chapter 2 without any third-party dependency.

- **Use `distinctUntilChanged()` on every selector Observable.** Without it, every `setState` call triggers emissions on every selector, even when that particular slice did not change. This wastes rendering cycles and makes `@if` blocks flicker.

- **Always use `shareReplay({ bufferSize: 1, refCount: true })` for HTTP caching.** The shorthand `shareReplay(1)` leaks memory. The object form with `refCount: true` cleans up when all subscribers unsubscribe.

- **The `scan` operator is a Redux reducer without the library.** It accumulates state from an action stream, making migration to NgRx a mechanical step rather than a conceptual leap. Use it when your state transitions follow an action/reducer pattern.

- **Observable state services bridge seamlessly to signals with `toSignal()`.** You do not need to rewrite existing services to adopt signals in your components. Convert at the consumption point and let the service layer stay in RxJS.
