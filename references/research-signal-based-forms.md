# Research: Signal-Based Forms

**Date:** 2026-03-29
**Chapter:** Ch 7
**Status:** Ready for chapter generation

## API Surface

### Core Functions

| Function | Import Path | Signature | Stability |
|----------|-------------|-----------|-----------|
| `form()` | `@angular/forms/signals` | `form<T>(model: WritableSignal<T>, schemaFn?: (path: SchemaPathTree<T>) => void): FieldTree<T>` | Experimental (v21.0.0) |
| `compatForm()` | `@angular/forms/signals` | `compatForm<T>(model: WritableSignal<T>, schemaFn?: (path: SchemaPathTree<T>) => void): FieldTree<T>` | Experimental (v21.0.0) |
| `submit()` | `@angular/forms/signals` | `submit<TModel>(form: FieldTree<TModel>, action?: (field: FieldTree<TModel>, detail: { root, submitted }) => Promise<TreeValidationResult>): Promise<boolean>` | Experimental (v21.0.0) |
| `schema()` | `@angular/forms/signals` | `schema<T>(schemaFn: (path: SchemaPathTree<T>) => void): SchemaFunction<T>` | Experimental (v21.0.0) |

### Directives

| Directive | Import Path | Usage | Stability |
|-----------|-------------|-------|-----------|
| `FormField` | `@angular/forms/signals` | `<input [formField]="fieldTree.fieldName" />` | Experimental (v21.0.0) |

### Validators (Synchronous)

All imported from `@angular/forms/signals`.

| Validator | Signature | Purpose |
|-----------|-----------|---------|
| `required()` | `required(path, options?: { message?: string })` | Ensures field has a value |
| `email()` | `email(path, options?: { message?: string })` | Validates email format |
| `min()` | `min(path, minValue: number)` | Numeric minimum |
| `max()` | `max(path, maxValue: number)` | Numeric maximum |
| `minLength()` | `minLength(path, length: number)` | Minimum character count |
| `maxLength()` | `maxLength(path, length: number)` | Maximum character count |
| `pattern()` | `pattern(path, regex: RegExp)` | Regex validation |
| `validate()` | `validate(path, validator: (ctx: ValidationContext) => ValidationError \| null)` | Custom sync validator |
| `validateTree()` | `validateTree(path, validator: (ctx: ChildFieldContext) => ValidationError \| null)` | Cross-field/tree validation |
| `validateStandardSchema()` | `validateStandardSchema(path, schema)` | Zod/Standard Schema integration |
| `customError()` | `customError({ kind: string, message?: string, ...props })` | Creates custom validation error objects |

### Validators (Asynchronous)

| Validator | Signature | Purpose |
|-----------|-----------|---------|
| `validateAsync()` | `validateAsync(path, { params, factory, onSuccess, onError })` | Async validation via Angular resources |
| `validateHttp()` | `validateHttp(path, { request, onSuccess, onError })` | HTTP-based async validation |

### Field State Control

| Function | Signature | Purpose |
|----------|-----------|---------|
| `disabled()` | `disabled(path, predicate?: (ctx) => boolean \| string)` | Conditionally disable fields |
| `hidden()` | `hidden(path, predicate?: (ctx) => boolean)` | Conditionally hide fields |
| `readonly()` | `readonly(path, predicate?: (ctx) => boolean)` | Make fields read-only |
| `debounce()` | `debounce(path, milliseconds: number)` or `debounce(path, debouncer: (ctx, abortSignal) => Promise<void>)` | Delay updates from UI to model |

### Schema Composition

| Function | Signature | Purpose |
|----------|-----------|---------|
| `apply()` | `apply(path, schema)` | Apply schema to nested object |
| `applyEach()` | `applyEach(path, schema)` | Apply schema to each array item |
| `applyWhen()` | `applyWhen(path, predicate: (ctx) => boolean, schema)` | Conditional schema application |
| `applyWhenValue()` | `applyWhenValue(path, predicate: (value) => boolean, schema)` | Conditional schema based on value |

### Metadata

