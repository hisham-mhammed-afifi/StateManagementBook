# Chapter 36: Cross-MFE Communication

Your platform has grown. The Products MFE adds items to the cart. The Orders MFE processes checkout. The Notifications MFE shows toast messages when an order ships. A newly acquired subsidiary runs its loyalty-points widget in React, embedded via an iframe. The user logs out in one browser tab and expects every tab to reflect the change immediately. These five scenarios span five different communication boundaries: same-injector, same-window, same-origin-cross-tab, cross-origin-cross-frame, and cross-framework. No single mechanism handles all of them. This chapter gives you a concrete tool for each.

Chapter 35 established the *what* of cross-MFE state: singleton stores for global state, anti-corruption layers for cross-feature state, and NgRx scoped events for typed, DevTools-integrated coordination. This chapter focuses on the *how*: the transport mechanisms that carry messages between micro-frontends. We will build four communication services, each targeting a different boundary, then wire them together behind a unified facade. Along the way, we will add type safety, automatic cleanup, logging middleware for debugging, and a decision framework for choosing the right tool.

## Custom Events: Same-Window, Framework-Agnostic Messaging

The browser's `CustomEvent` API is the simplest cross-MFE communication mechanism. Any script on the page can dispatch an event on `window`, and any other script can listen for it. No shared Angular injector is required, no RxJS dependency exists, and no framework coupling is introduced.

The raw API is untyped. `window.addEventListener('cart:item-added', handler)` gives the handler a plain `Event` object with no type information about the payload. We fix this by extending the global `WindowEventMap` interface, which TypeScript uses to infer event types for `addEventListener`.

### Defining the Event Map

```typescript
// libs/shared/util-mfe-events/src/lib/custom-event-map.ts
export interface MfeCustomEventMap {
  'cart:item-added': CustomEvent<{ productId: number; title: string; price: number }>;
  'cart:item-removed': CustomEvent<{ productId: number }>;
  'cart:cleared': CustomEvent<void>;
  'navigation:requested': CustomEvent<{ path: string; queryParams?: Record<string, string> }>;
  'notification:show': CustomEvent<{ severity: 'info' | 'warn' | 'error'; message: string }>;
}

declare global {
  interface WindowEventMap extends MfeCustomEventMap {}
}
```

With this declaration in place, every `addEventListener` call for these event names gets full type inference. The declaration lives in a shared Nx library that any MFE can import. It contains zero runtime code, only types.

### Building the Angular Wrapper Service

```typescript
// libs/shared/util-mfe-events/src/lib/custom-event.service.ts
import { Injectable, DestroyRef, inject } from '@angular/core';
import type { MfeCustomEventMap } from './custom-event-map';

type EventPayload<K extends keyof MfeCustomEventMap> =
  MfeCustomEventMap[K] extends CustomEvent<infer D> ? D : never;

@Injectable({ providedIn: 'root' })
export class CustomEventService {
  private readonly destroyRef = inject(DestroyRef);

  dispatch<K extends keyof MfeCustomEventMap>(type: K, detail: EventPayload<K>): void {
    window.dispatchEvent(new CustomEvent(type, { detail }));
  }

  listen<K extends keyof MfeCustomEventMap>(
    type: K,
    handler: (payload: EventPayload<K>) => void
  ): void {
    const listener = ((event: MfeCustomEventMap[K]) => {
      handler((event as CustomEvent).detail);
    }) as EventListener;
    window.addEventListener(type, listener);
    this.destroyRef.onDestroy(() => window.removeEventListener(type, listener));
  }
}
```

The service does three things: it wraps dispatch in a typed method so you cannot pass an invalid payload, it unwraps `event.detail` automatically so the handler receives the payload directly, and it ties the listener's lifecycle to Angular's `DestroyRef` so listeners are removed when the component or service that registered them is destroyed.

### Using Custom Events Between MFEs

The Products MFE dispatches when the user adds an item:

