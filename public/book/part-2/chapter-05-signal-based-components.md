# Chapter 5: Signal-Based Components

Your product catalog is growing. The `ProductSignalStateService` from Chapter 4 holds state cleanly with `signal()`, `computed()`, and `linkedSignal()`. But the service lives in a vacuum. You need a `ProductCardComponent` that receives a product from its parent and highlights a search term. You need a `QuantitySelectorComponent` that lets the user pick a quantity and pushes the value back up for two-way binding. You need a `FilterBarComponent` that emits a search event when the user presses Enter. And you need a `ProductListComponent` that queries its child cards to scroll to the first match.

With the old decorator approach, you would reach for `@Input()`, `@Output() EventEmitter`, `@ViewChild()`, and `@ContentChild()`. Each has its own quirks: `@Input` is mutable (nothing stops the child from reassigning it), `EventEmitter` leaks RxJS internals into your component API, and `@ViewChild` results are `undefined` until `ngAfterViewInit`. The signal-based replacements fix all of these problems. Inputs become read-only signals. Outputs become lightweight emitters with no RxJS dependency. View queries become signals that update reactively when the DOM changes. And a new primitive, `model()`, handles two-way binding in a single declaration.

In this chapter we build each of these pieces, wire them together into a working product catalog, and explore `linkedSignal` as the bridge between immutable inputs and mutable local state.

## A Quick Recap

Chapter 4 introduced four signal primitives: `signal()` for writable state, `computed()` for derived read-only state, `effect()` for side effects, and `linkedSignal()` for writable state that resets when a source changes. We also built a `ProductSignalStateService` that exposes read-only signals to the template. This chapter builds on all four primitives. If `signal()` and `computed()` feel unfamiliar, revisit Chapter 4 before continuing.

## Signal Inputs: input() and input.required()

The `input()` function replaces the `@Input()` decorator. It returns an `InputSignal<T>`, which is a read-only signal. Only Angular's template binding system can set its value. The component cannot call `.set()` or `.update()` on it. This enforces unidirectional data flow at the type level.

There are two variants: `input()` for optional inputs and `input.required()` for mandatory ones.

```typescript
// src/app/products/product-card.component.ts
import { Component, input, computed } from '@angular/core';
import { CurrencyPipe } from '@angular/common';

export interface Product {
  id: number;
  name: string;
  price: number;
  category: string;
}

@Component({
  selector: 'app-product-card',
  imports: [CurrencyPipe],
  template: `
    <div class="product-card" [class.featured]="featured()">
      <h3>{{ product().name }}</h3>
      <p class="price">{{ product().price | currency }}</p>
      <span class="category">{{ product().category }}</span>
      @if (badge()) {
        <span class="badge">{{ badge() }}</span>
      }
    </div>
  `,
})
export class ProductCardComponent {
  readonly product = input.required<Product>();
  readonly featured = input(false);
  readonly badge = input<string>();
}
```

Three input shapes appear here:

- `input.required<Product>()` returns `InputSignal<Product>`. The parent must provide a value. If omitted, Angular throws a compile-time error.
- `input(false)` returns `InputSignal<boolean>`. The type and default are inferred from the argument. If the parent does not bind this input, it stays `false`.
- `input<string>()` returns `InputSignal<string | undefined>`. No default means the type widens to include `undefined`.

The parent binds these in the template the same way as decorator-based inputs:

```html
<!-- src/app/products/product-list.component.html (template excerpt) -->
<app-product-card
  [product]="item"
  [featured]="item.price > 500"
  badge="Sale"
/>
```

### The Alias Option

When the internal property name differs from the template binding name, use the `alias` option:

```typescript
// src/app/shared/tooltip.component.ts
import { Component, input } from '@angular/core';

@Component({
  selector: 'app-tooltip',
  template: `<span class="tooltip">{{ tooltipText() }}</span>`,
})
export class TooltipComponent {
  readonly tooltipText = input.required<string>({ alias: 'tooltip' });
}
```