| Function | Signature | Purpose |
|----------|-----------|---------|
| `metadata()` | `metadata(path, key, valueFn)` | Attach custom metadata to fields |
| `createMetadataKey()` | `createMetadataKey<T>(reducer?: MetadataReducer)` | Create typed metadata keys |
| `REQUIRED` | Constant | Built-in metadata key for required state |
| `MIN_LENGTH` | Constant | Built-in metadata key |
| `MAX_LENGTH` | Constant | Built-in metadata key |
| `MetadataReducer.or()` | Method | Boolean OR reducer for metadata |
| `MetadataReducer.and()` | Method | Boolean AND reducer for metadata |
| `MetadataReducer.min()` | Method | Numeric min reducer |
| `MetadataReducer.max()` | Method | Numeric max reducer |
| `MetadataReducer.list()` | Method | List aggregation reducer |

### Migration Bridges

| Class/Function | Import Path | Purpose | Stability |
|----------------|-------------|---------|-----------|
| `SignalFormControl` | `@angular/forms/signals` | Exposes signal form as a standard FormControl (bottom-up migration) | Experimental (v21.2) |
| `compatForm()` | `@angular/forms/signals` | Wraps existing FormControl/FormGroup in Signal Form tree (top-down migration) | Experimental (v21.0) |

### Configuration

| Function | Import Path | Purpose |
|----------|-------------|---------|
| `provideSignalFormsConfig()` | `@angular/forms` | Configures Signal Forms behavior (CSS classes, etc.) |
| `NG_STATUS_CLASSES` | `@angular/forms` | Constant that restores ng-valid/ng-invalid/ng-touched CSS classes |

### Interfaces

| Interface | Purpose |
|-----------|---------|
| `FormValueControl<T>` | Interface for custom form controls (replaces ControlValueAccessor) |
| `FormCheckboxControl` | Interface for custom checkbox controls |
| `FieldState` | Object returned when calling a field as a function |
| `FieldTree<T>` | The navigable/callable field tree type |
| `ValidationError` | Error object with `kind`, `message`, and optional `fieldTree` |
| `ValidationContext` | Context object in validators: `value()`, `valueOf(path)`, `state`, `stateOf(path)` |

### FieldState Properties

| Property | Type | Purpose |
|----------|------|---------|
| `value()` | `WritableSignal<T>` | Current field value |
| `valid()` | `Signal<boolean>` | All validation rules pass |
| `invalid()` | `Signal<boolean>` | Has validation errors |
| `errors()` | `Signal<ValidationError[]>` | Array of validation errors |
| `errorSummary()` | `Signal<ValidationError[]>` | Aggregated errors for tree and children |
| `pending()` | `Signal<boolean>` | Async validation in progress |
| `touched()` | `Signal<boolean>` | User has focused and blurred the field |
| `dirty()` | `Signal<boolean>` | User has modified the field |
| `disabled()` | `Signal<boolean>` | Field is disabled |
| `hidden()` | `Signal<boolean>` | Field should be hidden |
| `readonly()` | `Signal<boolean>` | Field is read-only |
| `submitting()` | `Signal<boolean>` | Form is currently being submitted |
| `disabledReasons()` | `Signal<string[]>` | Why the field is disabled |

## Key Concepts

- **Signal Forms are NOT an evolution of Reactive Forms.** They are a complete ground-up reimagination of form handling in Angular, built on top of signals.
- **Model-first approach**: The form model is a plain `WritableSignal<T>` created with `signal()`. The developer owns the data model directly.
- **Field Tree**: The `form()` function creates a field tree that mirrors the model's shape. Fields are both navigable (dot notation) and callable (returns FieldState).
- **Schema-based validation**: All validation rules are declared in a single schema function passed as the second argument to `form()`. No validation in templates.
- **Reactive by default**: Validators automatically track signal dependencies. Cross-field validation "just works" without manual `updateValueAndValidity()`.
- **No `valueChanges` observable**: The model signal IS the source of truth. Use `computed()` for derived values.
- **Two-way binding via `[formField]`**: The `FormField` directive automatically syncs HTML inputs with field state.
- **State propagation**: Field state flows upward from child fields through parent groups to the root form.
- **Non-interactive fields excluded**: Hidden, disabled, and readonly fields don't contribute to parent validity or interaction state.
- **Custom controls simplified**: `FormValueControl<T>` interface replaces the verbose `ControlValueAccessor` pattern (~250 lines reduced to ~40 lines).
- **Form submission**: The `submit()` function handles marking fields as touched, validating, tracking `submitting` state, executing the action, and applying server-side errors.
- **Type safety**: Full TypeScript type inference from the model interface through the field tree to template bindings.
- **No CSS classes by default**: Signal Forms do not add `ng-valid`, `ng-invalid`, `ng-touched` classes. Use `provideSignalFormsConfig({ classes: NG_STATUS_CLASSES })` for backward compatibility.

