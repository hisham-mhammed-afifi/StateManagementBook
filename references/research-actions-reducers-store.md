# Research: Actions, Reducers, and the Store

**Date:** 2026-03-30
**Chapter:** Ch 8
**Status:** Ready for chapter generation

## API Surface

All APIs verified against installed `@ngrx/store@21.1.0` and `@ngrx/store-devtools@21.1.0` type definitions.

### Actions

| Function | Import Path | Signature | Stability |
|----------|-------------|-----------|-----------|
| `createAction` (no payload) | `@ngrx/store` | `createAction<T extends string>(type: T): ActionCreator<T, () => Action<T>>` | Stable |
| `createAction` (with props) | `@ngrx/store` | `createAction<T extends string, P extends object>(type: T, config: ActionCreatorProps<P>): ActionCreator<T, (props: P) => P & Action<T>>` | Stable |
| `createAction` (with creator) | `@ngrx/store` | `createAction<T extends string, P extends any[], R extends object>(type: T, creator: Creator<P, R>): FunctionWithParametersType<P, R & Action<T>>` | Stable |
| `props` | `@ngrx/store` | `props<P extends object>(): ActionCreatorProps<P>` | Stable |
| `emptyProps` | `@ngrx/store` | `emptyProps(): ActionCreatorProps<void>` | Stable |
| `createActionGroup` | `@ngrx/store` | `createActionGroup<Source extends string, Events extends Record<string, ActionCreatorProps<unknown> \| Creator>>(config: ActionGroupConfig<Source, Events>): ActionGroup<Source, Events>` | Stable |

### Reducers

| Function | Import Path | Signature | Stability |
|----------|-------------|-----------|-----------|
| `createReducer` | `@ngrx/store` | `createReducer<S, A extends Action = Action>(initialState: S, ...ons: ReducerTypes<S, readonly ActionCreator[]>[]): ActionReducer<S, A>` | Stable |
| `on` | `@ngrx/store` | `on<S, Creators extends readonly ActionCreator[]>(...args: [...creators: Creators, reducer: OnReducer<S, Creators>]): ReducerTypes<S, Creators>` | Stable |
| `createFeature` | `@ngrx/store` | `createFeature<FeatureName, FeatureState>(config: { name: FeatureName, reducer: ActionReducer<FeatureState> }): Feature<FeatureName, FeatureState>` | Stable |
| `createFeature` (with extra selectors) | `@ngrx/store` | `createFeature<...>(config: { name, reducer, extraSelectors: (base) => ExtraSelectors }): Feature & ExtraSelectors` | Stable |

### Store Service

| Method | Signature | Returns | Notes |
|--------|-----------|---------|-------|
| `select` | `select<K>(selector: (state: T) => K): Observable<K>` | `Observable<K>` | Also supports string key overloads (deprecated for deep paths) |
| `selectSignal` | `selectSignal<K>(selector: (state: T) => K, options?: SelectSignalOptions<K>): Signal<K>` | `Signal<K>` | Added in v16, stable. Uses `computed()` internally. **Primary signal bridge for Classic Store.** |
| `dispatch` | `dispatch<V extends Action>(action: V): void` | `void` | Fire-and-forget |
| `dispatch` (reactive) | `dispatch<V extends () => Action>(dispatchFn: V, config?: { injector: Injector }): EffectRef` | `EffectRef` | Added in v20. Wraps in Angular `effect()`, re-dispatches when signal dependencies change. |

`SelectSignalOptions<T>` contains: `equal?: ValueEqualityFn<T>` for custom equality comparison.

### Standalone Providers

| Function | Import Path | Signature | Stability |
|----------|-------------|-----------|-----------|
| `provideStore` | `@ngrx/store` | `provideStore<T, V extends Action>(reducers?: ActionReducerMap<T, V> \| InjectionToken, config?: RootStoreConfig<T, V>): EnvironmentProviders` | Stable |
| `provideState` (name + reducer) | `@ngrx/store` | `provideState<T, V extends Action>(featureName: string, reducer: ActionReducer<T, V>, config?: StoreConfig<T, V>): EnvironmentProviders` | Stable |
| `provideState` (feature slice) | `@ngrx/store` | `provideState<T, V extends Action>(slice: FeatureSlice<T, V>): EnvironmentProviders` | Stable |
| `provideStoreDevtools` | `@ngrx/store-devtools` | `provideStoreDevtools(options?: StoreDevtoolsOptions): EnvironmentProviders` | Stable |

`RootStoreConfig` extends `StoreConfig` with `runtimeChecks?: Partial<RuntimeChecks>`.

### Runtime Checks

