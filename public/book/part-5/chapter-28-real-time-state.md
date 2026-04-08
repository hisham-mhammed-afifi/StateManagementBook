# Chapter 28: Real-Time State

A buyer in your B2B catalog adds twelve units of an industrial pump to their cart. They click checkout. The order fails because, somewhere between page load and submit, a warehouse in Rotterdam shipped the last six units to another customer. Your stock counter said `18`. It was lying. It was lying because you fetched it once, on navigation, and trusted it for the next four minutes. The fix is not a bigger spinner. The fix is to treat inventory as a stream that flows into the store, not a value that the store owns.

This chapter is about that shift. We will move data into Angular state from three transports: HTTP polling, Server-Sent Events, and WebSockets. We will wire each into NgRx Classic effects and into a SignalStore using the v21 Events Plugin. And we will spend the second half on the things tutorials skip: reconnect backoff, message coalescing, out-of-order handling, and how zoneless Angular changes none of this and all of it at once.

## A Brief Recap

Two things from earlier chapters matter here. First, NgRx 21 renamed `withEffects` to `withEventHandlers` and introduced `eventGroup`, `withReducer`, and a `Dispatcher` for SignalStore. We will use those names. Second, Angular 21 is zoneless by default, which means signal updates inside an asynchronous callback propagate to the view without `NgZone.run`. You do not have to wrap socket handlers in anything.

## Picking a Transport

Before any code, pick the right pipe. Three options, three trade-offs.

**Polling** is an HTTP request on a timer. It works through every corporate proxy, requires zero server changes, and is trivial to debug because every update is a normal request in the Network tab. The cost is latency-versus-load: poll every five seconds and you lag five seconds behind reality while paying for twelve requests a minute per user. Reach for polling when updates are infrequent, when staleness of a few seconds is acceptable, or when you cannot change the backend.

**Server-Sent Events** is a one-way stream from server to client over a long-lived HTTP response. The browser's `EventSource` reconnects on its own, frames are plain text, and there is no protocol upgrade. Reach for SSE for notifications, dashboards, log tails, anything where the client only listens.

**WebSockets** is a full-duplex socket. Lower latency than SSE, supports binary frames, and lets the client push as well as receive. Reach for WebSockets when you need bidirectional traffic: chat, presence, collaborative editing, trading.

The store does not care which one you picked. The store cares about the shape of the data after the transport hands it over. Keep that boundary clean.

## Polling with `rxResource`

Angular 21's `rxResource` is the cleanest way to express "re-fetch when these inputs change, on a timer." It is a reactive resource backed by an observable factory, and its `params` field is a signal-reading function so it re-runs whenever the inputs change.

```ts
// libs/products/data-access/src/lib/inventory.store.ts
import { Injectable, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { interval, startWith, switchMap } from 'rxjs';

type StockLevel = { productId: string; available: number; reserved: number };

@Injectable({ providedIn: 'root' })
export class InventoryStore {
  private http = inject(HttpClient);
  readonly warehouseId = signal<string>('rotterdam');

  readonly stock = rxResource({
    params: () => this.warehouseId(),
    stream: ({ params: id }) =>
      interval(5_000).pipe(
        startWith(0),
        switchMap(() => this.http.get<StockLevel[]>(`/api/warehouses/${id}/stock`)),
      ),
  });

  readonly available = computed(() => {
    const rows = this.stock.value() ?? [];
    return Object.fromEntries(rows.map((r) => [r.productId, r.available]));
  });
}
```

Two things are worth pointing out. The `interval` lives inside `stream`, not outside, because we want the polling cadence to restart every time `warehouseId` changes. And `available` is a `computed` that derives a lookup map from the resource's value, so components can read `available()['pump-12']` without iterating an array on every render.

A component subscribes by reading the signal:

```ts
// src/app/inventory/stock-badge.component.ts
import { Component, inject, input } from '@angular/core';
import { InventoryStore } from '@myorg/products/data-access';

@Component({
  selector: 'app-stock-badge',
  template: `
    @let qty = store.available()[productId()];
    @if (qty === undefined) {
      <span class="muted">checking...</span>
    } @else if (qty === 0) {
      <span class="danger">Out of stock</span>
    } @else {
      <span>{{ qty }} in stock</span>
    }
  `,
})
export class StockBadgeComponent {
  protected store = inject(InventoryStore);
  readonly productId = input.required<string>();
}
```

