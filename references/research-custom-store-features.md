# Research: Custom Store Features and Advanced Composition

**Date:** 2026-04-01
**Chapter:** Ch 18
**Status:** Ready for chapter generation

## API Surface

### `signalStoreFeature` -- Core Composition Primitive

- **Import:** `import { signalStoreFeature, type } from '@ngrx/signals';`
- **Stability:** Stable (since NgRx v17)
- **Overloads:** 20 overloads in two groups of 10:
  - **Group A (no constraints):** 1-10 feature functions composed sequentially
  - **Group B (with constraints):** Input constraint object + 1-10 feature functions

**Group A signature (unconstrained):**
```typescript
export function signalStoreFeature<F1 extends SignalStoreFeatureResult>(
  f1: SignalStoreFeature<EmptyFeatureResult, F1>
): SignalStoreFeature<EmptyFeatureResult, F1>;

export function signalStoreFeature<
  F1 extends SignalStoreFeatureResult,
  F2 extends SignalStoreFeatureResult
>(
  f1: SignalStoreFeature<EmptyFeatureResult, F1>,
  f2: SignalStoreFeature<F1, F2>
): SignalStoreFeature<EmptyFeatureResult, PrettifyFeatureResult<F1 & F2>>;
// ... up to F10
```

**Group B signature (with input constraints):**
```typescript
export function signalStoreFeature<
  Input extends Partial<SignalStoreFeatureResult>,
  F1 extends SignalStoreFeatureResult,
>(
  input: Input,
  f1: SignalStoreFeature<EmptyFeatureResult & NoInfer<Input>, F1>
): SignalStoreFeature<Prettify<EmptyFeatureResult & Input>, F1>;
// ... up to Input + F10
```

**Runtime implementation:**
```typescript
export function signalStoreFeature(
  ...args:
    | [Partial<SignalStoreFeatureResult>, ...SignalStoreFeature[]]
    | SignalStoreFeature[]
): SignalStoreFeature<EmptyFeatureResult, EmptyFeatureResult> {
  const features = (
    typeof args[0] === 'function' ? args : args.slice(1)
  ) as SignalStoreFeature[];

  return (inputStore) =>
    features.reduce((store, feature) => feature(store), inputStore);
}
```

### `type<T>()` -- Phantom Type Helper

- **Import:** `import { type } from '@ngrx/signals';`
- **Stability:** Stable
- **Signature:** `function type<T>(): T`
- **Purpose:** Returns `undefined` cast to `T`. Used exclusively in the constraint object (first parameter of `signalStoreFeature`) to declare required state/props/methods without runtime values.

### `withFeature` -- Feature Factory Pattern

- **Import:** `import { withFeature } from '@ngrx/signals';`
- **Stability:** Stable (introduced NgRx v20, August 2025)
- **Originated from:** RFC #4340

**Signature (from source):**
```typescript
export function withFeature<
  Input extends SignalStoreFeatureResult,
  Output extends SignalStoreFeatureResult,
>(
  featureFactory: (
    store: Prettify<
      StateSignals<Input['state']> &
      Input['props'] &
      Input['methods'] &
      WritableStateSource<Input['state']>
    >
  ) => SignalStoreFeature<Input, Output>
): SignalStoreFeature<Input, Output>;
```

**Implementation:**
```typescript
export function withFeature<
  Input extends SignalStoreFeatureResult,
  Output extends SignalStoreFeatureResult,
>(
  featureFactory: (
    store: Prettify<
      StateSignals<Input['state']> &
      Input['props'] &
      Input['methods'] &
      WritableStateSource<Input['state']>
    >
  ) => SignalStoreFeature<Input, Output>
): SignalStoreFeature<Input, Output> {
  return (store) => {
    const storeForFactory = {
      [STATE_SOURCE]: store[STATE_SOURCE],
      ...store.stateSignals,
      ...store.props,
      ...store.methods,
    };
    return featureFactory(storeForFactory)(store);
  };
}
```

