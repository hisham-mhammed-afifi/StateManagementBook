# Chapter 39: Migration Playbook

You inherited an enterprise application. The oldest module still runs on AngularJS, wrapped in a hybrid shell that nobody wants to touch. The core product catalog uses NgRx Classic Store with hundreds of actions and selectors. The newer dashboard features use plain services backed by `BehaviorSubject` and `combineLatest` chains. Three teams, three eras of Angular state management, one product. Leadership wants everything on modern Angular with signals. They want a plan, a timeline, and a guarantee that nothing breaks. This chapter is that plan.

Chapter 22 covered the technical mechanics of converting ComponentStore and Classic Store code to SignalStore, showing the API-level transformations line by line. Chapter 38 gave you the decision framework for choosing the right state tool for new features. This chapter sits between the two: it is the organizational playbook that tells you which code to migrate first, how to run parallel state systems safely, how to move RxJS-heavy services to signals without breaking consumers, and how to extract state management from a legacy AngularJS module into the modern Angular world. We will walk through three migration journeys with real code at every step.

## Journey 1: AngularJS to Modern Angular

If your application still has AngularJS modules, you are dealing with a framework that reached end-of-life in January 2022. No security patches, no bug fixes, no compatibility guarantees with modern browsers. The migration is not optional. It is a risk mitigation effort.

### The Hybrid Shell

Angular provides `@angular/upgrade/static` for running AngularJS and Angular side by side. The core idea: AngularJS owns the root template and bootstraps the application. Angular components are "downgraded" so that AngularJS templates can render them. AngularJS services are "upgraded" so that Angular code can inject them. This hybrid approach lets you migrate one component at a time without a big-bang rewrite.

There are two bootstrap strategies. `UpgradeModule` eagerly bootstraps both frameworks together. `downgradeModule` lazily bootstraps the Angular side only when a downgraded component is first rendered. Use `downgradeModule` for large applications because it avoids the startup cost of initializing Angular for parts of the page the user has not visited yet.

> **Important:** Angular 21 is zoneless by default. AngularJS depends on Zone.js for change detection coordination in hybrid apps. When setting up the hybrid shell, you must explicitly provide `provideZoneChangeDetection({ eventCoalescing: true })` in your Angular bootstrap configuration. Without this, AngularJS digest cycles will not trigger Angular change detection and the two frameworks will fall out of sync.

### State Migration Order

Migrating state out of AngularJS follows a specific sequence. Get this wrong and you will create circular dependencies between the two frameworks.

1. **Services first.** AngularJS services that hold state (`$scope` properties, factory-returned objects, `$rootScope` event listeners) are the foundation. Create an Angular `@Injectable` service that replicates the state with signals. Downgrade it so AngularJS code can consume it through `downgradeInjectable`. Both frameworks now share the same state source.

2. **Leaf components second.** Migrate components that have no AngularJS children. These are pure consumers of state. Point them at the new Angular service, replace `$scope` bindings with signal reads, and downgrade them into the AngularJS template.

3. **Container components third.** Once the children are migrated, the parent container can move to Angular. It injects the same signal-based service and orchestrates data flow.

4. **Routing last.** Replace the AngularJS router (`ui-router` or `ngRoute`) with Angular's `Router` only after all the components it routes to have been migrated.

### Bridging AngularJS State to Signals

The transitional service pattern wraps AngularJS state in a signal so that new Angular components can consume it immediately, even before the AngularJS source is removed.

