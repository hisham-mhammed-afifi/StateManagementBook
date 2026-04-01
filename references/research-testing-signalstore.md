# Research: Testing SignalStore

**Date:** 2026-04-01
**Chapter:** Ch 21
**Status:** Ready for chapter generation

## API Surface

### unprotected

- **Import:** `import { unprotected } from '@ngrx/signals/testing';`
- **Signature:** `unprotected<T>(store: T): StateSource<T>`
- **Stability:** Stable (introduced in NgRx v19.1.0, refined in v20+)
- **Purpose:** Bypasses SignalStore's state encapsulation (`protectedState: true`) so that `patchState()` can be called directly in tests. This is the primary testing utility provided by NgRx for the "Arrange" phase of tests.

```typescript
// products/store/product.store.spec.ts
import { unprotected } from '@ngrx/signals/testing';
import { patchState } from '@ngrx/signals';

const store = TestBed.inject(ProductStore);
patchState(unprotected(store), {
  products: [{ id: 1, name: 'Widget' }],
  loading: false,
});
```

### patchState

- **Import:** `import { patchState } from '@ngrx/signals';`
- **Signature:** `patchState<State>(store: StateSource<State>, ...updaters: Array<Partial<State> | ((state: State) => Partial<State>)>): void`
- **Stability:** Stable
- **Purpose:** Updates store state. In tests, used with `unprotected()` to set up test state without calling public methods.

### TestBed.flushEffects()

- **Import:** `import { TestBed } from '@angular/core/testing';`
- **Signature:** `TestBed.flushEffects(): void`
- **Stability:** Stable (Angular 17+)
- **Purpose:** Synchronously executes all pending effects. Essential for testing `effect()` callbacks and any signal-driven side effects.

```typescript
// Flush pending effects after signal changes
store.increment();
TestBed.flushEffects();
expect(sideEffectResult).toBe(expectedValue);
```

### TestBed.runInInjectionContext()

- **Import:** `import { TestBed } from '@angular/core/testing';`
- **Signature:** `TestBed.runInInjectionContext<T>(fn: () => T): T`
- **Stability:** Stable
- **Purpose:** Runs a function within an injection context, enabling use of `inject()` in tests. Required for testing `injectDispatch()` and other injection-context-dependent APIs.

### injectDispatch (Events Plugin)

- **Import:** `import { injectDispatch } from '@ngrx/signals/events';`
- **Signature:** `injectDispatch<Events>(events: Events): DispatchRef<Events>`
- **Stability:** Stable (NgRx v20+)
- **Purpose:** Creates a dispatcher for event-driven SignalStore testing. Must be called within an injection context.

```typescript
// tasks/store/task.store.spec.ts
const dispatch = TestBed.runInInjectionContext(() =>
  injectDispatch(TaskPageEvents)
);
dispatch.taskCreated({ id: 1, title: 'New Task' });
```

### withOptionalHooks

- **Import:** `import { withOptionalHooks } from '@ngrx/signals';`
- **Stability:** Stable (NgRx v18+)
- **Purpose:** Alternative to `withHooks()` that automatically skips lifecycle hook execution during testing, preventing unintended side effects like API calls on store initialization.

### deepComputed

- **Import:** `import { deepComputed } from '@ngrx/signals';`
- **Signature:** `deepComputed<T>(computation: () => T): DeepSignal<T>`
- **Stability:** Stable
- **Purpose:** Creates a `DeepSignal` with nested computed properties. Useful for creating mock stores that mimic real store selector behavior in component tests.

## Key Concepts

### Testing Levels for SignalStore

- **Unit testing the store directly:** Instantiate via TestBed, call methods, assert signal values. The simplest and most common approach.
- **Unit testing components with mock stores:** Replace the real store with a mock (manual or generated) to isolate component logic.
- **Integration testing:** Test the full flow including services, event handlers, and state changes together.
- **Testing custom store features in isolation:** Extract features into standalone `signalStoreFeature()` functions and test them independently.

### The "Arrange" Problem with Protected State

