# Research: Meta-Reducers

**Date:** 2026-03-31
**Chapter:** Ch 14
**Status:** Ready for chapter generation

## API Surface

### @ngrx/store - Meta-Reducer Types and Tokens

| API | Import Path | Signature | Stability |
|-----|------------|-----------|-----------|
| `MetaReducer<T, V>` | `@ngrx/store` | `type MetaReducer<T = any, V extends Action = Action> = (reducer: ActionReducer<T, V>) => ActionReducer<T, V>` | Stable |
| `META_REDUCERS` | `@ngrx/store` | Injection token for DI-based meta-reducer registration | Stable |
| `ActionReducer<T, V>` | `@ngrx/store` | `(state: T \| undefined, action: V) => T` | Stable |
| `INIT` | `@ngrx/store` | `@ngrx/store/init` action type dispatched on store initialization | Stable |
| `UPDATE` | `@ngrx/store` | `@ngrx/store/update-reducers` action type dispatched when lazy feature state is added | Stable |

### Registration Methods

**Method 1: Via `provideStore()` config**
```typescript
import { provideStore, MetaReducer } from '@ngrx/store';

export const metaReducers: MetaReducer[] = [logger, hydration];

// In app.config.ts
provideStore(reducers, { metaReducers })
```

**Method 2: Via `META_REDUCERS` injection token (DI-based)**
```typescript
import { META_REDUCERS } from '@ngrx/store';

// In providers array
{
  provide: META_REDUCERS,
  deps: [SomeService],
  useFactory: (service: SomeService) => createMetaReducer(service),
  multi: true  // CRITICAL: must be multi to allow multiple meta-reducers
}
```

### Runtime Checks (Built-in Meta-Reducers)

| Check | Purpose | Stability |
|-------|---------|-----------|
| `strictStateImmutability` | Prevents direct state mutations | Stable |
| `strictActionImmutability` | Ensures actions are not mutated | Stable |
| `strictStateSerializability` | Validates state is JSON-serializable | Stable |
| `strictActionSerializability` | Validates actions are JSON-serializable | Stable |
| `strictActionWithinNgZone` | N/A in zoneless Angular 21 | Deprecated context |

These runtime checks are themselves implemented as meta-reducers internally. They are enabled in development and disabled in production by default.

## Key Concepts

- **Meta-reducer definition**: A higher-order function that takes a reducer and returns a new reducer. It wraps the normal reducer pipeline, giving you a hook to intercept every action before and after it reaches the actual reducers.
- **Execution order**: Meta-reducers execute in array order (left to right). The first meta-reducer wraps all subsequent ones. Actions flow through meta-reducers before reaching feature reducers.
- **Pipeline flow**: `action -> meta-reducer N -> ... -> meta-reducer 1 -> root reducer -> feature reducers`
- **No async support**: Meta-reducers are synchronous. They must return state immediately. Use Effects for async operations.
- **Run on every action**: Meta-reducers see every dispatched action, including INIT and UPDATE. Filter by action type when you only care about specific actions.
- **Equivalent to Redux middleware**: NgRx removed the middleware concept in favor of meta-reducers, which provide the same capabilities in a more functional style.
- **Runtime checks are meta-reducers**: NgRx's built-in strictness checks (immutability, serializability) are implemented as meta-reducers internally.

## Code Patterns

### Pattern 1: Logging Meta-Reducer

```typescript
// src/app/state/meta-reducers/logger.meta-reducer.ts
import { ActionReducer, MetaReducer } from '@ngrx/store';

export function logger(reducer: ActionReducer<any>): ActionReducer<any> {
  return (state, action) => {
    console.group(action.type);
    console.log('Previous State:', state);
    console.log('Action:', action);

    const nextState = reducer(state, action);

    console.log('Next State:', nextState);
    console.groupEnd();

    return nextState;
  };
}
```

**Best practice**: Only enable in development via `isDevMode()`:
```typescript
import { isDevMode } from '@angular/core';

export const metaReducers: MetaReducer[] = isDevMode() ? [logger] : [];
```

### Pattern 2: State Hydration Meta-Reducer