```typescript
// src/app/shared/services/user-preferences-bridge.service.ts
import { Injectable, signal, computed, NgZone, inject } from '@angular/core';

export interface UserPreferences {
  readonly theme: 'light' | 'dark';
  readonly locale: string;
  readonly itemsPerPage: number;
}

const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'light',
  locale: 'en-US',
  itemsPerPage: 20,
};

@Injectable({ providedIn: 'root' })
export class UserPreferencesBridgeService {
  private readonly preferences = signal<UserPreferences>(DEFAULT_PREFERENCES);
  private readonly zone = inject(NgZone);

  readonly currentPreferences = this.preferences.asReadonly();
  readonly theme = computed(() => this.preferences().theme);
  readonly locale = computed(() => this.preferences().locale);

  syncFromAngularJs(legacyPrefs: Record<string, unknown>): void {
    this.zone.run(() => {
      this.preferences.set({
        theme: (legacyPrefs['theme'] as 'light' | 'dark') ?? 'light',
        locale: (legacyPrefs['locale'] as string) ?? 'en-US',
        itemsPerPage: (legacyPrefs['itemsPerPage'] as number) ?? 20,
      });
    });
  }

  updateTheme(theme: 'light' | 'dark'): void {
    this.preferences.update(prefs => ({ ...prefs, theme }));
  }

  updateLocale(locale: string): void {
    this.preferences.update(prefs => ({ ...prefs, locale }));
  }
}
```

On the AngularJS side, the downgraded service gets injected into the legacy controller. When the AngularJS `$watch` fires, it pushes the new value into the signal:

```javascript
// src/legacy/controllers/settings.controller.js
angular.module('legacyApp').controller('SettingsController', [
  '$scope',
  'userPreferencesBridge',
  function ($scope, userPreferencesBridge) {
    $scope.$watch('preferences', function (newVal) {
      if (newVal) {
        userPreferencesBridge.syncFromAngularJs(newVal);
      }
    }, true);
  }
]);
```

The `NgZone.run()` call in `syncFromAngularJs` is necessary because the AngularJS digest cycle fires outside Angular's zone. Without it, signal updates originating from AngularJS would not trigger Angular change detection in the hybrid app. Once the AngularJS module is fully removed and Zone.js is dropped, delete the `NgZone.run()` wrapper.

### When to Stop Bridging and Start Replacing

The bridge service is a transitional tool, not a permanent architecture. Once all consumers of a particular piece of state live in Angular, replace the bridge service with a proper signal service or SignalStore. The rule of thumb: if `syncFromAngularJs` has zero callers, the bridge has served its purpose.

## Journey 2: RxJS-Heavy Services to Signals

Most Angular applications written between 2018 and 2024 use the "service with a subject" pattern: a `BehaviorSubject` holds state, an observable exposes it, and the `async` pipe renders it. This pattern works, but it carries ceremony that signals eliminate. The goal is not to remove RxJS. The goal is to use signals where they are simpler and keep RxJS where it is necessary.

### The Decision Line

Signals replace RxJS when the operation is fundamentally synchronous state management. RxJS stays when the operation involves asynchronous event coordination.

**Move to signals:**
- `BehaviorSubject` holding a value that components read
- `combineLatest` + `map` deriving state from two subjects
- Simple `.next()` calls that set a new value
- `async` pipe in templates that just unwraps a single observable

**Keep as RxJS:**
- `debounceTime` on a search input (timing-based)
- `switchMap` for canceling previous HTTP requests (race condition handling)
- `retry` or `retryWhen` for resilient API calls (error recovery pipelines)
- WebSocket message streams (continuous async events)
- `exhaustMap` preventing duplicate form submissions (concurrency control)

There is no signal equivalent for `switchMap`, `exhaustMap`, `concatMap`, `debounceTime`, or `retryWhen`. If the logic requires these operators, it stays in RxJS.

### The Before and After

Here is a typical RxJS-based notification service and its signal-based replacement:

```typescript
// src/app/shared/services/notification.service.ts (BEFORE - RxJS)
import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable } from 'rxjs';

export interface Notification {
  readonly id: string;
  readonly message: string;
  readonly severity: 'info' | 'warning' | 'error';
  readonly read: boolean;
  readonly timestamp: number;
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly notificationsSubject = new BehaviorSubject<Notification[]>([]);
  private readonly filterSubject = new BehaviorSubject<'all' | 'unread'>('all');

  readonly notifications$: Observable<Notification[]> = this.notificationsSubject.asObservable();
  readonly filter$: Observable<'all' | 'unread'> = this.filterSubject.asObservable();

  readonly visibleNotifications$: Observable<Notification[]> = combineLatest([
    this.notificationsSubject,
    this.filterSubject,
  ]).pipe(
    map(([notifications, filter]) =>
      filter === 'unread'
        ? notifications.filter(n => !n.read)
        : notifications
    )
  );

  readonly unreadCount$: Observable<number> = this.notificationsSubject.pipe(
    map(notifications => notifications.filter(n => !n.read).length)
  );

  add(notification: Notification): void {
    this.notificationsSubject.next([
      notification,
      ...this.notificationsSubject.getValue(),
    ]);
  }

  markAsRead(id: string): void {
    this.notificationsSubject.next(
      this.notificationsSubject.getValue().map(n =>
        n.id === id ? { ...n, read: true } : n
      )
    );
  }

  setFilter(filter: 'all' | 'unread'): void {
    this.filterSubject.next(filter);
  }
}
```

```typescript
// src/app/shared/services/notification.service.ts (AFTER - Signals)
import { Injectable, signal, computed } from '@angular/core';

export interface Notification {
  readonly id: string;
  readonly message: string;
  readonly severity: 'info' | 'warning' | 'error';
  readonly read: boolean;
  readonly timestamp: number;
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly notifications = signal<Notification[]>([]);
  private readonly filter = signal<'all' | 'unread'>('all');

  readonly allNotifications = this.notifications.asReadonly();
  readonly currentFilter = this.filter.asReadonly();

  readonly visibleNotifications = computed(() => {
    const list = this.notifications();
    return this.filter() === 'unread' ? list.filter(n => !n.read) : list;
  });

  readonly unreadCount = computed(
    () => this.notifications().filter(n => !n.read).length
  );

  add(notification: Notification): void {
    this.notifications.update(list => [notification, ...list]);
  }

  markAsRead(id: string): void {
    this.notifications.update(list =>
      list.map(n => (n.id === id ? { ...n, read: true } : n))
    );
  }

  setFilter(filter: 'all' | 'unread'): void {
    this.filter.set(filter);
  }
}
```

The signal version eliminates four imports (`BehaviorSubject`, `combineLatest`, `map`, `Observable`), removes every `.getValue()` call, and replaces the `combineLatest` + `map` chain with a single `computed`. Templates that consumed this service through the `async` pipe now read signals directly: `{{ notificationService.unreadCount() }}` instead of `{{ notificationService.unreadCount$ | async }}`.

### The Bridge Pattern: toSignal for Incremental Migration

You do not need to rewrite every service at once. When a component is ready for signals but the service it depends on still uses observables, bridge the gap with `toSignal`:

```typescript
// src/app/dashboard/analytics-panel.component.ts
import { Component, inject, signal, computed } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { LegacyAnalyticsService } from '../shared/services/legacy-analytics.service';

@Component({
  selector: 'app-analytics-panel',
  template: `
    @if (isLoading()) {
      <app-spinner />
    } @else {
      <h2>Analytics ({{ filteredMetrics().length }} metrics)</h2>
      @for (metric of filteredMetrics(); track metric.id) {
        <app-metric-card
          [metric]="metric"
          [selected]="selectedId() === metric.id"
          (click)="selectedId.set(metric.id)"
        />
      }
    }
  `,
})
export class AnalyticsPanelComponent {
  private readonly analytics = inject(LegacyAnalyticsService);

  readonly metrics = toSignal(this.analytics.metrics$, { initialValue: [] });
  readonly isLoading = toSignal(this.analytics.loading$, { initialValue: true });

  readonly selectedId = signal<string | null>(null);
  readonly filteredMetrics = computed(() => {
    const id = this.selectedId();
    const list = this.metrics();
    return id ? list.filter(m => m.category === id) : list;
  });
}
```

