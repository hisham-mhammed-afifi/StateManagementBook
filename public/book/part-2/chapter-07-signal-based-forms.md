# Chapter 7: Signal-Based Forms

Your product catalog loads data with `httpResource`, renders it through signal-based components, and even supports optimistic deletes. But users need to do more than browse. They need to add products to a cart, enter shipping addresses, apply discount codes, and check out. That means forms. And forms are where state management gets personal: every keystroke, every blur event, every validation rule, and every submission attempt produces state that must be tracked, validated, and propagated through the component tree.

Angular has offered two form systems for years: template-driven forms and reactive forms. Both predate signals. Reactive forms rely on `FormGroup`, `FormControl`, and `valueChanges` Observables. They work, but they carry baggage: nullable types by default, verbose `ControlValueAccessor` boilerplate for custom controls, imperative calls to `updateValueAndValidity()` for cross-field validation, and no integration with Angular's signal-based reactivity model. In Angular 21, a third option arrived: Signal Forms. This is not an incremental update to reactive forms. It is a ground-up reimagination of form state built entirely on signals. In this chapter, we build a complete checkout form with nested addresses, conditional billing fields, cross-field password validation, async username availability checks, a custom star-rating control, and server-side error handling on submission.

> **API Status: Experimental**
> Signal Forms are marked as `@experimental` in Angular 21.0.0. The core mental model (signals as form state, schema-based validation) is stable, but method signatures may change in future versions.

## A Quick Recap

Chapter 4 introduced `signal()`, `computed()`, and `effect()` as the building blocks of Angular's reactivity model. Chapter 5 covered `input()`, `output()`, and `model()` for component communication. Chapter 6 showed how `httpResource` declaratively fetches data into signals. Signal Forms build on all three: the form model is a `WritableSignal`, field state properties are read-only signals, and the `FormField` directive uses the same two-way binding model as `model()` signals. If you are comfortable calling `signal()` to create state and reading it with `()`, you already have the mental model for Signal Forms.

## The Core Mental Model

Reactive Forms define structure imperatively: you construct a `FormGroup`, nest `FormControl` instances inside it, and synchronize them with the template via directives. The `FormGroup` owns the value. You read it with `form.value` or subscribe to `form.valueChanges`.

Signal Forms invert this. You start with a plain TypeScript interface and a `WritableSignal` holding your data. The `form()` function reads that signal and builds a field tree that mirrors the model's shape. The signal owns the value. The field tree provides access to per-field state (validity, touched, dirty) and the `FormField` directive synchronizes inputs with the tree.

Picture the data flow:

```
WritableSignal<T>  ──>  form()  ──>  FieldTree<T>  ──>  [formField] directive  ──>  <input>
       ↑                                                                              │
       └──────────────────── two-way sync ────────────────────────────────────────────┘
```

The signal is the source of truth. The field tree is a reactive lens into it. The directive is the bridge to the DOM. There is no separate `valueChanges` Observable because the signal itself is observable through Angular's reactivity graph.

## Creating Your First Signal Form

Every signal form starts with three steps: define an interface, create a model signal, and pass it to `form()`.

```typescript
// src/app/checkout/checkout-models.ts
export interface CheckoutData {
  customerName: string;
  email: string;
  shippingAddress: Address;
  billingAddress: Address;
  useSeparateBilling: boolean;
  discountCode: string;
}

export interface Address {
  street: string;
  city: string;
  zip: string;
}
```