The parent writes `<app-tooltip tooltip="Click here" />`, but inside the component the property is `tooltipText`.

## Input Transforms

Inputs from HTML attributes arrive as strings. A `<app-panel disabled>` binding sends the string `""`, not `true`. The `transform` option converts the raw value before storing it in the signal.

Angular provides two built-in transforms for the most common conversions:

```typescript
// src/app/shared/collapsible-panel.component.ts
import { Component, input, booleanAttribute, numberAttribute } from '@angular/core';

@Component({
  selector: 'app-collapsible-panel',
  template: `
    <div class="panel" [class.collapsed]="collapsed()">
      <div class="header" (click)="collapsed.set ? undefined : undefined">
        <ng-content select="[panel-header]" />
      </div>
      @if (!collapsed()) {
        <div class="body" [style.max-height.px]="maxHeight()">
          <ng-content />
        </div>
      }
    </div>
  `,
})
export class CollapsiblePanelComponent {
  readonly collapsed = input(false, { transform: booleanAttribute });
  readonly maxHeight = input(300, { transform: numberAttribute });
}
```

`booleanAttribute` converts attribute presence to `true` and the string `"false"` to `false`. `numberAttribute` parses strings into numbers with `parseFloat`. Both are imported from `@angular/core`.

Custom transforms work the same way. The `transform` function receives the raw value and returns the stored type:

```typescript
// src/app/shared/tag.component.ts
import { Component, input } from '@angular/core';

@Component({
  selector: 'app-tag',
  template: `<span class="tag">{{ label() }}</span>`,
})
export class TagComponent {
  readonly label = input('', {
    transform: (value: string) => value.trim().toUpperCase(),
  });
}
```

A parent writing `<app-tag label="  electronics  " />` produces a signal holding `"ELECTRONICS"`.

## Two-Way Binding with model()

Some components need to push values back to the parent. A slider, a toggle, a rating picker. The old pattern required declaring a separate `@Input()` and a matching `@Output()` with `Change` suffix. The `model()` function combines both into one declaration.

```typescript
// src/app/products/quantity-selector.component.ts
import { Component, model } from '@angular/core';

@Component({
  selector: 'app-quantity-selector',
  template: `
    <div class="quantity-selector">
      <button (click)="decrement()" [disabled]="quantity() <= 1">-</button>
      <span class="value">{{ quantity() }}</span>
      <button (click)="increment()" [disabled]="quantity() >= 99">+</button>
    </div>
  `,
})
export class QuantitySelectorComponent {
  readonly quantity = model(1);

  increment(): void {
    this.quantity.update(q => q + 1);
  }

  decrement(): void {
    this.quantity.update(q => q - 1);
  }
}
```

Declaring `quantity = model(1)` creates two things under the hood: an input named `quantity` and an output named `quantityChange`. The parent uses banana-in-a-box syntax to bind both directions:

```html
<!-- src/app/products/cart-item.component.html (template excerpt) -->
<app-quantity-selector [(quantity)]="itemQuantity" />
```

When the child calls `this.quantity.update()`, Angular emits the new value through `quantityChange`, and the parent's `itemQuantity` signal updates automatically.

### ModelSignal Is Writable

The return type of `model()` is `ModelSignal<T>`, which extends `WritableSignal<T>`. This is the key difference from `input()`: a model signal supports `.set()` and `.update()`, while an input signal is read-only.

### model() Does Not Support Transforms

Because values flow in both directions, there is no place to intercept with a transform function. If you need to transform incoming data while also writing back, combine `input()` with a transform, `linkedSignal()` for local state, and `output()` for the write-back:

