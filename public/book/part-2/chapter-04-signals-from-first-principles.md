# Chapter 4: Signals from First Principles

Your product catalog has a category filter, a sort dropdown, and a header badge showing the filtered count. In Chapter 3 we built this with `BehaviorSubject`, `distinctUntilChanged`, and the `async` pipe. It works, but count the moving parts: a private subject, a `select()` helper, a `setState()` helper, `map` and `distinctUntilChanged` on every selector, `async` pipes in every template, and `takeUntilDestroyed` on every manual subscription. That is a lot of plumbing for what amounts to "three values that depend on each other."

Signals eliminate that plumbing. A `signal` holds a value. A `computed` derives a new value from other signals. An `effect` runs a side effect when signals change. A `linkedSignal` creates a writable value that resets when its source changes. Four primitives, no operators, no subscriptions, no cleanup. In this chapter we build signals from scratch, understand how Angular tracks dependencies behind the scenes, and rebuild the product catalog with zero RxJS. By the end, you will know exactly when to reach for each primitive and why.

## What Is a Signal?

A signal is a wrapper around a value that notifies Angular when that value changes. You create one with the `signal()` function, read it by calling it like a function, and write to it with `set()` or `update()`.

```typescript
// src/app/examples/signal-basics.ts
import { signal } from '@angular/core';

const count = signal(0);

console.log(count()); // 0

count.set(5);
console.log(count()); // 5

count.update(current => current + 1);
console.log(count()); // 6
```

That is the entire read/write API. There is no `subscribe`. There is no `pipe`. You call the signal like a function to read it, and Angular figures out who depends on it.

The full signature is:

```typescript
// API Reference
signal<T>(initialValue: T, options?: { equal?: (a: T, b: T) => boolean; debugName?: string }): WritableSignal<T>
```

`WritableSignal<T>` extends `Signal<T>` with three methods:

- `set(value)` replaces the value outright.
- `update(fn)` computes a new value from the current one. Use this when the next value depends on the previous value.
- `asReadonly()` returns a `Signal<T>` view. The underlying value still updates, but consumers cannot call `set()` or `update()`. This is the signal equivalent of making a `BehaviorSubject` private and exposing it as an `Observable`.

### Equality and Notifications

Signals use `Object.is()` for equality by default. For primitives, this means value comparison: setting a signal to the same number it already holds does nothing. For objects and arrays, it means reference comparison: setting a signal to a new object with identical contents counts as a change, because the reference is different.

```typescript
// src/app/examples/signal-equality.ts
import { signal } from '@angular/core';

const name = signal('Alice');
name.set('Alice'); // No notification. Same value.

const user = signal({ name: 'Alice', age: 30 });
user.set({ name: 'Alice', age: 30 }); // Notification! Different reference.
```

When reference equality is too coarse, pass a custom equality function:

```typescript
// src/app/examples/custom-equality.ts
import { signal } from '@angular/core';

interface User {
  id: number;
  name: string;
  lastSeen: Date;
}

const currentUser = signal<User>(
  { id: 1, name: 'Alice', lastSeen: new Date() },
  { equal: (a, b) => a.id === b.id && a.name === b.name }
);

// Updating only lastSeen produces no notification,
// because id and name have not changed.
currentUser.set({ id: 1, name: 'Alice', lastSeen: new Date() });
```

Custom equality is a scalpel, not a default. Use it when you know that a specific property (like `lastSeen` or a `version` timestamp) changes frequently but does not affect the UI. Deep equality with something like `lodash.isEqual` is possible but expensive for large objects.

## Derived State with computed()

A `computed` signal derives its value from other signals. Angular tracks which signals you read inside the computation function and re-evaluates only when those dependencies change.

```typescript
// src/app/examples/computed-basics.ts
import { signal, computed } from '@angular/core';

const price = signal(29.99);
const quantity = signal(3);

const total = computed(() => price() * quantity());

console.log(total()); // 89.97

quantity.set(5);
console.log(total()); // 149.95
```

The full signature:

```typescript
// API Reference
computed<T>(computation: () => T, options?: { equal?: (a: T, b: T) => boolean; debugName?: string }): Signal<T>
```