```typescript
// libs/products/feature/src/lib/product-card.component.ts
import { Component, inject, input } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { CustomEventService } from '@mfe-platform/shared-util-mfe-events';

@Component({
  selector: 'lib-product-card',
  standalone: true,
  imports: [CurrencyPipe],
  template: `
    <div class="product-card">
      <h3>{{ product().title }}</h3>
      <p>{{ product().price | currency }}</p>
      <button (click)="addToCart()">Add to Cart</button>
    </div>
  `,
})
export class ProductCardComponent {
  product = input.required<{ productId: number; title: string; price: number }>();

  private readonly events = inject(CustomEventService);

  addToCart(): void {
    this.events.dispatch('cart:item-added', this.product());
  }
}
```

The shell's notification component listens:

```typescript
// apps/shell/src/app/notification-toast.component.ts
import { Component, inject, signal } from '@angular/core';
import { CustomEventService } from '@mfe-platform/shared-util-mfe-events';

@Component({
  selector: 'app-notification-toast',
  standalone: true,
  template: `
    @if (message()) {
      <div class="toast" [class]="severity()">
        {{ message() }}
      </div>
    }
  `,
})
export class NotificationToastComponent {
  protected readonly message = signal('');
  protected readonly severity = signal<'info' | 'warn' | 'error'>('info');

  private readonly events = inject(CustomEventService);

  constructor() {
    this.events.listen('notification:show', (payload) => {
      this.severity.set(payload.severity);
      this.message.set(payload.message);
    });
  }
}
```

Setting a signal inside the listener callback works seamlessly in zoneless Angular 21. Signal writes trigger change detection regardless of where the write originates. No `NgZone.run()` is needed.

### Limitations of Custom Events

Custom events are fire-and-forget. If a component starts listening after the event was dispatched, it will never receive it. There is no replay mechanism. Custom events also provide no delivery guarantee: if no listener is registered, the event is silently dropped. For state synchronization where latecomers need the current value, use a shared store or a message bus with replay instead.

## BroadcastChannel: Cross-Tab Communication

Custom events only reach listeners within the same `window` object. When the user opens your platform in two browser tabs, a logout in one tab does not automatically log out the other. The `BroadcastChannel` API solves this. It creates a named channel that spans all browsing contexts (tabs, iframes, web workers) within the same origin.

A critical behavior to understand: the sender does not receive its own message. `BroadcastChannel` delivers to all *other* contexts on the channel. To handle both local and cross-tab delivery, we combine `BroadcastChannel` with a local signal.

### Building the Broadcast Service

```typescript
// libs/shared/util-broadcast/src/lib/broadcast.service.ts
import { Injectable, DestroyRef, inject, signal, computed } from '@angular/core';

export interface BroadcastEnvelope<T = unknown> {
  type: string;
  payload: T;
  sourceTabId: string;
  timestamp: number;
  version: 1;
}

@Injectable({ providedIn: 'root' })
export class BroadcastService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly channel = new BroadcastChannel('mfe-platform');
  private readonly tabId = crypto.randomUUID();
  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();

  constructor() {
    this.channel.onmessage = (event: MessageEvent<BroadcastEnvelope>) => {
      this.invokeHandlers(event.data.type, event.data.payload);
    };

    this.destroyRef.onDestroy(() => this.channel.close());
  }

  send<T>(type: string, payload: T): void {
    const envelope: BroadcastEnvelope<T> = {
      type,
      payload,
      sourceTabId: this.tabId,
      timestamp: Date.now(),
      version: 1,
    };
    this.channel.postMessage(envelope);
    this.invokeHandlers(type, payload);
  }

  on<T>(type: string, handler: (payload: T) => void): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    const handlerSet = this.handlers.get(type)!;
    const wrappedHandler = handler as (payload: unknown) => void;
    handlerSet.add(wrappedHandler);

    const unsubscribe = () => handlerSet.delete(wrappedHandler);
    this.destroyRef.onDestroy(unsubscribe);
    return unsubscribe;
  }

  private invokeHandlers(type: string, payload: unknown): void {
    const handlerSet = this.handlers.get(type);
    if (handlerSet) {
      handlerSet.forEach((handler) => handler(payload));
    }
  }
}
```