Polling solves the buyer-versus-Rotterdam race down to a five-second window. For a catalog page, that is often enough. For a checkout button, it is not. Time to push.

## Server-Sent Events

`EventSource` is a browser global, not part of `HttpClient`, and that has consequences. Functional interceptors will not run for SSE connections. If you need auth headers, you have to ride them in cookies or as a query parameter, or front the SSE endpoint with a small library that re-implements `EventSource` on top of `HttpClient`. Be deliberate about it.

We wrap `EventSource` in an Observable so the rest of the app can treat it like any other stream:

```ts
// libs/realtime/src/lib/sse.ts
import { Observable } from 'rxjs';

export function fromSSE<T>(url: string): Observable<T> {
  return new Observable<T>((subscriber) => {
    const source = new EventSource(url, { withCredentials: true });
    source.onmessage = (event) => {
      try {
        subscriber.next(JSON.parse(event.data) as T);
      } catch (err) {
        subscriber.error(err);
      }
    };
    source.onerror = (err) => subscriber.error(err);
    return () => source.close();
  });
}
```

Now we can stream stock updates straight into the inventory store. We will wire this through a SignalStore so the events are first-class state transitions instead of ad-hoc subscriptions.

```ts
// libs/products/data-access/src/lib/inventory-live.store.ts
import { computed, inject } from '@angular/core';
import { signalStore, withState, withMethods, withHooks, patchState } from '@ngrx/signals';
import { fromSSE } from '@myorg/realtime';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

type Patch = { productId: string; available: number; seq: number };

type State = {
  byId: Record<string, { available: number; seq: number }>;
  status: 'idle' | 'connecting' | 'open' | 'closed';
};

const initial: State = { byId: {}, status: 'idle' };

export const InventoryLiveStore = signalStore(
  { providedIn: 'root' },
  withState(initial),
  withMethods((store) => ({
    apply(patch: Patch) {
      const current = store.byId()[patch.productId];
      if (current && current.seq >= patch.seq) return;
      patchState(store, (s) => ({
        byId: { ...s.byId, [patch.productId]: { available: patch.available, seq: patch.seq } },
      }));
    },
  })),
  withHooks({
    onInit(store) {
      patchState(store, { status: 'connecting' });
      fromSSE<Patch>('/api/inventory/stream')
        .pipe(takeUntilDestroyed())
        .subscribe({
          next: (patch) => {
            if (store.status() !== 'open') patchState(store, { status: 'open' });
            store.apply(patch);
          },
          error: () => patchState(store, { status: 'closed' }),
        });
    },
  }),
);
```

Three details earn their keep here. The `seq` check drops stale messages: if Rotterdam emits patch `seq: 17` and then we receive a delayed patch `seq: 16` over a reconnected stream, we ignore the older one. The `status` signal models the connection lifecycle as state, so a header bar can show a "Reconnecting..." pill without polling the socket. And `takeUntilDestroyed` ties the subscription to the store's injection context, so `EventSource.close()` runs when the store is torn down. (For `providedIn: 'root'` stores that lifetime is the whole app, which is exactly what you want for a global feed.)

## WebSockets

For two-way traffic, use `webSocket` from `rxjs/webSocket`. It returns a `WebSocketSubject` that you can `subscribe` for incoming frames and `next` to send. The subject handles JSON serialization both ways by default.

```ts
// libs/realtime/src/lib/orders.socket.ts
import { Injectable, signal } from '@angular/core';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { retry, share, timer } from 'rxjs';

export type OrderEvent =
  | { kind: 'placed'; orderId: string; total: number }
  | { kind: 'shipped'; orderId: string; trackingId: string };

@Injectable({ providedIn: 'root' })
export class OrdersSocket {
  readonly status = signal<'connecting' | 'open' | 'closed'>('connecting');

  private socket: WebSocketSubject<OrderEvent> = webSocket<OrderEvent>({
    url: 'wss://api.example.com/orders',
    openObserver: { next: () => this.status.set('open') },
    closeObserver: { next: () => this.status.set('closed') },
  });

  readonly events$ = this.socket.pipe(
    retry({
      delay: (_err, attempt) => {
        this.status.set('connecting');
        const base = Math.min(30_000, 2 ** attempt * 500);
        const jitter = Math.random() * 250;
        return timer(base + jitter);
      },
    }),
    share(),
  );

  send(message: OrderEvent) {
    this.socket.next(message);
  }
}
```