```typescript
// src/app/shared/trimmed-input.component.ts
import { Component, input, output, linkedSignal } from '@angular/core';

@Component({
  selector: 'app-trimmed-input',
  template: `
    <input
      [value]="localValue()"
      (input)="onInput($event)"
    />
  `,
})
export class TrimmedInputComponent {
  readonly value = input('', {
    transform: (v: string) => v.trim(),
  });

  readonly localValue = linkedSignal(() => this.value());
  readonly valueChange = output<string>();

  onInput(event: Event): void {
    const trimmed = (event.target as HTMLInputElement).value.trim();
    this.localValue.set(trimmed);
    this.valueChange.emit(trimmed);
  }
}
```

### When to Use model() vs input() + output()

Reserve `model()` for components that behave like form controls: the value goes in, the user changes it, the new value goes out. Sliders, toggles, date pickers, rating selectors, and autocomplete inputs are all good candidates. For everything else, prefer explicit `input()` and `output()`. The separate declarations make the data flow direction clear and prevent accidental two-way coupling.

## Outputs with output()

The `output()` function replaces `@Output()` with `EventEmitter`. It returns an `OutputEmitterRef<T>`, a lightweight emitter with exactly two methods: `emit()` and `subscribe()`.

```typescript
// src/app/products/search-bar.component.ts
import { Component, input, output, signal, linkedSignal } from '@angular/core';

@Component({
  selector: 'app-search-bar',
  template: `
    <div class="search-bar">
      <input
        [value]="query()"
        (input)="query.set(asInputValue($event))"
        (keyup.enter)="search.emit(query())"
        [placeholder]="placeholder()"
      />
      <button (click)="search.emit(query())">Search</button>
      @if (query()) {
        <button (click)="onClear()">Clear</button>
      }
    </div>
  `,
})
export class SearchBarComponent {
  readonly placeholder = input('Search products...');
  readonly initialQuery = input('');
  readonly query = linkedSignal(() => this.initialQuery());

  readonly search = output<string>();
  readonly cleared = output<void>();

  asInputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  onClear(): void {
    this.query.set('');
    this.cleared.emit();
  }
}
```

The parent listens to outputs with standard event binding syntax:

```html
<!-- src/app/products/product-page.component.html (template excerpt) -->
<app-search-bar
  initialQuery="laptop"
  (search)="onSearch($event)"
  (cleared)="onClearSearch()"
/>
```

### Why Not EventEmitter?

`OutputEmitterRef` improves on `EventEmitter` in three ways:

1. **Type safety.** `EventEmitter<string>` allowed calling `emit()` with no arguments due to a permissive overload. `OutputEmitterRef<string>` requires a string argument. `OutputEmitterRef<void>` requires no arguments.

2. **No RxJS.** `EventEmitter` extends `Subject`, pulling RxJS into the component's public API. `OutputEmitterRef` has no RxJS dependency. Components that only communicate through inputs and outputs no longer need RxJS at all.

3. **Automatic cleanup.** Subscriptions created with `subscribe()` are cleaned up when the component is destroyed. No `takeUntilDestroyed()` required.

### RxJS Interop: outputFromObservable and outputToObservable

When you need to bridge an RxJS stream to an output (or vice versa), two interop functions handle the conversion:

```typescript
// src/app/shared/resize-observer.component.ts
import { Component, ElementRef, inject } from '@angular/core';
import { outputFromObservable } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-resize-observer',
  template: `<ng-content />`,
})
export class ResizeObserverComponent {
  private readonly el = inject(ElementRef);

  readonly resized = outputFromObservable(
    new Observable<DOMRectReadOnly>(subscriber => {
      const observer = new ResizeObserver(entries => {
        subscriber.next(entries[0].contentRect);
      });
      observer.observe(this.el.nativeElement);
      return () => observer.disconnect();
    })
  );
}
```

The parent consumes `(resized)` like any other output. The Observable subscription is managed internally and cleaned up on destroy.

Going the other direction, `outputToObservable()` from `@angular/core/rxjs-interop` converts an `OutputEmitterRef` to an `Observable` for parents that prefer RxJS operators.

## Signal View Queries: viewChild() and viewChildren()

