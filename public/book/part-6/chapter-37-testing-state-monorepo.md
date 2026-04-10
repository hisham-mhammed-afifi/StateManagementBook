# Chapter 37: Testing State in a Monorepo

Your Nx monorepo has grown to forty libraries and four micro-frontend applications. A developer changes a utility function in `libs/shared/models`. The CI pipeline runs every test in every library and every application. It takes 38 minutes. Three developers merge PRs before the pipeline finishes, triggering three more 38-minute runs. By mid-afternoon, the queue is four builds deep and the team is guessing whether their code works. The problem is not the tests themselves. The problem is running all of them all the time. This chapter solves that problem with three tools: Nx's `affected` command to run only the tests that matter, computation caching to never re-run a test whose inputs have not changed, and CI pipeline strategies that distribute work across machines. Along the way, we will cover how to test shared state libraries that multiple MFEs depend on, how to mock NgRx stores across library boundaries, and how to wire everything together in a GitHub Actions workflow.

## The Project Graph: Why Nx Knows What to Test

Every Nx workspace maintains a project graph: a directed acyclic graph of all projects (libraries and applications) and the dependencies between them. Nx builds this graph by statically analyzing import statements across the workspace. When you import `@mfe-platform/shared-models` in `libs/products/data-access/src/lib/products.store.ts`, Nx records a dependency edge from `products-data-access` to `shared-models`.

This graph is the foundation of intelligent test execution. When a file changes, Nx identifies which project owns that file, then walks the graph to find every project that transitively depends on it. Only those projects are "affected" by the change.

Visualize it at any time:

```bash
# Launch interactive graph visualization
npx nx graph

# Show only the affected subgraph for the current PR
npx nx graph --affected

# Export the graph as JSON for scripting
npx nx graph --file=graph.json
```

Imagine this dependency chain: `shared-models` is imported by `shared-data-access-auth`, which is imported by `products-data-access`, which is imported by `products-feature`, which is imported by `mfe-products`. If a developer changes a type in `shared-models`, all five projects are affected. If they change a component template in `products-feature`, only `products-feature` and `mfe-products` are affected. The key insight: the graph prunes the entire left side of the tree, saving the team from running irrelevant tests.

### Configuring the Default Base Branch

Nx compares the current branch against a base branch to determine what changed. Configure the default in `nx.json`:

```json
// nx.json
{
  "defaultBase": "main",
  "namedInputs": {
    "default": ["{projectRoot}/**/*", "sharedGlobals"],
    "sharedGlobals": ["{workspaceRoot}/tsconfig.base.json"]
  }
}
```

The `namedInputs` section tells Nx which files contribute to a project's cache key. Changes to `tsconfig.base.json` invalidate every project because it is a shared global. Adding targeted named inputs for different task types (test vs build) gives you finer-grained control over when caches are invalidated.

## Running Only Affected Tests

The `nx affected` command is the single most impactful CI optimization in a monorepo. It combines the project graph with git diff to run tasks on only the projects that could be impacted by a change.

```bash
# Run tests for affected projects only
npx nx affected -t test

# Run multiple targets on affected projects
npx nx affected -t lint test build

# Run tests with increased parallelism
npx nx affected -t test --parallel=5

# Exclude specific projects
npx nx affected -t test --exclude=mfe-products-e2e

# Specify a custom base commit
npx nx affected -t test --base=origin/main --head=HEAD
```

For our 40-library workspace, a typical PR touches two or three libraries. Instead of running 40 test suites, `nx affected` runs three. CI drops from 38 minutes to 4.

### Smart Lock File Handling

By default, Nx marks every project as affected when the package lock file changes. This is the conservative choice, but it is almost always too aggressive. A lock file change from updating `lodash` should not re-test your authentication library if it does not import `lodash`.

```json
// nx.json
{
  "pluginsConfig": {
    "@nx/js": {
      "projectsAffectedByDependencyUpdates": "auto"
    }
  }
}
```

Setting `projectsAffectedByDependencyUpdates` to `"auto"` tells Nx to analyze which packages actually changed in the lock file and only mark projects that depend on those specific packages. This prevents a minor dependency bump from triggering a full workspace rebuild.

## Computation Caching: Never Run the Same Test Twice