- Since NgRx v18, SignalStore state is protected by default (`protectedState: true`).
- Tests cannot call `patchState()` on a store directly because the state symbol `[STATE_SOURCE]` is not exposed.
- The `unprotected()` helper from `@ngrx/signals/testing` solves this by wrapping the store to expose its internal state source.
- Without `unprotected()`, the only way to set state is through the store's public methods, which can make arrange phases verbose.

### Three Approaches to Mocking SignalStores

1. **No mock (real store):** Best for store-level unit tests and integration tests. Use `unprotected()` for state setup.
2. **Manual mock:** Create a class with writable signals for state, `jest.fn()`/`jasmine.createSpy()` for methods. Full control but high maintenance.
3. **Automated mock (`provideMockSignalStore`):** Community utility that auto-generates mocks. Converts signals to writable, methods to spies, RxMethods to fakes. Not yet in official NgRx.

### Zoneless Testing (Angular 21 Default)

- Angular 21 is zoneless by default. `fakeAsync()`, `tick()`, `flush()`, and `flushMicrotasks()` are NOT available.
- Use native `async/await` with `fixture.whenStable()` for async operations.
- Use `TestBed.flushEffects()` for synchronous effect flushing.
- Vitest is the default test runner in Angular 21, replacing Karma/Jasmine.

### Testing RxMethods

- `rxMethod` returns a callable function with a `.destroy()` method.
- Testing approaches: (a) pass a static value and assert state changes, (b) pass a signal and verify re-execution on signal change, (c) use `FakeRxMethod` from community utilities to track calls without real execution.

### Testing Event-Driven Stores (withEventHandlers)

- Dispatch events using `injectDispatch()` within `TestBed.runInInjectionContext()`.
- Mock services that event handlers depend on.
- Use `await fixture.whenStable()` or setTimeout patterns to wait for async event handler completion.
- `withEventHandlers` replaced `withEffects` in NgRx v21.

## Code Patterns

### Pattern 1: Basic Store Unit Test

```typescript
// products/store/product.store.spec.ts
import { TestBed } from '@angular/core/testing';
import { ProductStore } from './product.store';

describe('ProductStore', () => {
  let store: InstanceType<typeof ProductStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ProductStore],
    });
    store = TestBed.inject(ProductStore);
  });

  it('should initialize with default state', () => {
    expect(store.products()).toEqual([]);
    expect(store.loading()).toBe(false);
  });

  it('should add a product', () => {
    store.addProduct({ id: 1, name: 'Widget', price: 9.99 });

    expect(store.products().length).toBe(1);
    expect(store.products()[0].name).toBe('Widget');
  });

  it('should compute total price', () => {
    store.addProduct({ id: 1, name: 'A', price: 10 });
    store.addProduct({ id: 2, name: 'B', price: 20 });

    expect(store.totalPrice()).toBe(30);
  });
});
```

### Pattern 2: Using unprotected() for State Setup

```typescript
// tasks/store/task.store.spec.ts
import { TestBed } from '@angular/core/testing';
import { patchState } from '@ngrx/signals';
import { unprotected } from '@ngrx/signals/testing';
import { TaskStore } from './task.store';

describe('TaskStore - computed signals', () => {
  let store: InstanceType<typeof TaskStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [TaskStore],
    });
    store = TestBed.inject(TaskStore);
  });

  it('should filter completed tasks', () => {
    patchState(unprotected(store), {
      tasks: [
        { id: 1, title: 'Done', completed: true },
        { id: 2, title: 'Pending', completed: false },
        { id: 3, title: 'Also Done', completed: true },
      ],
    });

    expect(store.completedTasks().length).toBe(2);
    expect(store.pendingTasks().length).toBe(1);
  });

  it('should compute completion percentage', () => {
    patchState(unprotected(store), {
      tasks: [
        { id: 1, title: 'A', completed: true },
        { id: 2, title: 'B', completed: false },
      ],
    });

    expect(store.completionPercentage()).toBe(50);
  });
});
```

### Pattern 3: Testing with Mocked Dependencies

