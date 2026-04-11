# Research: Migration Playbook

**Date:** 2026-04-10
**Chapter:** Ch 39
**Status:** Ready for chapter generation

## Scope and Differentiation from Chapter 22

Chapter 22 covers the technical mechanics of migrating NgRx Classic Store and ComponentStore to SignalStore (API mapping, code transformations, entity migration). Chapter 39 is the *organizational playbook* covering three broader migration journeys:

1. **AngularJS to modern Angular** (state management focus)
2. **RxJS-heavy services to signals** (BehaviorSubject/ReplaySubject services to signal-based services)
3. **Classic Store to SignalStore** (the strategic/organizational layer that Chapter 22 does not cover)

Chapter 39 focuses on decision-making, team coordination, phased rollout, risk mitigation, and coexistence strategies rather than API-level transformations.

---

## API Surface

### Angular RxJS-Signal Interop (`@angular/core/rxjs-interop`)

| API | Signature | Stability |
|-----|-----------|-----------|
| `toSignal` | `toSignal<T>(source: Observable<T>, options?: { initialValue?: T, requireSync?: boolean, manualCleanup?: boolean, equal?: (a, b) => boolean, injector?: Injector }): Signal<T>` | Stable |
| `toObservable` | `toObservable<T>(source: Signal<T>, options?: { injector?: Injector }): Observable<T>` | Stable |
| `rxResource` | `rxResource<T>({ params, stream })` | Experimental |
| `outputToObservable` | `outputToObservable<T>(ref: OutputRef<T>): Observable<T>` | Stable |
| `outputFromObservable` | `outputFromObservable<T>(observable: Observable<T>): OutputEmitterRef<T>` | Stable |

### Angular Migration Schematics (CLI)

| Schematic | Command | Purpose |
|-----------|---------|---------|
| Signal Inputs | `ng generate @angular/core:signal-input-migration` | Converts `@Input()` to `input()` / `input.required()` |
| Signal Queries | `ng generate @angular/core:signal-queries-migration` | Converts `@ViewChild`/`@ContentChild` to signal queries |
| Signal Outputs | `ng generate @angular/core:output-migration` | Converts `@Output() EventEmitter` to `output()` |
| Control Flow | `ng generate @angular/core:control-flow-migration` | Converts `*ngIf`/`*ngFor` to `@if`/`@for` |

All schematics support `--best-effort-mode` flag for aggressive migration with TODO annotations on failures.

### ngUpgrade (`@angular/upgrade/static`)

| API | Purpose | Stability |
|-----|---------|-----------|
| `UpgradeModule` | Bootstraps hybrid AngularJS+Angular app | Stable (maintenance) |
| `downgradeModule` | Lazily bootstraps Angular module in AngularJS context | Stable (maintenance) |
| `downgradeComponent` | Makes Angular component usable in AngularJS template | Stable (maintenance) |
| `downgradeInjectable` | Makes Angular service injectable in AngularJS | Stable (maintenance) |
| `UpgradeComponent` | Base class to upgrade AngularJS component for Angular | Stable (maintenance) |

### NgRx v21 Migration

| Change | Details |
|--------|---------|
| `withEffects` renamed to `withEventHandlers` | In `@ngrx/signals/events`. Migration schematic available: handles import and usage rename, including aliases. |
| Scoped Events | Events plugin promoted from experimental to stable. Supports `local`, `parent`, and `global` scope. |
| `signalMethod` / `rxMethod` | Now accept computation functions alongside Signals. |
| Update command | `ng update @ngrx/store@21` and `ng update @ngrx/signals@21` |
| Minimum requirements | Angular 21.x, TypeScript 5.9.x, RxJS ^6.5.x or ^7.5.x |

---

## Key Concepts

### Migration Journey 1: AngularJS to Modern Angular

- **ngUpgrade hybrid apps** allow AngularJS and Angular to coexist; the root is always an AngularJS template
- **Incremental migration** is the recommended strategy for large apps (6-18 months timeline)
- **UpgradeModule** bootstraps both frameworks; **downgradeModule** is the performance-optimized alternative (lazy Angular bootstrap)
- **Upgrade** = making AngularJS assets available in Angular; **Downgrade** = making Angular assets available in AngularJS
- State management migration order: (1) services first (easiest to share), (2) leaf components, (3) container components, (4) routing last
- Skip intermediate Angular versions; migrate directly to latest Angular
- State management strategy: move AngularJS `$scope` state and `$rootScope` events to Angular services with signals, then optionally to SignalStore
- Factory pattern: create Angular services that wrap AngularJS services during transition, then replace internals

