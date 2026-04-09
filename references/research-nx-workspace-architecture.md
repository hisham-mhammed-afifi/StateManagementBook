# Research: Nx Workspace Architecture for State

**Date:** 2026-04-09
**Chapter:** Ch 32
**Status:** Ready for chapter generation

## API Surface

### Nx CLI Commands

- `nx g @nx/angular:library <path>` -- Generator for creating Angular libraries. Key options: `--tags`, `--buildable`, `--publishable`, `--importPath`, `--prefix`, `--standalone` (default true). Stable.
- `nx g @nx/angular:ngrx <name>` -- Generator for adding NgRx state to a library. Key options: `--parent`, `--root`, `--barrels`, `--facade`, `--minimal` (default true), `--directory` (default `+state`). Stable.
- `nx graph` -- Opens interactive dependency graph visualization. Options: `--focus <project>`, `--file=output.json`. Stable.
- `nx affected:graph` -- Shows only affected projects in the graph. Stable.
- `nx lint` -- Runs ESLint including `@nx/enforce-module-boundaries` rule. Stable.

### ESLint Rule: `@nx/enforce-module-boundaries`

- Import: `@nx/eslint-plugin`
- Configured in `eslint.config.mjs` (flat config, current standard)
- Key options:
  - `depConstraints[]` -- Array of tag-based dependency rules
    - `sourceTag: string` -- Single tag the source project must have
    - `allSourceTags: string[]` -- ALL tags the source must have (multi-dimensional)
    - `onlyDependOnLibsWithTags: string[]` -- Whitelist of allowed target tags
    - `notDependOnLibsWithTags: string[]` -- Blacklist of forbidden target tags
    - `allowedExternalImports: string[]` -- Whitelist of npm packages
    - `bannedExternalImports: string[]` -- Blacklist of npm packages
  - `enforceBuildableLibDependency: boolean` -- Buildable libs can only import buildable libs
  - `banTransitiveDependencies: boolean` -- Block undeclared transitive deps
  - `allow: string[]` -- Regex patterns for imports to skip validation
  - `allowCircularSelfDependency: boolean` -- Allow self-referencing via alias paths
- Stability: Stable

### Nx Configuration Files

- `nx.json` -- Workspace-level config: plugins, targetDefaults, namedInputs, affected defaults
- `project.json` -- Per-project config: name, tags, targets, sourceRoot, projectType
- `tsconfig.base.json` -- Path mappings for library imports (`@org/lib-name`)

## Key Concepts

### Library Types (The Five-Type System)

| Type | Purpose | Can Depend On |
|------|---------|---------------|
| **feature** | Smart/container components, pages, use-case orchestration | feature, data-access, ui, util |
| **data-access** | HTTP services, state management (NgRx store files, SignalStore) | data-access, util |
| **ui** | Presentational (dumb) components; data only via inputs | ui, util |
| **util** | Helpers, constants, validators, pipes, interfaces/types | util only |
| **shell** | Entry point for a domain or app; routing config, layout | feature, util |

### Directory Organization

Modern Nx follows domain-driven vertical organization:

```
apps/
  shell/                          # Host application (thin shell)
  mfe_products/                   # Remote micro-frontend
libs/
  products/                       # Domain: products
    data-access/                  # State + API services
    feature/                      # Smart components
  orders/                         # Domain: orders
    data-access/
    feature/
  shared/                         # Cross-cutting concerns
    data-access-auth/             # Shared auth state
    models/                       # Shared interfaces (util type)
    ui/                           # Shared presentational components
    utils/                        # Shared helpers
```

### Two-Dimensional Tagging Strategy

Tags are set in each library's `project.json`:

```json
{
  "name": "products-data-access",
  "tags": ["scope:products", "type:data-access"]
}
```

**Dimension 1 - Scope (domain boundary):** `scope:products`, `scope:orders`, `scope:shared`
**Dimension 2 - Type (layer boundary):** `type:feature`, `type:data-access`, `type:ui`, `type:util`, `type:shell`, `type:app`

### Constraint Matrix

| Source | Allowed Types | Allowed Scopes |
|--------|--------------|----------------|
| `type:app` | shell | own + shared |
| `type:shell` | feature, util | own + shared |
| `type:feature` | feature, data-access, ui, util | own + shared |
| `type:data-access` | data-access, util | own + shared |
| `type:ui` | ui, util | own + shared |
| `type:util` | util | own + shared |