Three properties make `computed` the workhorse of the signal system:

**Lazy evaluation.** The computation does not run until something reads the signal. If nothing reads `total()`, the multiplication never happens. This is the opposite of an Observable chain with `combineLatest`, which runs eagerly.

**Memoization.** Once computed, the result is cached. Subsequent reads return the cached value at zero cost. Re-computation happens only when a dependency changes AND the computed signal is read again.

**Purity.** The computation function must be pure: no side effects, no HTTP calls, no DOM manipulation. Angular may re-evaluate it multiple times during optimization passes. If you need side effects, that is what `effect()` is for.

### Dynamic Dependency Tracking

Computed signals track only the signals that are actually read during the most recent execution. Dependencies can change from run to run.

```typescript
// src/app/examples/dynamic-deps.ts
import { signal, computed } from '@angular/core';

const showDiscount = signal(false);
const basePrice = signal(100);
const discountPercent = signal(20);

const displayPrice = computed(() => {
  if (showDiscount()) {
    return basePrice() * (1 - discountPercent() / 100);
  }
  return basePrice();
});
```

When `showDiscount()` is `false`, only `showDiscount` and `basePrice` are dependencies. Changing `discountPercent` does nothing. When `showDiscount` becomes `true`, `discountPercent` becomes a dependency too. Angular rebuilds the dependency set on every evaluation. This happens automatically. You do not declare dependencies; Angular discovers them.

## Side Effects with effect()

An effect runs a callback whenever any signal it reads changes. Unlike `computed`, an effect does not produce a value. It performs a side effect: logging, syncing to `localStorage`, updating a third-party chart library, or talking to a DOM API that Angular does not control.

```typescript
// src/app/examples/effect-basics.ts
import { Component, signal, effect } from '@angular/core';

@Component({
  selector: 'app-theme-tracker',
  template: `
    <button (click)="toggleDark()">Toggle Theme</button>
  `,
})
export class ThemeTrackerComponent {
  readonly isDark = signal(false);

  constructor() {
    effect(() => {
      document.body.classList.toggle('dark-theme', this.isDark());
    });
  }

  toggleDark(): void {
    this.isDark.update(v => !v);
  }
}
```

The full signature:

```typescript
// API Reference
effect(
  effectFn: (onCleanup: (cleanupFn: () => void) => void) => void,
  options?: {
    injector?: Injector;
    manualCleanup?: boolean;
    forceRoot?: boolean;
    debugName?: string;
  }
): EffectRef
```

### How Effects Execute

Effects always run at least once (on creation). After that, they re-run whenever a tracked signal changes. But there is a critical detail: **effects run asynchronously**. When you call `signal.set()`, Angular does not immediately re-run every effect that depends on that signal. Instead, it marks the effect as dirty and schedules it to run during the next change detection cycle. If you set three signals in a row, the effect runs once with all three updates already applied.

This batching is intentional. It prevents intermediate states from leaking into side effects. But it means you cannot call `set()` and immediately observe the effect's outcome in the same synchronous block.

### The Reactive Context Is Synchronous

Signal reads inside `setTimeout`, `Promise.then`, or any asynchronous callback within an effect are NOT tracked. The reactive context only exists during the synchronous execution of the effect callback.

```typescript
// src/app/examples/effect-async-trap.ts
import { signal, effect } from '@angular/core';

const userId = signal(1);
const userName = signal('Alice');

// WRONG: userName() is read outside the reactive context
effect(() => {
  const id = userId(); // tracked
  setTimeout(() => {
    console.log(userName()); // NOT tracked -- inside async callback
  }, 1000);
});
```

If the effect needs to react to `userName`, read it synchronously at the top of the callback, then use the captured value inside the async operation.

### Cleanup with onCleanup

The effect callback receives an `onCleanup` registration function. The cleanup runs before the effect re-executes and when the effect is destroyed (component destruction).

