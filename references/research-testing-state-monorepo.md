# Research: Testing State in a Monorepo

**Date:** 2026-04-09
**Chapter:** Ch 37
**Status:** Ready for chapter generation

## API Surface

### Nx CLI Commands

| Command | Description | Stability |
|---------|-------------|-----------|
| `nx affected -t <target>` | Run tasks only on projects affected by PR changes | Stable |
| `nx run-many -t <target>` | Run tasks across multiple/all projects | Stable |
| `nx graph` | Visualize project dependency graph | Stable |
| `nx graph --affected` | Visualize only affected projects | Stable |
| `nx show project <name>` | Show project configuration details | Stable |
| `nx show projects` | List all projects in workspace | Stable |
| `nx connect` | Connect workspace to Nx Cloud | Stable |
| `nx g ci-workflow` | Generate CI workflow config | Stable |
| `nx start-ci-run` | Start distributed CI run (Nx Cloud) | Stable |
| `nx fix-ci` | Self-healing CI (auto-fix broken PRs) | Stable |

### Nx Affected Flags

| Flag | Default | Purpose |
|------|---------|---------|
| `--base` | main branch | Base commit for comparison |
| `--head` | current filesystem | Head commit for comparison |
| `--files` | -- | Manually specify changed files |
| `--parallel` | 3 | Max concurrent processes |
| `--exclude` | -- | Exclude specific projects |
| `--nxBail` | false | Stop on first failure |
| `--skipNxCache` | false | Bypass local cache |
| `--skipRemoteCache` | false | Bypass remote cache |
| `--graph` | -- | Visualize the task graph |

### nx.json Configuration

```json
{
  "defaultBase": "main",
  "pluginsConfig": {
    "@nx/js": {
      "projectsAffectedByDependencyUpdates": "auto"
    }
  }
}
```

- `"auto"`: Smart detection, only marks projects depending on updated packages
- `"all"`: Conservative default, marks everything affected on lock file change
- `string[]`: Array of specific project names

### NgRx Testing APIs

| API | Import | Purpose | Stability |
|-----|--------|---------|-----------|
| `provideMockStore()` | `@ngrx/store/testing` | Mock Classic Store for component tests | Stable |
| `MockStore` | `@ngrx/store/testing` | Typed mock store class | Stable |
| `provideMockActions()` | `@ngrx/effects/testing` | Mock action stream for effect tests | Stable |
| `patchState()` | `@ngrx/signals` | Programmatically update SignalStore state | Stable |
| `provideMockSignalStore()` | Community pattern | Mock SignalStore for component tests | Community |

### GitHub Actions

| Action | Purpose |
|--------|---------|
| `nrwl/nx-set-shas@v5` | Auto-determine base/head SHAs from last successful CI run |
| `actions/checkout@v4` with `fetch-depth: 0` | Full git history required for `nx affected` |

## Key Concepts

### Nx Affected Command
- Uses Git diff to identify changed files, maps them to projects via the project graph, then transitively finds all dependent projects.
- Only affected projects run their tasks (test, lint, build), dramatically reducing CI times (often 80%+ reduction).
- `defaultBase` in `nx.json` controls the default base branch (usually `main`).

### Nx Computation Caching
- **Local cache**: All task results are cached locally by default. Re-running a cached task replays stored outputs instantly.
- **Remote cache (Nx Replay)**: Shares cache across team members and CI machines. 30-70% faster CI observed.
- **Self-hosted options**: `@nx/s3-cache` (AWS S3), `@nx/gcs-cache` (GCP), `@nx/azure-cache` (Azure Blob), `@nx/shared-fs-cache` (shared filesystem).
- **Security**: CVE-2025-36852 (CREEP) -- critical vulnerability in bucket-based self-hosted caches allowing cache poisoning from PR access. Use signed caches or Nx Cloud managed service.

### Distributed Task Execution (Nx Agents)
- Distributes tasks across multiple CI machines based on historical run times and dependency ordering.
- Dynamic agent allocation: configure different agent counts based on changeset size.
- Continuous task feeding: agents receive tasks in real-time rather than batch assignment.
- Resource tracking: records CPU/RAM usage per task for optimization.

### Testing State Across MFE Boundaries
- Shared state lives in Nx libraries (e.g., `libs/shared/data-store`).
- `singleton: true` in Module Federation config prevents duplicate store instances.
- Unit tests run per-library in isolation without Module Federation active.
- E2E tests (Cypress/Playwright) are the only way to exercise actual federation runtime.

### Flaky Test Handling
- Nx identifies flaky tasks by cache comparison: same inputs, different outcomes.
- Automatic retry on a **different agent** (up to 2 tries). Different agent is critical because environmental side effects often persist on the same machine.
- Flaky task analytics dashboard identifies which tasks cause the most CI waste.
- Flaky designation persists until 2 weeks without incidents.

