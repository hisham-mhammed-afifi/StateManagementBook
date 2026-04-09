# Research: Cross-MFE Communication

**Date:** 2026-04-09
**Chapter:** Ch 36
**Status:** Ready for chapter generation

## API Surface

### Browser Native APIs

#### CustomEvent
- **Import:** None (global browser API)
- **Constructor:** `new CustomEvent<T>(type: string, eventInit?: CustomEventInit<T>)`
  - `eventInit.detail: T` -- payload data
  - `eventInit.bubbles?: boolean` -- whether event bubbles (default: false)
  - `eventInit.composed?: boolean` -- whether event crosses shadow DOM boundary (default: false)
  - `eventInit.cancelable?: boolean` -- whether event is cancelable (default: false)
- **Dispatch:** `window.dispatchEvent(event: Event): boolean`
- **Subscribe:** `window.addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions): void`
- **Type Safety:** Extend `WindowEventMap` interface for typed listeners
- **Stability:** Stable (Web Platform standard, supported in all modern browsers)

#### BroadcastChannel
- **Import:** None (global browser API)
- **Constructor:** `new BroadcastChannel(channelName: string)`
- **Methods:**
  - `postMessage(message: any): void` -- sends message to all other contexts on same channel
  - `close(): void` -- disconnects from channel
- **Events:**
  - `onmessage: (event: MessageEvent) => void`
  - `onmessageerror: (event: MessageEvent) => void`
- **Constraint:** Same-origin only. Payloads must be structured-cloneable (no functions, DOM nodes, class instances with methods).
- **Stability:** Stable (Web Platform standard, supported in all modern browsers except IE11)

#### window.postMessage
- **Signature:** `targetWindow.postMessage(message: any, targetOrigin: string, transfer?: Transferable[])`
- **Signature (modern):** `targetWindow.postMessage(message: any, options?: WindowPostMessageOptions)`
  - `options.targetOrigin: string` -- required for security
  - `options.transfer?: Transferable[]` -- zero-copy transfer of ArrayBuffer/MessagePort
- **Subscribe:** `window.addEventListener('message', (event: MessageEvent) => { ... })`
  - `event.origin: string` -- origin of sender (MUST verify)
  - `event.source: WindowProxy` -- reference to sender window
  - `event.data: any` -- the message payload
- **Security:** Always verify `event.origin`. Never use `'*'` as targetOrigin in production.
- **Stability:** Stable (Web Platform standard)

### Angular APIs

#### Signal (used in cross-MFE services)
- **Import:** `import { signal, computed, effect } from '@angular/core'`
- **Factory:** `signal<T>(initialValue: T, options?: SignalOptions<T>): WritableSignal<T>`
- **Stability:** Stable in Angular 21

#### DestroyRef (for cleanup)
- **Import:** `import { DestroyRef, inject } from '@angular/core'`
- **Usage:** `inject(DestroyRef).onDestroy(() => { /* cleanup */ })`
- **Stability:** Stable in Angular 21

### NgRx 21 Scoped Events (covered in Ch 35, referenced here)
- **Import:** `import { eventGroup, withReducer, on, withEventHandlers } from '@ngrx/signals/events'`
- **Import:** `import { injectDispatch } from '@ngrx/signals/events'`
- **Scoping:** `injectDispatch(EventGroup, { scope: 'global' | 'parent' | 'self' })`
- **Stability:** Stable in NgRx 21

### Module Federation Runtime
- **Import:** `import { registerRemotes, loadRemote, preloadRemote } from '@module-federation/enhanced/runtime'`
- **registerRemotes:** `registerRemotes(remotes: RemoteInfo[], options?: { force?: boolean })`
- **loadRemote:** `loadRemote<T>(id: string): Promise<T | undefined>`
- **Stability:** Stable (v2.3.x)

## Key Concepts

### Communication Patterns (six total, from simplest to most complex)

1. **Custom Events (window.dispatchEvent / CustomEvent)**
   - Framework-agnostic, zero dependencies, fire-and-forget
   - Best for: UI triggers, notifications, telemetry signals
   - No replay, no persistence, limited debugging

2. **BroadcastChannel API**
   - Cross-tab, cross-iframe, cross-worker communication within same origin
   - Best for: Multi-tab sync (logout, cart, session), worker coordination
   - Same-origin only, serializable payloads only