### Migration Journey 2: RxJS-Heavy Services to Signals

- **"Service with a Subject" to "Service with a Signal"** is the core pattern
- Replace `BehaviorSubject<T>` with `signal<T>(initialValue)`
- Replace `.next(value)` with `.set(value)` or `.update(fn)`
- Replace `.asObservable()` exposure with `.asReadonly()` or `computed()`
- Replace `combineLatest` + `map` with `computed(() => ...)`
- Replace `async` pipe in templates with direct signal reads
- **Keep RxJS for**: complex async event pipelines, debouncing, throttling, retry logic, WebSocket streams, race conditions
- **Use signals for**: synchronous state, derived/computed state, UI state, form state
- **Bridge pattern**: `toSignal(toObservable(signal).pipe(...))` for cases needing RxJS operators on signal values
- Angular's official position: RxJS will be optional but always supported

### Migration Journey 3: Classic Store to SignalStore (Strategic Layer)

- Both Classic Store and SignalStore can coexist indefinitely; NgRx team supports both
- **Greenfield rule**: all new features use SignalStore from day one
- **Touch rule**: migrate only when making significant changes to a feature
- **One feature per PR**: never batch multiple feature migrations
- Components can inject both `Store` (classic) and a `signalStore` simultaneously during transition
- **Selector bridge**: use `this.store.selectSignal(selector)` to convert classic selectors to signals for components already migrated to signal-based templates
- Classic Store's `selectSignal` provides direct interop without `toSignal`
- Entity migration: `@ngrx/entity` adapters map to `withEntities()` in SignalStore
- Effects migration: `createEffect` maps to `withEventHandlers` (with events plugin) or `rxMethod` (without)
- DevTools: both Classic Store and SignalStore v21 support `@ngrx/store-devtools`

### Cross-Cutting Concerns

- **Testing continuity**: existing tests should pass after migration; write the new store, point components to it, verify tests pass, then delete old code
- **Coexistence is fine**: hybrid states (some features on Classic, some on SignalStore) are a valid long-term architecture
- **Angular migration schematics** automate signal inputs, signal queries, signal outputs, and control flow migration
- **Zoneless Angular 21**: migrated code benefits from zoneless change detection automatically when using signals

---

## Code Patterns

### Pattern 1: BehaviorSubject Service to Signal Service

```typescript
// src/app/products/services/product.service.ts (BEFORE - RxJS)
@Injectable({ providedIn: 'root' })
export class ProductService {
  private readonly productsSubject = new BehaviorSubject<Product[]>([]);
  private readonly loadingSubject = new BehaviorSubject<boolean>(false);

  readonly products$ = this.productsSubject.asObservable();
  readonly loading$ = this.loadingSubject.asObservable();
  readonly count$ = this.products$.pipe(map(p => p.length));

  private readonly http = inject(HttpClient);

  loadProducts(): void {
    this.loadingSubject.next(true);
    this.http.get<Product[]>('/api/products').pipe(
      finalize(() => this.loadingSubject.next(false))
    ).subscribe(products => this.productsSubject.next(products));
  }
}
```

```typescript
// src/app/products/services/product.service.ts (AFTER - Signals)
@Injectable({ providedIn: 'root' })
export class ProductService {
  private readonly products = signal<Product[]>([]);
  private readonly loading = signal(false);

  readonly productList = this.products.asReadonly();
  readonly isLoading = this.loading.asReadonly();
  readonly count = computed(() => this.products().length);

  private readonly http = inject(HttpClient);

  loadProducts(): void {
    this.loading.set(true);
    this.http.get<Product[]>('/api/products').subscribe({
      next: (products) => this.products.set(products),
      error: () => this.loading.set(false),
      complete: () => this.loading.set(false),
    });
  }
}
```

### Pattern 2: toSignal Bridge for Incremental Migration

```typescript
// src/app/dashboard/dashboard.component.ts
// Bridge pattern: consume existing Observable service via toSignal
export class DashboardComponent {
  private readonly legacyService = inject(LegacyAnalyticsService);

  // Convert existing Observable to Signal for template consumption
  readonly metrics = toSignal(this.legacyService.metrics$, { initialValue: [] });
  readonly isLoading = toSignal(this.legacyService.loading$, { initialValue: true });

  // New signal-based state alongside legacy
  readonly selectedMetric = signal<string | null>(null);
  readonly filteredMetrics = computed(() => {
    const selected = this.selectedMetric();
    return selected
      ? this.metrics().filter(m => m.category === selected)
      : this.metrics();
  });
}
```