The decorator `@ViewChild()` resolved to `undefined` until `ngAfterViewInit`, forcing you into lifecycle hooks. The signal-based `viewChild()` returns a signal that starts as `undefined` and updates reactively whenever the DOM changes. No lifecycle hook required.

```typescript
// src/app/products/product-search-page.component.ts
import { Component, viewChild, viewChildren, signal, computed, ElementRef } from '@angular/core';
import { ProductCardComponent, Product } from './product-card.component';
import { SearchBarComponent } from './search-bar.component';

const PRODUCTS: Product[] = [
  { id: 1, name: 'Laptop Pro', price: 1299, category: 'Electronics' },
  { id: 2, name: 'Mechanical Keyboard', price: 89, category: 'Electronics' },
  { id: 3, name: 'Standing Desk', price: 549, category: 'Furniture' },
  { id: 4, name: 'Ergonomic Chair', price: 399, category: 'Furniture' },
  { id: 5, name: 'USB-C Monitor', price: 649, category: 'Electronics' },
  { id: 6, name: 'Desk Lamp', price: 75, category: 'Furniture' },
];

@Component({
  selector: 'app-product-search-page',
  imports: [ProductCardComponent, SearchBarComponent],
  template: `
    <app-search-bar (search)="onSearch($event)" (cleared)="onSearch('')" />

    <p>{{ matchCount() }} products found</p>

    <div #listContainer class="product-list">
      @for (product of filteredProducts(); track product.id) {
        <app-product-card
          [product]="product"
          [featured]="product.price > 500"
        />
      }
    </div>
  `,
})
export class ProductSearchPageComponent {
  readonly searchQuery = signal('');

  readonly filteredProducts = computed(() => {
    const query = this.searchQuery().toLowerCase();
    if (!query) return PRODUCTS;
    return PRODUCTS.filter(p => p.name.toLowerCase().includes(query));
  });

  readonly matchCount = computed(() => this.filteredProducts().length);

  readonly listContainer = viewChild.required<ElementRef>('listContainer');
  readonly productCards = viewChildren(ProductCardComponent);

  onSearch(query: string): void {
    this.searchQuery.set(query);
    this.listContainer().nativeElement.scrollTop = 0;
  }
}
```

Three query patterns appear here:

- `viewChild.required<ElementRef>('listContainer')` queries a template reference variable by string. Returns `Signal<ElementRef>`. Throws at runtime if the element does not exist.
- `viewChild(SomeComponent)` queries by component type. Returns `Signal<SomeComponent | undefined>` because the element might be conditionally rendered with `@if`.
- `viewChildren(ProductCardComponent)` returns `Signal<ReadonlyArray<ProductCardComponent>>`. The array updates automatically when items are added or removed by `@for`.

### The read Option

Sometimes you need a different token from the query target. For example, querying a template reference variable but reading its `ViewContainerRef` for dynamic component loading:

```typescript
// src/app/shared/dynamic-host.component.ts
import { Component, viewChild, ViewContainerRef, Type } from '@angular/core';

@Component({
  selector: 'app-dynamic-host',
  template: `<div #outlet></div>`,
})
export class DynamicHostComponent {
  private readonly outlet = viewChild.required('outlet', {
    read: ViewContainerRef,
  });

  loadComponent(component: Type<unknown>): void {
    const vcr = this.outlet();
    vcr.clear();
    vcr.createComponent(component);
  }
}
```

### No static: true

Decorator-based `@ViewChild('ref', { static: true })` resolved the query before the first change detection cycle, making it available in `ngOnInit`. Signal queries have no equivalent option. They always resolve after view initialization and update dynamically. If you have a rare case that requires pre-render access, the decorator remains available.

## Signal Content Queries: contentChild() and contentChildren()

Content queries work the same way as view queries but target projected content (elements passed through `<ng-content>`).

```typescript
// src/app/shared/accordion.component.ts
import { Component, contentChildren, signal, input } from '@angular/core';

