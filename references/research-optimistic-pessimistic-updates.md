# Research: Optimistic and Pessimistic Updates
**Date:** 2026-04-08
**Chapter:** Ch 27
**Status:** Ready for chapter generation

## API Surface

### NgRx Classic Store (v21)
- `createAction`, `createReducer`, `on` — `@ngrx/store` — stable.
- `createEffect`, `ofType`, `Actions` — `@ngrx/effects` — stable.
- `optimisticUpdate(...)` — `@ngrx/router-store/data-persistence` — stable. Signature:
  `optimisticUpdate<A, State>({ run(action, state), undoAction(action, error) })`.
  Note: lives under `@ngrx/router-store/data-persistence` (moved from `@nrwl/angular` years ago). Still stable in v21 but "data-persistence" helpers are considered legacy by many teams who prefer hand-rolled effects.
- `pessimisticUpdate(...)` — same module, same shape minus `undoAction`; used to guarantee one-at-a-time serialized writes per entity.
- `createEntityAdapter<T>()` — `@ngrx/entity` — stable. Exposes `addOne`, `updateOne`, `upsertOne`, `removeOne`, `setOne`, `upsertMany`.

### NgRx SignalStore (v21.1.0)
- `signalStore`, `withState`, `withMethods`, `withComputed`, `withHooks`, `patchState` — `@ngrx/signals` — stable.
- `withEntities`, entity updaters `addEntity`, `updateEntity`, `removeEntity`, `upsertEntity` — `@ngrx/signals/entities` — stable.
- `rxMethod` — `@ngrx/signals/rxjs-interop` — stable. Signature: `rxMethod<Input>(pipeline)`.
- `withEventHandlers(...)` — `@ngrx/signals/events` — stable in v21 (was `withEffects` in v20, renamed; migration schematic tracked in platform issue #5010).
- `eventGroup({ source, events: { ... } })`, `type()`, `withReducer(on(evt, (state, payload) => ...))`, `injectDispatcher()` — `@ngrx/signals/events` — stable.

### Angular 21 HTTP
- `HttpClient.post/put/patch/delete` — `@angular/common/http` — stable. Primary tool for mutations.
- `httpResource(() => ({ url, method, body }))` — `@angular/common/http` — **Experimental**. Designed for reactive data fetching. Angular's own docs advise **not** to use `httpResource` for POST/PUT/PATCH/DELETE mutations; it is a declarative GET-shaped primitive.
  > **API Status: Experimental**
  > `httpResource` is marked `@experimental` in Angular 21. It is not a mutation primitive; use `HttpClient` directly for optimistic/pessimistic writes.

## Key Concepts

- **Optimistic update**: mutate local state immediately (before the server confirms), fire the request, and on failure revert using a captured snapshot or a compensating action.
- **Pessimistic update**: set a `pending` flag, fire the request, only mutate state on success. Predictable but slower UX.
- **Snapshot rollback**: capture `previousValue` before patching; store it on an in-flight record keyed by `requestId` (or embed it in the failure event) so rollback cannot be trampled by concurrent updates.
- **Temp IDs**: optimistic `create` uses a client-side id (`crypto.randomUUID()` or `tmp_<n>`). When the server responds, reconcile via `upsertOne` using a separate `tempId -> serverId` map, or by replacing the entity (remove tempId, add server entity) in one patch.
- **Last-write-wins vs merge**: LWW accepts server response verbatim, clobbering any user edits that happened during flight. Merge strategies diff server response against `base` (pre-edit) and local `current`, keeping user edits where server fields are unchanged.
- **Idempotency keys**: generate a UUID per mutation, send as `Idempotency-Key` header so retries are safe. The client can also dedupe in-flight requests per key using a `Map<key, Observable>`.
- **Request deduplication**: use an `HttpInterceptor` plus an `HttpContextToken` to share in-flight observables; cache resolves on first response.
- **Operator choice for writes**:
  - `concatMap` — serialize writes per entity; preserves order; safe default for create/update/delete.
  - `mergeMap` — parallelize independent writes across different entities.
  - `switchMap` — **unsafe for writes**; cancels in-flight request. Use only for reads/queries.
  - `exhaustMap` — drops new writes while one is in flight; useful for "save" buttons to swallow double-clicks.
- **Per-entity serialization**: `groupBy(id).pipe(mergeMap(g => g.pipe(concatMap(...))))` — fan out across entities, serialize within.

## Code Patterns

### 1. Pessimistic create with Classic Store

```ts
// libs/products/data-access/src/lib/+state/products.actions.ts
import { createActionGroup, props, emptyProps } from '@ngrx/store';
import { Product } from '@myorg/models';

export const ProductsActions = createActionGroup({
  source: 'Products',
  events: {
    'Create Requested': props<{ draft: Omit<Product, 'id'> }>(),
    'Create Succeeded': props<{ product: Product }>(),
    'Create Failed': props<{ error: string }>(),
  },
});
```

```ts
// libs/products/data-access/src/lib/+state/products.effects.ts
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { concatMap, map, catchError, of } from 'rxjs';
import { ProductsApi } from '../products.api';
import { ProductsActions } from './products.actions';

export const createProduct$ = createEffect(
  (actions$ = inject(Actions), api = inject(ProductsApi)) =>
    actions$.pipe(
      ofType(ProductsActions.createRequested),
      concatMap(({ draft }) =>
        api.create(draft).pipe(
          map((product) => ProductsActions.createSucceeded({ product })),
          catchError((err) => of(ProductsActions.createFailed({ error: err.message }))),
        ),
      ),
    ),
  { functional: true },
);
```

The reducer only adds the entity in `createSucceeded` — classic pessimistic flow.

### 2. Optimistic update with Classic Store and snapshot rollback

```ts
// libs/products/data-access/src/lib/+state/products.actions.ts
export const ProductsActions = createActionGroup({
  source: 'Products',
  events: {
    'Rename Requested': props<{ id: string; name: string; previousName: string }>(),
    'Rename Succeeded': props<{ id: string; name: string }>(),
    'Rename Failed': props<{ id: string; previousName: string; error: string }>(),
  },
});
```

```ts
// libs/products/data-access/src/lib/+state/products.reducer.ts
import { createReducer, on } from '@ngrx/store';
import { createEntityAdapter, EntityState } from '@ngrx/entity';
import { Product } from '@myorg/models';
import { ProductsActions } from './products.actions';

const adapter = createEntityAdapter<Product>();
export interface ProductsState extends EntityState<Product> {}
const initial: ProductsState = adapter.getInitialState();

export const productsReducer = createReducer(
  initial,
  // Apply optimistically on request.
  on(ProductsActions.renameRequested, (state, { id, name }) =>
    adapter.updateOne({ id, changes: { name } }, state),
  ),
  // Rollback on failure using captured previousName.
  on(ProductsActions.renameFailed, (state, { id, previousName }) =>
    adapter.updateOne({ id, changes: { name: previousName } }, state),
  ),
  // No-op on success (state already reflects the change). Could reconcile server fields here.
  on(ProductsActions.renameSucceeded, (state, { id, name }) =>
    adapter.upsertOne({ id, name } as Product, state),
  ),
);
```

```ts
// libs/products/data-access/src/lib/+state/products.effects.ts
export const renameProduct$ = createEffect(
  (actions$ = inject(Actions), api = inject(ProductsApi)) =>
    actions$.pipe(
      ofType(ProductsActions.renameRequested),
      // groupBy(id) + concatMap serializes per entity but parallelizes across entities.
      groupBy((a) => a.id),
      mergeMap((group$) =>
        group$.pipe(
          concatMap((action) =>
            api.rename(action.id, action.name).pipe(
              map(() => ProductsActions.renameSucceeded({ id: action.id, name: action.name })),
              catchError((err) =>
                of(
                  ProductsActions.renameFailed({
                    id: action.id,
                    previousName: action.previousName,
                    error: err.message,
                  }),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  { functional: true },
);
```

### 3. Optimistic create with temp ID and server reconciliation

```ts
// libs/products/data-access/src/lib/+state/products.effects.ts
import { concatMap, map, catchError, of } from 'rxjs';

export const createProductOptimistic$ = createEffect(
  (actions$ = inject(Actions), api = inject(ProductsApi)) =>
    actions$.pipe(
      ofType(ProductsActions.createRequested),
      concatMap(({ draft, tempId }) =>
        api.create(draft).pipe(
          map((product) => ProductsActions.createSucceeded({ tempId, product })),
          catchError((err) =>
            of(ProductsActions.createFailed({ tempId, error: err.message })),
          ),
        ),
      ),
    ),
  { functional: true },
);
```

```ts
// reducer fragment
on(ProductsActions.createRequested, (state, { draft, tempId }) =>
  adapter.addOne({ ...draft, id: tempId, _pending: true } as Product, state),
),
on(ProductsActions.createSucceeded, (state, { tempId, product }) => {
  // Remove the placeholder, add the server entity. Single patch, no flicker.
  const withoutTemp = adapter.removeOne(tempId, state);
  return adapter.addOne(product, withoutTemp);
}),
on(ProductsActions.createFailed, (state, { tempId }) => adapter.removeOne(tempId, state)),
```

The component dispatches with `tempId: crypto.randomUUID()`, so the UI can key `@for` rows on id without waiting.

### 4. Optimistic update with SignalStore + rxMethod

```ts
// libs/products/data-access/src/lib/products.store.ts
import { signalStore, withState, withMethods, patchState } from '@ngrx/signals';
import { withEntities, setAllEntities, updateEntity, addEntity, removeEntity } from '@ngrx/signals/entities';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { inject } from '@angular/core';
import { pipe, concatMap, tap, catchError, EMPTY, groupBy, mergeMap } from 'rxjs';
import { ProductsApi } from './products.api';
import { Product } from '@myorg/models';

type State = { error: string | null };

export const ProductsStore = signalStore(
  { providedIn: 'root' },
  withEntities<Product>(),
  withState<State>({ error: null }),
  withMethods((store, api = inject(ProductsApi)) => ({
    renameOptimistic: rxMethod<{ id: string; name: string }>(
      pipe(
        // Snapshot + optimistic patch happen synchronously in tap before the request.
        tap(({ id, name }) => {
          const current = store.entityMap()[id];
          if (!current) return;
          patchState(store, updateEntity({ id, changes: { name, _prev: current.name } }));
        }),
        groupBy(({ id }) => id),
        mergeMap((group$) =>
          group$.pipe(
            concatMap(({ id, name }) =>
              api.rename(id, name).pipe(
                tap(() => patchState(store, updateEntity({ id, changes: { _prev: undefined } }))),
                catchError(() => {
                  const entity = store.entityMap()[id];
                  if (entity?._prev !== undefined) {
                    patchState(
                      store,
                      updateEntity({ id, changes: { name: entity._prev, _prev: undefined } }),
                    );
                  }
                  patchState(store, { error: 'Rename failed' });
                  return EMPTY;
                }),
              ),
            ),
          ),
        ),
      ),
    ),
  })),
);
```

### 5. Optimistic update via Events Plugin (withReducer + withEventHandlers)

```ts
// libs/products/data-access/src/lib/products.events.ts
import { eventGroup, type } from '@ngrx/signals/events';
import { Product } from '@myorg/models';

export const productEvents = eventGroup({
  source: 'Products',
  events: {
    renameRequested: type<{ id: string; name: string; previousName: string }>(),
    renameSucceeded: type<{ id: string }>(),
    renameFailed: type<{ id: string; previousName: string; error: string }>(),
  },
});
```

```ts
// libs/products/data-access/src/lib/products.store.ts
import { signalStore, withMethods } from '@ngrx/signals';
import { withEntities, updateEntity } from '@ngrx/signals/entities';
import { withReducer, withEventHandlers, on, injectDispatcher } from '@ngrx/signals/events';
import { Events } from '@ngrx/signals/events';
import { inject } from '@angular/core';
import { exhaustMap, map, catchError, of } from 'rxjs';
import { productEvents } from './products.events';
import { ProductsApi } from './products.api';

export const ProductsStore = signalStore(
  { providedIn: 'root' },
  withEntities<Product>(),
  withReducer(
    on(productEvents.renameRequested, ({ id, name }) => updateEntity({ id, changes: { name } })),
    on(productEvents.renameFailed, ({ id, previousName }) =>
      updateEntity({ id, changes: { name: previousName } }),
    ),
  ),
  withEventHandlers((_, events = inject(Events), api = inject(ProductsApi)) => ({
    rename$: events.on(productEvents.renameRequested).pipe(
      // concatMap serializes; swap to groupBy+concatMap for per-entity serialization.
      concatMap(({ payload }) =>
        api.rename(payload.id, payload.name).pipe(
          map(() => productEvents.renameSucceeded({ id: payload.id })),
          catchError((err) =>
            of(
              productEvents.renameFailed({
                id: payload.id,
                previousName: payload.previousName,
                error: err.message,
              }),
            ),
          ),
        ),
      ),
    ),
  })),
);
```

Note the clean separation: `withReducer` owns state transitions (including rollback), `withEventHandlers` owns side effects. Failure events carry `previousName` as context, so rollback is deterministic even if multiple renames are queued.

### 6. Plain signals + HttpClient (no NgRx) with snapshot rollback

```ts
// apps/shell/src/app/products/products.service.ts
import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Product } from '@myorg/models';

@Injectable({ providedIn: 'root' })
export class ProductsService {
  private http = inject(HttpClient);
  private _items = signal<Product[]>([]);
  readonly items = this._items.asReadonly();
  readonly pending = signal(new Set<string>());

  async rename(id: string, name: string): Promise<void> {
    const snapshot = this._items();
    const previous = snapshot.find((p) => p.id === id)?.name;
    if (previous === undefined) return;

    this._items.update((list) => list.map((p) => (p.id === id ? { ...p, name } : p)));
    this.pending.update((s) => new Set(s).add(id));

    try {
      const key = crypto.randomUUID();
      await firstValueFrom(
        this.http.patch(`/api/products/${id}`, { name }, {
          headers: { 'Idempotency-Key': key },
        }),
      );
    } catch {
      // Snapshot rollback: restore only this entity so concurrent edits survive.
      this._items.update((list) =>
        list.map((p) => (p.id === id ? { ...p, name: previous } : p)),
      );
      throw new Error('rename_failed');
    } finally {
      this.pending.update((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  }
}
```

```ts
// apps/shell/src/app/products/product-row.component.ts
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { ProductsService } from './products.service';
import { Product } from '@myorg/models';

@Component({
  selector: 'app-product-row',
  standalone: true,
  template: `
    <li>
      <span>{{ product().name }}</span>
      @if (pending().has(product().id)) {
        <em>saving...</em>
      }
    </li>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductRowComponent {
  product = input.required<Product>();
  private svc = inject(ProductsService);
  pending = this.svc.pending;
}
```

### 7. Request deduplication interceptor with idempotency key

```ts
// libs/shared/data-access/src/lib/idempotency.interceptor.ts
import { HttpContextToken, HttpEvent, HttpHandlerFn, HttpRequest } from '@angular/common/http';
import { Observable, shareReplay, finalize } from 'rxjs';

export const IDEMPOTENT = new HttpContextToken<boolean>(() => false);
const inFlight = new Map<string, Observable<HttpEvent<unknown>>>();

export function idempotencyInterceptor(
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> {
  if (!req.context.get(IDEMPOTENT)) return next(req);

  const key = req.headers.get('Idempotency-Key') ?? crypto.randomUUID();
  const cached = inFlight.get(key);
  if (cached) return cached;

  const shared = next(req.clone({ setHeaders: { 'Idempotency-Key': key } })).pipe(
    shareReplay({ bufferSize: 1, refCount: false }),
    finalize(() => inFlight.delete(key)),
  );
  inFlight.set(key, shared);
  return shared;
}
```

Register with `provideHttpClient(withInterceptors([idempotencyInterceptor]))`.

### 8. Exponential backoff retry

```ts
// libs/shared/data-access/src/lib/retry.ts
import { retry, timer } from 'rxjs';

export const retryWithBackoff = retry({
  count: 3,
  delay: (err, attempt) => {
    if (err.status && err.status < 500) throw err; // do not retry 4xx
    return timer(Math.min(1000 * 2 ** attempt, 8000));
  },
});
```

Compose into effects/rxMethods: `api.rename(id, name).pipe(retryWithBackoff, ...)`.

## Breaking Changes and Gotchas

- **`withEffects` -> `withEventHandlers`** in NgRx v21. Migration schematic lives in `@ngrx/signals` (tracked in platform issue #5010). Any pre-v21 blog snippets using `withEffects` must be rewritten.
- The `@ngrx/router-store/data-persistence` helpers (`optimisticUpdate`, `pessimisticUpdate`) still exist but are not the recommended happy path in v21; the Events Plugin with explicit `withReducer` on failure events is the idiomatic rollback pattern for SignalStore.
- **`httpResource` is not a mutation tool.** It is experimental and declarative-GET-shaped. Do not wire optimistic updates through it; use `HttpClient` for writes. The chapter should explicitly call this out because many readers will assume symmetry with `resource()`.
- **Angular 21 is zoneless.** Do not wrap rollbacks in `NgZone.run`. `patchState` and signal writes are already integrated with the zoneless scheduler.
- **`switchMap` inside mutation effects is a bug.** It cancels the HTTP request but leaves the optimistic patch applied, silently dropping the user's change. Use `concatMap`/`mergeMap`/`exhaustMap`. The well-known blog post by Nicholas Jamieson ("Avoiding switchMap-related Bugs") is a canonical reference.
- **Race conditions on the same entity**: multiple in-flight updates can leapfrog if you use `mergeMap` globally. Always `groupBy(id).pipe(mergeMap(g => g.pipe(concatMap(...))))` for writes.
- **Storing `previousValue` in state** works but stores "UI-only" data in the domain model. Cleaner alternative: keep an in-flight map `Record<requestId, Snapshot>` in a parallel state slice and read from it on failure.
- **Reconciling server-assigned IDs** with `@ngrx/entity` `updateOne({ id: tempId, changes: { id: serverId } })` does NOT work — `updateOne` cannot change the primary key (see issue ngrx/platform #817). Use `removeOne(tempId)` + `addOne(serverEntity)` in the same reducer transition.
- **`_pending` flags on entities** re-render rows when toggled. That is fine in zoneless mode with signal-based views, but if you use memoized selectors with deep equality, the flag change will still invalidate.
- **Idempotency-Key retry semantics**: reuse the same key across retries of the same logical request but generate a new key for a user-initiated retry (otherwise the server returns the cached failure).
- **Signal writes inside `tap`** work under zoneless mode because `patchState` dispatches through the signal graph directly. No `NgZone.run` needed.

## Sources

- [NgRx SignalStore docs](https://ngrx.io/guide/signals/signal-store)
- [NgRx Events Plugin docs](https://ngrx.io/guide/signals/signal-store/events)
- [Announcing NgRx 21 (dev.to)](https://dev.to/ngrx/announcing-ngrx-21-celebrating-a-10-year-journey-with-a-fresh-new-look-and-ngrxsignalsevents-5ekp)
- [Event-Driven State Management with NgRx Signal Store (dev.to/dimeloper)](https://dev.to/dimeloper/event-driven-state-management-with-ngrx-signal-store-j8i)
- [Announcing Events Plugin for NgRx SignalStore (dev.to/ngrx)](https://dev.to/ngrx/announcing-events-plugin-for-ngrx-signalstore-a-modern-take-on-flux-architecture-4dhn)
- [The new Event API in NgRx Signal Store - Angular Architects](https://www.angulararchitects.io/blog/the-new-event-api-in-ngrx-signal-store/)
- [NgRx SignalStore Events - Arcadio Quintero](https://arcadioquintero.com/en/blog/ngrx-signalstore-events-plugin/)
- [NgRx issue #5010: withEventHandlers migration schematic](https://github.com/ngrx/platform/issues/5010)
- [NgRx RFC #4408: reactivity layer (withEvents/withReducer/withEffects)](https://github.com/ngrx/platform/issues/4408)
- [NgRx optimisticUpdate API (data-persistence)](https://ngrx.io/api/router-store/data-persistence/optimisticUpdate)
- [NgRx Entity Adapter](https://ngrx.io/guide/entity/adapter)
- [ngrx/platform #817: upsert add overrides id property](https://github.com/ngrx/platform/issues/817)
- [Cancellable optimistic updates in Angular + Redux - Brecht Billiet](https://blog.brecht.io/Cancellable-optimistic-updates-in-Angular2-and-Redux/)
- [Optimistic UI and Auto Save with ngrx (dev.to)](https://dev.to/marc_dev01/optimistic-ui-and-auto-save-with-ngrx-111m)
- [angular.dev - Reactive data fetching with httpResource](https://angular.dev/guide/http/http-resource)
- [angular/angular discussion #60121 - Resource RFC 2 APIs](https://github.com/angular/angular/discussions/60121)
- [Skip Angular Resource - Alfredo Perez (ngconf)](https://medium.com/ngconf/skip-angular-resource-ff3441e8b2ba)
- [Nicholas Jamieson - Avoiding switchMap-related bugs](https://ncjamieson.com/avoiding-switchmap-related-bugs/)
- [DanyWalls - concatMap/mergeMap/switchMap/exhaustMap in NgRx CRUD](https://www.danywalls.com/when-to-use-concatmap-mergemap-switchmap-and-exhaustmap-operators-in-building-a-crud-with-ngrx)
- [Request Deduplication in Angular (dev.to/kasual1)](https://dev.to/kasual1/request-deduplication-in-angular-3pd8)
- [MDN - Idempotency-Key header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Idempotency-Key)
- [IETF draft - The Idempotency-Key HTTP Header Field](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)
- [TanStack Query Angular - Optimistic Updates](https://tanstack.com/query/v5/docs/framework/angular/guides/optimistic-updates)
- [Apollo Angular - Optimistic UI](https://the-guild.dev/graphql/apollo-angular/docs/performance/optimistic-ui)

## Open Questions

- Does `@ngrx/signals/events` v21.1.0 ship the `withEventHandlers` migration schematic as stable, or is it still "in-progress" per issue #5010? Verify `ng update @ngrx/signals` output before writing the chapter's migration sidebar.
- Confirm exact import path for `injectDispatcher` in v21.1.0 (`@ngrx/signals/events` vs a sub-path). Some v19/v20 posts use the older path.
- Verify whether `httpResource` in 21.x has gained any "mutation" or "refresh" hooks since the original RFC. As of the most recent angular.dev guidance it should not be used for writes, but check the 21.1/21.2 changelog.
- Confirm `updateEntity` from `@ngrx/signals/entities` cannot change the primary key (symmetry with `@ngrx/entity` #817). Likely true; worth a quick REPL test.
- Check whether `provideHttpClient(withInterceptors([...]))` runs interceptors outside a reactive context in zoneless mode — it should, but confirm signal writes from interceptors aren't batched unexpectedly.
- Check if the NgRx team publishes an official "optimistic update recipe" page for the Events Plugin in the v21 docs (the current guide shows the general pattern but not a dedicated recipe).