The `send` method does two things: it posts the message to other tabs via the channel, and it invokes local handlers directly. This means a single `on` registration receives events from both the current tab and remote tabs.

### Cross-Tab Session Synchronization

A practical use case: synchronizing logout across tabs. When the user logs out in one tab, every other tab should redirect to the login page.

```typescript
// libs/shared/data-access-auth/src/lib/auth-sync.service.ts
import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { BroadcastService } from '@mfe-platform/shared-util-broadcast';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class AuthSyncService {
  private readonly broadcast = inject(BroadcastService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  initialize(): void {
    this.broadcast.on<void>('auth:logged-out', () => {
      this.auth.clearSession();
      this.router.navigateByUrl('/login');
    });
  }

  broadcastLogout(): void {
    this.auth.clearSession();
    this.broadcast.send('auth:logged-out', undefined);
    this.router.navigateByUrl('/login');
  }
}
```

The shell calls `authSyncService.broadcastLogout()` instead of `authService.logout()` directly. The local tab navigates to login immediately. Every other tab on the same origin receives the broadcast and does the same.

### BroadcastChannel Constraints

`BroadcastChannel` enforces the same-origin policy. `localhost:4200` and `localhost:4201` are different origins. During development with Module Federation, all MFEs are served on different ports but loaded into the shell's origin via script injection, so the channel works. In production, if MFEs are served from different subdomains (`products.example.com` vs `orders.example.com`), the channel cannot reach across them. For cross-origin communication, use `postMessage`.

Payloads must be structured-cloneable. This means no functions, no DOM nodes, no class instances with methods. Plain objects, arrays, strings, numbers, booleans, `Date`, `Map`, `Set`, `ArrayBuffer`, and `Blob` are all valid. If you need to send a class instance, serialize it to a plain object first.

## PostMessage: Cross-Origin Iframe Communication

Some MFE architectures embed remotes in iframes rather than loading them into the same document via Module Federation. This happens when the remote is a legacy application, runs a different framework version, or must be origin-isolated for security. The `window.postMessage` API is the only way to communicate across origins between windows.

### Building the Iframe Bridge

```typescript
// libs/shared/util-iframe-bridge/src/lib/iframe-bridge.service.ts
import { Injectable, DestroyRef, inject, signal } from '@angular/core';

export interface IframeBridgeMessage<T = unknown> {
  channel: 'mfe-bridge';
  type: string;
  payload: T;
  sourceId: string;
}

@Injectable({ providedIn: 'root' })
export class IframeBridgeService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly allowedOrigins = signal<Set<string>>(new Set());
  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();
  private readonly instanceId = crypto.randomUUID();

  constructor() {
    const handler = this.handleMessage.bind(this);
    window.addEventListener('message', handler);
    this.destroyRef.onDestroy(() => window.removeEventListener('message', handler));
  }

  registerOrigin(origin: string): void {
    this.allowedOrigins.update((origins) => {
      const next = new Set(origins);
      next.add(origin);
      return next;
    });
  }

  sendToParent<T>(type: string, payload: T, targetOrigin: string): void {
    if (window.parent === window) return;
    const message: IframeBridgeMessage<T> = {
      channel: 'mfe-bridge',
      type,
      payload,
      sourceId: this.instanceId,
    };
    window.parent.postMessage(message, targetOrigin);
  }

  sendToIframe<T>(iframe: HTMLIFrameElement, type: string, payload: T, targetOrigin: string): void {
    if (!iframe.contentWindow) return;
    const message: IframeBridgeMessage<T> = {
      channel: 'mfe-bridge',
      type,
      payload,
      sourceId: this.instanceId,
    };
    iframe.contentWindow.postMessage(message, targetOrigin);
  }

  on<T>(type: string, handler: (payload: T) => void): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    const handlerSet = this.handlers.get(type)!;
    const wrappedHandler = handler as (payload: unknown) => void;
    handlerSet.add(wrappedHandler);

    const unsubscribe = () => handlerSet.delete(wrappedHandler);
    this.destroyRef.onDestroy(unsubscribe);
    return unsubscribe;
  }

  private handleMessage(event: MessageEvent): void {
    if (!this.allowedOrigins().has(event.origin)) return;
    if (!this.isValidMessage(event.data)) return;
    const handlerSet = this.handlers.get(event.data.type);
    if (handlerSet) {
      handlerSet.forEach((handler) => handler(event.data.payload));
    }
  }

  private isValidMessage(data: unknown): data is IframeBridgeMessage {
    return (
      typeof data === 'object' &&
      data !== null &&
      'channel' in data &&
      (data as IframeBridgeMessage).channel === 'mfe-bridge' &&
      'type' in data &&
      'payload' in data
    );
  }
}
```

