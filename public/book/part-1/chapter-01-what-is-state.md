# Chapter 1: What Is State?

Your e-commerce app looks great in the demo. Products load, the sidebar filters work, and the checkout form validates beautifully. Then a tester sends you a screenshot: the cart badge says "3 items" but the cart drawer shows five. The price filter is stuck on a previous selection even though the URL says `?maxPrice=50`. The shipping form lost its data when the user navigated back from the payment page. Three bugs, three different root causes, all traced back to the same fundamental problem: the team never agreed on what state is, where it lives, or who owns it.

This chapter gives you a vocabulary for talking about state. We will classify every piece of data in an Angular application into four categories, show where each category naturally lives, and build small working examples that make the boundaries concrete. By the end, you will be able to point at any piece of data in your app and say exactly what kind of state it is, where its source of truth belongs, and which Angular API is the right fit.

## State, Defined

State is any data that can change over time and affects what the user sees or can do. A timestamp that never updates is a constant. A username that appears after login and disappears after logout is state. A product list that arrives from an API, a boolean that tracks whether a dropdown is open, a query parameter that controls sort order: all state.

Backend applications lean on databases to hold state between requests. Frontend applications have no such luxury. The data lives in memory, in the URL bar, in form fields, and sometimes in browser storage. Every Angular component that reads or writes any of these locations is participating in state management, whether the team calls it that or not.

Think of state as a snapshot: at any given millisecond, your application has a shape. The logged-in user is "Alice." The product list contains 42 items. The sidebar is collapsed. The URL reads `/products?sort=price`. If you could freeze the app, serialize every variable, and restore it later, that serialized blob is your application state. The challenge is that dozens of components need to read slices of that blob, some of them need to write to it, and all of them need to agree on a single version of the truth.

## The Four Categories of State

Not all state is created equal. A sidebar toggle and a product catalog have almost nothing in common: different lifetimes, different owners, different failure modes. Treating them the same way is the root cause of most state management bugs. We split state into four categories based on who owns the source of truth.

### UI State

UI state is data that exists only in the browser and has no corresponding record on a server. It controls what the interface looks like right now: whether a modal is open, which accordion panel is expanded, whether the user is dragging an item, or which theme is active. UI state is ephemeral. Refreshing the page resets it to defaults, and that is usually fine.

The defining characteristic of UI state is ownership. The frontend creates it, the frontend consumes it, and the frontend destroys it. No API call fetches "is the sidebar open." No database table stores "which tab is active." This makes UI state the simplest category to manage, and signals are a natural fit.

```typescript
// src/app/components/sidebar.component.ts
import { Component, signal } from '@angular/core';

@Component({
  selector: 'app-sidebar',
  template: `
    <button (click)="toggle()">
      {{ isOpen() ? 'Close' : 'Open' }} Sidebar
    </button>
    @if (isOpen()) {
      <nav class="sidebar">
        <ul>
          <li>Dashboard</li>
          <li>Products</li>
          <li>Orders</li>
        </ul>
      </nav>
    }
  `,
})
export class SidebarComponent {
  isOpen = signal(false);

  toggle() {
    this.isOpen.update(open => !open);
  }
}
```

The `isOpen` signal holds a boolean. Calling `toggle()` flips it. The template reads it with `isOpen()` inside the `@if` block. No service, no store, no subscription. UI state that belongs to a single component should live in that component.

When UI state needs to be shared across siblings or distant components, it moves into an injectable service. But it remains UI state: client-owned, no server round-trip, reset on refresh.

```typescript
// src/app/services/theme.service.ts
import { Injectable, signal, computed } from '@angular/core';

type Theme = 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private currentTheme = signal<Theme>('light');

  theme = this.currentTheme.asReadonly();
  isDark = computed(() => this.currentTheme() === 'dark');

  toggleTheme() {
    this.currentTheme.update(t => (t === 'light' ? 'dark' : 'light'));
  }
}
```

The service exposes a read-only signal and a `computed` for convenience. Any component that injects `ThemeService` reads the same value. The source of truth is one signal in one service.

### Server State

Server state is data whose source of truth lives on a remote server. The frontend holds a cached copy. Product lists, user profiles, order histories, and inventory counts are all server state. The critical difference from UI state: the frontend's copy can become stale at any moment because another user, a background job, or the passage of time can change the server's version.

This staleness problem means server state always carries metadata alongside the data itself. You need to know whether the data is loading, whether the last fetch succeeded or failed, and how fresh the cached copy is. Ignoring any of these leads to bugs: missing loading indicators, swallowed errors, or a UI that shows data from ten minutes ago without telling the user.