### Pattern 3: Classic Store selectSignal Bridge

```typescript
// src/app/orders/order-list.component.ts
// Consuming Classic Store via selectSignal during migration
export class OrderListComponent {
  private readonly store = inject(Store);

  // Use selectSignal to get signals from classic store
  readonly orders = this.store.selectSignal(selectAllOrders);
  readonly loading = this.store.selectSignal(selectOrdersLoading);
  readonly error = this.store.selectSignal(selectOrdersError);

  // Template uses signal reads directly: {{ orders().length }}
}
```

### Pattern 4: AngularJS Service Wrapping

```typescript
// src/app/shared/legacy-bridge.service.ts
// Wrapping AngularJS service during hybrid migration
@Injectable()
export class LegacyBridgeService {
  private readonly data = signal<LegacyData | null>(null);
  readonly currentData = this.data.asReadonly();

  constructor() {
    // Bridge from AngularJS $rootScope event to signal
    const $rootScope = inject('$rootScope' as any); // via ngUpgrade
    $rootScope.$on('data:updated', (_: any, newData: LegacyData) => {
      this.data.set(newData);
    });
  }
}
```

### Pattern 5: Phased Migration Checklist (as code)

```typescript
// migration-utils/migration-status.ts
// Track migration progress across features
interface FeatureMigrationStatus {
  readonly feature: string;
  readonly currentStore: 'angularjs' | 'rxjs-service' | 'classic-ngrx' | 'component-store' | 'signal-store';
  readonly targetStore: 'signal-store' | 'signal-service';
  readonly priority: 'high' | 'medium' | 'low';
  readonly blockers: string[];
  readonly migrated: boolean;
}

export const MIGRATION_TRACKER: FeatureMigrationStatus[] = [
  {
    feature: 'product-catalog',
    currentStore: 'classic-ngrx',
    targetStore: 'signal-store',
    priority: 'high',
    blockers: [],
    migrated: false,
  },
  // ... additional features
];
```

---

## Breaking Changes and Gotchas

### AngularJS to Modern Angular

- AngularJS reached end-of-life in January 2022; no security patches after December 2021
- `$scope` watchers have no direct signal equivalent; refactor to explicit state management
- `$rootScope.$broadcast` / `$on` patterns must be replaced with services, signals, or event buses
- Hybrid apps have performance overhead; `downgradeModule` reduces it but adds complexity
- Two-way binding (`ng-model`) migration requires careful handling with Angular's signal-based forms (experimental)

### RxJS to Signals

- **`toSignal()` requires injection context**: must be called in constructor, field initializer, or `runInInjectionContext`. Common error: calling it inside a method or callback
- **Missing `initialValue`**: without `initialValue`, `toSignal` returns `Signal<T | undefined>`, which propagates `undefined` through computed chains
- **`requireSync: true`**: use only with `BehaviorSubject` or `ReplaySubject(1)` that emit synchronously on subscribe; throws if observable does not emit synchronously
- **Memory**: `toSignal` auto-unsubscribes on destroy; do not also manually unsubscribe
- **`toObservable` timing**: signal changes are batched; multiple rapid `.set()` calls produce a single emission
- **Over-migration**: not every `Observable` needs to become a signal. Complex async pipelines (retry, debounce, race) should stay as RxJS
- **No signal equivalent for**: `switchMap`, `exhaustMap`, `concatMap`, `mergeMap`, `debounceTime`, `throttleTime`, `retryWhen` -- keep RxJS for these

### NgRx Classic to SignalStore

- `withEffects` renamed to `withEventHandlers` in NgRx v21; migration schematic available
- `selectSignal` on Classic Store returns a `Signal<T>` that bridges the two worlds
- NgRx v20 `tapResponse` moved from `@ngrx/component-store` to `@ngrx/operators`
- SignalStore `patchState` takes partial state only (no spread of previous state needed, unlike Classic Store reducers)
- Entity adapter `sortComparer` works differently in `withEntities` vs `@ngrx/entity`
- Classic Store meta-reducers have no direct SignalStore equivalent; use `withHooks` + custom features
- DevTools integration works for both, but SignalStore uses a different registration mechanism

---

## Sources