```typescript
// src/app/checkout/checkout-form.component.ts
import { Component, signal } from '@angular/core';
import { form, FormField, required, email, minLength } from '@angular/forms/signals';
import { CheckoutData } from './checkout-models';

@Component({
  selector: 'app-checkout-form',
  imports: [FormField],
  template: `
    <form novalidate (submit)="onSubmit($event)">
      <label>
        Name
        <input type="text" [formField]="checkoutForm.customerName" />
      </label>

      <label>
        Email
        <input type="email" [formField]="checkoutForm.email" />
      </label>

      <h3>Shipping Address</h3>
      <label>
        Street
        <input type="text" [formField]="checkoutForm.shippingAddress.street" />
      </label>
      <label>
        City
        <input type="text" [formField]="checkoutForm.shippingAddress.city" />
      </label>
      <label>
        ZIP
        <input type="text" [formField]="checkoutForm.shippingAddress.zip" />
      </label>

      <button type="submit">Place Order</button>
    </form>
  `,
})
export class CheckoutFormComponent {
  protected readonly checkoutModel = signal<CheckoutData>({
    customerName: '',
    email: '',
    shippingAddress: { street: '', city: '', zip: '' },
    billingAddress: { street: '', city: '', zip: '' },
    useSeparateBilling: false,
    discountCode: '',
  });

  protected readonly checkoutForm = form(this.checkoutModel, (path) => {
    required(path.customerName, { message: 'Name is required' });
    required(path.email, { message: 'Email is required' });
    email(path.email, { message: 'Enter a valid email address' });
    required(path.shippingAddress.street, { message: 'Street is required' });
    required(path.shippingAddress.city, { message: 'City is required' });
    required(path.shippingAddress.zip, { message: 'ZIP code is required' });
    minLength(path.shippingAddress.zip, 5);
  });

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    const data = this.checkoutModel();
    console.log('Submitting:', data);
  }
}
```

Three things to notice. First, every field in the model has an initial value. Fields set to `undefined` are excluded from the field tree entirely, so always use empty strings, zero, `false`, or `null` as defaults. Second, the schema function (the second argument to `form()`) declares all validation rules in one place. No validators in the template, no imperative `addValidators()` calls. Third, we add `novalidate` to the `<form>` element and call `event.preventDefault()` in the submit handler. Without this, the browser's built-in validation fights with Signal Forms.

## The Field Tree and FieldState

The object returned by `form()` is a `FieldTree<T>`. It mirrors the model's shape: `checkoutForm.email` corresponds to the `email` field, `checkoutForm.shippingAddress.street` corresponds to the nested `street` field. You navigate it with dot notation, and TypeScript enforces that every path exists on the model interface.

Each field in the tree is both navigable and callable. Navigating gives you child fields. Calling a field as a function returns its `FieldState`, an object containing reactive signals for that field's current condition.

```typescript
// src/app/checkout/field-state-demo.ts
import { computed } from '@angular/core';

// Calling a leaf field returns its FieldState
const emailState = checkoutForm.email();

// FieldState properties are all signals
emailState.value();     // WritableSignal<string> - current value
emailState.valid();     // boolean - passes all validation rules
emailState.invalid();   // boolean - has validation errors
emailState.errors();    // ValidationError[] - array of errors
emailState.touched();   // boolean - user focused and blurred
emailState.dirty();     // boolean - user modified the value
emailState.pending();   // boolean - async validation in progress
emailState.disabled();  // boolean - field is disabled
emailState.hidden();    // boolean - field should be hidden
emailState.readonly();  // boolean - field is read-only

// Calling a group field returns aggregate state
const formState = checkoutForm();
formState.valid();      // true only when ALL interactive children are valid
formState.touched();    // true when ANY child has been touched
formState.dirty();      // true when ANY child has been modified
formState.submitting(); // true during submit() execution

// Use computed() for derived values
const canSubmit = computed(() =>
  checkoutForm().valid() && !checkoutForm().submitting()
);
```

State propagates upward. If `checkoutForm.email` is invalid, then `checkoutForm()` reports `valid() === false`. If any child field is dirty, the root form is dirty. Hidden, disabled, and readonly fields are excluded from this aggregation: a hidden field with a validation error does not make the parent invalid.

## Displaying Validation Errors

Each `FieldState` exposes an `errors()` signal that returns an array of `ValidationError` objects. Each error has a `kind` string (like `'required'` or `'email'`), an optional `message`, and any custom properties the validator attaches.

```typescript
// src/app/checkout/checkout-form.component.ts (updated template)
@Component({
  selector: 'app-checkout-form',
  imports: [FormField],
  template: `
    <form novalidate (submit)="onSubmit($event)">
      <label>
        Name
        <input type="text" [formField]="checkoutForm.customerName" />
      </label>
      @if (checkoutForm.customerName().touched() && checkoutForm.customerName().invalid()) {
        @for (error of checkoutForm.customerName().errors(); track error.kind) {
          <p class="field-error">{{ error.message }}</p>
        }
      }

      <label>
        Email
        <input type="email" [formField]="checkoutForm.email" />
      </label>
      @if (checkoutForm.email().touched() && checkoutForm.email().invalid()) {
        @for (error of checkoutForm.email().errors(); track error.kind) {
          <p class="field-error">{{ error.message }}</p>
        }
      }

      <button type="submit" [disabled]="!canSubmit()">
        Place Order
      </button>
    </form>
  `,
})
export class CheckoutFormComponent {
  // ... model and form from above ...

  protected readonly canSubmit = computed(() =>
    this.checkoutForm().valid() && !this.checkoutForm().submitting()
  );
}
```