```typescript
// src/app/products/product-poller.component.ts
import { Component, signal, effect } from '@angular/core';

@Component({
  selector: 'app-product-poller',
  template: `<p>Polling category: {{ category() }}</p>`,
})
export class ProductPollerComponent {
  readonly category = signal('Electronics');

  constructor() {
    effect((onCleanup) => {
      const cat = this.category();
      const intervalId = setInterval(() => {
        console.log(`Polling products for: ${cat}`);
      }, 5000);

      onCleanup(() => clearInterval(intervalId));
    });
  }
}
```

When `category` changes, the old interval is cleared before the new one starts. When the component is destroyed, the interval is cleared for good. This is the signal equivalent of `takeUntilDestroyed()` from Chapter 3, but scoped to each individual effect.

### Injection Context Requirement

`effect()` must be called in an injection context: a constructor, a field initializer, or inside `inject()`. To create an effect outside the constructor, pass an `Injector`:

```typescript
// src/app/examples/effect-outside-constructor.ts
import { Component, signal, effect, inject, Injector } from '@angular/core';

@Component({
  selector: 'app-deferred-effect',
  template: `<button (click)="startTracking()">Start Tracking</button>`,
})
export class DeferredEffectComponent {
  private readonly injector = inject(Injector);
  readonly count = signal(0);

  startTracking(): void {
    effect(
      () => { console.log(`Count: ${this.count()}`); },
      { injector: this.injector }
    );
  }
}
```

### When to Use effect()

The rule is simple: **effect is the last primitive you should reach for.** If the work produces a value, use `computed()`. If the work produces a writable value that resets, use `linkedSignal()`. Use `effect()` only when the work has a side effect that leaves the signal graph: writing to `localStorage`, logging to an analytics service, manipulating the DOM through a third-party library, or integrating with an imperative API.

## Dependent Writable State with linkedSignal()

There is a gap between `computed()` and `signal()`. A `computed` is read-only: perfect for derived values, but you cannot let the user override it. A plain `signal` is independent: it does not react when another signal changes. `linkedSignal` fills this gap. It creates a writable signal that automatically resets to a derived value when its source changes.

Consider a product list with pagination. When the user changes the category filter, the page should reset to 1. But the user can also click to page 2, page 3, and so on. The page is derived from the category (resets on change) but writable by the user (can be overridden).

```typescript
// src/app/products/product-pagination.component.ts
import { Component, signal, computed, linkedSignal } from '@angular/core';

interface Product {
  id: number;
  name: string;
  category: string;
  price: number;
}

const ALL_PRODUCTS: Product[] = [
  { id: 1, name: 'Laptop', category: 'Electronics', price: 999 },
  { id: 2, name: 'Keyboard', category: 'Electronics', price: 79 },
  { id: 3, name: 'Desk', category: 'Furniture', price: 450 },
  { id: 4, name: 'Chair', category: 'Furniture', price: 350 },
  { id: 5, name: 'Monitor', category: 'Electronics', price: 599 },
  { id: 6, name: 'Bookshelf', category: 'Furniture', price: 200 },
  { id: 7, name: 'Mouse', category: 'Electronics', price: 49 },
  { id: 8, name: 'Lamp', category: 'Furniture', price: 89 },
];

const PAGE_SIZE = 3;

@Component({
  selector: 'app-product-pagination',
  template: `
    <div class="filters">
      <button
        [class.active]="selectedCategory() === null"
        (click)="selectedCategory.set(null)"
      >
        All
      </button>
      <button
        [class.active]="selectedCategory() === 'Electronics'"
        (click)="selectedCategory.set('Electronics')"
      >
        Electronics
      </button>
      <button
        [class.active]="selectedCategory() === 'Furniture'"
        (click)="selectedCategory.set('Furniture')"
      >
        Furniture
      </button>
    </div>

    <p>
      Page {{ currentPage() }} of {{ totalPages() }}
      ({{ filteredProducts().length }} products)
    </p>

    @for (product of pageProducts(); track product.id) {
      <div class="product-card">
        <h3>{{ product.name }}</h3>
        <p>{{ product.price | currency }}</p>
      </div>
    }

    <div class="pagination">
      <button [disabled]="currentPage() <= 1" (click)="prevPage()">
        Previous
      </button>
      <button [disabled]="currentPage() >= totalPages()" (click)="nextPage()">
        Next
      </button>
    </div>
  `,
  imports: [CurrencyPipe],
})
export class ProductPaginationComponent {
  readonly selectedCategory = signal<string | null>(null);

  readonly filteredProducts = computed(() => {
    const category = this.selectedCategory();
    if (category === null) return ALL_PRODUCTS;
    return ALL_PRODUCTS.filter(p => p.category === category);
  });

  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.filteredProducts().length / PAGE_SIZE))
  );

  // Resets to page 1 whenever filteredProducts changes.
  // User can override via set()/update().
  readonly currentPage = linkedSignal(() => {
    this.filteredProducts(); // track dependency
    return 1;
  });

  readonly pageProducts = computed(() => {
    const start = (this.currentPage() - 1) * PAGE_SIZE;
    return this.filteredProducts().slice(start, start + PAGE_SIZE);
  });

  nextPage(): void {
    this.currentPage.update(p => Math.min(p + 1, this.totalPages()));
  }

  prevPage(): void {
    this.currentPage.update(p => Math.max(p - 1, 1));
  }
}
```

