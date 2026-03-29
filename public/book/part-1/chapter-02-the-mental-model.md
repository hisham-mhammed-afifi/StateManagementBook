# Chapter 2: The Mental Model

A teammate pushes a feature branch for a product catalog page. The page loads products from an API, lets users filter by category, and shows a detail panel when a product is selected. During code review, three bugs surface. First, the filter dropdown updates the product list, but the selected product panel still shows a product from the previous filter. Second, adding an item to the cart does not update the cart badge in the header, even though the array contains the new item. Third, a child component updates a shared service during rendering, and the console floods with `ExpressionChangedAfterItHasBeenCheckedError`. Three different bugs, three different root causes, but all three trace back to violations of the same three principles.

This chapter gives you the mental model that prevents these bugs before they happen. We will cover three rules that underpin every state management pattern in this book: unidirectional data flow, immutability, and single source of truth. Chapter 1 classified state into four categories (UI, server, URL, form) and introduced signals and `computed()`. This chapter builds on that foundation by establishing how data should move, how it should change, and where it should live.

## Unidirectional Data Flow

Unidirectional data flow means that application data moves in one predictable direction: from state into the UI. When a user interacts with the interface, that interaction does not directly modify state. Instead, it triggers a controlled process (a method call, an event emission, an action dispatch) that produces new state, which then flows back into the UI. The cycle always moves forward, never backward.

Picture the component tree as a waterfall. Data pours from parent components down to children through input bindings. When a child needs to communicate back to a parent, it does not reach up and modify the parent's data. Instead, it sends an event upstream through an output. The parent receives the event, decides how to update its own state, and the new data flows back down through inputs on the next rendering pass.

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
  product = input.required<Product>();  // Data flows DOWN from parent
  addToCart = output<Product>();         // Events flow UP to parent
}
```

```typescript
// src/app/pages/catalog.component.ts
import { Component, signal, computed } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { ProductCardComponent } from '../components/product-card.component';

interface Product {
  id: number;
  name: string;
  price: number;
}

@Component({
  selector: 'app-catalog',
  imports: [ProductCardComponent, CurrencyPipe],
  template: `
    @for (product of products(); track product.id) {
      <app-product-card
        [product]="product"
        (addToCart)="onAddToCart($event)"
      />
    }
    <p>Cart total: {{ cartTotal() | currency }}</p>
  `,
})
export class CatalogComponent {
  products = signal<Product[]>([
    { id: 1, name: 'Laptop', price: 999 },
    { id: 2, name: 'Mouse', price: 29 },
  ]);

  cartItems = signal<Product[]>([]);
  cartTotal = computed(() =>
    this.cartItems().reduce((sum, item) => sum + item.price, 0)
  );

  onAddToCart(product: Product) {
    this.cartItems.update(items => [...items, product]);
  }
}
```

The `ProductCardComponent` has no access to the parent's `cartItems` signal. It cannot call `.update()` on it. All it can do is emit an event saying "the user clicked Add to Cart." The parent receives that event, updates its own state, and the new `cartTotal` flows into the template. Data down, events up. One direction.

### Why Angular Enforces This

Angular's change detection runs top-down: parent components are checked before their children. This design assumes that once a parent finishes its rendering pass, its state is stable. If a child component were to modify the parent's state during rendering, the parent's already-rendered output would become stale within the same cycle, creating an inconsistency.

To catch these violations, Angular performs a second verification pass in development mode. If any expression produces a different value during this second pass, Angular throws the `ExpressionChangedAfterItHasBeenCheckedError` (NG0100). This error is not a nuisance. It is Angular telling you that data is flowing in the wrong direction.

This error still exists in zoneless Angular 21. Removing Zone.js changed how change detection is triggered (push-based signals instead of global patching), but it did not change the fundamental rule: data must stabilize in a single pass.

### The Signal Graph Is Unidirectional

Signals reinforce unidirectional flow by design. A writable `signal()` is a producer. A `computed()` is a consumer that derives its value from producers. An `effect()` is a consumer that performs side effects in response to producer changes. The arrows in this graph always point one way: from producers to consumers.

```
signal('laptop')  ──>  computed(() => ...)  ──>  template binding
                  ──>  effect(() => ...)    ──>  side effect (logging, API call)