3. **Shared Singleton Services via Module Federation**
   - Angular DI with `providedIn: 'root'` + MF `singleton: true`
   - Best for: All-Angular platforms with same Angular version
   - Tightest coupling, simplest to implement

4. **Typed Message Bus (RxJS Subject-based pub/sub)**
   - Custom event bus service distributed as shared singleton
   - Supports replay, buffering, typed topics, middleware
   - Best for: Complex cross-MFE workflows with type safety

5. **NgRx Scoped Events (covered in Ch 35)**
   - `scope: 'global'` for cross-MFE events
   - Best for: NgRx-based platforms needing structured event-driven communication

6. **window.postMessage**
   - Cross-origin communication for iframe-based MFEs
   - Best for: Iframe integration, legacy system communication, multi-origin setups

### Design Principles

- **Minimize cross-MFE communication.** If two MFEs exchange state frequently, consider merging them.
- **Contract-first design.** Define message schemas/interfaces in shared libraries before implementing producers/consumers.
- **Version payloads.** Include a `version` field in event payloads for gradual schema evolution.
- **Design for resilience.** MFE dependencies may be unavailable; communication should degrade gracefully.
- **Prefer loose coupling.** Custom events and message bus > shared services > shared stores.

### Chapter 35 vs Chapter 36 Boundary

**Chapter 35 already covers:**
- Shared state spectrum (global / cross-feature / feature)
- Singleton stores via DI (CartStore example)
- Anti-Corruption Layer pattern (InjectionToken contracts)
- NgRx scoped events (global/parent/self)
- Combined EventBusService (Subject + BroadcastChannel)
- Webpack shared config checklist

**Chapter 36 must focus on:**
- Deep dive into CustomEvent API with full Angular wrapper service
- BroadcastChannel deep dive with zoneless Angular 21 considerations
- Full typed message bus with topics, replay, dead letters, middleware
- window.postMessage for iframe-based MFE scenarios
- Framework-agnostic communication (Angular + React/Vue coexistence)
- Testing cross-MFE communication patterns
- Debugging and observability (logging middleware, DevTools integration)
- Decision matrix: when to use which communication pattern

## Code Patterns

### Pattern 1: Typed Custom Events with Angular Service

```typescript
// libs/shared/util-events/src/lib/mfe-events.ts
// Type-safe event map extending WindowEventMap
export interface MfeEventMap {
  'cart:item-added': CustomEvent<{ productId: number; quantity: number }>;
  'cart:cleared': CustomEvent<void>;
  'user:authenticated': CustomEvent<{ userId: number; roles: string[] }>;
  'user:logged-out': CustomEvent<void>;
  'navigation:requested': CustomEvent<{ path: string; params?: Record<string, string> }>;
}

declare global {
  interface WindowEventMap extends MfeEventMap {}
}
```

```typescript
// libs/shared/util-events/src/lib/event-dispatcher.service.ts
import { Injectable, DestroyRef, inject } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class EventDispatcherService {
  private readonly destroyRef = inject(DestroyRef);

  dispatch<K extends keyof MfeEventMap>(
    type: K,
    detail: MfeEventMap[K] extends CustomEvent<infer D> ? D : never
  ): void {
    window.dispatchEvent(new CustomEvent(type, { detail }));
  }

  on<K extends keyof MfeEventMap>(
    type: K,
    handler: (event: MfeEventMap[K]) => void
  ): void {
    const listener = handler as EventListener;
    window.addEventListener(type, listener);
    this.destroyRef.onDestroy(() => window.removeEventListener(type, listener));
  }
}
```

### Pattern 2: BroadcastChannel Service for Cross-Tab Sync

```typescript
// libs/shared/util-broadcast/src/lib/broadcast.service.ts
import { Injectable, signal, DestroyRef, inject } from '@angular/core';

export interface BroadcastMessage<T = unknown> {
  type: string;
  payload: T;
  source: string;
  timestamp: number;
  version: number;
}

@Injectable({ providedIn: 'root' })
export class BroadcastService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly channel = new BroadcastChannel('mfe-platform');
  private readonly sourceId = crypto.randomUUID();

  readonly lastMessage = signal<BroadcastMessage | null>(null);

  constructor() {
    this.channel.onmessage = (event: MessageEvent<BroadcastMessage>) => {
      this.lastMessage.set(event.data);
    };

    this.destroyRef.onDestroy(() => this.channel.close());
  }

  send<T>(type: string, payload: T): void {
    const message: BroadcastMessage<T> = {
      type,
      payload,
      source: this.sourceId,
      timestamp: Date.now(),
      version: 1,
    };
    this.channel.postMessage(message);
  }
}
```