## Code Patterns

### Basic Form Setup

```typescript
// app/login/login.component.ts
import { Component, signal } from '@angular/core';
import { form, FormField, required, email } from '@angular/forms/signals';

interface LoginData {
  email: string;
  password: string;
}

@Component({
  selector: 'app-login',
  imports: [FormField],
  template: `
    <form novalidate (submit)="onSubmit($event)">
      <label>
        Email:
        <input type="email" [formField]="loginForm.email" />
      </label>
      @if (loginForm.email().touched() && loginForm.email().invalid()) {
        @for (error of loginForm.email().errors(); track error) {
          <p class="error">{{ error.message }}</p>
        }
      }

      <label>
        Password:
        <input type="password" [formField]="loginForm.password" />
      </label>

      <button type="submit" [disabled]="loginForm().submitting()">
        Log In
      </button>
    </form>
  `,
})
export class LoginComponent {
  loginModel = signal<LoginData>({ email: '', password: '' });

  loginForm = form(this.loginModel, (path) => {
    required(path.email, { message: 'Email is required' });
    email(path.email, { message: 'Enter a valid email' });
    required(path.password, { message: 'Password is required' });
  });

  async onSubmit(event: Event) {
    event.preventDefault();
    await submit(this.loginForm, async (formField) => {
      const data = formField().value();
      // Call API
      return null; // null means success
    });
  }
}
```

### Nested Forms with Reusable Schemas

```typescript
// app/shared/schemas/address.schema.ts
import { schema, required, minLength, pattern } from '@angular/forms/signals';

export interface Address {
  street: string;
  city: string;
  zip: string;
}

export const addressSchema = schema<Address>((path) => {
  required(path.street, { message: 'Street is required' });
  minLength(path.street, 3);
  required(path.city, { message: 'City is required' });
  pattern(path.zip, /^\d{5}$/, { message: 'ZIP must be 5 digits' });
});
```

```typescript
// app/checkout/checkout.component.ts
import { Component, signal } from '@angular/core';
import { form, FormField, required, apply, applyWhen } from '@angular/forms/signals';
import { addressSchema, Address } from '../shared/schemas/address.schema';

interface CheckoutData {
  customerName: string;
  useSeparateBilling: boolean;
  shippingAddress: Address;
  billingAddress: Address;
}

@Component({
  selector: 'app-checkout',
  imports: [FormField],
  template: `...`,
})
export class CheckoutComponent {
  checkoutModel = signal<CheckoutData>({
    customerName: '',
    useSeparateBilling: false,
    shippingAddress: { street: '', city: '', zip: '' },
    billingAddress: { street: '', city: '', zip: '' },
  });

  checkoutForm = form(this.checkoutModel, (path) => {
    required(path.customerName);
    apply(path.shippingAddress, addressSchema);
    applyWhen(
      path.billingAddress,
      (ctx) => ctx.valueOf(path.useSeparateBilling),
      addressSchema
    );
  });
}
```

### Cross-Field Validation

```typescript
// app/registration/registration.component.ts
import { form, required, minLength, validate, customError } from '@angular/forms/signals';

interface RegistrationData {
  password: string;
  confirmPassword: string;
}

const registrationForm = form(this.model, (path) => {
  required(path.password);
  minLength(path.password, 8);
  required(path.confirmPassword);
  validate(path.confirmPassword, ({ value, valueOf }) => {
    if (value() !== valueOf(path.password)) {
      return customError({ kind: 'password-mismatch', message: 'Passwords must match' });
    }
    return null;
  });
});
```

### Async Validation with Debounce

```typescript
// app/signup/signup.component.ts
import { form, required, debounce, validateHttp, customError } from '@angular/forms/signals';

const signupForm = form(this.signupModel, (path) => {
  required(path.username);
  debounce(path.username, 500);
  validateHttp(path.username, {
    request: ({ value }) => value() ? `/api/users/check?name=${value()}` : undefined,
    onSuccess: (result) =>
      result.taken ? customError({ kind: 'taken', message: 'Username is taken' }) : undefined,
    onError: () =>
      customError({ kind: 'check-failed', message: 'Could not verify username' }),
  });
});
```

