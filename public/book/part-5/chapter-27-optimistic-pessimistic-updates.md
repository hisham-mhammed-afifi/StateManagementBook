# Chapter 27: Optimistic and Pessimistic Updates

A user renames a product in your admin console. They click the pencil icon, type a new name, and press Enter. The input freezes. A spinner spins. Three hundred milliseconds later the row updates. They edit a second row. Spinner. Wait. By the time they have renamed five products, they are angry, and rightly so, because the network round trip is fighting their typing speed. Compare this to renaming a file in Finder: the new name appears the instant you press Enter. The save happens in the background. If it fails, the name reverts and a toast explains why.

That is the difference between a pessimistic and an optimistic update, and it is one of the most consequential decisions in any state management codebase. This chapter shows how to implement both correctly with NgRx Classic Store, NgRx SignalStore, and the new Events Plugin, and where the sharp edges are: rollback, race conditions, temp IDs, and the operator choice that will silently corrupt your state if you get it wrong.

## A Brief Recap

Earlier chapters covered two things this one builds on. First, `@ngrx/entity` and `withEntities` (from `@ngrx/signals/entities`) give you `addEntity`, `updateEntity`, `removeEntity`, and `upsertEntity` for working with normalized collections. Second, NgRx 21 renamed `withEffects` to `withEventHandlers`, introduced `eventGroup` and `withReducer`, and pushed SignalStore toward an explicit reducer/handler split that mirrors classic Redux. We will lean on both.

## Pessimistic: Wait, Then Mutate

The pessimistic flow is the boring one and you should reach for it whenever a write is destructive, expensive, or rarely retried: deleting an account, charging a card, submitting an exam. The shape is always the same. Set a `pending` flag, fire the request, mutate state on success, surface the error on failure. Nothing leaves "tentative" until the server says yes.

```ts
// libs/products/data-access/src/lib/+state/products.actions.ts
import { createActionGroup, props } from '@ngrx/store';
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
          catchError((err) =>
            of(ProductsActions.createFailed({ error: err.message })),
          ),
        ),
      ),
    ),
  { functional: true },
);
```

The reducer only inserts the entity in `createSucceeded`. The UI shows a spinner from the moment `createRequested` is dispatched until either success or failure clears it. There is no rollback to think about because nothing was applied prematurely.

The cost is latency. The user stares at the spinner. That is acceptable for a "Create Account" button and unacceptable for inline editing. Choose the flow per interaction, not per project.

## Optimistic: Mutate, Then Reconcile

The optimistic flow inverts the order. We mutate local state immediately, fire the request, and on failure we revert. The user sees instant feedback. The risk is that a failure path now has to undo work, which means we need a snapshot.

The naive approach is to capture the previous value in the action payload itself, so the failure event carries everything needed to roll back. This is more reliable than pulling the previous value from current state during the failure handler, because by then a concurrent update may already have changed it.

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
  on(ProductsActions.renameRequested, (state, { id, name }) =>
    adapter.updateOne({ id, changes: { name } }, state),
  ),
  on(ProductsActions.renameFailed, (state, { id, previousName }) =>
    adapter.updateOne({ id, changes: { name: previousName } }, state),
  ),
  on(ProductsActions.renameSucceeded, (state, { id, name }) =>
    adapter.upsertOne({ id, name } as Product, state),
  ),
);
```

The reducer is symmetric. Apply on request, revert on failure, no-op (or reconcile server fields) on success. A component dispatches with the current name as `previousName`, captured before it called `dispatch`.

The effect is where most teams introduce a race condition. The temptation is to write `switchMap`, because that is the operator we use for most asynchronous flows. Resist it.

```ts
// libs/products/data-access/src/lib/+state/products.effects.ts
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { groupBy, mergeMap, concatMap, map, catchError, of } from 'rxjs';
import { ProductsApi } from '../products.api';
import { ProductsActions } from './products.actions';