@Component({
  selector: 'app-accordion-item',
  template: `
    <div class="accordion-item" [class.open]="open()">
      <button class="accordion-header" (click)="toggle()">
        {{ title() }}
      </button>
      @if (open()) {
        <div class="accordion-body">
          <ng-content />
        </div>
      }
    </div>
  `,
})
export class AccordionItemComponent {
  readonly title = input.required<string>();
  readonly open = signal(false);

  toggle(): void {
    this.open.update(v => !v);
  }
}

@Component({
  selector: 'app-accordion',
  template: `
    <div class="accordion">
      <ng-content />
    </div>
    <button (click)="collapseAll()">Collapse All</button>
  `,
})
export class AccordionComponent {
  readonly items = contentChildren(AccordionItemComponent);

  collapseAll(): void {
    for (const item of this.items()) {
      item.open.set(false);
    }
  }
}
```

The parent uses it like this:

```html
<!-- src/app/products/product-faq.component.html (template excerpt) -->
<app-accordion>
  <app-accordion-item title="Shipping">
    Free shipping on orders over $50.
  </app-accordion-item>
  <app-accordion-item title="Returns">
    30-day return policy on all items.
  </app-accordion-item>
  <app-accordion-item title="Warranty">
    1-year manufacturer warranty included.
  </app-accordion-item>
</app-accordion>
```

The `contentChildren` signal returns a `Signal<ReadonlyArray<AccordionItemComponent>>`. It updates automatically if items are added or removed dynamically. The `descendants` option (defaults to `true`) controls whether nested content children are included.

## linkedSignal: Bridging Immutable Inputs and Local State

Chapter 4 introduced `linkedSignal()` for pagination. It appears again here because of a pattern that arises constantly in signal-based components: the parent sends data through an `input()`, but the child needs a local, editable copy.

Consider an inline editor that receives a product name from the parent, lets the user edit it, and emits the saved value:

```typescript
// src/app/products/inline-editor.component.ts
import { Component, input, output, linkedSignal } from '@angular/core';

@Component({
  selector: 'app-inline-editor',
  template: `
    @if (editing()) {
      <input
        [value]="localValue()"
        (input)="localValue.set(asInputValue($event))"
      />
      <button (click)="save()">Save</button>
      <button (click)="cancel()">Cancel</button>
    } @else {
      <span (dblclick)="editing.set(true)">{{ localValue() }}</span>
    }
  `,
})
export class InlineEditorComponent {
  readonly value = input.required<string>();
  readonly valueChanged = output<string>();

  readonly localValue = linkedSignal(() => this.value());
  readonly editing = linkedSignal(() => {
    this.value(); // track: reset editing state when parent value changes
    return false;
  });

  save(): void {
    this.valueChanged.emit(this.localValue());
    this.editing.set(false);
  }

  cancel(): void {
    this.localValue.set(this.value()); // revert to parent value
    this.editing.set(false);
  }

  asInputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
```

Two `linkedSignal` instances work together here. `localValue` resets to the parent's `value()` whenever the parent changes. `editing` resets to `false` when the parent's value changes (preventing stale edit state if the parent pushes a new value while the user is editing). Both are writable for local interaction.

Without `linkedSignal`, the tempting alternative is `effect()`:

```typescript
// WRONG -- do not use effect() for state synchronization
constructor() {
  effect(() => {
    this.localValue.set(this.value());
  });
}
```

This is asynchronous, creates a timing gap between the input change and the local state update, and can cause glitches during rendering. `linkedSignal` is synchronous and evaluates in the same change detection pass as the input update.

## Putting It All Together

Here is a complete product catalog page that combines every signal-based component API from this chapter:

```typescript
// src/app/products/product-catalog-page.component.ts
import { Component, signal, computed } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { SearchBarComponent } from './search-bar.component';
import { ProductCardComponent, Product } from './product-card.component';
import { QuantitySelectorComponent } from './quantity-selector.component';
import { InlineEditorComponent } from './inline-editor.component';

const CATALOG: Product[] = [
  { id: 1, name: 'Laptop Pro', price: 1299, category: 'Electronics' },
  { id: 2, name: 'Mechanical Keyboard', price: 89, category: 'Electronics' },
  { id: 3, name: 'Standing Desk', price: 549, category: 'Furniture' },
  { id: 4, name: 'Ergonomic Chair', price: 399, category: 'Furniture' },
  { id: 5, name: 'USB-C Monitor', price: 649, category: 'Electronics' },
  { id: 6, name: 'Desk Lamp', price: 75, category: 'Furniture' },
];

@Component({
  selector: 'app-product-catalog-page',
  imports: [
    CurrencyPipe,
    SearchBarComponent,
    ProductCardComponent,
    QuantitySelectorComponent,
    InlineEditorComponent,
  ],
  template: `
    <h1>Product Catalog</h1>

    <app-search-bar
      placeholder="Filter products..."
      (search)="searchQuery.set($event)"
      (cleared)="searchQuery.set('')"
    />

    <p>Showing {{ filteredProducts().length }} of {{ products().length }} products</p>

    @for (product of filteredProducts(); track product.id) {
      <div class="catalog-item">
        <app-product-card
          [product]="product"
          [featured]="product.price > 500"
        />
        <app-inline-editor
          [value]="product.name"
          (valueChanged)="renameProduct(product.id, $event)"
        />
        <div class="actions">
          <app-quantity-selector [(quantity)]="quantities()[product.id]" />
          <span class="subtotal">
            Subtotal: {{ product.price * (quantities()[product.id] ?? 1) | currency }}
          </span>
        </div>
      </div>
    }
  `,
})
export class ProductCatalogPageComponent {
  readonly products = signal(CATALOG);
  readonly searchQuery = signal('');
  readonly quantities = signal<Record<number, number>>({});

  readonly filteredProducts = computed(() => {
    const query = this.searchQuery().toLowerCase();
    if (!query) return this.products();
    return this.products().filter(p =>
      p.name.toLowerCase().includes(query)
    );
  });

  renameProduct(id: number, newName: string): void {
    this.products.update(products =>
      products.map(p => (p.id === id ? { ...p, name: newName } : p))
    );
  }
}
```

Data flows in one direction through `input()` signals. User actions flow back through `output()` emitters and `model()` signals. Local editable state is derived from inputs via `linkedSignal()`. The template reads signals with function calls, and Angular tracks all dependencies automatically.

## Migration from Decorators

Angular provides automated migration schematics that convert decorator-based code to signal-based APIs:

```bash
# Convert @Input() to input()
ng generate @angular/core:signal-input-migration

# Convert @Output() EventEmitter to output()
ng generate @angular/core:output-migration

# Convert @ViewChild/@ContentChild to signal queries
ng generate @angular/core:signal-queries-migration
```

Each schematic analyzes your codebase, identifies decorator usages, and converts them. The schematics handle alias preservation, `required` detection, and transform migration. Run them one at a time and review the diffs. The decorator-based APIs are not deprecated and remain fully supported, so you can migrate incrementally.

## Common Mistakes

### Mistake 1: Using effect() to Sync Local State from an Input

```typescript
// WRONG
@Component({ /* ... */ })
export class EditableFieldComponent {
  readonly value = input.required<string>();
  readonly localValue = signal('');

  constructor() {
    effect(() => {
      this.localValue.set(this.value());
    });
  }
}
```

`effect()` runs asynchronously. Between the moment `value()` changes and the moment the effect executes, `localValue` holds the old value. If the template reads both signals in the same render, they are inconsistent.

```typescript
// CORRECT
@Component({ /* ... */ })
export class EditableFieldComponent {
  readonly value = input.required<string>();
  readonly localValue = linkedSignal(() => this.value());
}
```

`linkedSignal` evaluates synchronously in the same change detection pass. No timing gap, no stale state.

### Mistake 2: Trying to Write to a Signal Input

```typescript
// WRONG -- compile-time error
@Component({ /* ... */ })
export class CounterComponent {
  readonly count = input(0);