Nx caches the result of every task by default. The cache key is computed from the task's inputs: source files, configuration, environment variables, and the outputs of upstream dependencies. When you run `nx test products-data-access` and the test passes, Nx stores the terminal output and any generated files. The next time you run the same command with the same inputs, Nx replays the stored output instantly instead of executing the test again.

This works locally without any configuration. But the real power comes when you share the cache across your team and CI.

### Remote Caching with Nx Cloud

Local caching saves time for individual developers, but each CI run starts with a cold cache. Remote caching (called Nx Replay) stores cache artifacts in the cloud so that every CI run and every developer machine shares the same cache.

```bash
# Connect your workspace to Nx Cloud
npx nx connect
```

After connecting, cache artifacts are automatically uploaded after each task and downloaded before each task. The effect is dramatic: a CI run that would take 20 minutes with local-only caching completes in 6 minutes because most tasks were already cached by a previous run or a developer's local build.

### Self-Hosted Cache Options

If your organization cannot use a managed cloud service, Nx provides official plugins for self-hosted caching:

```bash
# Amazon S3
npx nx add @nx/s3-cache

# Google Cloud Storage
npx nx add @nx/gcs-cache

# Azure Blob Storage
npx nx add @nx/azure-cache

# Shared file system (NFS, EFS)
npx nx add @nx/shared-fs-cache
```

A word of caution on self-hosted caching: CVE-2025-36852 (nicknamed CREEP) is a critical vulnerability that allows anyone with PR access to poison bucket-based caches. Poisoned cache entries can inject arbitrary code into downstream builds. If you self-host, ensure your cache plugin supports signed or verified artifacts. The managed Nx Cloud service is not affected because it uses immutable, encrypted cache entries.

## Testing Shared State Libraries

In our MFE platform, state libraries sit in `libs/shared/` and are consumed by multiple applications. Testing these libraries follows two distinct patterns: testing the store itself, and testing components that consume the store.

### Testing a SignalStore Directly

A SignalStore in a shared library is tested by instantiating it through `TestBed`, calling its methods, and asserting on its signals. The test exercises the real store logic with no mocks.

```typescript
// libs/shared/data-access-auth/src/lib/auth.store.spec.ts
import { TestBed } from '@angular/core/testing';
import { patchState } from '@ngrx/signals';
import { AuthStore } from './auth.store';

describe('AuthStore', () => {
  let store: InstanceType<typeof AuthStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AuthStore],
    });
    store = TestBed.inject(AuthStore);
  });

  it('should start with no authenticated user', () => {
    expect(store.user()).toBeNull();
    expect(store.isAuthenticated()).toBe(false);
  });

  it('should set user on login', () => {
    store.login({ username: 'admin', token: 'jwt-abc-123' });

    expect(store.user()).toEqual({ username: 'admin', token: 'jwt-abc-123' });
    expect(store.isAuthenticated()).toBe(true);
  });

  it('should clear user on logout', () => {
    store.login({ username: 'admin', token: 'jwt-abc-123' });
    store.logout();

    expect(store.user()).toBeNull();
    expect(store.isAuthenticated()).toBe(false);
  });

  it('should be the same instance when injected twice', () => {
    const store2 = TestBed.inject(AuthStore);
    expect(store).toBe(store2);
  });
});
```

When the store has HTTP dependencies, provide Angular's testing HTTP client:

```typescript
// libs/products/data-access/src/lib/products.store.spec.ts
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { ProductsStore } from './products.store';

describe('ProductsStore', () => {
  let store: InstanceType<typeof ProductsStore>;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        ProductsStore,
      ],
    });
    store = TestBed.inject(ProductsStore);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should initialize with empty products', () => {
    expect(store.products()).toEqual([]);
    expect(store.isLoading()).toBe(false);
  });

  it('should load products from the API', () => {
    const mockProducts = [
      { id: 1, name: 'Laptop', price: 999 },
      { id: 2, name: 'Mouse', price: 29 },
    ];

    store.loadAll();
    expect(store.isLoading()).toBe(true);

    const req = httpMock.expectOne('/api/products');
    req.flush(mockProducts);

    expect(store.products()).toEqual(mockProducts);
    expect(store.isLoading()).toBe(false);
    expect(store.productsCount()).toBe(2);
  });

  it('should handle API errors', () => {
    store.loadAll();

    const req = httpMock.expectOne('/api/products');
    req.flush('Server error', { status: 500, statusText: 'Internal Server Error' });

    expect(store.error()).toBe('Failed to load products');
    expect(store.isLoading()).toBe(false);
  });
});
```

