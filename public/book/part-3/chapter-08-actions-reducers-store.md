# Chapter 8: Actions, Reducers, and the Store

Your product catalog has grown. What started as a single service with a `BehaviorSubject` in Chapter 3 now spans multiple feature areas: a product list, a shopping cart, user authentication, and a checkout flow. The product team wants to know why a user's cart emptied itself during a route change. The support team asks you to reproduce a bug where a discount code applied twice. You open the code, stare at six services that call each other's methods in unpredictable order, and realize you cannot answer either question. You have no record of what happened, in what order, or what triggered each state change. The problem is not your state container. The problem is that state changes are invisible.

NgRx solves this by making every state change explicit. Instead of calling methods that silently mutate state, you dispatch actions that describe what happened. Instead of scattering mutation logic across services, you concentrate it in pure functions called reducers. Instead of piecing together state from multiple sources, you read from a single Store. Every action is logged. Every state transition is reproducible. And with DevTools, you can step through every change that led to a bug and replay it. In this chapter, we install NgRx, define actions and reducers for our product catalog, wire the Store into an Angular 21 standalone application, and set up Redux DevTools to inspect every state change in real time.

## A Quick Recap

Part 2 covered Angular's built-in reactivity primitives. `signal()` holds a value. `computed()` derives from signals. `effect()` runs side effects. `httpResource` fetches data into signals declaratively. In Chapter 3, we built a `ProductStateService` using `BehaviorSubject` that exposed state through Observables and mutated it through methods. That pattern works well for isolated features, but breaks down when state changes span multiple concerns and you need traceability. NgRx formalizes the unidirectional data flow from Chapter 2 into a strict architecture: actions in, state out, everything logged.

## The Redux Pattern in Angular

NgRx implements the Redux pattern. Three rules define it:

1. **Single source of truth.** The entire application state lives in one Store object. Components do not own shared state. They read from the Store and dispatch actions to request changes.

2. **State is read-only.** No component or service can modify the Store directly. The only way to change state is to dispatch an action, a plain object that describes what happened.

3. **Changes happen through pure functions.** Reducers take the current state and an action, and return a brand-new state object. They never mutate the input. They never call APIs. They never read from `localStorage`. Given the same state and the same action, they always return the same result.

Picture the data flow:

```
Component ──dispatch(action)──> Store ──forwards──> Reducer(state, action) ──returns──> New State
    ↑                                                                                      │
    └─────────────────── selector reads slice of state ◄───────────────────────────────────┘
```

A component dispatches an action. The Store passes the current state and that action to every registered reducer. Each reducer checks whether it handles that action type and, if so, returns a new state object with the relevant changes. The Store holds the new state. Selectors (covered in depth in Chapter 9) extract slices of state and deliver them to components. The component re-renders. The cycle repeats.

This loop is the single most important concept in NgRx. Every API in this chapter exists to implement one step of this loop.

## Setting Up NgRx in Angular 21

NgRx provides standalone provider functions that integrate with Angular's `bootstrapApplication` pattern. No `NgModule` required.

```typescript
// src/app/app.config.ts
import { ApplicationConfig, isDevMode } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideStore } from '@ngrx/store';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideStore(),
    provideStoreDevtools({
      maxAge: 25,
      logOnly: !isDevMode(),
      autoPause: true,
    }),
  ],
};
```

`provideStore()` initializes the root Store. Calling it with no arguments creates an empty root state. Feature states register themselves later via `provideState()`, typically in lazy-loaded route configurations. `provideStoreDevtools()` connects the Store to the Redux DevTools browser extension. We pass `maxAge: 25` to keep the last 25 actions in the history buffer, `logOnly: !isDevMode()` to disable time-travel features in production, and `autoPause: true` to stop recording when the DevTools window is closed.

The application bootstraps with this config:

```typescript
// src/main.ts
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

bootstrapApplication(AppComponent, appConfig);
```

That is the entire setup. No `StoreModule.forRoot()`, no `NgModule` imports. Two function calls.

## Actions: Describing What Happened

An action is a plain object with a `type` property. The type is a string that uniquely identifies what happened. Actions can carry additional data as properties. NgRx provides two ways to define actions: `createAction` for individual actions, and `createActionGroup` for related sets.

### createAction

