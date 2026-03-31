# Chapter 14: Meta-Reducers

A user reports that their shopping cart is empty after refreshing the page. You check the reducers. They work correctly. You check the effects. They fire on route navigation, not on page load. The state is correct during the session but vanishes the moment the browser refreshes because the Store lives only in memory. You need a way to intercept every state change and persist it to `localStorage` without touching a single reducer. Meanwhile, the design team wants an undo button on the product editor, and the QA team wants a way to log every action in staging without adding `console.log` to 40 different files. All three requirements share a pattern: you need to hook into the reducer pipeline itself. That hook is a meta-reducer.

## A Quick Recap

In Chapter 8, we established that a reducer is a pure function: it takes the current state and an action, and returns a new state. The Store forwards every dispatched action to every registered reducer. In Chapter 9, we learned that selectors read slices of state. In Chapter 10, effects handled side effects like API calls. Through Chapters 11 and 12, we added entity management and router state. Chapter 13 showed how to test all of these layers. Our product catalog uses `createActionGroup` for actions (`ProductPageActions`, `ProductApiActions`), `createFeature` for bundling reducers with auto-generated selectors, `@ngrx/entity` for normalized collections, and functional effects with `createEffect`. The `Product` model has `id`, `name`, `price`, `category`, `description`, and `featured` properties.

This chapter introduces meta-reducers: functions that wrap the reducer pipeline to add cross-cutting behavior like logging, state persistence, and undo/redo. They are the last major concept in the Classic Store before we move to SignalStore in Part 4.

## What Is a Meta-Reducer?

A meta-reducer is a higher-order function. It takes a reducer as input and returns a new reducer as output. The returned reducer has the same signature as any other reducer: it accepts state and action, and returns state. The difference is that the wrapper can execute logic before or after calling the original reducer.

Here is the type definition from `@ngrx/store`:

```typescript
// From @ngrx/store
type MetaReducer<T = any, V extends Action = Action> =
  (reducer: ActionReducer<T, V>) => ActionReducer<T, V>;
```

And `ActionReducer` is simply:

```typescript
// From @ngrx/store
type ActionReducer<T, V extends Action = Action> =
  (state: T | undefined, action: V) => T;
```

Think of it as wrapping a gift. The original reducer is the gift. The meta-reducer is the wrapping paper. From the outside, the package still looks like a reducer (same shape, same interface), but the wrapper can inspect, modify, or replace what goes in and what comes out.

The data flow with meta-reducers looks like this:

```
Component ── dispatch(action) ──> Store
                                    │
                                    ▼
                            Meta-Reducer A (outermost)
                                    │
                                    ▼
                            Meta-Reducer B
                                    │
                                    ▼
                            Meta-Reducer C (innermost)
                                    │
                                    ▼
                              Root Reducer
                                    │
                                    ▼
                              Feature Reducers
                                    │
                                    ▼
                               New State
```

Meta-reducers registered as `[A, B, C]` execute so that `A` wraps `B`, `B` wraps `C`, and `C` wraps the actual reducer. When an action arrives, it passes through `A` first, then `B`, then `C`, and finally reaches the real reducer. The state returned by the real reducer flows back up through `C`, `B`, and `A` before reaching the Store.

## The Simplest Meta-Reducer: A Logger

The canonical first meta-reducer is a logger. It prints the action and state before and after the reducer runs. This is useful in staging environments where DevTools are not available.

```typescript
// src/app/state/meta-reducers/logger.meta-reducer.ts
import { ActionReducer } from '@ngrx/store';

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

The function `logger` accepts a reducer and returns a new function with the same `(state, action) => state` signature. Inside, it logs the previous state and action, calls the original reducer, logs the next state, and returns it. The Store sees a normal reducer. The console sees every state transition.

## Registering Meta-Reducers

Meta-reducers are registered through the `provideStore()` configuration. You pass them as an array in the `metaReducers` property:

```typescript
// src/app/app.config.ts
import { ApplicationConfig, isDevMode } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideStore, MetaReducer } from '@ngrx/store';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { provideEffects } from '@ngrx/effects';
import { logger } from './state/meta-reducers/logger.meta-reducer';
import { routes } from './app.routes';