The pattern is consistent: check `touched()` and `invalid()` before showing errors so the user is not bombarded with red text before they start typing. The `track error.kind` ensures Angular identifies each error uniquely.

For a summary of all errors across the form (useful for a top-of-form error banner), call `errorSummary()` on the root field tree:

```typescript
// src/app/checkout/error-summary.component.ts
import { Component, input } from '@angular/core';
import { FieldTree } from '@angular/forms/signals';

@Component({
  selector: 'app-error-summary',
  template: `
    @if (form().touched() && form().invalid()) {
      <div class="error-summary" role="alert">
        <h4>Please fix the following errors:</h4>
        <ul>
          @for (error of form().errorSummary(); track error.kind) {
            <li>{{ error.message }}</li>
          }
        </ul>
      </div>
    }
  `,
})
export class ErrorSummaryComponent {
  readonly form = input.required<FieldTree<unknown>>();
}
```

## Reusable Schemas with schema() and apply()

Our checkout form has two address blocks: shipping and billing. Duplicating validation rules for each address is a maintenance burden. The `schema()` function extracts a reusable validation schema that you can apply to any matching subtree.

```typescript
// src/app/shared/schemas/address.schema.ts
import { schema, required, minLength, pattern } from '@angular/forms/signals';
import { Address } from '../models/address.model';

export const addressSchema = schema<Address>((path) => {
  required(path.street, { message: 'Street is required' });
  minLength(path.street, 3);
  required(path.city, { message: 'City is required' });
  required(path.zip, { message: 'ZIP code is required' });
  pattern(path.zip, /^\d{5}$/, { message: 'ZIP must be exactly 5 digits' });
});
```

```typescript
// src/app/checkout/checkout-form.component.ts (updated schema)
import { form, required, email, apply, applyWhen } from '@angular/forms/signals';
import { addressSchema } from '../shared/schemas/address.schema';

protected readonly checkoutForm = form(this.checkoutModel, (path) => {
  required(path.customerName, { message: 'Name is required' });
  required(path.email, { message: 'Email is required' });
  email(path.email, { message: 'Enter a valid email address' });
  apply(path.shippingAddress, addressSchema);
  applyWhen(
    path.billingAddress,
    (ctx) => ctx.valueOf(path.useSeparateBilling),
    addressSchema
  );
});
```

`apply()` attaches the address schema to the shipping address unconditionally. `applyWhen()` attaches it to the billing address only when `useSeparateBilling` is `true`. The condition is reactive: toggle the checkbox and the billing validation appears or disappears instantly. No `updateValueAndValidity()` call needed.

## Conditional Field State: disabled, hidden, readonly

Beyond conditional validation, Signal Forms let you declare when fields should be disabled, hidden, or read-only. These declarations live in the schema, not the template.

```typescript
// src/app/checkout/checkout-form.component.ts (updated schema)
import {
  form, required, email, apply, applyWhen,
  hidden, disabled, readonly,
} from '@angular/forms/signals';

protected readonly checkoutForm = form(this.checkoutModel, (path) => {
  required(path.customerName, { message: 'Name is required' });
  required(path.email, { message: 'Email is required' });
  email(path.email, { message: 'Enter a valid email address' });
  apply(path.shippingAddress, addressSchema);

  hidden(path.billingAddress, (ctx) => !ctx.valueOf(path.useSeparateBilling));
  applyWhen(
    path.billingAddress,
    (ctx) => ctx.valueOf(path.useSeparateBilling),
    addressSchema
  );

  disabled(path.discountCode, (ctx) =>
    ctx.valueOf(path.shippingAddress.zip) === ''
  );
});
```

In the template, use the `hidden()` signal to control visibility with `@if`:

```typescript
// src/app/checkout/checkout-form.component.ts (billing section of template)
template: `
  <label>
    <input type="checkbox" [formField]="checkoutForm.useSeparateBilling" />
    Use a separate billing address
  </label>

  @if (!checkoutForm.billingAddress().hidden()) {
    <h3>Billing Address</h3>
    <label>
      Street
      <input type="text" [formField]="checkoutForm.billingAddress.street" />
    </label>
    <label>
      City
      <input type="text" [formField]="checkoutForm.billingAddress.city" />
    </label>
    <label>
      ZIP
      <input type="text" [formField]="checkoutForm.billingAddress.zip" />
    </label>
  }

  <label>
    Discount Code
    <input type="text" [formField]="checkoutForm.discountCode" />
  </label>
`
```

Hidden fields do not contribute to the parent form's validity, touched, or dirty state. The `FormField` directive automatically applies the `disabled` attribute to the HTML element when the schema's `disabled()` predicate returns `true`.

## Cross-Field Validation with validate()

Some validation rules depend on multiple fields. A classic example is password confirmation. The `validate()` function receives a context object with `value()` for the current field and `valueOf()` to read any other field in the tree. Signal tracking handles the rest: when either field changes, the validator re-runs automatically.

```typescript
// src/app/account/registration-form.component.ts
import { Component, signal, computed } from '@angular/core';
import {
  form, FormField, submit, required, minLength,
  validate, customError,
} from '@angular/forms/signals';

interface RegistrationData {
  username: string;
  password: string;
  confirmPassword: string;
}

@Component({
  selector: 'app-registration-form',
  imports: [FormField],
  template: `
    <form novalidate (submit)="onSubmit($event)">
      <label>
        Username
        <input type="text" [formField]="regForm.username" />
      </label>

      <label>
        Password
        <input type="password" [formField]="regForm.password" />
      </label>
      @if (regForm.password().touched() && regForm.password().invalid()) {
        @for (error of regForm.password().errors(); track error.kind) {
          <p class="field-error">{{ error.message }}</p>
        }
      }

      <label>
        Confirm Password
        <input type="password" [formField]="regForm.confirmPassword" />
      </label>
      @if (regForm.confirmPassword().touched() && regForm.confirmPassword().invalid()) {
        @for (error of regForm.confirmPassword().errors(); track error.kind) {
          <p class="field-error">{{ error.message }}</p>
        }
      }

      <button type="submit" [disabled]="!canSubmit()">
        Create Account
      </button>
    </form>
  `,
})
export class RegistrationFormComponent {
  protected readonly regModel = signal<RegistrationData>({
    username: '',
    password: '',
    confirmPassword: '',
  });

  protected readonly regForm = form(this.regModel, (path) => {
    required(path.username, { message: 'Username is required' });
    required(path.password, { message: 'Password is required' });
    minLength(path.password, 8, { message: 'At least 8 characters' });
    required(path.confirmPassword, { message: 'Please confirm your password' });
    validate(path.confirmPassword, ({ value, valueOf }) => {
      if (value() !== valueOf(path.password)) {
        return customError({
          kind: 'password-mismatch',
          message: 'Passwords do not match',
        });
      }
      return null;
    });
  });

  protected readonly canSubmit = computed(() =>
    this.regForm().valid() && !this.regForm().submitting()
  );

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    await submit(this.regForm, async (field) => {
      const data = field().value();
      console.log('Registering:', data.username);
      return null;
    });
  }
}
```

The `validate()` callback reads `valueOf(path.password)`, which creates a signal dependency on the password field. When the user changes the password after typing the confirmation, the mismatch validator automatically re-evaluates. With reactive forms, you would need to call `confirmPassword.updateValueAndValidity()` inside a `password.valueChanges` subscription. With signal forms, it just works.

## Async Validation with validateHttp and debounce

Checking whether a username is already taken requires an HTTP call. The `validateHttp()` function integrates with Angular's HTTP infrastructure. Pair it with `debounce()` to avoid hammering the server on every keystroke.