```typescript
// @ngrx/store
interface RuntimeChecks {
  strictStateSerializability: boolean;    // default: false
  strictActionSerializability: boolean;   // default: false
  strictStateImmutability: boolean;       // default: true (dev only)
  strictActionImmutability: boolean;      // default: true (dev only)
  strictActionWithinNgZone: boolean;      // default: false; IRRELEVANT in zoneless Angular 21
  strictActionTypeUniqueness?: boolean;   // optional
}
```

### DevTools Configuration

```typescript
// @ngrx/store-devtools
class StoreDevtoolsConfig {
  maxAge: number | false;              // default: false (unlimited)
  monitor?: ActionReducer<any, any>;
  actionSanitizer?: (action: Action, id: number) => Action;
  stateSanitizer?: (state: any, index: number) => any;
  name?: string;                       // default: document.title
  serialize?: boolean | SerializationOptions;
  logOnly?: boolean;
  features?: DevToolsFeatureOptions;   // 10 toggleable features
  actionsBlocklist?: string[];
  actionsSafelist?: string[];
  predicate?: (state: any, action: Action) => boolean;
  autoPause?: boolean;
  trace?: boolean | (() => string);
  traceLimit?: number;
  connectInZone?: boolean;             // default: false; IRRELEVANT in zoneless Angular 21
}

type StoreDevtoolsOptions = Partial<StoreDevtoolsConfig> | (() => Partial<StoreDevtoolsConfig>);

interface DevToolsFeatureOptions {
  pause?: boolean;
  lock?: boolean;
  persist?: boolean;
  export?: boolean;
  import?: 'custom' | boolean;
  jump?: boolean;
  skip?: boolean;
  reorder?: boolean;
  dispatch?: boolean;
  test?: boolean;
}
```

## Key Concepts

### The Redux Pattern in Angular
- **Single source of truth**: The entire application state lives in one Store object
- **State is read-only**: The only way to change state is to dispatch an action
- **Pure reducer functions**: Reducers take current state + action and return a new state object (no mutation)
- **Unidirectional data flow**: Component -> dispatch(action) -> reducer -> new state -> selector -> component

### Actions as Events
- Actions describe *what happened*, not *what to do* (events, not commands)
- Multiple reducers and effects can respond to a single action
- Action type format: `[Source] Event Name` (e.g., `[Products Page] Load Products`)
- `createActionGroup` enforces this pattern automatically

### createActionGroup (Modern Default)
- Groups related actions by source
- Auto-generates camelCased creator names from event names
- Types follow `[Source] Event Name` pattern
- Supports `props<T>()`, `emptyProps()`, and custom creator functions
- Preferred over individual `createAction` calls for most cases

### createFeature (Selector Auto-Generation)
- Automatically generates a feature selector and nested selectors for every top-level state property
- `extraSelectors` callback receives base selectors and can compose derived selectors
- Can be passed directly to `provideState()` as a `FeatureSlice`
- Dramatically reduces selector boilerplate

### Store.selectSignal() -- Signal Bridge
- Returns a `Signal<K>` instead of `Observable<K>`
- Preferred over wrapping `toSignal(store.select(...))` because it uses `computed()` internally with proper equality checking
- Accepts `SelectSignalOptions` for custom equality (`equal` function)
- Available since NgRx v16, stable

### Reactive dispatch (v20+)
- `store.dispatch(() => someAction({ value: someSignal() }))` returns an `EffectRef`
- Wraps the dispatch in Angular's `effect()`, automatically re-dispatching when signal dependencies change
- Useful for signal-reactive dispatching without manual effect management

### SHARI Principle (What Belongs in the Store)
- **S**hared: State accessed by multiple components
- **H**ydrated: State persisted/rehydrated from storage
- **A**vailable: State that must be available across routes
- **R**etrieved: State retrieved via side effects (API calls)
- **I**mpacted: State impacted by actions from other features

## Code Patterns

### App Setup (Standalone, Angular 21 + NgRx 21)

```typescript
// src/app/app.config.ts
import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideStore } from '@ngrx/store';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { isDevMode } from '@angular/core';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideStore(),
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

### Actions with createActionGroup

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

// Usage:
// ProductsPageActions.opened()                    -> { type: '[Products Page] Opened' }
// ProductsPageActions.productSelected({ productId: '1' }) -> { type: '[Products Page] Product Selected', productId: '1' }
// ProductsApiActions.productsLoadedSuccessfully({ products }) -> { type: '[Products API] Products Loaded Successfully', products }
```

### Reducer with createReducer and on()