```typescript
// src/app/models/product.model.ts
export interface Product {
  id: number;
  name: string;
  price: number;
  category: string;
}
```

```typescript
// src/app/services/product.service.ts
import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Product } from '../models/product.model';

type LoadingStatus = 'idle' | 'loading' | 'success' | 'error';

@Injectable({ providedIn: 'root' })
export class ProductService {
  private http = inject(HttpClient);

  private products = signal<Product[]>([]);
  private status = signal<LoadingStatus>('idle');
  private errorMessage = signal<string | null>(null);

  allProducts = this.products.asReadonly();
  isLoading = computed(() => this.status() === 'loading');
  hasError = computed(() => this.status() === 'error');
  error = this.errorMessage.asReadonly();

  loadProducts() {
    this.status.set('loading');
    this.errorMessage.set(null);

    this.http.get<Product[]>('/api/products').subscribe({
      next: (data) => {
        this.products.set(data);
        this.status.set('success');
      },
      error: (err) => {
        this.errorMessage.set(err.message);
        this.status.set('error');
      },
    });
  }
}
```

Notice the three signals: `products` for the data, `status` for the loading lifecycle, and `errorMessage` for failure details. This trio is the minimum viable shape for server state. Chapter 6 introduces `httpResource`, which bakes this pattern into a single API call. For now, the point is that server state is never just "the data." It is the data plus its loading story.

### URL State

URL state is data encoded in the browser's address bar: route parameters, query parameters, and fragments. It has a unique property that no other state category shares: it is shareable. A user can copy the URL, send it to a colleague, and the colleague sees the same view. This makes URL state the most important state for any page that supports filtering, sorting, pagination, or deep linking.

Route parameters identify a resource. `/products/42` says "show me product 42." Query parameters configure the view. `/products?sort=price&page=2` says "show the product list, sorted by price, second page." Fragments point to a section within the page. All three are strings, which means you must parse and validate them before use.

```typescript
// src/app/pages/product-list.component.ts
import { Component, inject, computed, input } from '@angular/core';
import { Product } from '../models/product.model';
import { ProductService } from '../services/product.service';

@Component({
  selector: 'app-product-list',
  template: `
    <h1>Products</h1>
    <p>Sorting by: {{ sort() }}</p>
    <p>Page: {{ page() }}</p>
    @if (productService.isLoading()) {
      <p>Loading products...</p>
    }
    @for (product of sortedProducts(); track product.id) {
      <div class="product-card">
        <h2>{{ product.name }}</h2>
        <p>{{ product.price | currency }}</p>
      </div>
    }
  `,
})
export class ProductListComponent {
  protected productService = inject(ProductService);

  sort = input<string>('name');
  page = input<string>('1');

  sortedProducts = computed(() => {
    const products = this.productService.allProducts();
    const sortField = this.sort();

    return [...products].sort((a, b) => {
      if (sortField === 'price') {
        return a.price - b.price;
      }
      return a.name.localeCompare(b.name);
    });
  });
}
```

The `sort` and `page` inputs bind to query parameters when the router is configured with `withComponentInputBinding()`. The component does not know or care whether the value came from a URL or a parent component. It reads `sort()` as a signal and derives `sortedProducts` with `computed()`. If a user bookmarks `/products?sort=price&page=2` and opens it later, they see exactly what they expect.

The configuration that makes this work lives in your route setup:

```typescript
// src/app/app.config.ts
import { ApplicationConfig } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(),
  ],
};
```

```typescript
// src/app/app.routes.ts
import { Routes } from '@angular/router';
import { ProductListComponent } from './pages/product-list.component';
import { ProductDetailComponent } from './pages/product-detail.component';

export const routes: Routes = [
  { path: 'products', component: ProductListComponent },
  { path: 'products/:productId', component: ProductDetailComponent },
];
```

```typescript
// src/app/pages/product-detail.component.ts
import { Component, input } from '@angular/core';

@Component({
  selector: 'app-product-detail',
  template: `<h1>Product #{{ productId() }}</h1>`,
})
export class ProductDetailComponent {
  productId = input.required<string>();
}
```

Route parameters like `:productId` bind to `input.required<string>()`. Query parameters like `?sort=price` bind to optional `input<string>()`. The router becomes the source of truth, and the component simply reads signals.

### Form State

Form state is data the user is actively entering: input values, validation results, and interaction metadata like whether a field has been touched. It is transient by nature. The data exists from the moment the user opens the form until they submit or navigate away.

What makes form state distinct from UI state is its complexity. A single text field carries a current value, a pristine/dirty flag, a touched/untouched flag, a valid/invalid status, an optional list of validation errors, and possibly a pending async validation status. Multiply that by every field in a checkout form, and you have a substantial state tree that lives entirely inside the form boundary.

Angular 21 introduces experimental Signal Forms, where every piece of form metadata is a signal. Here is a preview of the shape (full coverage in Chapter 7):

```typescript
// src/app/components/signup-form.component.ts
import { Component, signal } from '@angular/core';