```typescript
// src/app/account/registration-form.component.ts (updated schema)
import {
  form, required, minLength, validate, validateHttp,
  debounce, customError,
} from '@angular/forms/signals';

protected readonly regForm = form(this.regModel, (path) => {
  required(path.username, { message: 'Username is required' });
  minLength(path.username, 3, { message: 'At least 3 characters' });
  debounce(path.username, 500);
  validateHttp(path.username, {
    request: ({ value }) =>
      value().length >= 3
        ? `/api/users/check-username?name=${encodeURIComponent(value())}`
        : undefined,
    onSuccess: (result: { available: boolean }) =>
      result.available
        ? undefined
        : customError({ kind: 'username-taken', message: 'This username is already taken' }),
    onError: () =>
      customError({ kind: 'check-failed', message: 'Could not verify username availability' }),
  });

  required(path.password, { message: 'Password is required' });
  minLength(path.password, 8, { message: 'At least 8 characters' });
  required(path.confirmPassword, { message: 'Please confirm your password' });
  validate(path.confirmPassword, ({ value, valueOf }) => {
    if (value() !== valueOf(path.password)) {
      return customError({ kind: 'password-mismatch', message: 'Passwords do not match' });
    }
    return null;
  });
});
```

`debounce(path.username, 500)` delays UI updates to the model by 500 milliseconds. The user types freely, and the model only updates when they pause or move focus. Since `validateHttp` reads the field value (which is debounced), the HTTP check fires at most once per 500ms pause. The `request` function returns `undefined` when the username is too short, which skips the HTTP call entirely.

While async validation is in progress, the `pending()` signal on the field returns `true`. Use it in the template to show a spinner:

```typescript
// src/app/account/registration-form.component.ts (template snippet)
template: `
  <label>
    Username
    <input type="text" [formField]="regForm.username" />
    @if (regForm.username().pending()) {
      <span class="spinner">Checking...</span>
    }
  </label>
  @if (regForm.username().touched() && regForm.username().invalid()) {
    @for (error of regForm.username().errors(); track error.kind) {
      <p class="field-error">{{ error.message }}</p>
    }
  }
`
```

Async validators only run after all synchronous validators pass. If the username is empty (fails `required`), the HTTP check is never triggered.

## Form Submission with submit()

The `submit()` function orchestrates the full submission lifecycle. It marks every field as touched, validates the entire form, and only calls your action callback if validation passes. During execution, `submitting()` returns `true` on every field in the tree. If the server returns errors, you map them back to specific fields.

```typescript
// src/app/checkout/checkout-form.component.ts (updated submit handler)
import { inject } from '@angular/core';
import { submit, customError } from '@angular/forms/signals';
import { OrderService } from './order.service';

export class CheckoutFormComponent {
  private readonly orderService = inject(OrderService);

  // ... model, form setup ...

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    const success = await submit(this.checkoutForm, async (field) => {
      const data = field().value();
      try {
        await this.orderService.placeOrder(data);
        return null;
      } catch (err: unknown) {
        const apiError = err as { code: string; field?: string };
        if (apiError.code === 'INVALID_ZIP') {
          return {
            kind: 'server-error',
            message: 'This ZIP code is not serviceable',
            fieldTree: this.checkoutForm.shippingAddress.zip,
          };
        }
        return {
          kind: 'server-error',
          message: 'Something went wrong. Please try again.',
        };
      }
    });

    if (success) {
      console.log('Order placed!');
    }
  }
}
```

The `submit()` function returns a `Promise<boolean>`. It resolves to `true` when the action succeeds (returns `null`) and `false` when validation fails or the action returns an error. The `fieldTree` property on the returned error tells `submit()` which field should display the server error. If omitted, the error attaches to the root form.

## Custom Form Controls with FormValueControl

Angular's legacy `ControlValueAccessor` interface required implementing `writeValue()`, `registerOnChange()`, `registerOnTouched()`, and providing `NG_VALUE_ACCESSOR` with `forwardRef`. Signal Forms replace all of that with `FormValueControl<T>`, an interface backed by signal inputs and model signals.

