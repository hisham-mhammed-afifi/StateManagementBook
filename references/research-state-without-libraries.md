# Research: State Without Libraries: Services and RxJS

**Date:** 2026-03-28
**Chapter:** Ch 3
**Status:** Ready for chapter generation

## API Surface

### BehaviorSubject
- **Import:** `import { BehaviorSubject } from 'rxjs';`
- **Signature:** `new BehaviorSubject<T>(initialValue: T)`
- **Key methods:** `.next(value)`, `.getValue()`, `.asObservable()`, `.pipe()`
- **Stability:** Stable

### ReplaySubject
- **Import:** `import { ReplaySubject } from 'rxjs';`
- **Signature:** `new ReplaySubject<T>(bufferSize?: number, windowTime?: number)`
- **Stability:** Stable

### AsyncPipe
- **Import:** `import { AsyncPipe } from '@angular/common';`
- **Template usage:** `{{ observable$ | async }}`
- **Stability:** Stable
- **Note:** Works in zoneless Angular 21 because it calls `markForCheck()` internally.

### shareReplay
- **Import:** `import { shareReplay } from 'rxjs';`
- **Signature:** `shareReplay<T>(configOrBufferSize?: ShareReplayConfig | number): MonoTypeOperatorFunction<T>`
- **ShareReplayConfig:** `{ bufferSize?: number; windowTime?: number; refCount: boolean }`
- **Stability:** Stable

### distinctUntilChanged
- **Import:** `import { distinctUntilChanged } from 'rxjs';`
- **Signature:** `distinctUntilChanged<T>(compareFn?: (prev: T, curr: T) => boolean): MonoTypeOperatorFunction<T>`
- **Stability:** Stable

### scan
- **Import:** `import { scan } from 'rxjs';`
- **Signature:** `scan<V, A>(accumulator: (acc: A, value: V, index: number) => A, seed?: A): OperatorFunction<V, A>`
- **Stability:** Stable

### inject()
- **Import:** `import { inject } from '@angular/core';`
- **Signature:** `inject<T>(token: ProviderToken<T>, options?: InjectOptions): T`
- **Stability:** Stable
- **Note:** Must be called in an injection context (field initializer, constructor, factory). Throws NG0203 otherwise.

### Injectable
- **Import:** `import { Injectable } from '@angular/core';`
- **Signature:** `@Injectable({ providedIn: 'root' })`
- **Stability:** Stable

### DestroyRef
- **Import:** `import { DestroyRef } from '@angular/core';`
- **Stability:** Stable

### takeUntilDestroyed
- **Import:** `import { takeUntilDestroyed } from '@angular/core/rxjs-interop';`
- **Signature:** `takeUntilDestroyed(destroyRef?: DestroyRef): MonoTypeOperatorFunction<T>`
- **Stability:** Stable (since Angular v20)

### toSignal (signals teaser)
- **Import:** `import { toSignal } from '@angular/core/rxjs-interop';`
- **Signature:** `toSignal<T>(source: Observable<T>, options?: ToSignalOptions): Signal<T | undefined>`
- **Options:** `initialValue`, `requireSync`, `manualCleanup`, `equal`, `injector`
- **Stability:** Stable (since Angular v20)

### toObservable (signals teaser)
- **Import:** `import { toObservable } from '@angular/core/rxjs-interop';`
- **Signature:** `toObservable<T>(source: Signal<T>, options?: { injector?: Injector }): Observable<T>`
- **Stability:** Stable (since Angular v20)

## Key Concepts