### Pattern 3: Typed Message Bus with Topics and Replay

```typescript
// libs/shared/util-message-bus/src/lib/message-bus.service.ts
import { Injectable, DestroyRef, inject } from '@angular/core';
import { Subject, ReplaySubject, Observable, filter, map } from 'rxjs';

export interface BusMessage<T = unknown> {
  topic: string;
  payload: T;
  correlationId?: string;
  timestamp: number;
}

@Injectable({ providedIn: 'root' })
export class MessageBusService {
  private readonly subjects = new Map<string, Subject<BusMessage>>();
  private readonly history: BusMessage[] = [];
  private readonly maxHistory = 100;

  publish<T>(topic: string, payload: T, correlationId?: string): void {
    const message: BusMessage<T> = {
      topic,
      payload,
      correlationId,
      timestamp: Date.now(),
    };
    this.history.push(message);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
    this.getOrCreateSubject(topic).next(message);
  }

  subscribe<T>(topic: string): Observable<BusMessage<T>> {
    return this.getOrCreateSubject(topic).asObservable() as Observable<BusMessage<T>>;
  }

  replayLast(topic: string, count = 1): BusMessage[] {
    return this.history
      .filter((m) => m.topic === topic)
      .slice(-count);
  }

  private getOrCreateSubject(topic: string): Subject<BusMessage> {
    let subject = this.subjects.get(topic);
    if (!subject) {
      subject = new Subject<BusMessage>();
      this.subjects.set(topic, subject);
    }
    return subject;
  }
}
```

### Pattern 4: Iframe postMessage Communication

```typescript
// libs/shared/util-iframe/src/lib/iframe-bridge.service.ts
import { Injectable, DestroyRef, inject, signal } from '@angular/core';

export interface IframeMessage<T = unknown> {
  type: string;
  payload: T;
  source: string;
}

@Injectable({ providedIn: 'root' })
export class IframeBridgeService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly allowedOrigins: Set<string>;
  readonly lastMessage = signal<IframeMessage | null>(null);

  constructor() {
    this.allowedOrigins = new Set(
      (window as any).__MFE_ALLOWED_ORIGINS__ ?? []
    );
    const handler = this.handleMessage.bind(this);
    window.addEventListener('message', handler);
    this.destroyRef.onDestroy(() => window.removeEventListener('message', handler));
  }

  sendToParent<T>(type: string, payload: T, targetOrigin: string): void {
    if (!window.parent || window.parent === window) return;
    const message: IframeMessage<T> = { type, payload, source: 'child' };
    window.parent.postMessage(message, targetOrigin);
  }

  sendToIframe<T>(iframe: HTMLIFrameElement, type: string, payload: T, targetOrigin: string): void {
    if (!iframe.contentWindow) return;
    const message: IframeMessage<T> = { type, payload, source: 'parent' };
    iframe.contentWindow.postMessage(message, targetOrigin);
  }

  private handleMessage(event: MessageEvent): void {
    if (!this.allowedOrigins.has(event.origin)) return;
    if (!this.isIframeMessage(event.data)) return;
    this.lastMessage.set(event.data);
  }

  private isIframeMessage(data: unknown): data is IframeMessage {
    return (
      typeof data === 'object' &&
      data !== null &&
      'type' in data &&
      'payload' in data &&
      'source' in data
    );
  }
}
```

### Pattern 5: Framework-Agnostic Communication Contract

```typescript
// libs/shared/util-events/src/lib/mfe-contract.ts
// Published as a plain TypeScript package, no Angular dependency

export interface MfeCommunicationContract {
  dispatch(topic: string, payload: unknown): void;
  subscribe(topic: string, handler: (payload: unknown) => void): () => void;
}

// Window-level registry for framework-agnostic discovery
declare global {
  interface Window {
    __MFE_BUS__?: MfeCommunicationContract;
  }
}

export function getMfeBus(): MfeCommunicationContract {
  if (!window.__MFE_BUS__) {
    throw new Error('MFE communication bus not initialized. Shell must register it first.');
  }
  return window.__MFE_BUS__;
}

export function registerMfeBus(bus: MfeCommunicationContract): void {
  window.__MFE_BUS__ = bus;
}
```