```typescript
// src/app/shared/controls/star-rating.component.ts
import { Component, model, input, computed } from '@angular/core';
import { FormValueControl, ValidationError } from '@angular/forms/signals';

@Component({
  selector: 'app-star-rating',
  template: `
    <div class="star-rating" role="radiogroup" aria-label="Rating">
      @for (star of stars; track star) {
        <button
          type="button"
          role="radio"
          [attr.aria-checked]="star <= value()"
          [attr.aria-label]="star + ' star' + (star > 1 ? 's' : '')"
          [class.active]="star <= value()"
          [disabled]="disabled()"
          (click)="select(star)">
          &#9733;
        </button>
      }
    </div>
    @if (showErrors()) {
      @for (error of errors(); track error.kind) {
        <p class="field-error">{{ error.message }}</p>
      }
    }
  `,
})
export class StarRatingComponent implements FormValueControl<number> {
  readonly value = model(0);
  readonly disabled = input(false);
  readonly errors = input<readonly ValidationError[]>([]);
  readonly touched = model(false);

  protected readonly stars = [1, 2, 3, 4, 5];
  protected readonly showErrors = computed(() =>
    this.touched() && this.errors().length > 0
  );

  protected select(rating: number): void {
    this.value.set(rating);
  }
}
```

The `value` property is a `model()` signal, not a plain `input()`. This enables two-way binding: the parent `FormField` directive writes to it, and the component writes back when the user clicks. The `disabled`, `errors`, and `touched` inputs receive state from the parent form tree automatically. No providers, no `forwardRef`, no callback registration.

Use it in any form just like a native input:

```typescript
// src/app/products/product-review.component.ts
import { Component, signal, computed } from '@angular/core';
import { form, FormField, submit, required, min, max, minLength } from '@angular/forms/signals';
import { StarRatingComponent } from '../shared/controls/star-rating.component';

interface ReviewData {
  rating: number;
  comment: string;
}

@Component({
  selector: 'app-product-review',
  imports: [FormField, StarRatingComponent],
  template: `
    <form novalidate (submit)="onSubmit($event)">
      <label>Rating</label>
      <app-star-rating [formField]="reviewForm.rating" />

      <label>
        Comment
        <textarea [formField]="reviewForm.comment" rows="4"></textarea>
      </label>
      @if (reviewForm.comment().touched() && reviewForm.comment().invalid()) {
        @for (error of reviewForm.comment().errors(); track error.kind) {
          <p class="field-error">{{ error.message }}</p>
        }
      }

      <button type="submit" [disabled]="!canSubmit()">Submit Review</button>
    </form>
  `,
})
export class ProductReviewComponent {
  protected readonly reviewModel = signal<ReviewData>({ rating: 0, comment: '' });

  protected readonly reviewForm = form(this.reviewModel, (path) => {
    required(path.rating, { message: 'Please select a rating' });
    min(path.rating, 1, { message: 'Rating must be at least 1 star' });
    max(path.rating, 5);
    required(path.comment, { message: 'Please write a comment' });
    minLength(path.comment, 10, { message: 'At least 10 characters' });
  });

  protected readonly canSubmit = computed(() =>
    this.reviewForm().valid() && !this.reviewForm().submitting()
  );

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    await submit(this.reviewForm, async (field) => {
      console.log('Review:', field().value());
      return null;
    });
  }
}
```

## Array Fields with applyEach

Forms that manage collections (line items in an order, multiple phone numbers, dynamic survey questions) use array fields. The model contains an array, and the field tree exposes it as an iterable of `FieldTree` instances.

```typescript
// src/app/checkout/order-items-form.component.ts
import { Component, signal, computed } from '@angular/core';
import {
  form, FormField, submit, required, min,
  applyEach, schema,
} from '@angular/forms/signals';

interface OrderItem {
  productName: string;
  quantity: number;
}

interface OrderData {
  customerName: string;
  items: OrderItem[];
}

const orderItemSchema = schema<OrderItem>((path) => {
  required(path.productName, { message: 'Product name is required' });
  required(path.quantity, { message: 'Quantity is required' });
  min(path.quantity, 1, { message: 'Quantity must be at least 1' });
});

@Component({
  selector: 'app-order-items-form',
  imports: [FormField],
  template: `
    <form novalidate (submit)="onSubmit($event)">
      <label>
        Customer Name
        <input type="text" [formField]="orderForm.customerName" />
      </label>

      <h3>Order Items</h3>
      @for (item of orderForm.items; track $index) {
        <div class="order-item-row">
          <label>
            Product
            <input type="text" [formField]="item.productName" />
          </label>
          <label>
            Qty
            <input type="number" [formField]="item.quantity" />
          </label>
          <button type="button" (click)="removeItem($index)">Remove</button>
        </div>
      }

      <button type="button" (click)="addItem()">Add Item</button>
      <button type="submit">Submit Order</button>
    </form>
  `,
})
export class OrderItemsFormComponent {
  protected readonly orderModel = signal<OrderData>({
    customerName: '',
    items: [{ productName: '', quantity: 1 }],
  });

  protected readonly orderForm = form(this.orderModel, (path) => {
    required(path.customerName, { message: 'Customer name is required' });
    applyEach(path.items, orderItemSchema);
  });

  protected addItem(): void {
    this.orderForm.items().value.update(items => [
      ...items,
      { productName: '', quantity: 1 },
    ]);
  }

  protected removeItem(index: number): void {
    this.orderForm.items().value.update(items =>
      items.filter((_, i) => i !== index)
    );
  }

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    await submit(this.orderForm, async (field) => {
      console.log('Order:', field().value());
      return null;
    });
  }
}
```

