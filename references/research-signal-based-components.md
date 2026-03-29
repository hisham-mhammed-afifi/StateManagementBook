# Research: Signal-Based Components

**Date:** 2026-03-29
**Chapter:** Ch 5
**Status:** Ready for chapter generation

## API Surface

### `input()` and `input.required()`

- **Import:** `import { input } from '@angular/core';`
- **Stability:** Stable (since Angular v19.0)
- **Replaces:** `@Input()` decorator
- **Returns:** `InputSignal<T>` (read-only signal) or `InputSignalWithTransform<T, TransformT>`

**Signatures:**

```ts
// Optional input (no initial value) -- T | undefined
input<T>(): InputSignal<T | undefined>;

// Optional input with default
input<T>(initialValue: T, opts?: InputOptionsWithoutTransform<T>): InputSignal<T>;

// Optional input with transform
input<T, TransformT>(initialValue: T, opts: InputOptionsWithTransform<T, TransformT>): InputSignalWithTransform<T, TransformT>;

// Required input
input.required<T>(opts?: InputOptionsWithoutTransform<T>): InputSignal<T>;

// Required input with transform
input.required<T, TransformT>(opts: InputOptionsWithTransform<T, TransformT>): InputSignalWithTransform<T, TransformT>;
```

**Options:**

```ts
interface InputOptions<T, TransformT> {
  alias?: string;
  transform?: (v: TransformT) => T;
  debugName?: string;
}
```

**Built-in transforms:**
- `booleanAttribute` from `@angular/core` -- treats attribute presence as `true`, "false" string as `false`
- `numberAttribute` from `@angular/core` -- parses string to number

---

### `model()` and `model.required()`

- **Import:** `import { model } from '@angular/core';`
- **Stability:** Stable (since Angular v19.0)
- **Replaces:** The `@Input() value` + `@Output() valueChange` two-way binding pattern
- **Returns:** `ModelSignal<T>` (extends `WritableSignal<T>`)

**Signatures:**

```ts
// Optional model (no initial value)
model<T>(): ModelSignal<T | undefined>;

// Optional model with default
model<T>(initialValue: T, opts?: ModelOptions): ModelSignal<T>;

// Required model
model.required<T>(opts?: ModelOptions): ModelSignal<T>;
```

**Options:**

```ts
interface ModelOptions {
  alias?: string;
  debugName?: string;
}
```

**Key behavior:**
- Declaring `checked = model(false)` auto-creates an input `checked` and output `checkedChange`
- Parent uses banana-in-a-box syntax: `[(checked)]="isChecked"`
- Unlike `input()`, `model()` is **writable** -- `.set()` and `.update()` work
- **Does NOT support transforms** (values flow bidirectionally)

---

### `output()`

- **Import:** `import { output } from '@angular/core';`
- **Stability:** Stable (since Angular v19.0)
- **Replaces:** `@Output()` decorator with `EventEmitter`
- **Returns:** `OutputEmitterRef<T>`

**Signature:**

```ts
output<T = void>(opts?: OutputOptions): OutputEmitterRef<T>;
```

**Options:**

```ts
interface OutputOptions {
  alias?: string;
}
```

**OutputEmitterRef methods:**

```ts
class OutputEmitterRef<T> {
  emit(value: T): void;
  subscribe(callback: (value: T) => void): OutputRefSubscription;
}
```

**RxJS interop:**
- `outputFromObservable(obs$)` from `@angular/core/rxjs-interop` -- converts Observable to output
- `outputToObservable(outputRef)` from `@angular/core/rxjs-interop` -- converts output back to Observable

**Advantages over EventEmitter:**
- Properly typed `emit()` (EventEmitter allowed `emit()` with no argument even for typed outputs)
- No RxJS dependency
- Auto-cleanup on component destroy

---

### `viewChild()` and `viewChildren()`

- **Import:** `import { viewChild, viewChildren } from '@angular/core';`
- **Stability:** Stable (since Angular v19.0)
- **Replaces:** `@ViewChild()` and `@ViewChildren()` decorators

**Signatures:**