```typescript
// This import was used in the template
import { CurrencyPipe } from '@angular/common';
```

When the user clicks "Electronics," `selectedCategory` changes, which invalidates `filteredProducts`, which invalidates `currentPage` (resetting it to 1), which invalidates `pageProducts`. The entire chain re-evaluates lazily. When the user clicks "Next," only `currentPage` and `pageProducts` recompute. No redundant work.

### The Advanced Form: Preserving State Across Resets

The shorthand `linkedSignal(() => value)` always resets to the same value. The advanced form gives you access to the previous source and previous value, so you can make smarter decisions:

```typescript
// src/app/products/smart-pagination.ts
import { signal, linkedSignal } from '@angular/core';

interface ShippingOption {
  id: string;
  name: string;
  price: number;
}

const shippingOptions = signal<ShippingOption[]>([
  { id: 'standard', name: 'Standard', price: 5 },
  { id: 'express', name: 'Express', price: 15 },
]);

const selectedShipping = linkedSignal<ShippingOption[], ShippingOption>({
  source: shippingOptions,
  computation: (options, previous) => {
    // Try to preserve the user's selection if it still exists
    if (previous) {
      const found = options.find(o => o.id === previous.value.id);
      if (found) return found;
    }
    return options[0];
  },
});
```

The `computation` receives two arguments: the new value of the source, and an optional `previous` object containing `{ source, value }`. On the first run, `previous` is `undefined`. On subsequent runs, you can compare the old and new source to decide whether to reset or preserve.

### When to Use linkedSignal vs computed vs signal

| You need... | Use |
|---|---|
| Read-only derived value | `computed()` |
| Independent writable value | `signal()` |
| Writable value that resets when a source changes | `linkedSignal()` |

If you can solve it with `computed()`, use `computed()`. If you need a writable value that has no upstream dependency, use `signal()`. Use `linkedSignal()` only when you need both reactive resets and local writability.

## Reading Signals Without Tracking: untracked()

Sometimes you need to read a signal inside a reactive context (an effect or computed) without creating a dependency on it. The `untracked()` function executes a callback where signal reads are invisible to the dependency tracker.

```typescript
// src/app/products/product-logger.component.ts
import { Component, signal, effect, inject } from '@angular/core';
import { untracked } from '@angular/core';

@Component({
  selector: 'app-product-logger',
  template: `<p>Logger active for {{ selectedCategory() ?? 'All' }}</p>`,
})
export class ProductLoggerComponent {
  readonly selectedCategory = signal<string | null>(null);
  readonly sessionId = signal('sess-abc123');

  constructor() {
    effect(() => {
      const category = this.selectedCategory(); // tracked

      untracked(() => {
        // sessionId is read but NOT tracked.
        // Changing sessionId alone will NOT re-run this effect.
        console.log(`[${this.sessionId()}] Category changed to: ${category}`);
      });
    });
  }
}
```

The pattern is: read your actual dependencies first (at the top of the callback, synchronously), then wrap everything else in `untracked()`. This keeps the effect focused on the signals that matter and prevents incidental reads (inside logging utilities, service methods, or helper functions) from inflating the dependency set.