Three security measures protect this service. First, `registerOrigin` maintains an explicit allow-list. Messages from unregistered origins are silently dropped. Second, the `channel: 'mfe-bridge'` field acts as a namespace discriminator, preventing the service from processing unrelated `postMessage` traffic from third-party scripts. Third, `sendToIframe` and `sendToParent` both require a `targetOrigin` parameter, ensuring the browser only delivers the message to the intended recipient.

### Embedding an Iframe-Based MFE

```typescript
// apps/shell/src/app/loyalty-widget-host.component.ts
import { Component, inject, viewChild, afterNextRender, ElementRef } from '@angular/core';
import { IframeBridgeService } from '@mfe-platform/shared-util-iframe-bridge';

@Component({
  selector: 'app-loyalty-widget-host',
  standalone: true,
  template: `
    <iframe
      #loyaltyFrame
      src="https://loyalty.partner.com/widget"
      sandbox="allow-scripts allow-same-origin"
      width="100%"
      height="300"
    ></iframe>
  `,
})
export class LoyaltyWidgetHostComponent {
  private readonly bridge = inject(IframeBridgeService);
  private readonly iframe = viewChild.required<ElementRef<HTMLIFrameElement>>('loyaltyFrame');

  constructor() {
    this.bridge.registerOrigin('https://loyalty.partner.com');

    this.bridge.on<{ points: number }>('loyalty:points-updated', (payload) => {
      console.log('User has', payload.points, 'loyalty points');
    });

    afterNextRender(() => {
      const frame = this.iframe().nativeElement;
      frame.addEventListener('load', () => {
        this.bridge.sendToIframe(
          frame,
          'auth:token',
          { userId: 42 },
          'https://loyalty.partner.com'
        );
      });
    });
  }
}
```

The `sandbox` attribute restricts the iframe's capabilities. `allow-scripts` permits JavaScript execution, and `allow-same-origin` lets the iframe access its own origin's storage and cookies. Never add `allow-top-navigation` unless you trust the embedded content completely.

## The Typed Message Bus: Topics, Replay, and Middleware

Custom events are fire-and-forget with no replay. BroadcastChannel handles cross-tab but not in-tab pub/sub elegantly. For complex in-app communication workflows where MFEs need typed topics, message history, and extensibility through middleware, a dedicated message bus is the right tool.

Chapter 35 introduced a minimal `EventBusService`. Here we build a production-grade version with topic isolation, replay support, correlation IDs for tracing, and pluggable middleware.

```typescript
// libs/shared/util-message-bus/src/lib/bus-message.ts
export interface BusMessage<T = unknown> {
  topic: string;
  payload: T;
  correlationId: string;
  timestamp: number;
}
```

```typescript
// libs/shared/util-message-bus/src/lib/bus-middleware.ts
import { BusMessage } from './bus-message';

export type BusMiddleware = (message: BusMessage, next: () => void) => void;
```