@Component({
  selector: 'app-signup-form',
  template: `
    <form>
      <label for="email">Email</label>
      <input
        id="email"
        type="email"
        [value]="email()"
        (input)="onEmailInput($event)"
      />
      @if (emailTouched() && !emailValid()) {
        <p class="error">Please enter a valid email address.</p>
      }

      <label for="password">Password</label>
      <input
        id="password"
        type="password"
        [value]="password()"
        (input)="onPasswordInput($event)"
      />
      @if (passwordTouched() && !passwordValid()) {
        <p class="error">Password must be at least 8 characters.</p>
      }

      <button
        type="submit"
        [disabled]="!formValid()"
      >
        Sign Up
      </button>
    </form>
  `,
})
export class SignupFormComponent {
  email = signal('');
  emailTouched = signal(false);
  emailValid = signal(false);

  password = signal('');
  passwordTouched = signal(false);
  passwordValid = signal(false);

  formValid = signal(false);

  onEmailInput(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.email.set(value);
    this.emailTouched.set(true);
    const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    this.emailValid.set(isValid);
    this.updateFormValidity();
  }

  onPasswordInput(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.password.set(value);
    this.passwordTouched.set(true);
    this.passwordValid.set(value.length >= 8);
    this.updateFormValidity();
  }

  private updateFormValidity() {
    this.formValid.set(this.emailValid() && this.passwordValid());
  }
}
```

This manual approach makes the state explicit: every field has a value signal, a touched signal, and a valid signal. The `formValid` signal aggregates them. Angular 21's experimental Signal Forms API automates this pattern, exposing `dirty()`, `valid()`, `touched()`, and `errors()` as built-in signals on each form field. We will explore that API in depth in Chapter 7.

> **API Status: Experimental**
> Angular 21's Signal Forms API is marked as `@experimental`. Core concepts are stable but method signatures may change in future versions.

## The Classification Grid

Here is a reference grid that captures the key differences between the four state categories:

| | **UI State** | **Server State** | **URL State** | **Form State** |
|---|---|---|---|---|
| **Owner** | Frontend | Backend server | Browser URL bar | User input |
| **Lifetime** | Component or session | Indefinite (server) | Until navigation | Until submit or leave |
| **Survives refresh?** | No | Yes (re-fetched) | Yes (in URL) | No |
| **Shareable?** | No | Via API | Yes (copy URL) | No |
| **Can become stale?** | No | Yes | No | No |
| **Typical Angular tool** | `signal()` | `httpResource` / service | Router + `input()` | Forms API |
| **Metadata needed** | Minimal | Loading, error, stale | Parse + validate | Touched, dirty, valid, errors |

When you encounter a piece of data, run it through this grid. Ask: who owns the truth? How long does it live? Can it go stale? The answers will point you to the right category and, by extension, the right tool.

## Derived State: The Fifth Column

There is one more kind of data that looks like state but should never be stored as state: derived values. A filtered product list is not new state. It is a computation over two existing pieces of state (the full product list and the active filter). A cart total is not state. It is a sum over cart items. A "form is valid" boolean is not state. It is the logical AND of every field's validity.

Storing derived values as separate state is one of the most common sources of bugs, because now you have two copies of the truth that can fall out of sync. Angular's `computed()` function exists specifically for this purpose.

```typescript
// src/app/services/product-filter.service.ts
import { Injectable, signal, computed } from '@angular/core';
import { Product } from '../models/product.model';

@Injectable({ providedIn: 'root' })
export class ProductFilterService {
  products = signal<Product[]>([]);
  activeCategory = signal<string | null>(null);
  maxPrice = signal<number>(Infinity);

  filteredProducts = computed(() => {
    let result = this.products();

    const category = this.activeCategory();
    if (category !== null) {
      result = result.filter(p => p.category === category);
    }

    const max = this.maxPrice();
    if (max < Infinity) {
      result = result.filter(p => p.price <= max);
    }

    return result;
  });