`applyEach()` applies the `orderItemSchema` to every element in the `items` array. When you add a new item, the schema automatically applies to it. When you remove one, its validation state disappears from the parent aggregation. The `@for` directive iterates over the field tree's array, giving you a `FieldTree<OrderItem>` for each element with full state access.

## Reading and Writing Values Programmatically

You can read and update form state from TypeScript without user interaction.

```typescript
// src/app/checkout/programmatic-access.ts

// Read the entire model
const data = checkoutModel();

// Read a single field's value
const email = checkoutForm.email().value();

// Read form-level validity
const isValid = checkoutForm().valid();

// Set a single field
checkoutForm.email().value.set('admin@example.com');

// Update based on previous value
checkoutForm.discountCode().value.update(code => code.toUpperCase());

// Replace the entire model (resets field tree)
checkoutModel.set({
  customerName: 'Alice',
  email: 'alice@example.com',
  shippingAddress: { street: '123 Main St', city: 'Springfield', zip: '62704' },
  billingAddress: { street: '', city: '', zip: '' },
  useSeparateBilling: false,
  discountCode: '',
});

// Reset the form to initial state
checkoutForm().reset();

// Reset a single field
checkoutForm.email().reset();
```

When you call `value.set()` on a field, the change propagates up to the model signal. When you call `set()` on the model signal, the change propagates down to all field states. The synchronization is bidirectional and automatic.

## Configuring CSS State Classes

Signal Forms do not add `ng-valid`, `ng-invalid`, `ng-touched`, or `ng-dirty` CSS classes to form elements by default. This is a deliberate break from reactive forms: it keeps the DOM cleaner and gives you control. If your existing stylesheets rely on these classes, restore them with `provideSignalFormsConfig`:

```typescript
// src/app/app.config.ts
import { ApplicationConfig } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideSignalFormsConfig, NG_STATUS_CLASSES } from '@angular/forms';

export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(),
    provideSignalFormsConfig({
      classes: NG_STATUS_CLASSES,
    }),
  ],
};
```

For custom class names (useful with CSS frameworks like Tailwind or your own design system), provide a class map instead:

```typescript
// src/app/app.config.ts
import { provideSignalFormsConfig } from '@angular/forms';

export const appConfig: ApplicationConfig = {
  providers: [
    provideSignalFormsConfig({
      classes: {
        'is-invalid': ({ state }) => state().invalid() && state().touched(),
        'is-valid': ({ state }) => state().valid() && state().touched(),
        'is-dirty': ({ state }) => state().dirty(),
      },
    }),
  ],
};
```

## Common Mistakes

### Mistake 1: Initializing Fields with undefined

```typescript
// WRONG - phoneNumber will be excluded from the field tree
const model = signal({
  name: 'Alice',
  phoneNumber: undefined,
});
const myForm = form(model);
// myForm.phoneNumber does not exist! TypeScript may not catch this.
```

Fields set to `undefined` are silently excluded from the field tree. The `FormField` directive cannot bind to them, and no validation runs. This is the most common surprise for developers coming from reactive forms, where `FormControl` always exists regardless of its value.