```typescript
// libs/shared/util-message-bus/src/lib/message-bus.service.ts
import { Injectable, DestroyRef, inject } from '@angular/core';
import { Subject, Observable, filter } from 'rxjs';
import { BusMessage } from './bus-message';
import { BusMiddleware } from './bus-middleware';

@Injectable({ providedIn: 'root' })
export class MessageBusService {
  private readonly stream$ = new Subject<BusMessage>();
  private readonly history: BusMessage[] = [];
  private readonly maxHistory = 200;
  private readonly middlewares: BusMiddleware[] = [];

  use(middleware: BusMiddleware): void {
    this.middlewares.push(middleware);
  }

  publish<T>(topic: string, payload: T, correlationId?: string): void {
    const message: BusMessage<T> = {
      topic,
      payload,
      correlationId: correlationId ?? crypto.randomUUID(),
      timestamp: Date.now(),
    };

    this.executeMiddleware(message, () => {
      this.history.push(message);
      if (this.history.length > this.maxHistory) {
        this.history.shift();
      }
      this.stream$.next(message);
    });
  }

  subscribe<T>(topic: string): Observable<BusMessage<T>> {
    return this.stream$.pipe(
      filter((msg): msg is BusMessage<T> => msg.topic === topic)
    );
  }

  replay(topic: string, count: number = 1): BusMessage[] {
    return this.history
      .filter((msg) => msg.topic === topic)
      .slice(-count);
  }

  private executeMiddleware(message: BusMessage, finalAction: () => void): void {
    const stack = [...this.middlewares];
    const run = (index: number): void => {
      if (index >= stack.length) {
        finalAction();
        return;
      }
      stack[index](message, () => run(index + 1));
    };
    run(0);
  }
}
```

### Logging Middleware

Debugging cross-MFE communication is notoriously difficult. Without visibility into what messages are flowing, bugs become guessing games. A logging middleware provides a complete audit trail.

```typescript
// libs/shared/util-message-bus/src/lib/logging.middleware.ts
import { BusMessage } from './bus-message';
import { BusMiddleware } from './bus-middleware';

export function createLoggingMiddleware(prefix: string = 'MFE Bus'): BusMiddleware {
  return (message: BusMessage, next: () => void) => {
    console.groupCollapsed(`[${prefix}] ${message.topic}`);
    console.log('Payload:', message.payload);
    console.log('Correlation ID:', message.correlationId);
    console.log('Timestamp:', new Date(message.timestamp).toISOString());
    console.groupEnd();
    next();
  };
}
```

### Validation Middleware

A validation middleware rejects messages with unknown topics during development, catching typos early:

```typescript
// libs/shared/util-message-bus/src/lib/validation.middleware.ts
import { BusMessage } from './bus-message';
import { BusMiddleware } from './bus-middleware';

export function createValidationMiddleware(allowedTopics: Set<string>): BusMiddleware {
  return (message: BusMessage, next: () => void) => {
    if (!allowedTopics.has(message.topic)) {
      console.error(
        `[MFE Bus] Unknown topic "${message.topic}". Allowed topics:`,
        Array.from(allowedTopics)
      );
      return;
    }
    next();
  };
}
```

### Wiring Up the Bus

Register middleware during application bootstrap:

```typescript
// apps/shell/src/app/app.config.ts
import { ApplicationConfig, inject, provideAppInitializer } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { MessageBusService } from '@mfe-platform/shared-util-message-bus';
import { createLoggingMiddleware } from '@mfe-platform/shared-util-message-bus';
import { createValidationMiddleware } from '@mfe-platform/shared-util-message-bus';
import { appRoutes } from './app.routes';

const ALLOWED_TOPICS = new Set([
  'cart:item-added',
  'cart:item-removed',
  'cart:cleared',
  'notification:show',
  'navigation:requested',
]);

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(appRoutes),
    provideHttpClient(),
    provideAppInitializer(() => {
      const bus = inject(MessageBusService);
      bus.use(createLoggingMiddleware());
      bus.use(createValidationMiddleware(ALLOWED_TOPICS));
    }),
  ],
};
```