- **Service-based state management** is the foundational Angular pattern: a service owns state (private BehaviorSubject), exposes it as a read-only Observable, and provides methods to mutate it.
- **BehaviorSubject vs ReplaySubject:** BehaviorSubject requires an initial value and always has a current value (`getValue()`). ReplaySubject is for when there is no meaningful initial state (e.g., user profile before authentication) or when you need to replay multiple past emissions.
- **Immutability is enforced manually:** Always create new objects/arrays via spread when calling `.next()`. This ensures `distinctUntilChanged` works by reference and supports OnPush/zoneless change detection.
- **The async pipe** is the preferred way to consume Observables in templates. It auto-subscribes, auto-unsubscribes, and triggers change detection.
- **shareReplay** multicasts an Observable and replays the last N emissions to late subscribers. Critical for preventing duplicate HTTP calls.
- **The scan operator** enables Redux-like state accumulation in plain RxJS, a conceptual bridge to NgRx reducers in later chapters.
- **takeUntilDestroyed()** is the modern unsubscribe pattern, replacing the manual `ngOnDestroy` + `Subject.complete()` approach.
- **The facade pattern** decouples consumers from state implementation, making it possible to swap between BehaviorSubject services and NgRx later.
- **Ephemeral vs persistent state** (Michael Hladky's distinction): ephemeral state lives in components/services that are created and destroyed; persistent state lives in global singletons.
- **Community progression model:** Signals for local state -> Service Store for shared feature state -> Library (NgRx) only when complexity demands it.
- **"Events flow through RxJS, resolve, and rest as Signals"** is the emerging consensus for Angular 21+.

## Code Patterns

### Basic BehaviorSubject State Service

```typescript
// src/app/products/product-state.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { map, distinctUntilChanged } from 'rxjs/operators';

export interface ProductState {
  products: Product[];
  loading: boolean;
  error: string | null;
}

const initialState: ProductState = {
  products: [],
  loading: false,
  error: null,
};

@Injectable({ providedIn: 'root' })
export class ProductStateService {
  private readonly state$ = new BehaviorSubject<ProductState>(initialState);

  // Read-only selectors
  readonly products$ = this.select((s) => s.products);
  readonly loading$ = this.select((s) => s.loading);
  readonly error$ = this.select((s) => s.error);

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
}
```

### Consuming with Async Pipe and inject()

```typescript
// src/app/products/product-list.component.ts
import { Component } from '@angular/core';
import { inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { ProductStateService } from './product-state.service';

@Component({
  selector: 'app-product-list',
  standalone: true,
  imports: [AsyncPipe],
  template: `
    @if (loading$ | async) {
      <p>Loading...</p>
    } @else if (error$ | async; as error) {
      <p class="error">{{ error }}</p>
    } @else {
      @for (product of products$ | async; track product.id) {
        <div class="product-card">{{ product.name }}</div>
      }
    }
  `,
})
export class ProductListComponent {
  private readonly productState = inject(ProductStateService);

  readonly products$ = this.productState.products$;
  readonly loading$ = this.productState.loading$;
  readonly error$ = this.productState.error$;
}
```

### ReplaySubject for Deferred State

```typescript
// src/app/auth/user-profile.service.ts
import { Injectable } from '@angular/core';
import { ReplaySubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class UserProfileService {
  // No initial value: profile is unknown until login completes
  private readonly profile$$ = new ReplaySubject<UserProfile>(1);
  readonly profile$ = this.profile$$.asObservable();

  setProfile(profile: UserProfile): void {
    this.profile$$.next(profile);
  }
}
```

### shareReplay for HTTP Caching

```typescript
// src/app/categories/category.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { shareReplay } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class CategoryService {
  private readonly http = inject(HttpClient);

  // Cached: all subscribers share one HTTP call, last result replayed
  readonly categories$ = this.http.get<Category[]>('/api/categories').pipe(
    shareReplay({ bufferSize: 1, refCount: true })
  );
}
```

### scan Operator for Redux-Like Accumulation

```typescript
// src/app/cart/cart.service.ts
import { Injectable } from '@angular/core';
import { Subject, scan, startWith } from 'rxjs';

type CartAction =
  | { type: 'add'; item: CartItem }
  | { type: 'remove'; itemId: string }
  | { type: 'clear' };

@Injectable({ providedIn: 'root' })
export class CartService {
  private readonly actions$ = new Subject<CartAction>();

  readonly cart$ = this.actions$.pipe(
    scan((items: CartItem[], action: CartAction) => {
      switch (action.type) {
        case 'add':
          return [...items, action.item];
        case 'remove':
          return items.filter((i) => i.id !== action.itemId);
        case 'clear':
          return [];
      }
    }, [] as CartItem[]),
    startWith([] as CartItem[])
  );

  addItem(item: CartItem): void {
    this.actions$.next({ type: 'add', item });
  }

  removeItem(itemId: string): void {
    this.actions$.next({ type: 'remove', itemId });
  }

  clear(): void {
    this.actions$.next({ type: 'clear' });
  }
}
```

### takeUntilDestroyed for Manual Subscriptions

```typescript
// src/app/dashboard/dashboard.component.ts
import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AnalyticsService } from './analytics.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  template: `<div>Dashboard</div>`,
})
export class DashboardComponent {
  private readonly analytics = inject(AnalyticsService);

  constructor() {
    // Auto-unsubscribes when component is destroyed
    this.analytics.events$
      .pipe(takeUntilDestroyed())
      .subscribe((event) => console.log('Analytics event:', event));
  }
}
```

### Signals Teaser: toSignal Bridge

```typescript
// src/app/products/product-list-signals.component.ts
import { Component, inject, computed } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ProductStateService } from './product-state.service';

@Component({
  selector: 'app-product-list',
  standalone: true,
  template: `
    @if (loading()) {
      <p>Loading...</p>
    } @else {
      <p>{{ count() }} products found</p>
      @for (product of products(); track product.id) {
        <div>{{ product.name }}</div>
      }
    }
  `,
})
export class ProductListComponent {
  private readonly productState = inject(ProductStateService);

  // Bridge Observable to Signal
  readonly products = toSignal(this.productState.products$, { initialValue: [] });
  readonly loading = toSignal(this.productState.loading$, { initialValue: false });

  // Derived state with computed -- no combineLatest needed!
  readonly count = computed(() => this.products().length);
}
```

## Breaking Changes and Gotchas

### shareReplay Memory Leak (Critical)
- `shareReplay(1)` (shorthand) defaults to `refCount: false`, meaning the inner subscription is **never** cleaned up even when all subscribers unsubscribe.
- **Always use:** `shareReplay({ bufferSize: 1, refCount: true })`
- With `refCount: true` inside `@if` blocks, toggling the condition drops refCount to 0, causing re-subscription and potentially re-triggering HTTP calls. Move the subscription above the conditional or accept the trade-off.
- **GitHub Issue:** [ReactiveX/rxjs#5931](https://github.com/ReactiveX/rxjs/issues/5931)

### Angular 21 Zoneless Default
- Angular 21 is zoneless by default. The async pipe still works correctly because it uses `markForCheck()` internally.
- OnPush change detection is effectively the default behavior. Do not prescribe OnPush as an optimization step.
- No `provideZoneChangeDetection()` needed in new projects.

### BehaviorSubject Rapid Update Race Condition
- When a service responds too quickly (e.g., cached data), rapid BehaviorSubject updates may cause intermediate template states to be missed.
- **GitHub Issue:** [angular/angular#55256](https://github.com/angular/angular/issues/55256)

### Exposing Subjects Directly (Antipattern)
- Never expose a `BehaviorSubject` or `ReplaySubject` as a public property. Consumers can call `.next()` directly, bypassing service logic.
- Always expose via `.asObservable()`.

### Mutating State by Reference (Antipattern)
- Mutating objects retrieved from `getValue()` and passing them back via `.next()` breaks `distinctUntilChanged` (same reference), breaks OnPush detection, and makes debugging impossible.
- Always spread: `this.state$.next({ ...current, ...patch })`.

### Forgetting to Unsubscribe
- Manual `.subscribe()` calls without cleanup cause memory leaks.
- Modern solution: `takeUntilDestroyed()` from `@angular/core/rxjs-interop`.
- Async pipe handles this automatically.

### Over-Using getValue()
- `getValue()` should only be used inside service methods (e.g., `setState`). Using it in components breaks the reactive contract because the caller gets a snapshot, not a live stream.

### No Breaking Changes to RxJS APIs in Angular 21
- All RxJS operators and Subject types remain unchanged.
- HttpClient no longer requires `provideHttpClient()` for basic usage (auto-provided), but interceptors still need configuration.

## Sources

### Official Documentation
- [Angular DI Guide](https://angular.dev/guide/di)
- [Angular RxJS Interop](https://angular.dev/ecosystem/rxjs-interop)
- [Angular takeUntilDestroyed](https://angular.dev/ecosystem/rxjs-interop/take-until-destroyed)

### Expert Blog Posts and Articles
- [Simple State Management in Angular with Services and RxJS (dev.to/avatsaev)](https://dev.to/avatsaev/simple-state-management-in-angular-with-only-services-and-rxjs-41p8)
- [Simple yet Powerful State Management with RxJS (dev.to/angular)](https://dev.to/angular/simple-yet-powerful-state-management-in-angular-with-rxjs-4f8g)
- [The NgRx Signal Store and Your Architecture (angulararchitects.io)](https://www.angulararchitects.io/blog/the-ngrx-signal-store-and-your-architecture/)
- [Angular Signals: 5 Architecture Options (angulararchitects.io)](https://www.angulararchitects.io/blog/angular-signals-your-architecture-5-options/)
- [Reactive Ephemeral State Management Research (push-based.io)](https://push-based.io/article/research-on-reactive-ephemeral-state-management)
- [Service with a Signal in Angular (modernangular.com)](https://modernangular.com/articles/service-with-a-signal-in-angular)
- [State Management with RxJS and Signals (modernangular.com)](https://modernangular.com/articles/state-management-with-rxjs-and-signals)
- [You Don't Need NgRx for State Management (Medium)](https://medium.com/@saiyaff/you-dont-need-ngrx-for-state-management-in-angular-8d3a1ac1aa03)
- [You Don't Need NgRx to Write a Good Angular App (This Dot Labs)](https://www.thisdot.co/blog/you-dont-need-ngrx-to-write-a-good-angular-app)
- [Angular State Management for 2025 (Nx Blog)](https://nx.dev/blog/angular-state-management-2025)
- [RxJS vs. Signals: When to Use Which (Plain English)](https://plainenglish.io/software-development/rxjs-vs-signals-the-exact-rulebook-on-when-to-use-which)

### shareReplay Deep Dives
- [Share vs ShareReplay (Bitovi)](https://www.bitovi.com/blog/always-know-when-to-use-share-vs.-sharereplay)
- [Share/ShareReplay/RefCount (ITNEXT)](https://itnext.io/share-sharereplay-refcount-a38ae29a19d)
- [Be Careful with shareReplay (StrongBrew)](https://blog.strongbrew.io/share-replay-issue/)
- [Pitfalls of shareReplay (Hashnode)](https://nicopetri.hashnode.dev/the-dark-side-of-sharereplay-in-rxjs)

### GitHub Issues
- [shareReplay memory leak (ReactiveX/rxjs#5931)](https://github.com/ReactiveX/rxjs/issues/5931)
- [BehaviorSubject rapid update race (angular/angular#55256)](https://github.com/angular/angular/issues/55256)
- [Feature Request: Subject Signal (angular/angular#58863)](https://github.com/angular/angular/issues/58863)
- [prefer-signals ESLint rule (angular-eslint#1824)](https://github.com/angular-eslint/angular-eslint/issues/1824)

### Community Patterns
- [Angular Facade Pattern (angular.love)](https://angular.love/angular-facade-pattern/)
- [Simple State Management with scan (juri.dev)](https://juri.dev/blog/2018/10/simple-state-management-with-scan/)
- [Angular State Management Comparison (dev.to)](https://dev.to/chintanonweb/angular-state-management-a-comparison-of-the-different-options-available-100e)

## Open Questions

1. **Angular 21 HttpClient auto-provision:** Verify whether `provideHttpClient()` is truly no longer needed for basic usage, or if this only applies to specific configurations. The chapter's HTTP caching example depends on this.
2. **toSignal requireSync with BehaviorSubject:** Verify that `toSignal(behaviorSubject$, { requireSync: true })` correctly eliminates `undefined` from the Signal type in Angular 21. This is important for the signals teaser section.
3. **scan operator + shareReplay composition:** Verify the exact behavior when combining `scan` with `shareReplay({ bufferSize: 1, refCount: true })` -- does refCount dropping to 0 reset the accumulated state? This affects the cart service pattern.