The `retry` operator is doing the work that everyone forgets to do. Without it, a single dropped frame closes the socket forever. With it, we reconnect on a doubling delay capped at thirty seconds, plus a small jitter so a thousand tabs reconnecting after a server blip do not stampede the gateway. `share` multicasts the stream so subscribing twice does not open two sockets.

Browsers do not let you set custom headers on a `WebSocket` constructor. If your auth is a bearer token, pass it through the connection URL as a query parameter or use the WebSocket subprotocol field. Rotate it. Do not log it.

## Wiring a Socket into the Events Plugin

The previous chapter introduced `withEventHandlers` and `eventGroup` for SignalStore. Real-time feeds are exactly the use case those APIs were designed for: an external stream produces events, the store reacts. Here is the orders feed routed through the dispatcher.

```ts
// libs/orders/data-access/src/lib/orders.events.ts
import { eventGroup, type } from '@ngrx/signals/events';

export const ordersEvents = eventGroup({
  source: 'Orders',
  events: {
    placed: type<{ orderId: string; total: number }>(),
    shipped: type<{ orderId: string; trackingId: string }>(),
    connectionLost: type<void>(),
  },
});
```

```ts
// libs/orders/data-access/src/lib/orders.store.ts
import { computed, inject } from '@angular/core';
import { signalStore, withState, withHooks, patchState } from '@ngrx/signals';
import { withReducer, on } from '@ngrx/signals/events';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { OrdersSocket } from '@myorg/realtime';
import { ordersEvents } from './orders.events';

type Order = { id: string; total: number; trackingId?: string };

export const OrdersStore = signalStore(
  { providedIn: 'root' },
  withState({ byId: {} as Record<string, Order>, online: false }),
  withReducer(
    on(ordersEvents.placed, ({ payload }, state) => ({
      ...state,
      online: true,
      byId: { ...state.byId, [payload.orderId]: { id: payload.orderId, total: payload.total } },
    })),
    on(ordersEvents.shipped, ({ payload }, state) => {
      const existing = state.byId[payload.orderId];
      if (!existing) return state;
      return {
        ...state,
        byId: { ...state.byId, [payload.orderId]: { ...existing, trackingId: payload.trackingId } },
      };
    }),
    on(ordersEvents.connectionLost, (_, state) => ({ ...state, online: false })),
  ),
  withHooks({
    onInit(store) {
      const socket = inject(OrdersSocket);
      socket.events$.pipe(takeUntilDestroyed()).subscribe({
        next: (event) => {
          if (event.kind === 'placed') store.dispatch(ordersEvents.placed(event));
          else if (event.kind === 'shipped') store.dispatch(ordersEvents.shipped(event));
        },
        error: () => store.dispatch(ordersEvents.connectionLost()),
      });
    },
  }),
);
```

Notice the split. The socket service knows nothing about the store. The store knows nothing about WebSockets. The bridge in `onInit` is the only place where transport meets state, and it is twelve lines long. If tomorrow you swap WebSockets for SSE, you replace `OrdersSocket` and the store does not change.

## NgRx Classic: The Same Idea, Different Plumbing

For teams on Classic Store, the bridge is an effect that turns the socket stream into actions:

```ts
// libs/orders/data-access/src/lib/+state/orders.effects.ts
import { inject } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { map, catchError, of } from 'rxjs';
import { OrdersSocket } from '@myorg/realtime';
import { OrdersActions } from './orders.actions';

export const ordersFeed$ = createEffect(
  (socket = inject(OrdersSocket)) =>
    socket.events$.pipe(
      map((event) =>
        event.kind === 'placed'
          ? OrdersActions.placed(event)
          : OrdersActions.shipped(event),
      ),
      catchError(() => of(OrdersActions.connectionLost())),
    ),
  { functional: true, dispatch: true },
);
```