### Official Documentation
- [Angular RxJS Interop](https://angular.dev/ecosystem/rxjs-interop) -- toSignal, toObservable, rxResource API reference
- [Angular Migration Schematics Overview](https://angular.dev/reference/migrations) -- signal inputs, queries, outputs, control flow
- [Angular Signal Inputs Migration](https://angular.dev/reference/migrations/signal-inputs) -- automated @Input to input() migration
- [Angular Signal Queries Migration](https://angular.dev/reference/migrations/signal-queries) -- automated ViewChild/ContentChild migration
- [NgRx V21 Update Guide](https://ngrx.io/guide/migration/v21) -- withEffects to withEventHandlers, scoped events
- [NgRx V20 Update Guide](https://ngrx.io/guide/migration/v20) -- tapResponse move, Events Plugin introduction
- [NgRx SignalStore Documentation](https://ngrx.io/guide/signals/signal-store)
- [Upgrading from AngularJS (Angular v17 docs)](https://v17.angular.io/guide/upgrade) -- ngUpgrade, hybrid apps
- [downgradeModule API](https://angular.dev/api/upgrade/static/downgradeModule) -- lazy Angular bootstrap in hybrid apps

### Blog Posts and Articles
- [NgRx: From Classic Store to Signal Store](https://medium.com/@fabio.cabi/ngrx-from-the-classic-store-to-the-signal-store-what-changes-for-angular-developers-816c8d05f18d) -- Feb 2026 comparison
- [Announcing NgRx 21](https://dev.to/ngrx/announcing-ngrx-21-celebrating-a-10-year-journey-with-a-fresh-new-look-and-ngrxsignalsevents-5ekp) -- scoped events, signalMethod changes
- [Full-Cycle Reactivity (Angular Architects)](https://www.angulararchitects.io/en/blog/full-cycle-reativity-in-angular-signal-forms-signal-store-resources-mutation-api/) -- Manfred Steyer on Resource API + Signal Store + Signal Forms
- [Service with a Subject vs Service with a Signal](https://modernangular.com/articles/service-with-a-signal-in-angular) -- direct comparison
- [Signals vs RxJS (Angular Experts)](https://angularexperts.io/blog/signals-vs-rxjs/) -- when to use which
- [Angular Signals: The End of RxJS Boilerplate?](https://www.codemag.com/Article/2509051/Angular-Signals-The-End-of-RxJS-Boilerplate)
- [Migrating from RxJS to Angular Signals (Real-World Perspective)](https://dev.to/amrita_16030702/migrating-from-rxjs-to-angular-signals-a-real-world-perspective-from-a-frontend-lead-dg8)
- [Avoid These Angular Signals Mistakes](https://dev.to/codewithrajat/avoid-these-angular-signals-mistakes-a-must-read-for-every-developer-3d72)
- [From NgRx ComponentStore to SignalStore](https://www.angularaddicts.com/p/from-ngrx-componentstore-to-signalstore) -- key takeaways
- [Manfred Steyer: Migration to Signals (Speaker Deck, Angular Days 03/2026)](https://speakerdeck.com/manfredsteyer/2026-munich)
- [Angular 21 Release Features and Migration Guide](https://www.kellton.com/kellton-tech-blog/angular-21-release-features-benefits-migration-guide)

### GitHub Issues
- [withEffects to withEventHandlers rename](https://github.com/ngrx/platform/issues/4976)
- [Migration schematic for withEventHandlers](https://github.com/ngrx/platform/issues/5010)
- [v21 Migration Guide tracking issue](https://github.com/ngrx/platform/issues/5017)
- [PSA: Angular v21 and NgRx v21](https://github.com/ngrx/platform/issues/5005)

---

## Open Questions

1. **AngularJS hybrid app state sharing**: The ngUpgrade docs are frozen at Angular v17 documentation. Need to verify if `@angular/upgrade` is still shipped with Angular 21 or if it has been deprecated/removed. The `@angular/upgrade/static` package may be in maintenance-only mode.

2. **selectSignal availability**: Verify that `Store.selectSignal()` is still the recommended bridge API in NgRx v21 Classic Store, or if there is a newer interop mechanism.

3. **Signal Forms maturity**: Signal Forms are experimental in Angular 21. For the AngularJS migration section, should we recommend migrating AngularJS forms directly to signal forms, or to traditional reactive forms first? Likely the latter given experimental status.

4. **Zoneless impact on hybrid apps**: AngularJS hybrid apps rely on Zone.js for change detection coordination between frameworks. Angular 21 is zoneless by default. Need to verify how `ngUpgrade` works in a zoneless Angular 21 app -- likely requires explicit `provideZoneChangeDetection()`.

5. **NgRx Classic Store long-term support**: The NgRx team has not announced deprecation of Classic Store. Confirm this is still the case as of v21 so we can advise teams that coexistence is a valid permanent state.