### Pattern 6: Logging Middleware for Debugging

```typescript
// libs/shared/util-message-bus/src/lib/logging-middleware.ts
import { BusMessage, MessageBusService } from './message-bus.service';

export function withLogging(bus: MessageBusService): MessageBusService {
  const originalPublish = bus.publish.bind(bus);
  bus.publish = <T>(topic: string, payload: T, correlationId?: string) => {
    console.groupCollapsed(`[MFE Bus] ${topic}`);
    console.log('Payload:', payload);
    if (correlationId) console.log('Correlation:', correlationId);
    console.log('Time:', new Date().toISOString());
    console.groupEnd();
    originalPublish(topic, payload, correlationId);
  };
  return bus;
}
```

## Breaking Changes and Gotchas

### Module Federation Shared Config

- **Secondary entry points must be shared explicitly.** `@ngrx/signals` does NOT automatically share `@ngrx/signals/events` or `@ngrx/signals/entities`. Each is a separate webpack chunk. Missing this creates duplicate instances and broken state.
- **`eager: true` anti-pattern.** Never use `eager: true` for shared dependencies. It bloats `remoteEntry.js` and prevents version negotiation at runtime.
- **Transitive dependencies.** If library A depends on library B, both must appear in the `shared` config. Otherwise each consumer gets its own B instance.

### NgRx v21 Rename

- `withEffects()` renamed to `withEventHandlers()` in NgRx v21. Migration schematics available.
- Chapter 35 already covers NgRx scoped events. Chapter 36 references them but focuses on non-NgRx patterns.

### Angular 21 Zoneless Considerations

- Angular 21 is zoneless by default. BroadcastChannel and postMessage callbacks execute outside the Angular rendering cycle.
- With signals, this is largely a non-issue: setting a signal value triggers change detection regardless of zone context.
- With RxJS subscriptions updating component state: either use `toSignal()` to bridge to signals, or ensure the subscription's values flow through `AsyncPipe` (which handles scheduling internally).

### CustomEvent Gotchas

- `CustomEvent.detail` is readonly after construction. Cannot modify payload after dispatch.
- Events dispatched on `window` do not bubble by default. Set `bubbles: true` only if needed for shadow DOM scenarios.
- `detail` must be structured-cloneable if the event crosses context boundaries (workers, iframes).

### BroadcastChannel Gotchas

- Same-origin policy: channels cannot cross origins. For cross-origin MFEs, use `postMessage`.
- The sender does NOT receive its own message. Only other contexts on the same channel receive it.
- Channel name collisions: use a namespace prefix (e.g., `mfe-platform:cart`) to avoid conflicts with third-party scripts.
- Closing a channel (`channel.close()`) is permanent for that instance. Create a new instance to reconnect.

### postMessage Security

- Always verify `event.origin` before processing messages. Omitting this check is an XSS vector.
- Never use `'*'` as the target origin in production. Specify the exact origin.
- Payloads can be any structured-cloneable type but class instances lose their prototype chain.

### Common StackOverflow Issues

1. **"Custom events not received in Angular component"** -- Usually caused by subscribing after the event was dispatched (no replay). Solution: use a ReplaySubject-backed bus or ensure subscription order.
2. **"BroadcastChannel messages not triggering UI update"** -- In zone-based Angular, BC callbacks run outside NgZone. In zoneless Angular 21 with signals, this is resolved automatically.
3. **"Shared service has different state in remote"** -- Missing `singleton: true` in Module Federation config, or secondary entry point not shared.
4. **"postMessage origin check fails in dev"** -- Different ports count as different origins (localhost:4200 !== localhost:4201). Add all dev origins to the allow list.

## Sources