const metaReducers: MetaReducer[] = isDevMode() ? [logger] : [];

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideStore({}, { metaReducers }),
    provideStoreDevtools({
      maxAge: 25,
      logOnly: !isDevMode(),
      autoPause: true,
    }),
    provideEffects(),
  ],
};
```

The `isDevMode()` check ensures the logger only runs in development. In production, the `metaReducers` array is empty and the logger code is tree-shaken away.

### Registration via Dependency Injection

Sometimes a meta-reducer needs access to an Angular service. You cannot call `inject()` inside a plain function, but you can use the `META_REDUCERS` injection token with a factory provider:

```typescript
// src/app/state/meta-reducers/analytics.meta-reducer.ts
import { ActionReducer, META_REDUCERS, MetaReducer } from '@ngrx/store';
import { AnalyticsService } from '../../services/analytics.service';

function analyticsMetaReducerFactory(
  analytics: AnalyticsService
): MetaReducer {
  return (reducer: ActionReducer<any>): ActionReducer<any> => {
    return (state, action) => {
      analytics.trackAction(action.type);
      return reducer(state, action);
    };
  };
}

// In app.config.ts providers array:
// {
//   provide: META_REDUCERS,
//   deps: [AnalyticsService],
//   useFactory: analyticsMetaReducerFactory,
//   multi: true,
// }
```

The `multi: true` property is critical. Without it, your factory replaces all previously registered meta-reducers (including NgRx's internal runtime checks) instead of adding to the list.

## State Hydration: Surviving Page Refreshes

The Store lives in memory. Refresh the page and everything resets to `initialState`. A hydration meta-reducer solves this by saving state to `localStorage` after every action and restoring it when the Store initializes.

NgRx dispatches a special `INIT` action when the Store first starts, and an `UPDATE` action whenever a lazy-loaded feature registers its state. We intercept both to restore persisted data.

### Full-State Hydration

```typescript
// src/app/state/meta-reducers/hydration.meta-reducer.ts
import { ActionReducer, INIT, UPDATE } from '@ngrx/store';

const STORAGE_KEY = '__app_state__';