## Signals in a Service: Rebuilding the Product State

Chapter 3 built a `ProductStateService` with `BehaviorSubject`. Here is the same service rebuilt entirely with signals. Compare the two and notice what disappeared.

```typescript
// src/app/products/product-signal-state.service.ts
import { Injectable, signal, computed } from '@angular/core';

export interface Product {
  id: number;
  name: string;
  price: number;
  category: string;
}

@Injectable({ providedIn: 'root' })
export class ProductSignalStateService {
  private readonly _products = signal<Product[]>([]);
  private readonly _selectedCategory = signal<string | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  // Read-only public API
  readonly products = this._products.asReadonly();
  readonly selectedCategory = this._selectedCategory.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  readonly filteredProducts = computed(() => {
    const category = this._selectedCategory();
    if (category === null) return this._products();
    return this._products().filter(p => p.category === category);
  });

  readonly filteredCount = computed(() => this.filteredProducts().length);

  setLoading(): void {
    this._loading.set(true);
    this._error.set(null);
  }

  setProducts(products: Product[]): void {
    this._products.set(products);
    this._loading.set(false);
  }

  setError(error: string): void {
    this._error.set(error);
    this._loading.set(false);
  }

  setCategory(category: string | null): void {
    this._selectedCategory.set(category);
  }
}
```

What is gone: `BehaviorSubject`, `Observable`, `map`, `distinctUntilChanged`, the `select()` helper, the `setState()` helper. What replaced them: `signal()` for each piece of state, `computed()` for derived values, and `asReadonly()` for public exposure. The pattern is the same (private writable, public read-only), but the ceremony is dramatically reduced.

### Consuming the Signal Service