**Critical rule**: `scope:shared` can only depend on `scope:shared`, never on domain-specific scopes.

### Where NgRx Files Live

**Classic Store** -- The `@nx/angular:ngrx` generator places files in a `+state` directory inside data-access libraries:

```
libs/products/data-access/src/lib/
  +state/
    products.actions.ts
    products.reducer.ts
    products.effects.ts
    products.selectors.ts
  product.service.ts
```

**SignalStore** -- Lives directly in the data-access library (no actions/reducers split):

```
libs/products/data-access/src/lib/
  products.store.ts
  product.service.ts
```

### Barrel File Public API

The `index.ts` at `libs/<domain>/data-access/src/index.ts` controls what external consumers can access:

```typescript
// libs/products/data-access/src/index.ts
export { ProductService } from './lib/product.service';
export * from './lib/+state/products.actions';
export * from './lib/+state/products.selectors';
// Do NOT export reducers/effects -- they're registered via providers
```

For SignalStore:
```typescript
// libs/products/data-access/src/index.ts
export { ProductsStore } from './lib/products.store';
export { ProductService } from './lib/product.service';
```

### Path Mappings in tsconfig.base.json

```json
{
  "compilerOptions": {
    "paths": {
      "@myorg/products-data-access": ["libs/products/data-access/src/index.ts"],
      "@myorg/products-feature": ["libs/products/feature/src/index.ts"],
      "@myorg/shared-models": ["libs/shared/models/src/index.ts"],
      "@myorg/shared-data-access-auth": ["libs/shared/data-access-auth/src/index.ts"],
      "@myorg/shared-ui": ["libs/shared/ui/src/index.ts"],
      "@myorg/shared-utils": ["libs/shared/utils/src/index.ts"]
    }
  }
}
```

### Sharing State Across Features

When multiple features need the same state, create a shared data-access library:

```
libs/shared/data-access-auth/     # Auth state shared across all features
libs/shared/data-access-cart/     # Cart state shared by products and checkout
```

Principles:
1. Shared library must not know implementation details of consuming apps
2. Use `InjectionToken` to decouple app-specific configuration (e.g., API URLs)
3. Apps provide their own tokens when registering the shared store
4. Shared actions/selectors use a consistent `FEATURE_KEY`

### SignalStore Provisioning by Layer

| Layer | Provisioning | Scope |
|-------|-------------|-------|
| Feature/component-level | `providers: [MyStore]` on component | One instance per component |
| Domain-level shared | `providedIn: 'root'` | Singleton across app |
| Route-level | `providers: [MyStore]` on route | One instance per route |

### Reusable SignalStore Features

Custom `signalStoreFeature()` functions live in shared util libraries:

```typescript
// libs/shared/utils/src/lib/with-loading.feature.ts
export function withLoading() {
  return signalStoreFeature(
    withState({ loading: false }),
    withMethods((store) => ({
      setLoading(loading: boolean) { patchState(store, { loading }); }
    }))
  );
}
```

### Project Crystal / Inferred Tasks

With Nx plugins, many targets are auto-inferred from tool config files (e.g., `vite.config.ts`). This reduces `project.json` boilerplate. Configuration precedence: Inferred (plugins) < `targetDefaults` in `nx.json` < project-specific overrides.

### Nx Dependency Graph

- `nx graph` -- Opens interactive visualization in browser
- `nx graph --focus products-data-access` -- Focus on specific project
- `nx affected:graph` -- Show only affected projects
- Composite mode (default since 2025) prevents crashes in large workspaces (1000+ projects)

## Code Patterns

### Creating Libraries with Tags

```bash
# Create a domain data-access library
nx g @nx/angular:library libs/products/data-access \
  --tags="scope:products,type:data-access" \
  --prefix=products

# Create a shared models library (util type)
nx g @nx/angular:library libs/shared/models \
  --tags="scope:shared,type:util" \
  --prefix=shared

# Create a buildable shared UI library
nx g @nx/angular:library libs/shared/ui \
  --tags="scope:shared,type:ui" \
  --buildable \
  --prefix=shared
```

### Adding NgRx State to a Data-Access Library