### Test Atomizer (Test Splitting)
- Automatically splits e2e test suites into per-file runnable targets.
- Use the `-ci` variant of targets: `nx affected -t e2e-ci` instead of `e2e`.
- Enables finer-grained distribution and easier flaky test identification.

### Self-Healing CI
- `nx fix-ci` command attempts to automatically fix broken PRs.
- Add to CI pipeline with `if: always()` (GitHub Actions).
- About two-thirds of broken PRs receive effective auto-fixes as of 2025.

## Code Patterns

### Testing a SignalStore in a Shared Library

```typescript
// libs/shared/data-access/src/lib/products.store.spec.ts
import { TestBed } from '@angular/core/testing';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { patchState } from '@ngrx/signals';
import { ProductsStore } from './products.store';

describe('ProductsStore', () => {
  let store: InstanceType<typeof ProductsStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        ProductsStore,
      ],
    });
    store = TestBed.inject(ProductsStore);
  });

  it('should initialize with empty products', () => {
    expect(store.products()).toEqual([]);
    expect(store.isLoading()).toBe(false);
  });

  it('should update computed signals when state changes', () => {
    patchState(store, { products: [{ id: 1, name: 'Test' }] });
    expect(store.productsCount()).toBe(1);
  });
});
```

### Mocking a SignalStore for Component Tests

```typescript
// libs/products/feature/src/lib/product-list.component.spec.ts
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ProductListComponent } from './product-list.component';
import { ProductsStore } from '@myorg/shared/data-access';

describe('ProductListComponent', () => {
  let fixture: ComponentFixture<ProductListComponent>;

  const mockStore = {
    products: signal([{ id: 1, name: 'Widget' }]),
    isLoading: signal(false),
    productsCount: signal(1),
    loadProducts: jest.fn(),
    deleteProduct: jest.fn(),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProductListComponent],
      providers: [
        { provide: ProductsStore, useValue: mockStore },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProductListComponent);
    fixture.detectChanges();
  });

  it('should display products from the store', () => {
    const items = fixture.nativeElement.querySelectorAll('.product-item');
    expect(items.length).toBe(1);
  });

  it('should call deleteProduct on store when delete clicked', () => {
    const deleteBtn = fixture.nativeElement.querySelector('.delete-btn');
    deleteBtn.click();
    expect(mockStore.deleteProduct).toHaveBeenCalledWith(1);
  });
});
```

### Testing Classic Store Selectors (Pure Function, No TestBed)

```typescript
// libs/shared/data-access/src/lib/selectors/product.selectors.spec.ts
import { selectProductCount, selectFilteredProducts } from './product.selectors';

describe('Product Selectors', () => {
  it('should return product count', () => {
    const result = selectProductCount.projector([
      { id: 1, name: 'A' },
      { id: 2, name: 'B' },
    ]);
    expect(result).toBe(2);
  });

  it('should return filtered products', () => {
    const products = [
      { id: 1, name: 'Widget', category: 'tools' },
      { id: 2, name: 'Gadget', category: 'electronics' },
    ];
    const result = selectFilteredProducts.projector(products, 'tools');
    expect(result).toEqual([{ id: 1, name: 'Widget', category: 'tools' }]);
  });
});
```

### Testing Effects with provideMockActions

```typescript
// libs/shared/data-access/src/lib/effects/product.effects.spec.ts
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { Observable, of } from 'rxjs';
import { ProductEffects } from './product.effects';
import { ProductActions } from '../actions/product.actions';

describe('ProductEffects', () => {
  let effects: ProductEffects;
  let actions$: Observable<any>;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ProductEffects,
        provideMockActions(() => actions$),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    effects = TestBed.inject(ProductEffects);
    httpMock = TestBed.inject(HttpTestingController);
  });

  it('should load products successfully', (done) => {
    const products = [{ id: 1, name: 'Widget' }];
    actions$ = of(ProductActions.loadProducts());

    effects.loadProducts$.subscribe((action) => {
      expect(action).toEqual(
        ProductActions.loadProductsSuccess({ products })
      );
      done();
    });

    const req = httpMock.expectOne('/api/products');
    req.flush(products);
  });
});
```

### Integration Test with Angular Testing Library

```typescript
// libs/products/feature/src/lib/product-list.component.integration.spec.ts
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { ProductListComponent } from './product-list.component';
import { selectProducts, selectLoading } from '@myorg/shared/data-access';

describe('ProductListComponent (Integration)', () => {
  async function setup() {
    const renderResult = await render(ProductListComponent, {
      providers: [
        provideMockStore({
          selectors: [
            { selector: selectProducts, value: [{ id: 1, name: 'Widget' }] },
            { selector: selectLoading, value: false },
          ],
        }),
      ],
    });
    const store = TestBed.inject(MockStore);
    return { ...renderResult, store };
  }

  it('should display products', async () => {
    await setup();
    expect(screen.getByText('Widget')).toBeTruthy();
  });

  it('should dispatch delete action on button click', async () => {
    const { store } = await setup();
    const dispatchSpy = jest.spyOn(store, 'dispatch');
    await userEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(dispatchSpy).toHaveBeenCalledWith(
      ProductActions.deleteProduct({ id: 1 })
    );
  });
});
```