The `createAction` function returns a typed action creator. It has three overloads:

```typescript
// src/app/products/state/products.actions.ts
import { createAction, props } from '@ngrx/store';
import { Product } from '../product.model';

// No payload: the type string is all the information needed
export const productsPageOpened = createAction(
  '[Products Page] Opened'
);

// With props: additional data attached to the action
export const productSelected = createAction(
  '[Products Page] Product Selected',
  props<{ productId: string }>()
);

// With props for API responses
export const productsLoadedSuccess = createAction(
  '[Products API] Products Loaded Successfully',
  props<{ products: Product[] }>()
);

export const productsLoadedFailure = createAction(
  '[Products API] Products Loaded Failure',
  props<{ error: string }>()
);
```

The `props<T>()` function defines the shape of the action's payload. When you dispatch `productSelected({ productId: '42' })`, NgRx creates the object `{ type: '[Products Page] Product Selected', productId: '42' }`. The type string follows the convention `[Source] Event Name`, where the source identifies where the action originated and the event name describes what happened. This convention matters for debugging: when you see 50 actions in DevTools, `[Products Page] Product Selected` tells you immediately which component triggered it and what occurred.

### createActionGroup: The Modern Default

Defining individual actions gets repetitive. `createActionGroup` groups related actions by source and generates typed creators automatically:

```typescript
// src/app/products/state/products.actions.ts
import { createActionGroup, emptyProps, props } from '@ngrx/store';
import { Product } from '../product.model';

export const ProductsPageActions = createActionGroup({
  source: 'Products Page',
  events: {
    'Opened': emptyProps(),
    'Product Selected': props<{ productId: string }>(),
    'Search Changed': props<{ query: string }>(),
  },
});

export const ProductsApiActions = createActionGroup({
  source: 'Products API',
  events: {
    'Products Loaded Successfully': props<{ products: Product[] }>(),
    'Products Loaded Failure': props<{ error: string }>(),
  },
});
```

`createActionGroup` does three things:

1. **Generates type strings** in the `[Source] Event Name` format. `ProductsPageActions.opened()` creates `{ type: '[Products Page] Opened' }`.
2. **Generates camelCased creator names** from the event names. `'Product Selected'` becomes `productSelected`. `'Products Loaded Successfully'` becomes `productsLoadedSuccessfully`.
3. **Prevents duplicate type strings** at compile time. If two events in the same group produce the same camelCased name, TypeScript reports an error.

Use `emptyProps()` for actions with no payload. Use `props<T>()` for actions with data. You can also pass a factory function for complex cases:

```typescript
// src/app/products/state/products.actions.ts (factory function variant)
import { createActionGroup } from '@ngrx/store';

export const ProductsApiActions = createActionGroup({
  source: 'Products API',
  events: {
    'Products Loaded Failure': (error: Error) => ({ error: error.message }),
  },
});
```

For the rest of this chapter, we use `createActionGroup` exclusively. It is the recommended pattern in NgRx 21.

### Actions Are Events, Not Commands

This distinction matters. An action named `loadProducts` sounds like a command: "go load the products." An action named `[Products Page] Opened` describes an event: "the products page was opened." The difference affects architecture. A command implies a single handler. An event can have multiple handlers. When the products page opens, a reducer might set `loading: true`, an effect might call an API, and an analytics service might log a page view. All three respond to the same action. If you name actions as commands, you end up creating separate actions for each concern, which defeats the purpose of centralized event logging.

The **SHARI** principle helps you decide which state belongs in the Store. State qualifies if it is: **S**hared across components, **H**ydrated from or to storage, **A**vailable when navigating between routes, **R**etrieved through side effects, or **I**mpacted by actions from other features. Transient UI state like tooltip visibility or hover effects should stay in component-local signals.

## Reducers: Pure State Transitions

A reducer is a pure function that takes the current state and an action and returns a new state. "Pure" means it has no side effects: no API calls, no random values, no reading from external sources. Given the same inputs, it always returns the same output.

### Defining State Shape

Start by defining the interface and initial state:

```typescript
// src/app/products/state/products.reducer.ts
import { Product } from '../product.model';

export interface ProductsState {
  products: Product[];
  selectedProductId: string | null;
  query: string;
  loading: boolean;
  error: string | null;
}

export const initialProductsState: ProductsState = {
  products: [],
  selectedProductId: null,
  query: '',
  loading: false,
  error: null,
};
```

