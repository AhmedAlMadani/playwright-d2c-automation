import { APIRequestContext, expect } from '@playwright/test';
import { User, Subscription, SubscriptionState, ApiResponse } from '../types/api';
import { v4 as uuidv4 } from 'uuid';

// In-memory "database" to simulate backend data
interface MockDatabase {
  users: User[];
  subscriptions: Subscription[];
}

const mockDb: MockDatabase = {
  users: [],
  subscriptions: [],
};

export class ApiClient {
  protected request: APIRequestContext;
  protected baseUrl: string;

  constructor(requestContext: APIRequestContext, baseUrl: string) {
    this.request = requestContext;
    this.baseUrl = baseUrl;
  }

  // --- Mock API Helpers (simulating backend operations) ---

  /**
   * Simulates creating a user in the backend.
   */
  protected async mockCreateUser(email: string, password?: string): Promise<ApiResponse<User>> {
    if (mockDb.users.some(u => u.email === email)) {
      return { success: false, message: 'User with this email already exists.' };
    }
    const newUser: User = {
      id: uuidv4(),
      email,
      password,
      createdAt: new Date().toISOString(),
    };
    mockDb.users.push(newUser);
    return { success: true, data: newUser };
  }

  /**
   * Simulates getting a user by ID or email.
   */
  protected async mockGetUser(identifier: { id?: string; email?: string }): Promise<ApiResponse<User>> {
    const user = mockDb.users.find(u => (identifier.id && u.id === identifier.id) || (identifier.email && u.email === identifier.email));
    if (user) {
      return { success: true, data: user };
    }
    return { success: false, message: 'User not found.' };
  }

  /**
   * Simulates creating a subscription.
   */
  protected async mockCreateSubscription(userId: string, planId: string, price: number, currency: string): Promise<ApiResponse<Subscription>> {
    const userExists = mockDb.users.some(u => u.id === userId);
    if (!userExists) {
      return { success: false, message: 'User not found for subscription.' };
    }

    // Simulate payment success/failure
    const paymentSuccessful = Math.random() > 0.1; // 90% success rate

    if (!paymentSuccessful) {
      return { success: false, message: 'Payment failed.' };
    }

    const newSubscription: Subscription = {
      id: uuidv4(),
      userId,
      planId,
      state: 'active', // Directly active after successful payment
      startDate: new Date().toISOString(),
      endDate: null,
      price,
      currency,
    };
    mockDb.subscriptions.push(newSubscription);
    return { success: true, data: newSubscription };
  }

  /**
   * Simulates getting a subscription by user ID.
   */
  protected async mockGetSubscription(userId: string): Promise<ApiResponse<Subscription>> {
    const subscription = mockDb.subscriptions.find(s => s.userId === userId);
    if (subscription) {
      return { success: true, data: subscription };
    }
    return { success: false, message: 'Subscription not found.' };
  }

  /**
   * Simulates updating a subscription state.
   */
  protected async mockUpdateSubscriptionState(subscriptionId: string, newState: SubscriptionState): Promise<ApiResponse<Subscription>> {
    const subscriptionIndex = mockDb.subscriptions.findIndex(s => s.id === subscriptionId);
    if (subscriptionIndex === -1) {
      return { success: false, message: 'Subscription not found.' };
    }

    const subscription = mockDb.subscriptions[subscriptionIndex];

    // Basic state transition validation (can be expanded)
    if (newState === 'canceled' && subscription.state === 'active') {
      subscription.state = newState;
      subscription.endDate = new Date().toISOString();
      return { success: true, data: subscription };
    } else if (newState === 'active' && (subscription.state === 'inactive' || subscription.state === 'trial' || subscription.state === 'past_due')) {
      subscription.state = newState;
      return { success: true, data: subscription };
    } else if (newState === 'past_due' && subscription.state === 'active') {
      subscription.state = newState;
      return { success: true, data: subscription };
    } else if (newState === 'trial' && subscription.state === 'inactive') {
      subscription.state = newState;
      return { success: true, data: subscription };
    }
    
    return { success: false, message: `Invalid state transition from ${subscription.state} to ${newState}.` };
  }

  /**
   * Simulates canceling a subscription.
   */
  protected async mockCancelSubscription(userId: string): Promise<ApiResponse<Subscription>> {
    const subscriptionIndex = mockDb.subscriptions.findIndex(s => s.userId === userId);
    if (subscriptionIndex === -1) {
      return { success: false, message: 'Subscription not found.' };
    }

    const subscription = mockDb.subscriptions[subscriptionIndex];
    if (subscription.state === 'active' || subscription.state === 'past_due') {
      subscription.state = 'canceled';
      subscription.endDate = new Date().toISOString();
      return { success: true, data: subscription };
    }
    return { success: false, message: `Cannot cancel subscription in ${subscription.state} state.` };
  }

  /**
   * Resets the mock database for a clean test run.
   */
  public static resetMockDb(): void {
    mockDb.users = [];
    mockDb.subscriptions = [];
  }
}