### Mocking a SignalStore for Component Tests

When testing a component that injects a SignalStore, you do not want the component test to depend on the store's real HTTP calls or complex initialization. Create a manual mock using signals:

```typescript
// libs/products/feature/src/lib/product-list.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ProductListComponent } from './product-list.component';
import { ProductsStore } from '@mfe-platform/products-data-access';

describe('ProductListComponent', () => {
  let fixture: ComponentFixture<ProductListComponent>;

  const mockStore = {
    products: signal([
      { id: 1, name: 'Laptop', price: 999 },
      { id: 2, name: 'Mouse', price: 29 },
    ]),
    isLoading: signal(false),
    error: signal<string | null>(null),
    productsCount: signal(2),
    loadAll: jest.fn(),
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

  it('should render one row per product', () => {
    const rows = fixture.nativeElement.querySelectorAll('[data-testid="product-row"]');
    expect(rows.length).toBe(2);
  });

  it('should show the loading indicator when loading', () => {
    mockStore.isLoading.set(true);
    fixture.detectChanges();

    const spinner = fixture.nativeElement.querySelector('[data-testid="loading-spinner"]');
    expect(spinner).toBeTruthy();
  });

  it('should call loadAll on init', () => {
    expect(mockStore.loadAll).toHaveBeenCalled();
  });

  it('should call deleteProduct when the delete button is clicked', () => {
    const deleteBtn = fixture.nativeElement.querySelector('[data-testid="delete-btn"]');
    deleteBtn.click();

    expect(mockStore.deleteProduct).toHaveBeenCalledWith(1);
  });
});
```

The mock object mirrors the store's public API: the same signal properties, the same method names. Because the component accesses the store through `inject(ProductsStore)`, providing a mock via `useValue` replaces the real store entirely. The component cannot tell the difference.

### Testing Classic Store Selectors

Selectors are pure functions. They need no `TestBed`, no mocking, and no async setup. Test the projector directly:

```typescript
// libs/products/data-access/src/lib/selectors/product.selectors.spec.ts
import {
  selectFilteredProducts,
  selectProductCount,
  selectTotalValue,
} from './product.selectors';

describe('Product Selectors', () => {
  const products = [
    { id: 1, name: 'Laptop', price: 999, category: 'electronics' },
    { id: 2, name: 'Mouse', price: 29, category: 'electronics' },
    { id: 3, name: 'Desk', price: 350, category: 'furniture' },
  ];

  it('should count products', () => {
    expect(selectProductCount.projector(products)).toBe(3);
  });

  it('should filter by category', () => {
    const result = selectFilteredProducts.projector(products, 'furniture');
    expect(result).toEqual([{ id: 3, name: 'Desk', price: 350, category: 'furniture' }]);
  });

  it('should sum total value', () => {
    expect(selectTotalValue.projector(products)).toBe(1378);
  });
});
```

Selector tests run in under a millisecond. They are the fastest tests in your monorepo and the best candidates for catching regressions in derived state logic.

## Enforcing Boundaries with Module Boundary Rules

Testing in a monorepo is not just about running tests. It is also about preventing invalid dependencies from forming in the first place. Nx's `@nx/enforce-module-boundaries` lint rule ensures that libraries only import from libraries they are allowed to depend on.

```json
// eslint.config.js (workspace root, relevant section)
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
            "sourceTag": "scope:orders",
            "onlyDependOnLibsWithTags": ["scope:orders", "scope:shared"]
          },
          {
            "sourceTag": "type:feature",
            "onlyDependOnLibsWithTags": ["type:data-access", "type:ui", "type:util"]
          },
          {
            "sourceTag": "type:data-access",
            "onlyDependOnLibsWithTags": ["type:data-access", "type:util", "type:models"]
          }
        ]
      }
    ]
  }
}
```

Each library declares its tags in `project.json`:

```json
// libs/products/data-access/project.json
{
  "name": "products-data-access",
  "tags": ["scope:products", "type:data-access"]
}
```

```json
// libs/shared/models/project.json
{
  "name": "shared-models",
  "tags": ["scope:shared", "type:models"]
}
```

When `nx affected -t lint` runs, this rule catches any import that crosses a boundary. A `products-feature` library importing directly from `orders-data-access` fails the lint check, forcing the developer to either move shared logic into a `scope:shared` library or rethink the dependency.