```typescript
// orders/store/order.store.spec.ts
import { TestBed } from '@angular/core/testing';
import { OrderStore } from './order.store';
import { OrderService } from '../services/order.service';
import { of, throwError } from 'rxjs';

describe('OrderStore - API integration', () => {
  let store: InstanceType<typeof OrderStore>;
  const mockOrderService = {
    getOrders: vi.fn(),
    createOrder: vi.fn(),
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        OrderStore,
        { provide: OrderService, useValue: mockOrderService },
      ],
    });
    store = TestBed.inject(OrderStore);
  });

  it('should load orders successfully', async () => {
    const orders = [{ id: 1, total: 99.99 }];
    mockOrderService.getOrders.mockReturnValue(of(orders));

    store.loadOrders();
    await TestBed.inject(TestBed).whenStable?.();

    expect(store.orders()).toEqual(orders);
    expect(store.loading()).toBe(false);
  });

  it('should handle load error', async () => {
    mockOrderService.getOrders.mockReturnValue(
      throwError(() => new Error('Network error'))
    );

    store.loadOrders();
    await TestBed.inject(TestBed).whenStable?.();

    expect(store.error()).toBe('Network error');
    expect(store.loading()).toBe(false);
  });
});
```

### Pattern 4: Testing withEntities

```typescript
// users/store/user.store.spec.ts
import { TestBed } from '@angular/core/testing';
import { patchState } from '@ngrx/signals';
import { setAllEntities, addEntity, removeEntity } from '@ngrx/signals/entities';
import { unprotected } from '@ngrx/signals/testing';
import { UserStore } from './user.store';

describe('UserStore - entity operations', () => {
  let store: InstanceType<typeof UserStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [UserStore],
    });
    store = TestBed.inject(UserStore);
  });

  it('should set all entities via unprotected', () => {
    const users = [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ];
    patchState(unprotected(store), setAllEntities(users));

    expect(store.entities().length).toBe(2);
    expect(store.entityMap()[1].name).toBe('Alice');
  });

  it('should add and remove entities through public API', () => {
    store.addUser({ id: 1, name: 'Alice' });
    expect(store.entities().length).toBe(1);

    store.removeUser(1);
    expect(store.entities().length).toBe(0);
  });
});
```

### Pattern 5: Testing Event-Driven Stores (withEventHandlers)

```typescript
// tasks/store/task-events.store.spec.ts
import { TestBed } from '@angular/core/testing';
import { injectDispatch } from '@ngrx/signals/events';
import { TaskStore } from './task.store';
import { TaskPageEvents } from './task.events';
import { TaskService } from '../services/task.service';
import { of } from 'rxjs';

describe('TaskStore - event-driven', () => {
  let store: InstanceType<typeof TaskStore>;
  const mockTaskService = {
    loadAll: vi.fn(),
    create: vi.fn(),
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TaskStore,
        { provide: TaskService, useValue: mockTaskService },
      ],
    });
    store = TestBed.inject(TaskStore);
  });

  it('should handle page opened event', async () => {
    const tasks = [{ id: 1, title: 'Task 1', completed: false }];
    mockTaskService.loadAll.mockReturnValue(of(tasks));

    TestBed.runInInjectionContext(() => {
      const dispatch = injectDispatch(TaskPageEvents);
      dispatch.opened();
    });

    // Wait for event handler to complete
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(store.tasks()).toEqual(tasks);
    expect(mockTaskService.loadAll).toHaveBeenCalled();
  });
});
```

### Pattern 6: Component Test with Manual Mock Store

```typescript
// products/components/product-list.component.spec.ts
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ProductListComponent } from './product-list.component';
import { ProductStore } from '../store/product.store';

describe('ProductListComponent', () => {
  let fixture: ComponentFixture<ProductListComponent>;

  const mockProductStore = {
    products: signal([
      { id: 1, name: 'Widget', price: 9.99 },
      { id: 2, name: 'Gadget', price: 19.99 },
    ]),
    loading: signal(false),
    error: signal(null),
    totalPrice: signal(29.98),
    loadProducts: vi.fn(),
    addProduct: vi.fn(),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProductListComponent],
    })
      .overrideComponent(ProductListComponent, {
        set: {
          providers: [
            { provide: ProductStore, useValue: mockProductStore },
          ],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ProductListComponent);
    fixture.detectChanges();
  });

  it('should display products', () => {
    const items = fixture.nativeElement.querySelectorAll('[data-testid="product-item"]');
    expect(items.length).toBe(2);
  });

  it('should show loading state', async () => {
    mockProductStore.loading.set(true);
    await fixture.whenStable();
    fixture.detectChanges();

    const spinner = fixture.nativeElement.querySelector('[data-testid="spinner"]');
    expect(spinner).toBeTruthy();
  });

  it('should call loadProducts on init', () => {
    expect(mockProductStore.loadProducts).toHaveBeenCalled();
  });
});
```