Every property has an explicit type and an explicit initial value. No `undefined`, no optional properties. This makes the state shape predictable and serializable, which is a requirement for DevTools time-travel debugging.

### createReducer and on()

The `createReducer` function takes an initial state followed by one or more `on()` calls. Each `on()` maps one or more action creators to a reducer function:

```typescript
// src/app/products/state/products.reducer.ts
import { createReducer, on } from '@ngrx/store';
import { ProductsPageActions, ProductsApiActions } from './products.actions';

export const productsReducer = createReducer(
  initialProductsState,

  on(ProductsPageActions.opened, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(ProductsPageActions.productSelected, (state, { productId }) => ({
    ...state,
    selectedProductId: productId,
  })),

  on(ProductsPageActions.searchChanged, (state, { query }) => ({
    ...state,
    query,
  })),

  on(ProductsApiActions.productsLoadedSuccessfully, (state, { products }) => ({
    ...state,
    products,
    loading: false,
  })),

  on(ProductsApiActions.productsLoadedFailure, (state, { error }) => ({
    ...state,
    error,
    loading: false,
  })),
);
```

Each reducer function receives the current state and the action's payload (destructured from the second parameter). It returns a new object using the spread operator (`...state`) to copy all existing properties and override only the ones that change. This ensures immutability: the original state object is never modified.

A single `on()` can handle multiple actions when they produce the same state transition:

```typescript
// src/app/products/state/products.reducer.ts (multi-action on)
on(
  ProductsApiActions.productsLoadedSuccessfully,
  ProductsApiActions.productsLoadedFailure,
  (state) => ({
    ...state,
    loading: false,
  })
),
```

If no `on()` matches the dispatched action, `createReducer` returns the current state unchanged. You never need a default case.

## createFeature: Actions, Reducer, and Selectors in One

`createFeature` bundles a feature name, a reducer, and auto-generated selectors into a single object. It eliminates the boilerplate of writing a selector for every state property:

```typescript
// src/app/products/state/products.feature.ts
import { createFeature, createSelector } from '@ngrx/store';
import { productsReducer } from './products.reducer';

export const productsFeature = createFeature({
  name: 'products',
  reducer: productsReducer,
  extraSelectors: ({ selectProducts, selectSelectedProductId, selectQuery }) => ({
    selectFilteredProducts: createSelector(
      selectProducts,
      selectQuery,
      (products, query) =>
        query
          ? products.filter(p =>
              p.name.toLowerCase().includes(query.toLowerCase())
            )
          : products
    ),
    selectSelectedProduct: createSelector(
      selectProducts,
      selectSelectedProductId,
      (products, id) => products.find(p => p.id === id) ?? null
    ),
  }),
});
```

From this single call, `productsFeature` exposes:

- `selectProductsState` - the feature selector that extracts the `products` slice from root state
- `selectProducts` - selects the `products` array
- `selectSelectedProductId` - selects the selected product ID
- `selectQuery` - selects the search query
- `selectLoading` - selects the loading flag
- `selectError` - selects the error message
- `selectFilteredProducts` - the composed extra selector
- `selectSelectedProduct` - the composed extra selector

Every top-level property in `ProductsState` gets a selector automatically. The `extraSelectors` callback receives these base selectors and lets you compose derived selectors from them. Selectors are covered in full detail in Chapter 9; for now, think of them as pure functions that extract and transform slices of state.

## Registering Feature State

Feature state registers through `provideState()`, typically in a route configuration so it loads lazily:

```typescript
// src/app/products/products.routes.ts
import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { productsFeature } from './state/products.feature';

export const productsRoutes: Routes = [
  {
    path: '',
    providers: [
      provideState(productsFeature),
    ],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./products-list.component').then(m => m.ProductsListComponent),
      },
      {
        path: ':id',
        loadComponent: () =>
          import('./product-detail.component').then(m => m.ProductDetailComponent),
      },
    ],
  },
];
```

When the user navigates to the products route, Angular lazy-loads the route configuration, `provideState(productsFeature)` registers the `products` slice in the Store, and the reducer starts handling actions. The root `app.routes.ts` references this lazily:

```typescript
// src/app/app.routes.ts
import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'products',
    loadChildren: () =>
      import('./products/products.routes').then(m => m.productsRoutes),
  },
];
```

## Reading State in Components

The `Store` service is injectable. Use `inject(Store)` and call `selectSignal()` to read state as signals:

```typescript
// src/app/products/products-list.component.ts
import { Component, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { productsFeature } from './state/products.feature';
import { ProductsPageActions } from './state/products.actions';
import { ProductCardComponent } from './product-card.component';

@Component({
  selector: 'app-products-list',
  imports: [ProductCardComponent],
  template: `
    <div class="search-bar">
      <input
        type="text"
        placeholder="Search products..."
        [value]="query()"
        (input)="onSearch($event)" />
    </div>

    @if (loading()) {
      <div class="spinner">Loading products...</div>
    }

    @if (error(); as err) {
      <div class="error-banner">{{ err }}</div>
    }

    <div class="product-grid">
      @for (product of filteredProducts(); track product.id) {
        <app-product-card
          [product]="product"
          (selected)="onSelect(product.id)" />
      } @empty {
        <p>No products match your search.</p>
      }
    </div>
  `,
})
export class ProductsListComponent {
  private readonly store = inject(Store);

  readonly filteredProducts = this.store.selectSignal(productsFeature.selectFilteredProducts);
  readonly loading = this.store.selectSignal(productsFeature.selectLoading);
  readonly error = this.store.selectSignal(productsFeature.selectError);
  readonly query = this.store.selectSignal(productsFeature.selectQuery);

  constructor() {
    this.store.dispatch(ProductsPageActions.opened());
  }

  onSelect(productId: string): void {
    this.store.dispatch(ProductsPageActions.productSelected({ productId }));
  }

  onSearch(event: Event): void {
    const query = (event.target as HTMLInputElement).value;
    this.store.dispatch(ProductsPageActions.searchChanged({ query }));
  }
}
```

`store.selectSignal()` returns a `Signal<T>`. You read it in the template by calling it as a function: `loading()`, `error()`, `filteredProducts()`. Because signals integrate with Angular's change detection natively, the template updates automatically when the selected state changes. No `async` pipe, no manual subscriptions, no cleanup.

`selectSignal` accepts an optional second argument with an `equal` function for custom equality checking:

```typescript
// src/app/products/products-list.component.ts (custom equality)
readonly filteredProducts = this.store.selectSignal(
  productsFeature.selectFilteredProducts,
  { equal: (a, b) => a.length === b.length && a.every((p, i) => p.id === b[i].id) }
);
```

This is useful when a selector returns a new array reference on every emission but the contents have not changed. The default equality check is reference equality (`===`), which means a new array always triggers an update. A custom `equal` function lets you compare by content instead.

### Observable-Based Selection

`store.select()` returns an `Observable<T>` instead of a signal. This is useful when you need RxJS operators for debouncing, combining with other streams, or integrating with legacy code:

```typescript
// src/app/products/products-list.component.ts (Observable variant)
import { toSignal } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged } from 'rxjs';

readonly debouncedQuery = toSignal(
  this.store.select(productsFeature.selectQuery).pipe(
    debounceTime(300),
    distinctUntilChanged(),
  ),
  { initialValue: '' }
);
```

Prefer `selectSignal()` for straightforward reads. Reach for `select()` when you need RxJS operators between the Store and the component.

## Redux DevTools: Inspecting Every State Change

The Redux DevTools browser extension (available for Chrome, Firefox, and Edge) connects to NgRx through `provideStoreDevtools()`. Once configured, every dispatched action appears in the DevTools panel.

Here is a more complete DevTools configuration with all commonly used options:

```typescript
// src/app/app.config.ts
import { ApplicationConfig, isDevMode } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideStore } from '@ngrx/store';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideStore({}, {
      runtimeChecks: {
        strictStateImmutability: true,
        strictActionImmutability: true,
        strictStateSerializability: true,
        strictActionSerializability: true,
        strictActionTypeUniqueness: true,
      },
    }),
    provideStoreDevtools({
      maxAge: 25,
      logOnly: !isDevMode(),
      autoPause: true,
      trace: isDevMode(),
      traceLimit: 75,
    }),
  ],
};
```