```typescript
// src/app/products/state/products.reducer.ts
import { createReducer, on } from '@ngrx/store';
import { ProductsPageActions, ProductsApiActions } from './products.actions';
import { Product } from '../product.model';

export interface ProductsState {
  products: Product[];
  selectedProductId: string | null;
  loading: boolean;
  error: string | null;
}

const initialState: ProductsState = {
  products: [],
  selectedProductId: null,
  loading: false,
  error: null,
};

export const productsReducer = createReducer(
  initialState,
  on(ProductsPageActions.opened, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(ProductsPageActions.productSelected, (state, { productId }) => ({
    ...state,
    selectedProductId: productId,
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

### Feature Registration with createFeature

```typescript
// src/app/products/state/products.feature.ts
import { createFeature, createSelector } from '@ngrx/store';
import { productsReducer } from './products.reducer';

export const productsFeature = createFeature({
  name: 'products',
  reducer: productsReducer,
  extraSelectors: ({ selectProducts, selectSelectedProductId }) => ({
    selectSelectedProduct: createSelector(
      selectProducts,
      selectSelectedProductId,
      (products, selectedId) => products.find(p => p.id === selectedId) ?? null
    ),
    selectProductCount: createSelector(
      selectProducts,
      (products) => products.length
    ),
  }),
});

// Auto-generated selectors:
// productsFeature.selectProductsState    -> (state) => state.products  (feature selector)
// productsFeature.selectProducts         -> (state) => state.products.products
// productsFeature.selectSelectedProductId -> (state) => state.products.selectedProductId
// productsFeature.selectLoading          -> (state) => state.products.loading
// productsFeature.selectError            -> (state) => state.products.error
// productsFeature.selectSelectedProduct  -> (composed extra selector)
// productsFeature.selectProductCount     -> (composed extra selector)
```

### Lazy-Loaded Feature State Registration

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
      { path: '', loadComponent: () => import('./products-list.component') },
      { path: ':id', loadComponent: () => import('./product-detail.component') },
    ],
  },
];
```

### Component Using Store with selectSignal and inject()

```typescript
// src/app/products/products-list.component.ts
import { Component, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { productsFeature } from './state/products.feature';
import { ProductsPageActions } from './state/products.actions';

@Component({
  selector: 'app-products-list',
  template: `
    @if (loading()) {
      <div class="spinner">Loading...</div>
    }
    @if (error(); as err) {
      <div class="error">{{ err }}</div>
    }
    @for (product of products(); track product.id) {
      <app-product-card
        [product]="product"
        (selected)="onSelect(product.id)" />
    }
  `,
})
export class ProductsListComponent {
  private readonly store = inject(Store);

  readonly products = this.store.selectSignal(productsFeature.selectProducts);
  readonly loading = this.store.selectSignal(productsFeature.selectLoading);
  readonly error = this.store.selectSignal(productsFeature.selectError);

  constructor() {
    this.store.dispatch(ProductsPageActions.opened());
  }

  onSelect(productId: string): void {
    this.store.dispatch(ProductsPageActions.productSelected({ productId }));
  }
}
```

### DevTools with Environment-Based Tree-Shaking

```typescript
// src/app/app.config.ts (production-optimized)
import { ApplicationConfig, isDevMode } from '@angular/core';
import { provideStore } from '@ngrx/store';
import { provideStoreDevtools } from '@ngrx/store-devtools';

export const appConfig: ApplicationConfig = {
  providers: [
    provideStore(),
    ...(isDevMode()
      ? [provideStoreDevtools({
          maxAge: 25,
          autoPause: true,
          trace: true,
          traceLimit: 75,
        })]
      : []),
  ],
};
```

### Runtime Checks Configuration

```typescript
// src/app/app.config.ts (with runtime checks)
provideStore({}, {
  runtimeChecks: {
    strictStateImmutability: true,
    strictActionImmutability: true,
    strictStateSerializability: true,
    strictActionSerializability: true,
    strictActionTypeUniqueness: true,
    // strictActionWithinNgZone: false -- irrelevant in zoneless Angular 21
  },
}),
```

## Breaking Changes and Gotchas

### NgRx 21 Changes (for @ngrx/store)
- **No breaking changes** in `@ngrx/store` or `@ngrx/store-devtools` in v21.
- The only breaking change in NgRx 21 is `withEffects` renamed to `withEventHandlers` in `@ngrx/signals/events` (not relevant to this chapter).
- `SelectSignalOptions` type export added in v21.1.0 (minor addition).

### Zoneless Angular 21 Considerations
- `strictActionWithinNgZone` runtime check is **irrelevant** in zoneless Angular 21. Do not enable it.
- `connectInZone` in DevTools config defaults to `false` and is **irrelevant** in zoneless mode.
- `OnPush` change detection is effectively the default behavior; no need to prescribe it.
- Store's signal integration (`selectSignal`) works naturally with zoneless change detection.

