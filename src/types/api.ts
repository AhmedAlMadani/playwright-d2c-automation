export type SubscriptionState = "inactive" | "trial" | "active" | "past_due" | "canceled";

export interface User {
  id: string;
  email: string;
  password?: string;
  createdAt: string;
}

export interface Subscription {
  id: string;
  userId: string;
  planId: string;
  state: SubscriptionState;
  startDate: string;
  endDate: string | null;
  price: number;
  currency: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
}