### Consuming Messages with Signals

```typescript
// apps/shell/src/app/cart-count.component.ts
import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MessageBusService } from '@mfe-platform/shared-util-message-bus';
import { map, scan, startWith, merge } from 'rxjs';

@Component({
  selector: 'app-cart-count',
  standalone: true,
  template: `<span class="badge">{{ count() }}</span>`,
})
export class CartCountComponent {
  private readonly bus = inject(MessageBusService);

  protected readonly count = toSignal(
    merge(
      this.bus.subscribe<{ productId: number }>('cart:item-added').pipe(map(() => 1)),
      this.bus.subscribe<{ productId: number }>('cart:item-removed').pipe(map(() => -1)),
      this.bus.subscribe<void>('cart:cleared').pipe(map(() => -Infinity)),
    ).pipe(
      scan((total, delta) => (delta === -Infinity ? 0 : total + delta), 0),
      startWith(0),
    ),
    { initialValue: 0 }
  );
}
```

## Framework-Agnostic Communication

When Angular MFEs coexist with React or Vue micro-frontends on the same page, none of the Angular-specific patterns (DI, signals, NgRx) work across the framework boundary. The solution is a plain-TypeScript contract registered on `window`.

```typescript
// libs/shared/util-mfe-contract/src/lib/mfe-bus-contract.ts
export interface MfeBusContract {
  publish(topic: string, payload: unknown): void;
  subscribe(topic: string, handler: (payload: unknown) => void): () => void;
}

declare global {
  interface Window {
    __MFE_BUS__?: MfeBusContract;
  }
}

export function getMfeBus(): MfeBusContract {
  if (!window.__MFE_BUS__) {
    throw new Error('[MFE] Bus not initialized. The shell must call registerMfeBus() first.');
  }
  return window.__MFE_BUS__;
}

export function registerMfeBus(bus: MfeBusContract): void {
  window.__MFE_BUS__ = bus;
}
```

The shell registers the Angular `MessageBusService` as the global bus during bootstrap:

```typescript
// apps/shell/src/main.ts
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import { registerMfeBus } from '@mfe-platform/shared-util-mfe-contract';
import { inject } from '@angular/core';
import { MessageBusService } from '@mfe-platform/shared-util-message-bus';

bootstrapApplication(AppComponent, {
  ...appConfig,
  providers: [
    ...appConfig.providers,
    {
      provide: 'MFE_BUS_INIT',
      useFactory: () => {
        const bus = inject(MessageBusService);
        registerMfeBus({
          publish: (topic, payload) => bus.publish(topic, payload),
          subscribe: (topic, handler) => {
            const sub = bus.subscribe(topic).subscribe((msg) => handler(msg.payload));
            return () => sub.unsubscribe();
          },
        });
        return true;
      },
    },
  ],
});
```

A React MFE loaded via Module Federation (or an iframe) can now communicate without any Angular dependency:

```typescript
// Hypothetical React MFE code
import { getMfeBus } from '@mfe-platform/shared-util-mfe-contract';

const bus = getMfeBus();
const unsubscribe = bus.subscribe('cart:item-added', (payload) => {
  console.log('Item added from Angular MFE:', payload);
});

// Cleanup on unmount
return () => unsubscribe();
```

## Choosing the Right Mechanism

Each communication mechanism fits a different boundary. Use the narrowest scope that meets the requirement.

| Boundary | Mechanism | When to Use |
|---|---|---|
| Same injector, same Angular version | Shared singleton service or NgRx scoped events | All-Angular platforms with shared DI tree |
| Same window, different framework | Custom Events or `window.__MFE_BUS__` | Angular + React/Vue on the same page |
| Same origin, different tab | BroadcastChannel | Session sync, logout, cart sync across tabs |
| Different origin, iframe | `window.postMessage` | Iframe-embedded legacy apps, partner widgets |
| Complex workflows, need replay | Message Bus (RxJS Subject) | Multi-step processes, audit trails, middleware |