```typescript
// src/app/products/product-list-signals.component.ts
import { Component, inject } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { ProductSignalStateService } from './product-signal-state.service';

@Component({
  selector: 'app-product-list',
  imports: [CurrencyPipe],
  template: `
    @if (productState.loading()) {
      <p>Loading products...</p>
    } @else if (productState.error(); as error) {
      <p class="error">{{ error }}</p>
    } @else {
      <p>{{ productState.filteredCount() }} products found</p>
      @for (product of productState.filteredProducts(); track product.id) {
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
  readonly productState = inject(ProductSignalStateService);
}
```

No `async` pipe. No `takeUntilDestroyed`. No subscription management. The template reads signals directly, and Angular handles all tracking and cleanup internally. When `filteredProducts()` changes, only this portion of the template re-renders. In zoneless Angular 21, signal writes are the primary mechanism that triggers change detection. There is no Zone.js patching `setTimeout` or `Promise` behind the scenes. Signals notify Angular directly, and Angular checks only the components that actually read those signals.

## How Signals Work Under the Hood

Understanding the push/pull mechanism helps you reason about performance. When you call `signal.set()`, Angular does NOT immediately recompute every `computed` and re-run every `effect` in the graph. Instead, it uses a two-phase approach:

**Push phase.** The signal sends a notification to all its direct consumers: "I might have changed." This notification carries no data. It is a flag that says "your cached value may be stale." This propagates through the graph: if `computed A` depends on `signal X`, and `computed B` depends on `computed A`, both are flagged as potentially stale.

**Pull phase.** When something actually reads a flagged signal (a template render, a `computed()` evaluation, an `effect()` run), Angular walks the dependency chain and recomputes only what is necessary. If a `computed` re-evaluates and produces the same value (according to its equality function), the staleness flag does NOT propagate further. Downstream consumers remain cached.

This is why `computed()` is memoized and `effect()` is batched. Multiple synchronous `set()` calls flag the graph once, and the pull phase resolves everything in a single pass. No intermediate states leak out. No redundant computations.

## Common Mistakes

### Mistake 1: Using effect() for Derived State

```typescript
// WRONG
@Component({ /* ... */ })
export class ProductSummaryComponent {
  private readonly products = signal<Product[]>([]);
  readonly totalPrice = signal(0);

  constructor() {
    effect(() => {
      this.totalPrice.set(
        this.products().reduce((sum, p) => sum + p.price, 0)
      );
    });
  }
}
```

This is the single most common signal mistake. The `totalPrice` is derived state: its value is fully determined by `products`. Using `effect()` to propagate it introduces asynchronous timing. Between the moment `products` changes and the moment the effect runs, `totalPrice` holds a stale value. If the template reads both `products()` and `totalPrice()` in the same render, they can be out of sync, causing a glitch or an `ExpressionChangedAfterItHasBeenChecked` error.

```typescript
// CORRECT
@Component({ /* ... */ })
export class ProductSummaryComponent {
  private readonly products = signal<Product[]>([]);
  readonly totalPrice = computed(() =>
    this.products().reduce((sum, p) => sum + p.price, 0)
  );
}
```

`computed()` is synchronous, memoized, and always consistent with its dependencies. No timing gap, no stale values.

### Mistake 2: Mutating Objects or Arrays Inside Signals

```typescript
// WRONG
readonly items = signal<Product[]>([]);

addProduct(product: Product): void {
  this.items().push(product); // mutates in place
}
```

Signals use `Object.is()` for equality. Pushing onto an existing array does not change its reference, so the signal never notifies consumers. The UI stays stale.

```typescript
// CORRECT
addProduct(product: Product): void {
  this.items.update(items => [...items, product]);
}
```

`update()` produces a new array reference. The signal detects the change and notifies all consumers. The same rule applies to objects: always spread to create a new reference.

### Mistake 3: Reading Signals Asynchronously in Effects

```typescript
// WRONG
effect(() => {
  const id = this.userId(); // tracked
  fetch(`/api/users/${id}`).then(response => {
    console.log(this.userName()); // NOT tracked -- inside .then()
  });
});
```

The reactive context only exists during the synchronous execution of the effect callback. Signal reads inside `setTimeout`, `Promise.then`, `async/await` continuations, or RxJS callbacks are not tracked. The effect will never re-run when `userName` changes.

```typescript
// CORRECT
effect(() => {
  const id = this.userId();     // tracked
  const name = this.userName(); // tracked -- read synchronously
  fetch(`/api/users/${id}`).then(() => {
    console.log(name); // uses the captured value
  });
});
```

Read all signals synchronously at the top of the effect. Capture the values into local variables. Use those variables in async operations.

### Mistake 4: Side Effects in computed()

```typescript
// WRONG
readonly products = computed(() => {
  console.log('Recomputing products'); // side effect!
  return this.allProducts().filter(p => p.active);
});
```

`computed()` must be a pure function. Angular may re-evaluate it multiple times during internal optimization passes. Side effects inside `computed()` can fire unexpectedly and at unpredictable times. Logging, API calls, DOM writes, and signal writes all belong in `effect()`, not `computed()`.

```typescript
// CORRECT
readonly products = computed(() =>
  this.allProducts().filter(p => p.active)
);

constructor() {
  effect(() => {
    console.log('Products updated:', this.products().length);
  });
}
```

Keep `computed()` pure. Move side effects to `effect()`.

## Key Takeaways

- **`signal()` holds state, `computed()` derives state, `effect()` performs side effects, `linkedSignal()` creates resettable writable state.** These four primitives replace `BehaviorSubject`, `map`, `distinctUntilChanged`, `combineLatest`, and manual subscription cleanup for most synchronous state scenarios.

- **Reach for `computed()` first, `linkedSignal()` second, `effect()` last.** If the value is fully determined by other signals, it is a `computed`. If it resets when a source changes but the user can override it, it is a `linkedSignal`. Only use `effect()` when the work leaves the signal graph entirely (DOM, localStorage, analytics, third-party integrations).

- **Signals track dependencies automatically and synchronously.** Reads inside `setTimeout`, `Promise.then`, or async callbacks are invisible to the tracker. Always read signals at the top of your effect or computed callback, synchronously, before branching into async work.

- **Treat signal values as immutable.** Use `update()` with spread operators to produce new references for objects and arrays. Mutating in place silently breaks change detection because `Object.is()` sees the same reference.

- **The push/pull mechanism means signals are lazy and batched.** Multiple synchronous updates result in a single re-evaluation. Computed signals only recompute when read. This makes signals inherently efficient without manual optimization like `distinctUntilChanged`.