```ts
// Optional view query
viewChild<T>(locator: ProviderToken<T> | string, opts?: { debugName?: string }): Signal<T | undefined>;

// Optional with read token
viewChild<T, ReadT>(locator: ProviderToken<T> | string, opts: { read: ProviderToken<ReadT>; debugName?: string }): Signal<ReadT | undefined>;

// Required view query
viewChild.required<T>(locator: ProviderToken<T> | string, opts?: { debugName?: string }): Signal<T>;

// Required with read token
viewChild.required<T, ReadT>(locator: ProviderToken<T> | string, opts: { read: ProviderToken<ReadT>; debugName?: string }): Signal<ReadT>;

// View children (always returns array, never undefined)
viewChildren<T>(locator: ProviderToken<T> | string, opts?: { debugName?: string }): Signal<ReadonlyArray<T>>;

// View children with read token
viewChildren<T, ReadT>(locator: ProviderToken<T> | string, opts: { read: ProviderToken<ReadT>; debugName?: string }): Signal<ReadonlyArray<ReadT>>;
```

**No `static: true` option:** Signal queries do not have this option. They resolve after view init and update reactively when DOM changes (e.g., items added/removed via `@if`/`@for`).

---

### `contentChild()` and `contentChildren()`

- **Import:** `import { contentChild, contentChildren } from '@angular/core';`
- **Stability:** Stable (since Angular v19.0)
- **Replaces:** `@ContentChild()` and `@ContentChildren()` decorators

**Signatures:**

```ts
// Optional content query
contentChild<T>(locator: ProviderToken<T> | string, opts?: { descendants?: boolean; read?: undefined; debugName?: string }): Signal<T | undefined>;

// Required content query
contentChild.required<T>(locator: ProviderToken<T> | string, opts?: { descendants?: boolean; debugName?: string }): Signal<T>;

// Content children
contentChildren<T>(locator: ProviderToken<T> | string, opts?: { descendants?: boolean; debugName?: string }): Signal<ReadonlyArray<T>>;
```

**`descendants` option:** defaults to `true`. When `false`, only queries direct content children.

---

### `linkedSignal()`

- **Import:** `import { linkedSignal } from '@angular/core';`
- **Stability:** Stable (since Angular v19.0)
- **Returns:** `WritableSignal<T>`

Relevant to this chapter because it solves the "immutable input" problem -- deriving writable local state from a read-only `input()`.

**Two forms:**

```ts
// Shorthand: writable signal that resets when source changes
linkedSignal(() => someInput());

// Full form: with source, computation, and optional previous value
linkedSignal({
  source: () => someInput(),
  computation: (sourceValue, previous) => { ... },
  equal?: (a, b) => boolean
});
```

---

## Key Concepts

- **Signal inputs are read-only.** You cannot `.set()` or `.update()` them. Only Angular's binding system updates values. This enforces unidirectional data flow.
- **`model()` is the two-way binding primitive.** It creates both an input and output, and is writable. Use for form-control-like components.
- **`output()` replaces EventEmitter** with a lighter, type-safe, non-RxJS alternative.
- **Signal queries are reactive.** Unlike decorator-based queries, signal-based queries automatically update when the DOM changes (elements added/removed by control flow).
- **`linkedSignal` bridges immutable inputs and mutable local state.** This is the correct pattern when a component needs local modifications derived from an input.
- **All decorator-based APIs remain supported** but are not recommended for new code. Migration schematics exist.
- **All signal-based component APIs are stable** since v19.0. No experimental labels needed.

## Code Patterns

### Pattern 1: Required vs Optional Inputs

```ts
// src/app/components/product-card.component.ts
import { Component, input } from '@angular/core';

@Component({
  selector: 'app-product-card',
  template: `
    <div class="card">
      <h3>{{ name() }}</h3>
      <span class="price">{{ price() | currency }}</span>
      @if (badge()) {
        <span class="badge">{{ badge() }}</span>
      }
    </div>
  `
})
export class ProductCardComponent {
  name = input.required<string>();      // Must be provided by parent
  price = input.required<number>();     // Must be provided by parent
  badge = input<string>();              // Optional, undefined if not set
  featured = input(false);              // Optional with default
}
```

### Pattern 2: Input Transforms

```ts
// src/app/components/button.component.ts
import { Component, input, booleanAttribute, numberAttribute } from '@angular/core';

@Component({
  selector: 'app-button',
  template: `<button [disabled]="disabled()" [style.width.px]="width()">...</button>`
})
export class ButtonComponent {
  disabled = input(false, { transform: booleanAttribute });
  width = input(100, { transform: numberAttribute });
  label = input('', { transform: (v: string) => v.trim().toUpperCase() });
}

// Usage in template:
// <app-button disabled width="200" label="  click me  " />
// disabled() === true (booleanAttribute transforms presence to true)
// width() === 200 (numberAttribute parses string to number)
// label() === "CLICK ME" (custom transform)
```

### Pattern 3: model() for Two-Way Binding