```typescript
// src/app/state/meta-reducers/hydration.meta-reducer.ts
import { ActionReducer, INIT, UPDATE } from '@ngrx/store';

const STORAGE_KEY = '__app_state__';

export function hydration(reducer: ActionReducer<any>): ActionReducer<any> {
  return (state, action) => {
    if (action.type === INIT || action.type === UPDATE) {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          return { ...reducer(state, action), ...parsed };
        } catch {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    }

    const nextState = reducer(state, action);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
    return nextState;
  };
}
```

**Selective hydration (recommended)**: Only persist specific slices:
```typescript
const PERSISTED_KEYS = ['settings', 'cart'];

export function selectiveHydration(reducer: ActionReducer<any>): ActionReducer<any> {
  return (state, action) => {
    if (action.type === INIT || action.type === UPDATE) {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          const partial: Record<string, any> = {};
          for (const key of PERSISTED_KEYS) {
            if (parsed[key]) partial[key] = parsed[key];
          }
          return { ...reducer(state, action), ...partial };
        } catch {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    }

    const nextState = reducer(state, action);
    const toStore: Record<string, any> = {};
    for (const key of PERSISTED_KEYS) {
      if (nextState[key]) toStore[key] = nextState[key];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
    return nextState;
  };
}
```

### Pattern 3: Undo/Redo Meta-Reducer

```typescript
// src/app/state/meta-reducers/undo-redo.meta-reducer.ts
import { ActionReducer, Action } from '@ngrx/store';

interface UndoRedoState<T> {
  past: T[];
  present: T;
  future: T[];
}

const UNDO = '[Undo/Redo] Undo';
const REDO = '[Undo/Redo] Redo';

export function undoRedo(reducer: ActionReducer<any>): ActionReducer<any> {
  const initialState: UndoRedoState<any> = {
    past: [],
    present: reducer(undefined, { type: INIT } as Action),
    future: [],
  };

  return (state: UndoRedoState<any> = initialState, action: Action) => {
    switch (action.type) {
      case UNDO: {
        if (state.past.length === 0) return state;
        const previous = state.past[state.past.length - 1];
        return {
          past: state.past.slice(0, -1),
          present: previous,
          future: [state.present, ...state.future],
        };
      }
      case REDO: {
        if (state.future.length === 0) return state;
        const next = state.future[0];
        return {
          past: [...state.past, state.present],
          present: next,
          future: state.future.slice(1),
        };
      }
      default: {
        const nextPresent = reducer(state.present, action);
        if (nextPresent === state.present) return state;
        return {
          past: [...state.past, state.present],
          present: nextPresent,
          future: [],
        };
      }
    }
  };
}
```

### Pattern 4: Reset State on Logout

```typescript
// src/app/state/meta-reducers/reset.meta-reducer.ts
import { ActionReducer } from '@ngrx/store';

export function resetOnLogout(reducer: ActionReducer<any>): ActionReducer<any> {
  return (state, action) => {
    if (action.type === '[Auth] Logout Success') {
      return reducer(undefined, action);
    }
    return reducer(state, action);
  };
}
```

Passing `undefined` as state forces every reducer to return its `initialState`.

### Pattern 5: DI-Based Meta-Reducer with META_REDUCERS Token

```typescript
// src/app/state/meta-reducers/analytics.meta-reducer.ts
import { InjectionToken } from '@angular/core';
import { ActionReducer, META_REDUCERS, MetaReducer } from '@ngrx/store';
import { AnalyticsService } from '../services/analytics.service';

function analyticsMetaReducerFactory(
  analytics: AnalyticsService
): MetaReducer {
  return (reducer: ActionReducer<any>) => {
    return (state, action) => {
      analytics.trackAction(action.type);
      return reducer(state, action);
    };
  };
}

// Register in providers:
// {
//   provide: META_REDUCERS,
//   deps: [AnalyticsService],
//   useFactory: analyticsMetaReducerFactory,
//   multi: true,
// }
```

## Breaking Changes and Gotchas

### No Breaking Changes in NgRx 21
Meta-reducers API is stable and unchanged. No renames, no deprecations.

### Critical Gotchas