Start with the simplest mechanism. If two Angular MFEs share an injector, use a singleton service. Only reach for Custom Events or the message bus when DI-based sharing is not available. Only use `postMessage` when you must cross an origin boundary.

## Testing Cross-MFE Communication

Communication services are easy to unit test because they operate on plain data. No Angular test bed is needed for the core logic.

### Testing the Message Bus

```typescript
// libs/shared/util-message-bus/src/lib/message-bus.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { MessageBusService } from './message-bus.service';
import { BusMessage } from './bus-message';

describe('MessageBusService', () => {
  let bus: MessageBusService;

  beforeEach(() => {
    bus = TestBed.inject(MessageBusService);
  });

  it('delivers messages to topic subscribers', () => {
    const received: BusMessage<{ id: number }>[] = [];
    bus.subscribe<{ id: number }>('test:topic').subscribe((msg) => received.push(msg));

    bus.publish('test:topic', { id: 1 });
    bus.publish('test:topic', { id: 2 });
    bus.publish('other:topic', { id: 3 });

    expect(received.length).toBe(2);
    expect(received[0].payload.id).toBe(1);
    expect(received[1].payload.id).toBe(2);
  });

  it('replays messages from history', () => {
    bus.publish('test:topic', { value: 'first' });
    bus.publish('test:topic', { value: 'second' });
    bus.publish('test:topic', { value: 'third' });

    const replayed = bus.replay('test:topic', 2);

    expect(replayed.length).toBe(2);
    expect(replayed[0].payload).toEqual({ value: 'second' });
    expect(replayed[1].payload).toEqual({ value: 'third' });
  });

  it('executes middleware in order', () => {
    const order: string[] = [];

    bus.use((_msg, next) => {
      order.push('first');
      next();
    });
    bus.use((_msg, next) => {
      order.push('second');
      next();
    });

    bus.publish('test:topic', {});

    expect(order).toEqual(['first', 'second']);
  });

  it('blocks delivery when middleware does not call next', () => {
    const received: BusMessage[] = [];
    bus.subscribe('test:topic').subscribe((msg) => received.push(msg));

    bus.use((_msg, _next) => {
      // Intentionally not calling next()
    });

    bus.publish('test:topic', {});

    expect(received.length).toBe(0);
  });
});
```

### Testing the Broadcast Service

For `BroadcastChannel`, mock the browser API:

```typescript
// libs/shared/util-broadcast/src/lib/broadcast.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { BroadcastService } from './broadcast.service';

describe('BroadcastService', () => {
  let service: BroadcastService;
  let mockPostMessage: jest.fn;

  beforeEach(() => {
    mockPostMessage = jest.fn();
    jest.spyOn(globalThis, 'BroadcastChannel').mockImplementation(() => ({
      postMessage: mockPostMessage,
      close: jest.fn(),
      onmessage: null,
      onmessageerror: null,
      name: 'mfe-platform',
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }) as unknown as BroadcastChannel);

    service = TestBed.inject(BroadcastService);
  });

  it('posts structured envelope to channel', () => {
    service.send('auth:logged-out', undefined);

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'auth:logged-out',
        payload: undefined,
        version: 1,
      })
    );
  });

  it('invokes local handlers on send', () => {
    const received: unknown[] = [];
    service.on<{ userId: number }>('user:updated', (payload) => received.push(payload));

    service.send('user:updated', { userId: 42 });

    expect(received).toEqual([{ userId: 42 }]);
  });
});
```

## Common Mistakes

### Mistake 1: Not Verifying Origin in postMessage Handlers

```typescript
// WRONG: accepts messages from any origin
window.addEventListener('message', (event: MessageEvent) => {
  // No origin check -- any page can send messages to this window
  handleBridgeMessage(event.data);
});
```

Omitting the origin check is a cross-site scripting vector. Any page that can obtain a reference to your window (via `window.open`, an iframe, or a popup) can inject arbitrary messages. Always verify the origin:

```typescript
// CORRECT: only process messages from known origins
window.addEventListener('message', (event: MessageEvent) => {
  if (!allowedOrigins.has(event.origin)) return;
  if (!isValidMessage(event.data)) return;
  handleBridgeMessage(event.data);
});
```

### Mistake 2: Forgetting That BroadcastChannel Does Not Deliver to the Sender

```typescript
// WRONG: expecting the same tab to receive its own broadcast
@Injectable({ providedIn: 'root' })
export class CartSyncService {
  private readonly channel = new BroadcastChannel('cart');

  addItem(item: CartItem): void {
    this.channel.postMessage({ type: 'cart:add', item });
    // BUG: the current tab's onmessage handler never fires for this message
  }
}
```

The sender must update its own state directly. `BroadcastChannel.postMessage` only delivers to *other* browsing contexts:

```typescript
// CORRECT: update local state AND broadcast to other tabs
@Injectable({ providedIn: 'root' })
export class CartSyncService {
  private readonly channel = new BroadcastChannel('cart');
  private readonly cart = inject(CartStore);

  addItem(item: CartItem): void {
    this.cart.addItem(item);
    this.channel.postMessage({ type: 'cart:add', item });
  }
}
```

### Mistake 3: Leaking Event Listeners Across MFE Lifecycles

```typescript
// WRONG: listener persists after the remote MFE is destroyed
export class SomeRemoteComponent {
  constructor() {
    window.addEventListener('cart:updated', this.onCartUpdate.bind(this));
    // Never removed -- accumulates on every navigation to/from this remote
  }

  onCartUpdate(event: Event): void {
    // Runs even after the component is destroyed
  }
}
```

Every `addEventListener` call must have a matching `removeEventListener`. Use Angular's `DestroyRef` to automate cleanup:

```typescript
// CORRECT: listener is removed when the component is destroyed
export class SomeRemoteComponent {
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    const handler = this.onCartUpdate.bind(this);
    window.addEventListener('cart:updated', handler);
    this.destroyRef.onDestroy(() => window.removeEventListener('cart:updated', handler));
  }

  onCartUpdate(event: Event): void {
    // Only runs while the component is alive
  }
}
```

### Mistake 4: Sending Non-Cloneable Data Through BroadcastChannel

```typescript
// WRONG: class instances with methods fail structured clone
const cartItem = new CartItem(42, 'Widget', 9.99);
channel.postMessage({ type: 'cart:add', item: cartItem });
// Throws: DOMException: Failed to execute 'postMessage' -- could not be cloned
```

`BroadcastChannel` and `postMessage` both use the structured clone algorithm. Class instances, functions, DOM nodes, and `Error` objects cannot be cloned. Convert to plain objects first:

```typescript
// CORRECT: send plain objects only
const cartItem = new CartItem(42, 'Widget', 9.99);
channel.postMessage({
  type: 'cart:add',
  item: { id: cartItem.id, title: cartItem.title, price: cartItem.price },
});
```

## Key Takeaways

- **Match the communication mechanism to the boundary.** Same-injector problems need shared services, not event buses. Cross-origin problems need `postMessage`, not `BroadcastChannel`. Using a mechanism broader than necessary adds complexity without benefit.

- **Always clean up listeners.** Use `DestroyRef.onDestroy()` to remove `addEventListener` and `BroadcastChannel` registrations when components or services are destroyed. Leaked listeners accumulate on every navigation, causing duplicate handlers and memory bloat.

- **Add logging middleware to the message bus from day one.** Cross-MFE communication bugs are invisible without observability. A logging middleware that prints every message to the console turns hours of debugging into seconds of reading.

- **Verify origins in every `postMessage` handler.** Omitting the origin check is a security vulnerability. Maintain an explicit allow-list and reject all unrecognized origins silently.

- **Use the framework-agnostic `window.__MFE_BUS__` contract for multi-framework platforms.** Register the bus from the shell during bootstrap, and let non-Angular MFEs consume it through a plain TypeScript interface with no Angular imports.