```ts
// src/app/components/star-rating.component.ts
import { Component, model } from '@angular/core';

@Component({
  selector: 'app-star-rating',
  template: `
    @for (star of stars; track star) {
      <button (click)="rating.set(star)"
              [class.filled]="star <= rating()">
        ★
      </button>
    }
  `
})
export class StarRatingComponent {
  rating = model(0);
  stars = [1, 2, 3, 4, 5];
}

// Parent usage:
// <app-star-rating [(rating)]="productRating" />
```

### Pattern 4: output() with Type Safety

```ts
// src/app/components/search-bar.component.ts
import { Component, output } from '@angular/core';

@Component({
  selector: 'app-search-bar',
  template: `
    <input #q (keyup.enter)="search.emit(q.value)" />
    <button (click)="clear.emit()">Clear</button>
  `
})
export class SearchBarComponent {
  search = output<string>();    // OutputEmitterRef<string>
  clear = output<void>();       // OutputEmitterRef<void>
}

// Parent usage:
// <app-search-bar (search)="onSearch($event)" (clear)="onClear()" />
```

### Pattern 5: outputFromObservable for RxJS Interop

```ts
// src/app/components/scroll-tracker.component.ts
import { Component, ElementRef, inject } from '@angular/core';
import { outputFromObservable } from '@angular/core/rxjs-interop';
import { fromEvent, map, throttleTime } from 'rxjs';

@Component({
  selector: 'app-scroll-tracker',
  template: `<div class="scrollable"><ng-content /></div>`
})
export class ScrollTrackerComponent {
  private el = inject(ElementRef);

  scrollPosition = outputFromObservable(
    fromEvent<Event>(this.el.nativeElement, 'scroll').pipe(
      throttleTime(100),
      map((e) => (e.target as HTMLElement).scrollTop)
    )
  );
}
```

### Pattern 6: viewChild and viewChildren Queries

```ts
// src/app/components/form-container.component.ts
import { Component, viewChild, viewChildren, ElementRef, AfterViewInit } from '@angular/core';

@Component({
  template: `
    <input #searchInput />
    @for (item of items(); track item.id) {
      <app-list-item [data]="item" />
    }
  `
})
export class FormContainerComponent {
  searchInput = viewChild.required<ElementRef>('searchInput');
  listItems = viewChildren(ListItemComponent);

  focusSearch(): void {
    this.searchInput().nativeElement.focus();
  }

  getSelectedItems(): ListItemComponent[] {
    return this.listItems().filter(item => item.selected());
  }
}
```

### Pattern 7: viewChild with read Token

```ts
// src/app/components/chart-host.component.ts
import { Component, viewChild, ViewContainerRef } from '@angular/core';

@Component({
  template: `<div #chartHost></div>`
})
export class ChartHostComponent {
  chartHost = viewChild.required('chartHost', { read: ViewContainerRef });

  loadChart(component: Type<unknown>): void {
    this.chartHost().clear();
    this.chartHost().createComponent(component);
  }
}
```

### Pattern 8: contentChild and contentChildren

```ts
// src/app/components/tab-group.component.ts
import { Component, contentChildren } from '@angular/core';

@Component({
  selector: 'app-tab-group',
  template: `
    <div class="tab-headers">
      @for (tab of tabs(); track tab.label()) {
        <button (click)="selectTab(tab)"
                [class.active]="tab === activeTab()">
          {{ tab.label() }}
        </button>
      }
    </div>
    <ng-content />
  `
})
export class TabGroupComponent {
  tabs = contentChildren(TabComponent);
  // ...
}
```

### Pattern 9: linkedSignal for Mutable Local State from Input

```ts
// src/app/components/editable-name.component.ts
import { Component, input, linkedSignal, output } from '@angular/core';