### Custom Form Control (FormValueControl)

```typescript
// app/shared/controls/star-rating.component.ts
import { Component, computed, model, input } from '@angular/core';
import { FormValueControl, ValidationError } from '@angular/forms/signals';

@Component({
  selector: 'app-star-rating',
  template: `
    @for (star of stars(); track star) {
      <button
        type="button"
        (click)="selectRating(star)"
        [class.active]="star <= value()"
        [disabled]="disabled()">
        ★
      </button>
    }
  `,
})
export class StarRatingComponent implements FormValueControl<number> {
  readonly value = model(0);
  readonly disabled = input(false);
  readonly errors = input<readonly ValidationError[]>([]);

  protected stars = computed(() => [1, 2, 3, 4, 5]);

  selectRating(rating: number) {
    this.value.set(rating);
  }
}
```

Usage in template:
```html
<app-star-rating [formField]="reviewForm.rating" />
```

### Conditional Field State

```typescript
// Conditional disabled, hidden, readonly
const orderForm = form(this.orderModel, (path) => {
  disabled(path.discountCode, ({ valueOf }) =>
    valueOf(path.orderType) === 'wholesale'
  );
  hidden(path.companyName, ({ valueOf }) =>
    valueOf(path.customerType) !== 'business'
  );
  readonly(path.totalPrice);
});
```

### Configuration for CSS Classes

```typescript
// app/app.config.ts
import { ApplicationConfig } from '@angular/core';
import { provideSignalFormsConfig, NG_STATUS_CLASSES } from '@angular/forms';

export const appConfig: ApplicationConfig = {
  providers: [
    provideSignalFormsConfig({
      classes: NG_STATUS_CLASSES,
    }),
  ],
};
```

Custom class configuration:
```typescript
provideSignalFormsConfig({
  classes: {
    'error': ({ state }) => state().invalid(),
    'touched': ({ state }) => state().touched(),
    'dirty': ({ state }) => state().dirty(),
  },
});
```

### Reading Field Values and State

```typescript
// Read individual field value
const emailValue = this.loginForm.email().value();

// Read individual field state
const isEmailValid = this.loginForm.email().valid();
const isEmailTouched = this.loginForm.email().touched();

// Read form-level state
const isFormValid = this.loginForm().valid();
const isFormDirty = this.loginForm().dirty();

// Update a field programmatically
this.loginForm.email().value.set('new@email.com');
this.loginForm.email().value.update(v => v.toUpperCase());

// Replace the entire model
this.loginModel.set({ email: 'new@email.com', password: '12345' });

// Reset form
this.loginForm().reset();
this.loginForm.email().reset();
this.loginForm().reset({ email: '', password: '' });
```

### Array Fields

```typescript
// Model with arrays
interface OrderData {
  customerName: string;
  items: Array<{ product: string; quantity: number }>;
}

const orderModel = signal<OrderData>({
  customerName: '',
  items: [{ product: '', quantity: 1 }],
});

const orderForm = form(orderModel, (path) => {
  required(path.customerName);
  applyEach(path.items, schema<{ product: string; quantity: number }>((item) => {
    required(item.product);
    min(item.quantity, 1);
  }));
});

// Template iteration
// @for (item of orderForm.items; track $index) {
//   <input [formField]="item.product" />
//   <input type="number" [formField]="item.quantity" />
// }

// Adding items
orderForm.items().value.update(items => [...items, { product: '', quantity: 1 }]);
```

### Migration: compatForm (top-down)

```typescript
// Wrapping existing Reactive Forms inside Signal Forms
import { FormControl, Validators } from '@angular/forms';
import { compatForm, required } from '@angular/forms/signals';

const passwordControl = new FormControl('', {
  validators: [Validators.required],
  nonNullable: true,
});

const model = signal({ email: '', password: passwordControl });
const myForm = compatForm(model, (path) => {
  required(path.email);
  // password validation stays on the FormControl
});
```

### Migration: SignalFormControl (bottom-up)