This is a testing concern because boundary violations silently expand the affected set. If `products-feature` imports from `orders-data-access`, a change to any order-related code now triggers product tests too. Clean boundaries keep the affected graph tight.

## CI Pipeline Strategies

### Basic GitHub Actions with Affected

The simplest CI pipeline combines `nx affected` with the `nrwl/nx-set-shas` action, which automatically determines the correct base and head commits by finding the last successful CI run on the main branch.

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

Two details matter. First, `fetch-depth: 0` is mandatory. Without the full git history, `nx affected` cannot compute the diff and falls back to running everything. Second, `nrwl/nx-set-shas` sets the `NX_BASE` and `NX_HEAD` environment variables automatically. Without it, you must manually pass `--base` and `--head`, which is error-prone on merge commits and squash merges.

### Distributed Execution with Nx Agents

For large monorepos where `affected` still surfaces dozens of projects, distributing tasks across multiple CI machines cuts pipeline time further. Nx Agents (powered by Nx Cloud) handle this automatically.

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

The `start-ci-run` command provisions three cloud agents. Nx distributes tasks across those agents based on historical run times and dependency ordering, keeping all machines busy. The `--stop-agents-after="build"` flag tells the agents to shut down after the `build` target completes, avoiding charges for idle time.

The `e2e-ci` target (note the `-ci` suffix) uses Nx's test atomizer, which automatically splits large e2e test suites into per-file targets. Instead of running all Cypress or Playwright specs in a single process, each spec file becomes its own distributable task. This enables finer-grained parallelism and makes flaky tests easier to identify.

### Dynamic Agent Allocation

Not every PR needs the same CI horsepower. A one-line README fix should not spin up ten agents. Nx supports dynamic allocation based on changeset size:

```yaml
# .nx/workflows/distribution-config.yaml
distribute-on:
  small-changeset: 2 linux-medium-js
  medium-changeset: 5 linux-medium-js
  large-changeset: 8 linux-medium-js
  extra-large-changeset: 12 linux-medium-js
```

Reference this file in the CI command:

```bash
npx nx-cloud start-ci-run \
  --distribute-on=".nx/workflows/distribution-config.yaml" \
  --stop-agents-after="build"
```

Nx categorizes PRs by the percentage of workspace projects affected: small is 1-25%, medium is 26-50%, large is 51-75%, and extra-large is 76-100%. A developer updating a shared model (high fan-out) gets 12 agents. A developer tweaking a feature component (low fan-out) gets 2.

### Handling Flaky Tests

Flaky tests are the silent killer of CI trust. A test that fails intermittently trains the team to ignore failures and retry blindly. Nx Agents detect flaky tests automatically: when a task fails with a particular set of inputs and then succeeds with those same inputs on a subsequent run, Nx marks it as flaky.

When a flaky task fails, Nx retries it on a *different* agent. This is critical because flaky failures often persist when re-run on the same machine due to environmental side effects like stale database state, port conflicts, or filesystem artifacts. Running on a fresh agent gives the retry the best chance of succeeding.

The flaky designation persists for two weeks without incidents. The Nx Cloud dashboard surfaces which flaky tasks waste the most CI time, giving teams a prioritized list of tests to stabilize.

### Self-Healing CI

The `nx fix-ci` command is a recent addition that uses static analysis to suggest fixes for broken CI pipelines. Add it with `if: always()` so it runs even when previous steps fail:

```yaml
      - run: npx nx fix-ci
        if: always()
```

It analyzes the failure, generates a potential fix, validates the fix locally, and applies it if confident. About two-thirds of broken PRs receive useful auto-fixes, primarily for issues like missing imports, type errors introduced by upstream changes, and configuration drift.

## Testing MFE State in Isolation

Chapter 33 established that Module Federation is not active during unit tests. When you run `nx test products-data-access`, there is no federation runtime, no remote entry points, and no shared singleton configuration. Tests exercise libraries in isolation through direct TypeScript imports.

This is a feature, not a limitation. Unit tests that depend on the federation runtime would be slow, fragile, and non-deterministic. Reserve federation-aware testing for e2e tests, and keep unit tests focused on business logic.