1. **Feature module meta-reducers ignored with single reducer**: When `provideState('feature', singleReducer)` is used (not a reducer map), meta-reducers supplied in the config are silently ignored. This is a longstanding issue (GitHub #701).

2. **No async operations**: Meta-reducers are synchronous. Attempting to use `async/await` or return Promises breaks the reducer pipeline. Use Effects for async work.

3. **DI initialization order**: Using `META_REDUCERS` token with `useFactory` can fail with "fn is not a function" if the injected service isn't available when the store initializes. Ensure services are provided before `provideStore()`.

4. **Serialization on every action**: Hydration meta-reducers that call `JSON.stringify()` on every action can degrade performance for large state trees. Consider debouncing or throttling persistence via Effects instead.

5. **State shape migration**: Hydrated state from localStorage may not match the current app's state shape after a deployment. Always validate/migrate stored state or wrap in try/catch.

6. **Undo/redo memory growth**: Unbounded history arrays grow linearly. Cap `past` array size (e.g., 50 entries) to prevent memory issues.

7. **Meta-reducer execution order**: Array position matters. `[a, b, c]` means `a` wraps `b` wraps `c` wraps the actual reducer. The last meta-reducer in the array is closest to the real reducer.

8. **No subset application**: There's no built-in way to apply a meta-reducer to only specific feature reducers. Meta-reducers apply to the entire reducer tree.

9. **`strictActionWithinNgZone`**: This runtime check is irrelevant in Angular 21's zoneless-by-default mode. Do not enable it.

## Sources

### Official Documentation
- https://ngrx.io/guide/store/metareducers - Meta-Reducers guide
- https://ngrx.io/api/store/MetaReducer - MetaReducer type reference
- https://ngrx.io/api/store/META_REDUCERS - META_REDUCERS injection token
- https://ngrx.io/guide/store/configuration/runtime-checks - Runtime checks (built-in meta-reducers)

### Blog Posts and Articles
- https://dev.to/angular/how-to-keep-ngrx-state-on-refresh-2f2o - Hydration pattern (DEV Community / Angular team)
- https://timdeschryver.dev/blog/ngrx-flush-state - Flush state with meta-reducer (Tim Deschryver)
- https://netbasal.com/implementing-a-meta-reducer-in-ngrx-store-4379d7e1020a - Meta-reducer implementation (Netanel Basal)
- https://dev.to/alfredoperez/ngrx-workshop-notes-meta-reducers-4b36 - Workshop notes on meta-reducers
- https://dev.to/angular/implementing-undo-redo-with-ngrx-or-redux-47oc - Undo/redo with NgRx
- https://www.kimsereylam.com/angular/ngrx/2020/09/04/ngrx-metareducer.html - Meta-reducer tutorial
- https://linnhoefer.com/posts/ngrx-keep-state-refresh/ - State persistence patterns
- https://linnhoefer.com/posts/angular-undo-redo-ngrx-redux/ - Undo/redo patterns

### GitHub Issues and Libraries
- https://github.com/ngrx/platform/issues/701 - Feature module meta-reducers ignored
- https://github.com/ngrx/platform/issues/2129 - DI in meta-reducers
- https://github.com/ngrx/platform/issues/1649 - Async meta-reducer limitation
- https://github.com/ngrx/platform/issues/408 - Subset meta-reducer application
- https://github.com/btroncone/ngrx-store-logger - Logging library
- https://github.com/btroncone/ngrx-store-localstorage - LocalStorage sync library
- https://github.com/nilsmehlhorn/ngrx-wieder - Undo/redo library
- https://github.com/ngrx/store/issues/168 - Why middleware was removed in favor of meta-reducers

### NgRx 21 Release
- https://dev.to/ngrx/announcing-ngrx-21-celebrating-a-10-year-journey-with-a-fresh-new-look-and-ngrxsignalsevents-5ekp - NgRx 21 announcement (no meta-reducer changes)

## Open Questions

1. **INIT vs UPDATE constants**: Verify the exact import path for `INIT` and `UPDATE` action type constants in NgRx 21. Research suggests `import { INIT, UPDATE } from '@ngrx/store'` but this should be confirmed against the installed package.

2. **Feature-level meta-reducers with `provideState()`**: Confirm whether the `provideState()` standalone API accepts a `metaReducers` config option or if meta-reducers can only be registered at the root level.

3. **Hydration and SSR interaction**: Chapter 30 covers SSR/hydration. Meta-reducer-based hydration from localStorage will conflict with server-side rendering (localStorage not available on server). The chapter should mention this and point forward to Ch 30.

4. **Performance benchmarks**: No concrete performance numbers found for JSON.stringify/parse overhead on typical store sizes. Consider running benchmarks for the chapter.