```typescript
// Exposing Signal Forms as FormControl inside Reactive Forms
import { FormGroup } from '@angular/forms';
import { SignalFormControl, required, disabled } from '@angular/forms/signals';

const emailControl = new SignalFormControl('', (path) => {
  required(path, { message: 'Email is required' });
  disabled(path, () => this.isLoading());
});

const form = new FormGroup({ email: emailControl });
```

## Breaking Changes and Gotchas

### No CSS Classes by Default
Signal Forms do NOT attach `ng-valid`, `ng-invalid`, `ng-touched`, `ng-dirty`, `ng-pristine`, `ng-untouched` CSS classes by default. This is a major difference from Reactive/Template-Driven Forms. Use `provideSignalFormsConfig({ classes: NG_STATUS_CLASSES })` for backward compatibility. Existing styles relying on these classes will break silently without this config.

### No `valueChanges` Observable
There is no equivalent to `valueChanges` or `statusChanges`. The model signal IS the source of truth. Use `computed()` for derived values and `effect()` for side effects. Developers must shift from RxJS-based form reactivity to signal-based patterns.

### No Imperative State APIs on SignalFormControl
`SignalFormControl` intentionally disallows methods like `disable()`, `enable()`, `addValidators()`, `setErrors()`. All state must derive from signals and schema rules. Use `disabled()`, `applyWhen()`, etc. in the schema instead.

### Fields Set to `undefined` Are Excluded
Fields initialized with `undefined` are excluded from the field tree entirely. Always use `null` or a sensible default value. This is a common trap when mapping domain models to form models.

### Validators as HTML Attributes
When `maxLength` is applied, the corresponding `maxlength` HTML attribute is set on the input. This can cause pasted text to be silently truncated. Be aware of this browser behavior.

### Browser Validation Conflicts
Always add `novalidate` to `<form>` elements and call `event.preventDefault()` in submit handlers to prevent browser built-in validation from conflicting with Signal Forms validation.

### `stateOf()` Tracks Entire Form
Using `stateOf(form)` in a validator reads the entire form and causes the validator to run on every change anywhere in the form. Only read the specific fields you need (via `valueOf(path.specificField)`) to avoid unnecessary re-runs.

### Debounce Inheritance
Debouncing applied to a parent path is inherited by all children. Children can override with their own debounce settings.

### Array Field Iteration
Use `@for (item of form.items; track $index)` for array fields. Items are FieldTree instances with full state access.

### No `FormBuilder` Equivalent
There is no `FormBuilder` for Signal Forms. The `signal()` + `form()` pattern replaces it entirely.

### Experimental API Caveat
The entire Signal Forms API is marked `@experimental` in v21.0.0. Method signatures may change. The core mental model (signals as form state) is stable, but API details may shift.

### submit() Only Calls Action on Valid Forms
The `submit()` function will only invoke the action callback if the form is valid. It marks all fields as touched first, then validates. If invalid, the action is skipped.

### `dirty` Tracks Modification, Not Value Difference
A field is `dirty` if the user has modified it at all, even if the value matches the initial state. This differs from some form libraries that compare current vs. initial values.

### SignalFormControl Added in v21.2
The `SignalFormControl` bridge was introduced in Angular 21.2, not 21.0. `compatForm` was available from 21.0.

## Sources