This component is fully signal-based in its template, yet the underlying service has not changed. Migrate the service later when convenient. The `toSignal` bridge carries no ongoing cost because it auto-unsubscribes when the component is destroyed.

### Running the Automated Schematics

Angular 21 ships migration schematics that handle the mechanical parts of signal adoption across your component layer. Run them in this order:

```bash
# Step 1: Convert @Input() to input() / input.required()
ng generate @angular/core:signal-input-migration

# Step 2: Convert @Output() EventEmitter to output()
ng generate @angular/core:output-migration

# Step 3: Convert @ViewChild / @ContentChild to signal queries
ng generate @angular/core:signal-queries-migration

# Step 4: Convert *ngIf / *ngFor to @if / @for
ng generate @angular/core:control-flow-migration
```

Each schematic modifies files in place and updates all references. Run tests after each step. If a migration cannot handle a specific case, it adds a `// TODO:` comment explaining why. The `--best-effort-mode` flag migrates aggressively and annotates anything it cannot verify, which is useful for large codebases where you want to see the full scope of remaining manual work.

## Journey 3: NgRx Classic Store to SignalStore at Scale

Chapter 22 showed the code transformations: selectors become `withComputed`, reducers become `patchState` calls in `withMethods`, effects become `withEventHandlers` or `rxMethod`. This section covers the strategic layer that Chapter 22 did not: how to plan and execute the migration across a multi-team organization without halting feature delivery.

### The Coexistence Principle

NgRx Classic Store and SignalStore are both actively maintained by the NgRx team. Neither is deprecated. They can coexist in the same application indefinitely because they use separate state containers. A component can inject both `Store` (classic) and a `signalStore` factory result in the same class. This is not a transitional hack. It is a supported architecture.

The coexistence principle changes the migration calculus. You are not under pressure to migrate everything. You are making a business decision about which features benefit most from the simpler SignalStore API and which features are fine staying on Classic Store because they work, they are tested, and nobody is actively modifying them.

### The Migration Priorities Matrix

Score each feature module on two dimensions: **change frequency** (how often the team modifies it) and **developer pain** (how many files and how much boilerplate each change requires). Plot them on a simple grid:

- **High frequency, high pain:** Migrate first. These features consume the most developer time and benefit most from SignalStore's reduced boilerplate.
- **High frequency, low pain:** Migrate second. The team touches these often, so they will learn SignalStore patterns here quickly.
- **Low frequency, high pain:** Migrate opportunistically. Wait until the next significant feature change in this module.
- **Low frequency, low pain:** Do not migrate. The cost exceeds the benefit. Leave it on Classic Store.

```typescript
// tools/migration-tracker.ts
interface FeatureMigrationEntry {
  readonly feature: string;
  readonly currentApproach: 'classic-ngrx' | 'component-store' | 'rxjs-service';
  readonly changeFrequency: 'high' | 'medium' | 'low';
  readonly developerPain: 'high' | 'medium' | 'low';
  readonly priority: 'migrate-now' | 'migrate-next' | 'opportunistic' | 'leave';
  readonly assignedTeam: string;
  readonly targetSprint: string | null;
  readonly status: 'pending' | 'in-progress' | 'completed' | 'skipped';
}

export const MIGRATION_PLAN: FeatureMigrationEntry[] = [
  {
    feature: 'product-catalog',
    currentApproach: 'classic-ngrx',
    changeFrequency: 'high',
    developerPain: 'high',
    priority: 'migrate-now',
    assignedTeam: 'catalog-team',
    targetSprint: '2026-Q2-S3',
    status: 'pending',
  },
  {
    feature: 'order-history',
    currentApproach: 'classic-ngrx',
    changeFrequency: 'low',
    developerPain: 'medium',
    priority: 'leave',
    assignedTeam: 'orders-team',
    targetSprint: null,
    status: 'skipped',
  },
  {
    feature: 'user-dashboard',
    currentApproach: 'rxjs-service',
    changeFrequency: 'high',
    developerPain: 'medium',
    priority: 'migrate-next',
    assignedTeam: 'platform-team',
    targetSprint: '2026-Q3-S1',
    status: 'pending',
  },
];
```