**Purpose:** Solves the problem that reusable `signalStoreFeature` functions cannot access store-specific methods/state without coupling. `withFeature` receives the current store instance as a parameter, giving the inner feature full, type-safe access to all existing store members.

### `withLinkedState` -- Reactive Derived State

- **Import:** `import { withLinkedState } from '@ngrx/signals';`
- **Stability:** Stable (introduced NgRx v20, August 2025)
- **Originated from:** Issue #4781, PR #4818

**Signature:**
```typescript
type LinkedStateResult<
  LinkedStateInput extends Record<
    string | symbol,
    WritableSignal<unknown> | (() => unknown)
  >,
> = {
  [K in keyof LinkedStateInput]: LinkedStateInput[K] extends WritableSignal<infer V>
    ? V
    : LinkedStateInput[K] extends () => infer V
    ? V
    : never;
};

export function withLinkedState<
  State extends Record<string | symbol, WritableSignal<unknown> | (() => unknown)>,
  Input extends SignalStoreFeatureResult,
>(
  linkedStateFactory: (
    store: Prettify<StateSignals<Input['state']> & Input['props']>
  ) => State
): SignalStoreFeature<
  Input,
  { state: LinkedStateResult<State>; props: {}; methods: {} }
>;
```

**How it works:**
- Accepts a factory callback that receives state signals and props
- The factory returns a dictionary of either:
  - **Computation functions** `() => value` -- automatically wrapped in `linkedSignal`
  - **Explicit WritableSignal/linkedSignal instances** -- for complex reactive computations
- The resulting linked state slices are writable (can be patched via `patchState`) but auto-reset when their source signals change

## Key Concepts

- **Custom store features** are reusable building blocks that encapsulate state, computed signals, methods, and hooks into a single composable unit via `signalStoreFeature`.
- **Type-safe constraints** (via the `type<T>()` helper) allow features to declare what they require from the consuming store, enforced at compile time.
- **`withFeature`** bridges the gap between reusable features and store-specific logic by providing the feature factory with the current store instance.
- **`withLinkedState`** enables derived state that uses Angular's `linkedSignal` under the hood -- state that automatically resets when source signals change, while remaining manually patchable.
- **Feature composition** follows the same sequential pipeline as `signalStore` itself -- each feature receives the accumulated result of all previous features.
- **Dynamic property naming** via TypeScript mapped types (template literal types) allows the same feature to be applied multiple times without naming conflicts.
- **Dual-signature pattern** (explicit external types, dynamic internal implementation) is the recommended approach for features with dynamic property names.

## Code Patterns

### Pattern 1: Basic Custom Feature (withCallState)

```typescript
// libs/shared/util-common/src/lib/call-state.feature.ts
import { computed } from '@angular/core';
import { signalStoreFeature, withComputed, withState } from '@ngrx/signals';

export type CallState = 'init' | 'loading' | 'loaded' | { error: string };

export function withCallState() {
  return signalStoreFeature(
    withState<{ callState: CallState }>({ callState: 'init' }),
    withComputed(({ callState }) => ({
      loading: computed(() => callState() === 'loading'),
      loaded: computed(() => callState() === 'loaded'),
      error: computed(() => {
        const state = callState();
        return typeof state === 'object' ? state.error : null;
      }),
    }))
  );
}
```

### Pattern 2: Feature with Input Constraints

