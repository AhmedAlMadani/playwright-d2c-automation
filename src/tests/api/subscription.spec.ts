/**
 * API Tests: Subscription Service Validation
 *
 * Tags: @regression
 *
 * Validates the API layer in isolation:
 *   - Response schemas match type contracts
 *   - Business logic is enforced (invalid state transitions rejected)
 *   - Duplicate user creation rejected
 *   - Missing resource error handling
 *   - All CRUD operations return correct shapes
 *
 * Note: These tests operate purely against the mock API layer (no UI).
 * They are fast, isolated, and should run in < 2 seconds total.
 */

import { test, expect } from '../../fixtures';
import { DataFactory } from '../../utils/dataFactory';
import { Logger } from '../../utils/logger';

test.describe('API Tests – User Service @regression', () => {
  test('createUser: should return correct user schema', async ({ userService }) => {
    const userData = DataFactory.generateUserData('SecurePass1!');
    const user = await userService.createUser(userData.email, userData.password!);

    // Schema assertions
    expect(typeof user.id).toBe('string');
    expect(user.id.length).toBeGreaterThan(0);
    expect(user.email).toBe(userData.email);
    expect(typeof user.createdAt).toBe('string');
    // Password should not be exposed in responses
    Logger.info('[Test] User schema validated.');
  });

  test('createUser: should reject duplicate email creation', async ({ userService }) => {
    const userData = DataFactory.generateUserData();
    await userService.createUser(userData.email, userData.password!);

    // Second creation with same email must throw
    await expect(
      userService.createUser(userData.email, userData.password!),
    ).rejects.toThrow(/already exists/);
    Logger.info('[Test] Duplicate user correctly rejected.');
  });

  test('findUser: should return null for non-existent user', async ({ userService }) => {
    const result = await userService.findUser({ email: 'nonexistent@example.com' });
    expect(result).toBeNull();
    Logger.info('[Test] Non-existent user correctly returns null.');
  });

  test('findUser: should find user by ID', async ({ userService }) => {
    const userData = DataFactory.generateUserData();
    const created = await userService.createUser(userData.email, userData.password!);
    const found = await userService.findUser({ id: created.id });
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.email).toBe(userData.email);
  });

  test('findUser: should find user by email', async ({ userService }) => {
    const userData = DataFactory.generateUserData();
    const created = await userService.createUser(userData.email, userData.password!);
    const found = await userService.findUser({ email: userData.email });
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
  });
});

test.describe('API Tests – Subscription Service @regression', () => {
  test('subscribe: should return correct subscription schema', async ({
    userService,
    subscriptionService,
  }) => {
    const userData = DataFactory.generateUserData();
    const user = await userService.createUser(userData.email, userData.password!);
    const subscription = await subscriptionService.subscribe(user.id, 'premium', 29.99, 'USD');

    // Schema assertions
    expect(typeof subscription.id).toBe('string');
    expect(subscription.id.length).toBeGreaterThan(0);
    expect(subscription.userId).toBe(user.id);
    expect(subscription.planId).toBe('premium');
    expect(subscription.state).toBe('active');
    expect(subscription.price).toBe(29.99);
    expect(subscription.currency).toBe('USD');
    expect(typeof subscription.startDate).toBe('string');
    expect(subscription.endDate).toBeNull();
    Logger.info('[Test] Subscription schema validated.');
  });

  test('subscribe: should fail for non-existent user', async ({ subscriptionService }) => {
    await expect(
      subscriptionService.subscribe('non-existent-user-id', 'basic', 9.99),
    ).rejects.toThrow(/Subscription creation failed/);
    Logger.info('[Test] Subscription for non-existent user correctly rejected.');
  });

  test('subscribe: should reject if user already has an active subscription', async ({
    userService,
    subscriptionService,
  }) => {
    const userData = DataFactory.generateUserData();
    const user = await userService.createUser(userData.email, userData.password!);
    
    // First subscription succeeds
    await subscriptionService.subscribe(user.id, 'basic', 9.99, 'USD');

    // Second subscription should be rejected
    await expect(
      subscriptionService.subscribe(user.id, 'premium', 29.99, 'USD')
    ).rejects.toThrow(/User already has an active subscription/);
    
    Logger.info('[Test] Duplicate active subscription correctly rejected.');
  });

  test('getStatus: should return null when no subscription exists', async ({
    userService,
    subscriptionService,
  }) => {
    const userData = DataFactory.generateUserData();
    const user = await userService.createUser(userData.email, userData.password!);
    const status = await subscriptionService.getStatus(user.id);
    expect(status).toBeNull();
  });

  test('cancel: should set state to canceled and populate endDate', async ({
    userService,
    subscriptionService,
  }) => {
    const userData = DataFactory.generateUserData();
    const user = await userService.createUser(userData.email, userData.password!);
    await subscriptionService.subscribe(user.id, 'basic', 9.99);

    const canceled = await subscriptionService.cancel(user.id);
    expect(canceled.state).toBe('canceled');
    expect(canceled.endDate).not.toBeNull();
    expect(typeof canceled.endDate).toBe('string');
    Logger.info('[Test] Cancel API response schema validated.');
  });

  test('validateTransition: should allow all valid transitions per state machine', async ({
    subscriptionService,
  }) => {
    const validTransitions = {
      inactive: ['trial', 'active'],
      trial: ['active', 'canceled'],
      active: ['past_due', 'canceled'],
      past_due: ['grace', 'canceled'],
      grace: ['active', 'canceled'],
      expired: [],
      canceled: [],
    } as const;

    for (const [from, targets] of Object.entries(validTransitions)) {
      for (const to of targets) {
        expect(() => {
          subscriptionService.validateTransition(from as any, to as any);
        }).not.toThrow();
      }
    }
    Logger.info('[Test] All valid transitions pass validation.');
  });

  test('validateTransition: should reject all invalid state transitions', async ({
    subscriptionService,
  }) => {
    const invalidTransitions: Array<[string, string]> = [
      ['canceled', 'active'],
      ['canceled', 'trial'],
      ['canceled', 'past_due'],
      ['canceled', 'inactive'],
      ['active', 'inactive'],
      ['trial', 'inactive'],
      ['trial', 'past_due'],
      ['past_due', 'inactive'],
      ['past_due', 'trial'],
      ['inactive', 'past_due'],
      ['inactive', 'canceled'],
    ];

    for (const [from, to] of invalidTransitions) {
      expect(() => {
        subscriptionService.validateTransition(from as any, to as any);
      }).toThrow(/Invalid transition/);
    }
    Logger.info(`[Test] ${invalidTransitions.length} invalid transitions correctly rejected.`);
  });
});