```

Consumers cannot write back to producers. A `computed()` cannot call `.set()` on the signals it reads. This is enforced at the API level: `computed()` returns a read-only signal. The dependency graph is a directed acyclic graph with no back-edges, which guarantees that updates propagate without cycles.

### The Writable-Inside, Read-Only-Outside Pattern

When state moves beyond a single component into a shared service, unidirectional flow requires a gate. The service owns the writable signal internally but exposes only a read-only view to consumers. Components that need to change state call a method on the service, never the signal directly.

```typescript
// src/app/services/cart.service.ts
import { Injectable, signal, computed } from '@angular/core';

interface CartItem {
  productId: number;
  name: string;
  price: number;
  quantity: number;
}

@Injectable({ providedIn: 'root' })
export class CartService {
  private items = signal<CartItem[]>([]);

  // Public read-only API
  allItems = this.items.asReadonly();
  totalPrice = computed(() =>
    this.items().reduce((sum, item) => sum + item.price * item.quantity, 0)
  );
  itemCount = computed(() =>
    this.items().reduce((sum, item) => sum + item.quantity, 0)
  );

  // Controlled mutations through methods
  addItem(productId: number, name: string, price: number) {
    this.items.update(items => {
      const existing = items.find(i => i.productId === productId);
      if (existing) {
        return items.map(i =>
          i.productId === productId
            ? { ...i, quantity: i.quantity + 1 }
            : i
        );
      }
      return [...items, { productId, name, price, quantity: 1 }];
    });
  }

  removeItem(productId: number) {
    this.items.update(items =>
      items.filter(i => i.productId !== productId)
    );
  }
}
```

Any component that injects `CartService` can read `allItems()`, `totalPrice()`, and `itemCount()`, but none of them can call `this.cartService.allItems.set(...)`. The `.asReadonly()` method strips the `set` and `update` methods from the signal's type. The only way to change the cart is through `addItem()` or `removeItem()`. One entry point, one direction.

### UDF in NgRx (Preview)

State management libraries formalize this pattern. NgRx Classic Store enforces a strict cycle: components dispatch actions, reducers produce new state, selectors read state, and components render. We will explore this in depth starting in Chapter 8. NgRx SignalStore follows the same principle with a lighter syntax: components call store methods, `patchState()` creates new state, and signals propagate to the view. We will cover SignalStore starting in Chapter 15. For now, the point is that both libraries are built on unidirectional data flow. They differ in ceremony, not in principle.

## Immutability

Immutability means that once you create a value, you never change it in place. When you need an updated version, you create a new value with the changes applied. The original stays untouched.

This rule matters in Angular for a concrete, mechanical reason: signals detect changes by comparing references, not by inspecting contents.

### How Signals Detect Changes

When you call `.set()` or `.update()` on a signal, Angular compares the new value to the old value using `Object.is()`. This function performs strict reference equality for objects and arrays. If the reference is the same, Angular concludes nothing changed and does not notify consumers. If the reference is different, consumers are notified and the UI updates.

This means that mutating an object or array in place is invisible to signals. The reference does not change, so the signal stays silent.

```typescript
// src/app/examples/mutation-bug-array.ts
import { signal, computed } from '@angular/core';

const items = signal<string[]>(['Apple', 'Banana']);
const count = computed(() => items().length);

// WRONG: mutating the array in place
items().push('Cherry');

// items() now contains ['Apple', 'Banana', 'Cherry'],
// but count() still returns 2.
// The array reference did not change, so the signal
// did not notify the computed. The UI is stale.
```

```typescript
// CORRECT: creating a new array
items.update(list => [...list, 'Cherry']);