### Pattern 7: Testing Custom Store Features in Isolation

```typescript
// shared/store-features/with-loading.feature.spec.ts
import { TestBed } from '@angular/core/testing';
import { signalStore, withState, withMethods, patchState } from '@ngrx/signals';
import { withLoading } from './with-loading.feature';

describe('withLoading feature', () => {
  // Create a minimal test store using only the feature under test
  const TestStore = signalStore(
    withState({ data: null as string | null }),
    withLoading(),
  );

  let store: InstanceType<typeof TestStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [TestStore],
    });
    store = TestBed.inject(TestStore);
  });

  it('should initialize with loading false', () => {
    expect(store.loading()).toBe(false);
  });

  it('should set loading state', () => {
    store.setLoading(true);
    expect(store.loading()).toBe(true);

    store.setLoading(false);
    expect(store.loading()).toBe(false);
  });

  it('should expose loaded computed', () => {
    expect(store.loaded()).toBe(true); // not loading = loaded

    store.setLoading(true);
    expect(store.loaded()).toBe(false);
  });
});
```

### Pattern 8: Testing Without TestBed (Lightweight)

```typescript
// shared/utils/state-helpers.spec.ts
import { signal, computed } from '@angular/core';

// For pure signal logic, TestBed is not required
describe('Signal-based state helpers', () => {
  it('should compute filtered items', () => {
    const items = signal([
      { id: 1, active: true },
      { id: 2, active: false },
      { id: 3, active: true },
    ]);
    const filter = signal<'all' | 'active' | 'inactive'>('active');

    const filteredItems = computed(() => {
      const f = filter();
      if (f === 'all') return items();
      return items().filter(item => item.active === (f === 'active'));
    });

    expect(filteredItems().length).toBe(2);

    filter.set('inactive');
    expect(filteredItems().length).toBe(1);

    filter.set('all');
    expect(filteredItems().length).toBe(3);
  });
});
```

## Breaking Changes and Gotchas

