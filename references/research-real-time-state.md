## Research: Real-Time State (WebSockets, SSE, Polling)

**Date:** 2026-04-08
**Chapter:** Ch 28
**Status:** Ready for chapter generation

## Scope

How to model and integrate real-time data sources into Angular state: WebSockets, Server-Sent Events (SSE), and HTTP polling. Coverage spans raw browser APIs, RxJS bridges, signal integration, NgRx Classic Store effects, and SignalStore with the Events plugin.

## API Surface

- `WebSocket` (browser global) — native bidirectional socket. Stable.
- `webSocket<T>()` from `rxjs/webSocket` — RxJS multiplexed WebSocketSubject. Stable.
- `EventSource` (browser global) — one-way SSE stream. Stable. NOT routed through Angular's `HttpClient`, so functional interceptors do not apply.
- `toSignal(observable, { initialValue })` from `@angular/core/rxjs-interop` — bridges streams to signals. Stable.
- `toObservable(signal)` — converts a signal to an observable, used to drive polling reruns from signal inputs. Stable.
- `rxResource({ params, stream })` from `@angular/core/rxjs-interop` — reactive resource backed by an observable factory. Stable in Angular 21. Useful for polling-with-params patterns and re-runs on signal changes.
- `resource({ params, loader })` from `@angular/core` — promise-based reactive resource. Stable.
- `httpResource()` from `@angular/common/http` — declarative HTTP resource.
  > **API Status: Experimental**
  > `httpResource` is `@experimental` in Angular 21.0.0. Suitable for cache/poll demos but flag it.
- `interval(ms)`, `timer()`, `switchMap`, `retry({ delay })`, `repeat({ delay })`, `share()`, `shareReplay()` from RxJS — polling, retry/backoff, multicasting. Stable.
- NgRx Classic: `createEffect`, `Actions`, `ofType` — wire socket streams to actions. Stable.
- NgRx SignalStore: `signalStore`, `withState`, `withMethods`, `withHooks`, `withEventHandlers` (renamed from `withEffects` in v21), `eventGroup`, `withReducer`, `on`, `Dispatcher`, `injectDispatcher` — Events Plugin is stable in NgRx 21.

## Key Concepts

- The three transports and when to pick each:
  - **Polling**: simplest, works through every proxy, no server changes. Cost: latency vs request rate trade-off.
  - **SSE (EventSource)**: server-push over HTTP, auto-reconnect built in, one-way only, text frames. Best for notifications, dashboards, log tails.
  - **WebSockets**: full duplex, binary capable, lowest latency. Best for chat, collaborative editing, trading.
- Real-time data is a *stream*, not a *value*. The state store is the *projection* of the stream into a value. Always separate transport from store.
- Push updates have to be **merged** into existing state (entity upsert), not replaced. Use entity adapters or `patchState` with map updates.
- **Backpressure and coalescing**: high-frequency feeds (price ticks, presence) should be buffered (`bufferTime`, `auditTime`) before patching the store, otherwise zoneless change detection still has to walk dependents per event.
- **Connection lifecycle is state**: model `'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'error'` explicitly. UI needs it.
- **Reconnect with backoff**: never reconnect in a tight loop. Use `retry({ delay: (err, n) => timer(Math.min(30_000, 2 ** n * 500)) })`.
- **Out-of-order and duplicates**: include a monotonic `seq` or `version` per message; drop stale.
- **Zoneless implications**: signals only re-render dependents. A WebSocket message handler that calls `patchState` works correctly without `NgZone.run()`. Do not wrap in `runOutsideAngular`/`run`.
- **SSR**: WebSocket/EventSource do not run on the server. Guard with `afterNextRender` or `isPlatformBrowser`. Use TransferState for the initial snapshot.
- **Resource cleanup**: connect/disconnect tied to `DestroyRef` or SignalStore `withHooks({ onInit, onDestroy })`.
- **Auth**: WebSockets cannot send custom headers from the browser. Pass token via subprotocol or query string (and rotate). SSE same constraint unless you use the `ngx-sse-client` HttpClient-backed shim.
- **Optimistic local writes** combined with server echo: dedupe by client-generated id.