### Runtime Checks

The `runtimeChecks` option in `provideStore()` enables development-time guards:

- **`strictStateImmutability`** freezes the state object after every reducer runs. If any code mutates state, Angular throws an error immediately instead of letting the bug propagate silently. Enabled by default in dev mode.
- **`strictActionImmutability`** freezes action objects. Prevents accidental modification of action payloads after dispatch.
- **`strictStateSerializability`** verifies that state is JSON-serializable. Catches `Date` objects, class instances, `Map`, `Set`, and other non-serializable values that break DevTools.
- **`strictActionSerializability`** applies the same check to actions.
- **`strictActionTypeUniqueness`** ensures no two actions share the same type string. `createActionGroup` prevents this by construction, but this check catches duplicates across groups.

All runtime checks run only in development builds and are automatically disabled in production. Angular 21 is zoneless by default, so `strictActionWithinNgZone` (which verified actions were dispatched inside `NgZone`) no longer applies.

### DevTools Features

With DevTools open in your browser, you can:

- **Inspect actions**: Click any action in the list to see its type and payload.
- **Inspect state**: See the full state tree after each action, with diffs highlighted.
- **Time travel**: Click any previous action to revert the Store to that point in time. Your UI updates instantly.
- **Skip actions**: Toggle individual actions on or off to see what state would look like without them.
- **Export/import**: Save an action log to a file and replay it later to reproduce a bug.
- **Trace**: When `trace: true` is set, each action includes a stack trace showing exactly which line of code dispatched it.

The `trace` option is particularly valuable. When a bug report says "the cart emptied itself," you open DevTools, find the action that cleared the cart, click it, and the stack trace shows you the exact component and line number that dispatched it.

### Tree-Shaking DevTools in Production

The `logOnly: !isDevMode()` approach keeps the DevTools provider in the production bundle but disables interactive features. For zero-overhead production builds, conditionally include the provider:

```typescript
// src/app/app.config.ts (tree-shaking variant)
import { ApplicationConfig, isDevMode } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideStore } from '@ngrx/store';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideStore(),
    ...(isDevMode()
      ? [provideStoreDevtools({ maxAge: 25, autoPause: true, trace: true })]
      : []),
  ],
};
```

With this pattern, the `@ngrx/store-devtools` package is not included in the production bundle at all.

## The Product Model

For completeness, here is the `Product` interface used throughout this chapter:

```typescript
// src/app/products/product.model.ts
export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  description: string;
  imageUrl: string;
}
```

And the `ProductCardComponent` referenced in the list:

```typescript
// src/app/products/product-card.component.ts
import { Component, input, output } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { Product } from './product.model';

@Component({
  selector: 'app-product-card',
  imports: [CurrencyPipe],
  template: `
    <div class="product-card" (click)="selected.emit()">
      <img [src]="product().imageUrl" [alt]="product().name" />
      <h3>{{ product().name }}</h3>
      <p class="price">{{ product().price | currency }}</p>
      <p class="category">{{ product().category }}</p>
    </div>
  `,
})
export class ProductCardComponent {
  readonly product = input.required<Product>();
  readonly selected = output<void>();
}
```

## File Organization

A well-organized feature state directory looks like this:

```
src/app/products/
  state/
    products.actions.ts      ← action groups
    products.reducer.ts      ← state interface, initial state, reducer
    products.feature.ts      ← createFeature with auto-generated + extra selectors
    index.ts                 ← barrel file re-exporting public API
  product.model.ts           ← domain model interface
  products.routes.ts         ← lazy route config with provideState
  products-list.component.ts
  product-detail.component.ts
  product-card.component.ts
```

The barrel file keeps imports clean:

```typescript
// src/app/products/state/index.ts
export { ProductsPageActions, ProductsApiActions } from './products.actions';
export { productsFeature } from './products.feature';
export { ProductsState } from './products.reducer';
```

Components import from the barrel:

```typescript
// In any component
import { ProductsPageActions, productsFeature } from './state';
```

## Common Mistakes

### Mistake 1: Mutating State in the Reducer

```typescript
// WRONG: mutates the existing state object
on(ProductsApiActions.productsLoadedSuccessfully, (state, { products }) => {
  state.products = products;  // Mutation!
  state.loading = false;      // Mutation!
  return state;               // Returns the same reference
})
```