// A new array is created. Object.is(oldArray, newArray) returns false.
// The signal notifies count(), which recomputes to 3.
```

The same principle applies to objects.

```typescript
// src/app/examples/mutation-bug-object.ts
import { signal } from '@angular/core';

interface Product {
  id: number;
  name: string;
  price: number;
}

const product = signal<Product>({ id: 1, name: 'Laptop', price: 999 });

// WRONG: mutating the object in place
product().price = 899;
// The signal holds the same object reference. No notification.

// CORRECT: creating a new object
product.update(p => ({ ...p, price: 899 }));
// New reference. Signal notifies consumers. UI updates.
```

This is the single most common source of "my UI will not update" bugs in Angular. If you remember one thing from this section, remember this: every state update must produce a new reference.

### Immutable Update Patterns

The spread operator is the workhorse of immutable updates in TypeScript.

```typescript
// src/app/examples/immutable-updates.ts

// Updating one property on an object
const original = { id: 1, name: 'Laptop', price: 999 };
const updated = { ...original, price: 899 };
// original.price is still 999

// Adding to an array
const fruits = ['Apple', 'Banana'];
const moreFruits = [...fruits, 'Cherry'];

// Removing from an array
const withoutBanana = fruits.filter(f => f !== 'Banana');

// Updating one item in an array
const products = [
  { id: 1, name: 'Laptop', price: 999 },
  { id: 2, name: 'Mouse', price: 29 },
];
const discounted = products.map(p =>
  p.id === 1 ? { ...p, price: 899 } : p
);
```

For deeply nested state, spread operators become verbose. In later chapters, we will introduce `patchState()` from NgRx SignalStore (Chapter 15), which handles the top-level spread automatically, and the Immer library for complex nested updates (Chapter 14). For now, the spread operator covers the majority of cases.

### TypeScript as Your Safety Net

TypeScript can catch accidental mutations at compile time if you mark your state interfaces with `readonly`.

```typescript
// src/app/models/cart.model.ts
export interface CartItem {
  readonly productId: number;
  readonly name: string;
  readonly price: number;
  readonly quantity: number;
}

export interface CartState {
  readonly items: readonly CartItem[];
}
```

With these types, any attempt to mutate a property or call a mutating array method produces a compile error:

```typescript
// src/app/examples/readonly-enforcement.ts
import { CartItem, CartState } from '../models/cart.model';

function addItem(state: CartState, item: CartItem): CartState {
  // state.items.push(item);
  // Error: Property 'push' does not exist on type 'readonly CartItem[]'

  // state.items[0].quantity = 5;
  // Error: Cannot assign to 'quantity' because it is a read-only property

  // Correct: return a new state with a new array
  return { items: [...state.items, item] };
}
```

This is compile-time protection only. At runtime, JavaScript does not enforce `readonly`. But the compile-time guard is enough to catch the vast majority of accidental mutations during development.

### Custom Equality Functions

Sometimes the default reference comparison is too sensitive. An API response might include a `lastUpdated` timestamp that changes on every poll, even when the meaningful data has not changed. You can provide a custom equality function to tell the signal what "changed" means for your domain.

```typescript
// src/app/services/product-detail.service.ts
import { Injectable, signal } from '@angular/core';

interface Product {
  id: number;
  name: string;
  price: number;
  lastUpdated: string;
}

@Injectable({ providedIn: 'root' })
export class ProductDetailService {
  selectedProduct = signal<Product | null>(null, {
    equal: (a, b) => {
      if (a === null || b === null) return a === b;
      return a.id === b.id && a.name === b.name && a.price === b.price;
    },
  });

