# Research: What Is State?

**Date:** 2026-03-27
**Chapter:** Ch 1
**Status:** Ready for chapter generation

## API Surface

This is a foundational/conceptual chapter. No deep API coverage, but the following Angular primitives are introduced as teasers (full coverage in later chapters):

| API | Import Path | Stability | Notes |
|-----|------------|-----------|-------|
| `signal()` | `@angular/core` | Stable | Writable signal, `.set()`, `.update()` |
| `computed()` | `@angular/core` | Stable | Read-only derived signal, lazy + memoized |
| `effect()` | `@angular/core` | Stable | Side-effect runner, tracks signal reads |
| `linkedSignal()` | `@angular/core` | Stable (Angular 21) | Writable dependent state linked to other signals |
| `ActivatedRoute` | `@angular/router` | Stable | Route params, query params, data observables |
| `input()` | `@angular/core` | Stable | Component input as signal (bindable to route params via `withComponentInputBinding`) |
| Signal Forms fields | `@angular/forms` | **Experimental** | `dirty()`, `valid()`, `touched()`, `errors()`, `pending()`, `disabled()`, `hidden()`, `readonly()` |

## Key Concepts

### Definition of State
- State is any data that can change over time and affects what the user sees or can do in the application.
- It is a snapshot of your application's data at a given point in time.
- Frontend apps lack a database; they must manage data in memory, URLs, and browser storage.

### The Four Categories of State

1. **UI State** (client-owned, ephemeral)
   - Whether a modal/sidebar/dropdown is open or closed
   - Which tab is active
   - Scroll position
   - Drag-and-drop positions
   - Loading spinners, skeleton screens
   - Theme (dark/light)
   - Typically local to a component or a small subtree
   - Owned entirely by the frontend; no server equivalent

2. **Server State** (server-owned, cached locally)
   - Data fetched from REST/GraphQL APIs
   - The frontend holds a cached copy that may be stale
   - Multiple clients may view/modify the same data simultaneously
   - Requires loading, error, and stale states
   - Examples: product catalog, user profiles, order history
   - Key challenges: caching, invalidation, optimistic updates, polling/real-time sync

3. **URL State** (browser-owned, shareable)
   - Route parameters (`/products/:id`)
   - Query parameters (`?sort=price&page=2`)
   - Fragment (`#section`)
   - Represents the "address" of the current view
   - Must be serializable (strings only)
   - Shareable and bookmarkable
   - The URL is a form of global state that any component can read
   - Angular provides `ActivatedRoute` and `withComponentInputBinding` for signal-based access

4. **Form State** (user-owned, transient)
   - Current input values (dirty vs pristine)
   - Validation status (valid, invalid, pending async validation)
   - Interaction status (touched, untouched)
   - Submission status
   - Exists only while the user is filling out the form
   - Angular 21 Signal Forms: `dirty()`, `valid()`, `touched()`, `errors()`, `pending()`, `disabled()`, `hidden()`, `readonly()`
   - Non-interactive fields (disabled, hidden, readonly) do not contribute to parent form validity

### Additional Dimensions of State

- **Local vs Global**: local state lives in a single component; global state is accessible app-wide
- **Ephemeral vs Persistent**: ephemeral state disappears on navigation/refresh; persistent state survives (URL, localStorage, server)
- **Derived State**: computed from other state (e.g., filtered list = items + active filter). Should never be stored separately; always compute it.

### Why Categorizing State Matters
- Different categories need different tools (signals for UI, httpResource for server, router for URL, forms API for form)
- Mixing categories leads to the most common state management bugs
- Knowing the category tells you: where the source of truth lives, how long the data lives, and who owns it

## Code Patterns