### GitHub Actions CI Workflow

```yaml
# .github/workflows/ci.yml
name: CI
on:
  push:
    branches: [main]
  pull_request:
permissions:
  actions: read
  contents: read

jobs:
  main:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: nrwl/nx-set-shas@v5

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - run: npm ci

      - run: npx nx affected -t lint test build --parallel=5
```

### GitHub Actions with Nx Agents (Distributed)

```yaml
# .github/workflows/ci.yml
name: CI
on:
  push:
    branches: [main]
  pull_request:
permissions:
  actions: read
  contents: read

jobs:
  main:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          filter: tree:0

      - uses: nrwl/nx-set-shas@v5

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - run: npm ci

      - run: npx nx-cloud start-ci-run --distribute-on="3 linux-medium-js" --stop-agents-after="build"

      - run: npx nx affected -t lint test build e2e-ci

      - run: npx nx fix-ci
        if: always()
```

### Dynamic Agent Allocation Config

```yaml
# .nx/workflows/distribution-config.yaml
distribute-on:
  small-changeset: 3 linux-medium-js
  medium-changeset: 6 linux-medium-js
  large-changeset: 10 linux-medium-js
  extra-large-changeset: 15 linux-medium-js
```

### Testing a Shared State Library Used by Multiple MFEs

```typescript
// libs/shared/auth-state/src/lib/auth.store.spec.ts
import { TestBed } from '@angular/core/testing';
import { patchState } from '@ngrx/signals';
import { AuthStore } from './auth.store';

describe('AuthStore (shared across MFEs)', () => {
  let store: InstanceType<typeof AuthStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AuthStore],
    });
    store = TestBed.inject(AuthStore);
  });

  it('should be a singleton when provided at root', () => {
    const store2 = TestBed.inject(AuthStore);
    expect(store).toBe(store2);
  });

  it('should update user on login', () => {
    store.login({ username: 'admin', token: 'abc123' });
    expect(store.user()).toEqual({ username: 'admin', token: 'abc123' });
    expect(store.isAuthenticated()).toBe(true);
  });

  it('should clear state on logout', () => {
    store.login({ username: 'admin', token: 'abc123' });
    store.logout();
    expect(store.user()).toBeNull();
    expect(store.isAuthenticated()).toBe(false);
  });
});
```

### Module Federation Shared Mappings for Test Consistency

```javascript
// webpack.config.js (shell and all remotes)
const { withModuleFederationPlugin, share } = require('@angular-architects/module-federation/webpack');
const path = require('path');

module.exports = withModuleFederationPlugin({
  shared: share({
    '@ngrx/store': { singleton: true, strictVersion: true },
    '@ngrx/signals': { singleton: true, strictVersion: true },
    '@myorg/shared/auth-state': { singleton: true, strictVersion: true },
  }),
});
```

### Nx Project Tags for Test Scope Enforcement

```json
// libs/shared/auth-state/project.json
{
  "name": "shared-auth-state",
  "tags": ["scope:shared", "type:data-access"]
}
```

```json
// .eslintrc.json (workspace root)
{
  "rules": {
    "@nx/enforce-module-boundaries": [
      "error",
      {
        "depConstraints": [
          {
            "sourceTag": "scope:products",
            "onlyDependOnLibsWithTags": ["scope:products", "scope:shared"]
          },
          {
            "sourceTag": "type:feature",
            "onlyDependOnLibsWithTags": ["type:data-access", "type:ui", "type:util"]
          }
        ]
      }
    ]
  }
}
```

## Breaking Changes and Gotchas

### Nx Breaking Changes (v20-v22)
- **Nx 20**: `@nrwl` scoped packages dropped. Use `@nx/` only. Custom task runners deprecated (replaced by `preTasksExecution`/`postTasksExecution` hooks). Rspack becomes default bundler for Module Federation.
- **Nx 21**: Custom task runners API fully removed. Minimum Node version raised to 20.19. Angular 17 support removed.
- **Nx 22**: `nx format` no longer sorts TypeScript path mappings by default; use `--sort-root-tsconfig-paths` to restore previous behavior.