  // When the API returns the same product with a different lastUpdated,
  // the signal will NOT notify consumers. Only meaningful changes
  // (id, name, price) trigger updates.
}
```

One caveat: Angular only calls the custom `equal` function when a new reference is provided. If you pass the same object reference, the function is never invoked and the signal assumes nothing changed.

## Single Source of Truth

Single source of truth means that every piece of application data exists in exactly one authoritative location. Every other representation of that data is derived from the source, never stored independently. When you need the data, you go to the source. When you need a transformed view of the data, you compute it from the source.

### The Duplication Problem

In Chapter 1, we warned against storing a `selectedProduct` object alongside a `products` array. Here is why that is dangerous in practice.

```typescript
// src/app/services/product-catalog-bad.service.ts
import { Injectable, signal } from '@angular/core';

interface Product {
  id: number;
  name: string;
  price: number;
}

// WRONG: two independent copies of the same data
@Injectable({ providedIn: 'root' })
export class ProductCatalogBadService {
  products = signal<Product[]>([
    { id: 1, name: 'Laptop', price: 999 },
    { id: 2, name: 'Mouse', price: 29 },
  ]);

  selectedProduct = signal<Product | null>(null);

  selectProduct(id: number) {
    const product = this.products().find(p => p.id === id) ?? null;
    this.selectedProduct.set(product);
    // This copies the product object into a separate signal.
    // If products is later refreshed from the API and the laptop
    // is now $899, selectedProduct still shows $999.
  }
}
```

The fix is to store only the selection key and derive the full object.

```typescript
// src/app/services/product-catalog.service.ts
import { Injectable, signal, computed } from '@angular/core';

interface Product {
  id: number;
  name: string;
  price: number;
}

@Injectable({ providedIn: 'root' })
export class ProductCatalogService {
  products = signal<Product[]>([
    { id: 1, name: 'Laptop', price: 999 },
    { id: 2, name: 'Mouse', price: 29 },
  ]);

  selectedProductId = signal<number | null>(null);

  // Derived: always reflects the current products array
  selectedProduct = computed(() => {
    const id = this.selectedProductId();
    if (id === null) return null;
    return this.products().find(p => p.id === id) ?? null;
  });

  selectProduct(id: number) {
    this.selectedProductId.set(id);
  }
}
```

Now `selectedProduct` is not state. It is a computation. When the products array changes (from an API refresh, a WebSocket update, or an optimistic mutation), `selectedProduct` automatically reflects the new data. There is no second copy to keep in sync.

### linkedSignal: When Derived State Needs an Override

`computed()` is read-only. You cannot call `.set()` on it. That is usually what you want: derived values should not be independently writable because that would create a second source of truth.

But some scenarios need a middle ground. Consider pagination: when the user changes their search query, the page number should reset to 1. But the user should also be able to navigate to page 3 manually. The page number depends on the query (resetting on change) but is also independently writable (user navigation).

`linkedSignal()` solves this. It creates a writable signal that is linked to a source signal. When the source changes, the linked signal resets to a computed default. Between resets, the user can override it freely.

```typescript
// src/app/services/product-search.service.ts
import { Injectable, signal, computed, linkedSignal } from '@angular/core';

interface Product {
  id: number;
  name: string;
  price: number;
  category: string;
}

@Injectable({ providedIn: 'root' })
export class ProductSearchService {
  private allProducts = signal<Product[]>([]);

  query = signal('');
  pageSize = signal(10);

  // Resets to 1 whenever query changes; user can still override
  currentPage = linkedSignal({
    source: this.query,
    computation: () => 1,
  });

  filteredProducts = computed(() => {
    const q = this.query().toLowerCase();
    if (q === '') return this.allProducts();
    return this.allProducts().filter(p =>
      p.name.toLowerCase().includes(q)
    );
  });

  totalPages = computed(() =>
    Math.ceil(this.filteredProducts().length / this.pageSize())
  );

  currentPageProducts = computed(() => {
    const start = (this.currentPage() - 1) * this.pageSize();
    return this.filteredProducts().slice(start, start + this.pageSize());
  });

  search(term: string) {
    this.query.set(term); // currentPage auto-resets to 1
  }