  resultCount = computed(() => this.filteredProducts().length);
}
```

`filteredProducts` and `resultCount` are derived. They recompute automatically when `products`, `activeCategory`, or `maxPrice` change. There is no way for them to become stale, because they do not store their own copy. They compute on demand and cache the result until a dependency changes.

The rule is simple: if a value can be calculated from other state, use `computed()`. Do not store it in a signal.

## Common Mistakes

### Mistake 1: Storing Derived State in a Separate Signal

```typescript
// Wrong: filteredProducts is a separate signal that must be manually synced
products = signal<Product[]>([]);
activeFilter = signal('all');
filteredProducts = signal<Product[]>([]); // BUG: who updates this?
```

When `products` changes but nobody calls `filteredProducts.set(...)`, the filtered list is stale. When `activeFilter` changes but the filtering logic has a different code path, the two signals disagree.

```typescript
// Correct: derived state is a computed, never a writable signal
products = signal<Product[]>([]);
activeFilter = signal('all');
filteredProducts = computed(() => {
  const filter = this.activeFilter();
  if (filter === 'all') return this.products();
  return this.products().filter(p => p.category === filter);
});
```

### Mistake 2: Ignoring the Loading and Error States of Server Data

```typescript
// Wrong: only storing the data, ignoring the loading lifecycle
@Injectable({ providedIn: 'root' })
export class OrderService {
  orders = signal<Order[]>([]);

  loadOrders() {
    inject(HttpClient).get<Order[]>('/api/orders').subscribe(data => {
      this.orders.set(data);
    });
    // No loading indicator. No error handling.
    // The UI shows an empty list until data arrives, confusing the user.
  }
}
```

```typescript
// Correct: model the full lifecycle of server state
@Injectable({ providedIn: 'root' })
export class OrderService {
  private http = inject(HttpClient);

  orders = signal<Order[]>([]);
  status = signal<'idle' | 'loading' | 'success' | 'error'>('idle');
  error = signal<string | null>(null);

  loadOrders() {
    this.status.set('loading');
    this.error.set(null);

    this.http.get<Order[]>('/api/orders').subscribe({
      next: (data) => {
        this.orders.set(data);
        this.status.set('success');
      },
      error: (err) => {
        this.error.set(err.message);
        this.status.set('error');
      },
    });
  }
}
```

Server state without loading and error signals is incomplete. The UI cannot tell the difference between "no data yet" and "no data exists."

### Mistake 3: Putting Local UI State in a Global Store

```typescript
// Wrong: a global store tracks whether a tooltip is visible
// This pollutes the global state with ephemeral, component-local data
interface AppState {
  products: Product[];
  isTooltipVisible: boolean; // Does not belong here
  isSidebarOpen: boolean;    // Does not belong here
}
```

Tooltip visibility is not something the rest of the application cares about. Putting it in a global store couples unrelated components, bloats the state shape, and makes debugging harder.

```typescript
// Correct: local UI state stays in the component
@Component({
  selector: 'app-info-icon',
  template: `
    <span
      (mouseenter)="showTooltip.set(true)"
      (mouseleave)="showTooltip.set(false)"
    >
      i
    </span>
    @if (showTooltip()) {
      <div class="tooltip">Helpful information here</div>
    }
  `,
})
export class InfoIconComponent {
  showTooltip = signal(false);
}
```

The signal lives and dies with the component. No global state needed.

### Mistake 4: Hardcoding Filterable State Instead of Using the URL

```typescript
// Wrong: filter lives only in a component signal
@Component({ /* ... */ })
export class ProductPageComponent {
  sortBy = signal('name'); // Lost on refresh, not shareable
}
```

A user filters products by price, copies the URL to share with a coworker, and the coworker sees the default sort. The filter was never in the URL.

```typescript
// Correct: use query params so the URL reflects the view
@Component({ /* ... */ })
export class ProductPageComponent {
  sortBy = input<string>('name'); // Bound from ?sortBy=price via withComponentInputBinding()
}
```

Now `/products?sortBy=price` is bookmarkable and shareable. The URL is the source of truth for how the view is configured.

## Key Takeaways

- **State is any data that changes over time and affects the UI.** Constants and static configuration are not state. If it can change, it needs a management strategy.

- **Classify every piece of state into one of four categories: UI, server, URL, or form.** The category determines the source of truth, the lifetime, and the right Angular tool for the job.

- **Derived values are not state.** If a value can be calculated from other state, use `computed()`. Never store a derived value in its own signal.

- **Server state always needs loading and error metadata.** A signal holding API data is incomplete without signals tracking the request lifecycle.

- **The URL is state.** Any data that affects what the user sees and should survive a page refresh or be shareable belongs in route or query parameters, not in a component signal.