```typescript
// libs/shared/util-common/src/lib/crud.feature.ts
import { Type } from '@angular/core';
import { signalStoreFeature, type, withMethods } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap } from 'rxjs';

interface BaseEntity {
  id: string;
}

interface CrudService<E extends BaseEntity> {
  getAll(): Observable<E[]>;
  getById(id: string): Observable<E>;
  create(entity: E): Observable<E>;
  update(entity: E): Observable<E>;
  delete(id: string): Observable<void>;
}

export function withCrudOperations<Entity extends BaseEntity>(
  dataServiceType: Type<CrudService<Entity>>
) {
  return signalStoreFeature(
    {
      state: type<{ items: Entity[]; loading: boolean }>(),
    },
    withMethods((store) => {
      const dataService = inject(dataServiceType);

      return {
        loadAll: rxMethod<void>(
          pipe(
            tap(() => patchState(store, { loading: true })),
            switchMap(() =>
              dataService.getAll().pipe(
                tap((items) => patchState(store, { items, loading: false }))
              )
            )
          )
        ),
      };
    })
  );
}
```

### Pattern 3: Dynamic Property Names (Mapped Types)

```typescript
// libs/shared/util-common/src/lib/named-call-state.feature.ts
import { Signal, computed } from '@angular/core';
import {
  SignalStoreFeature,
  signalStoreFeature,
  withComputed,
  withState,
} from '@ngrx/signals';

export type CallState = 'init' | 'loading' | 'loaded' | { error: string };

export type NamedCallState<Prop extends string> = {
  [K in Prop as `${K}CallState`]: CallState;
};

export type NamedCallStateComputed<Prop extends string> = {
  [K in Prop as `${K}Loading`]: Signal<boolean>;
} & {
  [K in Prop as `${K}Loaded`]: Signal<boolean>;
} & {
  [K in Prop as `${K}Error`]: Signal<string | null>;
};

// External signature (explicit types for consumers)
export function withCallState<Prop extends string>(config: {
  prop: Prop;
}): SignalStoreFeature<
  { state: {}; props: {}; methods: {} },
  {
    state: NamedCallState<Prop>;
    props: NamedCallStateComputed<Prop>;
    methods: {};
  }
>;

// Internal implementation (dynamic keys)
export function withCallState<Prop extends string>(config: {
  prop: Prop;
}): SignalStoreFeature {
  const { prop } = config;

  return signalStoreFeature(
    withState({ [`${prop}CallState`]: 'init' as CallState }),
    withComputed((state: Record<string, Signal<unknown>>) => {
      const callState = state[`${prop}CallState`] as Signal<CallState>;
      return {
        [`${prop}Loading`]: computed(() => callState() === 'loading'),
        [`${prop}Loaded`]: computed(() => callState() === 'loaded'),
        [`${prop}Error`]: computed(() => {
          const s = callState();
          return typeof s === 'object' ? s.error : null;
        }),
      };
    })
  );
}
```

Usage:
```typescript
// libs/flights/data-access/src/lib/flight-booking.store.ts
const FlightBookingStore = signalStore(
  { providedIn: 'root' },
  withCallState({ prop: 'flights' }),     // flightsCallState, flightsLoading, etc.
  withCallState({ prop: 'passengers' }),  // passengersCallState, passengersLoading, etc.
);
```

### Pattern 4: withFeature (Accessing Store Members)

```typescript
// libs/shared/util-common/src/lib/entity-loader.feature.ts
import { signalStore, withFeature, withMethods, withState } from '@ngrx/signals';

interface Book {
  id: string;
  title: string;
}

function withEntityLoader<T>(loadFn: (id: string) => Promise<T>) {
  return signalStoreFeature(
    withState({ entity: null as T | null, entityLoading: false }),
    withMethods((store) => ({
      async loadEntity(id: string) {
        patchState(store, { entityLoading: true });
        const entity = await loadFn(id);
        patchState(store, { entity, entityLoading: false });
      },
    }))
  );
}

// The consuming store bridges its own methods into the feature
const BookStore = signalStore(
  withState({ books: [] as Book[] }),
  withMethods((store) => ({
    async fetchBook(id: string): Promise<Book> {
      const response = await fetch(`/api/books/${id}`);
      return response.json();
    },
  })),
  withFeature((store) =>
    withEntityLoader<Book>((id) => store.fetchBook(id))
  )
);
```