### Common Mistakes
1. **Mutating state in reducers**: Using `push()`, `splice()`, or direct property assignment. Runtime checks (`strictStateImmutability`) catch this in dev mode.
2. **Reusing actions across different sources**: Makes DevTools debugging impossible. Always create source-specific action groups.
3. **Over-dispatching / action flooding**: Multiple sequential `dispatch()` calls. Design one action that multiple reducers handle.
4. **Putting everything in the store**: Form values, hover states, transient UI. Apply SHARI principle.
5. **Storing derived state**: Values that should be computed selectors, not reducer state.
6. **Non-serializable state/actions**: Class instances, Dates, Maps break DevTools time-travel. Enable serializability runtime checks.
7. **Unnormalized nested state**: Deeply nested objects force entire-tree recreation. Use `@ngrx/entity` (covered in Ch 11).
8. **State duplication across slices**: Same data in multiple feature states leads to inconsistency.
9. **Dispatching in constructors without lifecycle awareness**: Consider using `afterNextRender` or effects for initialization dispatches.
10. **Multiple `async` pipe subscriptions**: Creates duplicate subscriptions. Use `selectSignal()` or view model selectors.

### StoreModule (Legacy)
- `StoreModule.forRoot()` and `StoreModule.forFeature()` still exist but are legacy NgModule APIs.
- Not formally deprecated, but the book should use `provideStore()` and `provideState()` exclusively.
- `StoreDevtoolsModule.instrument()` similarly replaced by `provideStoreDevtools()`.

### Selectors with Props
- String-key `select()` overloads for deep paths (3+ keys) are deprecated.
- Selectors with props (`createSelector` with props parameter) are deprecated (see GitHub issue #2980).
- Use factory selectors (functions returning selectors) instead of props selectors.

## Sources

### Official Documentation
- [NgRx Store Guide](https://ngrx.io/guide/store)
- [NgRx Store Actions](https://ngrx.io/guide/store/actions)
- [NgRx Store Reducers](https://ngrx.io/guide/store/reducers)
- [NgRx Store API Reference](https://ngrx.io/api/store)
- [NgRx Store DevTools Guide](https://ngrx.io/guide/store-devtools)
- [NgRx Migration Guide v21](https://ngrx.io/guide/migration/v21)

### Blog Posts and Articles
- [Announcing NgRx 21 (dev.to/ngrx)](https://dev.to/ngrx/announcing-ngrx-21-celebrating-a-10-year-journey-with-a-fresh-new-look-and-ngrxsignalsevents-5ekp) -- v21 release notes, Events plugin stable, withEffects renamed
- [Announcing NgRx v16 (dev.to/ngrx)](https://dev.to/ngrx/announcing-ngrx-v16-integration-with-angular-signals-functional-effects-standalone-schematics-and-more-5gk6) -- selectSignal introduction
- [Using NgRx with Standalone Angular (dev.to/ngrx)](https://dev.to/ngrx/using-ngrx-packages-with-standalone-angular-features-53d8) -- provideStore/provideState patterns
- [NgRx Feature Creator (dev.to/this-is-angular)](https://dev.to/this-is-angular/ngrx-feature-creator-2c72) -- createFeature deep dive
- [Tim Deschryver - NgRx Best Practices](https://timdeschryver.dev/blog) -- common mistakes, action hygiene, modern patterns
- [Mike Ryan - Good Action Hygiene (ng-conf 2018)](https://www.youtube.com/watch?v=JmnsEvoy-gY) -- foundational talk on actions as events, SHARI principle
- [Rainer Hahnekamp - NgRx Best Practices Series](https://www.angulararchitects.io/) -- Facade pattern analysis, both sides presented

### GitHub
- [NgRx Platform CHANGELOG](https://github.com/ngrx/platform/blob/main/CHANGELOG.md)
- [createActionGroup RFC (ngrx/platform#3337)](https://github.com/ngrx/platform/discussions/3337)
- [Signal Integration RFC (ngrx/platform#3843)](https://github.com/ngrx/platform/discussions/3843)
- [Selectors with Props Deprecation (ngrx/platform#2980)](https://github.com/ngrx/platform/issues/2980)

## Open Questions

1. **Reactive dispatch (`dispatch(() => action)`)**: This v20+ feature wraps dispatch in Angular's `effect()`. Verify exact behavior and whether it auto-cleans up. Confirm it returns `EffectRef` (verified in type definitions). Consider whether this is stable enough to recommend or should be labeled as advanced.

2. **DevTools tree-shaking**: The conditional `isDevMode()` spread pattern prevents DevTools from being included in production bundles. Verify this actually tree-shakes with Angular 21's build system (esbuild). The alternative file-replacement approach via angular.json may be more reliable for guaranteed tree-shaking.

3. **createFeature + provideState integration**: Confirmed that `createFeature` returns a `FeatureSlice`-compatible object and can be passed directly to `provideState()`. Verify the exact shape returned includes both `name` and `reducer` properties.