### Official Documentation
- [Signal Forms Overview](https://angular.dev/guide/forms/signals/overview) - Main overview page
- [Signal Forms Essentials](https://angular.dev/essentials/signal-forms) - Getting started guide
- [Form Models](https://angular.dev/guide/forms/signals/models) - Model and field tree documentation
- [Field State Management](https://angular.dev/guide/forms/signals/field-state-management) - FieldState properties and behavior
- [Migration from Reactive Forms](https://angular.dev/guide/forms/signals/migration) - compatForm, SignalFormControl
- [submit() API](https://angular.dev/api/forms/signals/submit) - Submit function reference
- [debounce() API](https://angular.dev/api/forms/signals/debounce) - Debounce function reference
- [metadata() API](https://angular.dev/api/forms/signals/metadata) - Metadata key system
- [FormField Directive API](https://angular.dev/api/forms/signals/FormField) - FormField directive reference
- [HttpValidatorOptions API](https://angular.dev/api/forms/signals/HttpValidatorOptions) - HTTP async validator options
- [Signal Forms Tutorial](https://angular.dev/tutorials/signal-forms) - Interactive tutorial
- [Announcing Angular v21](https://blog.angular.dev/announcing-angular-v21-57946c34f14b) - Official announcement

### Expert Blog Posts
- [Angular Signal Forms - Everything You Need to Know (Manfred Steyer, Angular Architects)](https://www.angulararchitects.io/blog/all-about-angulars-new-signal-forms/) - Comprehensive deep dive
- [Migrating to Angular Signal Forms: Interop with Reactive Forms (Manfred Steyer)](https://www.angulararchitects.io/blog/migrating-to-angular-signal-forms-interop-with-reactive-forms/) - Migration patterns
- [Dynamic Forms: Building a Form Generator with Signal Forms (Manfred Steyer)](https://www.angulararchitects.io/blog/dynamic-forms-building-a-form-generator-with-signal-forms/) - Advanced dynamic form patterns
- [Signal Forms Complete Guide (Angular.love)](https://angular.love/signal-forms-in-angular-21-complete-guide/) - Comprehensive guide
- [Refactoring a Form to a Signal Form (Tim Deschryver)](https://timdeschryver.dev/blog/refactoring-a-form-to-a-signal-form) - Real-world refactoring walkthrough
- [Angular Signal Forms Essentials (Angular Experts)](https://angularexperts.io/blog/signal-forms-essentials/) - Fundamentals tutorial
- [Angular Signal Forms Config (Angular Experts)](https://angularexperts.io/blog/signal-forms-config/) - Configuration guide
- [Signal Forms: Angular's Best Quality of Life Update (LogRocket)](https://blog.logrocket.com/angular-signal-forms/) - Performance and DX analysis
- [Angular Signal Forms Part 1 (Angular-Buch)](https://angular-buch.com/blog/2025-10-signal-forms-part1/) - Getting started
- [Angular Signal Forms Part 2: Advanced Validation (Angular-Buch)](https://angular-buch.com/blog/2025-10-signal-forms-part2/) - Advanced validation and schema patterns
- [Master Angular Signal Forms Validation (Netanel Basal)](https://netbasal.medium.com/master-angular-signal-forms-validation-all-functions-explained-d9b0cd1c7be6) - All validation functions explained
- [Bridge Signal Forms and Reactive Forms in Angular 21.2 (Brian Treese)](https://briantree.se/angular-signalformcontrol-reactive-forms-compatibility/) - SignalFormControl bridge
- [Submit Forms the Modern Way (Brian Treese, ITNEXT)](https://itnext.io/submit-forms-the-modern-way-in-angular-signal-forms-705eb681290a) - Submit patterns
- [Async Validation in Angular Signal Forms (Brian Treese)](https://briantree.se/angular-signal-forms-async-validation/) - Async validation guide

### GitHub
- [Debounce async validation issue (angular/angular#66959)](https://github.com/angular/angular/issues/66959) - Known issue with debounce + async validation

### Talks / Presentations
- [Migration to Signals, Signal Forms, Resource API, and NgRx Signal Store (Manfred Steyer, Angular Days 03/2026)](https://speakerdeck.com/manfredsteyer/2026-munich) - Conference talk slides

## Open Questions

1. **Exact `submit()` overload signatures**: The submit function has multiple overloads including one with `FormSubmitOptions<unknown, TModel>`. The exact shape of `FormSubmitOptions` needs verification against the v21 source or API docs.
2. **`errorSummary()` availability**: Some sources reference `errorSummary()` on FieldState and root form. Verify this is present in the stable experimental API vs. added later.
3. **Standard Schema validation**: The `validateStandardSchema()` function integrates with Zod and other Standard Schema-compliant validators. Verify which Standard Schema version is supported and which libraries work out of the box.
4. **Performance benchmarks**: Early adopters report ~30-50% fewer render cycles in large forms compared to Reactive Forms. This should be cited carefully, noting it comes from community benchmarks, not official Angular team claims.
5. **Angular 21.2 additions**: `SignalFormControl` was added in 21.2. Verify if there were other Signal Forms additions in 21.1 or 21.2 patches.
6. **`[formField]` vs `[field]` directive name**: Some sources (Tim Deschryver's blog) use `[field]` while others use `[formField]`. The official docs use `[formField]`. Verify the canonical directive selector name.