## Code Patterns

### 1. RxJS WebSocket service bridged to a signal

```ts
// libs/realtime/src/lib/ticker.service.ts
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { retry, timer } from 'rxjs';

type Tick = { symbol: string; price: number; ts: number };

@Injectable({ providedIn: 'root' })
export class TickerService {
  private socket: WebSocketSubject<Tick> = webSocket<Tick>('wss://api.example.com/ticks');
  private readonly _prices = signal<Record<string, Tick>>({});
  readonly prices = this._prices.asReadonly();
  readonly status = signal<'connecting' | 'open' | 'closed'>('connecting');

  constructor() {
    this.socket
      .pipe(
        retry({ delay: (_e, n) => timer(Math.min(30_000, 2 ** n * 500)) }),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe({
        next: (t) => {
          this.status.set('open');
          this._prices.update((m) => ({ ...m, [t.symbol]: t }));
        },
        complete: () => this.status.set('closed'),
      });
  }

  send(msg: unknown) { this.socket.next(msg as Tick); }
}
```

### 2. SSE wrapped as an Observable

```ts
// libs/realtime/src/lib/sse.ts
import { Observable } from 'rxjs';

export function fromSSE<T>(url: string): Observable<T> {
  return new Observable<T>((sub) => {
    const es = new EventSource(url, { withCredentials: true });
    es.onmessage = (e) => sub.next(JSON.parse(e.data) as T);
    es.onerror = (e) => sub.error(e);
    return () => es.close();
  });
}
```

### 3. Polling with `rxResource` driven by a signal param

```ts
// libs/orders/src/lib/orders.store.ts
import { Injectable, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { HttpClient, inject } from '@angular/common/http';
import { interval, switchMap, startWith } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class OrdersStore {
  private http = inject(HttpClient);
  readonly customerId = signal<string | null>(null);

  readonly orders = rxResource({
    params: () => this.customerId(),
    stream: ({ params: id }) =>
      interval(5_000).pipe(
        startWith(0),
        switchMap(() => this.http.get<Order[]>(`/api/customers/${id}/orders`)),
      ),
  });
}
```

### 4. SignalStore + Events Plugin for a presence feed

```ts
// libs/presence/src/lib/presence.store.ts
import { signalStore, withState, withMethods, withHooks, patchState } from '@ngrx/signals';
import { withEventHandlers, eventGroup, injectDispatcher } from '@ngrx/signals/events';
import { inject } from '@angular/core';
import { TickerService } from '@app/realtime';

const presenceEvents = eventGroup({
  source: 'Presence',
  events: {
    userJoined: type<{ id: string; name: string }>(),
    userLeft: type<{ id: string }>(),
    connectionLost: type<void>(),
  },
});

export const PresenceStore = signalStore(
  { providedIn: 'root' },
  withState({ users: {} as Record<string, { id: string; name: string }>, online: false }),
  withEventHandlers(presenceEvents, {
    userJoined: ({ payload }, store) =>
      patchState(store, (s) => ({ users: { ...s.users, [payload.id]: payload } })),
    userLeft: ({ payload }, store) =>
      patchState(store, (s) => {
        const { [payload.id]: _, ...rest } = s.users;
        return { users: rest };
      }),
    connectionLost: (_e, store) => patchState(store, { online: false }),
  }),
  withHooks({
    onInit(store) {
      const dispatcher = injectDispatcher();
      const ticker = inject(TickerService);
      // bridge raw stream to events; cleaned up via DestroyRef under the hood
      ticker.events$.subscribe((evt) => dispatcher.dispatch(evt));
    },
  }),
);
```

### 5. NgRx Classic effect for a websocket