  increment(): void {
    this.count.set(this.count() + 1); // ERROR: Property 'set' does not exist on type 'InputSignal<number>'
  }
}
```

`InputSignal<T>` is read-only. The TypeScript compiler catches this immediately. If you need a writable local copy, use `linkedSignal`. If you need two-way binding, use `model()`.

```typescript
// CORRECT -- use linkedSignal for local editable copy
@Component({ /* ... */ })
export class CounterComponent {
  readonly initialCount = input(0);
  readonly count = linkedSignal(() => this.initialCount());

  increment(): void {
    this.count.update(c => c + 1);
  }
}
```

### Mistake 3: Expecting Transforms on model()

```typescript
// WRONG -- TypeScript error: 'transform' does not exist in type 'ModelOptions'
@Component({ /* ... */ })
export class ToggleComponent {
  readonly checked = model(false, {
    transform: booleanAttribute, // NOT SUPPORTED
  });
}
```

Transforms cannot work with two-way binding because the value must flow back to the parent untransformed. If you need transformation on an input that also writes back, use the `input()` + `linkedSignal()` + `output()` pattern shown earlier in this chapter.

```typescript
// CORRECT -- use input with transform and a separate output
@Component({ /* ... */ })
export class ToggleComponent {
  readonly checked = input(false, { transform: booleanAttribute });
  readonly localChecked = linkedSignal(() => this.checked());
  readonly checkedChange = output<boolean>();

  toggle(): void {
    this.localChecked.update(v => !v);
    this.checkedChange.emit(this.localChecked());
  }
}
```

### Mistake 4: Forgetting Parentheses When Reading Signal Inputs

```html
<!-- WRONG -- displays "[object Object]" or "[Signal]" -->
<h3>{{ product.name }}</h3>
```

Signal inputs are functions. Omitting the parentheses reads the signal object itself, not its value. The Angular compiler does not always catch this, especially with complex expressions.

```html
<!-- CORRECT -->
<h3>{{ product().name }}</h3>
```

Every signal read in the template must include `()`. This applies to `input()`, `model()`, `viewChild()`, `contentChildren()`, and any `computed()` or `linkedSignal()`.

### Mistake 5: Mutating Objects Without Creating New References

```typescript
// WRONG -- the parent mutates the array in place
updateProducts(): void {
  const products = this.products();
  products.push(newProduct); // same reference
  this.products.set(products); // signal sees same reference, no notification
}
```

Signals use `Object.is()` for equality by default. Mutating an array in place and calling `set()` with the same reference triggers no update. The child component's `input()` signal stays stale.

```typescript
// CORRECT -- always create a new reference
updateProducts(): void {
  this.products.update(products => [...products, newProduct]);
}
```

This rule applies equally to objects. Use spread syntax to create new references whenever state changes.

## Key Takeaways

- **Signal inputs (`input()`) are read-only, enforcing unidirectional data flow at the type level.** Use `input.required()` for mandatory bindings and `input(defaultValue)` for optional ones. Transforms handle string-to-type conversions for HTML attributes.

- **`model()` is for two-way binding.** It creates both an input and output in a single declaration, returning a writable `ModelSignal`. Reserve it for form-control-like components. For everything else, use explicit `input()` and `output()`.

- **`linkedSignal()` bridges immutable inputs and mutable local state.** When a component needs to edit a value received from an input, `linkedSignal` creates a writable copy that resets when the source changes. Never use `effect()` for this purpose.

- **Signal queries (`viewChild`, `viewChildren`, `contentChild`, `contentChildren`) are reactive.** They return signals that update automatically when the DOM changes. No lifecycle hooks required. Use `viewChild.required()` when the target is guaranteed to exist.

- **`output()` replaces `EventEmitter` with a lighter, type-safe emitter that has no RxJS dependency.** Use `outputFromObservable()` to bridge RxJS streams into the output system when needed.