export function hydration(reducer: ActionReducer<any>): ActionReducer<any> {
  return (state, action) => {
    const nextState = reducer(state, action);

    if (action.type === INIT || action.type === UPDATE) {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          return { ...nextState, ...JSON.parse(stored) };
        } catch {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
    return nextState;
  };
}
```

On `INIT` or `UPDATE`, we let the reducer produce its default state first, then merge stored state on top. This ensures that any new state properties added in a code update still get their initial values even if the stored state is from an older version. On every other action, we persist the full state after the reducer runs.

### Selective Hydration

Persisting the entire Store is rarely what you want. Authentication tokens should not sit in `localStorage`. Loading flags should not survive a refresh. A selective approach persists only the slices you choose:

```typescript
// src/app/state/meta-reducers/hydration.meta-reducer.ts
import { ActionReducer, INIT, UPDATE } from '@ngrx/store';

const STORAGE_KEY = '__app_state__';
const PERSISTED_KEYS: string[] = ['settings', 'cart'];

export function hydration(reducer: ActionReducer<any>): ActionReducer<any> {
  return (state, action) => {
    const nextState = reducer(state, action);

    if (action.type === INIT || action.type === UPDATE) {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          const partial: Record<string, unknown> = {};
          for (const key of PERSISTED_KEYS) {
            if (key in parsed) {
              partial[key] = parsed[key];
            }
          }
          return { ...nextState, ...partial };
        } catch {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    }

    const toStore: Record<string, unknown> = {};
    for (const key of PERSISTED_KEYS) {
      if (key in nextState) {
        toStore[key] = nextState[key];
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
    return nextState;
  };
}
```

Now only `settings` and `cart` survive a refresh. The `products` feature state reloads from the API, and the `auth` state requires a fresh login. The `PERSISTED_KEYS` array acts as an allowlist.

Register the hydration meta-reducer alongside the logger:

```typescript
// src/app/app.config.ts
import { isDevMode } from '@angular/core';
import { MetaReducer } from '@ngrx/store';
import { logger } from './state/meta-reducers/logger.meta-reducer';
import { hydration } from './state/meta-reducers/hydration.meta-reducer';

export const metaReducers: MetaReducer[] = isDevMode()
  ? [logger, hydration]
  : [hydration];
```

The logger is dev-only, but hydration runs in production too. Array order matters: `logger` wraps `hydration`, so the logger sees the action before hydration processes it.

> **SSR Note:** `localStorage` is not available during server-side rendering. If your application uses SSR, guard the `localStorage` calls with a `typeof window !== 'undefined'` check, or use `isPlatformBrowser` from `@angular/common`. Chapter 30 covers SSR hydration patterns in detail.

## Undo/Redo: Time Travel for Users

DevTools give developers time travel. An undo/redo meta-reducer gives users the same power. The pattern uses three data structures: a `past` array of previous states, a `present` holding the current state, and a `future` array of states that were undone.

### The Actions

```typescript
// src/app/state/undo-redo/undo-redo.actions.ts
import { createActionGroup, emptyProps } from '@ngrx/store';

export const UndoRedoActions = createActionGroup({
  source: 'Undo/Redo',
  events: {
    'Undo': emptyProps(),
    'Redo': emptyProps(),
    'Clear History': emptyProps(),
  },
});
```

### The Meta-Reducer

```typescript
// src/app/state/undo-redo/undo-redo.meta-reducer.ts
import { ActionReducer } from '@ngrx/store';
import { UndoRedoActions } from './undo-redo.actions';

const MAX_HISTORY = 50;

export function undoRedo(reducer: ActionReducer<any>): ActionReducer<any> {
  let past: any[] = [];
  let future: any[] = [];
  let initialized = false;

  return (state, action) => {
    if (action.type === UndoRedoActions.undo.type) {
      if (past.length === 0) {
        return state;
      }
      const previous = past[past.length - 1];
      future = [state, ...future];
      past = past.slice(0, -1);
      return previous;
    }

    if (action.type === UndoRedoActions.redo.type) {
      if (future.length === 0) {
        return state;
      }
      const next = future[0];
      past = [...past, state];
      future = future.slice(1);
      return next;
    }

    if (action.type === UndoRedoActions.clearHistory.type) {
      past = [];
      future = [];
      return state;
    }

    const nextState = reducer(state, action);

    if (initialized && nextState !== state) {
      past = [...past, state].slice(-MAX_HISTORY);
      future = [];
    }

    if (!initialized) {
      initialized = true;
    }

    return nextState;
  };
}
```

The meta-reducer maintains `past` and `future` arrays in closure scope (not in the Store state). When a normal action produces a new state, the current state is pushed onto `past` and `future` is cleared. When the user dispatches `Undo`, we pop from `past` and push the current state onto `future`. `Redo` reverses the process. The `MAX_HISTORY` cap prevents unbounded memory growth.

The `initialized` flag skips recording the `INIT` action, which would otherwise push `undefined` onto the `past` array.

### Using Undo/Redo in a Component

```typescript
// src/app/products/product-editor.component.ts
import { Component, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { UndoRedoActions } from '../state/undo-redo/undo-redo.actions';

@Component({
  selector: 'app-product-editor',
  template: `
    <div class="toolbar">
      <button (click)="undo()">Undo</button>
      <button (click)="redo()">Redo</button>
    </div>
  `,
})
export class ProductEditorComponent {
  private readonly store = inject(Store);

  undo(): void {
    this.store.dispatch(UndoRedoActions.undo());
  }

  redo(): void {
    this.store.dispatch(UndoRedoActions.redo());
  }
}
```

Dispatching `UndoRedoActions.undo()` triggers the meta-reducer before any feature reducer sees the action. The meta-reducer intercepts it, restores the previous state, and the feature reducers never run for that action.

## Resetting State on Logout

When a user logs out, you usually want to clear the Store to prevent the next user from seeing stale data. A reset meta-reducer handles this in a single place instead of adding cleanup logic to every feature reducer:

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

Passing `undefined` as the state argument forces every reducer to fall back to its `initialState`. One meta-reducer resets the entire Store, regardless of how many feature slices exist.

## Runtime Checks Are Meta-Reducers

NgRx's built-in runtime checks, the ones we enabled in Chapter 8 with `strictStateImmutability`, `strictActionImmutability`, and the serializability checks, are themselves meta-reducers. When you configure `runtimeChecks` in `provideStore()`, NgRx adds meta-reducers that freeze state objects and validate serializability after every action. They wrap your reducers just like the ones we built in this chapter.

This means the execution pipeline in development looks like:

```
action
  → your meta-reducers (logger, hydration, etc.)
    → NgRx runtime check meta-reducers (immutability, serializability)
      → root reducer
        → feature reducers
          → new state
```

Runtime checks are automatically removed in production builds, so they add zero overhead to deployed applications.

## Composing Multiple Meta-Reducers

Real applications combine several meta-reducers. Order matters. Consider this configuration:

```typescript
// src/app/app.config.ts
import { isDevMode } from '@angular/core';
import { MetaReducer } from '@ngrx/store';
import { logger } from './state/meta-reducers/logger.meta-reducer';
import { hydration } from './state/meta-reducers/hydration.meta-reducer';
import { resetOnLogout } from './state/meta-reducers/reset.meta-reducer';
import { undoRedo } from './state/undo-redo/undo-redo.meta-reducer';

export const metaReducers: MetaReducer[] = isDevMode()
  ? [logger, resetOnLogout, undoRedo, hydration]
  : [resetOnLogout, undoRedo, hydration];
```

The logger is first (outermost), so it sees every action before anything else processes it. The reset meta-reducer is second, so it can clear state before undo/redo records it. The undo/redo meta-reducer is third. Hydration is last (innermost, closest to the real reducer), so it persists the final computed state after all other meta-reducers have run.

## Testing Meta-Reducers

Meta-reducers are pure functions that accept a reducer and return a reducer. Testing them requires no TestBed and no dependency injection:

```typescript
// src/app/state/meta-reducers/reset.meta-reducer.spec.ts
import { resetOnLogout } from './reset.meta-reducer';

describe('resetOnLogout', () => {
  const mockReducer = (state: any = { count: 0 }, action: any) => {
    if (action.type === 'increment') {
      return { count: state.count + 1 };
    }
    return state;
  };

  const wrappedReducer = resetOnLogout(mockReducer);

  it('should pass through normal actions unchanged', () => {
    const state = { count: 5 };
    const result = wrappedReducer(state, { type: 'increment' });
    expect(result).toEqual({ count: 6 });
  });

  it('should reset to initial state on logout', () => {
    const state = { count: 5 };
    const result = wrappedReducer(state, { type: '[Auth] Logout Success' });
    expect(result).toEqual({ count: 0 });
  });
});
```

Create a trivial mock reducer with known behavior, wrap it with the meta-reducer, and assert the wrapper's behavior for different action types. The mock reducer's `initialState` of `{ count: 0 }` is returned when the reset meta-reducer passes `undefined` as state.

For the hydration meta-reducer, mock `localStorage`:

```typescript
// src/app/state/meta-reducers/hydration.meta-reducer.spec.ts
import { INIT, UPDATE } from '@ngrx/store';
import { hydration } from './hydration.meta-reducer';

describe('hydration meta-reducer', () => {
  const mockReducer = (state: any = { products: [], settings: {} }, action: any) => state;
  let wrappedReducer: ReturnType<typeof hydration>;

  beforeEach(() => {
    localStorage.clear();
    wrappedReducer = hydration(mockReducer);
  });

  it('should restore state from localStorage on INIT', () => {
    const stored = { settings: { theme: 'dark' }, cart: { items: ['widget'] } };
    localStorage.setItem('__app_state__', JSON.stringify(stored));

    const result = wrappedReducer(undefined, { type: INIT });

    expect(result.settings).toEqual({ theme: 'dark' });
  });

  it('should persist state to localStorage after every action', () => {
    wrappedReducer({ products: [], settings: { theme: 'light' } }, { type: 'ANY' });

    const stored = JSON.parse(localStorage.getItem('__app_state__') ?? '{}');
    expect(stored.settings).toEqual({ theme: 'light' });
  });

  it('should handle corrupted localStorage gracefully', () => {
    localStorage.setItem('__app_state__', 'not-valid-json');

    const result = wrappedReducer(undefined, { type: INIT });

    expect(result).toEqual({ products: [], settings: {} });
    expect(localStorage.getItem('__app_state__')).toBeNull();
  });
});
```

## Common Mistakes

### Mistake 1: Performing Async Operations in a Meta-Reducer

```typescript
// WRONG: meta-reducers must be synchronous
export function asyncHydration(reducer: ActionReducer<any>): ActionReducer<any> {
  return async (state, action) => {
    const stored = await fetch('/api/state').then(r => r.json());
    return { ...reducer(state, action), ...stored };
  };
}
```

A meta-reducer must return state synchronously. The Store pipeline does not await promises. If you need to fetch persisted state from a server, use an effect that dispatches an action with the loaded state, then handle that action in a regular reducer.

```typescript
// CORRECT: use synchronous storage or move async work to an effect
export function hydration(reducer: ActionReducer<any>): ActionReducer<any> {
  return (state, action) => {
    const nextState = reducer(state, action);
    if (action.type === INIT) {
      const stored = localStorage.getItem(STORAGE_KEY); // synchronous
      if (stored) {
        return { ...nextState, ...JSON.parse(stored) };
      }
    }
    return nextState;
  };
}
```

### Mistake 2: Forgetting multi: true on the META_REDUCERS Token

```typescript
// WRONG: replaces ALL existing meta-reducers, including NgRx runtime checks
{
  provide: META_REDUCERS,
  deps: [AnalyticsService],
  useFactory: analyticsMetaReducerFactory,
  // missing multi: true
}
```

Without `multi: true`, your factory replaces the entire `META_REDUCERS` token value. This silently removes NgRx's runtime checks (immutability, serializability) and any other library-registered meta-reducers.

```typescript
// CORRECT: multi: true adds to the existing list
{
  provide: META_REDUCERS,
  deps: [AnalyticsService],
  useFactory: analyticsMetaReducerFactory,
  multi: true,
}
```

### Mistake 3: Persisting the Entire Store Without Filtering

```typescript
// WRONG: persists everything, including sensitive and transient data
export function hydration(reducer: ActionReducer<any>): ActionReducer<any> {
  return (state, action) => {
    const nextState = reducer(state, action);
    localStorage.setItem('state', JSON.stringify(nextState));
    return nextState;
  };
}
```

This persists authentication tokens, loading booleans, error messages, and every other transient value. A user who logs out still has their session token sitting in `localStorage`. A returning user sees stale error messages. And because `JSON.stringify` runs on the entire state tree after every action, performance degrades as the state grows.

```typescript
// CORRECT: persist only what should survive a refresh
const PERSISTED_KEYS: string[] = ['settings', 'cart'];

export function hydration(reducer: ActionReducer<any>): ActionReducer<any> {
  return (state, action) => {
    const nextState = reducer(state, action);
    const toStore: Record<string, unknown> = {};
    for (const key of PERSISTED_KEYS) {
      if (key in nextState) {
        toStore[key] = nextState[key];
      }
    }
    localStorage.setItem('state', JSON.stringify(toStore));
    return nextState;
  };
}
```

### Mistake 4: Ignoring State Shape Changes Between Deployments

```typescript
// WRONG: blindly replaces entire state with stored data
if (action.type === INIT) {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    return JSON.parse(stored); // Old shape overwrites new initialState
  }
}
```

If you added a new state property in a deployment, the stored state from the previous version does not have it. Returning the stored state directly means the new property is `undefined`. This breaks selectors and components that assume the property exists.

```typescript
// CORRECT: merge stored state onto reducer's default state
if (action.type === INIT) {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      return { ...reducer(state, action), ...JSON.parse(stored) };
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
}
```

The spread order matters. `reducer(state, action)` produces the full initial state with all new properties. The parsed stored state is spread on top, overwriting only the properties that were persisted. New properties keep their defaults.

## File Organization

```
src/app/state/
  meta-reducers/
    logger.meta-reducer.ts
    logger.meta-reducer.spec.ts
    hydration.meta-reducer.ts
    hydration.meta-reducer.spec.ts
    reset.meta-reducer.ts
    reset.meta-reducer.spec.ts
    analytics.meta-reducer.ts
  undo-redo/
    undo-redo.actions.ts
    undo-redo.meta-reducer.ts
    undo-redo.meta-reducer.spec.ts
  index.ts                          ← barrel re-exporting metaReducers array
```

The barrel file exports a single composed array:

```typescript
// src/app/state/index.ts
import { isDevMode } from '@angular/core';
import { MetaReducer } from '@ngrx/store';
import { logger } from './meta-reducers/logger.meta-reducer';
import { hydration } from './meta-reducers/hydration.meta-reducer';
import { resetOnLogout } from './meta-reducers/reset.meta-reducer';
import { undoRedo } from './undo-redo/undo-redo.meta-reducer';

export const metaReducers: MetaReducer[] = isDevMode()
  ? [logger, resetOnLogout, undoRedo, hydration]
  : [resetOnLogout, undoRedo, hydration];
```

Then `app.config.ts` imports a single symbol:

```typescript
// src/app/app.config.ts
import { metaReducers } from './state';

// In providers:
provideStore({}, { metaReducers }),
```

## Key Takeaways

- **A meta-reducer is a function that wraps a reducer.** It has the type `(reducer: ActionReducer<T>) => ActionReducer<T>`. Use it to add cross-cutting behavior (logging, persistence, undo/redo, state reset) without modifying individual feature reducers.

- **Meta-reducers must be synchronous.** They cannot return promises or use `async/await`. For async persistence (server-side storage, IndexedDB), use an effect that dispatches a restore action.

- **Array order determines execution order.** Meta-reducers listed first wrap those listed later. Place logging first (outermost) to see all actions, and place hydration last (innermost) to persist the final state.

- **Persist selectively, not wholesale.** Use an allowlist of state keys to hydrate. Merge stored state onto the reducer's default state (not the other way around) so new properties get their initial values after a deployment.

- **NgRx runtime checks are meta-reducers.** The immutability freezing and serializability validation from Chapter 8 are implemented as meta-reducers internally. Use `multi: true` when registering meta-reducers via the `META_REDUCERS` token to avoid replacing them.