```ts
// libs/chat/src/lib/chat.effects.ts
import { inject } from '@angular/core';
import { Actions, createEffect } from '@ngrx/effects';
import { webSocket } from 'rxjs/webSocket';
import { map, retry, timer } from 'rxjs';
import { ChatActions } from './chat.actions';

export const chatSocket$ = createEffect(
  () => webSocket<ChatMessage>('wss://api/chat').pipe(
    retry({ delay: (_e, n) => timer(Math.min(30_000, 2 ** n * 500)) }),
    map((msg) => ChatActions.messageReceived({ msg })),
  ),
  { functional: true, dispatch: true },
);
```

### 6. Coalescing high-frequency updates

```ts
// auditTime keeps UI responsive without dropping the latest value
ticker.events$.pipe(auditTime(50)).subscribe((tick) => store.apply(tick));
```

## Breaking Changes and Gotchas

- **`withEffects` -> `withEventHandlers`** in NgRx v21. Migration schematic available. Use the new name in all examples.
- **Angular 21 is zoneless by default.** Do NOT wrap socket callbacks in `NgZone.run`. Signals/`patchState` re-render correctly.
- **`httpResource` is experimental in 21.0.0** — flag with the standard callout if used.
- **EventSource bypasses `HttpClient` interceptors.** Auth headers via interceptors will not run; pass tokens via cookies or query string, or use an HttpClient-backed shim.
- **Browser WebSocket API has no header support.** Use subprotocol or token-in-URL (mind logging).
- **SSR**: `WebSocket`/`EventSource` are undefined on Node. Initialize inside `afterNextRender` or guard with `isPlatformBrowser`.
- **Memory leaks**: forgetting to close sockets when a SignalStore is `providedIn: 'root'` keeps the connection alive forever. Use `withHooks({ onDestroy })` for non-root stores; for root stores, accept that they live for the app lifetime and only open when needed.
- **Reconnect storms**: many tabs reconnecting at once after a server blip. Add jitter to backoff.
- **Out-of-order events** with `switchMap` will cancel in-flight; use `mergeMap`/`concatMap` for streams that must arrive in order.
- **`rxResource` re-runs** on every param signal change — be careful when params include frequently-changing signals; debounce them.

## Sources

- [SignalStore guide (ngrx.io)](https://ngrx.io/guide/signals/signal-store)
- [NgRx Signals overview](https://ngrx.io/guide/signals)
- [Announcing NgRx 21 (DEV)](https://dev.to/ngrx/announcing-ngrx-21-celebrating-a-10-year-journey-with-a-fresh-new-look-and-ngrxsignalsevents-5ekp)
- [NgRx SignalStore Events Plugin (Arcadio Quintero)](https://arcadioquintero.com/en/blog/ngrx-signalstore-events-plugin/)
- [Angular 21 Real-Time Datatables with Signals](https://medium.com/@ramsatt/angular-21-the-ultimate-guide-to-building-real-time-datatables-with-signals-web-apis-1c217564e1b9)
- [Angular 21 Zoneless](https://www.pkgpulse.com/blog/angular-21-zoneless-zone-js-performance-2026)
- [WebSockets in Angular (AngularGems)](https://angulargems.beehiiv.com/p/web-sockets-in-angular)
- [Real-Time in Angular: WebSocket and RxJS (iJS)](https://javascript-conference.com/blog/real-time-in-angular-a-journey-into-websocket-and-rxjs/)
- [Implementing SSE in Angular (Koliaka)](https://medium.com/@andrewkoliaka/implementing-server-sent-events-in-angular-a5e40617cb78)
- [Subscribing to SSE with Angular (DEV)](https://dev.to/icolomina/subscribing-to-server-sent-events-with-angular-ee8)
- [ngx-sse-client](https://www.npmjs.com/package/ngx-sse-client)

## Open Questions

- Confirm `rxResource` final signature (`params`/`stream` vs older `request`/`loader`) against installed `@angular/core` 21.x before code samples ship.
- Verify exact `eventGroup`/`withEventHandlers` import path in `@ngrx/signals/events` against installed `@ngrx/signals` 21.1.0.
- Decide whether to demo `httpResource` polling here or defer entirely to Ch 29 (Caching) to avoid duplicating the experimental callout.
