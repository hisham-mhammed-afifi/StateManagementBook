# Research: Signals from First Principles

**Date:** 2026-03-29
**Chapter:** Ch 4
**Status:** Ready for chapter generation

---

## API Surface

### `signal<T>(initialValue, options?)` -- Writable Signal
- **Import:** `import { signal } from '@angular/core';`
- **Signature:** `signal<T>(initialValue: T, options?: CreateSignalOptions<T>): WritableSignal<T>`
- **Options:** `{ equal?: ValueEqualityFn<T>, debugName?: string }`
- **Stability:** Stable (since v17.0)
- **Methods on WritableSignal:** `set(value)`, `update(fn)`, `asReadonly()`
- **Default equality:** `Object.is()` (referential for objects, value for primitives)
- **Removed API:** `mutate()` was dropped before v17 stable (PR #51821). Encouraged mutable patterns and broke memoization.

### `computed<T>(computation, options?)` -- Derived Read-Only Signal
- **Import:** `import { computed } from '@angular/core';`
- **Signature:** `computed<T>(computation: () => T, options?: CreateComputedOptions<T>): Signal<T>`
- **Options:** `{ equal?: ValueEqualityFn<T>, debugName?: string }`
- **Stability:** Stable (since v17.0)
- **Key behaviors:** Lazily evaluated, memoized, dynamic dependency tracking, read-only return type, must be a pure function (no side effects)

### `effect(effectFn, options?)` -- Side Effects
- **Import:** `import { effect } from '@angular/core';`
- **Signature:** `effect(effectFn: (onCleanup: EffectCleanupRegisterFn) => void, options?: CreateEffectOptions): EffectRef`
- **Options:** `{ injector?, manualCleanup?, allowSignalWrites? (DEPRECATED), forceRoot?, debugName? }`
- **Stability:** Stable (since v20.0, was developer preview from v16-v19)
- **Key behaviors:** Always runs at least once, executes asynchronously, dynamic dependency tracking, cleanup via onCleanup callback
- **Two types:** Component effects (run during change detection) vs Root effects (run as microtasks)

### `linkedSignal<D>(computation, options?)` -- Dependent Writable Signal
- **Import:** `import { linkedSignal } from '@angular/core';`
- **Overload 1 (shorthand):** `linkedSignal<D>(computation: () => D, options?): WritableSignal<D>`
- **Overload 2 (advanced):** `linkedSignal<S, D>({ source, computation, equal?, debugName? }): WritableSignal<D>`
  - `computation` receives `(source: S, previous?: { source: S, value: D })`
- **Stability:** Stable (since v20.0, was developer preview in v19)
- **Key behaviors:** Writable (unlike computed), auto-resets when source changes, user-overridable between resets

### `untracked<T>(nonReactiveReadsFn)` -- Reading Without Tracking
- **Import:** `import { untracked } from '@angular/core';`
- **Signature:** `untracked<T>(nonReactiveReadsFn: () => T): T`
- **Stability:** Stable (since v17.0)
- **Purpose:** Reads signals inside callback without creating reactive dependencies

### Utility Type Guards
- `isSignal(value): boolean` -- true for any Signal or WritableSignal
- `isWritableSignal(value): boolean` -- true only for WritableSignal
- `assertNotInReactiveContext(fn)` -- guards functions that should not be called inside reactive contexts

---

## Key Concepts

### Core Mental Model
- Signals are **synchronous reactive primitives** that hold values and notify consumers when those values change
- Angular signals use a **hybrid push/pull algorithm**: push notifications (not values) to consumers, consumers pull values lazily
- The **reactive context** is synchronous only. Signal reads inside setTimeout, Promise.then, or async callbacks are NOT tracked.

### The Signal Hierarchy (Decision Framework)
1. **First choice: `computed()`** -- derived, read-only, synchronous, memoized, glitch-free
2. **Second choice: `linkedSignal()`** -- derived but writable, auto-resets when source changes
3. **Last resort: `effect()`** -- side effects to external systems (localStorage, logging, DOM, third-party libs)
4. **Independent state: `signal()`** -- standalone writable state

### Equality and Change Detection
- Default equality: `Object.is()` (referential for objects, value for primitives)
- `NaN === NaN` is true with `Object.is()` (unlike `===`)
- `+0` and `-0` are considered different
- Custom equality functions prevent unnecessary propagation
- Creating new object/array references triggers downstream re-computation even if content is identical

### Dynamic Dependency Tracking
- Both `computed()` and `effect()` track only the signals actually read during the most recent execution
- Conditional reads create conditional dependencies -- a signal read inside an `if` branch is only tracked when that branch executes

### Zoneless Angular 21
- Angular 21 is zoneless by default (zone.js excluded from `ng new`)
- Signal writes schedule component re-renders without Zone.js
- `OnPush` is effectively the default behavior in zoneless mode
- Performance gains documented: 30-50 KB bundle reduction, 40-50% LCP improvement

### Batching
- Multiple synchronous signal updates are batched
- Effects and template updates run once with the final state, not for each intermediate value

---

## Code Patterns

### Basic signal usage
```typescript
// src/app/counter.component.ts
import { Component, signal, computed, effect } from '@angular/core';

@Component({
  selector: 'app-counter',
  template: `
    <p>Count: {{ count() }}</p>
    <p>Double: {{ doubleCount() }}</p>
    <button (click)="increment()">+1</button>
  `
})
export class CounterComponent {
  count = signal(0);
  doubleCount = computed(() => this.count() * 2);

  constructor() {
    effect(() => {
      console.log(`Count changed to: ${this.count()}`);
    });
  }

  increment(): void {
    this.count.update(v => v + 1);
  }
}
```

### Custom equality to prevent unnecessary updates
```typescript
// src/app/user.service.ts
const user = signal<User>(initialUser, {
  equal: (a, b) => a.id === b.id && a.version === b.version
});
```

### Immutable update pattern (objects and arrays)
```typescript
// WRONG: mutation -- signal won't notify
this.items().push(newItem);

// RIGHT: new reference
this.items.update(items => [...items, newItem]);
```

### linkedSignal -- default selection that resets
```typescript
// src/app/shipping.component.ts
const shippingOptions = signal<ShippingMethod[]>([...]);
const selectedOption = linkedSignal(() => this.shippingOptions()[0]);

// User overrides:
selectedOption.set(someOtherOption);
// When shippingOptions changes, selectedOption resets to first item
```

### linkedSignal -- advanced form preserving user selection
```typescript
// src/app/product-selector.component.ts
const selectedOption = linkedSignal<ShippingMethod[], ShippingMethod>({
  source: this.shippingOptions,
  computation: (newOptions, previous) => {
    const found = newOptions.find(opt => opt.id === previous?.value?.id);
    return found ?? newOptions[0];
  }
});
```

### effect() with cleanup
```typescript
// src/app/data-fetcher.component.ts
effect((onCleanup) => {
  const userId = this.userId();
  const abortController = new AbortController();

  fetch(`/api/users/${userId}`, { signal: abortController.signal });

  onCleanup(() => abortController.abort());
});
```

### effect() with untracked reads
```typescript
// src/app/tracker.component.ts
effect(() => {
  const user = this.currentUser(); // tracked dependency

  untracked(() => {
    // loggingService may read signals internally -- those are NOT tracked
    this.loggingService.log(`User changed to: ${user.name}`);
  });
});
```

### Dynamic dependency tracking in computed
```typescript
// src/app/conditional.component.ts
const showDetails = signal(false);
const details = signal('Some details');
const display = computed(() => {
  if (showDetails()) {
    return `Details: ${details()}`; // details() tracked only when showDetails is true
  }
  return 'Details hidden';
});
```

### Exposing read-only signals from services
```typescript
// src/app/auth.service.ts
@Injectable({ providedIn: 'root' })
export class AuthService {
  private _user = signal<User | null>(null);
  readonly user = this._user.asReadonly();

  login(credentials: Credentials): void {
    // ... authenticate ...
    this._user.set(authenticatedUser);
  }
}
```

### Frozen sentinel for empty arrays (performance)
```typescript
const EMPTY_ARRAY = Object.freeze([]) as readonly never[];
const filteredItems = computed(() => {
  const result = this.allItems().filter(predicate);
  return result.length > 0 ? result : EMPTY_ARRAY as unknown as Item[];
});
```

### RxJS interop bridge (teaser for Chapter 5+)
```typescript
// The "golden pattern": Signal -> RxJS -> Signal
items = toSignal(
  toObservable(this.query).pipe(
    debounceTime(500),
    distinctUntilChanged(),
    switchMap(q => this.http.get<Item[]>(`/api/items?q=${q}`))
  ),
  { initialValue: [] }
);
```

---

## Breaking Changes and Gotchas

### Renamed/Removed APIs
- `mutate()` removed before v17 stable (PR #51821) -- encouraged mutable patterns
- `allowSignalWrites` option deprecated in v19 -- signal writes in effects allowed by default
- `TestBed.flushEffects()` deprecated in v20 -- use `TestBed.tick()` instead
- `afterRender()` renamed to `afterEveryRender()` in v20

### Behavior Changes by Version
- **v19:** Effect timing changed -- effects triggered outside change detection now run as part of change detection instead of as microtasks
- **v19:** `toObservable()` of input signals now emits earlier than before
- **v20:** `effect()` and `linkedSignal()` promoted from developer preview to stable
- **v21:** No breaking changes to signal APIs. Zoneless by default.

### Common Pitfalls

1. **Using effect() for derived state** -- the #1 mistake. Use `computed()` or `linkedSignal()` instead. `effect()` is async, causing `ExpressionChangedAfterItHasBeenChecked` errors.

2. **Side effects in computed()** -- must be a pure function. Angular may re-evaluate computed signals multiple times during optimization.

3. **Mutating objects/arrays in signals** -- signals use `Object.is()`. Mutation doesn't change the reference, so consumers are never notified. Always create new references.

4. **Async reads not tracked** -- signal reads inside setTimeout, Promise.then, or RxJS callbacks within an effect are NOT tracked. The reactive context is synchronous only.

5. **Hidden cost of reference changes** -- creating new empty arrays `[]` in computed triggers downstream re-computation. Use frozen sentinel values.

6. **toSignal() in services** -- creates persistent subscriptions that never clean up. Convert at the component level instead.

7. **HTTP calls inside effects** -- loses RxJS operator benefits (debouncing, cancellation). Use httpResource, rxResource, or toObservable + RxJS pipe.

8. **Conditional dependencies in effects** -- signals read inside conditional branches create dynamic dependencies, leading to confusing tracking behavior.

---

## Sources

### Official Documentation
- [Angular Signals Overview Guide](https://angular.dev/guide/signals)
- [Angular linkedSignal Guide](https://angular.dev/guide/signals/linked-signal)
- [Angular effect() Guide](https://angular.dev/guide/signals/effect)
- [Angular signal() API Reference](https://angular.dev/api/core/signal)
- [Angular computed() API Reference](https://angular.dev/api/core/computed)
- [Angular effect() API Reference](https://angular.dev/api/core/effect)
- [Angular linkedSignal() API Reference](https://angular.dev/api/core/linkedSignal)
- [Angular WritableSignal API Reference](https://angular.dev/api/core/WritableSignal)
- [Angular RxJS Interop](https://angular.dev/ecosystem/rxjs-interop)

### Angular Team Blog Posts
- [Announcing Angular v20 - Angular Blog](https://blog.angular.dev/announcing-angular-v20-b5c9c06cf301)
- [Latest Updates to effect() in Angular - Angular Blog](https://blog.angular.dev/latest-updates-to-effect-in-angular-f2d2648defcd)

### Expert Blog Posts
- [Rainer Hahnekamp - Angular's effect(): Enforced Asynchrony](https://www.rainerhahnekamp.com/en/angulars-effect-enforced-asynchrony/)
- [Angular Experts - Push & Pull Nature of Angular Signals](https://angularexperts.io/blog/angular-signals-push-pull/)
- [Angular Experts - Will Signals Replace RxJS?](https://angularexperts.io/blog/signals-vs-rxjs/)
- [Kevin Kreuzer - DIY Linked Signals](https://kevinkreuzer.medium.com/diy-linked-signals-7ea78ddbcefb)
- [Kevin Kreuzer - Angular Signal Inputs](https://kevinkreuzer.medium.com/angular-signal-inputs-dbc34370fc7c)
- [Angular Architects - Signals Building Blocks](https://www.angulararchitects.io/blog/angular-signals/)
- [Eugeniy Oz - Angular Signals Best Practices](https://medium.com/@eugeniyoz/angular-signals-best-practices-9ac837ab1cec)
- [Angular University - Angular Signals Complete Guide](https://blog.angular-university.io/angular-signals/)
- [Angular.love - The Hidden Cost of Reference Changes](https://angular.love/angular-signals-the-hidden-cost-of-reference-changes/)

### Community Articles
- [Signals: The Do's and Don'ts](https://dev.to/this-is-angular/signals-the-do-s-and-the-dont-s-40fk)
- [Angular Signals Effect(): Why 90% of Developers Use It Wrong](https://dev.to/codewithrajat/angular-signals-effect-why-90-of-developers-use-it-wrong-4pl4)
- [7 Signal Anti-Patterns That Kill Performance](https://medium.com/@sourabhda1998/7-signal-anti-patterns-that-silently-kill-angular-performance-8faa39f74c0e)
- [Angular Signals: computed() vs linkedSignal()](https://nguenkam.com/blog/index.php/2026/03/19/angular-signals-computed-vs-linkedsignal-when-to-use-which/)

### Release Notes
- [Google Ships Angular 21 - InfoQ](https://www.infoq.com/news/2025/11/angular-21-released/)
- [Angular 21 Upgrade Guide - yeou.dev](https://www.yeou.dev/articulos/angular21-upgrade)

---

## Open Questions

1. **afterRenderEffect() phases:** The exact phase API (earlyRead, write, mixedReadWrite, read) needs verification against Angular 21 docs before writing. Confirm if this should be covered in Ch 4 or deferred to Ch 5 (Signal-Based Components).

2. **Signal debugging:** The `debugName` option and Angular DevTools integration for signals should be verified -- is DevTools signal inspection stable in Angular 21?

3. **Scope of RxJS interop coverage:** Chapter 3 teased toSignal/toObservable. Chapter 4 should mention them briefly but full coverage is in later chapters (Ch 20: rxMethod and RxJS Interop). Need to calibrate depth.

4. **assertNotInReactiveContext():** Confirm the exact import path and whether this is a stable API in Angular 21.
