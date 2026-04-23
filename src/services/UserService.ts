import { APIRequestContext } from '@playwright/test';
import { UserService as UserApiService } from '../api/userService';
import { SubscriptionService as SubscriptionApiService } from '../api/subscriptionService';
import { User, Subscription, ApiResponse } from '../types/api';
import { Logger } from '../utils/logger';

/**
 * UserService — Business-logic layer for user operations.
 *
 * Sits between tests and the raw API layer. Handles orchestration
 * concerns such as: existence checks before creation, structured
 * error surfacing, and cross-service coordination.
 */
export class UserService {
  private readonly userApi: UserApiService;
  private readonly subscriptionApi: SubscriptionApiService;

  constructor(requestContext: APIRequestContext, baseUrl: string) {
    this.userApi = new UserApiService(requestContext, baseUrl);
    this.subscriptionApi = new SubscriptionApiService(requestContext, baseUrl);
  }

  /**
   * Creates a new user and asserts success.
   * Throws a descriptive error if the user already exists or creation fails.
   */
  async createUser(email: string, password: string): Promise<User> {
    Logger.info(`[UserService] Creating user: ${email}`);
    const response = await this.userApi.createUser(email, password);
    if (!response.success || !response.data) {
      throw new Error(`[UserService] Failed to create user "${email}": ${response.message}`);
    }
    Logger.info(`[UserService] User created with ID: ${response.data.id}`);
    return response.data;
  }

  /**
   * Retrieves a user by ID or email. Returns null if not found.
   */
  async findUser(identifier: { id?: string; email?: string }): Promise<User | null> {
    Logger.info(`[UserService] Finding user: ${JSON.stringify(identifier)}`);
    const response = await this.userApi.getUser(identifier);
    if (!response.success || !response.data) {
      Logger.warn(`[UserService] User not found: ${JSON.stringify(identifier)}`);
      return null;
    }
    return response.data;
  }

  /**
   * Ensures a user exists, creating one if needed.
   * Useful in test setup hooks.
   */
  async ensureUser(email: string, password: string): Promise<User> {
    Logger.info(`[UserService] Ensuring user exists: ${email}`);
    const existing = await this.findUser({ email });
    if (existing) {
      Logger.info(`[UserService] User already exists: ${email}`);
      return existing;
    }
    return this.createUser(email, password);
  }

  /**
   * Returns the subscription for the given user, or null if none.
   */
  async getSubscriptionForUser(userId: string): Promise<Subscription | null> {
    Logger.info(`[UserService] Getting subscription for user: ${userId}`);
    const response: ApiResponse<Subscription> = await this.subscriptionApi.getSubscriptionStatus(userId);
    return response.success && response.data ? response.data : null;
  }
}