export const renameProduct$ = createEffect(
  (actions$ = inject(Actions), api = inject(ProductsApi)) =>
    actions$.pipe(
      ofType(ProductsActions.renameRequested),
      groupBy((a) => a.id),
      mergeMap((group$) =>
        group$.pipe(
          concatMap((action) =>
            api.rename(action.id, action.name).pipe(
              map(() =>
                ProductsActions.renameSucceeded({ id: action.id, name: action.name }),
              ),
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

`groupBy(id)` partitions the action stream by entity id. `mergeMap` runs each group in parallel, so renames on different products do not block each other. Inside a single group, `concatMap` serializes writes so that two rapid renames on the same row hit the server in order. The result is high throughput across the collection and strict per-entity ordering. This pattern, `groupBy(id) + mergeMap + concatMap`, is the safe default for any optimistic write effect.

## Optimistic Create with Temp IDs

Renames are easy because the entity already has an id. Creates are harder. The component needs to insert a row before the server has assigned a real id, which means the client has to invent one. Use `crypto.randomUUID()` and pass it through the request action.

```ts
// libs/products/data-access/src/lib/+state/products.reducer.ts (fragment)
on(ProductsActions.createRequested, (state, { draft, tempId }) =>
  adapter.addOne({ ...draft, id: tempId, _pending: true } as Product, state),
),
on(ProductsActions.createSucceeded, (state, { tempId, product }) => {
  const withoutTemp = adapter.removeOne(tempId, state);
  return adapter.addOne(product, withoutTemp);
}),
on(ProductsActions.createFailed, (state, { tempId }) => adapter.removeOne(tempId, state)),
```

Note what we are not doing: we are not calling `updateOne({ id: tempId, changes: { id: serverId } })`. The entity adapter cannot change a primary key (this is an old, well-known constraint of `@ngrx/entity`, tracked in platform issue #817, and `updateEntity` from `@ngrx/signals/entities` inherits the same behavior). The fix is to remove the placeholder and add the server entity in the same reducer transition. Because both updates happen inside one `on` handler, the change is atomic from the view's perspective and there is no flicker.

## SignalStore with the Events Plugin

NgRx 21's Events Plugin is the cleanest place to express an optimistic flow in SignalStore. `withReducer` owns state transitions, including rollback. `withEventHandlers` (renamed from `withEffects` in v21; a migration schematic ships with `ng update @ngrx/signals`) owns side effects. The two never overlap, which removes the most common bug in hand-rolled SignalStore mutations: applying the optimistic patch in one place and the rollback in another, then forgetting to keep them in sync.

```ts
// libs/products/data-access/src/lib/products.events.ts
import { eventGroup, type } from '@ngrx/signals/events';

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
import { signalStore } from '@ngrx/signals';
import { withEntities, updateEntity } from '@ngrx/signals/entities';
import { withReducer, withEventHandlers, on, Events } from '@ngrx/signals/events';
import { inject } from '@angular/core';
import { concatMap, groupBy, mergeMap, map, catchError, of } from 'rxjs';
import { Product } from '@myorg/models';
import { ProductsApi } from './products.api';
import { productEvents } from './products.events';

export const ProductsStore = signalStore(
  { providedIn: 'root' },
  withEntities<Product>(),
  withReducer(
    on(productEvents.renameRequested, ({ id, name }) =>
      updateEntity({ id, changes: { name } }),
    ),
    on(productEvents.renameFailed, ({ id, previousName }) =>
      updateEntity({ id, changes: { name: previousName } }),
    ),
  ),
  withEventHandlers((_, events = inject(Events), api = inject(ProductsApi)) => ({
    rename$: events.on(productEvents.renameRequested).pipe(
      groupBy(({ payload }) => payload.id),
      mergeMap((group$) =>
        group$.pipe(
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
      ),
    ),
  })),
);
```

A component dispatches by injecting the events dispatcher and calling `dispatcher.dispatch(productEvents.renameRequested({ id, name, previousName }))`. The reducer applies the optimistic patch synchronously, the event handler fires the request, and on failure the event handler emits `renameFailed` whose payload carries the snapshot. The reducer reverts. The two halves never have to know about each other.

## Plain Signals Without NgRx

Not every app warrants a store. A small component can run an optimistic flow against `HttpClient` directly, as long as it captures a snapshot before the patch and restores it on failure. The trick is to restore only the affected entity, not the entire list, so concurrent edits to other rows survive.

```ts
// apps/shell/src/app/products/products.service.ts
import { Injectable, inject, signal } from '@angular/core';
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
    const previous = this._items().find((p) => p.id === id)?.name;
    if (previous === undefined) return;

    this._items.update((list) =>
      list.map((p) => (p.id === id ? { ...p, name } : p)),
    );
    this.pending.update((s) => new Set(s).add(id));

    try {
      await firstValueFrom(
        this.http.patch(`/api/products/${id}`, { name }, {
          headers: { 'Idempotency-Key': crypto.randomUUID() },
        }),
      );
    } catch {
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
import { Component, inject, input } from '@angular/core';
import { ProductsService } from './products.service';
import { Product } from '@myorg/models';

@Component({
  selector: 'app-product-row',
  template: `
    <li>
      <span>{{ product().name }}</span>
      @if (svc.pending().has(product().id)) {
        <em>saving</em>
      }
    </li>
  `,
})
export class ProductRowComponent {
  product = input.required<Product>();
  protected svc = inject(ProductsService);
}
```

This is the minimum viable optimistic flow: snapshot, patch, request, restore on error, clear the pending flag in `finally`. Notice the `Idempotency-Key` header. Without it, a network retry can apply the same rename twice on a server that does not deduplicate.

> **Heads-up about `httpResource`**
> Angular 21 ships an experimental `httpResource()` for declarative data fetching. It is shaped for GETs. Do not use it for optimistic mutations. Use `HttpClient.patch/post/put/delete` directly for writes. The Angular team has been explicit about this in the http-resource guide.

## Idempotency and Request Deduplication

The Idempotency-Key header is half a contract. The client promises to send the same key for retries of the same logical request, and the server promises to return the same response if it has already processed that key. Generate the key once when the user clicks Save. Reuse it on every retry. Generate a fresh key only when the user explicitly retries after an error, otherwise the server hands back the cached failure forever.

A small interceptor can also deduplicate concurrent requests with the same key, which is useful when two components race to save the same change.

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

Register with `provideHttpClient(withInterceptors([idempotencyInterceptor]))` and opt in per request via the `IDEMPOTENT` context token.

## Common Mistakes

**1. Using `switchMap` in a write effect.**

```ts
// wrong
ofType(ProductsActions.renameRequested),
switchMap((a) => api.rename(a.id, a.name).pipe(...)),
```

`switchMap` cancels the previous inner observable. In a read pipeline that is exactly what you want; the user typed a new search query, throw the old one away. In a write pipeline it is a silent data loss bug. The HTTP request is canceled, but the optimistic patch is already applied. The user's earlier rename is now permanent on the client and lost on the server. Use `concatMap` (per entity) or `mergeMap` (across entities), or combine both with `groupBy` as shown above.

```ts
// right
ofType(ProductsActions.renameRequested),
groupBy((a) => a.id),
mergeMap((g$) => g$.pipe(concatMap((a) => api.rename(a.id, a.name).pipe(...)))),
```

**2. Reading the previous value from current state during rollback.**

```ts
// wrong
on(ProductsActions.renameFailed, (state, { id }) => {
  const current = state.entities[id];
  return adapter.updateOne({ id, changes: { name: current!.name } }, state);
}),
```

By the time the failure handler runs, another optimistic update may already have changed `state.entities[id].name`. Rolling back to the "current" name means rolling back to the wrong value. Capture the previous value in the request payload and carry it through to the failure event so rollback is deterministic.

```ts
// right
on(ProductsActions.renameFailed, (state, { id, previousName }) =>
  adapter.updateOne({ id, changes: { name: previousName } }, state),
),
```

**3. Trying to rename an entity's primary key.**

```ts
// wrong
on(ProductsActions.createSucceeded, (state, { tempId, product }) =>
  adapter.updateOne({ id: tempId, changes: { id: product.id } }, state),
),
```

`updateOne` cannot change the entity's id; it silently keeps the old id and merges the rest of the changes. The placeholder lingers under its temp id forever. Remove the placeholder and add the server entity instead.

```ts
// right
on(ProductsActions.createSucceeded, (state, { tempId, product }) => {
  const withoutTemp = adapter.removeOne(tempId, state);
  return adapter.addOne(product, withoutTemp);
}),
```

**4. Forgetting the idempotency key on retries.**

```ts
// wrong
retry({ count: 3, delay: 1000 })
// every retry generates a new request id on the server, which can apply the rename twice
```

Generate the key once per logical user action and reuse it on every retry. The server then dedupes by key.

```ts
// right
const key = crypto.randomUUID();
this.http.patch(url, body, { headers: { 'Idempotency-Key': key } }).pipe(
  retry({ count: 3, delay: (err, n) => timer(Math.min(1000 * 2 ** n, 8000)) }),
);
```

**5. Mixing optimistic and pessimistic flows on the same action.**

A common mistake is to apply the optimistic patch in the reducer and then also wait for `Succeeded` before clearing a `pending` flag set by the same action. The UI ends up showing both the optimistic value and a saving spinner forever, because nothing in the reducer ever clears the spinner. Pick one model per interaction. If you want both instant feedback and a "saving" indicator, set the pending flag on `Requested`, clear it on both `Succeeded` and `Failed`, and apply the value on `Requested`.

## Key Takeaways

- Use pessimistic updates for destructive or irreversible operations and optimistic updates for inline editing where latency would feel broken.
- Capture the previous value in the request payload and carry it through to the failure event. Never look it up in current state during rollback.
- The default operator pattern for write effects and event handlers is `groupBy(id) + mergeMap + concatMap`. `switchMap` in a write pipeline is a bug.
- Optimistic creates use a client-generated `crypto.randomUUID()` as a temp id. Reconcile by removing the placeholder and adding the server entity in the same transition; never try to rename an entity's primary key.
- The Events Plugin (`withReducer` for state, `withEventHandlers` for side effects) is the idiomatic way to express an optimistic flow in NgRx 21 SignalStore. Failure events carry the snapshot so rollback stays deterministic.
- Send an `Idempotency-Key` header on every mutation, reuse the key across automatic retries, and generate a fresh key only on a user-initiated retry.