The reducer handles `placed`, `shipped`, and `connectionLost` exactly like any other action. The fact that the source is a socket is invisible to it. This is the payoff of treating real-time as state-mutation events.

## Coalescing High-Frequency Updates

Some feeds emit faster than the user can perceive. A market data socket might push thirty ticks per second per symbol. Patching the store thirty times a second is wasted work because the user cannot see the difference between sixty frames and thirty frames of "the price moved by half a cent." Use `auditTime` to keep only the latest value within a window, and `bufferTime` when you need to apply many updates as one batch.

```ts
// libs/realtime/src/lib/coalesce.ts
import { auditTime, bufferTime, filter } from 'rxjs';

export const coalesceLatest = <T>(windowMs = 50) => auditTime<T>(windowMs);

export const coalesceBatch = <T>(windowMs = 100) =>
  (source$) => source$.pipe(bufferTime<T>(windowMs), filter((b) => b.length > 0));
```

`auditTime` is the right default for replace-style updates: you only want the freshest value. `bufferTime` is the right default for additive updates: every event matters, but applying them one at a time would thrash the store. Pick per stream.

## Common Mistakes

**1. Wrapping socket handlers in `NgZone.run`.** This is a holdover from zone.js apps where async callbacks did not trigger change detection. In zoneless Angular 21, signals propagate through their own dependency graph, and `patchState` is just a signal write. Wrapping it in `NgZone.run` is dead code at best.

```ts
// Wrong (zoneless app)
socket.events$.subscribe((event) => zone.run(() => store.apply(event)));

// Right
socket.events$.subscribe((event) => store.apply(event));
```

**2. Using `switchMap` to merge an ordered stream.** `switchMap` cancels the previous inner observable when a new outer value arrives. For a polling resource that is exactly what you want. For a stream of order events that must arrive in the order the server sent them, it will silently drop messages.

```ts
// Wrong: drops in-flight events on every new outer emission
incoming$.pipe(switchMap((id) => api.fetchEnriched(id))).subscribe(...);

// Right: process every event in order
incoming$.pipe(concatMap((id) => api.fetchEnriched(id))).subscribe(...);
```

**3. Forgetting reconnect backoff.** A naked `webSocket()` call with no `retry` will close the subject permanently on the first network blip. The user reloads the page to fix it, which is precisely the experience you were trying to avoid by using sockets in the first place.

```ts
// Wrong
this.socket.subscribe((msg) => store.apply(msg));

// Right
this.socket.pipe(
  retry({ delay: (_e, n) => timer(Math.min(30_000, 2 ** n * 500) + Math.random() * 250) }),
).subscribe((msg) => store.apply(msg));
```

**4. Initializing `EventSource` or `WebSocket` at module load on the server.** Both globals are undefined under SSR. A `signalStore({ providedIn: 'root' })` that opens a socket in `onInit` will throw on the first render in a Node environment. Guard with `isPlatformBrowser` or move the connection into `afterNextRender`.

```ts
// Wrong: crashes on the server
withHooks({
  onInit(store) {
    const source = new EventSource('/api/stream');
  },
}),

// Right
withHooks({
  onInit(store) {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const source = new EventSource('/api/stream');
  },
}),
```

**5. Trusting message order without a sequence number.** Networks reorder, reconnects replay, and at-least-once delivery is the norm. If your store applies whatever arrives last, an out-of-order patch will silently corrupt it. Have the server stamp every message with a monotonic `seq` per resource and discard anything older than what you already hold.

## Key Takeaways

- Pick polling when staleness of seconds is fine, SSE when the client only listens, WebSockets when the client also speaks. Match the transport to the read/write pattern, not to fashion.
- Keep transport code and store code in separate files connected by a single bridge. Swapping transports should not touch the reducer.
- Model the connection lifecycle (`connecting`, `open`, `closed`) as state. The UI needs it and so does your debugging.
- Always reconnect with capped exponential backoff plus jitter, and always discard messages older than the highest sequence you have already applied.
- In zoneless Angular 21 there is no `NgZone` ceremony around socket handlers. Signals carry the update from the callback to the DOM on their own.