### Pattern 5: withLinkedState (Simple Computation)

```typescript
// libs/options/data-access/src/lib/options.store.ts
import { signalStore, withLinkedState, withState } from '@ngrx/signals';

const OptionsStore = signalStore(
  withState({ options: [1, 2, 3] }),
  withLinkedState(({ options }) => ({
    selectedOption: () => options()[0],
  }))
);
```

When `options` changes, `selectedOption` automatically resets to the first option. But `selectedOption` can also be manually set via `patchState`.

### Pattern 6: withLinkedState (Explicit linkedSignal)

```typescript
// libs/options/data-access/src/lib/advanced-options.store.ts
import { linkedSignal } from '@angular/core';
import { signalStore, withLinkedState, withState, withMethods, patchState } from '@ngrx/signals';

interface Option {
  id: number;
  label: string;
}

const OptionsStore = signalStore(
  withState({ options: [] as Option[] }),
  withLinkedState(({ options }) => ({
    selectedOption: linkedSignal({
      source: options,
      computation: (newOptions: Option[], previous?: { value: Option | undefined }) => {
        // Try to preserve the previously selected option if it still exists
        const found = newOptions.find((o) => o.id === previous?.value?.id);
        return found ?? newOptions[0];
      },
    }),
  })),
  withMethods((store) => ({
    selectOption(option: Option) {
      patchState(store, { selectedOption: option });
    },
  }))
);
```

### Pattern 7: Composing Multiple Custom Features

```typescript
// libs/products/data-access/src/lib/product.store.ts
import { signalStore, withState, withMethods, withFeature } from '@ngrx/signals';
import { withEntities } from '@ngrx/signals/entities';
import { withCallState } from '@shared/util-common';
import { withUndoRedo } from '@shared/util-undo-redo';

const ProductStore = signalStore(
  { providedIn: 'root' },
  withEntities<Product>(),
  withCallState({ prop: 'products' }),
  withMethods(/* ... */),
  withUndoRedo({ maxStackSize: 50 }),
);
```

## Breaking Changes and Gotchas

### NgRx v21 Changes
- **`withEffects` renamed to `withEventHandlers`** in `@ngrx/signals/events`. Migration schematic available.
- Events plugin promoted from experimental to **stable** in v21.

### NgRx v20 Architectural Change (affects v21)
- **State distribution:** State is now distributed across individual signals per slice (rather than a single writable signal for the entire state). Breaking scenario: stores with dynamically keyed root state (e.g., `Record<number, number>`) must now nest dynamic properties under a defined parent key.

### NgRx v19 Change (affects v21)
- **`protectedState` enforcement:** Recursive `Object.freeze` on state values. State must be treated as immutable.

### Common Pitfalls

1. **Max features per store:** TypeScript overloads support a maximum of 10-15 features in `signalStore`. Workaround: group features using nested `signalStoreFeature` calls.

2. **Feature cannot access parent store methods:** Solved by `withFeature` in v20+. Before v20, features could not reference store-specific methods.

3. **Autocompletion breaks with nested features:** TypeScript autocompletion sometimes fails when outputs are deeply nested. Workaround: use explicit return type annotations on custom feature functions.

4. **Chaining features with function inputs fails:** When custom features accept function parameters and are chained, TypeScript can lose type information. Solution: use explicit overloaded signatures.

5. **Re-applying `withEntities` inside a custom feature:** If a custom feature uses entity functions like `addEntity`, it must declare entity state in its input constraints rather than re-applying `withEntities`, which triggers a runtime warning about overridden members.

6. **Using the same feature type multiple times:** Without dynamic property naming (mapped types), applying the same feature twice causes property conflicts. Use the `{ prop: string }` pattern.

7. **NgRx ESLint rule:** The NgRx ESLint plugin includes a rule encouraging explicit return type annotations on custom features to avoid inference issues.

## Sources