```bash
# Add root state to shell app
nx g @nx/angular:ngrx app --root \
  --parent=apps/shell/src/app/app.config.ts

# Add feature state to a data-access library
nx g @nx/angular:ngrx products \
  --parent=libs/products/data-access/src/lib/products-data-access.ts
```

### ESLint Flat Config for Module Boundaries

```javascript
// eslint.config.mjs
import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            {
              sourceTag: 'type:feature',
              onlyDependOnLibsWithTags: [
                'type:feature', 'type:data-access', 'type:ui', 'type:util'
              ],
            },
            {
              sourceTag: 'type:data-access',
              onlyDependOnLibsWithTags: ['type:data-access', 'type:util'],
            },
            {
              sourceTag: 'type:ui',
              onlyDependOnLibsWithTags: ['type:ui', 'type:util'],
            },
            {
              sourceTag: 'type:util',
              onlyDependOnLibsWithTags: ['type:util'],
            },
            {
              sourceTag: 'scope:products',
              onlyDependOnLibsWithTags: ['scope:products', 'scope:shared'],
            },
            {
              sourceTag: 'scope:orders',
              onlyDependOnLibsWithTags: ['scope:orders', 'scope:shared'],
            },
            {
              sourceTag: 'scope:shared',
              onlyDependOnLibsWithTags: ['scope:shared'],
            },
          ],
        },
      ],
    },
  },
];
```

### Multi-Dimensional Tag Constraints

```javascript
// For more granular control, combine scope + type
{
  allSourceTags: ['scope:products', 'type:feature'],
  onlyDependOnLibsWithTags: [
    'scope:products', 'scope:shared',
    'type:data-access', 'type:ui', 'type:util'
  ],
}
```

### Feature Library Consuming Shared State

```typescript
// libs/products/feature/src/lib/product-list.component.ts
import { Component, inject } from '@angular/core';
import { ProductsStore } from '@myorg/products-data-access';
import { AuthStore } from '@myorg/shared-data-access-auth';
import { Product } from '@myorg/shared-models';

@Component({
  selector: 'products-list',
  standalone: true,
  template: `
    @if (store.loading()) {
      <p>Loading...</p>
    }
    @for (product of store.products(); track product.id) {
      <product-card [product]="product" />
    }
  `,
  providers: [ProductsStore],
})
export class ProductListComponent {
  protected readonly store = inject(ProductsStore);
  private readonly authStore = inject(AuthStore);
}
```

### Data-Access Library with SignalStore

```typescript
// libs/products/data-access/src/lib/products.store.ts
import { signalStore, withState, withComputed, withMethods } from '@ngrx/signals';
import { withEntities, setAllEntities } from '@ngrx/signals/entities';
import { withEventHandlers, eventGroup } from '@ngrx/signals/events';
import { Product } from '@myorg/shared-models';

export const ProductsStore = signalStore(
  withEntities<Product>(),
  withState({ loading: false, error: null as string | null }),
  withComputed(/* derived state */),
  withMethods(/* API calls, state updates */),
  withEventHandlers(/* side effects */)
);
```

### Shared Reusable Store Feature

```typescript
// libs/shared/utils/src/lib/features/with-request-status.ts
import { signalStoreFeature, withState, withComputed, withMethods } from '@ngrx/signals';
import { computed } from '@angular/core';

type RequestStatus = 'idle' | 'loading' | 'success' | 'error';

export function withRequestStatus() {
  return signalStoreFeature(
    withState<{ requestStatus: RequestStatus }>({ requestStatus: 'idle' }),
    withComputed(({ requestStatus }) => ({
      isLoading: computed(() => requestStatus() === 'loading'),
      isError: computed(() => requestStatus() === 'error'),
    })),
    withMethods((store) => ({
      setLoading() { patchState(store, { requestStatus: 'loading' }); },
      setSuccess() { patchState(store, { requestStatus: 'success' }); },
      setError() { patchState(store, { requestStatus: 'error' }); },
    }))
  );
}
```

## Breaking Changes and Gotchas

### Nx 22.3+ Required for Angular 21

- Angular 21 support arrived in Nx 22.3 (December 2025)
- esbuild is the default bundler for new Angular 21 apps
- Vitest is the recommended test runner (`vitest-angular` and `vitest-analog` options)
- Migration path: `nx migrate latest && nx migrate --run-migrations`

### Circular Dependencies (Most Common Pitfall)