- **`withEffects` renamed to `withEventHandlers` in NgRx v21.** Migration schematics are available. Tests referencing `withEffects` must be updated.
- **Protected state is default since NgRx v18.** Tests that previously called `patchState()` directly will fail. Use `unprotected()` from `@ngrx/signals/testing`.
- **`fakeAsync()`/`tick()` not available in zoneless Angular 21.** Use `async/await` with `fixture.whenStable()` or `TestBed.flushEffects()`.
- **Vitest is the default test runner in Angular 21**, replacing Karma/Jasmine. Jest still works with `jest-preset-angular`.
- **`MockProvider()` from ng-mocks does not work with SignalStore.** It fails to mock RxMethods, store methods, and signal state properly. Use manual mocks or community utilities.
- **Spying on feature methods that call other feature methods does not work.** (GitHub issue #4577) Feature methods are bound at store creation time, so spies installed after injection are bypassed.
- **`withHooks()` lifecycle hooks execute during test store instantiation**, triggering side effects like API calls. Use `withOptionalHooks()` to skip hooks in test contexts.
- **Type incompatibility with `patchState` after v18 upgrade** due to `[STATE_SOURCE]` symbol. The `unprotected()` utility resolves this.

## Testing Strategy Recommendations

### When to use each approach

| Scenario | Approach | Why |
|----------|----------|-----|
| Testing store state logic | Real store + `unprotected()` | Fast, accurate, minimal setup |
| Testing computed signals | Real store + `unprotected()` | Computed signals need real dependencies |
| Testing methods with services | Real store + mock services | Verifies actual store behavior |
| Testing event handlers | Real store + `injectDispatch()` | Tests the full event flow |
| Testing component rendering | Manual mock store | Isolates component from store logic |
| Testing rxMethod | Real store + mock services | Verifies RxJS pipeline behavior |
| Testing custom features | Minimal test store | Isolates the feature under test |
| Testing pure signal logic | No TestBed | Fastest, simplest |

### Test file organization

```
feature/
  store/
    feature.store.ts
    feature.store.spec.ts        # Store unit tests
    feature.events.ts
    feature.events.spec.ts       # Event-driven tests
  components/
    feature-list.component.ts
    feature-list.component.spec.ts  # Component + mock store tests
  services/
    feature.service.ts
    feature.service.spec.ts
```

## Sources

### Official Documentation
- NgRx SignalStore Testing Guide: https://ngrx.io/guide/signals/signal-store/testing
- NgRx Signals Testing API: https://ngrx.io/api/signals/testing
- Angular Testing Guide: https://angular.dev/guide/testing
- Angular TestBed API: https://angular.dev/api/core/testing/TestBed

### Community Articles and Blog Posts
- Gergely Szerovay, "How to mock NgRx Signal Stores": https://www.angularaddicts.com/p/how-to-mock-ngrx-signal-stores
- Pierre Machaux, "Testing Ngrx Signal Store": https://javascript.plainenglish.io/testing-ngrx-signal-store-62523939ea92
- Rainer Hahnekamp, "How do I test Signals?": https://medium.com/ngconf/how-do-i-test-signals-signal-computed-effect-6d97e0732f2c
- Tim Deschryver, "Testing an NgRx Project": https://timdeschryver.dev/blog/testing-an-ngrx-project
- Daniel Szendrei, "How to Mock a Signal Store in Angular": https://medium.com/@r.daniel.szendrei/how-to-mock-a-signal-store-in-angular-ead7dbe84694
- Marmicode, "V20 Flushes flushEffects Down the Sink": https://cookbook.marmicode.io/angular/testing/flushing-flusheffects
- DEV Community, "Testing Angular 21 Components with Vitest": https://dev.to/olayeancarh/testing-angular-21-components-with-vitest-a-complete-guide-8l2
- JavaScript Conference, "Vitest in Angular 21: Faster Testing": https://javascript-conference.com/blog/angular-21-vitest-testing/

### GitHub Issues and Discussions
- #4206: Add testing guide for SignalStore: https://github.com/ngrx/platform/issues/4206
- #4256: mockSignalStore feature request: https://github.com/ngrx/platform/issues/4256
- #4540: unprotected helper RFC: https://github.com/ngrx/platform/issues/4540
- #4477: Type incompatibility with patchState post-v18: https://github.com/ngrx/platform/issues/4477
- #4517: Mocking SignalStore in component providers: https://github.com/ngrx/platform/issues/4517
- #4553: Unit testing watchState: https://github.com/ngrx/platform/issues/4553
- #4577: Can't spy on feature methods: https://github.com/ngrx/platform/issues/4577
- #4976: withEffects to withEventHandlers rename: https://github.com/ngrx/platform/issues/4976

### Community Projects
- Mock Signal Store Demo (Gergely Szerovay): https://github.com/gergelyszerovay/mock-signal-store-demo
- NgRx Toolkit (Angular Architects): https://github.com/angular-architects/ngrx-toolkit

## Open Questions

1. **`provideMockSignalStore` official status:** As of NgRx v21, this remains a community utility (not in `@ngrx/signals/testing`). Verify whether it has been added to the official package before writing.
2. **`TestBed.flushEffects()` availability in Vitest:** Confirm that `flushEffects()` works correctly with Vitest as the test runner (not just Jasmine/Jest).
3. **`withOptionalHooks` vs `withHooks` in v21:** Verify the exact mechanism by which `withOptionalHooks` detects a test context. Confirm whether it checks for `isDevMode()`, a test injector flag, or something else.
4. **`watchState` testing:** No official pattern exists for mocking `watchState`. Verify if NgRx v21 has addressed this (GitHub issue #4553).
5. **Entity adapter `patchState` with `unprotected`:** Confirm that entity adapter updaters (`setAllEntities`, `addEntity`, etc.) work correctly when passed through `unprotected()`.