### Official Docs
- [NgRx: Custom Store Features](https://ngrx.io/guide/signals/signal-store/custom-store-features)
- [NgRx: Linked State](https://ngrx.io/guide/signals/signal-store/linked-state)
- [NgRx: SignalStore Overview](https://ngrx.io/guide/signals/signal-store)
- [NgRx v21 Announcement](https://dev.to/ngrx/announcing-ngrx-21-celebrating-a-10-year-journey-with-a-fresh-new-look-and-ngrxsignalsevents-5ekp)
- [NgRx v20 Announcement](https://dev.to/ngrx/announcing-ngrx-v20-the-power-of-events-enhanced-dx-and-a-mature-signalstore-2fdm)

### Source Code
- [signal-store-feature.ts](https://github.com/ngrx/platform/blob/main/modules/signals/src/signal-store-feature.ts)
- [with-feature.ts](https://github.com/ngrx/platform/blob/main/modules/signals/src/with-feature.ts)
- [with-linked-state.ts](https://github.com/ngrx/platform/blob/main/modules/signals/src/with-linked-state.ts)
- [signal-store.ts](https://github.com/ngrx/platform/blob/main/modules/signals/src/signal-store.ts)
- [NgRx CHANGELOG](https://github.com/ngrx/platform/blob/main/CHANGELOG.md)

### GitHub Issues and RFCs
- [#4340: signalStoreFeature and access to Store (RFC for withFeature)](https://github.com/ngrx/platform/issues/4340)
- [#4781: withLinkedState proposal](https://github.com/ngrx/platform/issues/4781)
- [#4818: withLinkedState PR](https://github.com/ngrx/platform/pull/4818)
- [#5027: Custom feature requires withEntities](https://github.com/ngrx/platform/discussions/5027)
- [#4314: Allow more than 10 features](https://github.com/ngrx/platform/issues/4314)
- [#4274: Chaining features with function inputs](https://github.com/ngrx/platform/issues/4274)
- [#4160: Autocompletion not working with nested features](https://github.com/ngrx/platform/issues/4160)

### Community Blog Posts
- [Angular Architects: Smarter Not Harder (Manfred Steyer)](https://www.angulararchitects.io/blog/smarter-not-harder-simplifying-your-application-with-ngrx-signal-store-and-custom-features/)
- [Angular Architects: Deep Dive Flexible and Type-Safe Custom Extensions](https://www.angulararchitects.io/blog/ngrx-signal-store-deep-dive-flexible-and-type-safe-custom-extensions/)
- [Offering Solutions: Extending SignalStore (Fabian Gosebrink)](https://offering.solutions/blog/articles/2024/02/07/extending-the-ngrx-signal-store-with-a-custom-feature/)
- [DEV Community: SignalStore Hacks with Custom Features (Romain Geffrault)](https://dev.to/romain_geffrault_10d88369/ngrx-signalstore-hacks-beautiful-dx-with-custom-features-1n4k)
- [DEV Community: Custom Store Features (Dusko Peric)](https://dev.to/duskoperic/custom-store-features-in-ngrx-signal-store-3pam)

## Open Questions

1. **`withLinkedState` inside `withFeature`:** No documentation found on using `withLinkedState` inside a `withFeature` factory. This composition should work but is untested in public examples. Verify before including as a pattern.

2. **`withKeyed` feature (RFC #4825):** An RFC exists for a `withKeyed` signal store feature. Its status in v21 is unclear. May be relevant to advanced composition patterns but should be investigated before including.

3. **Performance of `withLinkedState`:** The implementation author warned against wrapping large state portions in `linkedSignal` as it prevents granular change tracking. No benchmarks found -- worth noting as a caveat.

4. **Max feature count in v21:** Source suggests 15 overloads in latest versions (up from 10). Verify the exact count against the installed v21.1.0 package.

5. **NgRx ESLint plugin rules for custom features:** The exact rule name and configuration should be verified against the current `@ngrx/eslint-plugin` package.