- **Cause**: Library A imports from Library B, and B imports from A (possibly transitively)
- **Solution**: Extract shared code into a new library, or merge the two libraries
- **Prevention**: `@nx/enforce-module-boundaries` ESLint rule detects these automatically
- **Key**: Never import from your own library's barrel file (`index.ts`) inside the library; use relative imports internally

### Over-Exposing Implementation Details

- Only export what external consumers need from `index.ts`
- Do NOT export reducers or effects directly; they should be registered via providers
- Export only actions (for dispatch), selectors (for reading), and the store class (for SignalStore)

### Tags Not Configured (Silent Architecture Erosion)

- New Nx workspaces default to `"tags": []` and `depConstraints: [{ sourceTag: '*', onlyDependOnLibsWithTags: ['*'] }]`
- This means NO boundaries are enforced until explicitly configured
- Must add tags to every `project.json` and configure constraints in ESLint

### Store-to-Store Direct Access (SignalStore Anti-Pattern)

- SignalStores should not inject other SignalStores directly
- Use a feature service or facade to coordinate between stores
- Prevents coupling cycles and maintains separation of concerns

### NgRx v21 Rename

- `withEffects()` renamed to `withEventHandlers()` in NgRx v21
- Migration schematics available
- All event-related APIs use `eventGroup()` and `on()` patterns

### Barrel File Self-Imports

- Never import from `@myorg/my-lib` inside `libs/my-lib/src/lib/*.ts`
- Always use relative imports (`./my-file`) within a library
- This is the #1 cause of mysterious circular dependency errors

## Sources

### Official Documentation
- Nx Library Types: https://nx.dev/concepts/more-concepts/library-types
- Enforce Module Boundaries: https://nx.dev/docs/features/enforce-module-boundaries
- @nx/angular:library Generator: https://nx.dev/nx-api/angular/generators/library
- @nx/angular:ngrx Generator: https://nx.dev/nx-api/angular/generators/ngrx
- Nx Dependency Graph: https://nx.dev/docs/features/explore-graph
- Project Configuration: https://nx.dev/docs/reference/project-configuration
- Inferred Tasks (Project Crystal): https://nx.dev/docs/concepts/inferred-tasks
- Resolve Circular Dependencies: https://nx.dev/docs/troubleshooting/resolve-circular-dependencies
- Nx 22.3 Release (Angular 21 Support): https://nx.dev/blog/nx-22-3-release
- Angular/Nx Version Matrix: https://nx.dev/docs/technologies/angular/guides/angular-nx-version-matrix

### Community Resources
- Manfred Steyer: Sustainable Angular Architectures with Strategic Design: https://medium.com/@ManfredSteyer/sustainable-angular-architectures-with-strategic-design-and-monorepos-part-1-methodology-d49033a91357
- Angular Architects: Implementing Strategic Design with Nx: https://www.angulararchitects.io/blog/sustainable-angular-architectures-2/
- Angular Architects: The NGRX Signal Store and Your Architecture: https://www.angulararchitects.io/blog/the-ngrx-signal-store-and-your-architecture/
- Brecht Billiet: Opinionated Guidelines for Large Nx Angular Projects: https://blog.brecht.io/opinionated-guidelines-for-large-nx-angular-projects/
- DEV: NX Angular monorepo and shared NgRx store: https://dev.to/dnlrbz/nx-angular-monorepo-and-shared-ngrx-store-h83
- Stefanos Lignos: How to Organize Libs in Nx: https://www.stefanos-lignos.dev/posts/how-to-organize-libs-nrwl-nx
- Stefanos Lignos: Three Ways to Enforce Module Boundaries: https://www.stefanos-lignos.dev/posts/nx-module-boundaries

## Open Questions

- Nx 22.3+ may have introduced new generators or changes to the `@nx/angular:ngrx` generator for SignalStore scaffolding. The existing generator targets Classic Store. Verify if a dedicated SignalStore generator exists or if manual creation is still required.
- The `+state` directory convention may have changed in recent Nx versions. Verify current default directory name for the ngrx generator.
- Confirm whether `nx g @nx/angular:library` still defaults to standalone components in Nx 22.3+ or if any new defaults were introduced with Angular 21 support.
- Check if Nx 22.3 introduced any new ESLint rules or improvements to module boundary enforcement beyond the existing `@nx/enforce-module-boundaries` rule.