### Common Gotchas
1. **`fetch-depth: 0` required**: Without full git history in CI, `nx affected` fails silently or marks everything as affected.
2. **Lock file changes mark ALL projects affected by default**: Set `projectsAffectedByDependencyUpdates: "auto"` in `nx.json` to only affect projects that depend on updated packages.
3. **Circular dependencies reduce affected benefits**: Changing one project in a cycle affects all projects in that cycle.
4. **Module Federation not active in unit tests**: Unit tests run against individual libraries without MF. Only E2E tests exercise federation runtime. Cross-remote interaction bugs are invisible to unit tests.
5. **Singleton configuration required for shared state**: Without `singleton: true` in MF config, each remote gets its own store instance, causing state divergence.
6. **`NullInjectorError: No provider for ReducerManager`**: Occurs when a remote uses `StoreModule.forFeature()` but the shell hasn't called `StoreModule.forRoot()`. Use `provideMockStore()` in tests to avoid this.
7. **Standard `MockProvider()` does not work with SignalStore**: It doesn't support RxMethods. Use manual mock objects with signals or `provideMockSignalStore()` helper.
8. **CVE-2025-36852 (CREEP)**: Critical vulnerability in bucket-based self-hosted remote caches allowing cache poisoning from anyone with PR access. Use signed caches or Nx Cloud managed service.
9. **Nx cache key considerations**: The local cache at `node_modules/.cache/nx` should be cached in CI but keyed carefully to avoid stale results across branches.

## Sources

### Official Documentation
- https://nx.dev/docs/features/ci-features/affected -- Run Only Tasks Affected by a PR
- https://nx.dev/docs/features/ci-features/remote-cache -- Remote Caching (Nx Replay)
- https://nx.dev/docs/features/ci-features/distribute-task-execution -- Distribute Task Execution (Nx Agents)
- https://nx.dev/docs/features/ci-features/flaky-tasks -- Identify and Re-run Flaky Tasks
- https://nx.dev/docs/features/ci-features/split-e2e-tasks -- Automatically Split E2E Tasks (Atomizer)
- https://nx.dev/docs/features/ci-features/dynamic-agents -- Dynamically Allocate Agents
- https://nx.dev/docs/features/cache-task-results -- Cache Task Results
- https://nx.dev/docs/concepts/how-caching-works -- How Caching Works
- https://nx.dev/docs/features/explore-graph -- Explore Your Workspace (Project Graph)
- https://nx.dev/docs/guides/tasks--caching/self-hosted-caching -- Self-Hosted Remote Cache
- https://nx.dev/docs/reference/nx-json -- nx.json Reference
- https://nx.dev/nx-api/nx/documents/affected -- Affected CLI Reference
- https://ngrx.io/guide/signals/signal-store/testing -- NgRx SignalStore Testing Guide
- https://ngrx.io/guide/store/testing -- NgRx Store Testing Guide

### Blog Posts and Articles
- https://nx.dev/blog/announcing-nx-20 -- Announcing Nx 20
- https://nx.dev/blog/nx-21-release -- Nx 21 Release
- https://nx.dev/blog/nx-22-release -- Nx 22 Release
- https://nx.dev/blog/wrapping-up-2025 -- Wrapping Up 2025
- https://nx.dev/blog/nx-2026-roadmap -- Nx 2026 Roadmap
- https://nx.dev/blog/reliable-ci-a-new-execution-model-fixing-both-flakiness-and-slowness -- Reliable CI
- https://nx.dev/blog/beyond-remote-cache-unlock-the-full-70-of-your-ci-performance-gains -- Beyond Remote Cache
- https://nx.dev/blog/nx-self-healing-ci -- Self-Healing CI
- https://timdeschryver.dev/blog/testing-an-ngrx-project -- Testing an NgRx project
- https://www.angularaddicts.com/p/how-to-mock-ngrx-signal-stores -- How to mock NgRx Signal Stores

### GitHub
- https://github.com/nrwl/nx-set-shas -- nrwl/nx-set-shas action
- https://github.com/ngrx/platform/discussions/4427 -- mockSignalStore discussion
- https://github.com/nrwl/nx/issues/28434 -- Migrating Nx core to Rust
- https://github.com/angular-architects/module-federation-plugin/issues/11 -- MF shared state issues
- https://github.com/angular-architects/module-federation-plugin/issues/522 -- MF singleton issues

## Open Questions

1. **`provideMockSignalStore()` official status**: This appears to be a community pattern (possibly from `@testing-library/angular` or third-party). Verify whether NgRx v21 includes an official mock helper for SignalStore or if manual signal mocks remain the recommended approach.
2. **Nx Agents pricing**: Dynamic agent allocation and flaky task retry require Nx Cloud. Verify current pricing tiers and whether any features are available on the free tier for OSS projects.
3. **Rspack Module Federation testing**: With Rspack becoming the default MF bundler in Nx 20+, verify whether testing strategies differ from webpack-based MF setups.
4. **`withEventHandlers` testing patterns**: Verify if testing event handlers in SignalStore (renamed from `withEffects` in NgRx v21) requires any special setup beyond standard SignalStore testing.