This appears to work until you enable `strictStateImmutability` (enabled by default in dev mode), at which point NgRx throws a runtime error. Even without the check, mutating state breaks DevTools time-travel because previous and current state point to the same object. The fix is to always return a new object:

```typescript
// CORRECT: returns a new state object
on(ProductsApiActions.productsLoadedSuccessfully, (state, { products }) => ({
  ...state,
  products,
  loading: false,
}))
```

### Mistake 2: Reusing Actions Across Unrelated Sources

```typescript
// WRONG: one action used by both the page and the API response handler
export const setProducts = createAction(
  '[Products] Set Products',
  props<{ products: Product[] }>()
);
```

When you see `[Products] Set Products` in DevTools, you cannot tell if the page triggered it, an API call completed, or a WebSocket pushed an update. Create source-specific actions instead:

```typescript
// CORRECT: separate action groups per source
export const ProductsPageActions = createActionGroup({
  source: 'Products Page',
  events: {
    'Opened': emptyProps(),
  },
});

export const ProductsApiActions = createActionGroup({
  source: 'Products API',
  events: {
    'Products Loaded Successfully': props<{ products: Product[] }>(),
  },
});
```

Multiple reducers can respond to the same event. The event describes what happened; the reducers decide how state changes.

### Mistake 3: Storing Derived State in the Reducer

```typescript
// WRONG: filteredProducts is derived from products + query
export interface ProductsState {
  products: Product[];
  query: string;
  filteredProducts: Product[];  // Derived! Should not be in state
}

on(ProductsPageActions.searchChanged, (state, { query }) => ({
  ...state,
  query,
  filteredProducts: state.products.filter(p =>
    p.name.toLowerCase().includes(query.toLowerCase())
  ),
}))
```

Now you must update `filteredProducts` in every reducer that modifies `products` or `query`. Miss one and the derived value becomes stale. Use a selector instead:

```typescript
// CORRECT: derive in a selector, not in state
export interface ProductsState {
  products: Product[];
  query: string;
}

// In products.feature.ts
extraSelectors: ({ selectProducts, selectQuery }) => ({
  selectFilteredProducts: createSelector(
    selectProducts,
    selectQuery,
    (products, query) =>
      query
        ? products.filter(p => p.name.toLowerCase().includes(query.toLowerCase()))
        : products
  ),
})
```

Selectors memoize automatically. If neither `products` nor `query` changed, the selector returns the same array reference without recomputing.

### Mistake 4: Putting Non-Serializable Values in State

```typescript
// WRONG: Date objects and class instances break DevTools
export interface ProductsState {
  products: Product[];
  lastFetchedAt: Date;           // Not serializable
  activeRequest: AbortController; // Not serializable
}
```

DevTools serialize state to JSON for time-travel and export. `Date` objects become strings and lose their methods. Class instances lose their prototypes entirely. Use plain serializable values:

```typescript
// CORRECT: use serializable primitives
export interface ProductsState {
  products: Product[];
  lastFetchedAt: number | null;  // Unix timestamp
  requestInFlight: boolean;       // Simple flag
}
```

Enable `strictStateSerializability` and `strictActionSerializability` in your runtime checks to catch these at development time.

## Key Takeaways

- **Actions describe events, not commands.** Name them `[Source] Event Name` and use `createActionGroup` to enforce the pattern automatically. Multiple reducers (and later, effects) can respond to the same action.

- **Reducers are pure functions that return new state.** Never mutate. Never call APIs. The spread operator (`...state`) plus property overrides is the standard pattern. Enable `strictStateImmutability` to catch violations at dev time.

- **`createFeature` eliminates selector boilerplate.** It auto-generates a selector for every state property and supports `extraSelectors` for derived state. Pass the feature object directly to `provideState()` for zero-ceremony registration.

- **`selectSignal()` bridges NgRx into Angular's signal world.** Prefer it over `select()` unless you need RxJS operators. It returns a `Signal<T>` that integrates with Angular's change detection without subscriptions or cleanup.

- **DevTools are not optional.** Set up `provideStoreDevtools()` from day one. Enable runtime checks, turn on `trace` in development, and use time-travel to debug state issues instead of sprinkling `console.log` through your reducers.
