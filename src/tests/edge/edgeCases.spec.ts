/**
 * Edge Case Tests
 *
 * Tags: @regression
 *
 * Validates system resilience against unusual but plausible scenarios:
 *   - Duplicate subscription creation (Idempotency)
 *   - Rapid sequential state changes
 *   - Concurrent user creation
 *   - Terminal state immutability
 *   - Data isolation between distinct users
 */

import { test, expect } from '../../fixtures';
import { DataFactory } from '../../utils/dataFactory';
import { Logger } from '../../utils/logger';

test.describe('Edge Cases – Duplicate Operations & Idempotency @regression', () => {
  
  test('should reject duplicate subscription requests to prevent multiple active plans', async ({
    userService,
    subscriptionService,
  }) => {
    const { email, password } = DataFactory.generateUserData();
    const user = await userService.createUser(email, password!);

    // First request succeeds
    const first = await subscriptionService.subscribe(user.id, 'basic', 9.99);
    expect(first.state).toBe('active');

    // Second request should be rejected by the exclusivity constraint
    await expect(
      subscriptionService.subscribe(user.id, 'premium', 29.99)
    ).rejects.toThrow(/User already has an active subscription/);

    // Verify DB still only has the first one
    const status = await subscriptionService.getStatus(user.id);
    expect(status!.id).toBe(first.id);
  });

  test('should handle creating users with similar but distinct emails', async ({
    userService,
  }) => {
    const uniqueId = Date.now() + Math.floor(Math.random() * 1000);
    const emails = [
      `user+test1_${uniqueId}@example.com`,
      `user+test2_${uniqueId}@example.com`,
      `USER_${uniqueId}@example.com`, // PostgreSQL case-sensitive unless using citext
    ];

    const users = await Promise.all(
      emails.map(email => userService.createUser(email, 'SecurePass1!')),
    );

    const uniqueIds = new Set(users.map(u => u.id));
    expect(uniqueIds.size).toBe(3);
  });
});

test.describe('Edge Cases – Rapid State Changes & Immutability @regression', () => {
  
  test('should correctly sequence active → past_due → grace → active', async ({
    userService,
    subscriptionService,
  }) => {
    const { email, password } = DataFactory.generateUserData();
    const user = await userService.createUser(email, password!);
    const sub = await subscriptionService.subscribe(user.id, 'premium', 29.99);

    // active → past_due
    const pastDue = await subscriptionService.transitionState(sub.id, 'active', 'past_due');
    expect(pastDue.state).toBe('past_due');

    // past_due → grace
    const grace = await subscriptionService.enterGracePeriod(user.id, 7);
    expect(grace.state).toBe('grace');

    // grace → active (payment resolved)
    const reactivated = await subscriptionService.resolveGracePeriod(user.id);
    expect(reactivated.state).toBe('active');
  });

  test('should refuse modifications to a canceled subscription', async ({
    userService,
    subscriptionService,
  }) => {
    const { email, password } = DataFactory.generateUserData();
    const user = await userService.createUser(email, password!);
    await subscriptionService.subscribe(user.id, 'basic', 9.99);

    const canceled = await subscriptionService.cancel(user.id);
    expect(canceled.state).toBe('canceled');

    // Trying to toggle auto-renew on a canceled sub should fail
    await expect(
      subscriptionService.toggleAutoRenew(user.id, true),
    ).rejects.toThrow(/not active/i); // Actual error text depends on implementation, but it should reject

    // Trying to upgrade should fail
    await expect(
      subscriptionService.upgradePlan(user.id, 'premium', 29.99)
    ).rejects.toThrow(/Cannot upgrade.*canceled/i);
  });
});

test.describe('Edge Cases – Data Integrity @regression', () => {
  
  test('should maintain strict data isolation between distinct users', async ({
    userService,
    subscriptionService,
    billingService,
  }) => {
    const user1 = await userService.createUser(DataFactory.generateUserData().email, 'Pass1!');
    const user2 = await userService.createUser(DataFactory.generateUserData().email, 'Pass1!');

    const sub1 = await subscriptionService.subscribe(user1.id, 'basic', 9.99);
    const sub2 = await subscriptionService.subscribe(user2.id, 'premium', 29.99);

    // Cancel user1
    await subscriptionService.cancel(user1.id);
    
    // User 1 is canceled, User 2 must remain active
    const status1 = await subscriptionService.getStatus(user1.id);
    const status2 = await subscriptionService.getStatus(user2.id);

    expect(status1!.state).toBe('canceled');
    expect(status2!.state).toBe('active');
    
    // Billing history should be isolated
    const payments1 = await billingService.getHistory(user1.id);
    const payments2 = await billingService.getHistory(user2.id);
    
    expect(payments1).toHaveLength(1);
    expect(payments2).toHaveLength(1);
    expect(payments1[0].subscriptionId).toBe(sub1.id);
    expect(payments2[0].subscriptionId).toBe(sub2.id);
  });
});