### UI State with a Signal
```typescript
// src/app/components/sidebar.component.ts
import { Component, signal } from '@angular/core';

@Component({
  selector: 'app-sidebar',
  template: `
    <button (click)="toggle()">Toggle Sidebar</button>
    @if (isOpen()) {
      <nav>Sidebar content</nav>
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

### Server State (Conceptual Preview)
```typescript
// src/app/services/product.service.ts
import { Injectable, signal } from '@angular/core';

interface Product {
  id: number;
  name: string;
  price: number;
}

@Injectable({ providedIn: 'root' })
export class ProductService {
  private products = signal<Product[]>([]);
  private loading = signal(false);
  private error = signal<string | null>(null);

  // Three signals for one piece of server state:
  // the data, the loading flag, and the error
}
```

### URL State via Route Input
```typescript
// src/app/pages/product-detail.component.ts
import { Component, input } from '@angular/core';

@Component({
  selector: 'app-product-detail',
  template: `<h1>Product {{ productId() }}</h1>`,
})
export class ProductDetailComponent {
  // Bound from route param via withComponentInputBinding()
  productId = input.required<string>();
}
```

### Form State (Angular 21 Signal Forms Teaser)
```typescript
// Conceptual: Angular 21 Signal Forms (Experimental)
// The form exposes state as signals:
// form.valid()    -> boolean signal
// form.dirty()    -> boolean signal
// form.touched()  -> boolean signal
// form.errors()   -> signal of error objects
// Full coverage in Chapter 7
```

### Derived State with computed()
```typescript
// src/app/services/cart.service.ts
import { Injectable, signal, computed } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class CartService {
  items = signal<{ name: string; price: number; qty: number }[]>([]);

  totalPrice = computed(() =>
    this.items().reduce((sum, item) => sum + item.price * item.qty, 0)
  );

  itemCount = computed(() =>
    this.items().reduce((sum, item) => sum + item.qty, 0)
  );
}
```

## Breaking Changes and Gotchas

- **Angular 21 is zoneless by default.** Do not reference zone.js or `provideZoneChangeDetection()` unless discussing migration from older Angular versions.
- **`OnPush` is effectively the default** in zoneless mode. No need to prescribe it as an optimization.
- **Signal Forms are Experimental** in Angular 21. Core concepts are stable but method signatures may change.
- **`withComponentInputBinding()`** must be added to the router provider config for route params to bind to `input()` signals.
- **`linkedSignal()`** is stable in Angular 21 (was developer preview in earlier versions).
- **Victor Savkin's original state classification** (from the Nrwl/Nx blog) identified: server state, client state, navigation state, local UI state, and transient client state. This chapter consolidates into four categories (UI, server, URL, form) for clarity.

## Common Mistakes (Chapter Section Material)

1. **Storing derived state separately** -- e.g., keeping a `filteredProducts` array in state instead of computing it from `products` + `activeFilter`. Leads to stale data when one changes without the other.
2. **Treating server state like client state** -- storing API responses in a plain signal without considering loading, error, and stale states. Leads to missing loading spinners and unhandled errors.
3. **Duplicating entity data** -- storing a `selectedProduct` object alongside the `products` array. When the product updates in one place but not the other, the UI shows stale data.
4. **Putting everything in global state** -- sidebar open/close, modal visibility, and form values do not belong in a global store. They are local UI state.
5. **Ignoring URL state** -- hardcoding filter/sort/pagination in component state instead of query params. Users cannot share or bookmark filtered views.
6. **Mutating state directly** -- modifying an object property instead of creating a new reference. Angular change detection (even with signals) compares references, not deep equality.

## Sources

### Official Documentation
- [Angular Signals Overview](https://angular.dev/guide/signals)
- [Angular Route State Reading](https://angular.dev/guide/routing/read-route-state)
- [Angular Signal Forms: Field State Management](https://angular.dev/guide/forms/signals/field-state-management)
- [Angular effect() Guide](https://angular.dev/guide/signals/effect)
- [Angular linkedSignal Guide](https://angular.dev/guide/signals/linked-signal)

### Blog Posts and Articles
- [Angular State Management for 2025 - Nx Blog](https://nx.dev/blog/angular-state-management-2025)
- [Managing State in Angular Applications - Victor Savkin (Nx)](https://blog.nrwl.io/managing-state-in-angular-applications-22b75ef5625f)
- [State Management Patterns That Actually Scale in Angular 21 - Dipak Ahirav](https://medium.com/@dipaksahirav/state-management-patterns-that-actually-scale-in-angular-21-5a2d50f1347f)
- [Practical Guide: State Management with Angular Services + Signals - Telerik](https://www.telerik.com/blogs/practical-guide-state-management-using-angular-services-signals)
- [Advanced Signal Patterns in 2026 Angular Apps - Yogesh Raghav](https://medium.com/get-genuine-review/%EF%B8%8F8-advanced-signal-patterns-optimization-techniques-im-using-in-2026-angular-apps-8c4545c2014e)
- [From RxJS to Signals: The Future of State Management - HackerNoon](https://hackernoon.com/from-rxjs-to-signals-the-future-of-state-management-in-angular)
- [Angular Anti-Patterns in Production - Sowndarya Kurri](https://medium.com/@sowndarya.kurri/angular-anti-patterns-ive-seen-in-production-and-how-to-fix-them-2e10bb42ba89)
- [State Management Anti-Patterns - Source Allies](https://www.sourceallies.com/2020/11/state-management-anti-patterns/)
- [Frontend Developer Notes: Application State - Cody Lindley](https://codylindley.com/frontenddevnotes/application-website-state/)
- [Angular URL State Management with Query Params](https://dev.to/playfulprogramming-angular/angular-url-state-management-with-query-params-or-route-params-3mcb)
- [Creating Reusable Router Signals APIs - justangular.com](https://justangular.com/blog/creating-reusable-router-signals-apis/)
- [Google Ships Angular 21 - InfoQ](https://www.infoq.com/news/2025/11/angular-21-released/)

### Community / Deep Dives
- [Understanding State Management in Web Applications - DEV Community](https://dev.to/digvijay-bhakuni/understanding-state-management-in-web-applications-2gcl)
- [Mastering State Management in Frontend Applications - Code Digger](https://www.codedigger.ca/mastering-state-management-in-frontend-applications/)
- [Server State vs Client State for Beginners - DEV Community](https://dev.to/jeetvora331/server-state-vs-client-state-in-react-for-beginners-3pl6)
- [Best Practices for Angular State Management - DEV Community](https://dev.to/devin-rosario/best-practices-for-angular-state-management-2pm1)

## Open Questions

1. **Signal Forms exact import paths** -- The experimental Signal Forms API import paths should be verified against the installed Angular 21 package before writing the chapter. The field state signals (`dirty()`, `valid()`, etc.) are documented but final import structure may differ.
2. **`withComponentInputBinding()` still required?** -- Need to verify whether Angular 21 made this the default or if it still requires explicit opt-in in the router config.
3. **Victor Savkin's original classification** -- The Nrwl blog post could not be fetched (certificate error). The original five-category model (server, client, navigation, local UI, transient) should be verified for accurate attribution.