```typescript
// CORRECT - use null or an empty string
const model = signal({
  name: 'Alice',
  phoneNumber: '',
});
const myForm = form(model);
// myForm.phoneNumber exists and can be bound, validated, and read.
```

### Mistake 2: Using stateOf() When You Need valueOf()

```typescript
// WRONG - reading stateOf(form root) causes this validator to re-run on EVERY change
validate(path.confirmPassword, ({ value, stateOf }) => {
  const formState = stateOf(path);
  if (value() !== formState.value().password) {
    return customError({ kind: 'mismatch', message: 'Passwords do not match' });
  }
  return null;
});
```

`stateOf()` reads the entire state object for a path, which creates a signal dependency on every property of that state. Every change to any field causes this validator to re-run. Use `valueOf()` to read only the specific field you need.

```typescript
// CORRECT - only tracks the password field
validate(path.confirmPassword, ({ value, valueOf }) => {
  if (value() !== valueOf(path.password)) {
    return customError({ kind: 'mismatch', message: 'Passwords do not match' });
  }
  return null;
});
```

### Mistake 3: Forgetting novalidate and preventDefault

```typescript
// WRONG - browser validation competes with Signal Forms
@Component({
  template: `
    <form (submit)="onSubmit()">
      <input type="email" [formField]="myForm.email" />
      <button type="submit">Save</button>
    </form>
  `,
})
export class MyComponent {
  onSubmit(): void {
    // Browser shows its own "Please enter a valid email" tooltip
    // Signal Forms validation also runs
    // User sees two conflicting error UIs
  }
}
```

Without `novalidate` on the form element, the browser's built-in validation triggers on submit and produces tooltips that overlap with your custom error display. Without `event.preventDefault()`, the browser may attempt to navigate.

```typescript
// CORRECT - disable browser validation, prevent default
@Component({
  template: `
    <form novalidate (submit)="onSubmit($event)">
      <input type="email" [formField]="myForm.email" />
      <button type="submit">Save</button>
    </form>
  `,
})
export class MyComponent {
  onSubmit(event: Event): void {
    event.preventDefault();
    // Only Signal Forms validation runs
  }
}
```

### Mistake 4: Subscribing to valueChanges Out of Habit

```typescript
// WRONG - there is no valueChanges in Signal Forms
// This code does not compile
this.checkoutForm.email.valueChanges.subscribe(value => {
  console.log('Email changed:', value);
});
```

Signal Forms have no Observable-based change streams. The model signal IS the change stream. Use `computed()` for derived values and `effect()` for side effects when a field value changes.

```typescript
// CORRECT - use computed() or effect()
import { computed, effect } from '@angular/core';

// Derived value
const emailDomain = computed(() => {
  const email = this.checkoutForm.email().value();
  return email.includes('@') ? email.split('@')[1] : '';
});

// Side effect on change
effect(() => {
  const email = this.checkoutForm.email().value();
  console.log('Email changed:', email);
});
```

## Key Takeaways

- **Signal Forms replace the imperative reactive forms model with a declarative, signal-driven approach.** You define a model as a `WritableSignal<T>`, pass it to `form()` with a schema function, and bind inputs with `[formField]`. The field tree mirrors your model's shape with full type safety.

- **All validation lives in the schema, not in templates or imperative calls.** Built-in validators (`required`, `email`, `min`, `max`, `minLength`, `maxLength`, `pattern`), custom sync validators (`validate`), async validators (`validateHttp`), and conditional schemas (`applyWhen`) are all declared in one place. Cross-field validators automatically re-run when any dependency changes.

- **Custom controls are dramatically simpler.** The `FormValueControl<T>` interface uses `model()` and `input()` signals instead of the legacy `ControlValueAccessor` callbacks and provider registration. A custom control that previously required 250+ lines now takes about 40.

- **Signal Forms have no CSS classes by default.** If your styles depend on `ng-valid`, `ng-invalid`, `ng-touched`, or similar classes, add `provideSignalFormsConfig({ classes: NG_STATUS_CLASSES })` to your application config. For custom class names, provide a class map with signal-based predicates.

- **The API is experimental.** Signal Forms shipped in Angular 21.0.0 with the `@experimental` label. The core mental model (model signals, field trees, schema-based validation) is stable, but specific function signatures may change. Start adopting them in new feature forms where the migration cost of an API change is low.