  goToPage(page: number) {
    this.currentPage.set(page); // manual override
  }
}
```

Use `linkedSignal()` sparingly. Every writable dependent signal is a point where derived state can diverge from its source. Prefer `computed()` whenever the value should not be independently writable. Reserve `linkedSignal()` for cases where the value genuinely needs to reset on source changes but accept user overrides between resets.

### SSOT in NgRx (Preview)

NgRx Classic Store enforces single source of truth architecturally. The Store is the one place where application state lives. Selectors are pure functions that extract slices of that state for components. Components never access the Store's internal structure directly; they always go through selectors. This means you can restructure the state shape without changing any component code, because selectors absorb the change. We will build this pattern in full starting in Chapter 8.

NgRx SignalStore achieves the same principle with `withState()` (the source), `withComputed()` (derived data), and `withMethods()` (controlled mutations). Each SignalStore instance is a self-contained single source of truth for its domain. We will explore this in Chapter 15.

## The Three Rules in Action

Let us tie the three principles together in a single working example: a product catalog with a cart. Each principle plays a visible role.

```typescript
// src/app/services/catalog-store.service.ts
import { Injectable, signal, computed, linkedSignal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export interface Product {
  id: number;
  name: string;
  price: number;
  category: string;
}

interface CartEntry {
  readonly productId: number;
  readonly quantity: number;
}

@Injectable({ providedIn: 'root' })
export class CatalogStore {
  private http = inject(HttpClient);

  // --- Source state (writable, private) ---
  private products = signal<Product[]>([
    { id: 1, name: 'Laptop', price: 999, category: 'Electronics' },
    { id: 2, name: 'Mouse', price: 29, category: 'Electronics' },
    { id: 3, name: 'Desk', price: 349, category: 'Furniture' },
    { id: 4, name: 'Chair', price: 199, category: 'Furniture' },
  ]);
  private cart = signal<CartEntry[]>([]);

  categoryFilter = signal<string | null>(null);

  // SSOT: currentPage resets when filter changes (linkedSignal)
  currentPage = linkedSignal({
    source: this.categoryFilter,
    computation: () => 1,
  });

  // --- Derived state (read-only, public) --- SSOT via computed()
  allProducts = this.products.asReadonly(); // UDF: read-only outside

  filteredProducts = computed(() => {
    const category = this.categoryFilter();
    const all = this.products();
    if (category === null) return all;
    return all.filter(p => p.category === category);
  });

  categories = computed(() => {
    const all = this.products();
    return [...new Set(all.map(p => p.category))];
  });

  cartItems = computed(() => {
    const entries = this.cart();
    const all = this.products();
    return entries.map(entry => {
      const product = all.find(p => p.id === entry.productId);
      return {
        product: product!,
        quantity: entry.quantity,
      };
    });
  });

  cartTotal = computed(() =>
    this.cartItems().reduce(
      (sum, item) => sum + item.product.price * item.quantity, 0
    )
  );

  cartCount = computed(() =>
    this.cart().reduce((sum, entry) => sum + entry.quantity, 0)
  );

  // --- Controlled mutations (methods) --- UDF: single entry point
  setCategory(category: string | null) {
    this.categoryFilter.set(category);
    // currentPage auto-resets to 1 via linkedSignal
  }

  addToCart(productId: number) {
    this.cart.update(entries => { // Immutability: new array
      const existing = entries.find(e => e.productId === productId);
      if (existing) {
        return entries.map(e => // Immutability: new object per updated entry
          e.productId === productId
            ? { ...e, quantity: e.quantity + 1 }
            : e
        );
      }
      return [...entries, { productId, quantity: 1 }];
    });
  }

  removeFromCart(productId: number) {
    this.cart.update(entries =>
      entries.filter(e => e.productId !== productId)
    );
  }
}
```

Notice how all three principles work together:

1. **Unidirectional data flow**: The `products` and `cart` signals are private. External code reads through `allProducts`, `cartItems`, and other read-only computeds. Changes go through `addToCart()`, `removeFromCart()`, and `setCategory()`. Data out, methods in.

2. **Immutability**: Every update creates a new array or object. `addToCart` uses `.map()` to produce a new entry when updating quantity, and spread to add a new entry. No `.push()`, no property assignment on existing objects.

3. **Single source of truth**: `cartItems` is derived from `cart` (IDs and quantities) and `products` (full objects). There is no separate "cart products" array that could become stale. `filteredProducts` is derived from `products` and `categoryFilter`. `currentPage` is linked to `categoryFilter` and resets automatically.

## Common Mistakes

### Mistake 1: Mutating an Array with .push()

```typescript
// WRONG
addItem(item: string) {
  this.items().push(item);
}
```

The signal reference does not change. The template never updates. This is the mutation bug described earlier.

```typescript
// CORRECT
addItem(item: string) {
  this.items.update(list => [...list, item]);
}
```

Call `.update()` on the signal, not methods on its current value. The callback must return a new reference.

### Mistake 2: Duplicating an Entity Instead of Storing a Key

```typescript
// WRONG
selectUser(user: User) {
  this.selectedUser.set(user); // copies the object
}
```

If the `users` array refreshes from the API, `selectedUser` still holds the old copy. The detail panel shows stale data while the list shows fresh data.

```typescript
// CORRECT
selectUser(id: number) {
  this.selectedUserId.set(id);
}

selectedUser = computed(() => {
  const id = this.selectedUserId();
  if (id === null) return null;
  return this.users().find(u => u.id === id) ?? null;
});
```

Store the key. Derive the object. One source of truth.

### Mistake 3: Using effect() to Synchronize Two Signals

```typescript
// WRONG
query = signal('');
currentPage = signal(1);

resetEffect = effect(() => {
  this.query(); // track the query
  this.currentPage.set(1); // reset page on query change
});
```

This introduces hidden coupling. The dependency between `query` and `currentPage` lives in an `effect()` that could be anywhere in the file. It also triggers an unnecessary change detection cycle because the effect runs after the signal update, not during it.

```typescript
// CORRECT
query = signal('');
currentPage = linkedSignal({
  source: this.query,
  computation: () => 1,
});
```

`linkedSignal()` makes the dependency explicit and synchronous. The reset happens as part of the signal graph evaluation, not as an async side effect.

### Mistake 4: Exposing Writable Signals from a Service

```typescript
// WRONG
@Injectable({ providedIn: 'root' })
export class UserService {
  currentUser = signal<User | null>(null); // any component can .set() this
}
```

Any component can call `userService.currentUser.set(null)`, bypassing any validation or logging the service should enforce. Data flows in multiple directions with no control point.

```typescript
// CORRECT
@Injectable({ providedIn: 'root' })
export class UserService {
  private _currentUser = signal<User | null>(null);
  currentUser = this._currentUser.asReadonly();

  login(user: User) {
    // validation, logging, or side effects happen here
    this._currentUser.set(user);
  }

  logout() {
    this._currentUser.set(null);
  }
}
```

The private writable signal is the single entry point. `asReadonly()` ensures consumers can only read, never write.

## Key Takeaways

- **Unidirectional data flow means data down, events up.** Components receive state through inputs and read-only signals. They request changes through method calls and event emissions. No component directly modifies another component's state.

- **Immutability is not optional with signals.** Signals compare references using `Object.is()`. If you mutate an object or array in place, the signal does not detect the change and the UI stays stale. Every state update must produce a new reference.

- **Single source of truth eliminates synchronization bugs.** Store each piece of data in exactly one place. Derive every other representation with `computed()`. If you find yourself writing code to keep two signals in sync, you have two sources of truth and need to eliminate one.

- **`linkedSignal()` bridges derived and writable state.** Use it when a value should reset when its source changes but remain independently writable between resets. Prefer `computed()` for all other derived state.

- **Services should expose read-only signals and accept changes through methods.** The `asReadonly()` method enforces unidirectional flow at the API level. If a consumer can call `.set()` on your signal, your data flow is bidirectional and your bugs will be unpredictable.