For shared state libraries consumed by multiple MFEs, the key testing insight is this: the store's behavior is identical regardless of which MFE consumes it. An `AuthStore` test in `libs/shared/data-access-auth` validates the login and logout flows once. Every MFE that imports `AuthStore` inherits that validation through the project graph. If the `AuthStore` tests pass, the store works. Component tests in each MFE then mock the store to verify their own rendering and interaction logic.

This layered approach creates a testing pyramid within the monorepo:

- **Shared library tests** validate store logic, selectors, and effects. These run whenever the library or its dependencies change.
- **Feature library tests** mock stores and validate component rendering and user interactions. These run whenever the feature library or the shared library API changes.
- **Application e2e tests** exercise the full federation runtime, cross-MFE communication, and real API calls. These run whenever any constituent library changes.

The project graph enforces this pyramid naturally. A change to `shared-models` triggers shared library tests, feature library tests, and e2e tests. A change to a feature component triggers only feature tests and e2e tests. A change to an e2e spec triggers only the e2e test itself.

## Common Mistakes

### Mistake 1: Running All Tests on Every PR

```bash
# WRONG: runs every test in the workspace
npx nx run-many -t test --all
```

This ignores the project graph entirely. In a 40-library workspace, most tests are unrelated to the PR's changes. CI times scale linearly with workspace size, and developers lose trust in the pipeline.

```bash
# CORRECT: run only tests affected by the current change
npx nx affected -t test
```

Use `run-many --all` only for nightly or weekly full-regression runs. For PR pipelines, always use `affected`.

### Mistake 2: Shallow Checkout in CI

```yaml
# WRONG: default checkout has depth 1
- uses: actions/checkout@v4
  # No fetch-depth specified -- defaults to 1
```

A shallow clone contains only the latest commit. `nx affected` cannot compute the diff between the current branch and the base branch because the base commit does not exist in the clone. Nx falls back to running everything, silently negating all affected optimizations.

```yaml
# CORRECT: fetch full history for accurate affected detection
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
```

### Mistake 3: Using MockProvider for SignalStore

```typescript
// WRONG: MockProvider does not create signal properties
import { MockProvider } from 'ng-mocks';

TestBed.configureTestingModule({
  providers: [MockProvider(ProductsStore)],
});

// store.products() throws because MockProvider creates undefined, not a signal
```

`MockProvider` replaces methods with stubs but does not understand signals. The mocked store's properties return `undefined` instead of `Signal` objects, causing `TypeError: store.products is not a function` at runtime.

```typescript
// CORRECT: create a manual mock with real signals
const mockStore = {
  products: signal<Product[]>([]),
  isLoading: signal(false),
  productsCount: signal(0),
  loadAll: jest.fn(),
};

TestBed.configureTestingModule({
  providers: [{ provide: ProductsStore, useValue: mockStore }],
});
```

### Mistake 4: Not Configuring Lock File Sensitivity

```json
// WRONG (default): every lock file change re-tests everything
{
  "pluginsConfig": {
    "@nx/js": {
      "projectsAffectedByDependencyUpdates": "all"
    }
  }
}
```

With `"all"`, running `npm update lodash` marks every project as affected, triggering a full test run. In a workspace with frequent dependency updates, this eliminates most of the benefit of `affected`.

```json
// CORRECT: only affect projects that actually use the updated package
{
  "pluginsConfig": {
    "@nx/js": {
      "projectsAffectedByDependencyUpdates": "auto"
    }
  }
}
```

The `"auto"` setting analyzes the lock file diff to determine which packages changed, then only marks projects that import those specific packages.

## Key Takeaways

- **Use `nx affected -t test` for every PR pipeline.** It uses the project graph to run only the tests impacted by a change, typically reducing CI time by 80% or more compared to running all tests.

- **Enable remote caching early.** `npx nx connect` shares cached test results across developers and CI runs. A test that passed on a colleague's machine five minutes ago does not need to run again on yours.

- **Test shared state libraries directly and mock them in consumers.** SignalStore tests in `libs/shared/` validate business logic once. Component tests in feature libraries provide mock signals via `useValue` and focus on rendering and interaction.

- **Enforce module boundaries with lint rules.** Invalid cross-scope imports silently expand the affected graph, causing unrelated tests to run. The `@nx/enforce-module-boundaries` rule catches these at lint time before they degrade CI performance.

- **Distribute CI with Nx Agents for large workspaces.** Dynamic agent allocation scales CI resources to match the size of each PR, keeping small changes fast and large refactors feasible.