### Official Documentation
- [CustomEvent - MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent/CustomEvent)
- [BroadcastChannel - MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel)
- [Window.postMessage - MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)
- [Module Federation Runtime API](https://module-federation.io/guide/runtime/runtime-api)
- [Angular Signals - angular.dev](https://angular.dev/guide/signals)
- [NgRx SignalStore Events Plugin - ngrx.io](https://ngrx.io/guide/signals/signal-store/events-plugin)

### Blog Posts and Articles
- [Communication Patterns in Microfrontends with Webpack Module Federation (Medium)](https://medium.com/@mfflik/communication-patterns-in-microfrontends-with-webpack-module-federation-shared-store-event-bus-ae2a1ed031a6)
- [Cross Micro Frontends Communication - iFood Engineering (Medium)](https://medium.com/ifood-engineering/cross-micro-frontends-communication-dbca37802b60)
- [Cross Micro Frontends Communication - DEV Community](https://dev.to/luistak/cross-micro-frontends-communication-30m3)
- [Pitfalls with Module Federation and Angular - Angular Architects](https://www.angulararchitects.io/en/blog/pitfalls-with-module-federation-and-angular/)
- [Mastering Cross-Tab Communication in Angular with BroadcastChannel API (Medium)](https://medium.com/@md.mollaie/mastering-cross-tab-communication-in-angular-with-broadcastchannel-api-0e15ccef75bf)
- [Micro Frontends Architecture with Module Federation 2025 (Elysiate)](https://www.elysiate.com/blog/micro-frontends-architecture-module-federation-2025)
- [Optimal Communication Between Microfrontends (HackerNoon)](https://hackernoon.com/optimal-communication-between-microfrontends-and-cross-microfrontend-optimization)
- [Sharing Data Between Micro Frontends in Angular (Devonblog)](https://devonblog.com/software-development/sharing-data-between-micro-frontends-in-angular/)
- [Solving Micro-Frontend Challenges with Module Federation (LogRocket)](https://blog.logrocket.com/solving-micro-frontend-challenges-module-federation/)
- [Multi-Framework MFEs: The Good, the Bad, the Ugly - Angular Architects](https://www.angulararchitects.io/en/blog/multi-framework-and-version-micro-frontends-with-module-federation-the-good-the-bad-the-ugly/)
- [Free eBook: Micro Frontends and Moduliths with Angular - Angular Architects](https://www.angulararchitects.io/en/ebooks/micro-frontends-and-moduliths-with-angular/)

### GitHub Issues and Examples
- [NgRx Store Sharing - module-federation-plugin Issue #11](https://github.com/angular-architects/module-federation-plugin/issues/11)
- [Multi-version Angular MFEs - module-federation-plugin Issue #522](https://github.com/angular-architects/module-federation-plugin/issues/522)
- [Singleton Service Across MFEs - module-federation-examples Issue #3100](https://github.com/module-federation/module-federation-examples/issues/3100)
- [State Management in Module Federation Examples (DeepWiki)](https://deepwiki.com/module-federation/module-federation-examples/3.3-state-management)

### npm Packages
- [@module-federation/enhanced v2.3.x](https://www.npmjs.com/package/@module-federation/enhanced)

## Existing Platform Code Reference

The mfe-platform project at `d:\mfe-platform` provides working examples:

- **Shell dynamic remote loading:** `apps/shell/src/main.ts` uses `registerRemotes()` + manifest
- **Route-based remote loading:** `apps/shell/src/app/app.routes.ts` uses `loadRemote()`
- **Shared auth service:** `libs/shared/data-access-auth/src/lib/auth.service.ts` -- singleton signal-based service
- **Shared models:** `libs/shared/models/src/lib/` -- Product and User interfaces
- **No event bus/message bus currently implemented** -- Chapter 36 will introduce these patterns

## Open Questions

1. **NgRx Scoped Events cross-tab support:** NgRx scoped events work within a single browser tab (shared injector). Verify whether `scope: 'global'` events propagate across tabs or only across MFEs within the same tab. Most likely same-tab only, requiring BroadcastChannel for cross-tab scenarios.

2. **@module-federation/enhanced runtime plugins for communication:** The runtime plugin system supports lifecycle hooks (`beforeInit`, `beforeLoadShare`). Investigate whether custom plugins can intercept and relay state between remotes at load time. Likely possible but undocumented for this use case.

3. **Signal reactivity across MFE boundaries:** When a shared signal-based service updates its value in the shell, do remote components automatically re-render? Should work if the Angular injector and `@angular/core` package are shared as singletons, but worth verifying with a concrete test.

4. **Structured clone limitations:** Verify exactly which types fail structured clone in modern browsers (2026). Functions, DOM nodes, and Error objects are known failures. Class instances lose their prototype but properties survive. This matters for BroadcastChannel and postMessage payloads.