### The selectSignal Bridge

During migration, existing Classic Store selectors remain the source of truth for features that have not been migrated yet. New components that want signal-based templates can consume Classic Store data through `selectSignal`:

```typescript
// src/app/orders/components/order-summary.component.ts
import { Component, inject, computed } from '@angular/core';
import { Store } from '@ngrx/store';
import {
  selectActiveOrders,
  selectOrdersLoading,
  selectTotalRevenue,
} from '../state/order.selectors';

@Component({
  selector: 'app-order-summary',
  template: `
    @if (loading()) {
      <app-spinner />
    } @else {
      <div class="summary-cards">
        <app-stat-card label="Active Orders" [value]="activeCount()" />
        <app-stat-card label="Total Revenue" [value]="formattedRevenue()" />
      </div>
      @for (order of activeOrders(); track order.id) {
        <app-order-row [order]="order" />
      }
    }
  `,
})
export class OrderSummaryComponent {
  private readonly store = inject(Store);

  readonly activeOrders = this.store.selectSignal(selectActiveOrders);
  readonly loading = this.store.selectSignal(selectOrdersLoading);
  readonly totalRevenue = this.store.selectSignal(selectTotalRevenue);

  readonly activeCount = computed(() => this.activeOrders().length);
  readonly formattedRevenue = computed(
    () => `$${this.totalRevenue().toFixed(2)}`
  );
}
```

This component uses modern signal-based templates with `@if` and `@for`, yet it reads from the Classic Store without any migration of the underlying state layer. When the orders team eventually migrates the order state to SignalStore, this component needs only a provider change. The template stays identical.

### The NgRx v21 Schematic

If your codebase uses the Events Plugin from NgRx v20, the `withEffects` function was renamed to `withEventHandlers` in v21. Run the migration schematic to update all imports and usages automatically:

```bash
ng update @ngrx/signals@21
```

The schematic handles direct imports, aliased imports, and re-exports. Verify with a global search afterward to confirm no manual usages remain:

```bash
grep -r "withEffects" --include="*.ts" src/
```

If the search returns zero results, the migration is complete.

## Common Mistakes

### Mistake 1: Migrating Everything at Once

```typescript
// WRONG: Rewriting every feature store in a single sprint
// sprint-plan.md
// - Migrate product catalog (3 days)
// - Migrate order management (3 days)
// - Migrate user preferences (2 days)
// - Migrate admin dashboard (2 days)
// Total: 10 days, single PR with 200 files changed
```

A big-bang migration means a single PR with hundreds of changed files that no reviewer can meaningfully evaluate. It also means every feature is simultaneously in a broken state during the rewrite. If any migration introduces a regression, you cannot bisect the problem because everything changed at once.

```typescript
// CORRECT: One feature per sprint, one PR per feature
// sprint-plan.md
// - Sprint 3: Migrate product catalog to SignalStore
//   - PR 1: Create ProductCatalogStore (signalStore), add tests
//   - PR 2: Point ProductListComponent at new store, verify existing tests
//   - PR 3: Remove old actions/reducer/selectors/effects files
```

Each PR is reviewable, deployable, and revertable independently.

### Mistake 2: Calling toSignal Inside a Method

```typescript
// WRONG: toSignal called outside injection context
@Component({ /* ... */ })
export class SearchComponent {
  private readonly searchService = inject(SearchService);

  onSearch(term: string): void {
    // This throws: "toSignal() can only be used within an injection context"
    const results = toSignal(this.searchService.search(term));
  }
}
```

`toSignal` must be called in a field initializer, a constructor, or inside `runInInjectionContext`. Calling it inside a method fires outside the injection context and throws at runtime.