@Component({
  selector: 'app-editable-name',
  template: `
    <input [value]="localName()" (input)="localName.set($event.target.value)" />
    <button (click)="save.emit(localName())">Save</button>
  `
})
export class EditableNameComponent {
  name = input.required<string>();
  localName = linkedSignal(() => this.name());  // Resets when input changes
  save = output<string>();
}
```

## Breaking Changes and Gotchas

### No Breaking Changes in Angular 21
Angular 21 introduced zero breaking changes to signal-based component APIs. All APIs remain identical to v19/v20.

### Common Pitfalls

1. **Using `effect()` for state synchronization instead of `linkedSignal()`** -- The #1 anti-pattern. `linkedSignal` is synchronous and purpose-built for deriving writable local state from signals. `effect` is async and intended for side effects (logging, DOM manipulation, analytics).

2. **Forgetting parentheses in templates** -- `{{ name }}` does not work for signal inputs. Must use `{{ name() }}`. The compiler does not always catch this.

3. **Trying to write to signal inputs** -- `input()` returns a read-only signal. Calling `.set()` or `.update()` is a compile-time error. Use `linkedSignal()` for local mutable copies or `model()` for two-way binding.

4. **`model()` does not support transforms** -- Because values flow bidirectionally, transforms are not applicable. If you need an input transform with two-way binding, use `input()` with a transform plus `linkedSignal()` plus `output()`.

5. **No `static: true` for signal queries** -- The decorator `@ViewChild('ref', { static: true })` had no signal equivalent. Signal queries always resolve after the view initializes. If you need pre-render access, you must still use the decorator (rare use case).

6. **`viewChildren()` can emit duplicate values** -- GitHub issue #54376 reports duplicate emissions in certain scenarios with `@for`. Be aware of this if using `effect()` with `viewChildren()`.

7. **Mutating objects/arrays passed as inputs** -- Signal equality checks use reference equality by default. Mutating an object in the parent without creating a new reference won't trigger the signal to update. Always create new references.

8. **Decorators are NOT deprecated** -- `@Input()`, `@Output()`, `@ViewChild()`, etc. remain fully supported. There is no deprecation timeline. Signal-based APIs are recommended for new code.

## Migration Schematics

Angular provides automated migration schematics:
- `ng generate @angular/core:signal-input-migration` -- converts `@Input()` to `input()`
- `ng generate @angular/core:signal-queries-migration` -- converts `@ViewChild`/`@ContentChild` to signal queries
- `ng generate @angular/core:output-migration` -- converts `@Output()` to `output()`

## Expert Recommendations

- **Manfred Steyer**: Recommends `input()` + `output()` over `model()` for clarity. Reserve `model()` for genuine form-control-like components (sliders, toggles, date pickers).
- **Kevin Kreuzer**: Describes `linkedSignal` as "writable computeds" and authored "Mastering Angular Signals" eBook.
- **Angular Experts blog**: The #1 `effect()` misuse is state synchronization. `linkedSignal` is the synchronous, purpose-built replacement.

## Sources

### Official Documentation
- https://angular.dev/guide/components/inputs -- Accepting data with input properties
- https://angular.dev/guide/components/outputs -- Custom events with outputs
- https://angular.dev/guide/components/queries -- Referencing component children with queries
- https://angular.dev/guide/templates/two-way-binding -- Two-way binding
- https://angular.dev/guide/signals/linked-signal -- linkedSignal guide
- https://angular.dev/api/core/input -- input() API reference
- https://angular.dev/api/core/model -- model() API reference
- https://angular.dev/api/core/output -- output() API reference
- https://angular.dev/api/core/viewChild -- viewChild() API reference
- https://angular.dev/api/core/contentChild -- contentChild() API reference
- https://angular.dev/api/core/booleanAttribute -- booleanAttribute transform
- https://angular.dev/api/core/numberAttribute -- numberAttribute transform
- https://angular.dev/api/core/InputSignalWithTransform -- InputSignalWithTransform type

### Migration Guides
- https://angular.dev/reference/migrations/signal-inputs -- Signal inputs migration
- https://angular.dev/reference/migrations/signal-queries -- Signal queries migration

### Blog Posts and Community
- https://blog.angular.dev/meet-angular-v19-7b29dfd05b84 -- Angular v19 announcement (stabilization of signal APIs)
- Manfred Steyer's guidance on model() vs input()/output() patterns
- Kevin Kreuzer's "Mastering Angular Signals" eBook
- Angular Experts blog on effect() misuse patterns

### GitHub Issues
- angular/angular#53982 -- Input immutability complexity (resolved by linkedSignal)
- angular/angular#60845 -- Gap between input transforms and model writability (resolved)
- angular/angular#54376 -- viewChildren() duplicate emissions (open)
- angular/angular#57955 -- Deep signal inputs/models feature request (open)

## Open Questions

1. **Deep signals for inputs/models** -- GitHub #57955 requests deep reactivity for signal inputs. Not available yet. Should be mentioned as a known limitation.
2. **`viewChildren()` duplicate emission bug** -- #54376 is still open. Worth noting as a gotcha when combining `viewChildren()` with `effect()`.
3. **Signal-based host bindings** -- Not covered by signal component APIs yet. `@HostBinding` and `@HostListener` remain decorator-only. May be worth a brief mention.