```typescript
// CORRECT: toSignal as a field initializer, driven by a signal input
import { Component, inject, signal, computed } from '@angular/core';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs';
import { SearchService } from '../shared/services/search.service';

@Component({ /* ... */ })
export class SearchComponent {
  private readonly searchService = inject(SearchService);

  readonly term = signal('');

  readonly results = toSignal(
    toObservable(this.term).pipe(
      switchMap(term => this.searchService.search(term))
    ),
    { initialValue: [] }
  );
}
```

The signal `term` drives the search. `toObservable` bridges it into RxJS for the `switchMap`, and `toSignal` converts the result back. All of this is declared as field initializers, safely within the injection context.

### Mistake 3: Dropping RxJS Where It Is Still Needed

```typescript
// WRONG: Replacing a debounced search with raw signals
@Component({ /* ... */ })
export class TypeaheadComponent {
  readonly query = signal('');

  readonly suggestions = computed(() => {
    // This fires on EVERY keystroke with no debounce
    return this.query().length > 2 ? this.fetchSuggestions(this.query()) : [];
  });

  private fetchSuggestions(q: string): string[] {
    // Synchronous return? This does not work for HTTP calls.
    return [];
  }
}
```

Signals are synchronous. `computed` cannot perform HTTP calls or introduce timing delays. A typeahead needs `debounceTime` and `switchMap`, which are RxJS operators with no signal equivalent.

```typescript
// CORRECT: Use the bridge pattern for async pipelines that need timing
import { Component, inject, signal } from '@angular/core';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged, filter, switchMap } from 'rxjs';
import { SuggestionService } from '../shared/services/suggestion.service';

@Component({ /* ... */ })
export class TypeaheadComponent {
  private readonly suggestionService = inject(SuggestionService);

  readonly query = signal('');

  readonly suggestions = toSignal(
    toObservable(this.query).pipe(
      debounceTime(300),
      distinctUntilChanged(),
      filter(q => q.length > 2),
      switchMap(q => this.suggestionService.search(q))
    ),
    { initialValue: [] }
  );
}
```

The signal holds the input state. RxJS handles the async pipeline. `toSignal` brings the result back into the signal world. Each tool does what it does best.

### Mistake 4: Forgetting initialValue on toSignal

```typescript
// WRONG: No initialValue means Signal<Product[] | undefined>
readonly products = toSignal(this.productService.products$);
// products() returns undefined before the first emission
// computed(() => this.products().length) throws: Cannot read property 'length' of undefined
```

Without `initialValue`, `toSignal` returns `Signal<T | undefined>`. Every `computed` that reads this signal must handle the `undefined` case, which spreads defensive checks throughout the component.

```typescript
// CORRECT: Provide initialValue to match the expected type
readonly products = toSignal(this.productService.products$, { initialValue: [] });
// products() returns [] immediately, computed(() => this.products().length) returns 0
```

Use `requireSync: true` instead of `initialValue` only when the source observable is a `BehaviorSubject` or `ReplaySubject(1)` that emits synchronously on subscription.

## Key Takeaways

- **Migrate incrementally, not all at once.** One feature per pull request, one journey at a time. Coexistence between AngularJS and Angular, between RxJS services and signal services, and between Classic Store and SignalStore is a supported, stable architecture.

- **Follow the migration order for AngularJS: services, leaf components, containers, routing.** Bridge state from AngularJS into Angular signals using a transitional service that calls `NgZone.run()` for change detection coordination. Remove the bridge once all consumers are on the Angular side.

- **Use signals for synchronous state, keep RxJS for async event coordination.** If the logic needs `debounceTime`, `switchMap`, `retry`, or `exhaustMap`, it stays in RxJS. Use the `toSignal`/`toObservable` bridge pattern to connect the two worlds without rewriting either.

- **Use `selectSignal` to modernize Classic Store templates without migrating state.** Components can adopt signal-based templates and `@if`/`@for` syntax today while the underlying Classic Store selectors, reducers, and effects remain untouched.

- **Prioritize migration by change frequency and developer pain, not by module size.** Features that nobody modifies do not need migration regardless of their technical debt. Focus migration effort where it reduces friction for active development.
